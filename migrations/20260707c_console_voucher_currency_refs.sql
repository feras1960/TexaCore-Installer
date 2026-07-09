-- ════════════════════════════════════════════════════════════════════════
-- 20260707c — TexaCore Console (round 6): voucher currency + reference parity
-- ────────────────────────────────────────────────────────────────────────
-- Feras compared the console سند صرف/قبض to the ORIGINAL web voucher and asked
-- for parity on THREE things:
--   1. Currency choice from the tenant's defined currencies + exchange rate.
--   2. Reference linkage = بدون / فاتورة / أمر / كونتينر / حوالة
--      (none / invoice / order / container / remittance).
--   3. Cost center (already honored on the journal-voucher path — §E is the
--      one that carries it; the simple receipt/voucher path validates-but-does-
--      not-apply because payment_receipts/payment_vouchers have no
--      cost_center_id column and their GL is built by triggers that take none).
--
-- The counterparty semantics (receipt=customer-first, voucher=supplier-first,
-- "any account" via console_create_journal_voucher) are unchanged — Flutter-only.
--
-- Conventions (identical to 20260706a/b/c, 20260707a/b):
--   • SECURITY DEFINER, SET search_path = public, pg_temp on every function.
--   • Read functions return {ok:false, error:'forbidden'} on gate failure;
--     write functions RAISE.
--   • assert_can_access_company(company) is the tenant guard everywhere.
--   • Gates reuse the LIVE helpers from 20260706a:
--       console_has_perm / console_is_admin / console_special / console_has_role
--       console_scope_cash_accounts.
--   • REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated (loop, tail).
--   • BEGIN/COMMIT transaction; contract-summary comment at the very end.
--
-- ════════════════════════════════════════════════════════════════════════
-- FX DIRECTION — verified 2026-07-07 against the live web code + triggers.
-- DO NOT flip this; a wrong direction is a real accounting bug.
--
--   exchange_rate is BASE-per-FOREIGN (multiply):  base = foreign × rate.
--
-- Evidence:
--   • JournalVoucherTab.tsx line 761/772:  debit_local = debit(FC) × rate.
--     i.e. the LOCAL (base) amount is the foreign amount TIMES the rate.
--   • JournalVoucherTab.tsx line 217:      fc = rawD(local) / rate   (inverse).
--     read-back: DB `debit`/`credit` hold the LOCAL/base amount ("المبلغ المحلي
--     من DB"); DB `debit_fc`/`credit_fc` hold the FOREIGN amount.
--   • useExchangeRateLookup.lookupRate(from, to=base): for a DB row
--     from_currency=FOREIGN,to_currency=BASE it returns buy_rate||mid_rate
--     (line 245); the inverse row (from=BASE,to=FOREIGN) is 1/rate (line 248).
--     That returned value is the multiply-rate consumed by the JV tab above.
--
-- Rate resolution here (mirrors lookupRate, DB-only tier — the console has no
-- online-API fallback, which is acceptable for a server RPC):
--   rate = 1                                   when currency = base
--        = p_exchange_rate                     when caller supplied a positive one
--        = latest exchange_rates.mid_rate/buy_rate for from=currency→to=base
--        = 1 / (latest exchange_rates for from=base→to=currency)   (inverse row)
--        = currencies.exchange_rate            (base-per-foreign, same direction)
--        = 1                                   last resort
--
-- amount_in_base = round(amount × rate, 2)     on the receipt/voucher row.
--   NOTE: amount_in_base is a DENORMALIZED column on payment_receipts /
--   payment_vouchers (from 00008). It is NOT read by the GL triggers
--   (create_payment_receipt_journal_entry / create_payment_voucher_journal_entry),
--   which post the FACE amount (NEW.amount, in NEW.currency) into both `debit`
--   and `debit_fc`. Those triggers are OUT OF SCOPE for this migration (round 6
--   touches only the console RPCs). Because the console posts receipts/vouchers
--   as 'confirmed' only in direct+approver mode, a non-base receipt would post a
--   single-currency GL whose base value is unconverted — that is a PRE-EXISTING
--   trigger gap, flagged in the report, deliberately NOT altered here.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- A) get_console_currencies(company) — the currency picker for the voucher.
--    Tenant-level currencies (currencies has NO company_id; resolve tenant from
--    the company). is_active only, base first then by code. name prefers name_ar.
--    Gate: company access + (admin OR accounting|treasury read OR cashier).
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_currencies(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_ok boolean;
    v_tenant uuid;
    v_base text;
    v_items jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    v_ok := v_admin
            OR public.console_has_perm(v_user,'accounting','read')
            OR public.console_has_perm(v_user,'treasury','read')
            OR public.console_has_role(v_user,'cashier');
    IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

    SELECT tenant_id INTO v_tenant FROM companies WHERE id = p_company_id;

    -- base code: the tenant's is_base currency, else the company default_currency
    SELECT code INTO v_base FROM currencies
     WHERE tenant_id = v_tenant AND COALESCE(is_base,false) = true
     ORDER BY code LIMIT 1;
    IF v_base IS NULL THEN
        SELECT COALESCE(NULLIF(default_currency,''),'USD') INTO v_base FROM companies WHERE id = p_company_id;
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(t)
             ORDER BY t.is_base DESC, t.code), '[]'::jsonb) INTO v_items FROM (
        SELECT
            c.code,
            COALESCE(NULLIF(c.name_ar,''), NULLIF(c.name,''), NULLIF(c.name_en,''), c.code) AS name,
            c.symbol,
            COALESCE(c.is_base,false) AS is_base,
            COALESCE(c.exchange_rate, 1) AS exchange_rate
        FROM currencies c
        WHERE c.tenant_id = v_tenant
          AND COALESCE(c.is_active,true) = true
    ) t;

    RETURN jsonb_build_object('ok', true, 'base_code', v_base, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- B) get_console_remittances(company, query?, limit) — the حوالة picker.
