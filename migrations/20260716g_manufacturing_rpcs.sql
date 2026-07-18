-- 20260716g: موديول التصنيع — دوال التنفيذ (RPCs) — P1a (طبقة القاعدة)
-- ═══════════════════════════════════════════════════════════════════════════
-- محرّك التنفيذ الذرّي (§3.1-3.7 + قرارات §4-ج/1-4 + §4-د/6,21). كل الدوال:
--   • SECURITY DEFINER + SET search_path (كالأخوات) + GRANT authenticated+service_role.
--   • RETURNS jsonb {success, error?, ...ids}: فشل العمل يُرجَع لا يُرمى (EXCEPTION WHEN OTHERS
--     يلتقط أي RAISE من التريغرات/الحُرّاس فيتراجع كل عمل الدالة ذرّياً ويُرجع خطأً).
--   • تشتقّ tenant/company من صف المستند (لا تعتمد auth.uid() — تعمل في سياق الخدمة والاختبار).
--   • قفل الفترات (journal_period_is_locked) يسري على الصرف/المرتجع/الاستلام حتى بلا GL (§4-ج/29).
--   • نموذج المخزون: inventory_movements (تريغر update_inventory_stock) — لا منطق مخزون جديد.
--     أنواع الحركة المعتمدة: OUT='issue' · IN='receipt' · مرتجع IN='return_in'
--     (مطابقة لمفردات update_inventory_stock — 20260712a).
-- idempotent: CREATE OR REPLACE + CREATE TABLE IF NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- 0) جدول تسلسلات الترقيم + generate_mfg_number (race-safe) (§4-ج/23,32)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_number_sequences (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL,
    company_id  uuid NOT NULL,
    doc_type    text NOT NULL,          -- ORD | ISS | RET | RCT
    year        int  NOT NULL,
    last_seq    int  NOT NULL DEFAULT 0,
    updated_at  timestamptz DEFAULT now(),
    UNIQUE (tenant_id, company_id, doc_type, year)
);
ALTER TABLE public.mfg_number_sequences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfg_number_sequences_select_policy ON public.mfg_number_sequences;
CREATE POLICY mfg_number_sequences_select_policy ON public.mfg_number_sequences
    FOR SELECT USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()));

