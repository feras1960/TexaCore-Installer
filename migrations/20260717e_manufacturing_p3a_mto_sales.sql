-- 20260717e: موديول التصنيع — P3a/Migration 2 — التكامل التجاري (MTO) + حجز الناتج + التوفّر
-- ═══════════════════════════════════════════════════════════════════════════
-- يبني على 20260717d. يشمل (§3.6 · §3.7 · §4-د/18):
--   • CREATE OR REPLACE post_production_receipt — كامل جسم P2 + P3a:
--       – حالة دفعات الاستلام من الإعدادات + المعالجة الزمنية (hold_until من curing_hold_days)
--         + وسم production_order_id على الدفعة + جدولة فحوص مؤجلة من قالب BOM.
--       – حجز الناتج النهائي لأوامر البيع المرتبطة (MTO) عبر عدّاد inventory_stock.reserved_quantity
--         (نفس آلية دورة المبيعات) + تفصيل في mfg_material_reservations (fg_for_sale).
--       – FEFO في backflush الاستلام يستبعد المحجوز/المرفوض/المنتهي.
--   • create_production_order_from_sale — إنشاء أمر إنتاج مسودة مرتبط بأمر بيع (mfg_order_sales_links).
--   • mfg_order_availability — لكل بند: مطلوب/متاح/محجوز/متوقع (مؤشرات ضوئية بنمط Katana).
--   • producible_qty — تفكيك BOM متعدد المستويات مقابل المخزون → أقصى كمية + المادة الخانقة.
-- قرارات التكامل (مذكورة بالكود):
--   • ترقيم أمر MTO: يبقى ترقيم التصنيع القياسي (MFG-ORD…) عند التأكيد؛ مرجع البيع يُخزّن في notes
--     ووصلة mfg_order_sales_links (لا لصق '/1' على order_number — نتّبع §4-ج/30 لا تسمية Katana الحرفية).
--   • آلية حجز الناتج: عدّاد reserved_quantity (أقل تدخّل) — راجع post_production_receipt.
-- idempotent: CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) create_production_order_from_sale — أمر إنتاج مسودة مرتبط بأمر بيع (MTO)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_production_order_from_sale(
    p_sales_transaction_id uuid, p_item_id uuid, p_qty numeric, p_bom_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_tx    public.sales_transactions%ROWTYPE;
    v_item  public.sales_transaction_items%ROWTYPE;
    v_bom   uuid;
    v_prod  uuid;
    v_set   public.mfg_settings%ROWTYPE;
    v_ord_id uuid;
    v_saleno text;
BEGIN
    IF COALESCE(p_qty,0) <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'الكمية غير صالحة'); END IF;
    SELECT * INTO v_tx FROM public.sales_transactions WHERE id = p_sales_transaction_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'أمر البيع غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_tx.company_id); END IF;

    SELECT * INTO v_item FROM public.sales_transaction_items
     WHERE id = p_item_id AND transaction_id = p_sales_transaction_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'بند البيع غير موجود'); END IF;
    v_prod := v_item.product_id;
    IF v_prod IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'البند بلا منتج (مادة فقط) — لا يُصنَّع'); END IF;

    -- BOM: المُمرَّر → default_bom_id للمنتج → أحدث BOM معتمدة افتراضية
    v_bom := p_bom_id;
    IF v_bom IS NULL THEN
        SELECT default_bom_id INTO v_bom FROM public.products WHERE id = v_prod;
    END IF;
    IF v_bom IS NULL THEN
        SELECT id INTO v_bom FROM public.mfg_boms
         WHERE product_id = v_prod AND company_id = v_tx.company_id AND status = 'approved'
         ORDER BY is_default DESC, version DESC LIMIT 1;
    END IF;

    SELECT * INTO v_set FROM public.mfg_settings
     WHERE tenant_id = v_tx.tenant_id AND company_id = v_tx.company_id LIMIT 1;

    v_saleno := COALESCE(v_tx.order_no, v_tx.reservation_no, v_tx.quotation_no, v_tx.draft_no, LEFT(v_tx.id::text,8));

    INSERT INTO public.mfg_production_orders (
        tenant_id, company_id, branch_id, product_id, bom_id, qty_planned, status,
        source_warehouse_id, wip_warehouse_id, fg_warehouse_id, scrap_warehouse_id,
        notes, created_by)
    VALUES (v_tx.tenant_id, v_tx.company_id, v_tx.branch_id, v_prod, v_bom, p_qty, 'draft',
        COALESCE(v_item.warehouse_id, v_tx.warehouse_id, v_set.default_wip_warehouse_id),
        v_set.default_wip_warehouse_id, v_set.default_fg_warehouse_id, v_set.default_scrap_warehouse_id,
        'MTO — أمر بيع ' || v_saleno, auth.uid())
    RETURNING id INTO v_ord_id;

    INSERT INTO public.mfg_order_sales_links (
        tenant_id, company_id, order_id, sales_transaction_id, qty_allocated)
    VALUES (v_tx.tenant_id, v_tx.company_id, v_ord_id, p_sales_transaction_id, p_qty);

    RETURN jsonb_build_object('success', true, 'order_id', v_ord_id, 'bom_id', v_bom,
        'product_id', v_prod, 'sale_ref', v_saleno,
        'note', CASE WHEN v_bom IS NULL THEN 'لا BOM معتمدة — عيّنها قبل التأكيد' ELSE NULL END);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.create_production_order_from_sale(uuid,uuid,numeric,uuid) IS
  'MTO: إنشاء أمر إنتاج مسودة لمنتج بند بيع + وصلة mfg_order_sales_links. رقم البيع في notes؛ ترقيم التصنيع القياسي عند التأكيد.';