--    Open remittances of the company (exclude completed/cancelled), most recent
--    first, searchable by number / sender / receiver.
--      amount           = COALESCE(total_from_customer, send_amount)
--      currency         = send_currency
--      counterparty_name= COALESCE(receiver_name, sender_name)
--    Gate: admin OR accounting|treasury read OR cashier.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_console_remittances(
    p_company_id uuid, p_query text DEFAULT NULL, p_limit int DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_ok boolean;
    v_q text := NULLIF(trim(COALESCE(p_query,'')),'');
    v_lim int := LEAST(GREATEST(COALESCE(p_limit,20),1), 100);
    v_items jsonb;
BEGIN
    IF v_user IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;
    BEGIN PERFORM assert_can_access_company(p_company_id);
    EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END;

    v_admin := public.console_is_admin(v_user);
    v_ok := v_admin
            OR public.console_has_perm(v_user,'accounting','read')
            OR public.console_has_perm(v_user,'treasury','read')
            OR public.console_has_role(v_user,'cashier');
    IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC), '[]'::jsonb)
      INTO v_items FROM (
        SELECT
            r.id,
            r.remittance_number,
            r.remittance_type,
            COALESCE(r.total_from_customer, r.send_amount, 0) AS amount,
            r.send_currency AS currency,
            r.status,
            COALESCE(NULLIF(r.receiver_name,''), r.sender_name) AS counterparty_name,
            r.created_at
        FROM remittances r
        WHERE r.company_id = p_company_id
          AND COALESCE(r.status,'') NOT IN ('completed','cancelled')
          AND (v_q IS NULL
               OR r.remittance_number ILIKE '%'||v_q||'%'
               OR COALESCE(r.sender_name,'')   ILIKE '%'||v_q||'%'
               OR COALESCE(r.receiver_name,'') ILIKE '%'||v_q||'%')
        ORDER BY r.created_at DESC
        LIMIT v_lim
    ) t;

    RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items,'[]'::jsonb));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- Internal helper: resolve the base-per-foreign multiply-rate for a currency.
