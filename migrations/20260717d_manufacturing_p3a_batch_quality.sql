-- 20260717d: موديول التصنيع — P3a/Migration 1 — دورة حياة جودة الدفعات (Batch Quality Lifecycle)
-- ═══════════════════════════════════════════════════════════════════════════
-- يبني على 20260716e/f/g + 20260717a/b. يشمل (§3.6/§3.7 · §4-ج/8,9 · §4-د/4,14,15 · §5-P3):
--   • توسعة inventory_batches: retest_date/hold_until/held_reason/released_by/released_at/qc_results/production_order_id.
--     (status يبقى نصّاً حرّاً كعُرف المنصّة — لا CHECK حتى لا نكسر صفوفاً حيّة؛ القيم المعتمدة:
--      available|on_hold|released|rejected — تُنفَّذ برمجياً في الدوال والفهارس).
--   • mfg_settings.receipt_batch_status ('available'|'on_hold') — خيار المستأجر: هل تبدأ دفعات الإنتاج محجورة؟
--   • mfg_boms.curing_hold_days (معالجة زمنية) + deferred_qc_template (قالب فحوص مؤجلة 7/28 يوماً).
--   • mfg_material_reservations.reservation_kind + sales_transaction_id (يمهّد لحجز الناتج MTO في M2).
--   • mfg_qc_tests: فحوص مجدولة/مؤجلة لكل دفعة.
--   • RPCs: schedule_batch_qc_tests · release_batch · reject_batch · requarantine_due_batches · release_timed_holds.
--   • pg_cron: إعادة الحجر عند استحقاق إعادة الفحص + الإفراج الزمني (يوميّاً — نمط cashback-expiry).
--   • CREATE OR REPLACE complete_order_stage — استبعاد الدفعات المحجوزة/المرفوضة/المنتهية من مُلتقِط FEFO
--     (يحمل كامل جسم P2: Backflush/أوفرهيد/GL/إشعارات — بلا تراجع).
-- idempotent: ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT EXISTS + CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0) توسعة inventory_batches ──
ALTER TABLE public.inventory_batches
    ADD COLUMN IF NOT EXISTS retest_date          date,
    ADD COLUMN IF NOT EXISTS hold_until           timestamptz,
    ADD COLUMN IF NOT EXISTS held_reason          text,
    ADD COLUMN IF NOT EXISTS released_by          uuid,
    ADD COLUMN IF NOT EXISTS released_at          timestamptz,
    ADD COLUMN IF NOT EXISTS qc_results           jsonb DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS production_order_id  uuid;

COMMENT ON COLUMN public.inventory_batches.status IS
  'حالة الدفعة (نصّ حرّ كعُرف المنصّة). القيم المعتمدة للتصنيع: available|on_hold|released|rejected. المحجورة/المرفوضة/المنتهية لا تُصرف ولا تُحجز.';

CREATE INDEX IF NOT EXISTS idx_inv_batches_hold_until
    ON public.inventory_batches (hold_until) WHERE hold_until IS NOT NULL AND status = 'on_hold';
CREATE INDEX IF NOT EXISTS idx_inv_batches_retest_due
    ON public.inventory_batches (retest_date) WHERE retest_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_batches_prod_order
    ON public.inventory_batches (production_order_id) WHERE production_order_id IS NOT NULL;

-- ── 1) mfg_settings: حالة دفعات الاستلام الافتراضية ──
ALTER TABLE public.mfg_settings
    ADD COLUMN IF NOT EXISTS receipt_batch_status text DEFAULT 'available';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mfg_settings_receipt_batch_status_chk') THEN
        ALTER TABLE public.mfg_settings
            ADD CONSTRAINT mfg_settings_receipt_batch_status_chk
            CHECK (receipt_batch_status IN ('available','on_hold'));
    END IF;
END $$;

-- ── 2) mfg_boms: معالجة زمنية + قالب فحوص مؤجلة ──
ALTER TABLE public.mfg_boms
    ADD COLUMN IF NOT EXISTS curing_hold_days     int,
    ADD COLUMN IF NOT EXISTS deferred_qc_template jsonb;