CREATE OR REPLACE FUNCTION public.generate_mfg_number(
    p_tenant_id uuid, p_company_id uuid, p_doc_type text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_year   int := EXTRACT(YEAR FROM CURRENT_DATE)::int;
    v_seq    int;
    v_type   text := upper(COALESCE(p_doc_type,'DOC'));
    v_prefix text;
BEGIN
    v_prefix := CASE v_type
        WHEN 'ORD' THEN 'MFG-ORD' WHEN 'ISS' THEN 'MFG-ISS'
        WHEN 'RET' THEN 'MFG-RET' WHEN 'RCT' THEN 'MFG-RCT'
        ELSE 'MFG-' || v_type END;
    -- ذرّي/آمن للتزامن: ON CONFLICT DO UPDATE يأخذ قفل الصف ويزيد التسلسل على أحدث قيمة.
    INSERT INTO public.mfg_number_sequences (tenant_id, company_id, doc_type, year, last_seq)
    VALUES (p_tenant_id, p_company_id, v_type, v_year, 1)
    ON CONFLICT (tenant_id, company_id, doc_type, year)
    DO UPDATE SET last_seq = public.mfg_number_sequences.last_seq + 1, updated_at = now()
    RETURNING last_seq INTO v_seq;
    RETURN v_prefix || '-' || v_year || '-' || lpad(v_seq::text, 5, '0');
END;
$fn$;
COMMENT ON FUNCTION public.generate_mfg_number(uuid,uuid,text) IS
  'ترقيم مستندات التصنيع الآمن للتزامن (MFG-<ORD|ISS|RET|RCT>-YYYY-NNNNN) عبر mfg_number_sequences بقفل صف upsert.';
GRANT EXECUTE ON FUNCTION public.generate_mfg_number(uuid,uuid,text) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) release_production_reservations — فكّ الحجوزات النشطة (مساعد داخلي + عام)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.release_production_reservations(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_r     RECORD;
    v_count int := 0;
BEGIN
    FOR v_r IN
        SELECT * FROM public.mfg_material_reservations
        WHERE production_order_id = p_order_id AND status = 'active' FOR UPDATE
    LOOP
        IF v_r.product_id IS NOT NULL AND v_r.warehouse_id IS NOT NULL THEN
            UPDATE public.inventory_stock
               SET reserved_quantity = GREATEST(0, COALESCE(reserved_quantity,0) - COALESCE(v_r.qty_reserved,0)),
                   updated_at = now()
             WHERE product_id = v_r.product_id AND warehouse_id = v_r.warehouse_id;
        END IF;
        IF v_r.roll_id IS NOT NULL THEN
            UPDATE public.fabric_rolls
               SET reserved_length = GREATEST(0, COALESCE(reserved_length,0) - COALESCE(v_r.qty_reserved,0)),
                   updated_at = now()
             WHERE id = v_r.roll_id;
        END IF;
        UPDATE public.mfg_material_reservations
           SET status = 'released', released_at = now() WHERE id = v_r.id;
        v_count := v_count + 1;
    END LOOP;
    RETURN jsonb_build_object('success', true, 'released', v_count);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.release_production_reservations(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) confirm_production_order — تأكيد الأمر: تحقّق BOM + لقطة + مراحل + حجز اختياري
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.confirm_production_order(
    p_order_id uuid, p_reserve boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_ord        public.mfg_production_orders%ROWTYPE;
    v_bom        public.mfg_boms%ROWTYPE;
    v_tmpl_id    uuid;
    v_yield      numeric;
    v_sum_pct    numeric;
    v_lines      jsonb;
    v_outputs    jsonb;
    v_snapshot   jsonb;
    v_stages     int := 0;
    v_reserved   int := 0;
    v_plan_cost  numeric := 0;
    v_ln         RECORD;
    v_first_seq  int;
    v_num        text;
BEGIN
    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الأمر غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_ord.company_id); END IF;
    IF v_ord.status <> 'draft' THEN
        RETURN jsonb_build_object('success', false, 'error', 'لا يمكن تأكيد أمر إلا من حالة مسودة (الحالة: ' || v_ord.status || ')');
    END IF;
    IF v_ord.bom_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'الأمر بلا قائمة مواد'); END IF;

    SELECT * INTO v_bom FROM public.mfg_boms WHERE id = v_ord.bom_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'قائمة المواد غير موجودة'); END IF;
    IF v_bom.status <> 'approved' THEN
        RETURN jsonb_build_object('success', false, 'error', 'قائمة المواد غير معتمدة (draft/archived) — لا يُنتَج إلا من BOM معتمدة');
    END IF;
    IF (v_bom.effective_from IS NOT NULL AND v_bom.effective_from > CURRENT_DATE)
       OR (v_bom.effective_to IS NOT NULL AND v_bom.effective_to < CURRENT_DATE) THEN
        RETURN jsonb_build_object('success', false, 'error', 'قائمة المواد خارج فترة السريان (effective_from/to)');
    END IF;

    v_yield   := COALESCE(NULLIF(v_bom.yield_pct, 0), 100) / 100.0;
    v_tmpl_id := COALESCE(v_ord.workflow_template_id, v_bom.workflow_template_id);

    SELECT COALESCE(SUM(formula_pct), 0) INTO v_sum_pct
      FROM public.mfg_bom_lines WHERE bom_id = v_bom.id AND formula_pct IS NOT NULL;

    -- ── حساب الكميات المطلوبة ولقطة البنود ──
    -- per_unit: required = qty_per_unit × qty_planned × (1+scrap%) / yield.
    -- formula: batches = qty_planned / ref_qty؛
    --   formula_pct → (pct/Σpct) × (ref_qty/yield) × batches × (1+scrap%)  [= (pct/Σpct)×(qty_planned/yield)×(1+scrap%)]
    --   qty_per_unit (كمية لكل دفعة مرجعية) → qty_per_unit × batches × (1+scrap%).
    SELECT
      COALESCE(jsonb_agg(jsonb_build_object(
        'line_id', t.id,
        'component_product_id', t.component_product_id,
        'component_bom_id', t.component_bom_id,
        'qty_per_unit', t.qty_per_unit,
        'formula_pct', t.formula_pct,
        'unit_id', t.unit_id,
        'stage_id', t.stage_id,
        'issue_method', t.issue_method,
        'scrap_pct', COALESCE(t.scrap_pct,0),
        'consumption_tolerance_pct', t.consumption_tolerance_pct,
        'is_roll_tracked', t.is_roll_tracked,
        'requires_batch', t.requires_batch,
        'required_qty', round(t.req::numeric, 6),
        'required_per_unit', round((t.req / NULLIF(v_ord.qty_planned,0))::numeric, 8)
      ) ORDER BY t.sort_order), '[]'::jsonb),
      COALESCE(SUM(t.req * COALESCE(st.average_cost,0)), 0)
    INTO v_lines, v_plan_cost
    FROM (
      SELECT bl.*,
        CASE
          WHEN v_bom.bom_basis = 'formula' AND bl.formula_pct IS NOT NULL THEN
            (bl.formula_pct / NULLIF(v_sum_pct,0)) * (v_ord.qty_planned / v_yield) * (1 + COALESCE(bl.scrap_pct,0)/100.0)
          WHEN v_bom.bom_basis = 'formula' AND bl.qty_per_unit IS NOT NULL THEN
            bl.qty_per_unit * (v_ord.qty_planned / NULLIF(v_bom.quantity,0)) * (1 + COALESCE(bl.scrap_pct,0)/100.0)
          ELSE
            COALESCE(bl.qty_per_unit,0) * v_ord.qty_planned * (1 + COALESCE(bl.scrap_pct,0)/100.0) / v_yield
        END AS req
      FROM public.mfg_bom_lines bl
      WHERE bl.bom_id = v_bom.id
    ) t
    LEFT JOIN public.inventory_stock st
      ON st.product_id = t.component_product_id
     AND st.warehouse_id = v_ord.source_warehouse_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'output_id', o.id, 'product_id', o.product_id, 'output_role', o.output_role,
        'qty_per_batch', o.qty_per_batch, 'cost_share_pct', o.cost_share_pct,
        'recovery_rate', o.recovery_rate, 'default_package_size', o.default_package_size,
        'stage_id', o.stage_id) ORDER BY o.sort_order), '[]'::jsonb)
    INTO v_outputs FROM public.mfg_bom_outputs o WHERE o.bom_id = v_bom.id;

    v_snapshot := jsonb_build_object(
        'bom_id', v_bom.id, 'bom_version', v_bom.version, 'bom_basis', v_bom.bom_basis,
        'yield_pct', v_bom.yield_pct, 'quantity', v_bom.quantity,
        'lines', v_lines, 'outputs', v_outputs);

    -- ── إنشاء مراحل الأمر من القالب (خطي: الأولى ready والباقي blocked؛ لا قالب = بلا مراحل) ──
    IF v_tmpl_id IS NOT NULL THEN
        SELECT MIN(seq) INTO v_first_seq FROM public.mfg_workflow_stages WHERE template_id = v_tmpl_id;
        INSERT INTO public.mfg_order_stages (
            tenant_id, company_id, production_order_id, template_stage_id, seq,
            name_ar, name_en, work_center_id, status, qty_in, is_passive, min_wait_hours,
            pay_type, piece_rate, expected_minutes_per_unit, fixed_minutes, qc_checklist)
        SELECT v_ord.tenant_id, v_ord.company_id, v_ord.id, ws.id, ws.seq,
            ws.name_ar, ws.name_en, ws.work_center_id,
            CASE WHEN ws.seq = v_first_seq THEN 'ready' ELSE 'blocked' END,
            CASE WHEN ws.seq = v_first_seq THEN v_ord.qty_planned ELSE 0 END,
            COALESCE(ws.is_passive,false), COALESCE(ws.min_wait_hours,0),
            ws.pay_type, ws.piece_rate, ws.expected_minutes_per_unit, ws.fixed_minutes,
            COALESCE(ws.qc_checklist, '[]'::jsonb)
        FROM public.mfg_workflow_stages ws WHERE ws.template_id = v_tmpl_id;
        GET DIAGNOSTICS v_stages = ROW_COUNT;
    END IF;

    -- ── حجز ناعم اختياري ──
    IF p_reserve THEN
        FOR v_ln IN SELECT * FROM jsonb_to_recordset(v_lines)
            AS x(component_product_id uuid, required_qty numeric)
        LOOP
            IF v_ln.component_product_id IS NOT NULL AND COALESCE(v_ln.required_qty,0) > 0 THEN
                INSERT INTO public.mfg_material_reservations (
                    tenant_id, company_id, production_order_id, product_id, warehouse_id, qty_reserved, status)
                VALUES (v_ord.tenant_id, v_ord.company_id, v_ord.id, v_ln.component_product_id,
                        v_ord.source_warehouse_id, v_ln.required_qty, 'active');
                UPDATE public.inventory_stock
                   SET reserved_quantity = COALESCE(reserved_quantity,0) + v_ln.required_qty, updated_at = now()
                 WHERE product_id = v_ln.component_product_id AND warehouse_id = v_ord.source_warehouse_id;
                v_reserved := v_reserved + 1;
            END IF;
        END LOOP;
    END IF;

    v_num := COALESCE(v_ord.order_number, public.generate_mfg_number(v_ord.tenant_id, v_ord.company_id, 'ORD'));

    UPDATE public.mfg_production_orders SET
        status = 'confirmed', order_number = v_num,
        bom_version = v_bom.version, bom_snapshot = v_snapshot,
        workflow_template_id = COALESCE(workflow_template_id, v_tmpl_id),
        overproduction_pct = COALESCE(NULLIF(overproduction_pct,0), v_bom.overproduction_pct, 0),
        planned_material_cost = v_plan_cost, updated_at = now()
    WHERE id = p_order_id;

    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'order_number', v_num,
        'stages_created', v_stages, 'reserved_lines', v_reserved, 'planned_material_cost', v_plan_cost);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.confirm_production_order(uuid,boolean) IS
  'تأكيد أمر إنتاج: تحقّق BOM معتمدة/سارية + تجميد لقطة البنود/المخرجات + توليد مراحل خطية (الأولى ready) + حجز ناعم اختياري. ذرّي.';