--   base = foreign × console_resolve_fx_rate(...).  See the FX header block.
--   DB-only (no online API tier); mirrors useExchangeRateLookup.lookupRate.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.console_resolve_fx_rate(
    p_company_id uuid, p_currency text, p_base text, p_supplied numeric DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_tenant uuid;
    v_rate numeric;
BEGIN
    IF p_currency IS NULL OR p_currency = '' OR p_currency = p_base THEN
        RETURN 1;
    END IF;
    IF COALESCE(p_supplied,0) > 0 THEN
        RETURN p_supplied;
    END IF;

    -- direct row  from=foreign → to=base : mid/buy is the base-per-foreign rate
    SELECT COALESCE(NULLIF(mid_rate,0), NULLIF(buy_rate,0)) INTO v_rate
      FROM exchange_rates
     WHERE company_id = p_company_id
       AND from_currency = p_currency AND to_currency = p_base
       AND COALESCE(is_active,true) = true
     ORDER BY effective_from DESC NULLS LAST LIMIT 1;
    IF v_rate IS NOT NULL AND v_rate > 0 THEN RETURN v_rate; END IF;

    -- inverse row from=base → to=foreign : invert
    SELECT COALESCE(NULLIF(sell_rate,0), NULLIF(buy_rate,0), NULLIF(mid_rate,0)) INTO v_rate
      FROM exchange_rates
     WHERE company_id = p_company_id
       AND from_currency = p_base AND to_currency = p_currency
       AND COALESCE(is_active,true) = true
     ORDER BY effective_from DESC NULLS LAST LIMIT 1;
    IF v_rate IS NOT NULL AND v_rate > 0 THEN RETURN round(1/v_rate, 8); END IF;

    -- fallback: the tenant currency's own exchange_rate (base-per-foreign)
    SELECT tenant_id INTO v_tenant FROM companies WHERE id = p_company_id;
    SELECT NULLIF(exchange_rate,0) INTO v_rate
      FROM currencies
     WHERE tenant_id = v_tenant AND code = p_currency
       AND COALESCE(is_active,true) = true
     ORDER BY code LIMIT 1;
    IF v_rate IS NOT NULL AND v_rate > 0 THEN RETURN v_rate; END IF;

    RETURN 1;  -- last resort
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- C) ENRICH create_payment_receipt — currency/FX + reference-kind linkage.
--    DROP the 8-arg (20260707b) signature, recreate with p_reference_kind,
--    p_currency-aware FX (amount_in_base + resolved exchange_rate) and a nullable
--    exchange-rate override.  All 20260707b behavior (customer-of-company,
--    cash-account scope, posting policy, RCV numbering) preserved.
--
--    p_reference_kind ∈ 'invoice'|'order'|'container'|'remittance'|NULL:
--      'invoice'|'order' → sales_transaction_id (validated: sales_transactions
--                          row of this company; when a customer is given, also of
--                          that customer). This keeps the existing paid-sync
--                          trigger (sync_sales_invoice_paid_from_receipts) live.
--      'container'       → container_id  (validated: container of this company)
--      'remittance'      → remittance_id (validated: remittance of this company)
--    p_cost_center_id: validated-but-unapplied on this simple path (documented).
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.create_payment_receipt(uuid, uuid, numeric, text, uuid, text, uuid, uuid);
CREATE OR REPLACE FUNCTION public.create_payment_receipt(
    p_company_id uuid, p_party_id uuid, p_amount numeric, p_currency text,
    p_cash_account_id uuid, p_notes text DEFAULT NULL,
    p_reference_kind text DEFAULT NULL, p_reference_id uuid DEFAULT NULL,
    p_cost_center_id uuid DEFAULT NULL, p_exchange_rate numeric DEFAULT NULL
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
    v_kind text := NULLIF(lower(trim(COALESCE(p_reference_kind,''))),'');
    v_ok_ref boolean;
    v_currency text; v_base text; v_rate numeric; v_amt numeric; v_base_amt numeric;
    v_sales_tx uuid; v_container uuid; v_remittance uuid;
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

    -- reference-kind validation + column routing
    IF v_kind IS NOT NULL THEN
        IF v_kind NOT IN ('invoice','order','container','remittance') THEN
            RAISE EXCEPTION 'invalid_reference_kind';
        END IF;
        IF p_reference_id IS NULL THEN RAISE EXCEPTION 'reference_id_required'; END IF;

        IF v_kind IN ('invoice','order') THEN
            SELECT true INTO v_ok_ref FROM sales_transactions
             WHERE id = p_reference_id AND company_id = p_company_id
               AND (p_party_id IS NULL OR customer_id = p_party_id);
            IF NOT COALESCE(v_ok_ref,false) THEN RAISE EXCEPTION 'invalid_reference'; END IF;
            v_sales_tx := p_reference_id;
        ELSIF v_kind = 'container' THEN
            SELECT true INTO v_ok_ref FROM containers
             WHERE id = p_reference_id AND company_id = p_company_id;
            IF NOT COALESCE(v_ok_ref,false) THEN RAISE EXCEPTION 'invalid_reference'; END IF;
            v_container := p_reference_id;
        ELSE  -- remittance
            SELECT true INTO v_ok_ref FROM remittances
             WHERE id = p_reference_id AND company_id = p_company_id;
            IF NOT COALESCE(v_ok_ref,false) THEN RAISE EXCEPTION 'invalid_reference'; END IF;
            v_remittance := p_reference_id;
        END IF;
    END IF;

    -- optional cost center must be this company (validated only; NOT applied here)
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

    -- currency + FX (see header)
    v_base := COALESCE((SELECT default_currency FROM companies WHERE id = p_company_id), 'USD');
    v_currency := COALESCE(NULLIF(p_currency,''), v_base);
    v_rate := public.console_resolve_fx_rate(p_company_id, v_currency, v_base, p_exchange_rate);
    v_amt := round(p_amount, 2);
    v_base_amt := round(v_amt * v_rate, 2);

    v_do_post := (COALESCE((SELECT NULLIF(settings->>'operating_mode','') FROM companies WHERE id = p_company_id), 'workflow') = 'direct')
                 AND (v_admin OR public.console_special(v_user,'can_approve_transactions'));
    v_status := CASE WHEN v_do_post THEN 'confirmed' ELSE 'draft' END;
    v_method := CASE WHEN v_is_cash THEN 'cash' ELSE 'bank_transfer' END;

    v_number := 'RCV-'||to_char(now(),'YYYYMMDD')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);

    INSERT INTO payment_receipts(
        tenant_id, company_id, receipt_number, receipt_date, customer_id, customer_name,
        amount, currency, exchange_rate, amount_in_base, payment_method, treasury_account_id,
        sales_transaction_id, container_id, remittance_id,
        status, notes, created_by, created_at
    ) VALUES (
        v_tenant, p_company_id, v_number, CURRENT_DATE, p_party_id, v_cust_name,
        v_amt, v_currency, v_rate, v_base_amt, v_method, v_acct,
        v_sales_tx, v_container, v_remittance,
        v_status, NULLIF(p_notes,''), v_user, now()
    ) RETURNING id, receipt_number INTO v_receipt_id, v_number;

    RETURN jsonb_build_object('ok', true, 'entry_id', v_receipt_id, 'entry_number', v_number,
                              'status', v_status, 'currency', v_currency, 'exchange_rate', v_rate,
                              'amount_in_base', v_base_amt);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- D) ENRICH create_payment_voucher — mirror of C for the supplier side.
