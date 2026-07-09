-- ════════════════════════════════════════════════════════════════════════
-- 20260707b — TexaCore Console (round 5): ledger enrichment, dashboard charts,
--             cost centers, party open-docs, enriched payments + journal voucher
-- ────────────────────────────────────────────────────────────────────────
-- Conventions (identical to 20260706a/b/c, 20260707a):
--   • SECURITY DEFINER, SET search_path = public, pg_temp on every function.
--   • Read functions return {ok:false, error:'forbidden'} on gate failure;
--     write functions RAISE.
--   • assert_can_access_company(company) is the tenant guard everywhere.
--   • Gates reuse the LIVE helpers from 20260706a:
--       console_has_perm / console_is_admin / console_special / console_has_role
--       console_scope_cash_accounts / console_scope_warehouses
--   • REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated (loop, tail).
--   • BEGIN/COMMIT transaction; contract-summary comment at the very end.
--
-- LIVE-DB REALITY used here (verified 2026-07-07 against the live database, which
-- diverges from some migration files — trust these):
--   • journal_entry_lines HAS: cost_center_id, party_type, party_id,
--     reference_type, reference_id, is_fund_line, debit_fc, credit_fc,
--     exchange_rate, currency, account_id, debit, credit, line_number,
--     description, entry_id.
--   • journal_entries HAS: reference_type, reference_id, entry_type, is_posted,
--     entry_number, entry_date, description, company_id, tenant_id, currency,
--     total_debit, total_credit, status, branch_id, created_by, fiscal_year_id.
--   • je.reference_type values on posted entries: 'payment_receipt',
--     'sales_invoice', 'import', NULL.
--   • payment_receipts has sales_transaction_id (trigger
--     sync_sales_invoice_paid_from_receipts keeps sales_transactions.paid_amount
--     in sync when status='confirmed'); NO cost_center_id column.
--   • payment_vouchers has purchase_transaction_id; NO paid-sync trigger exists
--     on the purchase side (link is stored for reference only).
--   • Open-doc balances live in *_transactions (total_amount, paid_amount,
--     is_posted, stage, invoice_no / supplier_invoice_number, due_date);
--     sales_invoices/purchase_invoices tables are EMPTY.
--   • Dashboard fns:
--       get_accounting_dashboard(company, base_currency, from, to)
--         -> .monthly[] = [{month,label,revenue,expenses}] (6 months)
--       get_dashboard_cash_flow(company, base_currency, days)
--         -> [{date,income,expense}]
--       get_confirmation_counts(company) -> TABLE(item_type text, cnt bigint)
--   • Voucher/receipt JE triggers build a balanced 2-line JE and call
--     post_journal_entry(entry_id, user_id) when status='confirmed'. The web
--     Journal-Voucher path marks the cash/bank line is_fund_line=true and puts
--     cost_center_id / party_type / party_id / reference_type / reference_id on
--     the counterparty line. entry_type used by the web is 'receipt'/'payment';
--     the console voucher (§F) is a distinct, source-doc-less path so it uses
--     entry_type='journal_voucher' (mapped by get_console_item_details to the
--     'journal_entry' fallback preview, since reference_type is not one of the
--     recognized document types).
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- A) LEDGER ENRICHMENT — get_console_account_ledger + get_party_statement
--    • Default range becomes month-to-date: p_from => date_trunc('month',
--      CURRENT_DATE)::date; p_to => CURRENT_DATE. Opening balance is still the
--      signed sum strictly BEFORE p_from.
--    • Each line gains entry_id (je.id), source_type, source_id — additive; all
--      existing keys are preserved. source_type is one of the values accepted by
--      get_console_item_details. Mapping (je.reference_type -> source_type):
--        payment_receipt                   -> payment_receipt
--        payment_voucher                   -> payment_voucher
--        sales_invoice | sales_transaction -> sales_invoice
--        purchase_invoice | purchase_transaction -> purchase_invoice
--        stock_transfer                    -> stock_transfer
--        else / NULL / 'import'            -> journal_entry  (source_id = je.id)
--      When mapped (non-fallback) source_id = je.reference_id; fallback uses je.id.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_account_ledger(
    p_company_id uuid, p_account_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_ok boolean;
    v_from date := COALESCE(p_from, date_trunc('month', CURRENT_DATE)::date);
    v_to   date := COALESCE(p_to, CURRENT_DATE);
    v_currency text := '';
    v_acct_company uuid; v_code text; v_name text; v_is_bank boolean; v_kind text;
    v_normal text; v_sign int; v_opening_col numeric := 0;
    v_opening numeric := 0; v_lines jsonb; v_closing numeric;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    v_ok := v_admin OR public.console_has_perm(v_user,'accounting','read')
                    OR public.console_has_perm(v_user,'treasury','read');
    IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

    SELECT a.company_id, a.account_code,
           COALESCE(NULLIF(a.name_ar,''), NULLIF(a.name_en,''), a.account_code),
           COALESCE(a.is_bank_account,false),
           CASE WHEN COALESCE(a.is_cash_account,false) OR COALESCE(a.is_bank_account,false) THEN 'cash'
                WHEN COALESCE(a.is_receivable,false) THEN 'receivable'
                WHEN COALESCE(a.is_payable,false) THEN 'payable' ELSE '' END,
           COALESCE(at.normal_balance,'debit'),
           COALESCE(a.opening_balance,0)
      INTO v_acct_company, v_code, v_name, v_is_bank, v_kind, v_normal, v_opening_col
      FROM chart_of_accounts a
      LEFT JOIN account_types at ON at.id = a.account_type_id
      WHERE a.id = p_account_id;

    IF v_acct_company IS NULL OR v_acct_company <> p_company_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    v_sign := CASE WHEN v_normal = 'credit' THEN -1 ELSE 1 END;
    BEGIN SELECT COALESCE(default_currency,'') INTO v_currency FROM companies WHERE id = p_company_id; EXCEPTION WHEN OTHERS THEN v_currency := ''; END;

    -- opening: account's own opening_balance + signed posted movement before from
    SELECT v_opening_col + round(COALESCE(SUM(v_sign * (jel.debit - jel.credit)),0),2)
      INTO v_opening
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE jel.account_id = p_account_id
        AND je.company_id = p_company_id AND COALESCE(je.is_posted,false) = true
        AND je.entry_date < v_from;
    v_opening := round(COALESCE(v_opening,0),2);

    SELECT jsonb_agg(row_to_json(x) ORDER BY x.ord) INTO v_lines FROM (
        SELECT
            s.ord,
            s.entry_date AS date,
            s.entry_number,
            s.descr AS description,
            s.party_name,
            s.debit, s.credit,
            round(v_opening + SUM(v_sign*(s.debit - s.credit)) OVER (ORDER BY s.ord ROWS UNBOUNDED PRECEDING), 2) AS running_balance,
            s.entry_id,
            s.source_type,
            s.source_id
        FROM (
            SELECT
                row_number() OVER (ORDER BY je.entry_date ASC, je.entry_number ASC, jel.line_number ASC) AS ord,
                (je.entry_date::date) AS entry_date,
                COALESCE(je.entry_number,'') AS entry_number,
                COALESCE(NULLIF(jel.description,''), NULLIF(je.description,''), '') AS descr,
                CASE
                    WHEN jel.party_type = 'customer' THEN COALESCE((SELECT NULLIF(cu.name_ar,'') FROM customers cu WHERE cu.id = jel.party_id),
                                                                    (SELECT cu.name_en FROM customers cu WHERE cu.id = jel.party_id), '')
                    WHEN jel.party_type = 'supplier' THEN COALESCE((SELECT NULLIF(su.name_ar,'') FROM suppliers su WHERE su.id = jel.party_id),
                                                                    (SELECT su.name_en FROM suppliers su WHERE su.id = jel.party_id), '')
                    ELSE ''
                END AS party_name,
                round(COALESCE(jel.debit,0),2) AS debit,
                round(COALESCE(jel.credit,0),2) AS credit,
                je.id AS entry_id,
                -- source_type: mapped je.reference_type -> item-details type; else 'journal_entry'
                CASE je.reference_type
                    WHEN 'payment_receipt'      THEN 'payment_receipt'
                    WHEN 'payment_voucher'      THEN 'payment_voucher'
                    WHEN 'sales_invoice'        THEN 'sales_invoice'
                    WHEN 'sales_transaction'    THEN 'sales_invoice'
                    WHEN 'purchase_invoice'     THEN 'purchase_invoice'
                    WHEN 'purchase_transaction' THEN 'purchase_invoice'
                    WHEN 'stock_transfer'       THEN 'stock_transfer'
                    ELSE 'journal_entry'
                END AS source_type,
                -- source_id: mapped reference_id (when a real doc & reference_id present), else je.id
                CASE
                    WHEN je.reference_type IN ('payment_receipt','payment_voucher','sales_invoice',
                                               'sales_transaction','purchase_invoice','purchase_transaction',
                                               'stock_transfer')
                         AND je.reference_id IS NOT NULL
                    THEN je.reference_id
                    ELSE je.id
                END AS source_id
            FROM journal_entry_lines jel
            JOIN journal_entries je ON je.id = jel.entry_id
            WHERE jel.account_id = p_account_id
              AND je.company_id = p_company_id AND COALESCE(je.is_posted,false) = true
              AND je.entry_date >= v_from AND je.entry_date <= v_to
        ) s
    ) x;

    SELECT round(v_opening + COALESCE(SUM(v_sign*((l->>'debit')::numeric - (l->>'credit')::numeric)),0),2)
      INTO v_closing
      FROM jsonb_array_elements(COALESCE(v_lines,'[]'::jsonb)) l;

    RETURN jsonb_build_object(
        'ok', true,
        'account', jsonb_build_object('id', p_account_id, 'code', v_code, 'name', v_name,
                                      'is_bank', v_is_bank, 'kind', v_kind),
        'currency', v_currency,
        'from', v_from, 'to', v_to,
        'opening_balance', v_opening,
        'lines', COALESCE(v_lines, '[]'::jsonb),
        'closing_balance', COALESCE(v_closing, v_opening)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_party_statement(
    p_company_id uuid, p_party_type text, p_party_id uuid,
    p_from date DEFAULT NULL, p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_ok boolean := false;
    v_from date := COALESCE(p_from, date_trunc('month', CURRENT_DATE)::date);
    v_to   date := COALESCE(p_to, CURRENT_DATE);
    v_currency text := '';
    v_party jsonb;
    v_name text; v_code text; v_phone text; v_bal numeric; v_credit numeric;
    v_opening numeric := 0;
    v_sign int;            -- +1 customer (debit-credit), -1 supplier (credit-debit)
    v_lines jsonb;
    v_closing numeric;
    v_exists boolean;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    IF p_party_type = 'customer' THEN
        v_ok := v_admin OR public.console_has_perm(v_user,'sales','read')
                        OR public.console_has_perm(v_user,'crm','read')
                        OR public.console_has_perm(v_user,'customers','read')
                        OR public.console_has_perm(v_user,'accounting','read');
        v_sign := 1;
        SELECT true, COALESCE(NULLIF(name_ar,''), NULLIF(company_name,''), NULLIF(name_en,''), ''),
               COALESCE(code,''), COALESCE(NULLIF(phone,''), NULLIF(mobile,''), ''),
               round(COALESCE(balance,0),2), round(COALESCE(credit_limit,0),2)
          INTO v_exists, v_name, v_code, v_phone, v_bal, v_credit
          FROM customers WHERE id = p_party_id AND company_id = p_company_id;
    ELSIF p_party_type = 'supplier' THEN
        v_ok := v_admin OR public.console_has_perm(v_user,'purchases','read')
                        OR public.console_has_perm(v_user,'suppliers','read')
                        OR public.console_has_perm(v_user,'accounting','read');
        v_sign := -1;
        SELECT true, COALESCE(NULLIF(name_ar,''), NULLIF(name_en,''), ''),
               COALESCE(code,''), COALESCE(NULLIF(phone,''), NULLIF(mobile,''), ''),
               round(COALESCE(balance,0),2), 0::numeric
          INTO v_exists, v_name, v_code, v_phone, v_bal, v_credit
          FROM suppliers WHERE id = p_party_id AND company_id = p_company_id;
    ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'bad_type');
    END IF;

    IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;
    IF NOT COALESCE(v_exists,false) THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

    BEGIN SELECT COALESCE(default_currency,'') INTO v_currency FROM companies WHERE id = p_company_id; EXCEPTION WHEN OTHERS THEN v_currency := ''; END;

    -- opening balance: signed sum of posted lines strictly before v_from
    SELECT round(COALESCE(SUM(v_sign * (jel.debit - jel.credit)),0),2) INTO v_opening
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      WHERE jel.party_type = p_party_type AND jel.party_id = p_party_id
        AND je.company_id = p_company_id AND COALESCE(je.is_posted,false) = true
        AND je.entry_date < v_from;

    -- lines within [from, to] with running balance (ordinal-driven, no composite ORDER BY)
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.ord) INTO v_lines FROM (
        SELECT
            s.ord,
            s.entry_date AS date,
            s.entry_number,
            s.descr AS description,
            s.debit, s.credit,
            round(v_opening + SUM(v_sign*(s.debit - s.credit)) OVER (ORDER BY s.ord ROWS UNBOUNDED PRECEDING), 2) AS running_balance,
            s.entry_id,
            s.source_type,
            s.source_id
        FROM (
            SELECT
                row_number() OVER (ORDER BY je.entry_date ASC, je.entry_number ASC, jel.line_number ASC) AS ord,
                (je.entry_date::date) AS entry_date,
                COALESCE(je.entry_number,'') AS entry_number,
                COALESCE(NULLIF(jel.description,''), NULLIF(je.description,''), '') AS descr,
                round(COALESCE(jel.debit,0),2) AS debit,
                round(COALESCE(jel.credit,0),2) AS credit,
                je.id AS entry_id,
                CASE je.reference_type
                    WHEN 'payment_receipt'      THEN 'payment_receipt'
                    WHEN 'payment_voucher'      THEN 'payment_voucher'
                    WHEN 'sales_invoice'        THEN 'sales_invoice'
                    WHEN 'sales_transaction'    THEN 'sales_invoice'
                    WHEN 'purchase_invoice'     THEN 'purchase_invoice'
                    WHEN 'purchase_transaction' THEN 'purchase_invoice'
                    WHEN 'stock_transfer'       THEN 'stock_transfer'
                    ELSE 'journal_entry'
                END AS source_type,
                CASE
                    WHEN je.reference_type IN ('payment_receipt','payment_voucher','sales_invoice',
                                               'sales_transaction','purchase_invoice','purchase_transaction',
                                               'stock_transfer')
                         AND je.reference_id IS NOT NULL
                    THEN je.reference_id
                    ELSE je.id
                END AS source_id
            FROM journal_entry_lines jel
            JOIN journal_entries je ON je.id = jel.entry_id
            WHERE jel.party_type = p_party_type AND jel.party_id = p_party_id
              AND je.company_id = p_company_id AND COALESCE(je.is_posted,false) = true
              AND je.entry_date >= v_from AND je.entry_date <= v_to
        ) s
    ) x;

    -- closing = opening + signed net within range
    SELECT round(v_opening + COALESCE(SUM(v_sign*((l->>'debit')::numeric - (l->>'credit')::numeric)),0),2)
      INTO v_closing
      FROM jsonb_array_elements(COALESCE(v_lines,'[]'::jsonb)) l;

    v_party := jsonb_build_object('id', p_party_id, 'name', v_name, 'code', v_code,
                                  'phone', v_phone, 'balance', v_bal, 'credit_limit', v_credit);

    RETURN jsonb_build_object(
        'ok', true, 'party', v_party, 'currency', v_currency,
        'from', v_from, 'to', v_to,
        'opening_balance', v_opening,
        'lines', COALESCE(v_lines, '[]'::jsonb),
        'closing_balance', COALESCE(v_closing, v_opening)
    );
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- B) get_console_dashboard_charts(company) — one call for the home charts.
--    Sections are role-gated and OMITTED (key absent) when not permitted.
--      revenue_expense : 6 months, gate = accounting|treasury read OR admin
--                        (source: get_accounting_dashboard(...).monthly)
--      cash_flow       : 30 days, same gate
--                        (source: get_dashboard_cash_flow(...))
--      pending_by_type : approver gate = admin | can_approve_transactions |
--                        accounting write  (source: get_confirmation_counts)
--      sales_daily     : last 14 days from sales_transactions.created_at, stage
--                        NOT IN (draft,quotation,cancelled); own-docs rule for a
--                        non-admin without can_view_all_branches. Gate = sales read.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_dashboard_charts(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean;
    v_currency text := '';
    v_g_finance boolean; v_g_approvals boolean; v_g_sales boolean;
    v_all_branches boolean; v_only_own boolean;
    v_result jsonb := jsonb_build_object('ok', true);
    v_acc jsonb; v_monthly jsonb; v_cash jsonb;
    v_pending jsonb; v_sales_daily jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    v_g_finance := v_admin OR public.console_has_perm(v_user,'accounting','read')
                            OR public.console_has_perm(v_user,'treasury','read');
    v_g_approvals := v_admin OR public.console_special(v_user,'can_approve_transactions')
                             OR public.console_has_perm(v_user,'accounting','write');
    v_g_sales := v_admin OR public.console_has_perm(v_user,'sales','read');
    v_all_branches := v_admin OR public.console_special(v_user, 'can_view_all_branches');
    v_only_own := NOT v_all_branches;

    BEGIN SELECT COALESCE(NULLIF(default_currency,''),'USD') INTO v_currency FROM companies WHERE id = p_company_id;
    EXCEPTION WHEN OTHERS THEN v_currency := 'USD'; END;

    -- ── revenue_expense (6mo) + cash_flow (30d): finance gate ──
    IF v_g_finance THEN
        BEGIN
            v_acc := public.get_accounting_dashboard(p_company_id, v_currency, NULL, NULL);
            v_monthly := COALESCE(v_acc->'monthly', '[]'::jsonb);
        EXCEPTION WHEN OTHERS THEN v_monthly := '[]'::jsonb; END;
        v_result := v_result || jsonb_build_object('revenue_expense', v_monthly);

        BEGIN
            v_cash := public.get_dashboard_cash_flow(p_company_id, v_currency, 30);
        EXCEPTION WHEN OTHERS THEN v_cash := '[]'::jsonb; END;
        v_result := v_result || jsonb_build_object('cash_flow', COALESCE(v_cash,'[]'::jsonb));
    END IF;

    -- ── pending_by_type: approver gate ──
    IF v_g_approvals THEN
        BEGIN
            SELECT COALESCE(jsonb_agg(jsonb_build_object('item_type', c.item_type, 'cnt', c.cnt)), '[]'::jsonb)
              INTO v_pending
              FROM get_confirmation_counts(p_company_id) c;
        EXCEPTION WHEN OTHERS THEN v_pending := '[]'::jsonb; END;
        v_result := v_result || jsonb_build_object('pending_by_type', COALESCE(v_pending,'[]'::jsonb));
    END IF;

    -- ── sales_daily (14d): sales read gate; own-docs rule for scoped users ──
    IF v_g_sales THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d.day, 'total', COALESCE(g.total,0)) ORDER BY d.day), '[]'::jsonb)
          INTO v_sales_daily
          FROM (
              SELECT generate_series(CURRENT_DATE - 13, CURRENT_DATE, '1 day'::interval)::date AS day
          ) d
          LEFT JOIN (
              SELECT (st.created_at AT TIME ZONE 'UTC')::date AS day, round(SUM(COALESCE(st.total_amount,0)),2) AS total
              FROM sales_transactions st
              WHERE st.company_id = p_company_id
                AND st.created_at >= (CURRENT_DATE - 13)
                AND COALESCE(st.stage,'') NOT IN ('draft','quotation','cancelled')
                AND (NOT v_only_own OR st.created_by = v_user)
              GROUP BY 1
          ) g ON g.day = d.day;
        v_result := v_result || jsonb_build_object('sales_daily', COALESCE(v_sales_daily,'[]'::jsonb));
    END IF;

    RETURN v_result;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- C) get_console_cost_centers(company) — active leaf cost centers for the
