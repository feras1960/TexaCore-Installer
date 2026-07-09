-- ════════════════════════════════════════════════════════════════════════
-- 📱 TexaCore Console — sales doc EDIT/CANCEL from mobile (round 2 follow-up)
-- ════════════════════════════════════════════════════════════════════════
-- Date: 2026-07-06
-- Author: Console server side (reviewed & applied by Fable — NOT auto-applied)
--
-- WHY: Feras wants sales docs openable AND editable from the console, within
-- the built workflow. Workflow rule enforced here: ONLY stage='draft' is
-- editable/cancellable from mobile. Confirmed/posted docs live in the
-- approval/posting flow (console_execute_item) and are NEVER mutated here.
--
-- CONVENTIONS (identical to 20260706a/b)
--   • SECURITY DEFINER + SET search_path = public, pg_temp.
--   • WRITE functions RAISE on forbidden (these are both writes).
--   • assert_can_access_company on the company resolved FROM the tx.
--   • REVOKE PUBLIC/anon + GRANT authenticated loop at the end.
--   • Reuses LIVE helpers: console_is_admin / console_has_perm.
--
-- SAFETY FACTS VERIFIED (2026-07-06)
--   • 'cancelled' is a legitimate stage: sales_transactions.stage CHECK
--     (20260215_phase1_unified_transactions.sql:228-240) includes 'cancelled'.
--   • Triggers on sales_transactions: trg_st_increment_version (version bump),
--     trg_sales_calc_balance (paid/balance recompute — desirable),
--     trg_sync_ecom_order_from_invoice (AFTER UPDATE OF stage — bails unless
--     source_type='ecommerce', and has NO branch for stage='cancelled').
--     => NO stock/GL side effects fire for a draft edited or cancelled here.
--   • Triggers on sales_transaction_items: trg_sti_updated_at (timestamp),
--     trg_sync_ecom_fulfilled_from_st (only when delivered_qty > 0 — our
--     re-inserted lines default delivered_qty=0). => delete+reinsert is safe.
--   • Drafts have no journal entry and no inventory movements (posting happens
--     only via the confirmation flow), so replacing lines is side-effect-free.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ════════════════════════════════════════════════════════════════════════
-- 1) console_update_sales_order(tx, items, notes?) — replace a DRAFT's lines
--    WRITE (RAISES). Gates: company (from tx) + sales write + owner-or-admin.
--    Only stage='draft'. Validates items BEFORE mutating anything.
--    SERVER-SIDE PRICING identical to console_create_sales_order:
--    fabric_materials.selling_price; client unit_price honored for admin only.
--    p_notes: NULL => keep existing notes; '' => clear; text => replace.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.console_update_sales_order(
    p_tx_id uuid, p_items jsonb, p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean;
    v_company uuid; v_stage text; v_created_by uuid;
    v_item jsonb;
    v_n int := 0;
    v_valid int := 0;
    v_mat uuid; v_qty numeric; v_price numeric; v_line_total numeric;
    v_subtotal numeric := 0;
    v_desc text; v_name text;
    v_doc_number text;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

    SELECT company_id, stage, created_by INTO v_company, v_stage, v_created_by
      FROM sales_transactions WHERE id = p_tx_id;
    IF v_company IS NULL THEN RAISE EXCEPTION 'tx_not_found'; END IF;
    PERFORM assert_can_access_company(v_company);   -- raises on cross-tenant

    v_admin := public.console_is_admin(v_user);
    IF NOT (v_admin OR public.console_has_perm(v_user,'sales','write')) THEN
        RAISE EXCEPTION 'forbidden: sales write required';
    END IF;
    -- a seller edits only their own drafts; admin edits any
    IF NOT v_admin AND (v_created_by IS NULL OR v_created_by <> v_user) THEN
        RAISE EXCEPTION 'forbidden: not your document';
    END IF;
    -- workflow rule: mobile edits drafts ONLY
    IF COALESCE(v_stage,'') <> 'draft' THEN
        RAISE EXCEPTION 'not_editable: stage=%', COALESCE(v_stage,'?');
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'empty_items';
    END IF;

    -- ── validate FIRST (all-invalid must not mutate anything) ──
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_mat := NULLIF(v_item->>'material_id','')::uuid;
        v_qty := COALESCE(NULLIF(v_item->>'quantity','')::numeric, 0);
        IF v_mat IS NOT NULL AND v_qty > 0 THEN v_valid := v_valid + 1; END IF;
    END LOOP;
    IF v_valid = 0 THEN RAISE EXCEPTION 'no_valid_items'; END IF;

    -- ── replace lines (drafts have no stock/GL side effects — verified) ──
    DELETE FROM sales_transaction_items WHERE transaction_id = p_tx_id;

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
              FROM fabric_materials WHERE id = v_mat AND company_id = v_company;
            v_price := COALESCE(v_price, 0);
        END IF;

        SELECT COALESCE(NULLIF(name_ar,''), NULLIF(name_en,''), code) INTO v_name
          FROM fabric_materials WHERE id = v_mat;
        v_desc := COALESCE(v_name, '');
        v_line_total := round(v_qty * v_price, 2);
        v_subtotal := v_subtotal + v_line_total;

        INSERT INTO sales_transaction_items(transaction_id, line_number, material_id,
                                            quantity, unit_price, subtotal, total, description)
          VALUES(p_tx_id, v_n, v_mat, v_qty, v_price, v_line_total, v_line_total, NULLIF(v_desc,''));
    END LOOP;

    UPDATE sales_transactions
       SET subtotal = round(v_subtotal,2),
           total_amount = round(v_subtotal,2),
           notes = CASE WHEN p_notes IS NULL THEN notes ELSE NULLIF(p_notes,'') END,
           updated_at = now(), updated_by = v_user
     WHERE id = p_tx_id;

    -- doc_number: same fallback chain as get_console_sales_docs
    SELECT COALESCE(NULLIF(st.invoice_no,''), NULLIF(st.order_no,''),
                    NULLIF(st.quotation_no,''), NULLIF(st.tracking_number,''),
                    'ST-'||upper(substr(st.id::text,1,8)))
      INTO v_doc_number
      FROM sales_transactions st WHERE st.id = p_tx_id;

    RETURN jsonb_build_object('ok', true, 'tx_id', p_tx_id, 'doc_number', v_doc_number,
        'stage', 'draft', 'items', v_n, 'total', round(v_subtotal,2));
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 2) console_cancel_sales_doc(tx) — cancel a DRAFT
--    WRITE (RAISES). Same gates (company from tx, sales write, owner-or-admin,
--    draft-only). Sets stage='cancelled' (legit CHECK value). No stock/GL
--    side effects exist for drafts (trigger audit above).
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.console_cancel_sales_doc(p_tx_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$
DECLARE
    v_user uuid := auth.uid();
    v_admin boolean;
    v_company uuid; v_stage text; v_created_by uuid;
BEGIN
    IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

    SELECT company_id, stage, created_by INTO v_company, v_stage, v_created_by
      FROM sales_transactions WHERE id = p_tx_id;
    IF v_company IS NULL THEN RAISE EXCEPTION 'tx_not_found'; END IF;
    PERFORM assert_can_access_company(v_company);

    v_admin := public.console_is_admin(v_user);
    IF NOT (v_admin OR public.console_has_perm(v_user,'sales','write')) THEN
        RAISE EXCEPTION 'forbidden: sales write required';
    END IF;
    IF NOT v_admin AND (v_created_by IS NULL OR v_created_by <> v_user) THEN
        RAISE EXCEPTION 'forbidden: not your document';
    END IF;
    IF COALESCE(v_stage,'') <> 'draft' THEN
        RAISE EXCEPTION 'not_cancellable: stage=%', COALESCE(v_stage,'?');
    END IF;

    UPDATE sales_transactions
       SET stage = 'cancelled', updated_at = now(), updated_by = v_user
     WHERE id = p_tx_id;

    RETURN jsonb_build_object('ok', true, 'tx_id', p_tx_id, 'stage', 'cancelled');
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- 🔐 GRANTS — authenticated only; explicitly revoke anon/public
-- ════════════════════════════════════════════════════════════════════════
DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'public.console_update_sales_order(uuid, jsonb, text)',
        'public.console_cancel_sales_doc(uuid)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        BEGIN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', fn); EXCEPTION WHEN OTHERS THEN NULL; END;
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END LOOP;
END $$;

