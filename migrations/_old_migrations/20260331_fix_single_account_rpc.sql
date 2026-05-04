-- ════════════════════════════════════════════════════════════════
-- 🔧 FIX get_account_balance_fc (single account RPC)
-- ════════════════════════════════════════════════════════════════
-- PROBLEM: For mixed-currency accounts (like #35 "Opening Balances"),
--   this RPC sums FC amounts from different currencies → meaningless total.
--   Shows 262,950 USD instead of the correct $6,489.49
--
-- FIX: Same logic as get_all_account_balances_fc v3:
--   - Detect if account has entries in multiple currencies
--   - If mixed: return balance_base + detected base currency
--   - If single: return FC balance + account currency (as before)
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_account_balance_fc(
    p_account_id UUID,
    p_company_id UUID
)
RETURNS TABLE(
    total_debit NUMERIC,
    total_credit NUMERIC,
    balance NUMERIC,
    currency TEXT,
    transaction_count BIGINT,
    last_activity DATE
)
LANGUAGE sql
STABLE SECURITY DEFINER
AS $function$
WITH 
-- Account's DB currency
account_info AS (
    SELECT 
        coa.id,
        COALESCE(coa.currency, c.default_currency, 'USD') AS account_currency
    FROM chart_of_accounts coa
    LEFT JOIN companies c ON c.id = coa.company_id
    WHERE coa.id = p_account_id
      AND coa.company_id = p_company_id
),
-- Detect if this account has entries in multiple currencies
currency_check AS (
    SELECT 
        COUNT(DISTINCT jel.currency) AS num_currencies
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je
        ON je.id = jel.entry_id
       AND je.company_id = p_company_id
       AND je.is_posted = true
       AND je.status = 'posted'
    WHERE jel.account_id = p_account_id
      AND jel.currency IS NOT NULL
      AND jel.currency != ''
),
-- For mixed accounts: find the base currency (rate=1 when others have rate>1)
mixed_base AS (
    SELECT jel.currency AS base_currency
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je
        ON je.id = jel.entry_id
       AND je.company_id = p_company_id
       AND je.is_posted = true
       AND je.status = 'posted'
    WHERE jel.account_id = p_account_id
      AND jel.currency IS NOT NULL
      AND jel.currency != ''
      AND COALESCE(jel.exchange_rate, 1) = 1
    GROUP BY jel.currency
    ORDER BY COUNT(*) DESC
    LIMIT 1
),
-- Calculate line-level amounts
posted_lines AS (
    SELECT 
        CASE
            WHEN jel.debit_fc IS NOT NULL AND jel.debit_fc > 0 THEN jel.debit_fc
            WHEN COALESCE(jel.exchange_rate, 1) > 1 THEN jel.debit / jel.exchange_rate
            ELSE jel.debit
        END AS fc_debit,
        CASE
            WHEN jel.credit_fc IS NOT NULL AND jel.credit_fc > 0 THEN jel.credit_fc
            WHEN COALESCE(jel.exchange_rate, 1) > 1 THEN jel.credit / jel.exchange_rate
            ELSE jel.credit
        END AS fc_credit,
        jel.debit AS base_debit,
        jel.credit AS base_credit,
        je.entry_date
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je
        ON je.id = jel.entry_id
       AND je.company_id = p_company_id
       AND je.is_posted = true
       AND je.status = 'posted'
    WHERE jel.account_id = p_account_id
)
SELECT
    COALESCE(SUM(pl.fc_debit), 0)::NUMERIC AS total_debit,
    COALESCE(SUM(pl.fc_credit), 0)::NUMERIC AS total_credit,
    -- Mixed currencies: use balance_base (consistent)
    -- Single currency: use FC balance (native)
    CASE
        WHEN (SELECT num_currencies FROM currency_check) > 1 THEN
            (COALESCE(SUM(pl.base_debit), 0) - COALESCE(SUM(pl.base_credit), 0))::NUMERIC
        ELSE
            (COALESCE(SUM(pl.fc_debit), 0) - COALESCE(SUM(pl.fc_credit), 0))::NUMERIC
    END AS balance,
    -- Mixed currencies: use detected base currency
    -- Single currency: use account's DB currency
    CASE
        WHEN (SELECT num_currencies FROM currency_check) > 1 THEN
            COALESCE(
                (SELECT base_currency FROM mixed_base),
                (SELECT default_currency FROM companies WHERE id = p_company_id),
                'USD'
            )
        ELSE ai.account_currency
    END::TEXT AS currency,
    COUNT(*)::BIGINT AS transaction_count,
    MAX(pl.entry_date)::DATE AS last_activity
FROM account_info ai
LEFT JOIN posted_lines pl ON true
GROUP BY ai.account_currency;
$function$;
