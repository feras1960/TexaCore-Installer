-- ═══════════════════════════════════════════════════════════════
-- RPC: get_dashboard_kpis (Real Data V2)
-- ═══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_dashboard_kpis(UUID, TEXT);

CREATE OR REPLACE FUNCTION get_dashboard_kpis(
  p_company_id UUID,
  p_base_currency TEXT DEFAULT 'USD'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_result JSONB;
  v_live_inventory_val NUMERIC := 0;
BEGIN
    -- Query the physical live inventory safely honoring RLS and Live Deductions automatically
    SELECT COALESCE(SUM(s.quantity_on_hand * COALESCE(NULLIF(s.average_cost, 0), m.purchase_price)), 0)
    INTO v_live_inventory_val
    FROM inventory_stock s
    JOIN fabric_materials m ON s.material_id = m.id
    WHERE s.company_id = p_company_id;

    WITH categories(category, label) AS (
        VALUES 
            ('cash', 'النقد والبنوك'), 
            ('receivables', 'الذمم المدينة'), 
            ('payables', 'الذمم الدائنة'), 
            ('inventory', 'قيمة المخزون')
    ),
    calendar AS (
        SELECT 
            dt::DATE as dt, 
            cat.category 
        FROM generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day'::interval) dt
        CROSS JOIN categories cat
    ),
    category_daily_movements AS (
        SELECT 
            CASE
                WHEN a.account_code LIKE '111%' OR a.account_code LIKE '112%' THEN 'cash'
                WHEN a.account_code LIKE '113%' THEN 'receivables'
                WHEN a.account_code LIKE '211%' OR a.account_code LIKE '21%' THEN 'payables'
                WHEN a.account_code LIKE '114%' THEN 'inventory'
            END AS category,
            je.entry_date::DATE as entry_date,
            SUM(
                CASE 
                    WHEN a.account_code LIKE '211%' OR a.account_code LIKE '21%' THEN jel.credit - jel.debit
                    ELSE jel.debit - jel.credit
                END
            ) AS net_movement
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        JOIN chart_of_accounts a ON a.id = jel.account_id
        WHERE je.company_id = p_company_id
          AND je.is_posted = true
          AND (a.account_code LIKE '111%' OR a.account_code LIKE '112%' OR a.account_code LIKE '113%' OR a.account_code LIKE '21%' OR a.account_code LIKE '114%')
        GROUP BY 1, 2
    ),
    sparkline_data AS (
        SELECT 
            c.category,
            c.dt,
            COALESCE((
                SELECT SUM(net_movement) 
                FROM category_daily_movements m 
                WHERE m.category = c.category AND m.entry_date <= c.dt
            ), 0) AS balance
        FROM calendar c
    ),
    sparklines_agg AS (
        SELECT 
            category,
            jsonb_agg(balance ORDER BY dt ASC) AS sparkline,
            MAX(CASE WHEN dt = CURRENT_DATE THEN balance ELSE 0 END) AS current_balance,
            MAX(CASE WHEN dt = CURRENT_DATE - INTERVAL '6 days' THEN balance ELSE 0 END) AS past_balance
        FROM sparkline_data
        GROUP BY category
    ),
    currency_balances AS (
        SELECT 
            CASE
                WHEN a.account_code LIKE '111%' OR a.account_code LIKE '112%' THEN 'cash'
                WHEN a.account_code LIKE '113%' THEN 'receivables'
                WHEN a.account_code LIKE '211%' OR a.account_code LIKE '21%' THEN 'payables'
                WHEN a.account_code LIKE '114%' THEN 'inventory'
            END AS category,
            COALESCE(a.currency, p_base_currency) AS currency_code,
            SUM(
                CASE 
                    WHEN a.account_code LIKE '211%' OR a.account_code LIKE '21%' THEN jel.credit - jel.debit
                    ELSE jel.debit - jel.credit
                END
            ) AS balance
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        JOIN chart_of_accounts a ON a.id = jel.account_id
        WHERE je.company_id = p_company_id
          AND je.is_posted = true
          AND je.entry_date <= CURRENT_DATE
          AND (a.account_code LIKE '111%' OR a.account_code LIKE '112%' OR a.account_code LIKE '113%' OR a.account_code LIKE '21%' OR a.account_code LIKE '114%')
        GROUP BY 1, 2
    ),
    category_totals AS (
        SELECT category, SUM(balance) as total_balance
        FROM currency_balances
        GROUP BY category
    ),
    breakdown_agg AS (
        SELECT 
            cb.category,
            jsonb_agg(
                jsonb_build_object(
                    'key', cb.currency_code,
                    'label', cb.currency_code,
                    'pct', CASE WHEN ct.total_balance > 0 THEN ROUND((cb.balance / ct.total_balance * 100)::numeric, 1) ELSE 0 END
                ) ORDER BY cb.balance DESC
            ) AS breakdown
        FROM currency_balances cb
        JOIN category_totals ct ON cb.category = ct.category
        WHERE cb.balance > 0
        GROUP BY cb.category
    ),
    final_output AS (
        SELECT 
            s.category,
            jsonb_build_object(
                'id', s.category,
                'label', c.label,
                -- Override Inventory strictly with live physical value mapping
                'value', CASE WHEN s.category = 'inventory' THEN v_live_inventory_val ELSE COALESCE(s.current_balance, 0) END,
                'currency', p_base_currency,
                'deltaPct7d', 
                    CASE 
                        WHEN COALESCE(s.past_balance, 0) = 0 THEN 0
                        ELSE ROUND((( (CASE WHEN s.category = 'inventory' THEN v_live_inventory_val ELSE COALESCE(s.current_balance, 0) END) - s.past_balance) / NULLIF(ABS(s.past_balance), 0) * 100)::numeric, 1)
                    END,
                'sparkline', COALESCE(s.sparkline, '[]'::jsonb),
                'breakdown', COALESCE(b.breakdown, '[]'::jsonb)
            ) AS kpi_json
        FROM sparklines_agg s
        JOIN categories c ON c.category = s.category
        LEFT JOIN breakdown_agg b ON s.category = b.category
        ORDER BY 
            CASE s.category 
                WHEN 'cash' THEN 1 
                WHEN 'receivables' THEN 2 
                WHEN 'payables' THEN 3 
                WHEN 'inventory' THEN 4 
            END
    )
    SELECT jsonb_agg(kpi_json) INTO v_result FROM final_output;
    
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION get_dashboard_kpis(UUID, TEXT) TO authenticated;