--    journal-voucher picker. Non-group leaves preferred; ordered by code.
--    Gate: admin OR accounting|treasury read.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_cost_centers(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_ok boolean;
    v_items jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    v_ok := v_admin OR public.console_has_perm(v_user,'accounting','read')
                    OR public.console_has_perm(v_user,'treasury','read');
    IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', cc.id,
               'code', COALESCE(cc.code,''),
               'name', COALESCE(NULLIF(cc.name_ar,''), NULLIF(cc.name_en,''), cc.code, ''),
               'full_code', COALESCE(NULLIF(cc.full_code,''), cc.code, ''))
               ORDER BY cc.code), '[]'::jsonb)
      INTO v_items
      FROM cost_centers cc
      WHERE cc.company_id = p_company_id
        AND COALESCE(cc.is_active,true) = true
        AND COALESCE(cc.is_group,false) = false;

    RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- D) get_console_party_open_docs(company, party_type, party_id) — open (unpaid)
--    documents for a customer/supplier, sourced from *_transactions where
--    is_posted AND (total_amount - COALESCE(paid_amount,0)) > 0.005. doc_number
--    + doc_type derived exactly like get_console_sales_docs (and its purchase
--    mirror). Ordered by doc_date.
--    Gate: customer => sales|accounting read; supplier => purchases|accounting read.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_party_open_docs(
    p_company_id uuid, p_party_type text, p_party_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_ok boolean := false;
    v_items jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);

    IF p_party_type = 'customer' THEN
        v_ok := v_admin OR public.console_has_perm(v_user,'sales','read')
                        OR public.console_has_perm(v_user,'accounting','read');
        IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

        SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.doc_date NULLS LAST), '[]'::jsonb) INTO v_items FROM (
            SELECT
                st.id,
                COALESCE(NULLIF(st.invoice_no,''), NULLIF(st.order_no,''),
                         NULLIF(st.quotation_no,''), NULLIF(st.tracking_number,''),
                         'ST-'||upper(substr(st.id::text,1,8))) AS doc_number,
                CASE
                    WHEN st.stage IN ('invoice','posted','partial_paid','paid') OR NULLIF(st.invoice_no,'') IS NOT NULL THEN 'invoice'
                    WHEN st.stage = 'quotation' THEN 'quotation'
                    WHEN st.stage = 'reservation' THEN 'reservation'
                    ELSE 'order'
                END AS doc_type,
                round(COALESCE(st.total_amount,0),2) AS total,
                round(COALESCE(st.paid_amount,0),2) AS paid,
                round(COALESCE(st.total_amount,0) - COALESCE(st.paid_amount,0),2) AS balance,
                st.doc_date,
                st.due_date
            FROM sales_transactions st
            WHERE st.company_id = p_company_id
              AND st.customer_id = p_party_id
              AND COALESCE(st.is_posted,false) = true
              AND (COALESCE(st.total_amount,0) - COALESCE(st.paid_amount,0)) > 0.005
            ORDER BY st.doc_date NULLS LAST
        ) t;

    ELSIF p_party_type = 'supplier' THEN
        v_ok := v_admin OR public.console_has_perm(v_user,'purchases','read')
                        OR public.console_has_perm(v_user,'accounting','read');
        IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

        SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.doc_date NULLS LAST), '[]'::jsonb) INTO v_items FROM (
            SELECT
                pt.id,
                COALESCE(NULLIF(pt.supplier_invoice_number,''), NULLIF(pt.invoice_no,''),
                         NULLIF(pt.order_no,''), 'PT-'||upper(substr(pt.id::text,1,8))) AS doc_number,
                CASE
                    WHEN pt.stage IN ('invoice','posted','partial_paid','paid','received') OR NULLIF(pt.supplier_invoice_number,'') IS NOT NULL OR NULLIF(pt.invoice_no,'') IS NOT NULL THEN 'invoice'
                    ELSE 'order'
                END AS doc_type,
                round(COALESCE(pt.total_amount,0),2) AS total,
                round(COALESCE(pt.paid_amount,0),2) AS paid,
                round(COALESCE(pt.total_amount,0) - COALESCE(pt.paid_amount,0),2) AS balance,
                pt.doc_date,
                pt.due_date
            FROM purchase_transactions pt
            WHERE pt.company_id = p_company_id
              AND pt.supplier_id = p_party_id
              AND COALESCE(pt.is_posted,false) = true
              AND (COALESCE(pt.total_amount,0) - COALESCE(pt.paid_amount,0)) > 0.005
            ORDER BY pt.doc_date NULLS LAST
        ) t;
    ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'bad_type');
    END IF;

    RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- E) ENRICHED PAYMENTS — add optional invoice link + cost-center param.
