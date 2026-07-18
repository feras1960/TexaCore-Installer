-- 20260717g: موديول التصنيع — P3a/Migration 4 — التتبّع + جرد WIP + مساعدات العمليات
-- ═══════════════════════════════════════════════════════════════════════════
-- يبني على 20260717d/e/f (§4-ج/8,13 · §4-د/16,17 · §5-P3). يشمل:
--   • تتبّع/استرجاع: trace_batch_forward · trace_batch_backward · batch_ledger (ربط على مستوى الأمر — v1).
--   • جرد WIP وتسويته: mfg_wip_adjustments + post_wip_adjustment (تصحيح كميات المرحلة + شطب قيمة Dr انحراف/Cr WIP).
--   • تعويض الرطوبة (§4-د/16): products.is_moisture_bearing · mfg_material_issue_lines.moisture_pct ·
--     mfg_bom_lines.is_water_adjustment + CREATE OR REPLACE post_material_issue (منع الدفعة المحجوزة/المرفوضة/المنتهية + رياضيات الرطوبة).
--   • القبّان (§4-د/17): gross/tare/net_weight على الصرف والاستلام (إدخال يدوي).
-- معادلة الرطوبة (موثّقة): wet = dry / (1 − moisture/100)؛ الماء المضاف = wet − dry يُخصم من سطر الماء.
-- idempotent: ADD COLUMN/TABLE IF NOT EXISTS + CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0) أعمدة: الرطوبة + القبّان ──
ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS is_moisture_bearing boolean DEFAULT false;
ALTER TABLE public.mfg_material_issue_lines
    ADD COLUMN IF NOT EXISTS moisture_pct numeric;
ALTER TABLE public.mfg_bom_lines
    ADD COLUMN IF NOT EXISTS is_water_adjustment boolean DEFAULT false;
COMMENT ON COLUMN public.mfg_bom_lines.is_water_adjustment IS
  'سطر الماء في الوصفة — يُخصم منه الماء المضاف مع رطوبة الركام عند الصرف (§4-د/16).';

ALTER TABLE public.mfg_material_issues
    ADD COLUMN IF NOT EXISTS gross_weight numeric,
    ADD COLUMN IF NOT EXISTS tare_weight  numeric,
    ADD COLUMN IF NOT EXISTS net_weight   numeric;
ALTER TABLE public.mfg_finished_receipts
    ADD COLUMN IF NOT EXISTS gross_weight numeric,
    ADD COLUMN IF NOT EXISTS tare_weight  numeric,
    ADD COLUMN IF NOT EXISTS net_weight   numeric;

