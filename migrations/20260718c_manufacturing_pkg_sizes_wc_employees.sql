-- ════════════════════════════════════════════════════════════════
-- 🏭 20260718c — تعبئة بأحجام متعددة + عاملو المحطة (Manufacturing UX round)
-- ────────────────────────────────────────────────────────────────
-- ① mfg_bom_outputs.package_sizes jsonb — قائمة أحجام العبوات القياسية
--    للمخرَج (مثال [25,20,5]). افتراضات إعلامية: الاستلام يملأ سطراً لكل
--    حجم مُهيّأ (قابل للتحرير). لا يكسر default_package_size القائم.
-- ② mfg_work_center_employees — junction عاملي المحطة (تعيين + primary).
--    الأجر الفعلي (بالقطعة/بالساعة) يأتي من مرحلة سير العمل؛ الرواتب الثابتة
--    من عقود الموارد البشرية — هذا الجدول تعيينٌ تنظيمي/أولوية فرز فقط.
-- Idempotent · RLS قانوني (نفس نمط mfg_bag_codes) + حارس الموديول.
-- ════════════════════════════════════════════════════════════════

-- ─── ① أحجام العبوات المتعددة على مخرَج الوصفة ────────────────────
ALTER TABLE public.mfg_bom_outputs
    ADD COLUMN IF NOT EXISTS package_sizes jsonb;
COMMENT ON COLUMN public.mfg_bom_outputs.package_sizes IS
    'قائمة أحجام العبوات القياسية لهذا المخرَج (مصفوفة أرقام، مثال [25,20,5]). '
    'افتراضات إعلامية للاستلام — سطور الاستلام تقبل أي حجم لكل سطر.';

-- ─── ② junction عاملي المحطة ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mfg_work_center_employees (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL,
    company_id     uuid NOT NULL,
    work_center_id uuid NOT NULL REFERENCES public.mfg_work_centers(id) ON DELETE CASCADE,
    employee_id    uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    is_primary     boolean NOT NULL DEFAULT false,
    note           text,
    created_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.mfg_work_center_employees IS
    'عاملو المحطة (تعيين تنظيمي + أولوية فرز في الكشك). الأجر بالقطعة/الساعة '
    'يُضبط على مرحلة سير العمل؛ الرواتب الثابتة من عقود الموارد البشرية.';

CREATE UNIQUE INDEX IF NOT EXISTS mfg_wc_employees_uq
    ON public.mfg_work_center_employees(work_center_id, employee_id);
CREATE INDEX IF NOT EXISTS mfg_wc_employees_wc_idx
    ON public.mfg_work_center_employees(work_center_id);
CREATE INDEX IF NOT EXISTS mfg_wc_employees_emp_idx
    ON public.mfg_work_center_employees(employee_id);
CREATE INDEX IF NOT EXISTS mfg_wc_employees_tenant_idx
    ON public.mfg_work_center_employees(tenant_id, company_id);

ALTER TABLE public.mfg_work_center_employees ENABLE ROW LEVEL SECURITY;

-- RLS قانوني (نفس نمط mfg_bag_codes) + حارس الموديول.
DROP POLICY IF EXISTS mfg_wc_employees_select_policy       ON public.mfg_work_center_employees;
DROP POLICY IF EXISTS mfg_wc_employees_insert_policy       ON public.mfg_work_center_employees;
DROP POLICY IF EXISTS mfg_wc_employees_update_policy       ON public.mfg_work_center_employees;
DROP POLICY IF EXISTS mfg_wc_employees_delete_policy       ON public.mfg_work_center_employees;
DROP POLICY IF EXISTS mfg_wc_employees_module_guard        ON public.mfg_work_center_employees;
DROP POLICY IF EXISTS mfg_wc_employees_module_guard_insert ON public.mfg_work_center_employees;
DROP POLICY IF EXISTS mfg_wc_employees_module_guard_update ON public.mfg_work_center_employees;

CREATE POLICY mfg_wc_employees_select_policy ON public.mfg_work_center_employees
    FOR SELECT TO public
    USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()));
CREATE POLICY mfg_wc_employees_insert_policy ON public.mfg_work_center_employees
    FOR INSERT TO authenticated
    WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
CREATE POLICY mfg_wc_employees_update_policy ON public.mfg_work_center_employees
    FOR UPDATE TO authenticated
    USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
CREATE POLICY mfg_wc_employees_delete_policy ON public.mfg_work_center_employees
    FOR DELETE TO authenticated
    USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)));
CREATE POLICY mfg_wc_employees_module_guard ON public.mfg_work_center_employees
    FOR SELECT TO public USING (tenant_has_module('manufacturing'::text));
CREATE POLICY mfg_wc_employees_module_guard_insert ON public.mfg_work_center_employees
    FOR INSERT TO public WITH CHECK (tenant_has_module('manufacturing'::text));
CREATE POLICY mfg_wc_employees_module_guard_update ON public.mfg_work_center_employees
    FOR UPDATE TO public USING (tenant_has_module('manufacturing'::text));