GRANT EXECUTE ON FUNCTION public.confirm_production_order(uuid,boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) post_material_issue — ترحيل صرف المواد (OUT) بتكلفة المتوسط + رولونات + دفعات
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.post_material_issue(
    p_issue_id uuid, p_override boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_iss        public.mfg_material_issues%ROWTYPE;
    v_ord        public.mfg_production_orders%ROWTYPE;
    v_line       RECORD;
    v_roll       public.fabric_rolls%ROWTYPE;
    v_batch      public.inventory_batches%ROWTYPE;
    v_wh         uuid;
    v_cost       numeric;
    v_qty        numeric;
    v_mv_id      uuid;
    v_mv_ids     uuid[] := '{}';
    v_total      numeric := 0;
    v_idx        int := 0;
    v_warn       jsonb := '[]'::jsonb;
    v_req        numeric;
    v_tol        numeric;
    v_dev        numeric;
    v_num        text;
BEGIN
    SELECT * INTO v_iss FROM public.mfg_material_issues WHERE id = p_issue_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند الصرف غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_iss.company_id); END IF;
    IF v_iss.status <> 'draft' THEN
        RETURN jsonb_build_object('success', false, 'error', 'الصرف ليس بحالة مسودة (الحالة: ' || v_iss.status || ')');
    END IF;
    IF public.journal_period_is_locked(v_iss.company_id, v_iss.issue_date) THEN
        RETURN jsonb_build_object('success', false, 'error', 'period_locked');
    END IF;

    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_iss.production_order_id FOR UPDATE;

    FOR v_line IN SELECT * FROM public.mfg_material_issue_lines WHERE issue_id = p_issue_id ORDER BY created_at
    LOOP
        v_idx := v_idx + 1;
        v_wh  := COALESCE(v_line.warehouse_id, v_ord.source_warehouse_id);
        IF v_wh IS NULL THEN RAISE EXCEPTION 'لا يوجد مستودع للسطر % (المنتج %)', v_idx, v_line.product_id; END IF;

        IF v_line.roll_id IS NOT NULL THEN
            -- ── سطر رول: قصّ جزئي + roll_movements + حركة OUT (نمط direct_post_sale_v3) ──
            SELECT * INTO v_roll FROM public.fabric_rolls WHERE id = v_line.roll_id FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'الرول غير موجود: %', v_line.roll_id; END IF;
            v_qty  := COALESCE(v_line.cut_length, v_line.qty, v_roll.current_length);
            IF v_qty <= 0 OR v_qty > COALESCE(v_roll.current_length,0) + 0.01 THEN
                RAISE EXCEPTION 'طول القصّ % غير صالح للرول % (المتاح %)', v_qty, v_roll.roll_number, v_roll.current_length;
            END IF;
            v_cost := COALESCE(v_roll.cost_per_meter, 0);
            INSERT INTO public.inventory_movements (
                tenant_id, company_id, movement_number, movement_date, movement_type,
                product_id, material_id, roll_id, from_warehouse_id, quantity, unit_cost, total_cost,
                reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_iss.tenant_id, v_iss.company_id,
                'MISS-' || LEFT(p_issue_id::text,8) || '-' || v_idx, v_iss.issue_date, 'issue',
                v_roll.product_id, v_roll.material_id, v_roll.id, v_wh, v_qty, v_cost, v_cost * v_qty,
                'production_issue', p_issue_id, v_iss.issue_number, 'صرف رول للإنتاج', auth.uid())
            RETURNING id INTO v_mv_id;
            INSERT INTO public.roll_movements (
                tenant_id, company_id, roll_id, movement_number, movement_date, movement_type,
                quantity, length_before, length_after, from_warehouse_id,
                reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_iss.tenant_id, v_iss.company_id, v_roll.id,
                'MISS-' || LEFT(p_issue_id::text,8) || '-R' || v_idx, v_iss.issue_date, 'production_issue',
                v_qty, COALESCE(v_roll.current_length,0), COALESCE(v_roll.current_length,0) - v_qty, v_wh,
                'production_issue', p_issue_id, v_iss.issue_number, 'قصّ رول للإنتاج', auth.uid());
            UPDATE public.fabric_rolls
               SET current_length = COALESCE(current_length,0) - v_qty,
                   status = CASE WHEN COALESCE(current_length,0) - v_qty <= 0.01 THEN 'consumed' ELSE status END,
                   updated_at = now()
             WHERE id = v_roll.id;

        ELSIF v_line.batch_id IS NOT NULL THEN
            -- ── سطر دفعة: تحقّق التبعية + نقص current_quantity + حركة OUT ──
            SELECT * INTO v_batch FROM public.inventory_batches WHERE id = v_line.batch_id FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'الدفعة غير موجودة: %', v_line.batch_id; END IF;
            IF v_batch.product_id IS DISTINCT FROM v_line.product_id THEN
                RAISE EXCEPTION 'الدفعة % لا تخصّ المنتج المطلوب', v_batch.batch_number;
            END IF;
            v_qty  := COALESCE(v_line.qty, 0);
            SELECT COALESCE(NULLIF(average_cost,0), v_batch.unit_cost, 0) INTO v_cost
              FROM public.inventory_stock WHERE product_id = v_line.product_id AND warehouse_id = v_wh LIMIT 1;
            v_cost := COALESCE(v_cost, v_batch.unit_cost, 0);
            IF COALESCE(v_batch.current_quantity,0) < v_qty - 0.01 AND NOT p_override THEN
                RAISE EXCEPTION 'كمية الدفعة % غير كافية: المتاح %، المطلوب %', v_batch.batch_number, v_batch.current_quantity, v_qty;
            END IF;
            INSERT INTO public.inventory_movements (
                tenant_id, company_id, movement_number, movement_date, movement_type,
                product_id, from_warehouse_id, quantity, unit_cost, total_cost,
                reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_iss.tenant_id, v_iss.company_id,
                'MISS-' || LEFT(p_issue_id::text,8) || '-' || v_idx, v_iss.issue_date, 'issue',
                v_line.product_id, v_wh, v_qty, v_cost, v_cost * v_qty,
                'production_issue', p_issue_id, v_iss.issue_number, 'صرف دفعة للإنتاج', auth.uid())
            RETURNING id INTO v_mv_id;
            UPDATE public.inventory_batches
               SET current_quantity = COALESCE(current_quantity,0) - v_qty WHERE id = v_batch.id;

        ELSE
            -- ── سطر عادي: تكلفة المتوسط + حركة OUT (حارس السالب في التريغر) ──
            v_qty := COALESCE(v_line.qty, 0);
            SELECT COALESCE(average_cost,0) INTO v_cost
              FROM public.inventory_stock WHERE product_id = v_line.product_id AND warehouse_id = v_wh LIMIT 1;
            v_cost := COALESCE(v_cost, 0);
            INSERT INTO public.inventory_movements (
                tenant_id, company_id, movement_number, movement_date, movement_type,
                product_id, from_warehouse_id, quantity, unit_cost, total_cost,
                reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_iss.tenant_id, v_iss.company_id,
                'MISS-' || LEFT(p_issue_id::text,8) || '-' || v_idx, v_iss.issue_date, 'issue',
                v_line.product_id, v_wh, v_qty, v_cost, v_cost * v_qty,
                'production_issue', p_issue_id, v_iss.issue_number, 'صرف مواد للإنتاج', auth.uid())
            RETURNING id INTO v_mv_id;
        END IF;

        -- التقاط التكلفة على السطر + ربط الحركة + إجمالي الأمر
        UPDATE public.mfg_material_issue_lines
           SET unit_cost = v_cost, qty = v_qty, movement_id = v_mv_id WHERE id = v_line.id;
        v_mv_ids := array_append(v_mv_ids, v_mv_id);
        v_total  := v_total + (v_cost * v_qty);

        -- إنفاذ سماحية الاستهلاك (تحذير؛ حظر فوق ضعف السماح إلا بتجاوز) (§4-د/14)
        IF v_line.bom_line_id IS NOT NULL AND v_ord.bom_snapshot IS NOT NULL THEN
            SELECT (l->>'required_qty')::numeric, (l->>'consumption_tolerance_pct')::numeric
              INTO v_req, v_tol
              FROM jsonb_array_elements(v_ord.bom_snapshot->'lines') l
             WHERE (l->>'line_id')::uuid = v_line.bom_line_id LIMIT 1;
            IF v_tol IS NOT NULL AND COALESCE(v_req,0) > 0 THEN
                v_dev := abs(v_qty - v_req) / v_req * 100.0;
                IF v_dev > v_tol THEN
                    v_warn := v_warn || jsonb_build_object('line_id', v_line.id, 'product_id', v_line.product_id,
                                'required', v_req, 'issued', v_qty, 'deviation_pct', round(v_dev,2), 'tolerance_pct', v_tol);
                    IF v_dev > 2 * v_tol AND NOT p_override THEN
                        RAISE EXCEPTION 'انحراف استهلاك % يتجاوز ضعف السماح (%%%) للمنتج % — يلزم تجاوز مشرف', round(v_dev,2), v_tol, v_line.product_id;  -- [installer-adapt] was (%%) = 2 placeholders vs 3 args; (%%%) binds v_tol + literal %
                    END IF;
                END IF;
            END IF;
        END IF;

        -- تحويل الحجوزات النشطة لهذا المنتج → مستهلَكة + تخفيض الحجز على المخزون
        UPDATE public.inventory_stock
           SET reserved_quantity = GREATEST(0, COALESCE(reserved_quantity,0) - v_qty), updated_at = now()
         WHERE product_id = v_line.product_id AND warehouse_id = v_wh
           AND EXISTS (SELECT 1 FROM public.mfg_material_reservations r
                       WHERE r.production_order_id = v_ord.id AND r.product_id = v_line.product_id AND r.status='active');
        UPDATE public.mfg_material_reservations
           SET status = 'consumed', released_at = now()
         WHERE production_order_id = v_ord.id AND product_id = v_line.product_id AND status = 'active';
    END LOOP;

    v_num := COALESCE(v_iss.issue_number, public.generate_mfg_number(v_iss.tenant_id, v_iss.company_id, 'ISS'));
    UPDATE public.mfg_material_issues
       SET status = 'posted', posted_at = now(), issue_number = v_num, updated_at = now()
     WHERE id = p_issue_id;

    UPDATE public.mfg_production_orders
       SET actual_material_cost = COALESCE(actual_material_cost,0) + v_total,
           status = CASE WHEN status = 'confirmed' THEN 'in_progress' ELSE status END,
           actual_start_date = COALESCE(actual_start_date, v_iss.issue_date),
           updated_at = now()
     WHERE id = v_ord.id;

    RETURN jsonb_build_object('success', true, 'issue_id', p_issue_id, 'issue_number', v_num,
        'movement_ids', to_jsonb(v_mv_ids), 'material_cost', v_total, 'warnings', v_warn);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.post_material_issue(uuid,boolean) IS
  'ترحيل صرف مواد الإنتاج (OUT): تكلفة المتوسط لحظة الصرف + قصّ رولونات (roll_movements) + دفعات + استهلاك الحجوزات + إنفاذ سماحية الاستهلاك + قفل الفترة. ذرّي.';