-- ── 1) mfg_wip_adjustments — مستند تسوية جرد WIP ──
CREATE TABLE IF NOT EXISTS public.mfg_wip_adjustments (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL,
    company_id        uuid NOT NULL,
    order_id          uuid REFERENCES public.mfg_production_orders(id) ON DELETE CASCADE,
    stage_id          uuid,
    adj_number        text,
    adj_date          date DEFAULT CURRENT_DATE,
    reason            text,
    status            text NOT NULL DEFAULT 'draft',
    qty_in_delta      numeric DEFAULT 0,
    qty_good_delta    numeric DEFAULT 0,
    qty_scrap_delta   numeric DEFAULT 0,
    value_delta       numeric DEFAULT 0,
    journal_entry_id  uuid,
    posted_at         timestamptz,
    created_by        uuid,
    created_at        timestamptz DEFAULT now(),
    updated_at        timestamptz DEFAULT now()
);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mfg_wip_adjustments_status_chk') THEN
        ALTER TABLE public.mfg_wip_adjustments
            ADD CONSTRAINT mfg_wip_adjustments_status_chk CHECK (status IN ('draft','posted','reversed'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_wip_adj_order ON public.mfg_wip_adjustments (order_id);

DO $$
BEGIN
    EXECUTE 'ALTER TABLE public.mfg_wip_adjustments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS mfg_wip_adjustments_select_policy ON public.mfg_wip_adjustments';
    EXECUTE 'CREATE POLICY mfg_wip_adjustments_select_policy ON public.mfg_wip_adjustments FOR SELECT USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()))';
    EXECUTE 'DROP POLICY IF EXISTS mfg_wip_adjustments_insert_policy ON public.mfg_wip_adjustments';
    EXECUTE 'CREATE POLICY mfg_wip_adjustments_insert_policy ON public.mfg_wip_adjustments FOR INSERT TO authenticated WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))';
    EXECUTE 'DROP POLICY IF EXISTS mfg_wip_adjustments_update_policy ON public.mfg_wip_adjustments';
    EXECUTE 'CREATE POLICY mfg_wip_adjustments_update_policy ON public.mfg_wip_adjustments FOR UPDATE TO authenticated USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))';
    EXECUTE 'DROP POLICY IF EXISTS mfg_wip_adjustments_delete_policy ON public.mfg_wip_adjustments';
    EXECUTE 'CREATE POLICY mfg_wip_adjustments_delete_policy ON public.mfg_wip_adjustments FOR DELETE TO authenticated USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) post_wip_adjustment — تطبيق تصحيح كميات المرحلة + شطب القيمة (Dr انحراف / Cr WIP)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.post_wip_adjustment(p_adj_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_adj  public.mfg_wip_adjustments%ROWTYPE;
    v_ord  public.mfg_production_orders%ROWTYPE;
    v_set  public.mfg_settings%ROWTYPE;
    v_num  text;
    v_je   uuid;
    v_v    numeric;
BEGIN
    SELECT * INTO v_adj FROM public.mfg_wip_adjustments WHERE id = p_adj_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'مستند التسوية غير موجود'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_adj.company_id); END IF;
    IF v_adj.status <> 'draft' THEN
        RETURN jsonb_build_object('success', false, 'error', 'التسوية ليست بحالة مسودة');
    END IF;
    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_adj.order_id FOR UPDATE;
    IF public.journal_period_is_locked(v_adj.company_id, v_adj.adj_date) THEN
        RETURN jsonb_build_object('success', false, 'error', 'period_locked');
    END IF;

    -- تصحيح كميات المرحلة (إن حُدِّدت)
    IF v_adj.stage_id IS NOT NULL THEN
        UPDATE public.mfg_order_stages
           SET qty_in    = GREATEST(0, COALESCE(qty_in,0)    + COALESCE(v_adj.qty_in_delta,0)),
               qty_good  = GREATEST(0, COALESCE(qty_good,0)  + COALESCE(v_adj.qty_good_delta,0)),
               qty_scrap = GREATEST(0, COALESCE(qty_scrap,0) + COALESCE(v_adj.qty_scrap_delta,0)),
               updated_at = now()
         WHERE id = v_adj.stage_id;
    END IF;

    -- شطب/تعديل القيمة: value_delta موجب = شطب من WIP (Dr انحراف / Cr WIP)؛ سالب = عكسه
    v_v := COALESCE(v_adj.value_delta,0);
    IF v_v <> 0 THEN
        SELECT * INTO v_set FROM public.mfg_settings
         WHERE tenant_id = v_adj.tenant_id AND company_id = v_adj.company_id LIMIT 1;
        IF v_set.wip_account_id IS NOT NULL AND v_set.production_variance_account_id IS NOT NULL THEN
            IF v_v > 0 THEN
                v_je := public.mfg_create_and_post_je(
                    v_adj.tenant_id, v_adj.company_id, v_ord.branch_id, v_adj.adj_date,
                    'wip_adjustment', p_adj_id, v_adj.adj_number, v_ord.id,
                    'شطب قيمة WIP (جرد) — ' || COALESCE(v_adj.reason,''),
                    jsonb_build_array(
                        jsonb_build_object('account_id', v_set.production_variance_account_id, 'debit', v_v, 'credit', 0, 'desc', 'انحراف/شطب جرد WIP'),
                        jsonb_build_object('account_id', v_set.wip_account_id, 'debit', 0, 'credit', v_v, 'desc', 'تخفيض WIP')));
            ELSE
                v_je := public.mfg_create_and_post_je(
                    v_adj.tenant_id, v_adj.company_id, v_ord.branch_id, v_adj.adj_date,
                    'wip_adjustment', p_adj_id, v_adj.adj_number, v_ord.id,
                    'إضافة قيمة WIP (جرد) — ' || COALESCE(v_adj.reason,''),
                    jsonb_build_array(
                        jsonb_build_object('account_id', v_set.wip_account_id, 'debit', abs(v_v), 'credit', 0, 'desc', 'زيادة WIP'),
                        jsonb_build_object('account_id', v_set.production_variance_account_id, 'debit', 0, 'credit', abs(v_v), 'desc', 'انحراف جرد WIP')));
            END IF;
        END IF;
        -- تعديل تكلفة الأمر لمواكبة قيمة WIP (يبقى الثابت المحاسبي متّسقاً عند الإقفال)
        UPDATE public.mfg_production_orders
           SET actual_material_cost = GREATEST(0, COALESCE(actual_material_cost,0) - v_v),
               updated_at = now()
         WHERE id = v_ord.id;
    END IF;

    v_num := COALESCE(v_adj.adj_number, public.generate_mfg_number(v_adj.tenant_id, v_adj.company_id, 'WIPADJ'));
    UPDATE public.mfg_wip_adjustments
       SET status = 'posted', posted_at = now(), adj_number = v_num, journal_entry_id = v_je, updated_at = now()
     WHERE id = p_adj_id;

    RETURN jsonb_build_object('success', true, 'adjustment_id', p_adj_id, 'adj_number', v_num,
        'value_delta', v_v, 'journal_entry_id', v_je);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.post_wip_adjustment(uuid) IS
  'جرد WIP: تصحيح كميات المرحلة (qty_in/good/scrap deltas) + شطب قيمة Dr انحراف/Cr WIP (تدريجي) — بصلاحية بالواجهة (§4-ج/13).';
GRANT EXECUTE ON FUNCTION public.post_wip_adjustment(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) trace_batch_forward — دفعة خام → الصرف → الأوامر → دفعات منتَجة → مبيعاتها
--    ربط v1 على مستوى الأمر (يُعلَن): «هذه الدفعة صُرفت لأوامر أنتجت هذه الدفعات وبِيعت في...»
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trace_batch_forward(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_b       public.inventory_batches%ROWTYPE;
    v_orders  jsonb;
BEGIN
    SELECT * INTO v_b FROM public.inventory_batches WHERE id = p_batch_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الدفعة غير موجودة'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_b.company_id); END IF;

    WITH ord AS (
        SELECT DISTINCT i.production_order_id AS order_id
        FROM public.mfg_material_issue_lines il
        JOIN public.mfg_material_issues i ON i.id = il.issue_id
        WHERE il.batch_id = p_batch_id AND i.status = 'posted' AND i.production_order_id IS NOT NULL
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'order_id', o.id, 'order_number', o.order_number, 'product_id', o.product_id,
        'produced_batches', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'batch_id', pb.id, 'batch_number', pb.batch_number, 'product_id', pb.product_id,
                'qty', pb.initial_quantity, 'status', pb.status)), '[]'::jsonb)
            FROM public.inventory_batches pb WHERE pb.production_order_id = o.id),
        'sold_in', (
            SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
                'sales_transaction_id', st.id, 'doc_number', COALESCE(st.delivery_no, st.invoice_no, st.order_no),
                'stage', st.stage, 'customer', st.customer_name)), '[]'::jsonb)
            FROM public.sales_transaction_items sti
            JOIN public.sales_transactions st ON st.id = sti.transaction_id
            WHERE sti.product_id = o.product_id AND st.company_id = v_b.company_id
              AND st.stage IN ('delivery','invoice') AND NOT COALESCE(st.is_deleted,false))
    )), '[]'::jsonb)
    INTO v_orders
    FROM ord j JOIN public.mfg_production_orders o ON o.id = j.order_id;

    RETURN jsonb_build_object('success', true,
        'batch', jsonb_build_object('id', v_b.id, 'batch_number', v_b.batch_number, 'product_id', v_b.product_id),
        'granularity', 'order_level_v1', 'orders', v_orders);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.trace_batch_forward(uuid) IS
  'تتبّع أمامي (recall): دفعة خام → أوامر صُرفت لها → دفعات منتَجة → مبيعاتها (مستوى الأمر v1) (§4-ج/8).';
