-- Migration: 20260419000001_dashboard_full_rpcs
-- Description: Creates all Remaining RPCs for the Executive Dashboard

-- ==============================================================================
-- 1. get_dashboard_net_position 
-- Calculates net position (Assets - Liabilities)
-- ==============================================================================
CREATE OR REPLACE FUNCTION get_dashboard_net_position(p_company_id uuid, p_base_currency text)
RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
BEGIN
  -- We calculate Assets (1) and Liabilities (2) for the last 7 days cumulatively
  WITH dates AS (
    SELECT generate_series(CURRENT_DATE - INTERVAL '6 days', CURRENT_DATE, '1 day'::interval)::date as d
  ),
  daily_movements AS (
    SELECT 
      d.d as activity_date,
      a.account_code,
      jel.debit - jel.credit as net_amount_base
    FROM dates d
    LEFT JOIN journal_entries je ON je.company_id = p_company_id AND je.is_posted = true AND je.entry_date <= d.d
    LEFT JOIN journal_entry_lines jel ON jel.entry_id = je.id
    LEFT JOIN chart_of_accounts a ON a.id = jel.account_id AND a.tenant_id = je.tenant_id
    WHERE a.account_code LIKE '1%' OR a.account_code LIKE '2%'
  ),
  daily_totals AS (
    SELECT 
      activity_date,
      SUM(CASE WHEN account_code LIKE '1%' THEN net_amount_base ELSE 0 END) as total_assets,
      SUM(CASE WHEN account_code LIKE '2%' THEN -net_amount_base ELSE 0 END) as total_liabilities
    FROM daily_movements
    GROUP BY activity_date
  ),
  net_positions AS (
    SELECT 
      activity_date,
      COALESCE(total_assets - total_liabilities, 0) as net_position
    FROM daily_totals
    ORDER BY activity_date
  )
  SELECT jsonb_build_object(
    'valueBase', COALESCE((SELECT net_position FROM net_positions WHERE activity_date = CURRENT_DATE), 0),
    'baseCurrency', p_base_currency,
    'deltaPct7d', CASE 
      WHEN (SELECT net_position FROM net_positions WHERE activity_date = CURRENT_DATE - INTERVAL '6 days') = 0 THEN 0
      ELSE ROUND((((SELECT net_position FROM net_positions WHERE activity_date = CURRENT_DATE) - (SELECT net_position FROM net_positions WHERE activity_date = CURRENT_DATE - INTERVAL '6 days')) / ABS(NULLIF((SELECT net_position FROM net_positions WHERE activity_date = CURRENT_DATE - INTERVAL '6 days'), 0)) * 100)::numeric, 1)
    END,
    'deltaAbs7d', COALESCE((SELECT net_position FROM net_positions WHERE activity_date = CURRENT_DATE), 0) - COALESCE((SELECT net_position FROM net_positions WHERE activity_date = CURRENT_DATE - INTERVAL '6 days'), 0),
    'sparkline', COALESCE((SELECT jsonb_agg(net_position ORDER BY activity_date) FROM net_positions), '[]'::jsonb),
    'todayMovement', COALESCE((SELECT net_position FROM net_positions WHERE activity_date = CURRENT_DATE), 0) - COALESCE((SELECT net_position FROM net_positions WHERE activity_date = CURRENT_DATE - INTERVAL '1 day'), 0),
    'todayTxCount', COALESCE((SELECT COUNT(*) FROM journal_entries WHERE company_id = p_company_id AND is_posted = true AND entry_date = CURRENT_DATE), 0)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ==============================================================================
-- 2. get_dashboard_cash_flow 
-- ==============================================================================
CREATE OR REPLACE FUNCTION get_dashboard_cash_flow(p_company_id uuid, p_base_currency text, p_days int DEFAULT 30)
RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH dates AS (
    SELECT generate_series(CURRENT_DATE - (p_days - 1) * INTERVAL '1 day', CURRENT_DATE, '1 day'::interval)::date as d
  ),
  daily_flow AS (
    SELECT 
      je.entry_date,
      SUM(CASE WHEN jel.debit > 0 THEN jel.debit ELSE 0 END) as inflow,
      SUM(CASE WHEN jel.credit > 0 THEN jel.credit ELSE 0 END) as outflow
    FROM journal_entries je
    JOIN journal_entry_lines jel ON jel.entry_id = je.id
    JOIN chart_of_accounts a ON a.id = jel.account_id AND a.tenant_id = je.tenant_id
    WHERE je.company_id = p_company_id 
      AND je.is_posted = true 
      AND je.entry_date >= CURRENT_DATE - (p_days - 1) * INTERVAL '1 day'
      AND a.account_code LIKE '11%' -- cash and banks
    GROUP BY je.entry_date
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date', to_char(d.d, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'income', COALESCE(df.inflow, 0),
      'expense', COALESCE(df.outflow, 0)
    ) ORDER BY d.d
  ), '[]'::jsonb)
  INTO v_result
  FROM dates d
  LEFT JOIN daily_flow df ON df.entry_date = d.d;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ==============================================================================
