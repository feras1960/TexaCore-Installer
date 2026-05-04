-- ============================================================
-- 🔵 المرحلة 4: إصلاح Store/Website (public read) + تنظيف عام
-- تاريخ: 2026-04-01
-- الوصف: 
--   4A: إصلاح جداول الستور والموقع (تحتاج قراءة عامة + كتابة مقيدة)
--   4B: إصلاح USING(true) ALL على جداول لا تحتاجها
--   4C: تنظيف store policies القديمة (app.current_tenant_id)
-- ============================================================

BEGIN;

-- ============================================================
-- 4A: إصلاح testimonials, features, hero_content, news, contact_info
--     هذه جداول ستور/موقع: SELECT عام (anon) + كتابة لـ platform admin فقط
--     المشكلة: لديها ALL USING(true) → أي authenticated يقدر يعدّل
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [4A] Fixing store CMS tables — public read + admin write...'; END $$;

-- ---------- testimonials ----------
DROP POLICY IF EXISTS "testimonials_auth" ON public.testimonials;
DROP POLICY IF EXISTS "testimonials_public_read" ON public.testimonials;

CREATE POLICY "testimonials_select_policy" ON public.testimonials
  FOR SELECT USING (true);  -- anon + authenticated يقدرون يقرأون

CREATE POLICY "testimonials_insert_policy" ON public.testimonials
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY "testimonials_update_policy" ON public.testimonials
  FOR UPDATE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "testimonials_delete_policy" ON public.testimonials
  FOR DELETE TO authenticated
  USING (is_platform_admin());

-- ---------- features ----------
DROP POLICY IF EXISTS "features_auth" ON public.features;
DROP POLICY IF EXISTS "features_public_read" ON public.features;

CREATE POLICY "features_select_policy" ON public.features
  FOR SELECT USING (true);

CREATE POLICY "features_insert_policy" ON public.features
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY "features_update_policy" ON public.features
  FOR UPDATE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "features_delete_policy" ON public.features
  FOR DELETE TO authenticated
  USING (is_platform_admin());

-- ---------- hero_content ----------
DROP POLICY IF EXISTS "hero_content_auth" ON public.hero_content;
DROP POLICY IF EXISTS "hero_content_public_read" ON public.hero_content;

CREATE POLICY "hero_content_select_policy" ON public.hero_content
  FOR SELECT USING (true);

CREATE POLICY "hero_content_insert_policy" ON public.hero_content
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY "hero_content_update_policy" ON public.hero_content
  FOR UPDATE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "hero_content_delete_policy" ON public.hero_content
  FOR DELETE TO authenticated
  USING (is_platform_admin());

-- ---------- news ----------
DROP POLICY IF EXISTS "news_auth" ON public.news;
DROP POLICY IF EXISTS "news_public_read" ON public.news;

CREATE POLICY "news_select_policy" ON public.news
  FOR SELECT USING (true);

CREATE POLICY "news_insert_policy" ON public.news
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY "news_update_policy" ON public.news
  FOR UPDATE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "news_delete_policy" ON public.news
  FOR DELETE TO authenticated
  USING (is_platform_admin());

-- ---------- contact_info ----------
DROP POLICY IF EXISTS "contact_info_auth" ON public.contact_info;
DROP POLICY IF EXISTS "contact_info_public_read" ON public.contact_info;

CREATE POLICY "contact_info_select_policy" ON public.contact_info
  FOR SELECT USING (true);

CREATE POLICY "contact_info_insert_policy" ON public.contact_info
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY "contact_info_update_policy" ON public.contact_info
  FOR UPDATE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "contact_info_delete_policy" ON public.contact_info
  FOR DELETE TO authenticated
  USING (is_platform_admin());

-- ---------- announcement_settings ----------
DROP POLICY IF EXISTS "announcement_settings_auth" ON public.announcement_settings;
DROP POLICY IF EXISTS "announcement_settings_public_read" ON public.announcement_settings;

CREATE POLICY "announcement_settings_select_policy" ON public.announcement_settings
  FOR SELECT USING (true);

