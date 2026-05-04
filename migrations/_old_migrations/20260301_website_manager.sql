-- ============================================
-- Website Manager - Database Schema
-- إدارة مواقع اللاندينغ بيج والمتاجر
-- ============================================

-- 1. جدول المواقع (website_sites)
-- كل tenant/company يمكنه إنشاء مواقع متعددة
CREATE TABLE IF NOT EXISTS public.website_sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),
    
    -- معلومات الموقع
    name VARCHAR(255) NOT NULL,                    -- اسم الموقع (مثل: TexaCore, متجر الأقمشة)
    slug VARCHAR(100) NOT NULL,                    -- رابط مختصر (texacore, my-store)
    site_type VARCHAR(50) NOT NULL DEFAULT 'landing', -- landing, store, blog
    domain VARCHAR(255),                           -- الدومين (texacore.com)
    
    -- العلامة التجارية
    logo_url TEXT,
    favicon_url TEXT,
    primary_color VARCHAR(7) DEFAULT '#047857',    -- لون رئيسي
    secondary_color VARCHAR(7) DEFAULT '#d97706',  -- لون ثانوي
    
    -- معلومات التواصل
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    contact_address TEXT,
    social_links JSONB DEFAULT '{}',               -- {facebook, twitter, instagram, linkedin, whatsapp}
    
    -- إعدادات عامة
    default_language VARCHAR(5) DEFAULT 'ar',
    supported_languages JSONB DEFAULT '["ar", "en"]',
    is_published BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    
    -- SEO عام للموقع
    site_title_ar VARCHAR(255),
    site_title_en VARCHAR(255),
    site_description_ar TEXT,
    site_description_en TEXT,
    
    -- تتبع
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_website_sites_tenant ON public.website_sites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_website_sites_company ON public.website_sites(company_id);
CREATE INDEX IF NOT EXISTS idx_website_sites_slug ON public.website_sites(slug);

-- 2. جدول الصفحات (website_pages)
CREATE TABLE IF NOT EXISTS public.website_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),
    site_id UUID NOT NULL REFERENCES public.website_sites(id) ON DELETE CASCADE,
    
    -- معلومات الصفحة
    slug VARCHAR(200) NOT NULL,                    -- مسار الصفحة (/features, /pricing)
    page_type VARCHAR(50) DEFAULT 'static',        -- static, product, category, blog
    sort_order INTEGER DEFAULT 0,
    is_published BOOLEAN DEFAULT true,
    show_in_nav BOOLEAN DEFAULT true,              -- تظهر في القائمة العلوية
    show_in_footer BOOLEAN DEFAULT false,           -- تظهر في الفوتر
    
    -- العناوين (متعدد اللغات)
    title_ar VARCHAR(255),
    title_en VARCHAR(255),
    title_uk VARCHAR(255),
    title_tr VARCHAR(255),
    
    -- SEO
    seo_title_ar VARCHAR(255),                     -- عنوان مخصص للـ SEO (إذا مختلف عن العنوان)
    seo_title_en VARCHAR(255),
    seo_description_ar TEXT,
    seo_description_en TEXT,
    seo_keywords_ar TEXT,                           -- كلمات مفتاحية
    seo_keywords_en TEXT,
    og_image_url TEXT,                              -- صورة Open Graph
    canonical_url TEXT,                             -- رابط canonical
    schema_type VARCHAR(50),                        -- نوع Schema.org (FAQPage, Product, etc.)
    schema_data JSONB,                             -- بيانات Schema.org مخصصة
    
    -- محتوى AI (GEO)
    llm_description_ar TEXT,                       -- وصف لمحركات الذكاء الاصطناعي
    llm_description_en TEXT,
    
    -- تتبع
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    
    UNIQUE(site_id, slug)
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_website_pages_tenant ON public.website_pages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_website_pages_company ON public.website_pages(company_id);
CREATE INDEX IF NOT EXISTS idx_website_pages_site ON public.website_pages(site_id);
CREATE INDEX IF NOT EXISTS idx_website_pages_slug ON public.website_pages(site_id, slug);

-- 3. جدول أقسام المحتوى (website_sections)
-- كل صفحة تتكون من أقسام (Hero, Features, Pricing, etc.)
CREATE TABLE IF NOT EXISTS public.website_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    company_id UUID NOT NULL REFERENCES public.companies(id),
    page_id UUID NOT NULL REFERENCES public.website_pages(id) ON DELETE CASCADE,
    
    -- معلومات القسم
    section_key VARCHAR(100) NOT NULL,             -- مفتاح القسم (hero, features, pricing)
    section_type VARCHAR(50) DEFAULT 'content',    -- content, hero, features, pricing, faq, cta, gallery
    sort_order INTEGER DEFAULT 0,
    is_visible BOOLEAN DEFAULT true,
    
    -- المحتوى (متعدد اللغات - JSONB مرن)
    content JSONB DEFAULT '{}',
    -- مثال للـ content:
    -- {
    --   "ar": { "title": "...", "subtitle": "...", "description": "...", "cta_text": "..." },
    --   "en": { "title": "...", "subtitle": "...", "description": "...", "cta_text": "..." }
    -- }
    
    -- الإعدادات البصرية
    background_color VARCHAR(7),
    background_image_url TEXT,
    custom_css TEXT,
    
    -- تتبع
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(page_id, section_key)
);

-- فهارس
CREATE INDEX IF NOT EXISTS idx_website_sections_tenant ON public.website_sections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_website_sections_page ON public.website_sections(page_id);

-- ============================================
-- RLS Policies
-- ============================================

ALTER TABLE public.website_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_sections ENABLE ROW LEVEL SECURITY;

-- تطبيق السياسات المعيارية للشركة
SELECT create_company_rls_policies('website_sites', true, true);
SELECT create_company_rls_policies('website_pages', true, true);
SELECT create_company_rls_policies('website_sections', true, true);

-- ============================================
-- Triggers
-- ============================================

SELECT apply_auto_tenant_trigger('website_sites');
SELECT apply_auto_company_trigger('website_sites');
SELECT apply_brand_isolation_trigger('website_sites');

SELECT apply_auto_tenant_trigger('website_pages');
SELECT apply_auto_company_trigger('website_pages');
SELECT apply_brand_isolation_trigger('website_pages');

SELECT apply_auto_tenant_trigger('website_sections');
SELECT apply_auto_company_trigger('website_sections');
SELECT apply_brand_isolation_trigger('website_sections');

-- ============================================
-- سياسة قراءة عامة للمواقع المنشورة (للـ Astro frontend)
-- ============================================

-- السماح بقراءة المواقع المنشورة بدون auth (للـ landing pages)
CREATE POLICY "public_read_published_sites" ON public.website_sites
    FOR SELECT USING (is_published = true AND is_active = true);

CREATE POLICY "public_read_published_pages" ON public.website_pages
    FOR SELECT USING (
        is_published = true 
        AND site_id IN (SELECT id FROM public.website_sites WHERE is_published = true AND is_active = true)
    );

CREATE POLICY "public_read_visible_sections" ON public.website_sections
    FOR SELECT USING (
        is_visible = true 
        AND page_id IN (
            SELECT p.id FROM public.website_pages p 
            JOIN public.website_sites s ON p.site_id = s.id 
            WHERE p.is_published = true AND s.is_published = true AND s.is_active = true
        )
    );