--    p_reference_kind ∈ 'invoice'|'container'|'remittance'|NULL:
--      'invoice'   → purchase_transaction_id (validated: purchase_transactions
--                    row of this company; when a supplier is given, also of that
--                    supplier). No purchase paid-sync trigger exists — link only.
--      'container' → container_id  (validated)
--      'remittance'→ remittance_id (validated)
--    ('order' is not a purchase reference kind and is rejected on this path.)
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.create_payment_voucher(uuid, uuid, numeric, text, uuid, text, uuid, uuid);
CREATE OR REPLACE FUNCTION public.create_payment_voucher(
    p_company_id uuid, p_party_id uuid, p_amount numeric, p_currency text,
    p_cash_account_id uuid, p_notes text DEFAULT NULL,
    p_reference_kind text DEFAULT NULL, p_reference_id uuid DEFAULT NULL,
    p_cost_center_id uuid DEFAULT NULL, p_exchange_rate numeric DEFAULT NULL
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
    v_kind text := NULLIF(lower(trim(COALESCE(p_reference_kind,''))),'');
    v_ok_ref boolean;
    v_currency text; v_base text; v_rate numeric; v_amt numeric; v_base_amt numeric;
    v_purchase_tx uuid; v_container uuid; v_remittance uuid;
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

    IF v_kind IS NOT NULL THEN
        IF v_kind NOT IN ('invoice','container','remittance') THEN
            RAISE EXCEPTION 'invalid_reference_kind';
        END IF;
        IF p_reference_id IS NULL THEN RAISE EXCEPTION 'reference_id_required'; END IF;

        IF v_kind = 'invoice' THEN
            SELECT true INTO v_ok_ref FROM purchase_transactions
             WHERE id = p_reference_id AND company_id = p_company_id
               AND (p_party_id IS NULL OR supplier_id = p_party_id);
            IF NOT COALESCE(v_ok_ref,false) THEN RAISE EXCEPTION 'invalid_reference'; END IF;
            v_purchase_tx := p_reference_id;
        ELSIF v_kind = 'container' THEN
            SELECT true INTO v_ok_ref FROM containers
             WHERE id = p_reference_id AND company_id = p_company_id;
            IF NOT COALESCE(v_ok_ref,false) THEN RAISE EXCEPTION 'invalid_reference'; END IF;
            v_container := p_reference_id;
        ELSE  -- remittance
            SELECT true INTO v_ok_ref FROM remittances
             WHERE id = p_reference_id AND company_id = p_company_id;
            IF NOT COALESCE(v_ok_ref,false) THEN RAISE EXCEPTION 'invalid_reference'; END IF;
            v_remittance := p_reference_id;
        END IF;
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

    v_base := COALESCE((SELECT default_currency FROM companies WHERE id = p_company_id), 'USD');
    v_currency := COALESCE(NULLIF(p_currency,''), v_base);
    v_rate := public.console_resolve_fx_rate(p_company_id, v_currency, v_base, p_exchange_rate);
    v_amt := round(p_amount, 2);
    v_base_amt := round(v_amt * v_rate, 2);

    v_do_post := (COALESCE((SELECT NULLIF(settings->>'operating_mode','') FROM companies WHERE id = p_company_id), 'workflow') = 'direct')
                 AND (v_admin OR public.console_special(v_user,'can_approve_transactions'));
    v_status := CASE WHEN v_do_post THEN 'confirmed' ELSE 'draft' END;
    v_method := CASE WHEN v_is_cash THEN 'cash' ELSE 'bank_transfer' END;

    v_number := 'PAY-'||to_char(now(),'YYYYMMDD')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);

    INSERT INTO payment_vouchers(
        tenant_id, company_id, voucher_number, voucher_date, supplier_id, supplier_name,
        amount, currency, exchange_rate, amount_in_base, payment_method, treasury_account_id,
        purchase_transaction_id, container_id, remittance_id,
        status, notes, created_by, created_at
    ) VALUES (
        v_tenant, p_company_id, v_number, CURRENT_DATE, p_party_id, v_supp_name,
        v_amt, v_currency, v_rate, v_base_amt, v_method, v_acct,
        v_purchase_tx, v_container, v_remittance,
        v_status, NULLIF(p_notes,''), v_user, now()
    ) RETURNING id, voucher_number INTO v_voucher_id, v_number;

    RETURN jsonb_build_object('ok', true, 'entry_id', v_voucher_id, 'entry_number', v_number,
                              'status', v_status, 'currency', v_currency, 'exchange_rate', v_rate,
                              'amount_in_base', v_base_amt);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- E) ENRICH console_create_journal_voucher — add trailing p_currency /