GRANT EXECUTE ON FUNCTION public.trace_batch_forward(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) trace_batch_backward — دفعة منتَجة → أمرها → دفعات/رولونات الخام الداخلة
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trace_batch_backward(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_b      public.inventory_batches%ROWTYPE;
    v_ord    public.mfg_production_orders%ROWTYPE;
    v_raw    jsonb;
BEGIN
    SELECT * INTO v_b FROM public.inventory_batches WHERE id = p_batch_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الدفعة غير موجودة'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_b.company_id); END IF;
    IF v_b.production_order_id IS NULL THEN
        RETURN jsonb_build_object('success', true, 'batch', jsonb_build_object('id', v_b.id, 'batch_number', v_b.batch_number),
            'note', 'الدفعة ليست ناتج إنتاج (لا أمر مصدر)', 'order', NULL, 'raw_inputs', '[]'::jsonb);
    END IF;
    SELECT * INTO v_ord FROM public.mfg_production_orders WHERE id = v_b.production_order_id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'issue_line_id', il.id, 'product_id', il.product_id, 'qty', il.qty, 'unit_cost', il.unit_cost,
        'batch_id', il.batch_id, 'batch_number', ib.batch_number, 'roll_id', il.roll_id)), '[]'::jsonb)
    INTO v_raw
    FROM public.mfg_material_issue_lines il
    JOIN public.mfg_material_issues i ON i.id = il.issue_id AND i.status = 'posted'
    LEFT JOIN public.inventory_batches ib ON ib.id = il.batch_id
    WHERE i.production_order_id = v_ord.id;

    RETURN jsonb_build_object('success', true,
        'batch', jsonb_build_object('id', v_b.id, 'batch_number', v_b.batch_number, 'product_id', v_b.product_id),
        'order', jsonb_build_object('id', v_ord.id, 'order_number', v_ord.order_number),
        'raw_inputs', v_raw);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.trace_batch_backward(uuid) IS
  'تتبّع خلفي: دفعة منتَجة → أمر الإنتاج → دفعات/رولونات الخام المصروفة له (§4-ج/8).';
