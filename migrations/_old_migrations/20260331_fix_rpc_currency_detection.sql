-- ════════════════════════════════════════════════════════════════
-- 📊 get_all_account_balances_fc — FINAL FIX (v3)
-- ════════════════════════════════════════════════════════════════
--
-- PROBLEM: Accounts with entries in MULTIPLE currencies (e.g., USD + UAH)
--   have meaningless FC balance (sums different currencies).
--   Example: account 35 "Opening Balances" has USD and UAH entries
--   FC = 510 USD + 262,440 UAH = 262,950 ← NONSENSE!
--
-- FIX: For mixed-currency accounts:
--   → Use balance_base (always consistent — all amounts converted to base)
--   → Detect the REAL base currency from exchange rates:
--     Entries with rate > 1 are FOREIGN currency
--     Entries with rate = 1 are BASE currency (e.g., UAH)
--   → Return balance_base labeled with the detected base currency
--
-- For single-currency accounts:
--   → Use FC balance + account currency (correct as-is)
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
WITH
-- Step 1: Get account currencies from chart_of_accounts
account_currencies_raw AS (
    SELECT
        coa.id AS account_id,
        coa.currency AS db_currency
    FROM chart_of_accounts coa
    WHERE coa.company_id = p_company_id
      AND coa.is_group = false
),
-- Step 2: Detect actual currency from journal lines (for NULL db_currency)
line_currencies AS (
    SELECT DISTINCT ON (jel.account_id)
        jel.account_id,
        jel.currency AS line_currency
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je
        ON je.id = jel.entry_id
       AND je.company_id = p_company_id
       AND je.is_posted = true
       AND je.status = 'posted'
    WHERE jel.currency IS NOT NULL AND jel.currency != ''
    GROUP BY jel.account_id, jel.currency
    ORDER BY jel.account_id, COUNT(*) DESC
),
-- Step 3: Detect mixed-currency accounts
-- An account is "mixed" if journal lines have > 1 distinct currency
mixed_currency_accounts AS (
    SELECT jel.account_id,
           COUNT(DISTINCT jel.currency) AS num_currencies
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je
        ON je.id = jel.entry_id
       AND je.company_id = p_company_id
       AND je.is_posted = true
       AND je.status = 'posted'
    WHERE jel.currency IS NOT NULL AND jel.currency != ''
    GROUP BY jel.account_id
    HAVING COUNT(DISTINCT jel.currency) > 1
),
-- Step 4: For mixed-currency accounts, find the BASE currency
-- The base currency = currency of entries with exchange_rate = 1
-- when other entries have exchange_rate > 1
-- (e.g., UAH entries with rate=1 + USD entries with rate=43.89 → base=UAH)
mixed_base_currency AS (
    SELECT DISTINCT ON (jel.account_id)
        jel.account_id,
        jel.currency AS base_currency
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je
        ON je.id = jel.entry_id
       AND je.company_id = p_company_id
       AND je.is_posted = true
       AND je.status = 'posted'
    INNER JOIN mixed_currency_accounts mca ON mca.account_id = jel.account_id
    WHERE jel.currency IS NOT NULL
      AND jel.currency != ''
      AND COALESCE(jel.exchange_rate, 1) = 1
    GROUP BY jel.account_id, jel.currency
    ORDER BY jel.account_id, COUNT(*) DESC
),
-- Step 5: Merge currencies
account_currencies AS (
    SELECT
        acr.account_id,
        CASE
            -- Mixed currencies: use detected base currency
            WHEN mca.account_id IS NOT NULL
            THEN COALESCE(mbc.base_currency,
                         (SELECT default_currency FROM companies WHERE id = p_company_id),
                         'USD')
            -- Single currency: use DB or line currency
            ELSE COALESCE(
                NULLIF(acr.db_currency, ''),
                lc.line_currency,
                (SELECT default_currency FROM companies WHERE id = p_company_id),
                'USD'
            )
        END AS account_currency,
        (mca.account_id IS NOT NULL) AS is_mixed_currency
    FROM account_currencies_raw acr
    LEFT JOIN line_currencies lc ON lc.account_id = acr.account_id
    LEFT JOIN mixed_currency_accounts mca ON mca.account_id = acr.account_id
    LEFT JOIN mixed_base_currency mbc ON mbc.account_id = acr.account_id
),
-- Step 6: Calculate balances
posted_lines AS (
    SELECT
        jel.account_id,
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
)
SELECT
    ac.account_id::UUID,
    COALESCE(SUM(pl.fc_debit), 0)::NUMERIC AS total_debit,
    COALESCE(SUM(pl.fc_credit), 0)::NUMERIC AS total_credit,
    -- For mixed-currency accounts: use balance_base (consistent currency)
    -- For single-currency accounts: use FC balance (native currency)
    CASE
        WHEN ac.is_mixed_currency THEN
            (COALESCE(SUM(pl.base_debit), 0) - COALESCE(SUM(pl.base_credit), 0))::NUMERIC
        ELSE
            (COALESCE(SUM(pl.fc_debit), 0) - COALESCE(SUM(pl.fc_credit), 0))::NUMERIC
    END AS balance,
    (COALESCE(SUM(pl.base_debit), 0) - COALESCE(SUM(pl.base_credit), 0))::NUMERIC AS balance_base,
    ac.account_currency::TEXT AS currency,
    COUNT(pl.fc_debit)::BIGINT AS transaction_count,
    MAX(pl.entry_date)::DATE AS last_activity
FROM account_currencies ac
LEFT JOIN posted_lines pl ON pl.account_id = ac.account_id
GROUP BY ac.account_id, ac.account_currency, ac.is_mixed_currency;
$function$;
