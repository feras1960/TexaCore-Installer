-- 20260717b: موديول التصنيع — الأجور + إعادة التشغيل + إعادة تقدير BOM — P2 (طبقة القاعدة)
-- ═══════════════════════════════════════════════════════════════════════════
-- يبني على 20260717a. يشمل:
--   • mfg_payroll_sweeps (جدول جسر التكامل مع مسيّر HR — القرار: جسر لا حقن مباشر).
--   • حارس عدم قابلية تعديل سجلات العمل المرحّلة للمسيّر (trigger).
--   • add_labor_log (تحقّق السقف §4-ج/7 + حساب الأجر) · approve_labor_logs (اعتماد + قيد استيعاب أجور) ·
--     unapprove_labor_logs (فكّ الاعتماد + عكس القيد) · sweep_labor_to_payroll (ترحيل للمسيّر).
--   • record_stage_rework (§4-ج/11) · recalc_bom_estimates (§4-ج/17).
-- كل الدوال: SECURITY DEFINER + SET search_path + GRANT · RETURNS jsonb {success,error?} · ذرّية.
-- قيد الاستيعاب لكل أمر داخل دفعة الاعتماد (WIP خاص بالأمر) — مدين WIP / دائن أجور إنتاج مستوعبة.
-- idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- (المعاملة يديرها مطبّق المايجريشن)

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) جدول جسر ترحيل الأجور — mfg_payroll_sweeps
--    قرار التكامل: payroll_entries صفّه لكل موظف/فترة براتب أساسي إلزامي ودورة حياة صارمة؛
--    الحقن المباشر قبل تشغيل المسيّر يُفبرك/يُفسد كشفاً. لذا نُبقي الجسر مصدرَ الحقيقة الدائم
--    (يقرؤه المسيّر لاحقاً كبند «أجر إنتاج»)، مع مزامنة أفضل-جهد لكشف قائم إن وُجد.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_payroll_sweeps (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          uuid NOT NULL,
    company_id         uuid NOT NULL,
    payroll_period_id  uuid NOT NULL REFERENCES public.payroll_periods(id) ON DELETE CASCADE,
    employee_id        uuid NOT NULL,
    total_wage         numeric DEFAULT 0,
    log_count          int DEFAULT 0,
    swept_by           uuid,
    swept_at           timestamptz DEFAULT now(),
    UNIQUE (payroll_period_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_mfg_payroll_sweeps_tenant_company ON public.mfg_payroll_sweeps (tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_mfg_payroll_sweeps_period ON public.mfg_payroll_sweeps (payroll_period_id);

ALTER TABLE public.mfg_payroll_sweeps ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    EXECUTE 'DROP POLICY IF EXISTS mfg_payroll_sweeps_select_policy ON public.mfg_payroll_sweeps';
    EXECUTE 'CREATE POLICY mfg_payroll_sweeps_select_policy ON public.mfg_payroll_sweeps FOR SELECT USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()))';
    EXECUTE 'DROP POLICY IF EXISTS mfg_payroll_sweeps_insert_policy ON public.mfg_payroll_sweeps';
    EXECUTE 'CREATE POLICY mfg_payroll_sweeps_insert_policy ON public.mfg_payroll_sweeps FOR INSERT TO authenticated WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))';
    EXECUTE 'DROP POLICY IF EXISTS mfg_payroll_sweeps_update_policy ON public.mfg_payroll_sweeps';
    EXECUTE 'CREATE POLICY mfg_payroll_sweeps_update_policy ON public.mfg_payroll_sweeps FOR UPDATE TO authenticated USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))';
    EXECUTE 'DROP POLICY IF EXISTS mfg_payroll_sweeps_delete_policy ON public.mfg_payroll_sweeps';
    EXECUTE 'CREATE POLICY mfg_payroll_sweeps_delete_policy ON public.mfg_payroll_sweeps FOR DELETE TO authenticated USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) حارس عدم قابلية التعديل — سجل مرحّل للمسيّر (payroll_entry_id / status='swept') لا يُعدَّل/يُحذف
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mfg_labor_logs_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
BEGIN
    IF TG_OP IN ('UPDATE','DELETE') THEN
        IF OLD.payroll_entry_id IS NOT NULL OR COALESCE(OLD.status,'pending') = 'swept' THEN
            RAISE EXCEPTION 'سجل عمل مُرحَّل للمسيّر غير قابل للتعديل/الحذف (log %)', OLD.id;
        END IF;
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_mfg_labor_logs_guard ON public.mfg_labor_logs;
CREATE TRIGGER trg_mfg_labor_logs_guard
    BEFORE UPDATE OR DELETE ON public.mfg_labor_logs
    FOR EACH ROW EXECUTE FUNCTION public.mfg_labor_logs_guard();

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) add_labor_log — تسجيل عمل مع تحقّق السقف (§4-ج/7) وحساب الأجر
--    p_log: {production_order_id, order_stage_id, employee_id, work_date, minutes,
--            qty_good, qty_reject, pay_type?, rate?}
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.add_labor_log(p_log jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_stage    public.mfg_order_stages%ROWTYPE;
    v_order_id uuid := (p_log->>'production_order_id')::uuid;
    v_stage_id uuid := (p_log->>'order_stage_id')::uuid;
    v_qg  numeric := COALESCE((p_log->>'qty_good')::numeric, 0);
    v_qr  numeric := COALESCE((p_log->>'qty_reject')::numeric, 0);
    v_min numeric := COALESCE((p_log->>'minutes')::numeric, 0);
    v_emp uuid := NULLIF(p_log->>'employee_id','')::uuid;
    v_pay text; v_rate numeric; v_wage numeric; v_sum numeric; v_id uuid;
BEGIN
    IF v_stage_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'order_stage_id مطلوب'); END IF;
    SELECT * INTO v_stage FROM public.mfg_order_stages WHERE id = v_stage_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'المرحلة غير موجودة'); END IF;
    IF v_order_id IS NOT NULL AND v_stage.production_order_id <> v_order_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'المرحلة لا تخصّ الأمر المحدّد');
    END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_stage.company_id); END IF;

    -- سقف: Σ (جيّد+مرفوض) على سجلات المرحلة (pending+approved+swept) + الجديد ≤ qty_in
    SELECT COALESCE(SUM(COALESCE(qty_good,0) + COALESCE(qty_reject,0)), 0) INTO v_sum
      FROM public.mfg_labor_logs WHERE order_stage_id = v_stage_id;
    IF COALESCE(v_stage.qty_in,0) > 0 AND (v_sum + v_qg + v_qr) > v_stage.qty_in + 0.01 THEN
        RETURN jsonb_build_object('success', false, 'error',
            'تجاوز سقف كمية المرحلة (qty_in=' || v_stage.qty_in || '، المسجّل=' || v_sum || '، الجديد=' || (v_qg + v_qr) || ')');
    END IF;

    v_pay  := COALESCE(NULLIF(p_log->>'pay_type',''), v_stage.pay_type, 'none');
    v_rate := COALESCE((p_log->>'rate')::numeric, v_stage.piece_rate, 0);
    v_wage := CASE WHEN v_pay = 'per_piece' THEN v_rate * v_qg
                   WHEN v_pay = 'hourly'    THEN v_rate * v_min / 60.0
                   ELSE 0 END;

    INSERT INTO public.mfg_labor_logs (
        tenant_id, company_id, production_order_id, order_stage_id, employee_id,
        work_date, minutes, qty_good, qty_reject, pay_type, rate, wage_amount, status, created_by)
    VALUES (v_stage.tenant_id, v_stage.company_id, v_stage.production_order_id, v_stage_id, v_emp,
        COALESCE((p_log->>'work_date')::date, CURRENT_DATE), v_min, v_qg, v_qr, v_pay, v_rate, round(v_wage,4), 'pending', auth.uid())
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('success', true, 'log_id', v_id, 'wage_amount', round(v_wage,4), 'pay_type', v_pay);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.add_labor_log(jsonb) IS
  'تسجيل عمل: تحقّق المرحلة تخصّ الأمر + سقف Σ(جيّد+مرفوض)≤qty_in + حساب الأجر (قطعة/ساعة، لقطة السعر). status=pending. ذرّي.';