GRANT EXECUTE ON FUNCTION public.create_production_order_from_sale(uuid,uuid,numeric,uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) mfg_order_availability — لكل بند لقطة الأمر: مطلوب/متاح/محجوز/متوقع (مؤشرات ضوئية)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mfg_order_availability(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_ord   public.mfg_production_orders%ROWTYPE;
    v_out   jsonb := '[]'::jsonb;
    v_ln    RECORD;
    v_onh   numeric;
    v_rsv   numeric;
    v_exp   numeric;
BEGIN
    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = p_order_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الأمر غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_ord.company_id); END IF;
    IF v_ord.bom_snapshot IS NULL THEN
        RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'lines', '[]'::jsonb,
            'note', 'الأمر غير مؤكد بعد (لا لقطة BOM)');
    END IF;

    FOR v_ln IN
        SELECT (l->>'component_product_id')::uuid AS pid,
               (l->>'required_qty')::numeric AS req
        FROM jsonb_array_elements(v_ord.bom_snapshot->'lines') l
        WHERE (l->>'component_product_id') IS NOT NULL
    LOOP
        SELECT COALESCE(SUM(quantity_on_hand),0), COALESCE(SUM(reserved_quantity),0)
          INTO v_onh, v_rsv
          FROM public.inventory_stock
         WHERE product_id = v_ln.pid AND warehouse_id = v_ord.source_warehouse_id;
        -- المتوقّع: أوامر إنتاج أخرى (مؤكدة/جارية) تُنتج هذا المكوّن كمنتج نهائي لها
        SELECT COALESCE(SUM(GREATEST(qty_planned - COALESCE(qty_produced,0),0)),0) INTO v_exp
          FROM public.mfg_production_orders
         WHERE product_id = v_ln.pid AND company_id = v_ord.company_id
           AND status IN ('confirmed','in_progress') AND id <> p_order_id AND NOT COALESCE(is_deleted,false);
        v_out := v_out || jsonb_build_object(
            'product_id', v_ln.pid, 'required', round(COALESCE(v_ln.req,0),6),
            'on_hand', v_onh, 'reserved', v_rsv,
            'available', round(GREATEST(v_onh - v_rsv,0),6), 'expected', v_exp,
            'status', CASE WHEN GREATEST(v_onh - v_rsv,0) >= COALESCE(v_ln.req,0) THEN 'ok'
                           WHEN GREATEST(v_onh - v_rsv,0) + v_exp >= COALESCE(v_ln.req,0) THEN 'expected'
                           ELSE 'short' END);
    END LOOP;

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'lines', v_out);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.mfg_order_availability(uuid) IS
  'توفّر مواد الأمر لكل بند لقطة: on_hand/reserved/available/expected + حالة ضوئية (ok/expected/short) — لواجهة المؤشرات (§3.6).';