GRANT EXECUTE ON FUNCTION public.post_material_issue(uuid,boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) post_material_return — ترحيل مرتجع المواد (IN) بتكلفة وقت الصرف (§4-ج/1)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.post_material_return(
    p_return_id uuid, p_override boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_ret     public.mfg_material_returns%ROWTYPE;
    v_ord     public.mfg_production_orders%ROWTYPE;
    v_line    RECORD;
    v_iline   public.mfg_material_issue_lines%ROWTYPE;
    v_already numeric;
    v_cost    numeric;
    v_wh      uuid;
    v_qty     numeric;
    v_mv_id   uuid;
    v_mv_ids  uuid[] := '{}';
    v_total   numeric := 0;
    v_idx     int := 0;
    v_num     text;
BEGIN
    SELECT * INTO v_ret FROM public.mfg_material_returns WHERE id = p_return_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند المرتجع غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_ret.company_id); END IF;
    IF v_ret.status <> 'draft' THEN
        RETURN jsonb_build_object('success', false, 'error', 'المرتجع ليس بحالة مسودة (الحالة: ' || v_ret.status || ')');
    END IF;
    IF public.journal_period_is_locked(v_ret.company_id, v_ret.return_date) THEN
        RETURN jsonb_build_object('success', false, 'error', 'period_locked');
    END IF;

    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_ret.production_order_id FOR UPDATE;

    FOR v_line IN SELECT * FROM public.mfg_material_return_lines WHERE return_id = p_return_id ORDER BY created_at
    LOOP
        v_idx := v_idx + 1;
        IF v_line.issue_line_id IS NULL THEN RAISE EXCEPTION 'سطر المرتجع % بلا مرجع سطر صرف', v_idx; END IF;
        SELECT * INTO v_iline FROM public.mfg_material_issue_lines WHERE id = v_line.issue_line_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'سطر الصرف المرجعي غير موجود'; END IF;

        -- المرتجع ≤ المصروف − المُرجَع مسبقاً (من مرتجعات مُرحَّلة)
        SELECT COALESCE(SUM(rl.qty),0) INTO v_already
          FROM public.mfg_material_return_lines rl
          JOIN public.mfg_material_returns r ON r.id = rl.return_id
         WHERE rl.issue_line_id = v_line.issue_line_id AND r.status = 'posted' AND r.id <> p_return_id;
        v_qty := COALESCE(v_line.qty, 0);
        IF v_qty > COALESCE(v_iline.qty,0) - v_already + 0.01 THEN
            RAISE EXCEPTION 'كمية المرتجع % تتجاوز المتبقي (مصروف %، مُرجَع %)', v_qty, v_iline.qty, v_already;
        END IF;

        v_cost := COALESCE(v_line.unit_cost, v_iline.unit_cost, 0);  -- تكلفة وقت الصرف
        v_wh   := COALESCE(v_line.warehouse_id, v_iline.warehouse_id, v_ord.source_warehouse_id);

        INSERT INTO public.inventory_movements (
            tenant_id, company_id, movement_number, movement_date, movement_type,
            product_id, to_warehouse_id, quantity, unit_cost, total_cost,
            reference_type, reference_id, reference_number, notes, created_by)
        VALUES (v_ret.tenant_id, v_ret.company_id,
            'MRET-' || LEFT(p_return_id::text,8) || '-' || v_idx, v_ret.return_date, 'return_in',
            v_line.product_id, v_wh, v_qty, v_cost, v_cost * v_qty,
            'production_return', p_return_id, v_ret.return_number, 'مرتجع مواد إنتاج (بتكلفة الصرف)', auth.uid())
        RETURNING id INTO v_mv_id;

        -- استعادة الرول / الدفعة
        IF COALESCE(v_line.roll_id, v_iline.roll_id) IS NOT NULL THEN
            UPDATE public.fabric_rolls
               SET current_length = COALESCE(current_length,0) + v_qty,
                   status = CASE WHEN status = 'consumed' THEN 'available' ELSE status END, updated_at = now()
             WHERE id = COALESCE(v_line.roll_id, v_iline.roll_id);
            INSERT INTO public.roll_movements (
                tenant_id, company_id, roll_id, movement_number, movement_date, movement_type,
                quantity, from_warehouse_id, reference_type, reference_id, reference_number, notes, created_by)
            VALUES (v_ret.tenant_id, v_ret.company_id, COALESCE(v_line.roll_id, v_iline.roll_id),
                'MRET-' || LEFT(p_return_id::text,8) || '-R' || v_idx, v_ret.return_date, 'production_return',
                v_qty, v_wh, 'production_return', p_return_id, v_ret.return_number, 'استعادة رول من مرتجع إنتاج', auth.uid());
        END IF;
        IF COALESCE(v_line.batch_id, v_iline.batch_id) IS NOT NULL THEN
            UPDATE public.inventory_batches
               SET current_quantity = COALESCE(current_quantity,0) + v_qty WHERE id = COALESCE(v_line.batch_id, v_iline.batch_id);
        END IF;

        UPDATE public.mfg_material_return_lines SET unit_cost = v_cost, movement_id = v_mv_id WHERE id = v_line.id;
        v_mv_ids := array_append(v_mv_ids, v_mv_id);
        v_total  := v_total + (v_cost * v_qty);
    END LOOP;

    v_num := COALESCE(v_ret.return_number, public.generate_mfg_number(v_ret.tenant_id, v_ret.company_id, 'RET'));
    UPDATE public.mfg_material_returns
       SET status = 'posted', posted_at = now(), return_number = v_num, updated_at = now() WHERE id = p_return_id;
    UPDATE public.mfg_production_orders
       SET actual_material_cost = GREATEST(0, COALESCE(actual_material_cost,0) - v_total), updated_at = now()
     WHERE id = v_ord.id;

    RETURN jsonb_build_object('success', true, 'return_id', p_return_id, 'return_number', v_num,
        'movement_ids', to_jsonb(v_mv_ids), 'credited', v_total);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.post_material_return(uuid,boolean) IS
  'ترحيل مرتجع مواد الإنتاج (IN) بتكلفة وقت الصرف (لا المتوسط الحالي) + استعادة الرول/الدفعة + تخفيض تكلفة الأمر + قفل الفترة. ذرّي.';
