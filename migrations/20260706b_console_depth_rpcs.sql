-- ════════════════════════════════════════════════════════════════════════
-- 📱 TexaCore Console RPCs — DEPTH ROUND 2 (NexaLive Flutter mini-ERP)
-- ════════════════════════════════════════════════════════════════════════
-- Date: 2026-07-06
-- Author: Console server side (reviewed & applied by Fable — NOT auto-applied)
--
-- WHY THIS EXISTS
--   Round 1 (20260706a) shipped the identity/dashboard/party/treasury/driver/
--   approval surface. This round adds the *drill-down* surface the Flutter app
--   needs: account list + account ledger, item-detail preview before approval,
--   material browse/detail/create, sales-doc list, an invoice/order flavor on
--   the sales-order creator, and MANDATORY driver location pings + a tracking
--   feed for managers. Same trust model: the mobile client cannot be trusted to
--   filter by role, so every function enforces role/permission SERVER-SIDE and
--   codes against the exact names/shapes below — keep them stable.
--
-- CONVENTIONS (identical to 20260706a)
--   • Every function: SECURITY DEFINER, SET search_path = public, pg_temp.
--   • REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated ONLY.
--   • Read functions NEVER raise for permission denial: {"ok":false,"error":"forbidden"}.
--   • Write functions RAISE EXCEPTION on forbidden.
--   • assert_can_access_company(company) in every function (directly or via the
--     item's resolved company).
--   • Reuse the LIVE helpers from 20260706a: console_has_perm / console_is_admin /
--     console_has_role / console_special / console_scope_warehouses /
--     console_scope_cash_accounts / console_driver_id. Never touch
--     check_user_permission / get_user_special_permissions (NOT deployed).
--   • Amounts in company base currency (companies.default_currency).
--
-- LIVE-DB TABLE/COLUMN FACTS VERIFIED (migrations + how src/ actually queries)
--   chart_of_accounts(id, company_id, account_code, name_ar, name_en,
--       account_type_id -> account_types.normal_balance ('debit'|'credit'),
--       is_group, is_cash_account, is_bank_account, is_receivable, is_payable,
--       opening_balance)                                    [00004]
--   journal_entries(id, company_id, entry_number, entry_date DATE, description,
--       is_posted, created_by)                              [00004]
--   journal_entry_lines(entry_id, account_id, line_number, debit, credit,
--       description, party_type, party_id)                  [00004]
--   ERP account ledger convention (get_account_statement, 00014_financial_reports
--       + src/services/accountLedgerService.ts):
--       opening = coa.opening_balance + Σ(normal_balance-signed (debit-credit))
--                 over POSTED lines with entry_date < from;
--       running = opening + Σ(normal_balance-signed (debit-credit)) in-range.
--       normal_balance='debit'  => debit-credit ; 'credit' => credit-debit.
--       (This matches the console_dashboard cash calc AND get_party_statement.)
--   fabric_materials(id, company_id, tenant_id, code NOT NULL, name_ar NOT NULL,
--       name_en, unit, selling_price, reorder_point, min_stock, min_stock_level,
--       category, current_stock, custom_fields JSONB, status)
--       • cost price lives in custom_fields->>'_cost_price' (aliased erp_cost in
--         EcommerceProducts.tsx:275 / MaterialPricingTab.tsx). There is NO
--         cost_price / avg_cost column ON fabric_materials.
--       • current_stock is a REAL column, trigger-derived from
--         Σ inventory_stock.quantity_on_hand (20260617b sync_material_current_stock)
--         — it is the ERP's authoritative live total (get_low_stock,
--         get_ecommerce_products, EcommerceProducts read it). We read it for the
--         header total and derive per-warehouse rows from inventory_stock.
--       • CODE: the ERP does NOT auto-generate a prefix at create; code is
--         user-/import-provided (cloud-importer.ts:431). fabric_materials has a
--         UNIQUE(tenant_id, code). So the console generates a defensive unique
--         code 'MAT-'||YYYYMMDD||'-'||rand when the payload omits one.
--   inventory_stock(material_id, warehouse_id, quantity_on_hand, average_cost)
--       keyed on product_id (NOT NULL) + material_id (added later). Per-warehouse
--       stock = quantity_on_hand (get_low_stock_materials 20260621d is the
--       authoritative join: SUM(quantity_on_hand) WHERE material_id = m.id).
--   warehouses(id, name_ar, name_en, code)
--   stock_transfers(id, company_id, transfer_number, total_meters, status,
--       from_warehouse_id, to_warehouse_id, created_by, created_at)  [live]
--   stock_transfer_items(transfer_id, material_id, roll_id, quantity, is_jit_roll,
--       notes)  [transferService.ts:200-211] — NO money columns (it's a move).
--   sales_transactions: NO doc_type column. Order vs invoice is carried by
--       `stage` ('order'|'invoice'|...) + which *_no field is populated
--       (order_no / invoice_no). shipping_address / internal_notes are the real
--       columns (NOT customer_address / delivery_notes). total_amount, currency,
--       customer_id, customer_name, created_by, created_by_name, doc_date,
--       tracking_number, source_type.
--   sales_transaction_items / purchase_transaction_items(transaction_id,
--       line_number, material_id, description, description_ar, quantity, unit,
--       unit_price, subtotal, total)  [20260215]
--   payment_receipts(id, company_id, receipt_number, receipt_date, customer_id,
--       customer_name, amount, currency, payment_method, treasury_account_id,
--       status, notes, created_by)
--   payment_vouchers(id, company_id, voucher_number, voucher_date, supplier_id,
--       supplier_name, amount, currency, payment_method, treasury_account_id,
--       status, notes, created_by)
--   purchase_transactions(id, company_id, supplier_id, supplier_invoice_number,
--       total_amount, currency, stage, doc_date, created_by, created_by_name)
--   pending_actions(id, company_id, action_type, action_data JSONB,
--       original_message, status, created_by_user_id, created_at)  [20260307]
--       action_data keys seen in ConfirmationCenter.tsx: amount, currency,
--       description / summary / title, from_customer / to_account, etc.
--   drivers(id, tenant_id, company_id, user_id, name_ar, name_en, phone, status)
--   user_profiles(id, full_name, display_name, email, phone)
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- helper: console_material_cost — cost from custom_fields->>'_cost_price'
--   (numeric-safe). Kept as a tiny SQL helper so every material fn agrees.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.console_material_cost(p_custom_fields jsonb)
RETURNS numeric
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
             WHEN p_custom_fields ? '_cost_price'
                  AND NULLIF(p_custom_fields->>'_cost_price','') IS NOT NULL
                  AND (p_custom_fields->>'_cost_price') ~ '^-?[0-9]+(\.[0-9]+)?$'
             THEN round((p_custom_fields->>'_cost_price')::numeric, 4)
             ELSE NULL
           END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 1) get_console_accounts(company, kind) — cash/receivable/payable leaves