--    Old 6-arg signatures are DROPPED and recreated with 3 trailing default
--    params. When p_reference_id is given it must be a *_transactions row of
--    this party+company; setting payment_receipts.sales_transaction_id (resp.
--    payment_vouchers.purchase_transaction_id) links the payment to that doc.
--
--    COST CENTER: payment_receipts / payment_vouchers have NO cost_center_id,
--    and their GL entries are built by triggers (create_payment_receipt_journal_
--    entry / create_payment_voucher_journal_entry) that do NOT accept a cost
--    center. So p_cost_center_id is VALIDATED (belongs to the company) but NOT
--    applied on this simple path — cost centers are honored ONLY on the
--    journal-voucher path (§F). Documented for the caller.
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.create_payment_receipt(uuid, uuid, numeric, text, uuid, text);
CREATE OR REPLACE FUNCTION public.create_payment_receipt(
    p_company_id uuid, p_party_id uuid, p_amount numeric, p_currency text,
    p_cash_account_id uuid, p_notes text DEFAULT NULL,
    p_reference_id uuid DEFAULT NULL, p_cost_center_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_can boolean;
    v_tenant uuid; v_cust_company uuid; v_cust_name text;
    v_scoped uuid[];
    v_is_cash boolean; v_is_bank boolean; v_acct_company uuid;
    v_status text; v_do_post boolean;
    v_receipt_id uuid; v_number text; v_method text;
    v_acct uuid := p_cash_account_id;
    v_ref_ok boolean;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
    PERFORM assert_can_access_company(p_company_id);   -- raises on cross-tenant

    v_admin := public.console_is_admin(v_user);
    v_can := v_admin
             OR public.console_has_perm(v_user,'treasury','write')
             OR public.console_has_perm(v_user,'accounting','write')
             OR public.console_has_role(v_user,'cashier');
    IF NOT v_can THEN RAISE EXCEPTION 'forbidden: payment permission required'; END IF;

    IF COALESCE(p_amount,0) <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

    -- customer must belong to this company
    SELECT tenant_id, company_id, COALESCE(NULLIF(name_ar,''), NULLIF(company_name,''), name_en)
      INTO v_tenant, v_cust_company, v_cust_name
      FROM customers WHERE id = p_party_id;
    IF v_cust_company IS NULL OR v_cust_company <> p_company_id THEN RAISE EXCEPTION 'invalid_customer'; END IF;

    -- optional linked sales document must be this customer+company
    IF p_reference_id IS NOT NULL THEN
        SELECT true INTO v_ref_ok FROM sales_transactions
         WHERE id = p_reference_id AND company_id = p_company_id AND customer_id = p_party_id;
        IF NOT COALESCE(v_ref_ok,false) THEN RAISE EXCEPTION 'invalid_reference'; END IF;
    END IF;

    -- optional cost center must be this company (validated only; not applied here)
    IF p_cost_center_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM cost_centers WHERE id = p_cost_center_id AND company_id = p_company_id) THEN
            RAISE EXCEPTION 'invalid_cost_center';
        END IF;
    END IF;

    v_scoped := public.console_scope_cash_accounts(v_user);

    IF v_acct IS NULL THEN
        SELECT id INTO v_acct FROM chart_of_accounts
        WHERE company_id = p_company_id
          AND (COALESCE(is_cash_account,false) OR COALESCE(is_bank_account,false))
          AND COALESCE(is_group,false) = false
          AND (v_scoped = ARRAY[]::uuid[] OR id = ANY(v_scoped))
        ORDER BY account_code LIMIT 1;
        IF v_acct IS NULL THEN RAISE EXCEPTION 'no_cash_account_available'; END IF;
    END IF;

    SELECT COALESCE(is_cash_account,false), COALESCE(is_bank_account,false), company_id
      INTO v_is_cash, v_is_bank, v_acct_company
      FROM chart_of_accounts WHERE id = v_acct;
    IF v_acct_company IS NULL OR v_acct_company <> p_company_id THEN RAISE EXCEPTION 'invalid_cash_account'; END IF;
    IF NOT (v_is_cash OR v_is_bank) THEN RAISE EXCEPTION 'not_a_cash_account'; END IF;

    IF v_scoped <> ARRAY[]::uuid[] AND NOT (v_acct = ANY(v_scoped)) THEN
        RAISE EXCEPTION 'cash_account_out_of_scope';
    END IF;

    v_do_post := (COALESCE((SELECT NULLIF(settings->>'operating_mode','') FROM companies WHERE id = p_company_id), 'workflow') = 'direct')
                 AND (v_admin OR public.console_special(v_user,'can_approve_transactions'));
    v_status := CASE WHEN v_do_post THEN 'confirmed' ELSE 'draft' END;
    v_method := CASE WHEN v_is_cash THEN 'cash' ELSE 'bank_transfer' END;

    v_number := 'RCV-'||to_char(now(),'YYYYMMDD')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);

    INSERT INTO payment_receipts(
        tenant_id, company_id, receipt_number, receipt_date, customer_id, customer_name,
        amount, currency, payment_method, treasury_account_id, sales_transaction_id,
        status, notes, created_by, created_at
    ) VALUES (
        v_tenant, p_company_id, v_number, CURRENT_DATE, p_party_id, v_cust_name,
        round(p_amount,2), COALESCE(NULLIF(p_currency,''), (SELECT default_currency FROM companies WHERE id = p_company_id), 'USD'),
        v_method, v_acct, p_reference_id, v_status, NULLIF(p_notes,''), v_user, now()
    ) RETURNING id, receipt_number INTO v_receipt_id, v_number;

    RETURN jsonb_build_object('ok', true, 'entry_id', v_receipt_id, 'entry_number', v_number, 'status', v_status);