GRANT EXECUTE ON FUNCTION public.add_labor_log(jsonb) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) approve_labor_logs — اعتماد + قيد استيعاب أجور (مدين WIP/دائن أجور مستوعبة) لكل أمر
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.approve_labor_logs(p_log_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_r        RECORD;
    v_settings public.mfg_settings%ROWTYPE;
    v_branch   uuid;
    v_je       uuid;
    v_approved int := 0;
    v_je_count int := 0;
BEGIN
    IF p_log_ids IS NULL OR array_length(p_log_ids,1) IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'لا سجلات');
    END IF;

    UPDATE public.mfg_labor_logs
       SET status = 'approved', approved_by = auth.uid(), approved_at = now()
     WHERE id = ANY(p_log_ids) AND COALESCE(status,'pending') = 'pending' AND payroll_entry_id IS NULL;
    GET DIAGNOSTICS v_approved = ROW_COUNT;

    FOR v_r IN
        SELECT production_order_id, tenant_id, company_id, SUM(COALESCE(wage_amount,0)) AS wage
        FROM public.mfg_labor_logs
        WHERE id = ANY(p_log_ids) AND status = 'approved' AND journal_entry_id IS NULL
        GROUP BY production_order_id, tenant_id, company_id
    LOOP
        UPDATE public.mfg_production_orders
           SET actual_labor_cost = COALESCE(actual_labor_cost,0) + v_r.wage, updated_at = now()
         WHERE id = v_r.production_order_id;

        IF v_r.wage > 0 THEN
            SELECT * INTO v_settings FROM public.mfg_settings
             WHERE tenant_id = v_r.tenant_id AND company_id = v_r.company_id LIMIT 1;
            SELECT branch_id INTO v_branch FROM public.mfg_production_orders WHERE id = v_r.production_order_id;
            IF v_settings.wip_account_id IS NOT NULL AND v_settings.labor_absorption_account_id IS NOT NULL
               AND NOT public.journal_period_is_locked(v_r.company_id, CURRENT_DATE) THEN
                v_je := public.mfg_create_and_post_je(
                    v_r.tenant_id, v_r.company_id, v_branch, CURRENT_DATE,
                    'production_labor', v_r.production_order_id, NULL, v_r.production_order_id,
                    'استيعاب أجور إنتاج معتمَدة',
                    jsonb_build_array(
                        jsonb_build_object('account_id', v_settings.wip_account_id, 'debit', round(v_r.wage,4), 'credit', 0, 'desc', 'أجور إلى WIP'),
                        jsonb_build_object('account_id', v_settings.labor_absorption_account_id, 'debit', 0, 'credit', round(v_r.wage,4), 'desc', 'أجور إنتاج مستوعبة')));
                IF v_je IS NOT NULL THEN
                    UPDATE public.mfg_labor_logs SET journal_entry_id = v_je
                     WHERE id = ANY(p_log_ids) AND status = 'approved' AND journal_entry_id IS NULL
                       AND production_order_id = v_r.production_order_id;
                    v_je_count := v_je_count + 1;
                END IF;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'approved_count', v_approved, 'journal_entries', v_je_count);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.approve_labor_logs(uuid[]) IS
  'اعتماد سجلات العمل (approved_by/at) + قيد استيعاب أجور لكل أمر (مدين WIP/دائن أجور مستوعبة) + رفع actual_labor_cost. ذرّي.';