GRANT EXECUTE ON FUNCTION public.post_material_return(uuid,boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) release_waiting_stages — تحرير المراحل المحجوبة بزمن انتظار منتهٍ (§4-د/6)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.release_waiting_stages(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE v_count int;
BEGIN
    UPDATE public.mfg_order_stages
       SET status = 'ready', updated_at = now()
     WHERE production_order_id = p_order_id AND status = 'blocked'
       AND wait_until IS NOT NULL AND wait_until <= now();
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'released', v_count);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.release_waiting_stages(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) complete_order_stage — إكمال مرحلة + Backflush (FEFO) + تحرير التالية (§4-ج/2)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.complete_order_stage(
    p_stage_id uuid, p_qty_good numeric, p_qty_scrap numeric DEFAULT 0,
    p_override_shortage boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_stage      public.mfg_order_stages%ROWTYPE;
    v_ord        public.mfg_production_orders%ROWTYPE;
    v_is_last    boolean;
    v_allow_neg  boolean := false;
    v_ln         RECORD;
    v_need       numeric;
    v_avail      numeric;
    v_batch_id   uuid;
    v_shortage   jsonb := '[]'::jsonb;
    v_issue_id   uuid;
    v_lines_cnt  int := 0;
    v_post       jsonb;
    v_next       public.mfg_order_stages%ROWTYPE;
    v_wh         uuid;
BEGIN
    SELECT * INTO v_stage FROM public.mfg_order_stages WHERE id = p_stage_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'المرحلة غير موجودة'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_stage.company_id); END IF;
    IF v_stage.status NOT IN ('ready','in_progress') THEN
        RETURN jsonb_build_object('success', false, 'error', 'لا يمكن إكمال مرحلة إلا من ready/in_progress (الحالة: ' || v_stage.status || ')');
    END IF;

    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_stage.production_order_id FOR UPDATE;
    v_wh := v_ord.source_warehouse_id;

    IF COALESCE(v_stage.qty_in,0) > 0 AND (COALESCE(p_qty_good,0) + COALESCE(p_qty_scrap,0)) > v_stage.qty_in + 0.01 THEN
        RETURN jsonb_build_object('success', false, 'error',
            'مجموع (جيّد+خردة) يتجاوز الداخل للمرحلة (qty_in=' || v_stage.qty_in || ')');
    END IF;

    SELECT NOT EXISTS (
        SELECT 1 FROM public.mfg_order_stages
        WHERE production_order_id = v_ord.id AND seq > v_stage.seq) INTO v_is_last;

    SELECT COALESCE(allow_negative_wip,false) INTO v_allow_neg
      FROM public.mfg_settings WHERE tenant_id = v_ord.tenant_id AND company_id = v_ord.company_id LIMIT 1;
    v_allow_neg := COALESCE(v_allow_neg,false) OR p_override_shortage;

    -- ── Backflush: بنود اللقطة backflush المطابقة للمرحلة (أو بلا مرحلة عند المرحلة الأخيرة) ──
    IF v_ord.bom_snapshot IS NOT NULL THEN
        -- فحص مسبق للنقص (بلا إنشاء أي مستند حتى نتأكد)
        FOR v_ln IN
            SELECT (l->>'component_product_id')::uuid AS pid,
                   (l->>'required_per_unit')::numeric AS rpu,
                   COALESCE((l->>'requires_batch')::boolean,false) AS req_batch,
                   (l->>'line_id')::uuid AS bl_id
            FROM jsonb_array_elements(v_ord.bom_snapshot->'lines') l
            WHERE COALESCE(l->>'issue_method','backflush') = 'backflush'
              AND (l->>'component_product_id') IS NOT NULL
              AND ( (l->>'stage_id') IS NOT NULL AND (l->>'stage_id')::uuid = v_stage.template_stage_id
                    OR (l->>'stage_id') IS NULL AND v_is_last )
        LOOP
            v_need := COALESCE(v_ln.rpu,0) * COALESCE(p_qty_good,0);
            IF v_need <= 0 THEN CONTINUE; END IF;
            SELECT COALESCE(quantity_on_hand,0) INTO v_avail
              FROM public.inventory_stock WHERE product_id = v_ln.pid AND warehouse_id = v_wh LIMIT 1;
            IF COALESCE(v_avail,0) < v_need - 0.01 AND NOT v_allow_neg THEN
                v_shortage := v_shortage || jsonb_build_object('product_id', v_ln.pid,
                    'required', round(v_need,6), 'available', COALESCE(v_avail,0));
            END IF;
        END LOOP;

        IF jsonb_array_length(v_shortage) > 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'نقص مواد للـBackflush', 'shortage', v_shortage);
        END IF;

        -- إنشاء صرف backflush + سطوره (FEFO للدفعات) ثم ترحيله
        INSERT INTO public.mfg_material_issues (
            tenant_id, company_id, production_order_id, order_stage_id, issue_date, status, is_backflush)
        VALUES (v_ord.tenant_id, v_ord.company_id, v_ord.id, p_stage_id, CURRENT_DATE, 'draft', true)
        RETURNING id INTO v_issue_id;

        FOR v_ln IN
            SELECT (l->>'component_product_id')::uuid AS pid,
                   (l->>'required_per_unit')::numeric AS rpu,
                   COALESCE((l->>'requires_batch')::boolean,false) AS req_batch,
                   (l->>'line_id')::uuid AS bl_id
            FROM jsonb_array_elements(v_ord.bom_snapshot->'lines') l
            WHERE COALESCE(l->>'issue_method','backflush') = 'backflush'
              AND (l->>'component_product_id') IS NOT NULL
              AND ( (l->>'stage_id') IS NOT NULL AND (l->>'stage_id')::uuid = v_stage.template_stage_id
                    OR (l->>'stage_id') IS NULL AND v_is_last )
        LOOP
            v_need := COALESCE(v_ln.rpu,0) * COALESCE(p_qty_good,0);
            IF v_need <= 0 THEN CONTINUE; END IF;
            v_batch_id := NULL;
            IF v_ln.req_batch THEN
                SELECT id INTO v_batch_id FROM public.inventory_batches
                 WHERE product_id = v_ln.pid AND warehouse_id = v_wh AND COALESCE(current_quantity,0) > 0
                   AND COALESCE(status,'available') = 'available'
                 ORDER BY expiry_date NULLS LAST, received_date NULLS LAST LIMIT 1;  -- FEFO
            END IF;
            INSERT INTO public.mfg_material_issue_lines (
                tenant_id, company_id, issue_id, product_id, bom_line_id, qty, warehouse_id, batch_id)
            VALUES (v_ord.tenant_id, v_ord.company_id, v_issue_id, v_ln.pid, v_ln.bl_id, v_need, v_wh, v_batch_id);
            v_lines_cnt := v_lines_cnt + 1;
        END LOOP;

        IF v_lines_cnt > 0 THEN
            v_post := public.post_material_issue(v_issue_id, p_override_shortage);
            IF NOT COALESCE((v_post->>'success')::boolean,false) THEN
                RAISE EXCEPTION 'فشل Backflush: %', COALESCE(v_post->>'error','غير معروف');
            END IF;
        ELSE
            DELETE FROM public.mfg_material_issues WHERE id = v_issue_id;
            v_issue_id := NULL;
        END IF;
    END IF;

    -- ── إتمام المرحلة ──
    UPDATE public.mfg_order_stages SET
        status = 'done', qty_good = p_qty_good, qty_scrap = COALESCE(p_qty_scrap,0),
        started_at = COALESCE(started_at, now()), completed_at = now(), updated_at = now()
    WHERE id = p_stage_id;

    -- ── تحرير المرحلة التالية (احتراماً لزمن الانتظار) ──
    SELECT * INTO v_next FROM public.mfg_order_stages
     WHERE production_order_id = v_ord.id AND seq > v_stage.seq ORDER BY seq LIMIT 1;
    IF FOUND THEN
        IF COALESCE(v_stage.min_wait_hours,0) > 0 THEN
            UPDATE public.mfg_order_stages
               SET qty_in = p_qty_good, status = 'blocked',
                   wait_until = now() + (v_stage.min_wait_hours || ' hours')::interval, updated_at = now()
             WHERE id = v_next.id;
        ELSE
            UPDATE public.mfg_order_stages
               SET qty_in = p_qty_good, status = 'ready', updated_at = now() WHERE id = v_next.id;
        END IF;
    END IF;

    UPDATE public.mfg_production_orders
       SET status = CASE WHEN status = 'confirmed' THEN 'in_progress' ELSE status END,
           actual_start_date = COALESCE(actual_start_date, CURRENT_DATE), updated_at = now()
     WHERE id = v_ord.id;

    RETURN jsonb_build_object('success', true, 'stage_id', p_stage_id,
        'next_stage_id', v_next.id, 'is_last', v_is_last, 'backflush_issue_id', v_issue_id);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.complete_order_stage(uuid,numeric,numeric,boolean) IS
  'إكمال مرحلة أمر: تحقّق السقف + Backflush آلي (FEFO للدفعات، حظر عند النقص إلا بتجاوز/allow_negative_wip) + تحرير المرحلة التالية باحترام min_wait_hours. ذرّي.';