GRANT EXECUTE ON FUNCTION public.trace_batch_backward(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) batch_ledger — دفتر حركة الدفعة (أحداث زمنية: إنتاج/صرف/فحص جودة)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.batch_ledger(p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_b      public.inventory_batches%ROWTYPE;
    v_events jsonb;
BEGIN
    SELECT * INTO v_b FROM public.inventory_batches WHERE id = p_batch_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الدفعة غير موجودة'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_b.company_id); END IF;

    SELECT COALESCE(jsonb_agg(e ORDER BY (e->>'ts')), '[]'::jsonb) INTO v_events FROM (
        -- إنشاء الدفعة (استلام إنتاج أو شراء)
        SELECT jsonb_build_object('ts', COALESCE(v_b.received_date::text, v_b.created_at::text),
            'event', 'created', 'qty', v_b.initial_quantity, 'ref', v_b.batch_number) AS e
        UNION ALL
        -- استلام إنتاج (سطر استلام)
        SELECT jsonb_build_object('ts', rc.receipt_date::text, 'event', 'produced',
            'qty', rl.qty, 'ref', rc.receipt_number)
        FROM public.mfg_finished_receipt_lines rl JOIN public.mfg_finished_receipts rc ON rc.id = rl.receipt_id
        WHERE rl.batch_id = p_batch_id
        UNION ALL
        -- صرف/استهلاك (سطر صرف)
        SELECT jsonb_build_object('ts', iss.issue_date::text, 'event', 'issued',
            'qty', il.qty, 'ref', iss.issue_number)
        FROM public.mfg_material_issue_lines il JOIN public.mfg_material_issues iss ON iss.id = il.issue_id
        WHERE il.batch_id = p_batch_id AND iss.status = 'posted'
        UNION ALL
        -- فحوص الجودة
        SELECT jsonb_build_object('ts', COALESCE(qt.tested_at::text, qt.due_date::text, qt.created_at::text),
            'event', 'qc_' || qt.status, 'test', qt.test_name, 'pass', qt.pass, 'value', qt.result_value)
        FROM public.mfg_qc_tests qt WHERE qt.batch_id = p_batch_id
    ) src;

    RETURN jsonb_build_object('success', true,
        'batch', jsonb_build_object('id', v_b.id, 'batch_number', v_b.batch_number, 'status', v_b.status,
            'current_quantity', v_b.current_quantity, 'expiry_date', v_b.expiry_date),
        'events', v_events);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.batch_ledger(uuid) IS
  'دفتر حركة الدفعة: أحداث زمنية (إنشاء/إنتاج/صرف/فحوص جودة) مرتّبة (§4-ج/8).';
GRANT EXECUTE ON FUNCTION public.batch_ledger(uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) CREATE OR REPLACE post_material_issue — كامل جسم P2 + P3a (منع دفعة محجوزة/مرفوضة/منتهية + رطوبة)
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
    v_settings   public.mfg_settings%ROWTYPE;
    v_inv_acct   uuid;
    v_je         uuid;
    -- تعويض الرطوبة (§4-د/16):
    v_mln        RECORD;
    v_dry        numeric;
    v_wet        numeric;
    v_added_water numeric := 0;
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

    -- ── تعويض رطوبة الركام (§4-د/16) — رياضيات وصفة خالصة قبل الترحيل ──
    -- لبنود المواد الحاملة للرطوبة مع moisture_pct: نُضخّم الكمية المصروفة من الجاف إلى الرطب
    --   wet = dry / (1 − moisture/100)  (لتسليم كتلة جافة = dry، نصرف wet من المادة الرطبة).
    -- ثم نخفض سطر الماء (bom_line.is_water_adjustment) بمجموع الماء المضاف مع الرطوبة.
    v_added_water := 0;
    FOR v_mln IN
        SELECT il.id AS line_id, il.qty, il.moisture_pct
          FROM public.mfg_material_issue_lines il
          JOIN public.products p ON p.id = il.product_id
         WHERE il.issue_id = p_issue_id
           AND COALESCE(p.is_moisture_bearing,false) = true
           AND COALESCE(il.moisture_pct,0) > 0 AND COALESCE(il.moisture_pct,0) < 100
    LOOP
        v_dry := COALESCE(v_mln.qty,0);
        IF v_dry <= 0 THEN CONTINUE; END IF;
        v_wet := v_dry / (1 - v_mln.moisture_pct/100.0);
        UPDATE public.mfg_material_issue_lines SET qty = round(v_wet,6) WHERE id = v_mln.line_id;
        v_added_water := v_added_water + (v_wet - v_dry);
    END LOOP;
    IF v_added_water > 0.000001 THEN
        -- خصم الماء المضاف من أول سطر ماء معلَّم is_water_adjustment (لا يقل عن صفر)
        UPDATE public.mfg_material_issue_lines il
           SET qty = GREATEST(0, COALESCE(il.qty,0) - round(v_added_water,6))
         WHERE il.id = (
            SELECT il2.id FROM public.mfg_material_issue_lines il2
              JOIN public.mfg_bom_lines bl ON bl.id = il2.bom_line_id
             WHERE il2.issue_id = p_issue_id AND COALESCE(bl.is_water_adjustment,false) = true
             ORDER BY il2.created_at LIMIT 1);
    END IF;

    FOR v_line IN SELECT * FROM public.mfg_material_issue_lines WHERE issue_id = p_issue_id ORDER BY created_at
    LOOP
        v_idx := v_idx + 1;
        v_wh  := COALESCE(v_line.warehouse_id, v_ord.source_warehouse_id);
        IF v_wh IS NULL THEN RAISE EXCEPTION 'لا يوجد مستودع للسطر % (المنتج %)', v_idx, v_line.product_id; END IF;

        IF v_line.roll_id IS NOT NULL THEN
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
            SELECT * INTO v_batch FROM public.inventory_batches WHERE id = v_line.batch_id FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'الدفعة غير موجودة: %', v_line.batch_id; END IF;
            IF v_batch.product_id IS DISTINCT FROM v_line.product_id THEN
                RAISE EXCEPTION 'الدفعة % لا تخصّ المنتج المطلوب', v_batch.batch_number;
            END IF;
            -- إنفاذ حجر/رفض/انتهاء الدفعة (P3a §4-ج/9): محجورة/مرفوضة لا تُصرف، والمنتهية محظورة
            IF COALESCE(v_batch.status,'available') IN ('on_hold','rejected') THEN
                RAISE EXCEPTION 'الدفعة % بحالة % — لا يمكن صرفها (محجورة/مرفوضة)', v_batch.batch_number, v_batch.status;
            END IF;
            IF v_batch.expiry_date IS NOT NULL AND v_batch.expiry_date < v_iss.issue_date THEN
                RAISE EXCEPTION 'الدفعة % منتهية الصلاحية (%) — لا يمكن صرفها', v_batch.batch_number, v_batch.expiry_date;
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

        UPDATE public.mfg_material_issue_lines
           SET unit_cost = v_cost, qty = v_qty, movement_id = v_mv_id WHERE id = v_line.id;
        v_mv_ids := array_append(v_mv_ids, v_mv_id);
        v_total  := v_total + (v_cost * v_qty);

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
                        RAISE EXCEPTION 'انحراف استهلاك %٪ يتجاوز ضعف حدّ السماح %٪ للمنتج % — يلزم تجاوز مشرف', round(v_dev,2), v_tol, v_line.product_id;
                    END IF;
                END IF;
            END IF;
        END IF;

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

    -- ── GL: مدين WIP / دائن المخزون (progressive: يُتخطّى إن لم تُضبط الحسابات) ──
    IF v_total > 0 THEN
        SELECT * INTO v_settings FROM public.mfg_settings
         WHERE tenant_id = v_iss.tenant_id AND company_id = v_iss.company_id LIMIT 1;
        v_inv_acct := public.resolve_posting_account(v_iss.company_id, 'receipt_inventory');
        IF v_settings.wip_account_id IS NOT NULL AND v_inv_acct IS NOT NULL THEN
            v_je := public.mfg_create_and_post_je(
                v_iss.tenant_id, v_iss.company_id, v_ord.branch_id, v_iss.issue_date,
                'production_issue', p_issue_id, v_num, v_ord.id,
                'صرف مواد للإنتاج — ' || COALESCE(v_num,''),
                jsonb_build_array(
                    jsonb_build_object('account_id', v_settings.wip_account_id, 'debit', v_total, 'credit', 0, 'desc', 'أعمال تحت التنفيذ (WIP)'),
                    jsonb_build_object('account_id', v_inv_acct, 'debit', 0, 'credit', v_total, 'desc', 'صرف مخزون خام')));
            IF v_je IS NOT NULL THEN
                UPDATE public.mfg_material_issues SET journal_entry_id = v_je WHERE id = p_issue_id;
                UPDATE public.mfg_production_orders SET wip_journal_entry_id = COALESCE(wip_journal_entry_id, v_je) WHERE id = v_ord.id;
            END IF;
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'issue_id', p_issue_id, 'issue_number', v_num,
        'movement_ids', to_jsonb(v_mv_ids), 'material_cost', v_total, 'warnings', v_warn, 'journal_entry_id', v_je);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.post_material_issue(uuid,boolean) IS
  'ترحيل صرف مواد الإنتاج (OUT) + قصّ رولونات/دفعات + استهلاك الحجوزات + سماحية الاستهلاك + قفل الفترة + GL مدين WIP/دائن المخزون (تدريجي). P3a: منع صرف دفعة محجوزة/مرفوضة/منتهية + تعويض رطوبة الركام (§4-د/16). ذرّي.';
GRANT EXECUTE ON FUNCTION public.post_material_issue(uuid,boolean) TO authenticated, service_role;