--    kind: 'cash'|'receivable'|'payable'|'all'. Gate: accounting|treasury read.
--    balance: natural-positive per account nature, from POSTED journal lines,
--    mirroring the web ledger (normal_balance signed sum). cash/receivable are
--    debit-natural (debit-credit); payable is credit-natural (credit-debit).
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_accounts(p_company_id uuid, p_kind text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_ok boolean;
    v_kind text := lower(COALESCE(NULLIF(p_kind,''),'all'));
    v_items jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    IF v_kind NOT IN ('cash','receivable','payable','all') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'bad_kind');
    END IF;

    v_admin := public.console_is_admin(v_user);
    v_ok := v_admin OR public.console_has_perm(v_user,'accounting','read')
                    OR public.console_has_perm(v_user,'treasury','read');
    IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.code), '[]'::jsonb) INTO v_items FROM (
        SELECT
            a.id,
            a.account_code AS code,
            COALESCE(NULLIF(a.name_ar,''), NULLIF(a.name_en,''), a.account_code) AS name,
            -- natural-positive balance: cash/receivable are debit-natural,
            -- payable is credit-natural. Include coa.opening_balance like the
            -- web get_account_statement so numbers agree with the ERP.
            round(
              COALESCE(a.opening_balance,0)
              + COALESCE((
                  SELECT SUM(CASE WHEN a.is_payable THEN jel.credit - jel.debit
                                  ELSE jel.debit - jel.credit END)
                  FROM journal_entry_lines jel
                  JOIN journal_entries je ON je.id = jel.entry_id
                  WHERE jel.account_id = a.id
                    AND je.company_id = p_company_id
                    AND COALESCE(je.is_posted,false) = true
                ),0)
            ,2) AS balance,
            COALESCE(a.is_bank_account,false) AS is_bank,
            CASE WHEN COALESCE(a.is_cash_account,false) OR COALESCE(a.is_bank_account,false) THEN 'cash'
                 WHEN COALESCE(a.is_receivable,false) THEN 'receivable'
                 WHEN COALESCE(a.is_payable,false) THEN 'payable'
                 ELSE '' END AS kind
        FROM chart_of_accounts a
        WHERE a.company_id = p_company_id
          AND COALESCE(a.is_group,false) = false
          AND (
                (v_kind IN ('cash','all')       AND (COALESCE(a.is_cash_account,false) OR COALESCE(a.is_bank_account,false)))
             OR (v_kind IN ('receivable','all')  AND COALESCE(a.is_receivable,false))
             OR (v_kind IN ('payable','all')     AND COALESCE(a.is_payable,false))
          )
    ) t;

    RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 2) get_console_account_ledger(company, account, from?, to?) — GL statement