CREATE POLICY "announcement_settings_insert_policy" ON public.announcement_settings
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin());

CREATE POLICY "announcement_settings_update_policy" ON public.announcement_settings
  FOR UPDATE TO authenticated
  USING (is_platform_admin());

CREATE POLICY "announcement_settings_delete_policy" ON public.announcement_settings
  FOR DELETE TO authenticated
  USING (is_platform_admin());

DO $$ BEGIN RAISE NOTICE '✅ [4A] 6 store CMS tables fixed — public read + admin-only write'; END $$;


-- ============================================================
-- 4B: إصلاح ai_opus_usage, company_insights, employee_kpis
--     هذه جداول بـ USING(true) ALL لكن ليست ستور
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [4B] Fixing AI/internal tables with open ALL policies...'; END $$;

-- ---------- ai_opus_usage ----------
DROP POLICY IF EXISTS "opus_usage_service" ON public.ai_opus_usage;
-- لا يملك tenant_id — هذا جدول platform-level
DO $$
DECLARE has_tenant BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_opus_usage' AND column_name='tenant_id') INTO has_tenant;
  IF has_tenant THEN
    EXECUTE 'CREATE POLICY "ai_opus_usage_select_policy" ON public.ai_opus_usage FOR SELECT TO authenticated USING (is_platform_admin() OR tenant_id = get_user_tenant_id())';
    EXECUTE 'CREATE POLICY "ai_opus_usage_insert_policy" ON public.ai_opus_usage FOR INSERT TO authenticated WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id())';
    EXECUTE 'CREATE POLICY "ai_opus_usage_update_policy" ON public.ai_opus_usage FOR UPDATE TO authenticated USING (is_platform_admin())';
    EXECUTE 'CREATE POLICY "ai_opus_usage_delete_policy" ON public.ai_opus_usage FOR DELETE TO authenticated USING (is_platform_admin())';
  ELSE
    -- Platform-level table
    EXECUTE 'CREATE POLICY "ai_opus_usage_select_policy" ON public.ai_opus_usage FOR SELECT TO authenticated USING (true)';
    EXECUTE 'CREATE POLICY "ai_opus_usage_insert_policy" ON public.ai_opus_usage FOR INSERT TO authenticated WITH CHECK (true)';
    EXECUTE 'CREATE POLICY "ai_opus_usage_update_policy" ON public.ai_opus_usage FOR UPDATE TO authenticated USING (is_platform_admin())';
    EXECUTE 'CREATE POLICY "ai_opus_usage_delete_policy" ON public.ai_opus_usage FOR DELETE TO authenticated USING (is_platform_admin())';
  END IF;
END $$;

-- ---------- company_insights ----------
DROP POLICY IF EXISTS "Service role full access on company_insights" ON public.company_insights;
DO $$
DECLARE has_tenant BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='company_insights' AND column_name='tenant_id') INTO has_tenant;
  IF has_tenant THEN
    EXECUTE 'CREATE POLICY "company_insights_select_policy" ON public.company_insights FOR SELECT TO authenticated USING (is_platform_admin() OR tenant_id = get_user_tenant_id())';
    EXECUTE 'CREATE POLICY "company_insights_insert_policy" ON public.company_insights FOR INSERT TO authenticated WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id())';
    EXECUTE 'CREATE POLICY "company_insights_update_policy" ON public.company_insights FOR UPDATE TO authenticated USING (is_platform_admin() OR tenant_id = get_user_tenant_id())';
    EXECUTE 'CREATE POLICY "company_insights_delete_policy" ON public.company_insights FOR DELETE TO authenticated USING (is_platform_admin())';
  ELSE
    EXECUTE 'CREATE POLICY "company_insights_select_policy" ON public.company_insights FOR SELECT TO authenticated USING (true)';
    EXECUTE 'CREATE POLICY "company_insights_insert_policy" ON public.company_insights FOR INSERT TO authenticated WITH CHECK (is_platform_admin())';
    EXECUTE 'CREATE POLICY "company_insights_update_policy" ON public.company_insights FOR UPDATE TO authenticated USING (is_platform_admin())';
    EXECUTE 'CREATE POLICY "company_insights_delete_policy" ON public.company_insights FOR DELETE TO authenticated USING (is_platform_admin())';
  END IF;