GRANT EXECUTE ON FUNCTION public.approve_labor_logs(uuid[]) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) unapprove_labor_logs — فكّ اعتماد (عكس قيد الاستيعاب) للسجلات غير المرحّلة للمسيّر
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.unapprove_labor_logs(p_log_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_r    RECORD;
    v_cnt  int := 0;
BEGIN
    IF p_log_ids IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'لا سجلات'); END IF;
    IF EXISTS (SELECT 1 FROM public.mfg_labor_logs WHERE id = ANY(p_log_ids) AND (payroll_entry_id IS NOT NULL OR status='swept')) THEN
        RETURN jsonb_build_object('success', false, 'error', 'يوجد سجل مُرحَّل للمسيّر — لا يمكن فكّ اعتماده');
    END IF;

    -- عكس قيود الاستيعاب + خصم تكلفة الأجر لكل أمر
    FOR v_r IN
        SELECT production_order_id, journal_entry_id, SUM(COALESCE(wage_amount,0)) AS wage
        FROM public.mfg_labor_logs
        WHERE id = ANY(p_log_ids) AND status = 'approved'
        GROUP BY production_order_id, journal_entry_id
    LOOP
        UPDATE public.mfg_production_orders
           SET actual_labor_cost = GREATEST(0, COALESCE(actual_labor_cost,0) - v_r.wage), updated_at = now()
         WHERE id = v_r.production_order_id;
        IF v_r.journal_entry_id IS NOT NULL THEN
            PERFORM public.delete_journal_entry_soft(v_r.journal_entry_id, 'فكّ اعتماد أجور إنتاج');
        END IF;
    END LOOP;

    UPDATE public.mfg_labor_logs
       SET status = 'pending', approved_by = NULL, approved_at = NULL, journal_entry_id = NULL
     WHERE id = ANY(p_log_ids) AND status = 'approved';
    GET DIAGNOSTICS v_cnt = ROW_COUNT;

    RETURN jsonb_build_object('success', true, 'unapproved_count', v_cnt);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