GRANT EXECUTE ON FUNCTION public.mfg_order_availability(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) producible_qty — «كم أستطيع أن أنتج الآن؟» (§4-د/18) — تفكيك متعدد المستويات مقابل المخزون
--    per-unit فعّال لكل مكوّن ورقة (raw) = Σ عبر المستويات، مع تعديل scrap/yield لكل مستوى.
--    p_warehouse_id NULL ⇒ إجمالي المخزون عبر مستودعات الشركة.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.producible_qty(
    p_bom_id uuid, p_warehouse_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_bom     public.mfg_boms%ROWTYPE;
    v_comps   jsonb := '[]'::jsonb;
    v_max     numeric := NULL;
    v_bott    uuid := NULL;
    v_r       RECORD;
    v_avail   numeric;
    v_can     numeric;
BEGIN
    SELECT * INTO v_bom FROM public.mfg_boms WHERE id = p_bom_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'قائمة المواد غير موجودة'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_bom.company_id); END IF;

    -- تفكيك recursive متعدد المستويات: per-unit فعّال لكل مكوّن (ورقة فقط)
    FOR v_r IN
        WITH RECURSIVE exploded AS (
            -- المستوى الأول: بنود BOM الجذر (per-unit لوحدة منتج واحدة)
            SELECT bl.component_product_id AS pid,
                   bl.component_bom_id     AS sub_bom,
                   ( CASE WHEN v_bom.bom_basis = 'formula'
                          THEN COALESCE(bl.qty_per_unit,0) / NULLIF(v_bom.quantity,0)
                          ELSE COALESCE(bl.qty_per_unit,0) END
                     * (1 + COALESCE(bl.scrap_pct,0)/100.0)
                     / (COALESCE(NULLIF(v_bom.yield_pct,0),100)/100.0) )::numeric AS qpu
            FROM public.mfg_bom_lines bl
            WHERE bl.bom_id = p_bom_id
            UNION ALL
            -- المستويات الأدنى: نضرب per-unit الأب في per-unit الابن ضمن BOM الفرعي
            SELECT cbl.component_product_id,
                   cbl.component_bom_id,
                   ( e.qpu
                     * CASE WHEN cb.bom_basis = 'formula'
                            THEN COALESCE(cbl.qty_per_unit,0) / NULLIF(cb.quantity,0)
                            ELSE COALESCE(cbl.qty_per_unit,0) END
                     * (1 + COALESCE(cbl.scrap_pct,0)/100.0)
                     / (COALESCE(NULLIF(cb.yield_pct,0),100)/100.0) )::numeric
            FROM exploded e
            JOIN public.mfg_boms   cb  ON cb.id = e.sub_bom
            JOIN public.mfg_bom_lines cbl ON cbl.bom_id = e.sub_bom
            WHERE e.sub_bom IS NOT NULL
        )
        SELECT pid, SUM(qpu) AS need_per_unit
        FROM exploded
        WHERE sub_bom IS NULL AND pid IS NOT NULL
        GROUP BY pid
    LOOP
        IF COALESCE(v_r.need_per_unit,0) <= 0 THEN CONTINUE; END IF;
        SELECT COALESCE(SUM(quantity_on_hand),0) INTO v_avail
          FROM public.inventory_stock
         WHERE product_id = v_r.pid
           AND (p_warehouse_id IS NULL OR warehouse_id = p_warehouse_id)
           AND (p_warehouse_id IS NOT NULL OR company_id = v_bom.company_id);
        v_can := floor(COALESCE(v_avail,0) / v_r.need_per_unit);
        v_comps := v_comps || jsonb_build_object(
            'product_id', v_r.pid, 'need_per_unit', round(v_r.need_per_unit,8),
            'available', v_avail, 'producible', v_can);
        IF v_max IS NULL OR v_can < v_max THEN v_max := v_can; v_bott := v_r.pid; END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'bom_id', p_bom_id,
        'max_producible', COALESCE(v_max,0), 'bottleneck_product_id', v_bott, 'components', v_comps);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.producible_qty(uuid,uuid) IS
  'أقصى كمية قابلة للإنتاج الآن من BOM (تفكيك متعدد المستويات component_bom_id مقابل المخزون) + المادة الخانقة (§4-د/18). يعمّم حساب P1b.';
