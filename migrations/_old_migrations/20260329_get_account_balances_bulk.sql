-- ═══════════════════════════════════════════════════════════════
-- RPC: get_account_balances_bulk (v2 — Smart FC Recovery)
-- ═══════════════════════════════════════════════════════════════
-- حساب أرصدة جميع الحسابات من journal_entry_lines المرحّلة
-- يستخدم Smart FC Recovery: إذا debit_fc = 0 و debit > 0
-- وسعر الصرف > 1، يحسب debit / exchange_rate
-- ═══════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_account_balances_bulk(UUID);

CREATE OR REPLACE FUNCTION get_account_balances_bulk(
    p_company_id UUID
)
RETURNS TABLE (
    account_id UUID,
    balance DOUBLE PRECISION,
    balance_fc DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT
        jel.account_id,
        -- Base currency balance (debit - credit)
        ROUND(COALESCE(SUM(jel.debit - jel.credit), 0)::numeric, 2)::double precision AS balance,
        -- FC balance with Smart Recovery:
        -- If debit_fc > 0 or debit = 0 → use debit_fc
        -- Else if exchange_rate > 1 → use debit / exchange_rate
        -- Else → use debit as-is (same currency)
        ROUND(COALESCE(SUM(
            CASE
                WHEN COALESCE(jel.debit_fc, 0) > 0 OR COALESCE(jel.debit, 0) = 0
                    THEN COALESCE(jel.debit_fc, 0)
                WHEN COALESCE(jel.exchange_rate, 1) > 1
                    THEN jel.debit / jel.exchange_rate
                ELSE jel.debit
            END
            -
            CASE
                WHEN COALESCE(jel.credit_fc, 0) > 0 OR COALESCE(jel.credit, 0) = 0
                    THEN COALESCE(jel.credit_fc, 0)
                WHEN COALESCE(jel.exchange_rate, 1) > 1
                    THEN jel.credit / jel.exchange_rate
                ELSE jel.credit
            END
        ), 0)::numeric, 2)::double precision AS balance_fc
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je ON jel.entry_id = je.id
    WHERE je.company_id = p_company_id
      AND je.is_posted = true
    GROUP BY jel.account_id;
END;
$$;

-- Grant access
GRANT EXECUTE ON FUNCTION get_account_balances_bulk(UUID) TO authenticated;