GRANT EXECUTE ON FUNCTION public.unapprove_labor_logs(uuid[]) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) sweep_labor_to_payroll — تجميع الأجور المعتمَدة غير المرحّلة إلى الجسر + مزامنة كشف قائم
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.sweep_labor_to_payroll(
    p_period_id uuid, p_employee_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_period   public.payroll_periods%ROWTYPE;
    v_r        RECORD;
    v_sweep_id uuid;
    v_cum      numeric;
    v_count    int := 0;
    v_total    numeric := 0;
    v_emps     int := 0;
BEGIN
    SELECT * INTO v_period FROM public.payroll_periods WHERE id = p_period_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'فترة الرواتب غير موجودة'); END IF;

    FOR v_r IN
        SELECT employee_id, tenant_id, company_id,
               SUM(COALESCE(wage_amount,0)) AS wage, count(*) AS n, array_agg(id) AS ids
        FROM public.mfg_labor_logs
        WHERE status = 'approved' AND payroll_entry_id IS NULL AND employee_id IS NOT NULL
          AND work_date BETWEEN v_period.start_date AND v_period.end_date
          AND (p_employee_id IS NULL OR employee_id = p_employee_id)
        GROUP BY employee_id, tenant_id, company_id
    LOOP
        INSERT INTO public.mfg_payroll_sweeps (
            tenant_id, company_id, payroll_period_id, employee_id, total_wage, log_count, swept_by)
        VALUES (v_r.tenant_id, v_r.company_id, p_period_id, v_r.employee_id, round(v_r.wage,4), v_r.n, auth.uid())
        ON CONFLICT (payroll_period_id, employee_id) DO UPDATE SET
            total_wage = mfg_payroll_sweeps.total_wage + EXCLUDED.total_wage,
            log_count  = mfg_payroll_sweeps.log_count + EXCLUDED.log_count,
            swept_at   = now()
        RETURNING id, total_wage INTO v_sweep_id, v_cum;

        -- وسم السجلات كمرحّلة (يجعلها غير قابلة للتعديل عبر الحارس)
        UPDATE public.mfg_labor_logs SET payroll_entry_id = v_sweep_id, status = 'swept'
         WHERE id = ANY(v_r.ids);

        -- مزامنة أفضل-جهد إلى كشف قائم (إن وُجد صفّ للموظف/الفترة): بند production_wages + رفع الإجماليات
        UPDATE public.payroll_entries pe SET
            components = (SELECT COALESCE(jsonb_agg(c), '[]'::jsonb)
                          FROM jsonb_array_elements(COALESCE(pe.components,'[]'::jsonb)) c
                          WHERE COALESCE(c->>'code','') <> 'production_wages')
                         || jsonb_build_array(jsonb_build_object(
                              'code','production_wages','name','أجر إنتاج','type','earning','amount', v_cum)),
            total_earnings = COALESCE(pe.total_earnings,0) + v_r.wage,
            net_salary     = COALESCE(pe.net_salary,0) + v_r.wage,
            updated_at     = now()
        WHERE pe.payroll_period_id = p_period_id AND pe.employee_id = v_r.employee_id;

        v_count := v_count + v_r.n; v_total := v_total + v_r.wage; v_emps := v_emps + 1;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'employees', v_emps, 'logs_swept', v_count, 'total_wage', round(v_total,4));
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.sweep_labor_to_payroll(uuid,uuid) IS
  'ترحيل الأجور المعتمَدة غير المرحّلة إلى جسر mfg_payroll_sweeps لكل موظف بالفترة + وسم السجلات swept (غير قابلة للتعديل) + مزامنة أفضل-جهد لكشف قائم. القرار: جسر لا حقن مباشر بـ payroll_entries (راتب أساسي إلزامي/دورة حياة صارمة). ذرّي.';