GRANT EXECUTE ON FUNCTION public.producible_qty(uuid,uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) CREATE OR REPLACE post_production_receipt — كامل جسم P2 + P3a (حالة الدفعة/المعالجة/الفحوص + حجز MTO)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.post_production_receipt(
    p_receipt_id uuid, p_override boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_rcp        public.mfg_finished_receipts%ROWTYPE;
    v_ord        public.mfg_production_orders%ROWTYPE;
    v_has_stages boolean;
    v_last_done  boolean;
    v_good_qty   numeric := 0;
    v_scrap_qty  numeric := 0;
    v_pool       numeric;
    v_remaining  numeric;
    v_share      numeric;
    v_receipt_c  numeric;
    v_credit     numeric := 0;
    v_co_cost    numeric := 0;
    v_primary_q  numeric := 0;
    v_primary_c  numeric;
    v_unit_primary numeric := 0;
    v_line       RECORD;
    v_prod       public.products%ROWTYPE;
    v_settings   public.mfg_settings%ROWTYPE;
    v_uc         numeric;
    v_wh         uuid;
    v_batch_id   uuid;
    v_batch_no   text;
    v_expiry     date;
    v_mv_id      uuid;
    v_consumed   numeric := 0;
    v_idx        int := 0;
    v_num        text;
    v_fmt        text;
    -- إصلاح Backflush بلا مراحل:
    v_bln        RECORD;
    v_issued     numeric;
    v_returned   numeric;
    v_remainder  numeric;
    v_avail_bf   numeric;
    v_allow_neg  boolean;
    v_shortage   jsonb := '[]'::jsonb;
    v_bf_issue   uuid;
    v_bf_lines   int := 0;
    v_bf_batch   uuid;
    v_post       jsonb;
    -- GL:
    v_inv_acct   uuid;
    v_je         uuid;
    -- P3a — حجر الجودة/المعالجة الزمنية + فحوص مؤجلة (M1) :
    v_batch_status text;
    v_line_status  text;
    v_curing_days  int := 0;
    v_qc_template  jsonb;
    v_hold_until   timestamptz;
    v_held_reason  text;
    -- P3a — حجز الناتج النهائي لأوامر البيع (M2 · MTO §3.6/§3.7-3) :
    v_fg_batch_id  uuid;
    v_primary_recv numeric := 0;
    v_link         RECORD;
    v_take         numeric;
    v_rem_link     numeric;
    v_fg_reserved  numeric := 0;
BEGIN
    SELECT * INTO v_rcp FROM public.mfg_finished_receipts WHERE id = p_receipt_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند الاستلام غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_rcp.company_id); END IF;
    IF v_rcp.status <> 'draft' THEN
        RETURN jsonb_build_object('success', false, 'error', 'الاستلام ليس بحالة مسودة (الحالة: ' || v_rcp.status || ')');
    END IF;
    IF public.journal_period_is_locked(v_rcp.company_id, v_rcp.receipt_date) THEN
        RETURN jsonb_build_object('success', false, 'error', 'period_locked');
    END IF;

    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_rcp.production_order_id FOR UPDATE;
    SELECT * INTO v_settings FROM public.mfg_settings
     WHERE tenant_id = v_ord.tenant_id AND company_id = v_ord.company_id LIMIT 1;
    v_fmt := COALESCE(v_settings.batch_number_format, '{product}-{yymmdd}-{seq}');
    v_allow_neg := COALESCE(v_settings.allow_negative_wip,false) OR p_override;

    -- ── P3a: حالة دفعات الاستلام + المعالجة الزمنية (curing) + قالب الفحوص المؤجلة (من BOM) ──
    SELECT COALESCE(curing_hold_days,0), deferred_qc_template
      INTO v_curing_days, v_qc_template
      FROM public.mfg_boms WHERE id = v_ord.bom_id;
    v_curing_days := COALESCE(v_curing_days,0);
    -- الحالة الافتراضية للدفعة المنتَجة: إعداد المستأجر (available|on_hold)؛ المعالجة الزمنية تفرض الحجر.
    v_batch_status := COALESCE(v_settings.receipt_batch_status, 'available');
    IF v_curing_days > 0 THEN v_batch_status := 'on_hold'; END IF;
    v_hold_until := CASE WHEN v_curing_days > 0
                         THEN (v_rcp.receipt_date + (v_curing_days || ' days')::interval)::timestamptz ELSE NULL END;
    v_held_reason := CASE WHEN v_curing_days > 0 THEN 'معالجة/تجفيف زمني (' || v_curing_days || ' يوم)'
                          WHEN v_batch_status = 'on_hold' THEN 'حجر جودة عند الاستلام' ELSE NULL END;

    SELECT EXISTS (SELECT 1 FROM public.mfg_order_stages WHERE production_order_id = v_ord.id) INTO v_has_stages;
    IF v_has_stages THEN
        SELECT bool_and(status = 'done') INTO v_last_done FROM public.mfg_order_stages
         WHERE production_order_id = v_ord.id
           AND seq = (SELECT MAX(seq) FROM public.mfg_order_stages WHERE production_order_id = v_ord.id);
        IF NOT COALESCE(v_last_done,false) AND NOT p_override THEN
            RETURN jsonb_build_object('success', false, 'error', 'المرحلة الأخيرة لم تكتمل بعد');
        END IF;
    END IF;

    -- ── إصلاح: Backflush عند الاستلام للأوامر بلا مراحل (§4-ج/2) ──
    -- يصرف المتبقّي غير المصروف من بنود backflush = required − (صافي المصروف = مصروف − مُرجَع).
    -- يحافظ على مسار الصرف اليدوي (المتبقّي فقط). النقص يُرجَع {success:false, shortage:[...]}.
    IF NOT v_has_stages AND v_ord.bom_snapshot IS NOT NULL THEN
        FOR v_bln IN
            SELECT (l->>'component_product_id')::uuid AS pid,
                   (l->>'line_id')::uuid AS bl_id,
                   (l->>'required_qty')::numeric AS req,
                   COALESCE((l->>'requires_batch')::boolean,false) AS req_batch
            FROM jsonb_array_elements(v_ord.bom_snapshot->'lines') l
            WHERE COALESCE(l->>'issue_method','backflush') = 'backflush'
              AND (l->>'component_product_id') IS NOT NULL
        LOOP
            SELECT COALESCE(SUM(il.qty),0) INTO v_issued
              FROM public.mfg_material_issue_lines il JOIN public.mfg_material_issues i ON i.id = il.issue_id
             WHERE i.production_order_id = v_ord.id AND i.status = 'posted' AND il.bom_line_id = v_bln.bl_id;
            SELECT COALESCE(SUM(rl.qty),0) INTO v_returned
              FROM public.mfg_material_return_lines rl JOIN public.mfg_material_returns r ON r.id = rl.return_id
              JOIN public.mfg_material_issue_lines il2 ON il2.id = rl.issue_line_id
             WHERE r.status = 'posted' AND il2.bom_line_id = v_bln.bl_id;
            v_remainder := COALESCE(v_bln.req,0) - (COALESCE(v_issued,0) - COALESCE(v_returned,0));
            IF v_remainder <= 0.0001 THEN CONTINUE; END IF;
            SELECT COALESCE(quantity_on_hand,0) INTO v_avail_bf
              FROM public.inventory_stock WHERE product_id = v_bln.pid AND warehouse_id = v_ord.source_warehouse_id LIMIT 1;
            IF COALESCE(v_avail_bf,0) < v_remainder - 0.01 AND NOT v_allow_neg THEN
                v_shortage := v_shortage || jsonb_build_object('product_id', v_bln.pid,
                    'required', round(v_remainder,6), 'available', COALESCE(v_avail_bf,0));
            END IF;
        END LOOP;

        IF jsonb_array_length(v_shortage) > 0 THEN
            PERFORM public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['production_manager'],
                'نقص مواد يمنع استلام الإنتاج', 'الأمر ' || COALESCE(v_ord.order_number,'') || ' (backflush الاستلام)',
                '/manufacturing?order=' || v_ord.id, 'mfg_shortage', '⛔');
            RETURN jsonb_build_object('success', false, 'error', 'نقص مواد للـBackflush عند الاستلام', 'shortage', v_shortage);
        END IF;

        INSERT INTO public.mfg_material_issues (
            tenant_id, company_id, production_order_id, issue_date, status, is_backflush)
        VALUES (v_ord.tenant_id, v_ord.company_id, v_ord.id, v_rcp.receipt_date, 'draft', true)
        RETURNING id INTO v_bf_issue;

        FOR v_bln IN
            SELECT (l->>'component_product_id')::uuid AS pid,
                   (l->>'line_id')::uuid AS bl_id,
                   (l->>'required_qty')::numeric AS req,
                   COALESCE((l->>'requires_batch')::boolean,false) AS req_batch
            FROM jsonb_array_elements(v_ord.bom_snapshot->'lines') l
            WHERE COALESCE(l->>'issue_method','backflush') = 'backflush'
              AND (l->>'component_product_id') IS NOT NULL
        LOOP
            SELECT COALESCE(SUM(il.qty),0) INTO v_issued
              FROM public.mfg_material_issue_lines il JOIN public.mfg_material_issues i ON i.id = il.issue_id
             WHERE i.production_order_id = v_ord.id AND i.status = 'posted' AND il.bom_line_id = v_bln.bl_id;
            SELECT COALESCE(SUM(rl.qty),0) INTO v_returned
              FROM public.mfg_material_return_lines rl JOIN public.mfg_material_returns r ON r.id = rl.return_id
              JOIN public.mfg_material_issue_lines il2 ON il2.id = rl.issue_line_id
             WHERE r.status = 'posted' AND il2.bom_line_id = v_bln.bl_id;
            v_remainder := COALESCE(v_bln.req,0) - (COALESCE(v_issued,0) - COALESCE(v_returned,0));
            IF v_remainder <= 0.0001 THEN CONTINUE; END IF;
            v_bf_batch := NULL;
            IF v_bln.req_batch THEN
                -- FEFO: استبعاد المحجوز/المرفوض (P3a) والمنتهي — الأقرب انتهاءً أولاً
                SELECT id INTO v_bf_batch FROM public.inventory_batches
                 WHERE product_id = v_bln.pid AND warehouse_id = v_ord.source_warehouse_id AND COALESCE(current_quantity,0) > 0
                   AND COALESCE(status,'available') IN ('available','released')
                   AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
                 ORDER BY expiry_date NULLS LAST, received_date NULLS LAST LIMIT 1;
            END IF;
            INSERT INTO public.mfg_material_issue_lines (
                tenant_id, company_id, issue_id, product_id, bom_line_id, qty, warehouse_id, batch_id)
            VALUES (v_ord.tenant_id, v_ord.company_id, v_bf_issue, v_bln.pid, v_bln.bl_id, round(v_remainder,6), v_ord.source_warehouse_id, v_bf_batch);
            v_bf_lines := v_bf_lines + 1;
        END LOOP;

        IF v_bf_lines > 0 THEN
            v_post := public.post_material_issue(v_bf_issue, p_override);
            IF NOT COALESCE((v_post->>'success')::boolean,false) THEN
                RAISE EXCEPTION 'فشل Backflush الاستلام: %', COALESCE(v_post->>'error','غير معروف');
            END IF;
            -- إعادة قراءة تكاليف الأمر بعد الصرف الآلي
            SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_ord.id FOR UPDATE;
        ELSE
            DELETE FROM public.mfg_material_issues WHERE id = v_bf_issue;
            v_bf_issue := NULL;
        END IF;
    END IF;

    SELECT COALESCE(SUM(qty) FILTER (WHERE output_role IN ('primary','co_product')),0),
           COALESCE(SUM(qty) FILTER (WHERE output_role = 'scrap'),0)
      INTO v_good_qty, v_scrap_qty
      FROM public.mfg_finished_receipt_lines WHERE receipt_id = p_receipt_id;

    IF (COALESCE(v_ord.qty_produced,0) + v_good_qty) > v_ord.qty_planned * (1 + COALESCE(v_ord.overproduction_pct,0)/100.0) + 0.01
       AND NOT p_override THEN
        RETURN jsonb_build_object('success', false, 'error',
            'تجاوز الكمية المخطّطة + سماحية الفائض (' || v_ord.overproduction_pct || '%)');
    END IF;

    v_pool := GREATEST(0, COALESCE(v_ord.actual_material_cost,0) + COALESCE(v_ord.actual_labor_cost,0)
              + COALESCE(v_ord.actual_overhead_cost,0) + COALESCE(v_ord.subcontract_cost,0)
              - COALESCE(v_ord.received_cost,0));
    v_remaining := GREATEST(v_ord.qty_planned - COALESCE(v_ord.qty_produced,0), v_good_qty);
    v_share := CASE WHEN v_remaining > 0 THEN LEAST(v_good_qty / v_remaining, 1) ELSE 1 END;
    v_receipt_c := CASE WHEN v_good_qty > 0 THEN v_pool * v_share ELSE 0 END;

    SELECT COALESCE(SUM(COALESCE(rl.unit_cost,
              (SELECT o.recovery_rate FROM public.mfg_bom_outputs o
                WHERE o.bom_id = v_ord.bom_id AND o.product_id = rl.product_id AND o.output_role = rl.output_role LIMIT 1),
              0) * COALESCE(rl.qty,0)), 0)
      INTO v_credit FROM public.mfg_finished_receipt_lines rl
     WHERE rl.receipt_id = p_receipt_id AND rl.output_role IN ('byproduct','scrap');

    SELECT COALESCE(SUM(v_receipt_c * COALESCE(rl.cost_share_pct,
              (SELECT o.cost_share_pct FROM public.mfg_bom_outputs o
                WHERE o.bom_id = v_ord.bom_id AND o.product_id = rl.product_id AND o.output_role='co_product' LIMIT 1),
              0) / 100.0), 0)
      INTO v_co_cost
      FROM public.mfg_finished_receipt_lines rl
     WHERE rl.receipt_id = p_receipt_id AND rl.output_role = 'co_product';
    SELECT COALESCE(SUM(qty) FILTER (WHERE output_role='primary'),0) INTO v_primary_q
      FROM public.mfg_finished_receipt_lines WHERE receipt_id = p_receipt_id;

    v_primary_c := GREATEST(0, v_receipt_c - v_co_cost - v_credit);
    v_unit_primary := CASE WHEN v_primary_q > 0 THEN v_primary_c / v_primary_q ELSE 0 END;

    FOR v_line IN SELECT * FROM public.mfg_finished_receipt_lines WHERE receipt_id = p_receipt_id ORDER BY created_at
    LOOP
        v_idx := v_idx + 1;
        SELECT * INTO v_prod FROM public.products WHERE id = v_line.product_id;
        v_wh := COALESCE(v_line.warehouse_id,
                  CASE WHEN v_line.output_role IN ('scrap','byproduct')
                       THEN COALESCE(v_ord.scrap_warehouse_id, v_ord.fg_warehouse_id)
                       ELSE v_ord.fg_warehouse_id END);
        IF v_wh IS NULL THEN RAISE EXCEPTION 'لا يوجد مستودع لسطر الاستلام % (المنتج %)', v_idx, v_line.product_id; END IF;

        v_uc := CASE
            WHEN v_line.output_role = 'primary' THEN v_unit_primary
            WHEN v_line.output_role = 'co_product' THEN
                (v_receipt_c * COALESCE(v_line.cost_share_pct,
                   (SELECT o.cost_share_pct FROM public.mfg_bom_outputs o
                     WHERE o.bom_id = v_ord.bom_id AND o.product_id = v_line.product_id AND o.output_role='co_product' LIMIT 1),
                   0) / 100.0) / NULLIF(v_line.qty,0)
            ELSE COALESCE(v_line.unit_cost,
                   (SELECT o.recovery_rate FROM public.mfg_bom_outputs o
                     WHERE o.bom_id = v_ord.bom_id AND o.product_id = v_line.product_id AND o.output_role = v_line.output_role LIMIT 1),
                   0)
        END;
        v_uc := COALESCE(v_uc, 0);

        IF (COALESCE(v_prod.track_batch,false) OR v_prod.shelf_life_days IS NOT NULL OR v_line.batch_id IS NOT NULL)
           AND v_line.output_role IN ('primary','co_product','byproduct') THEN
            IF v_line.batch_id IS NULL THEN
                -- إصلاح B1: تسلسل رقم دفعة آمن للتزامن لكل (مستأجر,منتج,يوم) — لا يعتمد على فهرس السطر
                v_batch_no := replace(replace(replace(v_fmt,
                    '{product}', COALESCE(v_prod.sku, LEFT(v_line.product_id::text,8))),
                    '{yymmdd}', to_char(v_rcp.receipt_date,'YYMMDD')),
                    '{seq}', lpad(public.mfg_next_batch_seq(v_ord.tenant_id, v_ord.company_id, v_line.product_id, v_rcp.receipt_date)::text, 3, '0'));
                v_expiry := CASE WHEN v_prod.shelf_life_days IS NOT NULL
                                 THEN v_rcp.receipt_date + (v_prod.shelf_life_days || ' days')::interval ELSE NULL END;
                -- P3a: الحجر/المعالجة يطبَّقان على المخرجات الرئيسية والمشتركة فقط (لا الخردة/الثانوي)
                v_line_status := CASE WHEN v_line.output_role IN ('primary','co_product') THEN v_batch_status ELSE 'available' END;
                INSERT INTO public.inventory_batches (
                    tenant_id, company_id, product_id, warehouse_id, batch_number,
                    manufacturing_date, expiry_date, received_date,
                    initial_quantity, current_quantity, unit_cost, status,
                    hold_until, held_reason, production_order_id)
                VALUES (v_ord.tenant_id, v_ord.company_id, v_line.product_id, v_wh, v_batch_no,
                    v_rcp.receipt_date, v_expiry, v_rcp.receipt_date,
                    v_line.qty, v_line.qty, v_uc, v_line_status,
                    CASE WHEN v_line_status = 'on_hold' THEN v_hold_until ELSE NULL END,
                    CASE WHEN v_line_status = 'on_hold' THEN v_held_reason ELSE NULL END,
                    v_ord.id)
                RETURNING id INTO v_batch_id;
                -- جدولة الفحوص المؤجلة (7/28 يوماً…) من قالب BOM على الدفعة المنتَجة (§4-د/14)
                IF v_qc_template IS NOT NULL AND jsonb_typeof(v_qc_template) = 'array'
                   AND jsonb_array_length(v_qc_template) > 0
                   AND v_line.output_role IN ('primary','co_product') THEN
                    PERFORM public.schedule_batch_qc_tests(v_batch_id, v_qc_template);
                END IF;
            ELSE
                v_batch_id := v_line.batch_id;
            END IF;
        ELSE
            v_batch_id := v_line.batch_id;
        END IF;

        -- التقاط دفعة الناتج الرئيسي لربط حجز المبيعات (MTO)
        IF v_line.output_role = 'primary' AND v_line.product_id = v_ord.product_id THEN
            v_fg_batch_id := v_batch_id;
            v_primary_recv := v_primary_recv + COALESCE(v_line.qty,0);
        END IF;

        INSERT INTO public.inventory_movements (
            tenant_id, company_id, movement_number, movement_date, movement_type,
            product_id, to_warehouse_id, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number, notes, created_by)
        VALUES (v_ord.tenant_id, v_ord.company_id,
            'MRCT-' || LEFT(p_receipt_id::text,8) || '-' || v_idx, v_rcp.receipt_date, 'receipt',
            v_line.product_id, v_wh, v_line.qty, v_uc, v_uc * COALESCE(v_line.qty,0),
            'production_receipt', p_receipt_id, v_rcp.receipt_number, 'استلام إنتاج (' || v_line.output_role || ')', auth.uid())
        RETURNING id INTO v_mv_id;

        UPDATE public.mfg_finished_receipt_lines
           SET unit_cost = v_uc, batch_id = v_batch_id, movement_id = v_mv_id WHERE id = v_line.id;
        v_consumed := v_consumed + (v_uc * COALESCE(v_line.qty,0));
    END LOOP;

    UPDATE public.mfg_production_orders SET
        qty_produced = COALESCE(qty_produced,0) + v_good_qty,
        qty_scrapped = COALESCE(qty_scrapped,0) + v_scrap_qty,
        received_cost = COALESCE(received_cost,0) + v_consumed,
        status = CASE WHEN (COALESCE(qty_produced,0) + v_good_qty + COALESCE(qty_scrapped,0) + v_scrap_qty)
                           >= qty_planned - 0.01 THEN 'completed' ELSE 'in_progress' END,
        actual_end_date = CASE WHEN (COALESCE(qty_produced,0) + v_good_qty + COALESCE(qty_scrapped,0) + v_scrap_qty)
                               >= qty_planned - 0.01 THEN v_rcp.receipt_date ELSE actual_end_date END,
        updated_at = now()
    WHERE id = v_ord.id;

    v_num := COALESCE(v_rcp.receipt_number, public.generate_mfg_number(v_rcp.tenant_id, v_rcp.company_id, 'RCT'));
    UPDATE public.mfg_finished_receipts SET
        status = 'posted', posted_at = now(), receipt_number = v_num, total_cost = v_consumed,
        cost_breakdown = jsonb_build_object(
            'pool', v_pool, 'share', v_share, 'receipt_cost', v_receipt_c,
            'co_product_cost', v_co_cost, 'recovery_credit', v_credit,
            'primary_cost', v_primary_c, 'consumed', v_consumed),
        updated_at = now()
    WHERE id = p_receipt_id;

    -- ── P3a/MTO: حجز الناتج النهائي لأوامر البيع المرتبطة (§3.6 + §3.7 قاعدة 3) ──
    -- القرار (أقل تدخّل): نستخدم عدّاد inventory_stock.reserved_quantity — نفس آلية حجز دورة المبيعات
    -- (salesTransactionService._updateStockReservation) — ونسجّل التفصيل في mfg_material_reservations
    -- بنوع 'fg_for_sale' + sales_transaction_id للتتبّع والإفراج، مقيّداً بالمخصَّص غير المحجوز بعد لكل رابط.
    IF v_primary_recv > 0.000001 AND v_ord.fg_warehouse_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.mfg_order_sales_links WHERE order_id = v_ord.id) THEN
        v_take := v_primary_recv;
        FOR v_link IN
            SELECT sl.sales_transaction_id, COALESCE(sl.qty_allocated,0) AS qty_allocated
              FROM public.mfg_order_sales_links sl WHERE sl.order_id = v_ord.id ORDER BY sl.created_at
        LOOP
            IF v_take <= 0.000001 THEN EXIT; END IF;
            SELECT COALESCE(SUM(qty_reserved),0) INTO v_fg_reserved
              FROM public.mfg_material_reservations
             WHERE production_order_id = v_ord.id AND reservation_kind = 'fg_for_sale'
               AND sales_transaction_id IS NOT DISTINCT FROM v_link.sales_transaction_id AND status = 'active';
            v_rem_link := LEAST(v_take, v_link.qty_allocated - v_fg_reserved);
            IF v_rem_link <= 0.000001 THEN CONTINUE; END IF;
            INSERT INTO public.mfg_material_reservations (
                tenant_id, company_id, production_order_id, product_id, warehouse_id,
                qty_reserved, batch_id, status, reservation_kind, sales_transaction_id)
            VALUES (v_ord.tenant_id, v_ord.company_id, v_ord.id, v_ord.product_id, v_ord.fg_warehouse_id,
                round(v_rem_link,6), v_fg_batch_id, 'active', 'fg_for_sale', v_link.sales_transaction_id);
            UPDATE public.inventory_stock
               SET reserved_quantity = COALESCE(reserved_quantity,0) + round(v_rem_link,6), updated_at = now()
             WHERE product_id = v_ord.product_id AND warehouse_id = v_ord.fg_warehouse_id;
            IF NOT FOUND THEN
                INSERT INTO public.inventory_stock (tenant_id, company_id, product_id, warehouse_id, quantity_on_hand, reserved_quantity)
                VALUES (v_ord.tenant_id, v_ord.company_id, v_ord.product_id, v_ord.fg_warehouse_id, 0, round(v_rem_link,6));
            END IF;
            v_take := v_take - v_rem_link;
        END LOOP;
        IF v_primary_recv - v_take > 0.000001 THEN
            PERFORM public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['sales_manager','production_manager'],
                'حجز إنتاج لأمر بيع', 'الأمر ' || COALESCE(v_ord.order_number,'') || ' — حُجز '
                    || round(v_primary_recv - v_take,3) || ' للبيع المرتبط',
                '/manufacturing?order=' || v_ord.id, 'mfg_mto_reserved', '🔒');
        END IF;
    END IF;

    -- ── GL: مدين المخزون التام / دائن WIP ──
    IF v_consumed > 0 THEN
        v_inv_acct := public.resolve_posting_account(v_ord.company_id, 'receipt_inventory');
        IF v_settings.wip_account_id IS NOT NULL AND v_inv_acct IS NOT NULL THEN
            v_je := public.mfg_create_and_post_je(
                v_ord.tenant_id, v_ord.company_id, v_ord.branch_id, v_rcp.receipt_date,
                'production_receipt', p_receipt_id, v_num, v_ord.id,
                'استلام إنتاج تام — ' || COALESCE(v_num,''),
                jsonb_build_array(
                    jsonb_build_object('account_id', v_inv_acct, 'debit', v_consumed, 'credit', 0, 'desc', 'مخزون تام الصنع'),
                    jsonb_build_object('account_id', v_settings.wip_account_id, 'debit', 0, 'credit', v_consumed, 'desc', 'تحويل من WIP')));
            IF v_je IS NOT NULL THEN
                UPDATE public.mfg_finished_receipts SET journal_entry_id = v_je WHERE id = p_receipt_id;
                UPDATE public.mfg_production_orders SET completion_journal_entry_id = v_je WHERE id = v_ord.id;
            END IF;
        END IF;
    END IF;

    IF (SELECT status FROM public.mfg_production_orders WHERE id = v_ord.id) = 'completed' THEN
        PERFORM public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['production_manager'],
            'اكتمل أمر الإنتاج', 'الأمر ' || COALESCE(v_ord.order_number,'') || ' اكتمل — جاهز للإقفال',
            '/manufacturing?order=' || v_ord.id, 'mfg_completed', '✅');
    END IF;

    RETURN jsonb_build_object('success', true, 'receipt_id', p_receipt_id, 'receipt_number', v_num,
        'total_cost', v_consumed, 'primary_unit_cost', v_unit_primary, 'pool', v_pool, 'share', v_share,
        'backflush_issue_id', v_bf_issue, 'journal_entry_id', v_je,
        'batch_status', v_batch_status, 'fg_reserved', round(GREATEST(0, v_primary_recv - COALESCE(v_take, v_primary_recv)),6));
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.post_production_receipt(uuid,boolean) IS
  'استلام مخرجات الإنتاج (IN): backflush الأوامر بلا مراحل + تقييم من WIP + إنشاء دفعات (رقم آمن B1) + GL مدين المخزون/دائن WIP + إشعار الاكتمال. P3a: حالة دفعة من الإعدادات/المعالجة الزمنية (hold_until) + وسم production_order_id + جدولة فحوص مؤجلة + حجز الناتج لأوامر البيع (MTO). ذرّي.';
GRANT EXECUTE ON FUNCTION public.post_production_receipt(uuid,boolean) TO authenticated, service_role;
