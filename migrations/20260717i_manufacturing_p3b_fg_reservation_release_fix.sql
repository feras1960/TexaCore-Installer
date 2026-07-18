-- 20260717i: موديول التصنيع — P3b/إصلاح إلزامي — تحرير حجز الناتج للبيع (fg_for_sale) عند عكس الاستلام
-- ═══════════════════════════════════════════════════════════════════════════
-- خلفية (من تقرير P3a):
--   post_production_receipt (20260717e) يحجز الناتج النهائي لأوامر البيع المرتبطة (MTO):
--     صفوف mfg_material_reservations بنوع reservation_kind='fg_for_sale' + رفع inventory_stock.reserved_quantity
--     على مستودع التام (fg_warehouse_id).
--   عكس هذا الحجز كان ناقصاً في مسارَي التراجع:
--     • reverse_production_document('receipt') — لا يلمس حجوزات fg_for_sale إطلاقاً ⇒ يترك صفوفاً «active»
--       يتيمة و reserved_quantity منتفخاً بعد سحب الكمية المنتَجة. (الثغرة الحقيقية — تُصلَح هنا.)
--     • terminate_production_order — يستدعي release_production_reservations(order) الذي يمرّ على *كل*
--       الحجوزات النشطة (بلا فلتر نوع) ويخصم reserved_quantity لكل صفّ له product_id+warehouse_id.
--       بما أن صفّ fg_for_sale يحمل product_id (منتج الأمر) و warehouse_id (مستودع التام)، فهو *مشمول
--       أصلاً* ويُحرَّر عند الإنهاء. تُحقّق ذلك باختبار مُتراجَع أدناه — لا حاجة لتعديل terminate.
-- الإصلاح: CREATE OR REPLACE reverse_production_document بكامل جسمه الحيّ + منطق تحرير fg_for_sale في
--   فرع 'receipt': يُحرَّر بمقدار الكمية الرئيسية المعكوسة (منتج الأمر) عبر مستودع التام، FIFO على الصفوف.
-- idempotent: CREATE OR REPLACE فقط. لا تغيير على البنية.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.reverse_production_document(p_doc_type text, p_doc_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_ord     public.mfg_production_orders%ROWTYPE;
    v_iss     public.mfg_material_issues%ROWTYPE;
    v_ret     public.mfg_material_returns%ROWTYPE;
    v_rcp     public.mfg_finished_receipts%ROWTYPE;
    v_line    RECORD;
    v_idx     int := 0;
    v_total   numeric := 0;
    v_good    numeric := 0;
    v_scrap   numeric := 0;
    v_wh      uuid;
    v_qty     numeric;
    v_cost    numeric;
    v_je      uuid;
    -- P3b: تحرير حجز الناتج للبيع (fg_for_sale/MTO) عند عكس الاستلام
    v_primary_rev numeric := 0;
    v_fg_rel      numeric;
    v_rrow        RECORD;
    v_rel         numeric;
BEGIN
    IF p_doc_type = 'issue' THEN
        SELECT * INTO v_iss FROM public.mfg_material_issues WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند الصرف غير موجود'); END IF;
        IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_iss.company_id); END IF;
        IF v_iss.status <> 'posted' THEN RETURN jsonb_build_object('success', false, 'error', 'الصرف ليس مُرحَّلاً'); END IF;
        IF public.journal_period_is_locked(v_iss.company_id, v_iss.issue_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked'); END IF;
        SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_iss.production_order_id FOR UPDATE;

        FOR v_line IN SELECT * FROM public.mfg_material_issue_lines WHERE issue_id = p_doc_id ORDER BY created_at
        LOOP
            v_idx := v_idx + 1;
            v_qty := COALESCE(v_line.qty,0); v_cost := COALESCE(v_line.unit_cost,0);
            v_wh  := COALESCE(v_line.warehouse_id, v_ord.source_warehouse_id);
            INSERT INTO public.inventory_movements (
                tenant_id, company_id, movement_number, movement_date, movement_type,
                product_id, to_warehouse_id, quantity, unit_cost, total_cost,
                reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_iss.tenant_id, v_iss.company_id,
                'MREV-I-' || LEFT(p_doc_id::text,8) || '-' || v_idx, CURRENT_DATE, 'return_in',
                v_line.product_id, v_wh, v_qty, v_cost, v_cost * v_qty,
                'production_issue_reversal', p_doc_id, v_iss.issue_number, 'عكس صرف إنتاج', auth.uid());
            IF v_line.roll_id IS NOT NULL THEN
                UPDATE public.fabric_rolls
                   SET current_length = COALESCE(current_length,0) + v_qty,
                       status = CASE WHEN status='consumed' THEN 'available' ELSE status END, updated_at = now()
                 WHERE id = v_line.roll_id;
            END IF;
            IF v_line.batch_id IS NOT NULL THEN
                UPDATE public.inventory_batches SET current_quantity = COALESCE(current_quantity,0) + v_qty WHERE id = v_line.batch_id;
            END IF;
            v_total := v_total + (v_cost * v_qty);
        END LOOP;

        IF v_iss.journal_entry_id IS NOT NULL THEN PERFORM public.delete_journal_entry_soft(v_iss.journal_entry_id, 'عكس صرف إنتاج'); END IF;
        UPDATE public.mfg_material_issues SET status = 'reversed', updated_at = now() WHERE id = p_doc_id;
        UPDATE public.mfg_production_orders SET actual_material_cost = GREATEST(0, COALESCE(actual_material_cost,0) - v_total), updated_at = now() WHERE id = v_ord.id;
        RETURN jsonb_build_object('success', true, 'doc_type','issue', 'doc_id', p_doc_id, 'reversed_amount', v_total);

    ELSIF p_doc_type = 'return' THEN
        SELECT * INTO v_ret FROM public.mfg_material_returns WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند المرتجع غير موجود'); END IF;
        IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_ret.company_id); END IF;
        IF v_ret.status <> 'posted' THEN RETURN jsonb_build_object('success', false, 'error', 'المرتجع ليس مُرحَّلاً'); END IF;
        IF public.journal_period_is_locked(v_ret.company_id, v_ret.return_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked'); END IF;
        SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_ret.production_order_id FOR UPDATE;

        FOR v_line IN SELECT * FROM public.mfg_material_return_lines WHERE return_id = p_doc_id ORDER BY created_at
        LOOP
            v_idx := v_idx + 1;
            v_qty := COALESCE(v_line.qty,0); v_cost := COALESCE(v_line.unit_cost,0);
            v_wh  := COALESCE(v_line.warehouse_id, v_ord.source_warehouse_id);
            INSERT INTO public.inventory_movements (
                tenant_id, company_id, movement_number, movement_date, movement_type,
                product_id, from_warehouse_id, quantity, unit_cost, total_cost,
                reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_ret.tenant_id, v_ret.company_id,
                'MREV-R-' || LEFT(p_doc_id::text,8) || '-' || v_idx, CURRENT_DATE, 'issue',
                v_line.product_id, v_wh, v_qty, v_cost, v_cost * v_qty,
                'production_return_reversal', p_doc_id, v_ret.return_number, 'عكس مرتجع إنتاج', auth.uid());
            IF v_line.roll_id IS NOT NULL THEN
                UPDATE public.fabric_rolls SET current_length = GREATEST(0, COALESCE(current_length,0) - v_qty), updated_at = now() WHERE id = v_line.roll_id;
            END IF;
            IF v_line.batch_id IS NOT NULL THEN
                UPDATE public.inventory_batches SET current_quantity = GREATEST(0, COALESCE(current_quantity,0) - v_qty) WHERE id = v_line.batch_id;
            END IF;
            v_total := v_total + (v_cost * v_qty);
        END LOOP;

        IF v_ret.journal_entry_id IS NOT NULL THEN PERFORM public.delete_journal_entry_soft(v_ret.journal_entry_id, 'عكس مرتجع إنتاج'); END IF;
        UPDATE public.mfg_material_returns SET status = 'reversed', updated_at = now() WHERE id = p_doc_id;
        UPDATE public.mfg_production_orders SET actual_material_cost = COALESCE(actual_material_cost,0) + v_total, updated_at = now() WHERE id = v_ord.id;
        RETURN jsonb_build_object('success', true, 'doc_type','return', 'doc_id', p_doc_id, 'reversed_amount', v_total);

    ELSIF p_doc_type = 'receipt' THEN
        SELECT * INTO v_rcp FROM public.mfg_finished_receipts WHERE id = p_doc_id FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند الاستلام غير موجود'); END IF;
        IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_rcp.company_id); END IF;
        IF v_rcp.status <> 'posted' THEN RETURN jsonb_build_object('success', false, 'error', 'الاستلام ليس مُرحَّلاً'); END IF;
        IF public.journal_period_is_locked(v_rcp.company_id, v_rcp.receipt_date) THEN
            RETURN jsonb_build_object('success', false, 'error', 'period_locked'); END IF;
        -- حارس: منع العكس إن استُهلكت أي دفعة منتَجة لاحقاً (استهلاك أسفل السلسلة)
        IF EXISTS (
            SELECT 1 FROM public.mfg_finished_receipt_lines rl
            JOIN public.inventory_batches b ON b.id = rl.batch_id
            WHERE rl.receipt_id = p_doc_id AND COALESCE(b.current_quantity,0) < COALESCE(b.initial_quantity,0) - 0.0001
        ) THEN
            RETURN jsonb_build_object('success', false, 'error', 'لا يمكن عكس الاستلام: الدفعة المنتَجة استُهلكت جزئياً لاحقاً');
        END IF;
        SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_rcp.production_order_id FOR UPDATE;

        FOR v_line IN SELECT * FROM public.mfg_finished_receipt_lines WHERE receipt_id = p_doc_id ORDER BY created_at
        LOOP
            v_idx := v_idx + 1;
            v_qty := COALESCE(v_line.qty,0); v_cost := COALESCE(v_line.unit_cost,0);
            v_wh  := COALESCE(v_line.warehouse_id,
                        CASE WHEN v_line.output_role IN ('scrap','byproduct')
                             THEN COALESCE(v_ord.scrap_warehouse_id, v_ord.fg_warehouse_id) ELSE v_ord.fg_warehouse_id END);
            INSERT INTO public.inventory_movements (
                tenant_id, company_id, movement_number, movement_date, movement_type,
                product_id, from_warehouse_id, quantity, unit_cost, total_cost,
                reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_rcp.tenant_id, v_rcp.company_id,
                'MREV-C-' || LEFT(p_doc_id::text,8) || '-' || v_idx, CURRENT_DATE, 'issue',
                v_line.product_id, v_wh, v_qty, v_cost, v_cost * v_qty,
                'production_receipt_reversal', p_doc_id, v_rcp.receipt_number, 'عكس استلام إنتاج', auth.uid());
            IF v_line.batch_id IS NOT NULL THEN
                UPDATE public.inventory_batches
                   SET current_quantity = GREATEST(0, COALESCE(current_quantity,0) - v_qty), status = 'rejected'
                 WHERE id = v_line.batch_id;
            END IF;
            v_total := v_total + (v_cost * v_qty);
            IF v_line.output_role IN ('primary','co_product') THEN v_good := v_good + v_qty;
            ELSIF v_line.output_role = 'scrap' THEN v_scrap := v_scrap + v_qty; END IF;
            -- P3b: كمية الناتج الرئيسي (منتج الأمر) المعكوسة — أساس تحرير حجز البيع
            IF v_line.output_role = 'primary' AND v_line.product_id = v_ord.product_id THEN
                v_primary_rev := v_primary_rev + v_qty;
            END IF;
        END LOOP;

        -- ── P3b (إصلاح إلزامي): تحرير حجز الناتج للبيع (fg_for_sale/MTO) بمقدار الكمية الرئيسية المعكوسة ──
        -- نخصم reserved_quantity على مستودع التام ونحرّر/نُنقِص صفوف mfg_material_reservations النشطة FIFO.
        IF v_primary_rev > 0.000001 AND v_ord.fg_warehouse_id IS NOT NULL THEN
            v_fg_rel := v_primary_rev;
            FOR v_rrow IN
                SELECT * FROM public.mfg_material_reservations
                 WHERE production_order_id = v_ord.id AND reservation_kind = 'fg_for_sale' AND status = 'active'
                 ORDER BY created_at
                 FOR UPDATE
            LOOP
                EXIT WHEN v_fg_rel <= 0.000001;
                v_rel := LEAST(v_fg_rel, COALESCE(v_rrow.qty_reserved,0));
                IF v_rel <= 0.000001 THEN CONTINUE; END IF;
                UPDATE public.inventory_stock
                   SET reserved_quantity = GREATEST(0, COALESCE(reserved_quantity,0) - v_rel), updated_at = now()
                 WHERE product_id = v_rrow.product_id AND warehouse_id = v_rrow.warehouse_id;
                IF v_rel >= COALESCE(v_rrow.qty_reserved,0) - 0.000001 THEN
                    UPDATE public.mfg_material_reservations
                       SET status = 'released', released_at = now() WHERE id = v_rrow.id;
                ELSE
                    UPDATE public.mfg_material_reservations
                       SET qty_reserved = COALESCE(qty_reserved,0) - v_rel WHERE id = v_rrow.id;
                END IF;
                v_fg_rel := v_fg_rel - v_rel;
            END LOOP;
        END IF;

        IF v_rcp.journal_entry_id IS NOT NULL THEN PERFORM public.delete_journal_entry_soft(v_rcp.journal_entry_id, 'عكس استلام إنتاج'); END IF;
        UPDATE public.mfg_finished_receipts SET status = 'reversed', updated_at = now() WHERE id = p_doc_id;
        UPDATE public.mfg_production_orders SET
            received_cost = GREATEST(0, COALESCE(received_cost,0) - v_total),
            qty_produced  = GREATEST(0, COALESCE(qty_produced,0) - v_good),
            qty_scrapped  = GREATEST(0, COALESCE(qty_scrapped,0) - v_scrap),
            status = CASE WHEN status IN ('completed','closed') THEN 'in_progress' ELSE status END,
            updated_at = now()
        WHERE id = v_ord.id;
        RETURN jsonb_build_object('success', true, 'doc_type','receipt', 'doc_id', p_doc_id,
            'reversed_amount', v_total, 'fg_reservation_released', round(COALESCE(v_primary_rev,0),6));
    ELSE
        RETURN jsonb_build_object('success', false, 'error', 'نوع مستند غير مدعوم (issue|return|receipt)');
    END IF;
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;
COMMENT ON FUNCTION public.reverse_production_document(text,uuid) IS
  'عكس مخفي لمستند إنتاج مُرحَّل (issue|return|receipt) + عكس القيد. P3b: عكس الاستلام يحرّر حجز الناتج للبيع (fg_for_sale/MTO) بمقدار الكمية الرئيسية المعكوسة (reserved_quantity + صفوف الحجز). ذرّي.';
GRANT EXECUTE ON FUNCTION public.reverse_production_document(text,uuid) TO authenticated, service_role;