END;
$$;

DROP FUNCTION IF EXISTS public.create_payment_voucher(uuid, uuid, numeric, text, uuid, text);
CREATE OR REPLACE FUNCTION public.create_payment_voucher(
    p_company_id uuid, p_party_id uuid, p_amount numeric, p_currency text,
    p_cash_account_id uuid, p_notes text DEFAULT NULL,
    p_reference_id uuid DEFAULT NULL, p_cost_center_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_can boolean;
    v_tenant uuid; v_supp_company uuid; v_supp_name text;
    v_scoped uuid[];
    v_is_cash boolean; v_is_bank boolean; v_acct_company uuid;
    v_status text; v_do_post boolean;
    v_voucher_id uuid; v_number text; v_method text;
    v_acct uuid := p_cash_account_id;
    v_ref_ok boolean;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
    PERFORM assert_can_access_company(p_company_id);

    v_admin := public.console_is_admin(v_user);
    v_can := v_admin
             OR public.console_has_perm(v_user,'treasury','write')
             OR public.console_has_perm(v_user,'accounting','write')
             OR public.console_has_role(v_user,'cashier');
    IF NOT v_can THEN RAISE EXCEPTION 'forbidden: payment permission required'; END IF;

    IF COALESCE(p_amount,0) <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

    SELECT tenant_id, company_id, COALESCE(NULLIF(name_ar,''), name_en)
      INTO v_tenant, v_supp_company, v_supp_name
      FROM suppliers WHERE id = p_party_id;
    IF v_supp_company IS NULL OR v_supp_company <> p_company_id THEN RAISE EXCEPTION 'invalid_supplier'; END IF;

    IF p_reference_id IS NOT NULL THEN
        SELECT true INTO v_ref_ok FROM purchase_transactions
         WHERE id = p_reference_id AND company_id = p_company_id AND supplier_id = p_party_id;
        IF NOT COALESCE(v_ref_ok,false) THEN RAISE EXCEPTION 'invalid_reference'; END IF;
    END IF;

    IF p_cost_center_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM cost_centers WHERE id = p_cost_center_id AND company_id = p_company_id) THEN
            RAISE EXCEPTION 'invalid_cost_center';
        END IF;
    END IF;

    v_scoped := public.console_scope_cash_accounts(v_user);

    IF v_acct IS NULL THEN
        SELECT id INTO v_acct FROM chart_of_accounts
        WHERE company_id = p_company_id
          AND (COALESCE(is_cash_account,false) OR COALESCE(is_bank_account,false))
          AND COALESCE(is_group,false) = false
          AND (v_scoped = ARRAY[]::uuid[] OR id = ANY(v_scoped))
        ORDER BY account_code LIMIT 1;
        IF v_acct IS NULL THEN RAISE EXCEPTION 'no_cash_account_available'; END IF;
    END IF;

    SELECT COALESCE(is_cash_account,false), COALESCE(is_bank_account,false), company_id
      INTO v_is_cash, v_is_bank, v_acct_company
      FROM chart_of_accounts WHERE id = v_acct;
    IF v_acct_company IS NULL OR v_acct_company <> p_company_id THEN RAISE EXCEPTION 'invalid_cash_account'; END IF;
    IF NOT (v_is_cash OR v_is_bank) THEN RAISE EXCEPTION 'not_a_cash_account'; END IF;

    IF v_scoped <> ARRAY[]::uuid[] AND NOT (v_acct = ANY(v_scoped)) THEN
        RAISE EXCEPTION 'cash_account_out_of_scope';
    END IF;

    v_do_post := (COALESCE((SELECT NULLIF(settings->>'operating_mode','') FROM companies WHERE id = p_company_id), 'workflow') = 'direct')
                 AND (v_admin OR public.console_special(v_user,'can_approve_transactions'));
    v_status := CASE WHEN v_do_post THEN 'confirmed' ELSE 'draft' END;
    v_method := CASE WHEN v_is_cash THEN 'cash' ELSE 'bank_transfer' END;

    v_number := 'PAY-'||to_char(now(),'YYYYMMDD')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);

    INSERT INTO payment_vouchers(
        tenant_id, company_id, voucher_number, voucher_date, supplier_id, supplier_name,
        amount, currency, payment_method, treasury_account_id, purchase_transaction_id,
        status, notes, created_by, created_at
    ) VALUES (
        v_tenant, p_company_id, v_number, CURRENT_DATE, p_party_id, v_supp_name,
        round(p_amount,2), COALESCE(NULLIF(p_currency,''), (SELECT default_currency FROM companies WHERE id = p_company_id), 'USD'),
        v_method, v_acct, p_reference_id, v_status, NULLIF(p_notes,''), v_user, now()
    ) RETURNING id, voucher_number INTO v_voucher_id, v_number;

    RETURN jsonb_build_object('ok', true, 'entry_id', v_voucher_id, 'entry_number', v_number, 'status', v_status);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- F) console_create_journal_voucher — "pay/receive to ANY account" path.