--    p_exchange_rate. DROP the 11-arg signature, recreate.
--
--    When currency = base (or rate 1): FC amounts == base amounts, rate 1 —
--    identical to the 20260707b behavior.
--    When currency <> base: DB `debit`/`credit` (and total_debit/total_credit)
--    carry the BASE amount (= foreign × rate); `debit_fc`/`credit_fc` carry the
--    FOREIGN amount. This is exactly what JournalVoucherTab reads back (DB
--    debit=local/base, debit_fc=foreign) — see FX header.
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.console_create_journal_voucher(uuid, text, uuid, uuid, numeric, uuid, text, uuid, text, uuid, text);
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
    p_notes text DEFAULT NULL,
    p_currency text DEFAULT NULL,
    p_exchange_rate numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean; v_can boolean;
    v_tenant uuid; v_branch uuid; v_base text; v_currency text; v_rate numeric;
    v_scoped uuid[];
    v_fund_ok boolean; v_fund_is_group boolean;
    v_cp_company uuid; v_cp_is_group boolean;
    v_fy uuid;
    v_fc numeric := round(COALESCE(p_amount,0),2);   -- foreign-currency face amount
    v_base_amt numeric;                              -- base amount for GL debit/credit
    v_do_post boolean; v_status text;
    v_entry_id uuid; v_number text;
    v_fund_debit numeric; v_fund_credit numeric;      -- base
    v_cp_debit numeric; v_cp_credit numeric;          -- base
    v_fund_debit_fc numeric; v_fund_credit_fc numeric;-- foreign
    v_cp_debit_fc numeric; v_cp_credit_fc numeric;    -- foreign
    v_desc text;
    v_ref_type text := NULLIF(p_reference_type,'');
    v_ref_id uuid := p_reference_id;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
    PERFORM assert_can_access_company(p_company_id);

    IF p_direction NOT IN ('in','out') THEN RAISE EXCEPTION 'invalid_direction'; END IF;
    IF v_fc <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
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

    -- counterparty: any non-group leaf of this company
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

    -- optional party validation (lenient — checks company when a party id is given)
    IF p_party_id IS NOT NULL AND p_party_type = 'customer' THEN
        IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_party_id AND company_id = p_company_id) THEN
            RAISE EXCEPTION 'invalid_party';
        END IF;
    ELSIF p_party_id IS NOT NULL AND p_party_type = 'supplier' THEN
        IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_party_id AND company_id = p_company_id) THEN
            RAISE EXCEPTION 'invalid_party';
        END IF;
    END IF;

    -- tenant / base + chosen currency / rate / fiscal year (branch NULL as the web service does)
    v_branch := NULL;
    SELECT tenant_id INTO v_tenant FROM companies WHERE id = p_company_id;
    BEGIN SELECT COALESCE(NULLIF(default_currency,''),'USD') INTO v_base FROM companies WHERE id = p_company_id;
    EXCEPTION WHEN OTHERS THEN v_base := 'USD'; END;
    v_currency := COALESCE(NULLIF(p_currency,''), v_base);
    v_rate := public.console_resolve_fx_rate(p_company_id, v_currency, v_base, p_exchange_rate);
    v_base_amt := round(v_fc * v_rate, 2);
    SELECT id INTO v_fy FROM fiscal_years WHERE company_id = p_company_id AND is_current = true LIMIT 1;

    -- posting policy
    v_do_post := (COALESCE((SELECT NULLIF(settings->>'operating_mode','') FROM companies WHERE id = p_company_id), 'workflow') = 'direct')
                 AND (v_admin OR public.console_special(v_user,'can_approve_transactions'));

    -- line direction — base amounts in debit/credit, foreign in *_fc
    IF p_direction = 'in' THEN
        v_fund_debit := v_base_amt; v_fund_credit := 0;
        v_cp_debit   := 0;          v_cp_credit   := v_base_amt;
        v_fund_debit_fc := v_fc;    v_fund_credit_fc := 0;
        v_cp_debit_fc   := 0;       v_cp_credit_fc   := v_fc;
        v_desc := COALESCE(NULLIF(p_notes,''), 'سند قبض (يومية) - قيد');
    ELSE
        v_fund_debit := 0;          v_fund_credit := v_base_amt;
        v_cp_debit   := v_base_amt; v_cp_credit   := 0;
        v_fund_debit_fc := 0;       v_fund_credit_fc := v_fc;
        v_cp_debit_fc   := v_fc;    v_cp_credit_fc   := 0;
        v_desc := COALESCE(NULLIF(p_notes,''), 'سند صرف (يومية) - قيد');
    END IF;

    v_number := 'JE-JV-'||to_char(now(),'YYYYMMDD')||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,8);

    INSERT INTO journal_entries (
        tenant_id, company_id, branch_id, entry_number, entry_date, fiscal_year_id, entry_type,
        reference_type, reference_id, description, currency, exchange_rate,
        total_debit, total_credit, status, is_posted, created_by, created_at
    ) VALUES (
        v_tenant, p_company_id, v_branch, v_number, CURRENT_DATE, v_fy, 'journal_voucher',
        v_ref_type, v_ref_id, v_desc, v_currency, v_rate,
        v_base_amt, v_base_amt, 'draft', false, v_user, now()
    ) RETURNING id INTO v_entry_id;

    -- Line 1: fund (is_fund_line=true) — no cost center / party / reference
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number, account_id, debit, credit, debit_fc, credit_fc,
        currency, exchange_rate, description, is_fund_line
    ) VALUES (
        v_tenant, v_entry_id, 1, p_fund_account_id, v_fund_debit, v_fund_credit,
        v_fund_debit_fc, v_fund_credit_fc, v_currency, v_rate, v_desc, true
    );

    -- Line 2: counterparty — carries cost center / party / reference
    INSERT INTO journal_entry_lines (
        tenant_id, entry_id, line_number, account_id, debit, credit, debit_fc, credit_fc,
        currency, exchange_rate, description, cost_center_id, party_type, party_id,
        reference_type, reference_id, is_fund_line
    ) VALUES (
        v_tenant, v_entry_id, 2, p_counterparty_account_id, v_cp_debit, v_cp_credit,
        v_cp_debit_fc, v_cp_credit_fc, v_currency, v_rate, v_desc,
        p_cost_center_id, NULLIF(p_party_type,''), p_party_id, v_ref_type, v_ref_id, false
    );

    IF v_do_post THEN
        PERFORM post_journal_entry(v_entry_id, v_user);
        v_status := 'posted';
    ELSE
        v_status := 'draft';
    END IF;

    RETURN jsonb_build_object('ok', true, 'entry_id', v_entry_id, 'entry_number', v_number,
                              'status', v_status, 'currency', v_currency, 'exchange_rate', v_rate,
                              'amount_base', v_base_amt);
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 🔐 GRANTS — authenticated only; explicitly revoke anon/public
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.get_console_currencies(uuid)',
        'public.get_console_remittances(uuid, text, int)',
        'public.console_resolve_fx_rate(uuid, text, text, numeric)',
        'public.create_payment_receipt(uuid, uuid, numeric, text, uuid, text, text, uuid, uuid, numeric)',
        'public.create_payment_voucher(uuid, uuid, numeric, text, uuid, text, text, uuid, uuid, numeric)',
        'public.console_create_journal_voucher(uuid, text, uuid, uuid, numeric, uuid, text, uuid, text, uuid, text, text, numeric)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        BEGIN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn); EXCEPTION WHEN OTHERS THEN NULL; END;
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END LOOP;
END $$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- CONTRACT SUMMARY (round 6 — voucher currency + reference parity)
-- ────────────────────────────────────────────────────────────────────────
-- get_console_currencies(p_company_id)
--   -> {ok, base_code, items:[{code, name(name_ar first), symbol, is_base,
--        exchange_rate}]}  — tenant currencies (resolved from company), is_active
--        only, base first then by code.
--   Gate(read): admin OR accounting|treasury read OR cashier.
--
-- get_console_remittances(p_company_id, p_query?, p_limit=20)
--   -> {ok, items:[{id, remittance_number, remittance_type, amount, currency,
--        status, counterparty_name}]}  — company remittances excluding
--        completed/cancelled, newest first; search by number/sender/receiver.
--        amount=COALESCE(total_from_customer,send_amount); currency=send_currency;
--        counterparty_name=COALESCE(receiver_name,sender_name).
--   Gate(read): admin OR accounting|treasury read OR cashier.
--
-- console_resolve_fx_rate(p_company_id, p_currency, p_base, p_supplied?)  [helper]
--   -> numeric BASE-per-FOREIGN multiply-rate (base = foreign × rate). 1 when
--        currency=base; p_supplied when >0; else exchange_rates direct
--        (from=currency→to=base, mid/buy) / inverse (1/rate) / currencies.
--        exchange_rate / 1. DB-only (no online-API tier).
--
-- create_payment_receipt(p_company_id, p_party_id, p_amount, p_currency,
--     p_cash_account_id, p_notes?, p_reference_kind?, p_reference_id?,
--     p_cost_center_id?, p_exchange_rate?)                              [ENRICHED]
--   -> {ok, entry_id, entry_number, status, currency, exchange_rate,
--        amount_in_base}
--   p_reference_kind ∈ invoice|order|container|remittance|NULL:
--     invoice|order → sales_transaction_id (this company; this customer when
--       given) — keeps sync_sales_invoice_paid_from_receipts live;
--     container → container_id; remittance → remittance_id (all validated).
--   Currency defaults to company base; exchange_rate resolved via helper;
--   amount_in_base = round(amount×rate,2). cost_center validated-but-unapplied.
--   Gate(write): admin OR treasury|accounting write OR cashier.
--
-- create_payment_voucher(... same shape ...)                           [ENRICHED]
--   p_reference_kind ∈ invoice|container|remittance|NULL:
--     invoice → purchase_transaction_id (this company; this supplier when given)
--       — link only, no purchase paid-sync trigger; container → container_id;
--     remittance → remittance_id.  ('order' rejected on the purchase path.)
--   Same currency/FX/amount_in_base handling. Gate as receipt.
--
-- console_create_journal_voucher(p_company_id, p_direction, p_fund_account_id,
--     p_counterparty_account_id, p_amount, p_cost_center_id?, p_reference_type?,
--     p_reference_id?, p_party_type?, p_party_id?, p_notes?,
--     p_currency?, p_exchange_rate?)                                    [ENRICHED]
--   -> {ok, entry_id, entry_number, status, currency, exchange_rate, amount_base}
--   Adds currency + FX: JE and both lines carry currency/exchange_rate; DB
--   debit/credit + total_debit/total_credit hold the BASE amount (foreign×rate),
--   debit_fc/credit_fc hold the FOREIGN amount. currency=base ⇒ fc==base, rate 1
--   (identical to 20260707b). Gate(write): admin OR treasury|accounting write OR
--   cashier.
--
-- OPEN QUESTION (flagged, NOT changed here): the GL triggers
-- create_payment_receipt_journal_entry (00013) / create_payment_voucher_journal_
-- entry (20260706a §6b) post NEW.amount (face, in NEW.currency) into BOTH `debit`
-- and `debit_fc` with NEW.exchange_rate — correct only for base currency. For a
-- confirmed NON-base receipt/voucher the resulting GL line's base value is the
-- unconverted foreign amount. amount_in_base on the row is now correct, but the
-- JE is not converted. Fixing that means editing those two triggers (multiply
-- debit/credit by exchange_rate, keep *_fc = face) — out of scope for round 6.
-- ════════════════════════════════════════════════════════════════════════
