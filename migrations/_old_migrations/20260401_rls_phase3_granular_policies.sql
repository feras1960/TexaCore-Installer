-- ============================================================
-- 🟡 المرحلة 3: ترقية الجداول ذات Policy واحدة (FOR ALL)
-- تاريخ: 2026-04-01
-- الوصف: تقسيم سياسات FOR ALL إلى 4 سياسات مفصلة (S/I/U/D)
--         + ترقية tenant-only إلى company-level حيث ينطبق
-- ============================================================

BEGIN;

-- ============================================================
-- 3A: جداول tenant-only (لا تحمل company_id) — تقسيم FOR ALL إلى 4
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [3A] Splitting FOR ALL tenant policies into 4 granular policies...'; END $$;

-- ---------- crm_campaign_contacts (tenant_id فقط) ----------
DROP POLICY IF EXISTS "campaign_contacts_tenant_access" ON public.crm_campaign_contacts;

CREATE POLICY "crm_campaign_contacts_select_policy" ON public.crm_campaign_contacts
  FOR SELECT TO authenticated
  USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "crm_campaign_contacts_insert_policy" ON public.crm_campaign_contacts
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "crm_campaign_contacts_update_policy" ON public.crm_campaign_contacts
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "crm_campaign_contacts_delete_policy" ON public.crm_campaign_contacts
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND is_tenant_admin()));

-- ---------- employee_documents (tenant_id فقط) ----------
DROP POLICY IF EXISTS "employee_documents_tenant_access" ON public.employee_documents;

CREATE POLICY "employee_documents_select_policy" ON public.employee_documents
  FOR SELECT TO authenticated
  USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "employee_documents_insert_policy" ON public.employee_documents
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "employee_documents_update_policy" ON public.employee_documents
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "employee_documents_delete_policy" ON public.employee_documents
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND is_tenant_admin()));

-- ---------- employee_salary_details (tenant_id فقط) ----------
DROP POLICY IF EXISTS "employee_salary_tenant_access" ON public.employee_salary_details;

CREATE POLICY "employee_salary_details_select_policy" ON public.employee_salary_details
  FOR SELECT TO authenticated
  USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "employee_salary_details_insert_policy" ON public.employee_salary_details
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "employee_salary_details_update_policy" ON public.employee_salary_details
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "employee_salary_details_delete_policy" ON public.employee_salary_details
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND is_tenant_admin()));

-- ---------- leave_balances (tenant_id فقط) ----------
DROP POLICY IF EXISTS "leave_balances_tenant_access" ON public.leave_balances;

CREATE POLICY "leave_balances_select_policy" ON public.leave_balances
  FOR SELECT TO authenticated
  USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "leave_balances_insert_policy" ON public.leave_balances
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "leave_balances_update_policy" ON public.leave_balances
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "leave_balances_delete_policy" ON public.leave_balances
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND is_tenant_admin()));

-- ---------- payroll_entries (tenant_id فقط) ----------
DROP POLICY IF EXISTS "payroll_entries_tenant_access" ON public.payroll_entries;

CREATE POLICY "payroll_entries_select_policy" ON public.payroll_entries
  FOR SELECT TO authenticated
  USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "payroll_entries_insert_policy" ON public.payroll_entries
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "payroll_entries_update_policy" ON public.payroll_entries
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "payroll_entries_delete_policy" ON public.payroll_entries
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND is_tenant_admin()));

DO $$ BEGIN RAISE NOTICE '✅ [3A] 5 tenant-only tables upgraded from FOR ALL to 4 granular policies'; END $$;


-- ============================================================
-- 3B: جداول خاصة
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [3B] Fixing special tables...'; END $$;

-- ---------- telegram_settings (user_id + company_id, بدون tenant_id) ----------
-- هذا الجدول خاص — كل مستخدم يملك إعداداته فقط
-- الـ policy الحالية (telegram_own: user_id = auth.uid()) مقبولة 
-- لكن نحتاج تقسيمها لـ 4 policies
DROP POLICY IF EXISTS "telegram_own" ON public.telegram_settings;

CREATE POLICY "telegram_settings_select_policy" ON public.telegram_settings
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "telegram_settings_insert_policy" ON public.telegram_settings
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "telegram_settings_update_policy" ON public.telegram_settings
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "telegram_settings_delete_policy" ON public.telegram_settings
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DO $$ BEGIN RAISE NOTICE '✅ [3B] telegram_settings split into 4 user-level policies'; END $$;


-- ============================================================
-- 3C: الجداول ذات 2 policies (تحتاج تكملة)
-- معظمها store/website — يحتاج SELECT عام + كتابة مقيدة
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [3C] Completing tables with only 2 policies...'; END $$;

-- ---------- company_announcements ----------
-- لديه select + insert فقط — يحتاج update + delete
DO $$
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_announcements' AND policyname='company_announcements_update_policy') THEN
    EXECUTE 'CREATE POLICY "company_announcements_update_policy" ON public.company_announcements FOR UPDATE TO authenticated USING (is_platform_admin() OR (tenant_id = get_user_tenant_id()))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='company_announcements' AND policyname='company_announcements_delete_policy') THEN
    EXECUTE 'CREATE POLICY "company_announcements_delete_policy" ON public.company_announcements FOR DELETE TO authenticated USING (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND is_tenant_admin()))';
  END IF;