GRANT EXECUTE ON FUNCTION public.sweep_labor_to_payroll(uuid,uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) record_stage_rework — إعادة تشغيل: كمية تعود لمرحلة سابقة (§4-ج/11)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.record_stage_rework(
    p_stage_id uuid, p_qty numeric, p_target_stage_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_stage  public.mfg_order_stages%ROWTYPE;
    v_target public.mfg_order_stages%ROWTYPE;
BEGIN
    IF COALESCE(p_qty,0) <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'الكمية يجب أن تكون موجبة'); END IF;
    SELECT * INTO v_stage FROM public.mfg_order_stages WHERE id = p_stage_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'المرحلة غير موجودة'); END IF;
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(v_stage.company_id); END IF;
    SELECT * INTO v_target FROM public.mfg_order_stages WHERE id = p_target_stage_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'المرحلة الهدف غير موجودة'); END IF;
    IF v_target.production_order_id <> v_stage.production_order_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'المرحلة الهدف لا تخصّ نفس الأمر');
    END IF;
    IF v_target.seq >= v_stage.seq THEN
        RETURN jsonb_build_object('success', false, 'error', 'المرحلة الهدف يجب أن تكون سابقة (seq أقل)');
    END IF;
    IF COALESCE(p_qty,0) > COALESCE(v_stage.qty_good,0) + COALESCE(v_stage.qty_in,0) + 0.01 THEN
        RETURN jsonb_build_object('success', false, 'error', 'كمية إعادة التشغيل تتجاوز كمية المرحلة');
    END IF;

    UPDATE public.mfg_order_stages
       SET qty_rework = COALESCE(qty_rework,0) + p_qty, updated_at = now()
     WHERE id = p_stage_id;

    UPDATE public.mfg_order_stages
       SET qty_in = COALESCE(qty_in,0) + p_qty,
           status = CASE WHEN status = 'done' THEN 'in_progress'
                         WHEN status = 'blocked' THEN 'ready'
                         ELSE status END,
           completed_at = CASE WHEN status = 'done' THEN NULL ELSE completed_at END,
           updated_at = now()
     WHERE id = p_target_stage_id;

    RETURN jsonb_build_object('success', true, 'stage_id', p_stage_id, 'target_stage_id', p_target_stage_id, 'qty', p_qty);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.record_stage_rework(uuid,numeric,uuid) IS
  'إعادة تشغيل: qty_rework يزيد على المرحلة الحالية، وqty_in يزيد على مرحلة سابقة تُفتح ثانيةً (done→in_progress). الأجور تُسجَّل عادةً. ذرّي.';