COMMENT ON COLUMN public.mfg_boms.curing_hold_days IS
  'أيام معالجة/تجفيف زمني للدفعة المنتَجة — تبدأ on_hold وتُفرَج تلقائياً عند hold_until (§4-د/15).';
COMMENT ON COLUMN public.mfg_boms.deferred_qc_template IS
  'قالب فحوص مؤجلة يُجدوَل على الدفعة عند الاستلام: [{"name":"compression_7d","offset_days":7},...] (§4-د/14).';

-- ── 3) mfg_material_reservations: نوع الحجز + رابط أمر البيع (لحجز الناتج MTO في M2) ──
ALTER TABLE public.mfg_material_reservations
    ADD COLUMN IF NOT EXISTS reservation_kind     text DEFAULT 'raw_material',
    ADD COLUMN IF NOT EXISTS sales_transaction_id uuid;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mfg_material_reservations_kind_chk') THEN
        ALTER TABLE public.mfg_material_reservations
            ADD CONSTRAINT mfg_material_reservations_kind_chk
            CHECK (reservation_kind IN ('raw_material','fg_for_sale'));
    END IF;
END $$;

-- ── 4) mfg_qc_tests — فحوص مجدولة/مؤجلة لكل دفعة ──
CREATE TABLE IF NOT EXISTS public.mfg_qc_tests (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL,
    company_id          uuid NOT NULL,
    batch_id            uuid REFERENCES public.inventory_batches(id) ON DELETE CASCADE,
    production_order_id  uuid,
    test_name           text NOT NULL,
    due_date            date,
    offset_days         int,
    result_value        numeric,
    result_text         text,
    pass                boolean,
    status              text NOT NULL DEFAULT 'scheduled',
    tested_at           timestamptz,
    tested_by           uuid,
    notes               text,
    custom_data         jsonb DEFAULT '{}'::jsonb,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now()
);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mfg_qc_tests_status_chk') THEN
        ALTER TABLE public.mfg_qc_tests
            ADD CONSTRAINT mfg_qc_tests_status_chk CHECK (status IN ('scheduled','passed','failed','cancelled'));
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_mfg_qc_tests_batch ON public.mfg_qc_tests (batch_id);
CREATE INDEX IF NOT EXISTS idx_mfg_qc_tests_due   ON public.mfg_qc_tests (due_date) WHERE status = 'scheduled';

-- RLS قياسي (نموذج 20260716a) —
ALTER TABLE public.mfg_qc_tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfg_qc_tests_select_policy ON public.mfg_qc_tests;
CREATE POLICY mfg_qc_tests_select_policy ON public.mfg_qc_tests
    FOR SELECT USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()));
DROP POLICY IF EXISTS mfg_qc_tests_insert_policy ON public.mfg_qc_tests;
CREATE POLICY mfg_qc_tests_insert_policy ON public.mfg_qc_tests
    FOR INSERT TO authenticated WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
DROP POLICY IF EXISTS mfg_qc_tests_update_policy ON public.mfg_qc_tests;
CREATE POLICY mfg_qc_tests_update_policy ON public.mfg_qc_tests
    FOR UPDATE TO authenticated USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
DROP POLICY IF EXISTS mfg_qc_tests_delete_policy ON public.mfg_qc_tests;
CREATE POLICY mfg_qc_tests_delete_policy ON public.mfg_qc_tests
    FOR DELETE TO authenticated USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) schedule_batch_qc_tests(p_batch_id, p_tests) — جدولة فحوص مؤجلة على دفعة
