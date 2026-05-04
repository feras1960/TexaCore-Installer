-- ════════════════════════════════════════════════════════════════
-- 🏛️ Unified Accounting Engine — Backend RPCs
-- ════════════════════════════════════════════════════════════════
-- Date: 2026-03-11
-- Purpose: Centralize ALL financial calculations in Backend RPCs
--          Frontend displays ONLY — never computes balances.
--
-- Smart FC Recovery Logic (unified across all RPCs):
--   1) If debit_fc > 0 → use debit_fc (native currency amount)
--   2) If exchange_rate > 1 → debit / exchange_rate (recover FC)
--   3) Else → use debit directly (same currency)
-- ════════════════════════════════════════════════════════════════

-- ─── 1. get_account_balance_fc ─────────────────────────────────
-- Returns balance for ANY account in its native currency.
-- Used by: UnifiedAccountingSheet, OverviewTab, any balance display.

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
WITH account_info AS (
    SELECT 
        coa.id,
        COALESCE(coa.currency, c.default_currency, 'USD') AS account_currency
    FROM chart_of_accounts coa
    LEFT JOIN companies c ON c.id = coa.company_id
    WHERE coa.id = p_account_id
      AND coa.company_id = p_company_id
),
posted_lines AS (
    SELECT 
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
    (COALESCE(SUM(pl.fc_debit), 0) - COALESCE(SUM(pl.fc_credit), 0))::NUMERIC AS balance,
    ai.account_currency::TEXT AS currency,
    COUNT(*)::BIGINT AS transaction_count,
    MAX(pl.entry_date)::DATE AS last_activity
FROM account_info ai
LEFT JOIN posted_lines pl ON true
GROUP BY ai.account_currency;
$function$;


-- ─── 2. get_account_ledger_fc ──────────────────────────────────
-- Returns full ledger with running balance for any account.
-- Used by: LedgerTab, party statements.

CREATE OR REPLACE FUNCTION public.get_account_ledger_fc(
    p_account_id UUID,
    p_company_id UUID,
    p_from_date DATE DEFAULT NULL,
    p_to_date DATE DEFAULT NULL
)
RETURNS TABLE(
    line_id UUID,
    entry_id UUID,
    entry_number TEXT,
    entry_date DATE,
    description TEXT,
    debit NUMERIC,
    credit NUMERIC,
    running_balance NUMERIC,
    currency TEXT,
    original_currency TEXT,
    exchange_rate NUMERIC,
    entry_type TEXT,
    status TEXT
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
AS $function$
DECLARE
    v_running_balance NUMERIC := 0;
    v_record RECORD;
BEGIN
    FOR v_record IN
        SELECT
            jel.id AS line_id,
            je.id AS entry_id,
            je.entry_number,
            je.entry_date,
            COALESCE(jel.description, je.description, '') AS description,
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
            jel.currency AS original_currency,
            COALESCE(jel.exchange_rate, 1) AS exchange_rate,
            je.entry_type,
            je.status
        FROM journal_entry_lines jel
        INNER JOIN journal_entries je
            ON je.id = jel.entry_id
           AND je.company_id = p_company_id
           AND je.is_posted = true
           AND je.status = 'posted'
        WHERE jel.account_id = p_account_id
          AND (p_from_date IS NULL OR je.entry_date >= p_from_date)
          AND (p_to_date IS NULL OR je.entry_date <= p_to_date)
        ORDER BY je.entry_date ASC, je.entry_number ASC, jel.line_number ASC
    LOOP
        v_running_balance := v_running_balance + v_record.fc_debit - v_record.fc_credit;
        
        line_id := v_record.line_id;
        entry_id := v_record.entry_id;
        entry_number := v_record.entry_number;
        entry_date := v_record.entry_date;
        description := v_record.description;
        debit := ROUND(v_record.fc_debit, 2);
        credit := ROUND(v_record.fc_credit, 2);
        running_balance := ROUND(v_running_balance, 2);
        currency := v_record.original_currency;
        original_currency := v_record.original_currency;
        exchange_rate := v_record.exchange_rate;
        entry_type := v_record.entry_type;
        status := v_record.status;
        
        RETURN NEXT;
    END LOOP;
END;
$function$;


-- ─── 3. get_party_balances_bulk (UPDATED) ──────────────────────
-- Returns balances for ALL suppliers/customers in native currency.
-- Used by: Parties.tsx

CREATE OR REPLACE FUNCTION public.get_party_balances_bulk(p_company_id uuid, p_party_type text)
 RETURNS TABLE(party_id uuid, total_debit numeric, total_credit numeric, balance numeric, transaction_count bigint, last_transaction_date date)
 LANGUAGE sql
 STABLE SECURITY DEFINER
AS $function$
WITH party_accounts AS (
    SELECT id AS party_id, payable_account_id AS account_id
    FROM suppliers
    WHERE company_id = p_company_id
      AND p_party_type = 'supplier'
      AND payable_account_id IS NOT NULL
    UNION ALL
    SELECT id AS party_id, receivable_account_id AS account_id
    FROM customers
    WHERE company_id = p_company_id
      AND p_party_type = 'customer'
      AND receivable_account_id IS NOT NULL
),
posted_lines AS (
    SELECT jel.account_id,
           CASE
               WHEN jel.debit_fc IS NOT NULL AND (jel.debit_fc > 0 OR jel.debit = 0) THEN jel.debit_fc
               WHEN COALESCE(jel.exchange_rate, 1) > 1 THEN jel.debit / jel.exchange_rate
               ELSE jel.debit
           END AS debit,
           CASE
               WHEN jel.credit_fc IS NOT NULL AND (jel.credit_fc > 0 OR jel.credit = 0) THEN jel.credit_fc
               WHEN COALESCE(jel.exchange_rate, 1) > 1 THEN jel.credit / jel.exchange_rate
               ELSE jel.credit
           END AS credit,
           je.entry_date
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je
        ON je.id       = jel.entry_id
       AND je.company_id = p_company_id
       AND je.is_posted  = true
       AND je.status     = 'posted'
)
SELECT
    pa.party_id::UUID,
    COALESCE(SUM(pl.debit),  0)::NUMERIC AS total_debit,
    COALESCE(SUM(pl.credit), 0)::NUMERIC AS total_credit,
    CASE
        WHEN p_party_type = 'supplier'
            THEN (COALESCE(SUM(pl.credit), 0) - COALESCE(SUM(pl.debit), 0))::NUMERIC
        ELSE
            (COALESCE(SUM(pl.debit), 0) - COALESCE(SUM(pl.credit), 0))::NUMERIC
    END AS balance,
    COUNT(pl.debit)::BIGINT      AS transaction_count,
    MAX(pl.entry_date)::DATE     AS last_transaction_date
FROM party_accounts pa
LEFT JOIN posted_lines pl ON pl.account_id = pa.account_id
GROUP BY pa.party_id;
$function$;
