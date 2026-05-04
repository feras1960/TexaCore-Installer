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