COMMIT;

-- ════════════════════════════════════════════════════════════════════════
-- 📇 CONTRACT SUMMARY (the Flutter app codes against exactly these)
-- ════════════════════════════════════════════════════════════════════════
-- console_update_sales_order(p_tx_id uuid, p_items jsonb, p_notes text DEFAULT NULL)
--   p_items: [{material_id, quantity, unit_price?}]  (unit_price admin-only)
--   -> {ok, tx_id, doc_number, stage 'draft', items, total}
--   RAISES: unauthenticated | tx_not_found | forbidden (sales write / not your
--   document / cross-tenant) | 'not_editable: stage=<stage>' when stage<>'draft'
--   | empty_items | no_valid_items (raised BEFORE any mutation).
--   Replaces ALL lines (delete+reinsert) with server-side pricing; recomputes
--   subtotal/total_amount. p_notes: NULL keeps existing notes, '' clears, text
--   replaces. Stays stage='draft' — the normal approval flow posts it.
--
-- console_cancel_sales_doc(p_tx_id uuid)
--   -> {ok, tx_id, stage 'cancelled'}
--   RAISES: unauthenticated | tx_not_found | forbidden (same matrix) |
--   'not_cancellable: stage=<stage>' when stage<>'draft'.
--   No stock/GL side effects (drafts are unposted; triggers audited — the only
--   stage-change trigger is the ecommerce reverse-sync which ignores
--   non-ecommerce docs and has no 'cancelled' branch).
-- ════════════════════════════════════════════════════════════════════════
