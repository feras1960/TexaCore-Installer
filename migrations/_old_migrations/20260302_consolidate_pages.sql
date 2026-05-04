-- ============================================
-- 🔄 توحيد أنظمة الصفحات والمحتوى
-- Consolidation: store_pages → website_pages
-- التاريخ: 2 مارس 2026
-- ============================================
-- 
-- القرار: website_pages هي النظام المعتمد لأنها:
-- 1. تحتوي 32 صفحة (store_pages فارغ)
-- 2. تدعم أقسام محتوى ديناميكية (website_sections)
-- 3. SEO + GEO/AI أقوى (llm_description, schema_data)
-- 4. مرنة أكثر
--
-- الإجراءات:
-- 1. إضافة page_type enum لـ website_pages (من store_pages)
-- 2. تعليم store_pages كـ deprecated
-- ============================================

-- ═══════════════════════════════════════════════════════════════
-- 1. تحسين website_pages بميزات من store_pages
-- ═══════════════════════════════════════════════════════════════

-- إضافة عمود نوع الصفحة (مثل store_pages) 
ALTER TABLE public.website_pages 
    ADD COLUMN IF NOT EXISTS page_category TEXT DEFAULT 'custom';
-- القيم: about, contact, faq, terms, privacy, returns, shipping, wholesale, services, custom, feature, solution

-- هل تظهر في header/footer
ALTER TABLE public.website_pages 
    ADD COLUMN IF NOT EXISTS show_in_header BOOLEAN DEFAULT false;
-- show_in_nav already exists, keep it
-- show_in_footer already exists, update NULLs to false  
UPDATE public.website_pages SET show_in_footer = false WHERE show_in_footer IS NULL;

-- الصورة المميزة
ALTER TABLE public.website_pages 
    ADD COLUMN IF NOT EXISTS featured_image TEXT;

-- ربط بالمتجر (اختياري — لصفحات المتجر)
ALTER TABLE public.website_pages 
    ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES ecommerce_stores(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════
-- 2. تحديث بيانات website_pages الموجودة
-- ═══════════════════════════════════════════════════════════════

-- تصنيف الصفحات الموجودة تلقائياً
UPDATE public.website_pages SET page_category = 'terms' WHERE slug = '/terms';
UPDATE public.website_pages SET page_category = 'privacy' WHERE slug = '/privacy';
UPDATE public.website_pages SET page_category = 'about' WHERE slug = '/about-us' OR slug = '/about';
UPDATE public.website_pages SET page_category = 'contact' WHERE slug = '/contact';
UPDATE public.website_pages SET page_category = 'faq' WHERE slug = '/faq';
UPDATE public.website_pages SET page_category = 'solution' WHERE slug IN ('/solutions', '/fabric-management', '/garment-manufacturing', '/fabric-manufacturing');
UPDATE public.website_pages SET page_category = 'feature' WHERE slug IN ('/accounting', '/crm', '/hr', '/pos', '/ecommerce-module');

-- ═══════════════════════════════════════════════════════════════
-- 3. تعليق store_pages كـ DEPRECATED
-- ═══════════════════════════════════════════════════════════════

-- أضف تعليق على الجدول
COMMENT ON TABLE public.store_pages IS '⚠️ DEPRECATED — Use website_pages instead. This table is kept for backwards compatibility but should NOT be used for new development. See migration: 20260302_consolidate_pages.sql';

-- ═══════════════════════════════════════════════════════════════
-- 4. View موحد للوصول السهل 
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.v_all_pages AS
SELECT 
    wp.id,
    wp.tenant_id,
    wp.company_id,
    ws.name AS site_name,
    ws.slug AS site_slug,
    wp.slug AS page_slug,
    wp.page_type,
    wp.page_category,
    wp.title_ar,
    wp.title_en,
    wp.title_uk,
    wp.title_tr,
    wp.seo_title_ar,
    wp.seo_title_en,
    wp.seo_description_ar,
    wp.seo_description_en,
    wp.show_in_nav,
    wp.show_in_footer,
    wp.show_in_header,
    wp.is_published,
    wp.sort_order,
    wp.featured_image,
    wp.store_id,
    wp.created_at,
    wp.updated_at
FROM public.website_pages wp
JOIN public.website_sites ws ON ws.id = wp.site_id
WHERE ws.is_active = true;

-- Grant to all roles
GRANT SELECT ON public.v_all_pages TO anon;
GRANT SELECT ON public.v_all_pages TO authenticated;

DO $$ BEGIN 
    RAISE NOTICE '';
    RAISE NOTICE '══════════════════════════════════════════════════';
    RAISE NOTICE '✅ Pages Consolidation Complete';
    RAISE NOTICE '══════════════════════════════════════════════════';
    RAISE NOTICE '📌 website_pages = النظام المعتمد';
    RAISE NOTICE '⚠️  store_pages = DEPRECATED';
    RAISE NOTICE '🔗 v_all_pages view created';
    RAISE NOTICE '══════════════════════════════════════════════════';
END $$;