--    Faithful to the web JournalVoucherTab: builds a balanced 2-line JE with an
--    is_fund_line=true cash/bank line and a counterparty line carrying
--    cost_center_id / party_type / party_id / reference_type / reference_id.
--
--    direction 'in'  (receipt): DR fund (is_fund_line) / CR counterparty
--    direction 'out' (payment): DR counterparty / CR fund (is_fund_line)
--
--    Posting: operating_mode='direct' AND (admin OR can_approve_transactions)
--    => post immediately (status 'posted'); else JE stays draft (is_posted false)
--    so it appears in the confirmation center for approval.
--    entry_type = 'journal_voucher' (source-doc-less; get_console_item_details
--    maps unknown reference_type -> 'journal_entry' preview).
--
--    Gate: admin OR treasury|accounting write OR cashier.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.console_create_journal_voucher(
    p_company_id uuid,
    p_direction text,               -- 'in' = receipt, 'out' = payment
    p_fund_account_id uuid,
    p_counterparty_account_id uuid,
    p_amount numeric,
    p_cost_center_id uuid DEFAULT NULL,
    p_reference_type text DEFAULT NULL,
    p_reference_id uuid DEFAULT NULL,
    p_party_type text DEFAULT NULL,
    p_party_id uuid DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_can boolean;
    v_tenant uuid; v_branch uuid; v_currency text;
    v_scoped uuid[];
    v_fund_ok boolean; v_fund_is_group boolean;
    v_cp_company uuid; v_cp_is_group boolean;
    v_fy uuid;
    v_amount numeric := round(COALESCE(p_amount,0),2);
    v_do_post boolean; v_status text; v_is_posted boolean;
    v_entry_id uuid; v_number text;
    v_fund_debit numeric; v_fund_credit numeric;
    v_cp_debit numeric; v_cp_credit numeric;
    v_desc text;
    v_ref_type text := NULLIF(p_reference_type,'');
    v_ref_id uuid := p_reference_id;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
    PERFORM assert_can_access_company(p_company_id);

    IF p_direction NOT IN ('in','out') THEN RAISE EXCEPTION 'invalid_direction'; END IF;
    IF v_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
    IF p_fund_account_id IS NULL OR p_counterparty_account_id IS NULL THEN RAISE EXCEPTION 'account_required'; END IF;
    IF p_fund_account_id = p_counterparty_account_id THEN RAISE EXCEPTION 'same_account'; END IF;

    v_admin := public.console_is_admin(v_user);
    v_can := v_admin
             OR public.console_has_perm(v_user,'treasury','write')
             OR public.console_has_perm(v_user,'accounting','write')
             OR public.console_has_role(v_user,'cashier');
    IF NOT v_can THEN RAISE EXCEPTION 'forbidden: journal voucher permission required'; END IF;

    -- fund account: cash/bank leaf of this company
    SELECT (COALESCE(is_cash_account,false) OR COALESCE(is_bank_account,false)),
           COALESCE(is_group,false)
      INTO v_fund_ok, v_fund_is_group
      FROM chart_of_accounts
      WHERE id = p_fund_account_id AND company_id = p_company_id;
    IF v_fund_ok IS NULL THEN RAISE EXCEPTION 'invalid_fund_account'; END IF;      -- not this company
    IF v_fund_is_group THEN RAISE EXCEPTION 'fund_account_is_group'; END IF;
    IF NOT v_fund_ok THEN RAISE EXCEPTION 'not_a_cash_account'; END IF;

    -- fund must be within the user's cash-account scope when scoped
    v_scoped := public.console_scope_cash_accounts(v_user);
    IF v_scoped <> ARRAY[]::uuid[] AND NOT (p_fund_account_id = ANY(v_scoped)) THEN
        RAISE EXCEPTION 'fund_account_out_of_scope';
    END IF;

    -- counterparty: any non-group leaf of this company (customs/expense/employee/owner/etc.)
    SELECT company_id, COALESCE(is_group,false)
      INTO v_cp_company, v_cp_is_group
      FROM chart_of_accounts WHERE id = p_counterparty_account_id;
    IF v_cp_company IS NULL OR v_cp_company <> p_company_id THEN RAISE EXCEPTION 'invalid_counterparty_account'; END IF;
    IF v_cp_is_group THEN RAISE EXCEPTION 'counterparty_account_is_group'; END IF;

    -- optional cost center of this company
    IF p_cost_center_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM cost_centers WHERE id = p_cost_center_id AND company_id = p_company_id) THEN
            RAISE EXCEPTION 'invalid_cost_center';
        END IF;
    END IF;

    -- optional party validation (kept lenient — only checks company when a party id is given)
    IF p_party_id IS NOT NULL AND p_party_type = 'customer' THEN
        IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_party_id AND company_id = p_company_id) THEN
            RAISE EXCEPTION 'invalid_party';
        END IF;
    ELSIF p_party_id IS NOT NULL AND p_party_type = 'supplier' THEN
        IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_party_id AND company_id = p_company_id) THEN
            RAISE EXCEPTION 'invalid_party';
        END IF;
    END IF;

    -- tenant / base currency / fiscal year (branch_id left NULL, as the web service does)
    v_branch := NULL;
    SELECT tenant_id INTO v_tenant FROM companies WHERE id = p_company_id;
    BEGIN SELECT COALESCE(NULLIF(default_currency,''),'USD') INTO v_currency FROM companies WHERE id = p_company_id;
    EXCEPTION WHEN OTHERS THEN v_currency := 'USD'; END;
    SELECT id INTO v_fy FROM fiscal_years WHERE company_id = p_company_id AND is_current = true LIMIT 1;

    -- posting policy
    v_do_post := (COALESCE((SELECT NULLIF(settings->>'operating_mode','') FROM companies WHERE id = p_company_id), 'workflow') = 'direct')
                 AND (v_admin OR public.console_special(v_user,'can_approve_transactions'));

    -- line direction
    IF p_direction = 'in' THEN
        v_fund_debit := v_amount; v_fund_credit := 0;
        v_cp_debit   := 0;        v_cp_credit   := v_amount;
        v_desc := COALESCE(NULLIF(p_notes,''), 'سند قبض (يومية) - قيد');
    ELSE
        v_fund_debit := 0;        v_fund_credit := v_amount;
        v_cp_debit   := v_amount; v_cp_credit   := 0;
        v_desc := COALESCE(NULLIF(p_notes,''), 'سند صرف (يومية) - قيد');
    END IF;

    -- collision-resistant number (mirrors service style)
    v_number := 'JE-JV-'||to_char(now(),'YYYYMMDD')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);

    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id, entry_number, entry_date, fiscal_year_id, entry_type,
        reference_type, reference_id, description, currency, exchange_rate,
        total_debit, total_credit, status, is_posted, created_by, created_at
    ) VALUES (
        v_tenant, p_company_id, v_branch, v_number, CURRENT_DATE, v_fy, 'journal_voucher',
        v_ref_type, v_ref_id, v_desc, v_currency, 1,
        v_amount, v_amount, 'draft', false, v_user, now()
    ) RETURNING id INTO v_entry_id;

    -- Line 1: fund (is_fund_line=true) — no cost center / party / reference on the fund side
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number, account_id, debit, credit, debit_fc, credit_fc,
        currency, exchange_rate, description, is_fund_line
    ) VALUES (
        v_tenant, v_entry_id, 1, p_fund_account_id, v_fund_debit, v_fund_credit, v_fund_debit, v_fund_credit,
        v_currency, 1, v_desc, true
    );

    -- Line 2: counterparty — carries cost center / party / reference
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number, account_id, debit, credit, debit_fc, credit_fc,
        currency, exchange_rate, description, cost_center_id, party_type, party_id,
        reference_type, reference_id, is_fund_line
    ) VALUES (
        v_tenant, v_entry_id, 2, p_counterparty_account_id, v_cp_debit, v_cp_credit, v_cp_debit, v_cp_credit,
        v_currency, 1, v_desc, p_cost_center_id, NULLIF(p_party_type,''), p_party_id,
        v_ref_type, v_ref_id, false
    );

    IF v_do_post THEN
        PERFORM post_journal_entry(v_entry_id, v_user);
        v_status := 'posted';
        v_is_posted := true;
    ELSE
        v_status := 'draft';
        v_is_posted := false;
    END IF;

    RETURN jsonb_build_object('ok', true, 'entry_id', v_entry_id, 'entry_number', v_number, 'status', v_status);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- F-companion) get_console_all_accounts(company, query?, limit) — ALL non-group