-- 3. get_dashboard_attention_items 
-- ==============================================================================
CREATE OR REPLACE FUNCTION get_dashboard_attention_items(p_company_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(item), '[]'::jsonb) INTO v_result
  FROM (
      SELECT jsonb_build_object(
        'id', 'unposted_' || id,
        'title', 'قيد لم يرحل: ' || reference_number,
        'description', 'أنشئ بتاريخ ' || to_char(created_at, 'YYYY/MM/DD'),
        'type', 'warning',
        'badge', 'مراجعة',
        'action', '/accounting/journal-entries/' || id
      ) as item
      FROM journal_entries
      WHERE company_id = p_company_id AND is_posted = false
      ORDER BY created_at DESC
      LIMIT 4
  ) sub;
  
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 4. get_dashboard_top_customers 
-- ==============================================================================
CREATE OR REPLACE FUNCTION get_dashboard_top_customers(p_company_id uuid, p_base_currency text)
RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH cust_balances AS (
    SELECT 
      a.id,
      a.name_ar,
      SUM(jel.debit - jel.credit) as outstanding
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN chart_of_accounts a ON a.id = jel.account_id
    WHERE je.company_id = p_company_id 
      AND je.is_posted = true
      AND a.account_code LIKE '113%'
      AND a.is_detail = true
    GROUP BY a.id, a.name_ar
    HAVING SUM(jel.debit - jel.credit) > 0
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', id,
      'name', name_ar,
      'outstanding', outstanding,
      'currency', p_base_currency,
      'daysOverdue', 0
    ) ORDER BY outstanding DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT * FROM cust_balances ORDER BY outstanding DESC LIMIT 5
  ) sub;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 5. get_dashboard_recent_activity 
-- ==============================================================================
CREATE OR REPLACE FUNCTION get_dashboard_recent_activity(p_company_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', je.id,
      'title', 'قيد محاسبي: ' || je.reference_number,
      'user', COALESCE(u.full_name, 'النظام'),
      'timestamp', to_char(je.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'type', 'journal',
      'amount', je.total_debit
    ) ORDER BY je.created_at DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM journal_entries je
  LEFT JOIN user_profiles u ON u.id = je.created_by
  WHERE je.company_id = p_company_id
  LIMIT 6;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==============================================================================
-- 6. get_dashboard_currency_exposure 
-- ==============================================================================
CREATE OR REPLACE FUNCTION get_dashboard_currency_exposure(p_company_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH balances AS (
    SELECT 
      jel.currency as currency,
      SUM(jel.debit - jel.credit) as net_balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN chart_of_accounts a ON a.id = jel.account_id AND a.tenant_id = je.tenant_id
    WHERE je.company_id = p_company_id 
      AND je.is_posted = true
      AND (a.account_code LIKE '111%' OR a.account_code LIKE '112%')
    GROUP BY jel.currency
    HAVING SUM(jel.debit - jel.credit) > 0
  ),
  total AS (
    SELECT SUM(net_balance) as tot FROM balances
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'currency', b.currency,
      'valueBase', b.net_balance,
      'pct', ROUND((b.net_balance / NULLIF(t.tot, 0) * 100)::numeric, 1)
    ) ORDER BY b.net_balance DESC
  ), '[]'::jsonb)
  INTO v_result
  FROM balances b
  CROSS JOIN total t;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
