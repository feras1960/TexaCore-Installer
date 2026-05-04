-- 1. Fix Top Customers to query the 'customers' table instead of hoping for 113 account explicitly
CREATE OR REPLACE FUNCTION get_dashboard_top_customers(p_company_id uuid, p_base_currency text)
RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH cust_balances AS (
    SELECT 
      c.id,
      c.name_ar,
      SUM(jel.debit - jel.credit) as outstanding
    FROM customers c
    JOIN journal_entry_lines jel ON jel.account_id = c.receivable_account_id
    JOIN journal_entries je ON je.id = jel.entry_id
    WHERE je.company_id = p_company_id 
      AND je.is_posted = true
      AND je.status = 'posted'
    GROUP BY c.id, c.name_ar
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


-- 2. Fix Currency Exposure to coalesce null currencies with the base currency
CREATE OR REPLACE FUNCTION get_dashboard_currency_exposure(p_company_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
  v_base_currency text;
BEGIN
  -- Get base currency from accounting settings
  SELECT base_currency INTO v_base_currency
  FROM company_accounting_settings
  WHERE company_id = p_company_id;

  WITH balances AS (
    SELECT 
      COALESCE(jel.currency, a.currency, v_base_currency) as currency,
      SUM(jel.debit - jel.credit) as net_balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN chart_of_accounts a ON a.id = jel.account_id AND a.tenant_id = je.tenant_id
    WHERE je.company_id = p_company_id 
      AND je.is_posted = true
      AND (a.account_code LIKE '111%' OR a.account_code LIKE '112%')
    GROUP BY COALESCE(jel.currency, a.currency, v_base_currency)
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