GRANT EXECUTE ON FUNCTION public.complete_order_stage(uuid,numeric,numeric,boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) post_production_receipt — استلام المخرجات (IN) + تقييم WIP + دفعات (§3.3/§4-ج/4)
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

    -- تحقّق المرحلة الأخيرة (إن وُجدت مراحل)
    SELECT EXISTS (SELECT 1 FROM public.mfg_order_stages WHERE production_order_id = v_ord.id) INTO v_has_stages;
    IF v_has_stages THEN
        SELECT bool_and(status = 'done') INTO v_last_done FROM public.mfg_order_stages
         WHERE production_order_id = v_ord.id
           AND seq = (SELECT MAX(seq) FROM public.mfg_order_stages WHERE production_order_id = v_ord.id);
        IF NOT COALESCE(v_last_done,false) AND NOT p_override THEN
            RETURN jsonb_build_object('success', false, 'error', 'المرحلة الأخيرة لم تكتمل بعد');
        END IF;
    END IF;

    -- إجماليات كميات الاستلام
    SELECT COALESCE(SUM(qty) FILTER (WHERE output_role IN ('primary','co_product')),0),
           COALESCE(SUM(qty) FILTER (WHERE output_role = 'scrap'),0)
      INTO v_good_qty, v_scrap_qty
      FROM public.mfg_finished_receipt_lines WHERE receipt_id = p_receipt_id;

    -- حارس تجاوز الإنتاج (§4-د/21)
    IF (COALESCE(v_ord.qty_produced,0) + v_good_qty) > v_ord.qty_planned * (1 + COALESCE(v_ord.overproduction_pct,0)/100.0) + 0.01
       AND NOT p_override THEN
        RETURN jsonb_build_object('success', false, 'error',
            'تجاوز الكمية المخطّطة + سماحية الفائض (' || v_ord.overproduction_pct || '%)');
    END IF;

    -- تجميع WIP المتاح لهذا الاستلام
    v_pool := GREATEST(0, COALESCE(v_ord.actual_material_cost,0) + COALESCE(v_ord.actual_labor_cost,0)
              + COALESCE(v_ord.actual_overhead_cost,0) + COALESCE(v_ord.subcontract_cost,0)
              - COALESCE(v_ord.received_cost,0));
    v_remaining := GREATEST(v_ord.qty_planned - COALESCE(v_ord.qty_produced,0), v_good_qty);
    v_share := CASE WHEN v_remaining > 0 THEN LEAST(v_good_qty / v_remaining, 1) ELSE 1 END;
    v_receipt_c := CASE WHEN v_good_qty > 0 THEN v_pool * v_share ELSE 0 END;

    -- قيمة استرداد الثانويات/الخردة (تُخصم من تكلفة السلع) + تكلفة المنتجات المشتركة
    SELECT COALESCE(SUM(COALESCE(rl.unit_cost,
              (SELECT o.recovery_rate FROM public.mfg_bom_outputs o
                WHERE o.bom_id = v_ord.bom_id AND o.product_id = rl.product_id AND o.output_role = rl.output_role LIMIT 1),
              0) * COALESCE(rl.qty,0)), 0)
      INTO v_credit FROM public.mfg_finished_receipt_lines rl
     WHERE rl.receipt_id = p_receipt_id AND rl.output_role IN ('byproduct','scrap');

    SELECT COALESCE(SUM(v_receipt_c * COALESCE(rl.cost_share_pct,
              (SELECT o.cost_share_pct FROM public.mfg_bom_outputs o
                WHERE o.bom_id = v_ord.bom_id AND o.product_id = rl.product_id AND o.output_role='co_product' LIMIT 1),
              0) / 100.0), 0),
           COALESCE(SUM(rl.qty) FILTER (WHERE rl.output_role='primary'),0)
      INTO v_co_cost, v_primary_q
      FROM public.mfg_finished_receipt_lines rl
     WHERE rl.receipt_id = p_receipt_id AND rl.output_role = 'co_product';
    SELECT COALESCE(SUM(qty) FILTER (WHERE output_role='primary'),0) INTO v_primary_q
      FROM public.mfg_finished_receipt_lines WHERE receipt_id = p_receipt_id;

    -- المتبقّي للرئيسي = تكلفة الاستلام − حصص المشتركة − استرداد الثانويات (لا سالب)
    v_primary_c := GREATEST(0, v_receipt_c - v_co_cost - v_credit);
    v_unit_primary := CASE WHEN v_primary_q > 0 THEN v_primary_c / v_primary_q ELSE 0 END;

    -- ── ترحيل كل سطر ──
    FOR v_line IN SELECT * FROM public.mfg_finished_receipt_lines WHERE receipt_id = p_receipt_id ORDER BY created_at
    LOOP
        v_idx := v_idx + 1;
        SELECT * INTO v_prod FROM public.products WHERE id = v_line.product_id;
        v_wh := COALESCE(v_line.warehouse_id,
                  CASE WHEN v_line.output_role IN ('scrap','byproduct')
                       THEN COALESCE(v_ord.scrap_warehouse_id, v_ord.fg_warehouse_id)
                       ELSE v_ord.fg_warehouse_id END);
        IF v_wh IS NULL THEN RAISE EXCEPTION 'لا يوجد مستودع لسطر الاستلام % (المنتج %)', v_idx, v_line.product_id; END IF;

        -- التكلفة لكل دور
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

        -- إنشاء دفعة عند تتبّع الدفعات/الصلاحية أو دفعة ممرَّرة
        IF (COALESCE(v_prod.track_batch,false) OR v_prod.shelf_life_days IS NOT NULL OR v_line.batch_id IS NOT NULL)
           AND v_line.output_role IN ('primary','co_product','byproduct') THEN
            IF v_line.batch_id IS NULL THEN
                v_batch_no := replace(replace(replace(v_fmt,
                    '{product}', COALESCE(v_prod.sku, LEFT(v_line.product_id::text,8))),
                    '{yymmdd}', to_char(v_rcp.receipt_date,'YYMMDD')),
                    '{seq}', lpad(v_idx::text,3,'0'));
                v_expiry := CASE WHEN v_prod.shelf_life_days IS NOT NULL
                                 THEN v_rcp.receipt_date + (v_prod.shelf_life_days || ' days')::interval ELSE NULL END;
                INSERT INTO public.inventory_batches (
                    tenant_id, company_id, product_id, warehouse_id, batch_number,
                    manufacturing_date, expiry_date, received_date,
                    initial_quantity, current_quantity, unit_cost, status)
                VALUES (v_ord.tenant_id, v_ord.company_id, v_line.product_id, v_wh, v_batch_no,
                    v_rcp.receipt_date, v_expiry, v_rcp.receipt_date,
                    v_line.qty, v_line.qty, v_uc, 'available')
                RETURNING id INTO v_batch_id;
            ELSE
                v_batch_id := v_line.batch_id;
            END IF;
        ELSE
            v_batch_id := v_line.batch_id;
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

    -- ── تحديث الأمر + الاستلام ──
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

    RETURN jsonb_build_object('success', true, 'receipt_id', p_receipt_id, 'receipt_number', v_num,
        'total_cost', v_consumed, 'primary_unit_cost', v_unit_primary, 'pool', v_pool, 'share', v_share);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.post_production_receipt(uuid,boolean) IS
  'استلام مخرجات الإنتاج (IN): تقييم من WIP بنسبة الكمية (co=حصة، byproduct/scrap=استرداد، primary=المتبقّي) + إنشاء دفعات (رقم من الإعدادات + expiry من shelf_life_days) + إكمال الأمر تلقائياً. all-scrap يبقي WIP للإقفال. ذرّي.';