--    Gate: accounting|treasury read; account must belong to company.
--    Posted entries only; default range 90 days. opening = signed sum before
--    p_from (+ coa.opening_balance). running balance via ordinal window (same
--    pattern as get_party_statement). Sign = account nature (normal_balance).
--    party_name resolved from jel.party_type/party_id (customers/suppliers).
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
    v_from date := COALESCE(p_from, CURRENT_DATE - INTERVAL '90 days');
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
            round(v_opening + SUM(v_sign*(s.debit - s.credit)) OVER (ORDER BY s.ord ROWS UNBOUNDED PRECEDING), 2) AS running_balance
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
                round(COALESCE(jel.credit,0),2) AS credit
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
        'opening_balance', v_opening,
        'lines', COALESCE(v_lines, '[]'::jsonb),
        'closing_balance', COALESCE(v_closing, v_opening)
    );
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 3) get_console_item_details(item_type, item_id) — approval PREVIEW
--    Resolve the item's company, then gate EXACTLY like console_execute_item:
--      • financial types (payment_receipt/voucher/journal_entry) + pending_action
--        => approver only (admin OR can_approve_transactions OR accounting write).
--      • sales_invoice => approver OR sales READ (preview is less sensitive than
--        execute — sellers may view their own docs).
--      • purchase_invoice / stock_transfer => approver OR warehouse|inventory.
--    NEVER expose journal/payment previews without the approver gate.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_item_details(p_item_type text, p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_is_wh boolean; v_is_approver boolean; v_is_sales_r boolean;
    v_company uuid; v_currency text := ''; v_ok boolean := false;
    v_header jsonb; v_lines jsonb;
    -- scratch
    v_created_by uuid; v_created_name text;
    v_ad jsonb; v_title text; v_sub text; v_amount numeric; v_acct_name text;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;

    -- resolve company + created_by per type (columns verified against 20260621n)
    IF p_item_type = 'payment_receipt' THEN
        SELECT company_id, created_by INTO v_company, v_created_by FROM payment_receipts WHERE id = p_item_id;
    ELSIF p_item_type = 'payment_voucher' THEN
        SELECT company_id, created_by INTO v_company, v_created_by FROM payment_vouchers WHERE id = p_item_id;
    ELSIF p_item_type = 'journal_entry' THEN
        SELECT company_id, created_by INTO v_company, v_created_by FROM journal_entries WHERE id = p_item_id;
    ELSIF p_item_type = 'sales_invoice' THEN
        SELECT company_id, created_by INTO v_company, v_created_by FROM sales_transactions WHERE id = p_item_id;
    ELSIF p_item_type = 'purchase_invoice' THEN
        SELECT company_id, created_by INTO v_company, v_created_by FROM purchase_transactions WHERE id = p_item_id;
    ELSIF p_item_type = 'stock_transfer' THEN
        SELECT company_id, created_by INTO v_company, v_created_by FROM stock_transfers WHERE id = p_item_id;
    ELSIF p_item_type = 'pending_action' THEN
        SELECT company_id, created_by_user_id INTO v_company, v_created_by FROM pending_actions WHERE id = p_item_id;
    ELSE
        RETURN jsonb_build_object('ok', false, 'error', 'unsupported_item_type');
    END IF;

    IF v_company IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
    BEGIN PERFORM assert_can_access_company(v_company);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    v_is_wh := v_admin OR public.console_has_perm(v_user,'warehouse','write')
                       OR public.console_has_perm(v_user,'inventory','write');
    v_is_approver := v_admin OR public.console_special(v_user,'can_approve_transactions')
                             OR public.console_has_perm(v_user,'accounting','write');
    v_is_sales_r := v_admin OR public.console_has_perm(v_user,'sales','read');

    IF p_item_type IN ('payment_receipt','payment_voucher','journal_entry','pending_action') THEN
        v_ok := v_is_approver;
    ELSIF p_item_type = 'sales_invoice' THEN
        v_ok := v_is_approver OR v_is_sales_r;
    ELSIF p_item_type IN ('purchase_invoice','stock_transfer') THEN
        v_ok := v_is_approver OR v_is_wh;
    END IF;
    IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

    BEGIN SELECT COALESCE(default_currency,'') INTO v_currency FROM companies WHERE id = v_company; EXCEPTION WHEN OTHERS THEN v_currency := ''; END;

    -- created_by display name
    SELECT COALESCE(NULLIF(full_name,''), NULLIF(display_name,''), email) INTO v_created_name
      FROM user_profiles WHERE id = v_created_by;
    v_created_name := COALESCE(v_created_name, '');

    v_lines := '[]'::jsonb;

    -- ── payment_receipt: header + one summary line (cash account + method) ──
    IF p_item_type = 'payment_receipt' THEN
        SELECT jsonb_build_object(
                 'type', 'payment_receipt',
                 'title', COALESCE(NULLIF(pr.notes,''), 'سند قبض'),
                 'ref_number', COALESCE(pr.receipt_number,''),
                 'party_name', COALESCE(NULLIF(pr.customer_name,''), c.name_ar, c.name_en, c.company_name, ''),
                 'amount', COALESCE(pr.amount,0),
                 'currency', COALESCE(NULLIF(pr.currency,''), v_currency),
                 'date', pr.receipt_date,
                 'status', pr.status::text,
                 'notes', COALESCE(pr.notes,''),
                 'created_by_name', v_created_name)
          INTO v_header
          FROM payment_receipts pr LEFT JOIN customers c ON c.id = pr.customer_id
          WHERE pr.id = p_item_id;
        SELECT COALESCE(NULLIF(a.name_ar,''), NULLIF(a.name_en,''), a.account_code)
          INTO v_acct_name
          FROM payment_receipts pr LEFT JOIN chart_of_accounts a ON a.id = pr.treasury_account_id
          WHERE pr.id = p_item_id;
        SELECT jsonb_build_array(jsonb_build_object(
                   'label', COALESCE(v_acct_name,'النقد/البنك'),
                   'sublabel', (SELECT COALESCE(payment_method,'') FROM payment_receipts WHERE id = p_item_id),
                   'qty', NULL, 'unit', NULL, 'unit_price', NULL,
                   'debit', (SELECT COALESCE(amount,0) FROM payment_receipts WHERE id = p_item_id),
                   'credit', 0,
                   'total', (SELECT COALESCE(amount,0) FROM payment_receipts WHERE id = p_item_id)))
          INTO v_lines;

    -- ── payment_voucher: header + one summary line (cash account + method) ──
    ELSIF p_item_type = 'payment_voucher' THEN
        SELECT jsonb_build_object(
                 'type', 'payment_voucher',
                 'title', COALESCE(NULLIF(pv.notes,''), 'سند صرف'),
                 'ref_number', COALESCE(pv.voucher_number,''),
                 'party_name', COALESCE(NULLIF(pv.supplier_name,''), s.name_ar, s.name_en, ''),
                 'amount', COALESCE(pv.amount,0),
                 'currency', COALESCE(NULLIF(pv.currency,''), v_currency),
                 'date', pv.voucher_date,
                 'status', pv.status::text,
                 'notes', COALESCE(pv.notes,''),
                 'created_by_name', v_created_name)
          INTO v_header
          FROM payment_vouchers pv LEFT JOIN suppliers s ON s.id = pv.supplier_id
          WHERE pv.id = p_item_id;
        SELECT COALESCE(NULLIF(a.name_ar,''), NULLIF(a.name_en,''), a.account_code)
          INTO v_acct_name
          FROM payment_vouchers pv LEFT JOIN chart_of_accounts a ON a.id = pv.treasury_account_id
          WHERE pv.id = p_item_id;
        SELECT jsonb_build_array(jsonb_build_object(
                   'label', COALESCE(v_acct_name,'النقد/البنك'),
                   'sublabel', (SELECT COALESCE(payment_method,'') FROM payment_vouchers WHERE id = p_item_id),
                   'qty', NULL, 'unit', NULL, 'unit_price', NULL,
                   'debit', 0,
                   'credit', (SELECT COALESCE(amount,0) FROM payment_vouchers WHERE id = p_item_id),
                   'total', (SELECT COALESCE(amount,0) FROM payment_vouchers WHERE id = p_item_id)))
          INTO v_lines;

    -- ── journal_entry: lines = journal_entry_lines (account code+name / debit/credit) ──
    ELSIF p_item_type = 'journal_entry' THEN
        SELECT jsonb_build_object(
                 'type', 'journal_entry',
                 'title', COALESCE(NULLIF(je.description,''), 'قيد يومية'),
                 'ref_number', COALESCE(je.entry_number,''),
                 'party_name', '',
                 'amount', COALESCE(je.total_debit,0),
                 'currency', COALESCE(NULLIF(je.currency,''), v_currency),
                 'date', je.entry_date,
                 'status', je.status::text,
                 'notes', COALESCE(je.description,''),
                 'created_by_name', v_created_name)
          INTO v_header
          FROM journal_entries je WHERE je.id = p_item_id;
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'label', COALESCE(a.account_code,'')||' — '||COALESCE(NULLIF(a.name_ar,''), NULLIF(a.name_en,''), ''),
                   'sublabel', COALESCE(NULLIF(jel.description,''),''),
                   'qty', NULL, 'unit', NULL, 'unit_price', NULL,
                   'debit', round(COALESCE(jel.debit,0),2),
                   'credit', round(COALESCE(jel.credit,0),2),
                   'total', round(COALESCE(jel.debit,0) + COALESCE(jel.credit,0),2)
               ) ORDER BY jel.line_number), '[]'::jsonb)
          INTO v_lines
          FROM journal_entry_lines jel LEFT JOIN chart_of_accounts a ON a.id = jel.account_id
          WHERE jel.entry_id = p_item_id;

    -- ── sales_invoice / purchase_invoice: header + transaction items ──
    ELSIF p_item_type IN ('sales_invoice','purchase_invoice') THEN
        IF p_item_type = 'sales_invoice' THEN
            SELECT jsonb_build_object(
                     'type', 'sales_invoice',
                     'title', 'فاتورة مبيعات',
                     'ref_number', COALESCE(NULLIF(st.invoice_no,''), NULLIF(st.order_no,''),
                                            NULLIF(st.tracking_number,''), 'ST-'||upper(substr(st.id::text,1,8))),
                     'party_name', COALESCE(NULLIF(st.customer_name,''), c.name_ar, c.name_en, c.company_name, ''),
                     'amount', COALESCE(st.total_amount,0),
                     'currency', COALESCE(NULLIF(st.currency,''), v_currency),
                     'date', st.doc_date,
                     'status', st.stage::text,
                     'notes', COALESCE(NULLIF(st.internal_notes,''),''),
                     'created_by_name', COALESCE(NULLIF(v_created_name,''), st.created_by_name, ''))
              INTO v_header
              FROM sales_transactions st LEFT JOIN customers c ON c.id = st.customer_id
              WHERE st.id = p_item_id;
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'label', COALESCE(NULLIF(it.description,''), NULLIF(it.description_ar,''), m.name_ar, m.name_en, ''),
                       'sublabel', COALESCE(m.code,''),
                       'material_id', it.material_id,
                       'qty', round(COALESCE(it.quantity,0),4),
                       'unit', COALESCE(it.unit, m.unit, ''),
                       'unit_price', round(COALESCE(it.unit_price,0),4),
                       'debit', NULL, 'credit', NULL,
                       'total', round(COALESCE(it.total, it.subtotal, it.quantity*it.unit_price, 0),2)
                   ) ORDER BY it.line_number), '[]'::jsonb)
              INTO v_lines
              FROM sales_transaction_items it LEFT JOIN fabric_materials m ON m.id = it.material_id
              WHERE it.transaction_id = p_item_id;
        ELSE
            SELECT jsonb_build_object(
                     'type', 'purchase_invoice',
                     'title', 'فاتورة مشتريات',
                     'ref_number', COALESCE(NULLIF(pt.supplier_invoice_number,''), 'PT-'||upper(substr(pt.id::text,1,8))),
                     'party_name', COALESCE(s.name_ar, s.name_en, ''),
                     'amount', COALESCE(pt.total_amount,0),
                     'currency', COALESCE(NULLIF(pt.currency,''), v_currency),
                     'date', pt.doc_date,
                     'status', pt.stage::text,
                     'notes', '',
                     'created_by_name', COALESCE(NULLIF(v_created_name,''), pt.created_by_name, ''))
              INTO v_header
              FROM purchase_transactions pt LEFT JOIN suppliers s ON s.id = pt.supplier_id
              WHERE pt.id = p_item_id;
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'label', COALESCE(NULLIF(it.description,''), NULLIF(it.description_ar,''), m.name_ar, m.name_en, ''),
                       'sublabel', COALESCE(m.code,''),
                       'material_id', it.material_id,
                       'qty', round(COALESCE(it.quantity,0),4),
                       'unit', COALESCE(it.unit, m.unit, ''),
                       'unit_price', round(COALESCE(it.unit_price,0),4),
                       'debit', NULL, 'credit', NULL,
                       'total', round(COALESCE(it.total, it.subtotal, it.quantity*it.unit_price, 0),2)
                   ) ORDER BY it.line_number), '[]'::jsonb)
              INTO v_lines
              FROM purchase_transaction_items it LEFT JOIN fabric_materials m ON m.id = it.material_id
              WHERE it.transaction_id = p_item_id;
        END IF;

    -- ── stock_transfer: header + transfer items (no money) ──
    ELSIF p_item_type = 'stock_transfer' THEN
        SELECT jsonb_build_object(
                 'type', 'stock_transfer',
                 'title', 'مناقلة مخزون',
                 'ref_number', COALESCE(tr.transfer_number,'ST-'||upper(substr(tr.id::text,1,8))),
                 'party_name', COALESCE(NULLIF(wf.name_ar,''), NULLIF(wf.name_en,''), '')
                               ||' → '||COALESCE(NULLIF(wt.name_ar,''), NULLIF(wt.name_en,''), ''),
                 'amount', COALESCE(tr.total_meters,0),
                 'currency', '',
                 'date', tr.created_at::date,
                 'status', tr.status::text,
                 'notes', '',
                 'created_by_name', v_created_name)
          INTO v_header
          FROM stock_transfers tr
          LEFT JOIN warehouses wf ON wf.id = tr.from_warehouse_id
          LEFT JOIN warehouses wt ON wt.id = tr.to_warehouse_id
          WHERE tr.id = p_item_id;
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'label', COALESCE(m.name_ar, m.name_en, m.code, ''),
                   'sublabel', COALESCE(m.code,''),
                   'qty', round(COALESCE(ti.quantity,0),4),
                   'unit', COALESCE(m.unit,''),
                   'unit_price', NULL, 'debit', NULL, 'credit', NULL,
                   'total', round(COALESCE(ti.quantity,0),4)
               )), '[]'::jsonb)
          INTO v_lines
          FROM stock_transfer_items ti LEFT JOIN fabric_materials m ON m.id = ti.material_id
          WHERE ti.transfer_id = p_item_id;

    -- ── pending_action: title + payload summary from action_data ──
    ELSIF p_item_type = 'pending_action' THEN
        SELECT pa.action_data,
               COALESCE(NULLIF(pa.action_data->>'title',''),
                        NULLIF(pa.action_data->>'summary',''),
                        NULLIF(pa.action_data->>'description',''),
                        NULLIF(pa.original_message,''),
                        pa.action_type),
               COALESCE(NULLIF(pa.action_data->>'from_customer',''),
                        NULLIF(pa.action_data->>'to_account',''),
                        NULLIF(pa.action_data->>'employee_name',''),
                        NULLIF(pa.action_data->>'description',''), ''),
               CASE WHEN (pa.action_data->>'amount') ~ '^-?[0-9]+(\.[0-9]+)?$'
                    THEN (pa.action_data->>'amount')::numeric ELSE NULL END
          INTO v_ad, v_title, v_sub, v_amount
          FROM pending_actions pa WHERE pa.id = p_item_id;

        SELECT jsonb_build_object(
                 'type', 'pending_action',
                 'title', COALESCE(v_title, ''),
                 'ref_number', (SELECT action_type FROM pending_actions WHERE id = p_item_id),
                 'party_name', COALESCE(v_sub, ''),
                 'amount', COALESCE(v_amount, 0),
                 'currency', COALESCE(NULLIF(v_ad->>'currency',''), v_currency),
                 'date', (SELECT created_at::date FROM pending_actions WHERE id = p_item_id),
                 'status', (SELECT status::text FROM pending_actions WHERE id = p_item_id),
                 'notes', COALESCE(NULLIF(v_ad->>'description',''), (SELECT COALESCE(original_message,'') FROM pending_actions WHERE id = p_item_id)),
                 'created_by_name', v_created_name)
          INTO v_header;
        -- one summary line so the Flutter list renderer has something to show
        SELECT jsonb_build_array(jsonb_build_object(
                   'label', COALESCE(v_title,''),
                   'sublabel', COALESCE(v_sub,''),
                   'qty', NULL, 'unit', NULL, 'unit_price', NULL,
                   'debit', NULL, 'credit', NULL,
                   'total', COALESCE(v_amount, 0)))
          INTO v_lines;
    END IF;

    IF v_header IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

    RETURN jsonb_build_object('ok', true, 'header', v_header, 'lines', COALESCE(v_lines,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 4) console_list_materials(company, query?, limit) — material browse
--    Gate: inventory|warehouse read OR sales read (sellers browse materials).
--    cost_price included ONLY when admin OR can_view_cost_prices, else null.
--    current_stock = fabric_materials.current_stock (ERP live total).
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.console_list_materials(
    p_company_id uuid, p_query text DEFAULT NULL, p_limit int DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_ok boolean; v_show_cost boolean;
    v_q text := NULLIF(trim(COALESCE(p_query,'')), '');
    v_lim int := LEAST(GREATEST(COALESCE(p_limit,30),1), 200);
    v_items jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    v_ok := v_admin OR public.console_has_perm(v_user,'inventory','read')
                    OR public.console_has_perm(v_user,'warehouse','read')
                    OR public.console_has_perm(v_user,'sales','read');
    IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

    v_show_cost := v_admin OR public.console_special(v_user, 'can_view_cost_prices');

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.name), '[]'::jsonb) INTO v_items FROM (
        SELECT
            m.id,
            COALESCE(m.code,'') AS code,
            COALESCE(NULLIF(m.name_ar,''), NULLIF(m.name_en,''), m.code) AS name,
            COALESCE(m.unit,'') AS unit,
            round(COALESCE(m.current_stock,0),3) AS current_stock,
            round(COALESCE(m.selling_price,0),4) AS selling_price,
            CASE WHEN v_show_cost THEN public.console_material_cost(m.custom_fields) ELSE NULL END AS cost_price
        FROM fabric_materials m
        WHERE m.company_id = p_company_id
          AND COALESCE(m.status,'active') <> 'deleted'
          AND (v_q IS NULL OR m.name_ar ILIKE '%'||v_q||'%' OR m.name_en ILIKE '%'||v_q||'%'
               OR m.code ILIKE '%'||v_q||'%')
        ORDER BY COALESCE(NULLIF(m.name_ar,''), m.name_en, m.code) ASC
        LIMIT v_lim
    ) t;

    RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 5) get_console_material(company, material_id) — material detail + per-wh stock