END $$;

-- ---------- employee_kpis ----------
DROP POLICY IF EXISTS "kpis_service" ON public.employee_kpis;
DO $$
DECLARE has_tenant BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='employee_kpis' AND column_name='tenant_id') INTO has_tenant;
  IF has_tenant THEN
    EXECUTE 'CREATE POLICY "employee_kpis_select_policy" ON public.employee_kpis FOR SELECT TO authenticated USING (is_platform_admin() OR tenant_id = get_user_tenant_id())';
    EXECUTE 'CREATE POLICY "employee_kpis_insert_policy" ON public.employee_kpis FOR INSERT TO authenticated WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id())';
    EXECUTE 'CREATE POLICY "employee_kpis_update_policy" ON public.employee_kpis FOR UPDATE TO authenticated USING (is_platform_admin() OR tenant_id = get_user_tenant_id())';
    EXECUTE 'CREATE POLICY "employee_kpis_delete_policy" ON public.employee_kpis FOR DELETE TO authenticated USING (is_platform_admin())';
  ELSE
    EXECUTE 'CREATE POLICY "employee_kpis_select_policy" ON public.employee_kpis FOR SELECT TO authenticated USING (true)';
    EXECUTE 'CREATE POLICY "employee_kpis_insert_policy" ON public.employee_kpis FOR INSERT TO authenticated WITH CHECK (is_platform_admin())';
    EXECUTE 'CREATE POLICY "employee_kpis_update_policy" ON public.employee_kpis FOR UPDATE TO authenticated USING (is_platform_admin())';
    EXECUTE 'CREATE POLICY "employee_kpis_delete_policy" ON public.employee_kpis FOR DELETE TO authenticated USING (is_platform_admin())';
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '✅ [4B] 3 AI/internal tables fixed'; END $$;


-- ============================================================
-- 4C: إصلاح store_banners, store_blog_posts, store_blog_comments, store_pages
--     المشكلة: تستخدم app.current_tenant_id (طريقة قديمة)
--     + ALL policy مفتوحة للـ public
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [4C] Fixing store tenant tables with old current_tenant_id pattern...'; END $$;

-- ---------- store_banners ----------
DROP POLICY IF EXISTS "banners_tenant_manage" ON public.store_banners;
DROP POLICY IF EXISTS "banners_public_read" ON public.store_banners;

-- Store القراءة عامة لأي شخص (الستور يحتاج أي شخص يوصل)
CREATE POLICY "store_banners_select_policy" ON public.store_banners
  FOR SELECT USING (true);  -- عام للستور

CREATE POLICY "store_banners_insert_policy" ON public.store_banners
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "store_banners_update_policy" ON public.store_banners
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "store_banners_delete_policy" ON public.store_banners
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND is_tenant_admin()));

-- ---------- store_blog_posts ----------
DROP POLICY IF EXISTS "blog_tenant_manage" ON public.store_blog_posts;
DROP POLICY IF EXISTS "blog_public_read" ON public.store_blog_posts;

CREATE POLICY "store_blog_posts_select_policy" ON public.store_blog_posts
  FOR SELECT USING (true);

CREATE POLICY "store_blog_posts_insert_policy" ON public.store_blog_posts
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "store_blog_posts_update_policy" ON public.store_blog_posts
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "store_blog_posts_delete_policy" ON public.store_blog_posts
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND is_tenant_admin()));

-- ---------- store_blog_comments ----------
DROP POLICY IF EXISTS "blog_comments_tenant_manage" ON public.store_blog_comments;
DROP POLICY IF EXISTS "blog_comments_insert" ON public.store_blog_comments;
DROP POLICY IF EXISTS "blog_comments_public_read" ON public.store_blog_comments;

CREATE POLICY "store_blog_comments_select_policy" ON public.store_blog_comments
  FOR SELECT USING (true);