--    leaf accounts of the company (counterparty picker for the journal voucher).
--    kind = cash|bank|receivable|payable|expense|revenue|other, derived from the
--    flags/account_type classification. Search by code/name (ILIKE).
--    Gate: admin OR accounting|treasury read.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_all_accounts(
    p_company_id uuid, p_query text DEFAULT NULL, p_limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_ok boolean;
    v_q text := NULLIF(trim(COALESCE(p_query,'')),'');
    v_lim int := LEAST(GREATEST(COALESCE(p_limit,50),1), 200);
    v_items jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    v_ok := v_admin OR public.console_has_perm(v_user,'accounting','read')
                    OR public.console_has_perm(v_user,'treasury','read');
    IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.code), '[]'::jsonb) INTO v_items FROM (
        SELECT
            a.id,
            a.account_code AS code,
            COALESCE(NULLIF(a.name_ar,''), NULLIF(a.name_en,''), a.account_code) AS name,
            CASE
                WHEN COALESCE(a.is_bank_account,false) THEN 'bank'
                WHEN COALESCE(a.is_cash_account,false) THEN 'cash'
                WHEN COALESCE(a.is_receivable,false)   THEN 'receivable'
                WHEN COALESCE(a.is_payable,false)      THEN 'payable'
                WHEN COALESCE(at.classification,'') = 'expenses' THEN 'expense'
                WHEN COALESCE(at.classification,'') = 'income'   THEN 'revenue'
                ELSE 'other'
            END AS kind
        FROM chart_of_accounts a
        LEFT JOIN account_types at ON at.id = a.account_type_id
        WHERE a.company_id = p_company_id
          AND COALESCE(a.is_group,false) = false
          AND (v_q IS NULL
               OR a.account_code ILIKE '%'||v_q||'%'
               OR COALESCE(a.name_ar,'') ILIKE '%'||v_q||'%'
               OR COALESCE(a.name_en,'') ILIKE '%'||v_q||'%')
        ORDER BY a.account_code
        LIMIT v_lim
    ) t;

    RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 🔐 GRANTS — authenticated only; explicitly revoke anon/public
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.get_console_account_ledger(uuid, uuid, date, date)',
        'public.get_party_statement(uuid, text, uuid, date, date)',
        'public.get_console_dashboard_charts(uuid)',
        'public.get_console_cost_centers(uuid)',
        'public.get_console_party_open_docs(uuid, text, uuid)',
        'public.create_payment_receipt(uuid, uuid, numeric, text, uuid, text, uuid, uuid)',
        'public.create_payment_voucher(uuid, uuid, numeric, text, uuid, text, uuid, uuid)',
        'public.console_create_journal_voucher(uuid, text, uuid, uuid, numeric, uuid, text, uuid, text, uuid, text)',
        'public.get_console_all_accounts(uuid, text, int)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        BEGIN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn); EXCEPTION WHEN OTHERS THEN NULL; END;
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END LOOP;
END $$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- CONTRACT SUMMARY (round 5 — actions, ledger, vouchers)
-- ────────────────────────────────────────────────────────────────────────
-- get_console_account_ledger(p_company_id, p_account_id, p_from?, p_to?)  [ENRICHED]
--   -> {ok, account:{id,code,name,is_bank,kind}, currency, from, to,
--        opening_balance, lines:[{date, entry_number, description, party_name,
--        debit, credit, running_balance, entry_id, source_type, source_id}],
--        closing_balance}
--   Default range is now MONTH-TO-DATE (from=date_trunc('month',today), to=today).
--   Opening balance = coa.opening_balance + signed posted movement strictly before
--   p_from. source_type is a get_console_item_details type; source_id is the mapped
--   je.reference_id (real docs) else the je.id (journal_entry fallback).
--   Gate: admin OR accounting|treasury read.
--
-- get_party_statement(p_company_id, p_party_type, p_party_id, p_from?, p_to?)  [ENRICHED]
--   -> same additive keys (entry_id, source_type, source_id) + from/to; month-to-date
--   default. Gate: customer=>sales|crm|customers|accounting read;
--   supplier=>purchases|suppliers|accounting read.
--
-- get_console_dashboard_charts(p_company_id)
--   -> {ok,
--        revenue_expense:[{month,label,revenue,expenses}]   (6mo; finance gate),
--        cash_flow:[{date,income,expense}]                  (30d; finance gate),
--        pending_by_type:[{item_type,cnt}]                  (approver gate),
--        sales_daily:[{date,total}]                         (14d; sales-read gate)}
--   Section keys are OMITTED when the gate fails. revenue_expense/cash_flow reuse
--   get_accounting_dashboard(.monthly) / get_dashboard_cash_flow; pending_by_type
--   reuses get_confirmation_counts. sales_daily excludes draft/quotation/cancelled
--   and applies the own-docs rule for a scoped (non-all-branches) non-admin.
--
-- get_console_cost_centers(p_company_id)
--   -> {ok, items:[{id, code, name, full_code}]}  active non-group leaves, by code.
--   Gate: admin OR accounting|treasury read.
--
-- get_console_party_open_docs(p_company_id, p_party_type, p_party_id)
--   -> {ok, items:[{id, doc_number, doc_type, total, paid, balance, doc_date,
--        due_date}]}  posted *_transactions with balance>0.005, by doc_date.
--   doc_number/doc_type derived like get_console_sales_docs (+ purchase mirror).
--   Gate: customer=>sales|accounting read; supplier=>purchases|accounting read.
--
-- create_payment_receipt(p_company_id, p_party_id, p_amount, p_currency,
--        p_cash_account_id, p_notes?, p_reference_id?, p_cost_center_id?)  [ENRICHED]
--   Old 6-arg signature DROPPED; 8-arg form (2 new trailing defaults). p_reference_id
--   (a sales_transactions id of this customer+company) sets sales_transaction_id so
--   the paid-sync trigger runs on confirm. p_cost_center_id is VALIDATED but NOT
--   applied (receipt GL is trigger-built with no cost-center hook) — cost centers
--   are honored ONLY on console_create_journal_voucher. RAISES on forbidden/invalid.
--
-- create_payment_voucher(...same 8-arg shape...)  [ENRICHED]
--   p_reference_id => purchase_transactions id => payment_vouchers.purchase_transaction_id
--   (stored for reference; the purchase side has NO paid-sync trigger). Cost center
--   same caveat as the receipt path.
--
-- console_create_journal_voucher(p_company_id, p_direction, p_fund_account_id,
--        p_counterparty_account_id, p_amount, p_cost_center_id?, p_reference_type?,
--        p_reference_id?, p_party_type?, p_party_id?, p_notes?)
--   -> {ok, entry_id, entry_number, status}   status 'posted'|'draft'. RAISES on
--   forbidden/invalid. Builds a balanced 2-line JE (is_fund_line fund line +
--   counterparty line with cost_center/party/reference). 'in'=DR fund/CR cp;
--   'out'=DR cp/CR fund. entry_type='journal_voucher'. Posts immediately only in
--   direct mode with approver rights, else draft (confirmation-center flow).
--   Gate: admin OR treasury|accounting write OR cashier.
--
-- get_console_all_accounts(p_company_id, p_query?, p_limit=50)
--   -> {ok, items:[{id, code, name, kind}]}  ALL non-group leaf accounts;
--   kind=cash|bank|receivable|payable|expense|revenue|other. ILIKE on code/name.
--   Gate: admin OR accounting|treasury read.
--
-- DEVIATIONS / OPEN QUESTIONS:
--   • Function names kept as create_payment_receipt / create_payment_voucher
--     (the LIVE names Flutter calls), NOT console_-prefixed — enriched in place.
--   • Cost center is honored ONLY on the journal-voucher path (§F); the simple
--     payment paths validate but ignore p_cost_center_id (trigger-built GL).
--   • entry_type for the journal voucher = 'journal_voucher' (web uses
--     'receipt'/'payment' on its source-doc-backed path; this console path has no
--     source doc, so it falls to the 'journal_entry' preview in item-details).
-- ════════════════════════════════════════════════════════════════════════
