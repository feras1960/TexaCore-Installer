-- ============================================================
-- 🔴 المرحلة 1: إصلاحات حرجة — الأعلى أولوية
-- تاريخ: 2026-04-01
-- الوصف: حذف السياسات المفتوحة (USING(true)) على عمليات الكتابة
--         لجداول تحمل بيانات tenant
-- ============================================================

BEGIN;

-- ============================================================
-- 1A: bin_locations — حذف السياسات القديمة (service_role_all + company_isolation)
-- ✅ هذا الجدول لديه بالفعل 4 policies صحيحة:
--    bin_locations_select_policy, bin_locations_insert_policy,
--    bin_locations_update_policy, bin_locations_delete_policy
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [1A] Cleaning bin_locations legacy policies...'; END $$;

DROP POLICY IF EXISTS "service_role_all" ON public.bin_locations;
DROP POLICY IF EXISTS "company_isolation" ON public.bin_locations;

DO $$ BEGIN RAISE NOTICE '✅ [1A] bin_locations cleaned — 2 legacy policies removed'; END $$;


-- ============================================================
-- 1B: fabric_groups — حذف 8 سياسات debug/open-access
-- ✅ هذا الجدول لديه بالفعل 4 policies صحيحة:
--    fabric_groups_select_policy, fabric_groups_insert_policy,
--    fabric_groups_update_policy, fabric_groups_delete_policy
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [1B] Cleaning fabric_groups debug/open policies...'; END $$;

DROP POLICY IF EXISTS "Allow authenticated delete access" ON public.fabric_groups;
DROP POLICY IF EXISTS "Allow authenticated update access" ON public.fabric_groups;
DROP POLICY IF EXISTS "Allow authenticated read access" ON public.fabric_groups;
DROP POLICY IF EXISTS "Allow authenticated insert access" ON public.fabric_groups;
DROP POLICY IF EXISTS "debug_open_select" ON public.fabric_groups;
DROP POLICY IF EXISTS "debug_safe_delete" ON public.fabric_groups;
DROP POLICY IF EXISTS "debug_safe_update" ON public.fabric_groups;
DROP POLICY IF EXISTS "debug_safe_insert" ON public.fabric_groups;

DO $$ BEGIN RAISE NOTICE '✅ [1B] fabric_groups cleaned — 8 debug/open policies removed'; END $$;


-- ============================================================
-- 1C: fabric_materials — حذف السياسات المفتوحة + إنشاء policies صحيحة
-- ⛔ هذا الجدول يحمل tenant_id + company_id لكن policies كلها USING(true)
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [1C] Fixing fabric_materials — replacing open policies with company-level isolation...'; END $$;

-- حذف كل السياسات المفتوحة
DROP POLICY IF EXISTS "Allow authenticated delete access" ON public.fabric_materials;
DROP POLICY IF EXISTS "Allow authenticated update access" ON public.fabric_materials;
DROP POLICY IF EXISTS "Allow authenticated read access" ON public.fabric_materials;
DROP POLICY IF EXISTS "Allow authenticated insert access" ON public.fabric_materials;
DROP POLICY IF EXISTS "fabric_materials_select_policy" ON public.fabric_materials;

-- إنشاء 4 policies صحيحة مع company isolation
CREATE POLICY "fabric_materials_select_policy" ON public.fabric_materials
  FOR SELECT TO authenticated
  USING (
    is_platform_admin() 
    OR check_row_access(tenant_id, company_id)
  );

CREATE POLICY "fabric_materials_insert_policy" ON public.fabric_materials
  FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin() 
    OR (tenant_id = get_user_tenant_id() AND can_access_company(company_id))
  );

CREATE POLICY "fabric_materials_update_policy" ON public.fabric_materials
  FOR UPDATE TO authenticated
  USING (
    is_platform_admin() 
    OR (tenant_id = get_user_tenant_id() AND can_access_company(company_id))
  );

CREATE POLICY "fabric_materials_delete_policy" ON public.fabric_materials
  FOR DELETE TO authenticated
  USING (
    is_platform_admin() 
    OR (tenant_id = get_user_tenant_id() AND can_access_company(company_id))
  );

DO $$ BEGIN RAISE NOTICE '✅ [1C] fabric_materials fixed — 5 open policies replaced with 4 company-level policies'; END $$;


