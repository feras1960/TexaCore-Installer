-- ════════════════════════════════════════════════════════════════
-- 🔒 20260718f — إصلاح أمني: حُرّاس موديول التصنيع PERMISSIVE → RESTRICTIVE
-- ────────────────────────────────────────────────────────────────
-- الهجرات 20260718b/c/d أنشأت سياسات module_guard على mfg_bag_codes /
-- mfg_work_center_employees / mfg_pallets بدون AS RESTRICTIVE — فتُقرأ OR
-- مع سياسة العزل، أي أن أي مستخدم من أي مستأجر لديه موديول التصنيع كان
-- يستطيع القراءة/الإدراج/التحديث عبر المستأجرين على هذه الجداول الثلاثة.
-- النمط القانوني (كبقية 38 جدولاً): الحارس RESTRICTIVE يُضرب AND مع العزل.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════

BEGIN;

-- ─── mfg_bag_codes ───────────────────────────────────────────────
DROP POLICY IF EXISTS mfg_bag_codes_module_guard        ON public.mfg_bag_codes;
DROP POLICY IF EXISTS mfg_bag_codes_module_guard_insert ON public.mfg_bag_codes;
DROP POLICY IF EXISTS mfg_bag_codes_module_guard_update ON public.mfg_bag_codes;
CREATE POLICY mfg_bag_codes_module_guard ON public.mfg_bag_codes
    AS RESTRICTIVE FOR SELECT TO public
    USING (tenant_has_module('manufacturing'::text));
CREATE POLICY mfg_bag_codes_module_guard_insert ON public.mfg_bag_codes
    AS RESTRICTIVE FOR INSERT TO public
    WITH CHECK (tenant_has_module('manufacturing'::text));
CREATE POLICY mfg_bag_codes_module_guard_update ON public.mfg_bag_codes
    AS RESTRICTIVE FOR UPDATE TO public
    USING (tenant_has_module('manufacturing'::text));

-- ─── mfg_work_center_employees ───────────────────────────────────
DROP POLICY IF EXISTS mfg_wc_employees_module_guard        ON public.mfg_work_center_employees;
DROP POLICY IF EXISTS mfg_wc_employees_module_guard_insert ON public.mfg_work_center_employees;
DROP POLICY IF EXISTS mfg_wc_employees_module_guard_update ON public.mfg_work_center_employees;
CREATE POLICY mfg_wc_employees_module_guard ON public.mfg_work_center_employees
    AS RESTRICTIVE FOR SELECT TO public
    USING (tenant_has_module('manufacturing'::text));
CREATE POLICY mfg_wc_employees_module_guard_insert ON public.mfg_work_center_employees
    AS RESTRICTIVE FOR INSERT TO public
    WITH CHECK (tenant_has_module('manufacturing'::text));
CREATE POLICY mfg_wc_employees_module_guard_update ON public.mfg_work_center_employees
    AS RESTRICTIVE FOR UPDATE TO public
    USING (tenant_has_module('manufacturing'::text));

-- ─── mfg_pallets ─────────────────────────────────────────────────
DROP POLICY IF EXISTS mfg_pallets_module_guard        ON public.mfg_pallets;
DROP POLICY IF EXISTS mfg_pallets_module_guard_insert ON public.mfg_pallets;
DROP POLICY IF EXISTS mfg_pallets_module_guard_update ON public.mfg_pallets;
CREATE POLICY mfg_pallets_module_guard ON public.mfg_pallets
    AS RESTRICTIVE FOR SELECT TO public
    USING (tenant_has_module('manufacturing'::text));
CREATE POLICY mfg_pallets_module_guard_insert ON public.mfg_pallets
    AS RESTRICTIVE FOR INSERT TO public
    WITH CHECK (tenant_has_module('manufacturing'::text));
CREATE POLICY mfg_pallets_module_guard_update ON public.mfg_pallets
    AS RESTRICTIVE FOR UPDATE TO public
    USING (tenant_has_module('manufacturing'::text));

COMMIT;