GRANT EXECUTE ON FUNCTION public.post_production_receipt(uuid,boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8) cancel_production_order / terminate_production_order (§4-ج/3)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.cancel_production_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_ord    public.mfg_production_orders%ROWTYPE;
    v_posted int;
BEGIN
    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الأمر غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_ord.company_id); END IF;
    IF v_ord.status NOT IN ('draft','confirmed') THEN
        RETURN jsonb_build_object('success', false, 'error',
            'الإلغاء متاح فقط من مسودة/مؤكَّد؛ لأمر عليه تنفيذ استخدم الإنهاء (terminate)');
    END IF;
    SELECT (SELECT count(*) FROM public.mfg_material_issues  WHERE production_order_id = p_order_id AND status='posted')
         + (SELECT count(*) FROM public.mfg_finished_receipts WHERE production_order_id = p_order_id AND status='posted')
         + (SELECT count(*) FROM public.mfg_material_returns  WHERE production_order_id = p_order_id AND status='posted')
      INTO v_posted;
    IF v_posted > 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'لا يمكن الإلغاء: توجد مستندات مُرحَّلة — استخدم الإنهاء');
    END IF;
    PERFORM public.release_production_reservations(p_order_id);
    UPDATE public.mfg_production_orders SET status='cancelled', updated_at=now() WHERE id=p_order_id;
    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', 'cancelled');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.cancel_production_order(uuid) TO authenticated, service_role;