CREATE POLICY "store_blog_comments_insert_policy" ON public.store_blog_comments
  FOR INSERT TO authenticated  -- authenticated فقط يعلّق
  WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "store_blog_comments_update_policy" ON public.store_blog_comments
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "store_blog_comments_delete_policy" ON public.store_blog_comments
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND is_tenant_admin()));

-- ---------- store_pages ----------
DROP POLICY IF EXISTS "pages_tenant_manage" ON public.store_pages;
DROP POLICY IF EXISTS "pages_public_read" ON public.store_pages;

CREATE POLICY "store_pages_select_policy" ON public.store_pages
  FOR SELECT USING (true);

CREATE POLICY "store_pages_insert_policy" ON public.store_pages
  FOR INSERT TO authenticated
  WITH CHECK (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "store_pages_update_policy" ON public.store_pages
  FOR UPDATE TO authenticated
  USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

CREATE POLICY "store_pages_delete_policy" ON public.store_pages
  FOR DELETE TO authenticated
  USING (is_platform_admin() OR (tenant_id = get_user_tenant_id() AND is_tenant_admin()));

DO $$ BEGIN RAISE NOTICE '✅ [4C] 4 store tenant tables fixed — public read + tenant write'; END $$;


-- ============================================================
-- 4D: إصلاح platform_announcements
-- ============================================================
DO $$ BEGIN RAISE NOTICE '🔧 [4D] Fixing platform_announcements...'; END $$;

-- platform_announcements: قراءة للجميع، كتابة لـ platform admin
-- Check current policies first
DO $$
DECLARE pol_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO pol_count FROM pg_policies WHERE schemaname='public' AND tablename='platform_announcements';
  IF pol_count < 4 THEN
    -- Drop existing and recreate
    EXECUTE 'DROP POLICY IF EXISTS "platform_announcements_select_policy" ON public.platform_announcements';
    EXECUTE 'DROP POLICY IF EXISTS "platform_announcements_insert_policy" ON public.platform_announcements';

    EXECUTE 'CREATE POLICY "platform_announcements_select_policy" ON public.platform_announcements FOR SELECT TO authenticated USING (true)';
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='platform_announcements' AND policyname='platform_announcements_insert_policy') THEN
      EXECUTE 'CREATE POLICY "platform_announcements_insert_policy" ON public.platform_announcements FOR INSERT TO authenticated WITH CHECK (is_platform_admin())';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='platform_announcements' AND policyname='platform_announcements_update_policy') THEN
      EXECUTE 'CREATE POLICY "platform_announcements_update_policy" ON public.platform_announcements FOR UPDATE TO authenticated USING (is_platform_admin())';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='platform_announcements' AND policyname='platform_announcements_delete_policy') THEN
      EXECUTE 'CREATE POLICY "platform_announcements_delete_policy" ON public.platform_announcements FOR DELETE TO authenticated USING (is_platform_admin())';
    END IF;
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE '✅ [4D] platform_announcements fixed'; END $$;


-- ============================================================
-- التحقق النهائي الشامل للمرحلة 4
-- ============================================================
DO $$ 
DECLARE
  using_true_write INTEGER;
BEGIN
  -- Count remaining USING(true) on write ops (excluding SELECT-only and lookup tables)
  SELECT COUNT(*) INTO using_true_write
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.qual = 'true'
    AND p.cmd IN ('INSERT','UPDATE','DELETE','ALL')
    AND p.tablename NOT IN (
      -- Legitimate: lookup/platform tables where USING(true) for SELECT is OK
      'account_types','countries','currencies','saas_products','subscription_plans',
      'system_modules','system_languages','modules','module_features',
      'plan_modules','plan_module_features','plan_ui_tabs','ui_tabs',
      'super_admins','saas_settings','serial_number_fields'
    );
  
  IF using_true_write = 0 THEN
    RAISE NOTICE '✅ Phase 4 PASSED — No more dangerous USING(true) on write operations';
  ELSE
    RAISE WARNING '⚠️ Phase 4: Still % policies with USING(true) on write ops', using_true_write;
  END IF;
END $$;

COMMIT;