--    p_tests: [{"name":"compression_7d","offset_days":7}, ...]؛ due_date = تاريخ التصنيع + offset.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.schedule_batch_qc_tests(
    p_batch_id uuid, p_tests jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_b   public.inventory_batches%ROWTYPE;
    v_t   jsonb;
    v_n   int := 0;
    v_off int;
BEGIN
    SELECT * INTO v_b FROM public.inventory_batches WHERE id = p_batch_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الدفعة غير موجودة'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_b.company_id); END IF;
    IF p_tests IS NULL OR jsonb_typeof(p_tests) <> 'array' THEN
        RETURN jsonb_build_object('success', true, 'scheduled', 0);
    END IF;
    FOR v_t IN SELECT * FROM jsonb_array_elements(p_tests)
    LOOP
        IF COALESCE(v_t->>'name','') = '' THEN CONTINUE; END IF;
        v_off := COALESCE((v_t->>'offset_days')::int, 0);
        INSERT INTO public.mfg_qc_tests (
            tenant_id, company_id, batch_id, production_order_id, test_name, offset_days, due_date, status)
        VALUES (v_b.tenant_id, v_b.company_id, v_b.id, v_b.production_order_id, v_t->>'name', v_off,
            COALESCE(v_b.manufacturing_date, CURRENT_DATE) + (v_off || ' days')::interval, 'scheduled');
        v_n := v_n + 1;
    END LOOP;
    RETURN jsonb_build_object('success', true, 'scheduled', v_n);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.schedule_batch_qc_tests(uuid,jsonb) IS
  'جدولة فحوص مؤجلة على دفعة من قالب [{name,offset_days}]؛ due_date = manufacturing_date + offset (§4-د/14).';
GRANT EXECUTE ON FUNCTION public.schedule_batch_qc_tests(uuid,jsonb) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) release_batch / reject_batch — إفراج/رفض دفعة (بصلاحية بالواجهة) — يختم released_by/at
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.release_batch(
    p_batch_id uuid, p_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE v_b public.inventory_batches%ROWTYPE;
BEGIN
    SELECT * INTO v_b FROM public.inventory_batches WHERE id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الدفعة غير موجودة'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_b.company_id); END IF;
    IF COALESCE(v_b.status,'available') = 'rejected' THEN
        RETURN jsonb_build_object('success', false, 'error', 'الدفعة مرفوضة — لا يمكن الإفراج عنها');
    END IF;
    UPDATE public.inventory_batches
       SET status = 'released', released_by = auth.uid(), released_at = now(),
           held_reason = COALESCE(p_note, held_reason)
     WHERE id = p_batch_id;
    RETURN jsonb_build_object('success', true, 'batch_id', p_batch_id, 'status', 'released');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.release_batch(uuid,text) IS 'إفراج دفعة من الحجر → released (تُصبح قابلة للصرف/الحجز) + ختم released_by/at.';
GRANT EXECUTE ON FUNCTION public.release_batch(uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reject_batch(
    p_batch_id uuid, p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE v_b public.inventory_batches%ROWTYPE;
BEGIN
    SELECT * INTO v_b FROM public.inventory_batches WHERE id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'الدفعة غير موجودة'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_b.company_id); END IF;
    UPDATE public.inventory_batches
       SET status = 'rejected', released_by = auth.uid(), released_at = now(),
           held_reason = COALESCE(p_reason, held_reason)
     WHERE id = p_batch_id;
    RETURN jsonb_build_object('success', true, 'batch_id', p_batch_id, 'status', 'rejected');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.reject_batch(uuid,text) IS 'رفض دفعة → rejected (لا تُصرف ولا تُحجز) + سبب الرفض.';
GRANT EXECUTE ON FUNCTION public.reject_batch(uuid,text) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) requarantine_due_batches — إعادة الحجر عند استحقاق إعادة الفحص (retest) — لـ pg_cron
--    الدفعة المفرَج عنها/المتاحة يعود حجرها عند بلوغ retest_date (معيار كيميائيات §4-د/4).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.requarantine_due_batches()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE v_n int;
BEGIN
    UPDATE public.inventory_batches
       SET status = 'on_hold', held_reason = 'إعادة فحص مستحقة (retest)',
           released_by = NULL, released_at = NULL
     WHERE retest_date IS NOT NULL AND retest_date <= CURRENT_DATE
       AND COALESCE(status,'available') IN ('available','released')
       AND COALESCE(current_quantity,0) > 0;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'requarantined', v_n);