-- terminate: إنهاء أمر عليه تنفيذ — يفكّ الحجوزات المتبقية ويترك بقية WIP بأعمدة الأمر
-- (إقفال الانحرافات المحاسبي يأتي في P2 — لا قيود GL في P1a).
CREATE OR REPLACE FUNCTION public.terminate_production_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_ord      public.mfg_production_orders%ROWTYPE;
    v_residual numeric;
BEGIN
    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الأمر غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_ord.company_id); END IF;
    IF v_ord.status IN ('closed','cancelled','terminated') THEN
        RETURN jsonb_build_object('success', false, 'error', 'الأمر منتهٍ مسبقاً (الحالة: ' || v_ord.status || ')');
    END IF;
    PERFORM public.release_production_reservations(p_order_id);
    v_residual := GREATEST(0, COALESCE(v_ord.actual_material_cost,0) + COALESCE(v_ord.actual_labor_cost,0)
                  + COALESCE(v_ord.actual_overhead_cost,0) + COALESCE(v_ord.subcontract_cost,0)
                  - COALESCE(v_ord.received_cost,0));
    UPDATE public.mfg_production_orders
       SET status='terminated', actual_end_date=COALESCE(actual_end_date,CURRENT_DATE), updated_at=now()
     WHERE id=p_order_id;
    RETURN jsonb_build_object('success', true, 'order_id', p_order_id, 'status', 'terminated',
        'residual_wip_cost', v_residual);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.terminate_production_order(uuid) IS
  'إنهاء أمر عليه تنفيذ: فكّ الحجوزات المتبقية + تسجيل بقية WIP (residual_wip_cost). إقفال الانحرافات المحاسبي في P2.';
GRANT EXECUTE ON FUNCTION public.terminate_production_order(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- استعلام تحقّق (تشغيل يدوي بعد الترحيل — غير منفَّذ تلقائياً):
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT proname FROM pg_proc WHERE proname IN (
--   'generate_mfg_number','confirm_production_order','post_material_issue','post_material_return',
--   'complete_order_stage','post_production_receipt','cancel_production_order','terminate_production_order',
--   'release_production_reservations','release_waiting_stages') ORDER BY proname;
-- SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'mfg\_%' ORDER BY tablename;