GRANT EXECUTE ON FUNCTION public.record_stage_rework(uuid,numeric,uuid) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8) recalc_bom_estimates — إعادة تقدير تكاليف BOM (مفرد/جماعي) من المتوسط الحالي (§4-ج/17)
--    المواد: Σ (كمية البند × متوسط تكلفة الشركة المرجّح)؛ الأجور/الأوفرهيد من مراحل القالب.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.recalc_bom_estimates(
    p_company_id uuid, p_bom_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_bom      public.mfg_boms%ROWTYPE;
    v_material numeric;
    v_labor    numeric;
    v_overhead numeric;
    v_qty      numeric;
    v_count    int := 0;
BEGIN
    IF auth.uid() IS NOT NULL THEN PERFORM public.assert_can_access_company(p_company_id); END IF;

    FOR v_bom IN
        SELECT * FROM public.mfg_boms
        WHERE company_id = p_company_id
          AND (p_bom_id IS NULL OR id = p_bom_id)
          AND COALESCE(is_active, true) = true
    LOOP
        v_qty := COALESCE(NULLIF(v_bom.quantity,0), 1);

        -- المواد: متوسط الشركة المرجّح لكل مكوّن × كمية البند (basis=per_unit → لكل وحدة؛ formula → لكل دفعة مرجعية)
        SELECT COALESCE(SUM(
                 COALESCE(bl.qty_per_unit,
                   CASE WHEN bl.formula_pct IS NOT NULL THEN v_qty * bl.formula_pct / 100.0 ELSE 0 END, 0)
                 * COALESCE(ac.avg_cost, 0)), 0)
          INTO v_material
          FROM public.mfg_bom_lines bl
          LEFT JOIN LATERAL (
              SELECT CASE WHEN SUM(COALESCE(quantity_on_hand,0)) > 0
                          THEN SUM(COALESCE(quantity_on_hand,0) * COALESCE(average_cost,0)) / SUM(COALESCE(quantity_on_hand,0))
                          ELSE AVG(COALESCE(average_cost,0)) END AS avg_cost
              FROM public.inventory_stock s
              JOIN public.warehouses w ON w.id = s.warehouse_id AND w.company_id = p_company_id
              WHERE s.product_id = bl.component_product_id
          ) ac ON true
          WHERE bl.bom_id = v_bom.id;

        -- الأجور + الأوفرهيد من مراحل القالب
        v_labor := 0; v_overhead := 0;
        IF v_bom.workflow_template_id IS NOT NULL THEN
            SELECT COALESCE(SUM(CASE WHEN ws.pay_type = 'per_piece' THEN COALESCE(ws.piece_rate,0) * v_qty ELSE 0 END), 0),
                   COALESCE(SUM(((COALESCE(ws.expected_minutes_per_unit,0) * v_qty + COALESCE(ws.fixed_minutes,0)) / 60.0)
                                * COALESCE(wc.hour_rate,0)), 0)
              INTO v_labor, v_overhead
              FROM public.mfg_workflow_stages ws
              LEFT JOIN public.mfg_work_centers wc ON wc.id = ws.work_center_id
             WHERE ws.template_id = v_bom.workflow_template_id;
        END IF;

        UPDATE public.mfg_boms SET
            est_material_cost  = round(v_material, 4),
            est_labor_cost     = round(v_labor, 4),
            est_operating_cost = round(v_overhead, 4),
            est_total_cost     = round(v_material + v_labor + v_overhead, 4),
            est_costs_updated_at = now(),
            updated_at = now()
        WHERE id = v_bom.id;
        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'boms_updated', v_count);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$fn$;
COMMENT ON FUNCTION public.recalc_bom_estimates(uuid,uuid) IS
  'إعادة تقدير تكاليف BOM (مفرد/جماعي): المواد من المتوسط المرجّح الحالي للشركة، الأجور/الأوفرهيد من مراحل القالب، + est_costs_updated_at. ذرّي.';
GRANT EXECUTE ON FUNCTION public.recalc_bom_estimates(uuid,uuid) TO authenticated, service_role;