--    Same gate as console_list_materials. stock_by_warehouse from inventory_stock
--    joined warehouses; scoped to console_scope_warehouses when non-empty.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_material(p_company_id uuid, p_material_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_ok boolean; v_show_cost boolean;
    v_wh uuid[];
    v_mat_company uuid;
    v_material jsonb; v_stock jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    v_ok := v_admin OR public.console_has_perm(v_user,'inventory','read')
                    OR public.console_has_perm(v_user,'warehouse','read')
                    OR public.console_has_perm(v_user,'sales','read');
    IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

    SELECT company_id INTO v_mat_company FROM fabric_materials WHERE id = p_material_id;
    IF v_mat_company IS NULL OR v_mat_company <> p_company_id THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    v_show_cost := v_admin OR public.console_special(v_user, 'can_view_cost_prices');

    SELECT jsonb_build_object(
             'id', m.id,
             'code', COALESCE(m.code,''),
             'name', COALESCE(NULLIF(m.name_ar,''), NULLIF(m.name_en,''), m.code),
             'unit', COALESCE(m.unit,''),
             'selling_price', round(COALESCE(m.selling_price,0),4),
             'cost_price', CASE WHEN v_show_cost THEN public.console_material_cost(m.custom_fields) ELSE NULL END,
             'current_stock', round(COALESCE(m.current_stock,0),3),
             'reorder_point', round(COALESCE(m.reorder_point, m.min_stock_level, m.min_stock, 0),3))
      INTO v_material
      FROM fabric_materials m WHERE m.id = p_material_id;

    v_wh := public.console_scope_warehouses(v_user);

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.warehouse_name), '[]'::jsonb) INTO v_stock FROM (
        SELECT
            s.warehouse_id,
            COALESCE(NULLIF(w.name_ar,''), NULLIF(w.name_en,''), w.code, '') AS warehouse_name,
            round(COALESCE(SUM(s.quantity_on_hand),0),3) AS qty
        FROM inventory_stock s LEFT JOIN warehouses w ON w.id = s.warehouse_id
        WHERE s.material_id = p_material_id
          AND (v_wh = ARRAY[]::uuid[] OR s.warehouse_id = ANY(v_wh))
        GROUP BY s.warehouse_id, w.name_ar, w.name_en, w.code
    ) t;

    RETURN jsonb_build_object('ok', true, 'material', v_material, 'stock_by_warehouse', COALESCE(v_stock,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 6) console_create_material(company, payload) — new material (NO stock touch)
--    WRITE (RAISES). Gate: inventory|warehouse write OR admin.
--    payload: {name, unit, selling_price?, reorder_point?, category?, code?}
--    code: use payload.code if given (unique per tenant), else defensive
--    'MAT-'||YYYYMMDD||'-'||rand. Stock stays 0 — it comes from movements only.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.console_create_material(p_company_id uuid, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean;
    v_tenant uuid;
    v_name text; v_unit text; v_cat text; v_code text;
    v_sell numeric; v_reorder numeric;
    v_material_id uuid;
    v_attempt int := 0;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
    PERFORM assert_can_access_company(p_company_id);

    v_admin := public.console_is_admin(v_user);
    IF NOT (v_admin OR public.console_has_perm(v_user,'inventory','write')
                    OR public.console_has_perm(v_user,'warehouse','write')) THEN
        RAISE EXCEPTION 'forbidden: inventory write required';
    END IF;

    v_name := NULLIF(trim(COALESCE(p_payload->>'name','')), '');
    IF v_name IS NULL THEN RAISE EXCEPTION 'name_required'; END IF;

    v_unit    := COALESCE(NULLIF(trim(COALESCE(p_payload->>'unit','')),''), 'meter');
    v_cat     := COALESCE(NULLIF(trim(COALESCE(p_payload->>'category','')),''), 'mixed');
    v_sell    := COALESCE(NULLIF(p_payload->>'selling_price','')::numeric, 0);
    v_reorder := COALESCE(NULLIF(p_payload->>'reorder_point','')::numeric, 0);
    v_code    := NULLIF(trim(COALESCE(p_payload->>'code','')), '');

    -- tenant from the company (fabric_materials.tenant_id is NOT NULL)
    SELECT tenant_id INTO v_tenant FROM companies WHERE id = p_company_id;
    IF v_tenant IS NULL THEN RAISE EXCEPTION 'company_not_found'; END IF;

    -- generate a defensive unique code when omitted (UNIQUE(tenant_id, code)).
    -- Retry a few times on the unlikely collision.
    LOOP
        v_attempt := v_attempt + 1;
        IF v_code IS NULL THEN
            v_code := 'MAT-'||to_char(now(),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
        END IF;
        BEGIN
            INSERT INTO fabric_materials(
                tenant_id, company_id, code, name_ar, name_en, unit, category,
                selling_price, reorder_point, current_stock, status, created_at, updated_at
            ) VALUES (
                v_tenant, p_company_id, v_code, v_name, NULLIF(p_payload->>'name_en',''),
                v_unit, v_cat, round(v_sell,4), round(v_reorder,3), 0, 'active', now(), now()
            ) RETURNING id INTO v_material_id;
            EXIT;  -- success
        EXCEPTION WHEN unique_violation THEN
            IF NULLIF(trim(COALESCE(p_payload->>'code','')),'') IS NOT NULL THEN
                RAISE EXCEPTION 'duplicate_code';   -- user-supplied code clashes: surface it
            END IF;
            v_code := NULL;                          -- regenerate and retry
            IF v_attempt >= 5 THEN RAISE EXCEPTION 'code_generation_failed'; END IF;
        END;
    END LOOP;

    RETURN jsonb_build_object('ok', true, 'material_id', v_material_id, 'code', v_code);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 7) get_console_sales_docs(company, limit) — recent sales documents
--    Gate: sales read. NON-admin without can_view_all_branches => own docs only
--    (created_by = auth.uid()) — same rule as the round-1 dashboard.
--    doc_type derived from stage / populated *_no (sales_transactions has NO
--    doc_type column — invoice vs order is carried by stage + invoice_no/order_no).
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_sales_docs(p_company_id uuid, p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_all_branches boolean; v_only_own boolean;
    v_currency text := '';
    v_lim int := LEAST(GREATEST(COALESCE(p_limit,20),1), 100);
    v_items jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    IF NOT (v_admin OR public.console_has_perm(v_user,'sales','read')) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
    END IF;

    v_all_branches := v_admin OR public.console_special(v_user, 'can_view_all_branches');
    v_only_own := NOT v_all_branches;
    BEGIN SELECT COALESCE(default_currency,'') INTO v_currency FROM companies WHERE id = p_company_id; EXCEPTION WHEN OTHERS THEN v_currency := ''; END;

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::jsonb) INTO v_items FROM (
        SELECT
            st.id AS tx_id,
            COALESCE(NULLIF(st.invoice_no,''), NULLIF(st.order_no,''),
                     NULLIF(st.quotation_no,''), NULLIF(st.tracking_number,''),
                     'ST-'||upper(substr(st.id::text,1,8))) AS doc_number,
            -- doc_type: derived, since there is no column
            CASE
                WHEN st.stage IN ('invoice','posted','partial_paid','paid') OR NULLIF(st.invoice_no,'') IS NOT NULL THEN 'invoice'
                WHEN st.stage = 'quotation' THEN 'quotation'
                WHEN st.stage = 'reservation' THEN 'reservation'
                ELSE 'order'
            END AS doc_type,
            COALESCE(NULLIF(st.customer_name,''), c.name_ar, c.name_en, c.company_name, '—') AS customer_name,
            round(COALESCE(st.total_amount,0),2) AS total,
            COALESCE(NULLIF(st.currency,''), v_currency) AS currency,
            st.stage,
            st.doc_date,
            st.created_at
        FROM sales_transactions st LEFT JOIN customers c ON c.id = st.customer_id
        WHERE st.company_id = p_company_id
          AND (NOT v_only_own OR st.created_by = v_user)
        ORDER BY st.created_at DESC
        LIMIT v_lim
    ) t;

    RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 8) console_create_sales_order — EXTENDED with p_doc_type ('order'|'invoice')
--    Drop the old 4-arg signature, recreate with the new one. Everything else
--    is identical to 20260706a (server-side pricing, no_valid_items, etc.).
--    doc_type only sets `stage` accordingly; both stay effectively draft-flow —
--    'order' => stage 'draft'; 'invoice' => stage 'draft' too (the confirmation
--    center / approver posts it). We DO NOT auto-post. We stamp order_no/invoice_no
--    as a soft marker so get_console_sales_docs can classify it.
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.console_create_sales_order(uuid, uuid, jsonb, text);

CREATE OR REPLACE FUNCTION public.console_create_sales_order(
    p_company_id uuid, p_customer_id uuid, p_items jsonb,
    p_notes text DEFAULT NULL, p_doc_type text DEFAULT 'order'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean;
    v_tenant uuid; v_cust_company uuid; v_cust_name text;
    v_currency text;
    v_txn uuid;
    v_item jsonb;
    v_n int := 0;
    v_mat uuid; v_qty numeric; v_price numeric; v_line_total numeric;
    v_subtotal numeric := 0;
    v_desc text; v_name text;
    v_doc_type text := lower(COALESCE(NULLIF(p_doc_type,''),'order'));
    v_soft_no text;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
    PERFORM assert_can_access_company(p_company_id);

    IF v_doc_type NOT IN ('order','invoice') THEN RAISE EXCEPTION 'invalid_doc_type'; END IF;

    v_admin := public.console_is_admin(v_user);
    IF NOT (v_admin OR public.console_has_perm(v_user,'sales','write')) THEN
        RAISE EXCEPTION 'forbidden: sales write required';
    END IF;

    SELECT tenant_id, company_id, COALESCE(NULLIF(name_ar,''), NULLIF(company_name,''), name_en)
      INTO v_tenant, v_cust_company, v_cust_name
      FROM customers WHERE id = p_customer_id;
    IF v_cust_company IS NULL OR v_cust_company <> p_company_id THEN RAISE EXCEPTION 'invalid_customer'; END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'empty_items';
    END IF;

    SELECT COALESCE(default_currency,'USD') INTO v_currency FROM companies WHERE id = p_company_id;

    -- soft doc marker so classification (get_console_sales_docs) is stable
    v_soft_no := CASE WHEN v_doc_type = 'invoice' THEN 'SI-' ELSE 'SO-' END
                 || to_char(now(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

    INSERT INTO sales_transactions(
        company_id, tenant_id, stage, customer_id, customer_name,
        currency, total_amount, subtotal, notes, created_by, created_by_name, source_type,
        order_no, invoice_no
    ) VALUES (
        p_company_id, v_tenant, 'draft', p_customer_id, v_cust_name,
        v_currency, 0, 0, NULLIF(p_notes,''), v_user,
        (SELECT COALESCE(NULLIF(full_name,''), email) FROM user_profiles WHERE id = v_user),
        'console_app',
        CASE WHEN v_doc_type = 'order'   THEN v_soft_no ELSE NULL END,
        CASE WHEN v_doc_type = 'invoice' THEN v_soft_no ELSE NULL END
    ) RETURNING id INTO v_txn;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_mat := NULLIF(v_item->>'material_id','')::uuid;
        v_qty := COALESCE(NULLIF(v_item->>'quantity','')::numeric, 0);
        IF v_mat IS NULL OR v_qty <= 0 THEN CONTINUE; END IF;
        v_n := v_n + 1;

        -- server-side price resolution; honor client price only for admins
        IF v_admin AND (v_item ? 'unit_price') AND NULLIF(v_item->>'unit_price','') IS NOT NULL THEN
            v_price := COALESCE((v_item->>'unit_price')::numeric, 0);
        ELSE
            SELECT COALESCE(selling_price, 0) INTO v_price
              FROM fabric_materials WHERE id = v_mat AND company_id = p_company_id;
            v_price := COALESCE(v_price, 0);
        END IF;

        SELECT COALESCE(NULLIF(name_ar,''), NULLIF(name_en,''), code) INTO v_name
          FROM fabric_materials WHERE id = v_mat;
        v_desc := COALESCE(v_name, '');
        v_line_total := round(v_qty * v_price, 2);
        v_subtotal := v_subtotal + v_line_total;

        INSERT INTO sales_transaction_items(transaction_id, line_number, material_id,
                                            quantity, unit_price, subtotal, total, description)
          VALUES(v_txn, v_n, v_mat, v_qty, v_price, v_line_total, v_line_total, NULLIF(v_desc,''));
    END LOOP;

    IF v_n = 0 THEN
        DELETE FROM sales_transactions WHERE id = v_txn;
        RAISE EXCEPTION 'no_valid_items';
    END IF;

    UPDATE sales_transactions
       SET subtotal = round(v_subtotal,2), total_amount = round(v_subtotal,2), updated_at = now()
     WHERE id = v_txn;

    RETURN jsonb_build_object('ok', true, 'tx_id', v_txn,
        'doc_number', v_soft_no, 'doc_type', v_doc_type, 'stage', 'draft', 'items', v_n);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 9) DRIVER TRACKING — location pings (MANDATORY during active delivery)
-- ════════════════════════════════════════════════════════════════════════

-- Table: RPC-only access (RLS enabled, NO authenticated policy). SECURITY
-- DEFINER RPCs write/read it. A service_role ALL policy mirrors the project's
-- RPC-only-table convention (service_role also bypasses RLS as owner; the
-- explicit policy documents intent).
CREATE TABLE IF NOT EXISTS public.driver_location_pings (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  uuid,
    company_id uuid NOT NULL,
    driver_id  uuid NOT NULL,
    tx_id      uuid NULL,
    lat        double precision NOT NULL,
    lng        double precision NOT NULL,
    accuracy   double precision NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_location_pings_company_driver_time
    ON public.driver_location_pings (company_id, driver_id, created_at DESC);

ALTER TABLE public.driver_location_pings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'driver_location_pings'
          AND policyname = 'driver_location_pings_service_all'
    ) THEN
        CREATE POLICY driver_location_pings_service_all
            ON public.driver_location_pings FOR ALL TO service_role
            USING (true) WITH CHECK (true);
    END IF;
END $$;

-- console_driver_ping — the active driver reports a location fix.
-- WRITE (RAISES). If p_tx_id given it must be assigned to the caller and at a
-- delivery-active stage ('confirmed','delivery'). tenant/company resolved from
-- the tx (preferred) else the drivers row. Rate-guard: ignore (ok:true,
-- skipped:true) when the last ping is < 20 seconds old.
CREATE OR REPLACE FUNCTION public.console_driver_ping(
    p_tx_id uuid, p_lat double precision, p_lng double precision,
    p_accuracy double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_driver uuid; v_company uuid; v_tenant uuid;
    v_tx_company uuid; v_tx_driver uuid; v_tx_stage text;
    v_last timestamptz;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
    IF p_lat IS NULL OR p_lng IS NULL THEN RAISE EXCEPTION 'invalid_location'; END IF;

    IF p_tx_id IS NOT NULL THEN
        SELECT company_id, driver_id, stage INTO v_tx_company, v_tx_driver, v_tx_stage
          FROM sales_transactions WHERE id = p_tx_id;
        IF v_tx_company IS NULL THEN RAISE EXCEPTION 'tx_not_found'; END IF;
        PERFORM assert_can_access_company(v_tx_company);

        v_driver := public.console_driver_id(v_user, v_tx_company);
        IF v_driver IS NULL THEN RAISE EXCEPTION 'forbidden: not a driver'; END IF;
        IF v_tx_driver IS NULL OR v_tx_driver <> v_driver THEN
            RAISE EXCEPTION 'forbidden: task not assigned to you';
        END IF;
        IF COALESCE(v_tx_stage,'') NOT IN ('confirmed','delivery') THEN
            RAISE EXCEPTION 'not_delivery_active';
        END IF;
        v_company := v_tx_company;
        SELECT tenant_id INTO v_tenant FROM drivers WHERE id = v_driver;
    ELSE
        -- untethered ping (driver on the move, not yet on a specific task):
        -- resolve their active driver row (any company they drive for).
        v_driver := public.console_driver_id(v_user, NULL);
        IF v_driver IS NULL THEN RAISE EXCEPTION 'forbidden: not a driver'; END IF;
        SELECT company_id, tenant_id INTO v_company, v_tenant FROM drivers WHERE id = v_driver;
        IF v_company IS NULL THEN RAISE EXCEPTION 'driver_company_unknown'; END IF;
        PERFORM assert_can_access_company(v_company);
    END IF;

    -- rate-guard: drop pings arriving < 20s after the last one
    SELECT max(created_at) INTO v_last
      FROM driver_location_pings
      WHERE company_id = v_company AND driver_id = v_driver;
    IF v_last IS NOT NULL AND v_last > now() - INTERVAL '20 seconds' THEN
        RETURN jsonb_build_object('ok', true, 'skipped', true);
    END IF;

    INSERT INTO driver_location_pings(tenant_id, company_id, driver_id, tx_id, lat, lng, accuracy, created_at)
    VALUES (v_tenant, v_company, v_driver, p_tx_id, p_lat, p_lng, p_accuracy, now());

    RETURN jsonb_build_object('ok', true, 'skipped', false);
END;
$$;

-- get_console_driver_track — manager tracking feed.
-- Gate: admin OR sales write OR warehouse|inventory write. Only drivers of the
-- company. Latest fix per driver + their active delivery; a trail (max 200
-- points, since p_since default 12h) ONLY when a single driver is requested.
CREATE OR REPLACE FUNCTION public.get_console_driver_track(
    p_company_id uuid, p_driver_id uuid DEFAULT NULL, p_since timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_ok boolean;
    v_since timestamptz := COALESCE(p_since, now() - INTERVAL '12 hours');
    v_drivers jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    v_ok := v_admin OR public.console_has_perm(v_user,'sales','write')
                    OR public.console_has_perm(v_user,'warehouse','write')
                    OR public.console_has_perm(v_user,'inventory','write');
    IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.driver_name), '[]'::jsonb) INTO v_drivers FROM (
        SELECT
            dr.id AS driver_id,
            COALESCE(NULLIF(dr.name_ar,''), NULLIF(dr.name_en,''), '') AS driver_name,
            COALESCE(dr.phone,'') AS phone,
            lp.lat  AS last_lat,
            lp.lng  AS last_lng,
            lp.created_at AS last_seen,
            -- the driver's current active delivery (if any)
            (
                SELECT jsonb_build_object(
                         'tx_id', st.id,
                         'doc_number', COALESCE(NULLIF(st.invoice_no,''), NULLIF(st.order_no,''),
                                                NULLIF(st.tracking_number,''), 'ST-'||upper(substr(st.id::text,1,8))),
                         'customer_name', COALESCE(NULLIF(st.customer_name,''), cu.name_ar, cu.name_en, '—'))
                FROM sales_transactions st LEFT JOIN customers cu ON cu.id = st.customer_id
                WHERE st.company_id = p_company_id AND st.driver_id = dr.id
                  AND COALESCE(st.stage,'') IN ('confirmed','delivery')
                ORDER BY st.updated_at DESC NULLS LAST, st.created_at DESC
                LIMIT 1
            ) AS active_tx,
            -- trail only for a single requested driver
            CASE WHEN p_driver_id IS NOT NULL THEN (
                SELECT COALESCE(jsonb_agg(jsonb_build_object('lat', t.lat, 'lng', t.lng, 'at', t.created_at)
                                          ORDER BY t.created_at ASC), '[]'::jsonb)
                FROM (
                    SELECT lat, lng, created_at
                    FROM driver_location_pings
                    WHERE company_id = p_company_id AND driver_id = dr.id AND created_at >= v_since
                    ORDER BY created_at DESC
                    LIMIT 200
                ) t
            ) ELSE NULL END AS trail
        FROM drivers dr
        LEFT JOIN LATERAL (
            SELECT lat, lng, created_at
            FROM driver_location_pings p
            WHERE p.company_id = p_company_id AND p.driver_id = dr.id
            ORDER BY p.created_at DESC
            LIMIT 1
        ) lp ON true
        WHERE dr.company_id = p_company_id
          AND dr.status = 'active'
          AND (p_driver_id IS NULL OR dr.id = p_driver_id)
    ) d;

    RETURN jsonb_build_object('ok', true, 'drivers', COALESCE(v_drivers,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 🔐 GRANTS — authenticated only; explicitly revoke anon/public
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.console_material_cost(jsonb)',
        'public.get_console_accounts(uuid, text)',
        'public.get_console_account_ledger(uuid, uuid, date, date)',
        'public.get_console_item_details(text, uuid)',
        'public.console_list_materials(uuid, text, int)',
        'public.get_console_material(uuid, uuid)',
        'public.console_create_material(uuid, jsonb)',
        'public.get_console_sales_docs(uuid, int)',
        'public.console_create_sales_order(uuid, uuid, jsonb, text, text)',
        'public.console_driver_ping(uuid, double precision, double precision, double precision)',
        'public.get_console_driver_track(uuid, uuid, timestamptz)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        BEGIN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn); EXCEPTION WHEN OTHERS THEN NULL; END;
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END LOOP;
END $$;

-- driver_location_pings: no direct table grants to authenticated/anon (RPC-only).
REVOKE ALL ON TABLE public.driver_location_pings FROM PUBLIC;
DO $$ BEGIN
    BEGIN REVOKE ALL ON TABLE public.driver_location_pings FROM anon; EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN REVOKE ALL ON TABLE public.driver_location_pings FROM authenticated; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- 📇 CONTRACT SUMMARY (the Flutter app codes against exactly these)
-- ════════════════════════════════════════════════════════════════════════
-- get_console_accounts(p_company_id uuid, p_kind text 'cash'|'receivable'|'payable'|'all')
--   -> {ok, items:[{id, code, name, balance, is_bank, kind}]}
--   balance = natural-positive (coa.opening_balance + normal-balance-signed
--   Σ(debit-credit) over POSTED lines). kind = cash|receivable|payable.
--
-- get_console_account_ledger(p_company_id, p_account_id, p_from? date, p_to? date)
--   -> {ok, account:{id,code,name,is_bank,kind}, currency, opening_balance,
--        lines:[{date, entry_number, description, party_name, debit, credit,
--                running_balance}], closing_balance}
--   POSTED only; default range 90 days; sign = account nature (normal_balance).
--   party_name from jel.party_type/party_id (customers/suppliers) else ''.
--
-- get_console_item_details(p_item_type, p_item_id)  [APPROVAL PREVIEW]
--   item_type: payment_receipt | payment_voucher | journal_entry |
--              sales_invoice | purchase_invoice | stock_transfer | pending_action
--   -> {ok, header:{type, title, ref_number, party_name, amount, currency, date,
--        status, notes, created_by_name},
--        lines:[{label, sublabel, qty, unit, unit_price, debit, credit, total}]}
--   Gate mirrors console_execute_item: approver for financial + pending_action;
--   approver-or-sales-read for sales_invoice; approver-or-warehouse for
--   purchase_invoice/stock_transfer. journal/payment previews are approver-only.
--   payment_* lines carry ONE summary line (cash account name + method, in the
--   debit/credit column matching the doc side). stock_transfer lines have no
--   money (qty only). pending_action carries a single payload-summary line.
--
-- console_list_materials(p_company_id, p_query?, p_limit=30)
--   -> {ok, items:[{id, code, name, unit, current_stock, selling_price, cost_price}]}
--   Gate: inventory|warehouse read OR sales read. cost_price is NULL unless
--   admin OR can_view_cost_prices (source: custom_fields->>'_cost_price').
--
-- get_console_material(p_company_id, p_material_id)
--   -> {ok, material:{id, code, name, unit, selling_price, cost_price(gated),
--        current_stock, reorder_point},
--        stock_by_warehouse:[{warehouse_id, warehouse_name, qty}]}
--   current_stock = fabric_materials.current_stock (ERP live total, trigger-
--   derived). Per-warehouse rows from inventory_stock, scoped to the user's
--   warehouse scope when non-empty.
--
-- console_create_material(p_company_id, p_payload jsonb)
--   p_payload: {name, unit?, selling_price?, reorder_point?, category?, code?, name_en?}
--   -> {ok, material_id, code}   (RAISES on forbidden/name_required/duplicate_code)
--   Stock is NEVER touched (movements-only truth source). code auto-generated
--   'MAT-YYYYMMDD-XXXXXX' when omitted; user-supplied dup code => 'duplicate_code'.
--
-- get_console_sales_docs(p_company_id, p_limit=20)
--   -> {ok, items:[{tx_id, doc_number, doc_type, customer_name, total, currency,
--        stage, doc_date, created_at}]}
--   Gate: sales read. NON-admin without can_view_all_branches => own docs only.
--   doc_type is DERIVED (no column): invoice|quotation|reservation|order.
--
-- console_create_sales_order(p_company_id, p_customer_id, p_items, p_notes?, p_doc_type='order')
--   p_doc_type: 'order'|'invoice'. p_items:[{material_id, quantity, unit_price?}]
--   -> {ok, tx_id, doc_number, doc_type, stage 'draft', items}
--   SERVER-SIDE PRICING (client unit_price honored for admin only). Never posts.
--   'order'=>order_no stamped, 'invoice'=>invoice_no stamped (soft classifier).
--   NOTE: OLD 4-arg signature dropped; Flutter must call the 5-arg form.
--
-- console_driver_ping(p_tx_id uuid|null, p_lat, p_lng, p_accuracy?)
--   -> {ok, skipped:bool}   (RAISES on forbidden/not_delivery_active/tx_not_found)
--   Caller must be the active driver; p_tx_id (if given) must be assigned to them
--   and at stage 'confirmed'/'delivery'. Rate-guarded: pings < 20s apart return
--   ok:true,skipped:true. tenant/company resolved from tx else drivers row.
--
-- get_console_driver_track(p_company_id, p_driver_id? uuid, p_since? timestamptz)
--   -> {ok, drivers:[{driver_id, driver_name, phone, last_lat, last_lng, last_seen,
--        active_tx:{tx_id,doc_number,customer_name}|null,
--        trail:[{lat,lng,at}] }]}
--   Gate: admin OR sales write OR warehouse|inventory write. Only active drivers
--   of the company. trail is populated ONLY when p_driver_id is given (max 200
--   points, since p_since default 12h); otherwise trail = null.
--
-- TABLE driver_location_pings — RPC-only (RLS on, no authenticated policy;
--   service_role ALL policy). Written by console_driver_ping, read by
--   get_console_driver_track. Index (company_id, driver_id, created_at DESC).
-- ════════════════════════════════════════════════════════════════════════
