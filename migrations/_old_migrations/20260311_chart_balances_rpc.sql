-- ════════════════════════════════════════════════════════════════
-- 📊 get_all_account_balances_fc
-- ════════════════════════════════════════════════════════════════
-- Returns balances for ALL accounts of a company.
-- Two balance types per account:
--   balance      = FC (native currency — for display)
--   balance_base = Base currency (always balanced — for totals)
-- ════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_all_account_balances_fc(uuid);

CREATE OR REPLACE FUNCTION public.get_all_account_balances_fc(
    p_company_id UUID
)
RETURNS TABLE(
    account_id UUID,
    total_debit NUMERIC,
    total_credit NUMERIC,
    balance NUMERIC,
    balance_base NUMERIC,
    currency TEXT,
    transaction_count BIGINT,
    last_activity DATE
)
LANGUAGE sql
STABLE SECURITY DEFINER
AS $function$
WITH account_currencies AS (
    SELECT
        coa.id AS account_id,
        COALESCE(coa.currency, c.default_currency, 'USD') AS account_currency
    FROM chart_of_accounts coa
    LEFT JOIN companies c ON c.id = coa.company_id
    WHERE coa.company_id = p_company_id
      AND coa.is_group = false
),
posted_lines AS (
    SELECT
        jel.account_id,
        -- FC amounts (native currency)
        CASE
            WHEN jel.debit_fc IS NOT NULL AND (jel.debit_fc > 0 OR jel.debit = 0) THEN jel.debit_fc
            WHEN COALESCE(jel.exchange_rate, 1) > 1 THEN jel.debit / jel.exchange_rate
            ELSE jel.debit
        END AS fc_debit,
        CASE
            WHEN jel.credit_fc IS NOT NULL AND (jel.credit_fc > 0 OR jel.credit = 0) THEN jel.credit_fc
            WHEN COALESCE(jel.exchange_rate, 1) > 1 THEN jel.credit / jel.exchange_rate
            ELSE jel.credit
        END AS fc_credit,
        -- Base currency amounts (always balanced!)
        jel.debit AS base_debit,
        jel.credit AS base_credit,
        je.entry_date
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je
        ON je.id = jel.entry_id
       AND je.company_id = p_company_id
       AND je.is_posted = true
       AND je.status = 'posted'
)
SELECT
    ac.account_id::UUID,
    COALESCE(SUM(pl.fc_debit), 0)::NUMERIC AS total_debit,
    COALESCE(SUM(pl.fc_credit), 0)::NUMERIC AS total_credit,
    (COALESCE(SUM(pl.fc_debit), 0) - COALESCE(SUM(pl.fc_credit), 0))::NUMERIC AS balance,
    (COALESCE(SUM(pl.base_debit), 0) - COALESCE(SUM(pl.base_credit), 0))::NUMERIC AS balance_base,
    ac.account_currency::TEXT AS currency,
    COUNT(pl.fc_debit)::BIGINT AS transaction_count,
    MAX(pl.entry_date)::DATE AS last_activity
FROM account_currencies ac
LEFT JOIN posted_lines pl ON pl.account_id = ac.account_id
GROUP BY ac.account_id, ac.account_currency;
$function$;


-- ════════════════════════════════════════════════════════════════
-- ⚖️ get_trial_balance_base
-- ════════════════════════════════════════════════════════════════
-- Returns aggregate debit/credit totals in BASE CURRENCY.
-- Guaranteed 100% balanced (debit = credit) because each journal
-- entry is validated as balanced before posting.
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_trial_balance_base(p_company_id UUID)
RETURNS TABLE(
    total_debit NUMERIC,
    total_credit NUMERIC,
    balance_diff NUMERIC,
    is_balanced BOOLEAN,
    base_currency TEXT,
    accounts_count BIGINT,
    entries_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $tb$
SELECT
    COALESCE(SUM(jel.debit), 0)::NUMERIC AS total_debit,
    COALESCE(SUM(jel.credit), 0)::NUMERIC AS total_credit,
    ABS(COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0))::NUMERIC AS balance_diff,
    (ABS(COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0)) < 0.01)::BOOLEAN AS is_balanced,
    COALESCE(c.default_currency, 'USD')::TEXT AS base_currency,
    COUNT(DISTINCT jel.account_id)::BIGINT AS accounts_count,
    COUNT(DISTINCT jel.entry_id)::BIGINT AS entries_count
FROM journal_entry_lines jel
INNER JOIN journal_entries je
    ON je.id = jel.entry_id
   AND je.company_id = p_company_id
   AND je.is_posted = true
   AND je.status = 'posted'
CROSS JOIN (SELECT default_currency FROM companies WHERE id = p_company_id) c
GROUP BY c.default_currency;
$tb$;