END;
$fn$;
COMMENT ON FUNCTION public.requarantine_due_batches() IS 'إعادة حجر الدفعات المستحقّة لإعادة الفحص (retest_date ≤ اليوم) — لمهمة pg_cron يومية.';
GRANT EXECUTE ON FUNCTION public.requarantine_due_batches() TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8) release_timed_holds — الإفراج الزمني التلقائي (المعالجة/التجفيف انتهت) — لـ pg_cron
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.release_timed_holds()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE v_n int;
BEGIN
    UPDATE public.inventory_batches
       SET status = 'released', released_at = now(),
           held_reason = COALESCE(NULLIF(held_reason,''),'') ||
                         CASE WHEN COALESCE(held_reason,'') = '' THEN 'إفراج زمني' ELSE ' — إفراج زمني' END
     WHERE COALESCE(status,'available') = 'on_hold'
       AND hold_until IS NOT NULL AND hold_until <= now();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'released', v_n);
END;
$fn$;
COMMENT ON FUNCTION public.release_timed_holds() IS 'إفراج زمني تلقائي عن الدفعات المحجورة التي بلغ hold_until موعدها (§4-د/15) — لمهمة pg_cron يومية.';
GRANT EXECUTE ON FUNCTION public.release_timed_holds() TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9) جدولة pg_cron (نمط cashback-expiry): يوميّاً — idempotent عبر cron.schedule(name,...)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule('mfg-requarantine-retest-due', '30 2 * * *', 'SELECT public.requarantine_due_batches();');
        PERFORM cron.schedule('mfg-release-timed-holds',     '35 2 * * *', 'SELECT public.release_timed_holds();');
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10) CREATE OR REPLACE complete_order_stage — (كامل جسم P2) + FEFO يستبعد المحجوز/المرفوض/المنتهي
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
    v_settings   public.mfg_settings%ROWTYPE;
    v_je         uuid;
    v_lab_min    numeric;
    v_oh_min     numeric := 0;
    v_hour_rate  numeric := 0;
    v_cycle_rate numeric := 0;
    v_overhead   numeric := 0;
    v_next_ready boolean := false;
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

    IF v_ord.bom_snapshot IS NOT NULL THEN
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
            PERFORM public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['production_manager'],
                'نقص مواد يمنع إكمال المرحلة', 'الأمر ' || COALESCE(v_ord.order_number,'') || ' — المرحلة ' || COALESCE(v_stage.name_ar,''),
                '/manufacturing?order=' || v_ord.id, 'mfg_shortage', '⛔');
            RETURN jsonb_build_object('success', false, 'error', 'نقص مواد للـBackflush', 'shortage', v_shortage);
        END IF;

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
                -- FEFO: استبعاد الدفعات المحجوزة/المرفوضة (P3a) والمنتهية الصلاحية — الأقرب انتهاءً أولاً
                SELECT id INTO v_batch_id FROM public.inventory_batches
                 WHERE product_id = v_ln.pid AND warehouse_id = v_wh AND COALESCE(current_quantity,0) > 0
                   AND COALESCE(status,'available') IN ('available','released')
                   AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
                 ORDER BY expiry_date NULLS LAST, received_date NULLS LAST LIMIT 1;
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

    UPDATE public.mfg_order_stages SET
        status = 'done', qty_good = p_qty_good, qty_scrap = COALESCE(p_qty_scrap,0),
        started_at = COALESCE(started_at, now()), completed_at = now(), updated_at = now()
    WHERE id = p_stage_id;

    -- ── استيعاب الأوفرهيد للمرحلة (§4-ج/15 + §4-د/13) ──
    SELECT COALESCE(SUM(minutes),0) INTO v_lab_min
      FROM public.mfg_labor_logs WHERE order_stage_id = p_stage_id AND COALESCE(minutes,0) > 0;
    IF v_lab_min > 0 THEN
        v_oh_min := v_lab_min;
    ELSIF COALESCE(v_stage.is_passive,false) AND v_stage.started_at IS NOT NULL THEN
        v_oh_min := GREATEST(0, EXTRACT(EPOCH FROM (now() - v_stage.started_at)) / 60.0);
    ELSE
        v_oh_min := COALESCE(v_stage.expected_minutes_per_unit,0) * COALESCE(p_qty_good,0) + COALESCE(v_stage.fixed_minutes,0);
    END IF;

    IF v_stage.work_center_id IS NOT NULL THEN
        SELECT COALESCE(hour_rate,0),
               COALESCE((SELECT SUM((c->>'rate_per_cycle')::numeric)
                          FROM jsonb_array_elements(COALESCE(cost_components,'[]'::jsonb)) c
                         WHERE c->>'type' = 'per_cycle'), 0)
          INTO v_hour_rate, v_cycle_rate
          FROM public.mfg_work_centers WHERE id = v_stage.work_center_id;
    END IF;
    v_overhead := round(((COALESCE(v_oh_min,0) / 60.0) * COALESCE(v_hour_rate,0)
                  + COALESCE(v_cycle_rate,0) * COALESCE(p_qty_good,0))::numeric, 4);

    UPDATE public.mfg_order_stages SET actual_minutes = v_oh_min WHERE id = p_stage_id;

    IF v_overhead > 0 THEN
        UPDATE public.mfg_production_orders
           SET actual_overhead_cost = COALESCE(actual_overhead_cost,0) + v_overhead, updated_at = now()
         WHERE id = v_ord.id;
        SELECT * INTO v_settings FROM public.mfg_settings
         WHERE tenant_id = v_ord.tenant_id AND company_id = v_ord.company_id LIMIT 1;
        IF v_settings.wip_account_id IS NOT NULL AND v_settings.overhead_absorption_account_id IS NOT NULL
           AND NOT public.journal_period_is_locked(v_ord.company_id, CURRENT_DATE) THEN
            v_je := public.mfg_create_and_post_je(
                v_ord.tenant_id, v_ord.company_id, v_ord.branch_id, CURRENT_DATE,
                'production_overhead', p_stage_id, v_ord.order_number, v_ord.id,
                'استيعاب أوفرهيد مرحلة — ' || COALESCE(v_stage.name_ar,''),
                jsonb_build_array(
                    jsonb_build_object('account_id', v_settings.wip_account_id, 'debit', v_overhead, 'credit', 0, 'desc', 'أوفرهيد إلى WIP'),
                    jsonb_build_object('account_id', v_settings.overhead_absorption_account_id, 'debit', 0, 'credit', v_overhead, 'desc', 'أوفرهيد إنتاج مستوعب')));
        END IF;
    END IF;

    -- ── تحرير المرحلة التالية (باحترام زمن الانتظار) ──
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
            v_next_ready := true;
        END IF;
    END IF;

    UPDATE public.mfg_production_orders
       SET status = CASE WHEN status = 'confirmed' THEN 'in_progress' ELSE status END,
           actual_start_date = COALESCE(actual_start_date, CURRENT_DATE), updated_at = now()
     WHERE id = v_ord.id;

    IF v_next_ready THEN
        PERFORM public.mfg_notify(v_ord.tenant_id, v_ord.company_id, ARRAY['production_manager'],
            'مرحلة جاهزة للبدء', 'الأمر ' || COALESCE(v_ord.order_number,'') || ' — ' || COALESCE(v_next.name_ar,''),
            '/manufacturing?order=' || v_ord.id, 'mfg_stage_ready', '▶️');
    END IF;

    RETURN jsonb_build_object('success', true, 'stage_id', p_stage_id,
        'next_stage_id', v_next.id, 'is_last', v_is_last, 'backflush_issue_id', v_issue_id,
        'overhead_absorbed', v_overhead, 'overhead_minutes', v_oh_min, 'overhead_journal_entry_id', v_je);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.complete_order_stage(uuid,numeric,numeric,boolean) IS
  'إكمال مرحلة: Backflush (FEFO/حظر النقص) + استيعاب أوفرهيد (دقائق فعلية/سلبية بالمنقضي/متوقعة × معدل المحطة + per_cycle) + GL مدين WIP/دائن أوفرهيد + إشعار الجاهزية/النقص. ذرّي.';
GRANT EXECUTE ON FUNCTION public.complete_order_stage(uuid,numeric,numeric,boolean) TO authenticated, service_role;