END $$;

-- ---------- status_history ----------
-- لديه select + insert فقط — يحتاج update + delete
DO $$
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='status_history' AND policyname='status_history_update_policy') THEN
    EXECUTE 'CREATE POLICY "status_history_update_policy" ON public.status_history FOR UPDATE TO authenticated USING (is_platform_admin() OR (tenant_id = get_user_tenant_id()))';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='status_history' AND policyname='status_history_delete_policy') THEN
    EXECUTE 'CREATE POLICY "status_history_delete_policy" ON public.status_history FOR DELETE TO authenticated USING (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND is_tenant_admin()))';
  END IF;
END $$;

-- ---------- transaction_stage_log (لا يحمل tenant_id — audit log) ----------
DO $$
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='transaction_stage_log' AND policyname='transaction_stage_log_update_policy') THEN
    EXECUTE 'CREATE POLICY "transaction_stage_log_update_policy" ON public.transaction_stage_log FOR UPDATE TO authenticated USING (is_platform_admin())';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='transaction_stage_log' AND policyname='transaction_stage_log_delete_policy') THEN
    EXECUTE 'CREATE POLICY "transaction_stage_log_delete_policy" ON public.transaction_stage_log FOR DELETE TO authenticated USING (is_platform_admin())';
  END IF;
END $$;

-- ---------- employee_points ----------
DO $$
DECLARE has_tenant BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='employee_points' AND column_name='tenant_id') INTO has_tenant;
  IF has_tenant THEN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_points' AND policyname='employee_points_update_policy') THEN
      EXECUTE 'CREATE POLICY "employee_points_update_policy" ON public.employee_points FOR UPDATE TO authenticated USING (is_platform_admin() OR (tenant_id = get_user_tenant_id()))';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_points' AND policyname='employee_points_delete_policy') THEN
      EXECUTE 'CREATE POLICY "employee_points_delete_policy" ON public.employee_points FOR DELETE TO authenticated USING (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND is_tenant_admin()))';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_points' AND policyname='employee_points_update_policy') THEN
      EXECUTE 'CREATE POLICY "employee_points_update_policy" ON public.employee_points FOR UPDATE TO authenticated USING (is_platform_admin())';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='employee_points' AND policyname='employee_points_delete_policy') THEN
      EXECUTE 'CREATE POLICY "employee_points_delete_policy" ON public.employee_points FOR DELETE TO authenticated USING (is_platform_admin())';
    END IF;
  END IF;
END $$;

-- ---------- dismissed_announcements ----------
DO $$
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='dismissed_announcements' AND policyname='dismissed_announcements_update_policy') THEN
    EXECUTE 'CREATE POLICY "dismissed_announcements_update_policy" ON public.dismissed_announcements FOR UPDATE TO authenticated USING (user_id = auth.uid())';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='dismissed_announcements' AND policyname='dismissed_announcements_delete_policy') THEN
    EXECUTE 'CREATE POLICY "dismissed_announcements_delete_policy" ON public.dismissed_announcements FOR DELETE TO authenticated USING (user_id = auth.uid())';
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '✅ [3C] 5 tables completed with missing policies'; END $$;


-- ============================================================
-- 3D: الجداول ذات 3 policies (ناقصة واحدة)
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [3D] Adding missing DELETE policies for 3-policy tables...'; END $$;

-- ---------- ai_realtime_alerts ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='ai_realtime_alerts' AND cmd='DELETE') THEN
    EXECUTE 'CREATE POLICY "ai_realtime_alerts_delete_policy" ON public.ai_realtime_alerts FOR DELETE TO authenticated USING (is_platform_admin() OR (tenant_id = get_user_tenant_id()))';
  END IF;
END $$;

-- ---------- login_history — لا يحتاج delete (audit log) ----------

-- ---------- security_events — لا يحتاج delete (audit log) ----------

-- ---------- trusted_devices ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='trusted_devices' AND cmd='UPDATE') THEN
    EXECUTE 'CREATE POLICY "trusted_devices_update_policy" ON public.trusted_devices FOR UPDATE TO authenticated USING (user_id = auth.uid())';
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '✅ [3D] Missing individual policies added'; END $$;


-- ============================================================
-- التحقق النهائي للمرحلة 3
-- ============================================================
DO $$ 
DECLARE
  single_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO single_count
  FROM (
    SELECT t.tablename, COUNT(p.policyname) as cnt
    FROM pg_tables t
    LEFT JOIN pg_policies p ON t.tablename = p.tablename AND p.schemaname = 'public'
    WHERE t.schemaname = 'public'
      AND t.tablename NOT LIKE '_%'  -- exclude backup tables
    GROUP BY t.tablename
    HAVING COUNT(p.policyname) < 3
  ) sub;
  
  RAISE NOTICE '📊 Phase 3 Result: % tables still have fewer than 3 policies', single_count;
END $$;

COMMIT;
