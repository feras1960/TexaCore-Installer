-- ════════════════════════════════════════════════════════════════
-- Accounting Dashboard RPC v2
-- Trial Balance + Top Accounts + Alerts + Monthly Chart
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_accounting_dashboard(
  p_company_id uuid, 
  p_base_currency text,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_from date := COALESCE(p_from_date, date_trunc('month', CURRENT_DATE)::date);
  v_to date := COALESCE(p_to_date, CURRENT_DATE);
  v_result jsonb;
  v_trial_balance jsonb;
  v_top_accounts jsonb;
  v_alerts jsonb;
  v_kpis jsonb;
  v_monthly jsonb;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_journal_count int := 0;
  v_draft_count int := 0;
  v_posted_count int := 0;
BEGIN
  -- 1. KPIs
  WITH account_balances AS (
    SELECT
      at.classification,
      at.code as type_code,
      SUM(CASE WHEN at.normal_balance = 'debit' THEN jel.debit - jel.credit ELSE jel.credit - jel.debit END) as balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN chart_of_accounts a ON a.id = jel.account_id
    JOIN account_types at ON at.id = a.account_type_id
    WHERE je.company_id = p_company_id
      AND je.is_posted = true
      AND je.entry_date >= v_from AND je.entry_date <= v_to
    GROUP BY at.classification, at.code
  )
  SELECT jsonb_build_object(
    'revenue', COALESCE((SELECT SUM(balance) FROM account_balances WHERE classification = 'income'), 0),
    'expenses', COALESCE((SELECT SUM(balance) FROM account_balances WHERE classification = 'expenses'), 0),
    'cashBalance', COALESCE((
      SELECT SUM(jel.debit - jel.credit)
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN chart_of_accounts a ON a.id = jel.account_id
      WHERE je.company_id = p_company_id AND je.is_posted = true
        AND (a.account_code LIKE '111%' OR a.account_code LIKE '112%')
    ), 0),
    'receivables', COALESCE((
      SELECT SUM(jel.debit - jel.credit)
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN chart_of_accounts a ON a.id = jel.account_id
      WHERE je.company_id = p_company_id AND je.is_posted = true
        AND a.account_code LIKE '113%'
    ), 0),
    'payables', COALESCE((
      SELECT SUM(jel.credit - jel.debit)
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN chart_of_accounts a ON a.id = jel.account_id
      WHERE je.company_id = p_company_id AND je.is_posted = true
        AND a.account_code LIKE '2%'
    ), 0)
  ) INTO v_kpis;

  -- 2. Journal Stats
  SELECT COUNT(*), 
    COUNT(*) FILTER (WHERE status = 'draft'),
    COUNT(*) FILTER (WHERE status = 'posted')
  INTO v_journal_count, v_draft_count, v_posted_count
  FROM journal_entries
  WHERE company_id = p_company_id
    AND entry_date >= v_from AND entry_date <= v_to;

  -- 3. Trial Balance
  SELECT SUM(jel.debit), SUM(jel.credit)
  INTO v_total_debit, v_total_credit
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.entry_id
  WHERE je.company_id = p_company_id AND je.is_posted = true;

  v_trial_balance := jsonb_build_object(
    'totalDebit', COALESCE(v_total_debit, 0),
    'totalCredit', COALESCE(v_total_credit, 0),
    'difference', COALESCE(v_total_debit - v_total_credit, 0),
    'isBalanced', COALESCE(v_total_debit = v_total_credit, true)
  );

  -- 4. Top 8 Accounts
  SELECT COALESCE(jsonb_agg(row_to_json(sub)::jsonb ORDER BY sub.activity DESC), '[]'::jsonb)
  INTO v_top_accounts
  FROM (
    SELECT
      a.account_code as "accountCode",
      a.name_ar as "accountName",
      at.name_ar as "typeName",
      at.classification,
      SUM(jel.debit + jel.credit) as activity,
      SUM(CASE WHEN at.normal_balance = 'debit' THEN jel.debit - jel.credit ELSE jel.credit - jel.debit END) as balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN chart_of_accounts a ON a.id = jel.account_id AND a.is_detail = true
    JOIN account_types at ON at.id = a.account_type_id
    WHERE je.company_id = p_company_id AND je.is_posted = true
      AND je.entry_date >= v_from AND je.entry_date <= v_to
    GROUP BY a.account_code, a.name_ar, at.name_ar, at.classification
    ORDER BY activity DESC
    LIMIT 8
  ) sub;

  -- 5. Alerts
  SELECT jsonb_build_object(
    'draftEntries', v_draft_count,
    'isBalanced', COALESCE(v_total_debit = v_total_credit, true),
    'accountsCount', (SELECT COUNT(*) FROM chart_of_accounts WHERE company_id = p_company_id AND is_detail = true),
    'recurringPending', 0
  ) INTO v_alerts;

  -- 6. Monthly Revenue vs Expenses
  WITH months AS (
    SELECT generate_series(
      date_trunc('month', CURRENT_DATE - INTERVAL '5 months')::date,
      date_trunc('month', CURRENT_DATE)::date,
      '1 month'::interval
    )::date as month_start
  ),
  monthly_data AS (
    SELECT
      date_trunc('month', je.entry_date)::date as month_start,
      SUM(CASE WHEN at.classification = 'income' THEN jel.credit - jel.debit ELSE 0 END) as revenue,
      SUM(CASE WHEN at.classification = 'expenses' THEN jel.debit - jel.credit ELSE 0 END) as expenses
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.entry_id
    JOIN chart_of_accounts a ON a.id = jel.account_id
    JOIN account_types at ON at.id = a.account_type_id
    WHERE je.company_id = p_company_id AND je.is_posted = true
      AND je.entry_date >= (CURRENT_DATE - INTERVAL '6 months')
      AND at.classification IN ('income', 'expenses')
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'month', to_char(m.month_start, 'YYYY-MM'),
      'label', to_char(m.month_start, 'Mon'),
      'revenue', ABS(COALESCE(md.revenue, 0)),
      'expenses', ABS(COALESCE(md.expenses, 0))
    ) ORDER BY m.month_start
  ), '[]'::jsonb)
  INTO v_monthly
  FROM months m
  LEFT JOIN monthly_data md ON md.month_start = m.month_start;

  -- Build result
  v_result := jsonb_build_object(
    'kpis', v_kpis,
    'journalStats', jsonb_build_object('total', v_journal_count, 'draft', v_draft_count, 'posted', v_posted_count),
    'trialBalance', v_trial_balance,
    'topAccounts', v_top_accounts,
    'alerts', v_alerts,
    'monthly', v_monthly
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