-- ============================================================
-- 1D: roll_reservations — حذف السياسة المفتوحة + إنشاء policies صحيحة
-- ⛔ هذا الجدول يحمل tenant_id + company_id لكن policy واحدة USING(true) FOR ALL
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [1D] Fixing roll_reservations — replacing open policy with company-level isolation...'; END $$;

DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.roll_reservations;

CREATE POLICY "roll_reservations_select_policy" ON public.roll_reservations
  FOR SELECT TO authenticated
  USING (
    is_platform_admin() 
    OR check_row_access(tenant_id, company_id)
  );

CREATE POLICY "roll_reservations_insert_policy" ON public.roll_reservations
  FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin() 
    OR (tenant_id = get_user_tenant_id() AND can_access_company(company_id))
  );

CREATE POLICY "roll_reservations_update_policy" ON public.roll_reservations
  FOR UPDATE TO authenticated
  USING (
    is_platform_admin() 
    OR (tenant_id = get_user_tenant_id() AND can_access_company(company_id))
  );

CREATE POLICY "roll_reservations_delete_policy" ON public.roll_reservations
  FOR DELETE TO authenticated
  USING (
    is_platform_admin() 
    OR (tenant_id = get_user_tenant_id() AND can_access_company(company_id))
  );

DO $$ BEGIN RAISE NOTICE '✅ [1D] roll_reservations fixed — 1 open policy replaced with 4 company-level policies'; END $$;


-- ============================================================
-- 1E: ai_image_usage — JWT مباشر بدون app_metadata (خاطئ)
-- ❌ الحالي: request.jwt.claims ->> 'tenant_id' (يقرأ من root JWT)
-- ✅ الصحيح: استخدام get_user_tenant_id() 
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [1E] Fixing ai_image_usage — incorrect JWT claim path...'; END $$;

DROP POLICY IF EXISTS "ai_image_usage_tenant_isolation" ON public.ai_image_usage;

CREATE POLICY "ai_image_usage_select_policy" ON public.ai_image_usage
  FOR SELECT TO authenticated
  USING (
    is_platform_admin() 
    OR check_row_access(tenant_id, company_id)
  );

CREATE POLICY "ai_image_usage_insert_policy" ON public.ai_image_usage
  FOR INSERT TO authenticated
  WITH CHECK (
    is_platform_admin() 
    OR (tenant_id = get_user_tenant_id() AND can_access_company(company_id))
  );

CREATE POLICY "ai_image_usage_update_policy" ON public.ai_image_usage
  FOR UPDATE TO authenticated
  USING (
    is_platform_admin() 
    OR (tenant_id = get_user_tenant_id() AND can_access_company(company_id))
  );

CREATE POLICY "ai_image_usage_delete_policy" ON public.ai_image_usage
  FOR DELETE TO authenticated
  USING (
    is_platform_admin() 
    OR (tenant_id = get_user_tenant_id() AND can_access_company(company_id))
  );

DO $$ BEGIN RAISE NOTICE '✅ [1E] ai_image_usage fixed — JWT claim replaced with proper helper functions'; END $$;


-- ============================================================
-- التحقق النهائي
-- ============================================================
DO $$ 
DECLARE
  danger_count INTEGER;
BEGIN
  -- Check no more USING(true) on write ops for tenant tables
  SELECT COUNT(*) INTO danger_count
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.qual = 'true'
    AND p.cmd != 'SELECT'
    AND p.tablename IN ('bin_locations','fabric_groups','fabric_materials','roll_reservations','ai_image_usage');
  
  IF danger_count = 0 THEN
    RAISE NOTICE '✅ Phase 1 Verification PASSED — No more dangerous USING(true) on fixed tables';
  ELSE
    RAISE WARNING '❌ Phase 1 Verification FAILED — Still % dangerous policies found!', danger_count;
  END IF;
END $$;

COMMIT;

-- ============================================================
-- 📊 بعد التنفيذ، شغّل هذا الاستعلام للتحقق:
-- ============================================================
-- SELECT tablename, policyname, cmd, qual
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN ('bin_locations','fabric_groups','fabric_materials','roll_reservations','ai_image_usage')
-- ORDER BY tablename, policyname;
