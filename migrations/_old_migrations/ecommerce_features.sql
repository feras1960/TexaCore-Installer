-- ══════════════════════════════════════════════════════════════════════════════
-- E-Commerce Features Migration
-- الميزات المتقدمة للمتجر الإلكتروني
-- ══════════════════════════════════════════════════════════════════════════════
-- التاريخ: 27 فبراير 2026
-- يتضمن:
--   1. ecommerce_wishlists (المفضلات)
--   2. newsletter_subscribers (النشرة البريدية)
--   3. store_blog_posts (المدونة / الأخبار)
--   4. store_pages (صفحات CMS)  
--   5. store_banners (البانرات / السلايدر)
--   6. تحديث ecommerce_stores (حقول القالب + store_type)
-- ══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN RAISE NOTICE ''; RAISE NOTICE '══════════════════════════════════════════════════'; RAISE NOTICE '🛒 E-Commerce Features Migration'; RAISE NOTICE '══════════════════════════════════════════════════'; END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. المفضلات (Wishlists)
-- ══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN RAISE NOTICE '❤️ 1/6 Creating ecommerce_wishlists...'; END $$;

CREATE TABLE IF NOT EXISTS ecommerce_wishlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL DEFAULT (current_setting('app.current_tenant_id', true))::uuid,
    store_id UUID NOT NULL REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
    
    -- العميل (مسجل فقط)
    customer_id UUID NOT NULL,
    
    -- المنتج
    product_id UUID NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
    
    -- ملاحظة اختيارية
    note TEXT,
    
    -- التنبيه عند تخفيض السعر
    notify_on_price_drop BOOLEAN DEFAULT false,
    notify_on_back_in_stock BOOLEAN DEFAULT false,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(tenant_id, customer_id, product_id)
);

-- RLS
ALTER TABLE ecommerce_wishlists ENABLE ROW LEVEL SECURITY;

-- القراءة: فقط صاحب المفضلة
CREATE POLICY "wishlist_owner_select" ON ecommerce_wishlists
    FOR SELECT USING (
        customer_id = auth.uid()::text::uuid
        OR tenant_id = (current_setting('app.current_tenant_id', true))::uuid
    );

-- الإضافة: المستخدمون المسجلون فقط
CREATE POLICY "wishlist_insert" ON ecommerce_wishlists
    FOR INSERT WITH CHECK (
        customer_id = auth.uid()::text::uuid
    );

-- الحذف: فقط صاحب المفضلة
CREATE POLICY "wishlist_delete" ON ecommerce_wishlists
    FOR DELETE USING (
        customer_id = auth.uid()::text::uuid
    );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ecom_wishlist_customer ON ecommerce_wishlists(customer_id);
CREATE INDEX IF NOT EXISTS idx_ecom_wishlist_product ON ecommerce_wishlists(product_id);
CREATE INDEX IF NOT EXISTS idx_ecom_wishlist_store ON ecommerce_wishlists(store_id);

DO $$ BEGIN RAISE NOTICE '✅ ecommerce_wishlists created'; END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. النشرة البريدية (Newsletter Subscribers)
-- ══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN RAISE NOTICE '📧 2/6 Creating newsletter_subscribers...'; END $$;

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL DEFAULT (current_setting('app.current_tenant_id', true))::uuid,
    store_id UUID REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
    
    -- بيانات المشترك
    email TEXT NOT NULL,
    name TEXT,
    phone TEXT,
    locale TEXT DEFAULT 'ar',
    
    -- الحالة
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed', 'bounced', 'pending')),
    subscribed_at TIMESTAMPTZ DEFAULT now(),
    unsubscribed_at TIMESTAMPTZ,
    
    -- المصدر
    source TEXT DEFAULT 'website' CHECK (source IN ('website', 'checkout', 'popup', 'footer', 'import', 'api')),
    
    -- التحقق
    is_verified BOOLEAN DEFAULT false,
    verification_token UUID DEFAULT gen_random_uuid(),
    verified_at TIMESTAMPTZ,
    
    -- الإحصائيات
    emails_sent INT DEFAULT 0,
    emails_opened INT DEFAULT 0,
    last_email_sent_at TIMESTAMPTZ,
    
    -- ربط بالعميل (اختياري)
    customer_id UUID,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(tenant_id, email)
);

ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;

-- أي شخص يمكنه الاشتراك
CREATE POLICY "newsletter_public_insert" ON newsletter_subscribers
    FOR INSERT WITH CHECK (true);

-- فقط الإدارة تقرأ
CREATE POLICY "newsletter_tenant_select" ON newsletter_subscribers
    FOR SELECT USING (
        tenant_id = (current_setting('app.current_tenant_id', true))::uuid
    );

-- فقط الإدارة تعدل
CREATE POLICY "newsletter_tenant_update" ON newsletter_subscribers
    FOR UPDATE USING (
        tenant_id = (current_setting('app.current_tenant_id', true))::uuid
    );

CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter_subscribers(email);
CREATE INDEX IF NOT EXISTS idx_newsletter_store ON newsletter_subscribers(store_id);
CREATE INDEX IF NOT EXISTS idx_newsletter_status ON newsletter_subscribers(status);

DO $$ BEGIN RAISE NOTICE '✅ newsletter_subscribers created'; END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. المدونة / الأخبار (Blog Posts)
-- ══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN RAISE NOTICE '📝 3/6 Creating store_blog_posts...'; END $$;

CREATE TABLE IF NOT EXISTS store_blog_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL DEFAULT (current_setting('app.current_tenant_id', true))::uuid,
    store_id UUID NOT NULL REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
    
    -- المحتوى (متعدد اللغات)
    title JSONB NOT NULL DEFAULT '{}',          -- {ar: "...", en: "...", uk: "..."}
    slug TEXT NOT NULL,                         -- blog-post-url-friendly
    excerpt JSONB DEFAULT '{}',                 -- ملخص قصير
    content JSONB DEFAULT '{}',                 -- المحتوى الكامل (HTML/Markdown)
    
    -- الصورة والميديا
    featured_image TEXT,                        -- URL الصورة الرئيسية
    gallery JSONB DEFAULT '[]',                 -- صور إضافية [{url, caption}]
    video_url TEXT,                             -- فيديو اختياري (YouTube/Vimeo)
    
    -- التصنيف
    category TEXT DEFAULT 'news',               -- news, guide, tips, lookbook, update
    tags TEXT[] DEFAULT '{}',                   -- {fabric, silk, fashion, tips}
    
    -- الكاتب
    author_name JSONB DEFAULT '{}',             -- {ar: "...", en: "..."}
    author_avatar TEXT,
    author_id UUID,                             -- ربط بالمستخدم
    
    -- الحالة
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'scheduled', 'archived')),
    published_at TIMESTAMPTZ,
    scheduled_at TIMESTAMPTZ,
    
    -- SEO
    seo_title JSONB DEFAULT '{}',
    seo_description JSONB DEFAULT '{}',
    seo_keywords TEXT[] DEFAULT '{}',
    
    -- التفاعل
    views_count INT DEFAULT 0,
    likes_count INT DEFAULT 0,
    comments_enabled BOOLEAN DEFAULT true,
    
    -- المنتجات المرتبطة (للربط بالمنتجات في المقال)
    related_products UUID[] DEFAULT '{}',
    
    -- الترتيب
    is_featured BOOLEAN DEFAULT false,
    is_pinned BOOLEAN DEFAULT false,
    sort_order INT DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(store_id, slug)
);

ALTER TABLE store_blog_posts ENABLE ROW LEVEL SECURITY;

-- القراءة العامة للمنشور المنشور
CREATE POLICY "blog_public_read" ON store_blog_posts
    FOR SELECT USING (status = 'published');

-- الإدارة: كل العمليات
CREATE POLICY "blog_tenant_manage" ON store_blog_posts
    FOR ALL USING (
        tenant_id = (current_setting('app.current_tenant_id', true))::uuid
    );

-- تعليقات المدونة
CREATE TABLE IF NOT EXISTS store_blog_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL DEFAULT (current_setting('app.current_tenant_id', true))::uuid,
    post_id UUID NOT NULL REFERENCES store_blog_posts(id) ON DELETE CASCADE,
    
    -- الكاتب
    customer_id UUID,
    guest_name TEXT,
    guest_email TEXT,
    
    -- التعليق
    content TEXT NOT NULL,
    
    -- الحالة
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'spam')),
    
    -- رد على تعليق آخر
    parent_id UUID REFERENCES store_blog_comments(id) ON DELETE CASCADE,
    
    created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE store_blog_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "blog_comments_public_read" ON store_blog_comments
    FOR SELECT USING (status = 'approved');

CREATE POLICY "blog_comments_insert" ON store_blog_comments
    FOR INSERT WITH CHECK (true);

CREATE POLICY "blog_comments_tenant_manage" ON store_blog_comments
    FOR ALL USING (
        tenant_id = (current_setting('app.current_tenant_id', true))::uuid
    );

CREATE INDEX IF NOT EXISTS idx_blog_posts_store ON store_blog_posts(store_id);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON store_blog_posts(status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON store_blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON store_blog_posts(published_at);
CREATE INDEX IF NOT EXISTS idx_blog_comments_post ON store_blog_comments(post_id);

DO $$ BEGIN RAISE NOTICE '✅ store_blog_posts + store_blog_comments created'; END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. صفحات CMS (Store Pages)
-- ══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN RAISE NOTICE '📄 4/6 Creating store_pages...'; END $$;

CREATE TABLE IF NOT EXISTS store_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL DEFAULT (current_setting('app.current_tenant_id', true))::uuid,
    store_id UUID NOT NULL REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
    
    -- المحتوى
    title JSONB NOT NULL DEFAULT '{}',
    slug TEXT NOT NULL,                         -- about-us, contact, faq, etc.
    content JSONB DEFAULT '{}',                 -- HTML/Markdown content
    
    -- النوع
    page_type TEXT DEFAULT 'custom' CHECK (page_type IN (
        'about',          -- من نحن
        'contact',        -- اتصل بنا  
        'faq',           -- أسئلة شائعة
        'terms',         -- الشروط والأحكام
        'privacy',       -- سياسة الخصوصية
        'returns',       -- سياسة الإرجاع
        'shipping',      -- سياسة الشحن
        'wholesale',     -- صفحة الجملة
        'services',      -- خدماتنا
        'how_it_works',  -- كيف نعمل
        'custom'         -- صفحة مخصصة
    )),
    
    -- الميتا
    featured_image TEXT,
    
    -- SEO
    seo_title JSONB DEFAULT '{}',
    seo_description JSONB DEFAULT '{}',
    
    -- الحالة
    status TEXT DEFAULT 'published' CHECK (status IN ('draft', 'published')),
    is_in_header BOOLEAN DEFAULT false,         -- يظهر في الهيدر
    is_in_footer BOOLEAN DEFAULT true,          -- يظهر في الفوتر
    sort_order INT DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(store_id, slug)
);

ALTER TABLE store_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pages_public_read" ON store_pages
    FOR SELECT USING (status = 'published');

CREATE POLICY "pages_tenant_manage" ON store_pages
    FOR ALL USING (
        tenant_id = (current_setting('app.current_tenant_id', true))::uuid
    );

CREATE INDEX IF NOT EXISTS idx_store_pages_store ON store_pages(store_id);
CREATE INDEX IF NOT EXISTS idx_store_pages_slug ON store_pages(slug);
CREATE INDEX IF NOT EXISTS idx_store_pages_type ON store_pages(page_type);

DO $$ BEGIN RAISE NOTICE '✅ store_pages created'; END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. البانرات والسلايدر (Store Banners)
-- ══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN RAISE NOTICE '🖼️ 5/6 Creating store_banners...'; END $$;

CREATE TABLE IF NOT EXISTS store_banners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL DEFAULT (current_setting('app.current_tenant_id', true))::uuid,
    store_id UUID NOT NULL REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
    
    -- المحتوى
    title JSONB DEFAULT '{}',
    subtitle JSONB DEFAULT '{}',
    description JSONB DEFAULT '{}',
    
    -- الصورة
    image_url TEXT NOT NULL,
    mobile_image_url TEXT,                      -- صورة مختلفة للموبايل
    video_url TEXT,                             -- فيديو بديل
    
    -- الرابط
    link_url TEXT,
    link_text JSONB DEFAULT '{}',               -- نص الزر
    link_target TEXT DEFAULT '_self',            -- _self, _blank
    
    -- الموقع
    placement TEXT DEFAULT 'hero' CHECK (placement IN (
        'hero',              -- السلايدر الرئيسي
        'category_top',      -- أعلى صفحة الفئة
        'sidebar',           -- الشريط الجانبي
        'popup',             -- نافذة منبثقة
        'inline',            -- داخل المحتوى
        'footer_above',      -- فوق الفوتر
        'marquee'            -- الشريط المتحرك
    )),
    
    -- التصميم
    text_color TEXT DEFAULT '#FFFFFF',
    overlay_color TEXT DEFAULT 'rgba(0,0,0,0.3)',
    text_position TEXT DEFAULT 'center',        -- left, center, right
    
    -- الحالة
    is_active BOOLEAN DEFAULT true,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    sort_order INT DEFAULT 0,
    
    -- الإحصائيات
    views_count INT DEFAULT 0,
    clicks_count INT DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE store_banners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "banners_public_read" ON store_banners
    FOR SELECT USING (
        is_active = true 
        AND (starts_at IS NULL OR starts_at <= now())
        AND (ends_at IS NULL OR ends_at >= now())
    );

CREATE POLICY "banners_tenant_manage" ON store_banners
    FOR ALL USING (
        tenant_id = (current_setting('app.current_tenant_id', true))::uuid
    );

CREATE INDEX IF NOT EXISTS idx_banners_store ON store_banners(store_id);
CREATE INDEX IF NOT EXISTS idx_banners_placement ON store_banners(placement);
CREATE INDEX IF NOT EXISTS idx_banners_active ON store_banners(is_active);

DO $$ BEGIN RAISE NOTICE '✅ store_banners created'; END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. تحديث ecommerce_stores (حقول القالب + أنواع المتاجر)
-- ══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN RAISE NOTICE '⚙️ 6/6 Updating ecommerce_stores...'; END $$;

-- إضافة حقل القالب
ALTER TABLE ecommerce_stores 
    ADD COLUMN IF NOT EXISTS theme TEXT DEFAULT 'fabric-classic';

-- إعدادات القالب (ألوان مخصصة، خطوط، تخطيط)
ALTER TABLE ecommerce_stores 
    ADD COLUMN IF NOT EXISTS theme_config JSONB DEFAULT '{}';

-- إعدادات الهيدر
ALTER TABLE ecommerce_stores 
    ADD COLUMN IF NOT EXISTS header_config JSONB DEFAULT '{
        "sticky": true,
        "transparent_hero": false,
        "show_search": true,
        "show_currency": true,
        "show_language": true,
        "mega_menu": true
    }';

-- إعدادات الفوتر
ALTER TABLE ecommerce_stores 
    ADD COLUMN IF NOT EXISTS footer_config JSONB DEFAULT '{
        "show_newsletter": true,
        "show_social": true,
        "show_payment_icons": true,
        "columns": 4
    }';

-- إعدادات الوظائف
ALTER TABLE ecommerce_stores 
    ADD COLUMN IF NOT EXISTS features_config JSONB DEFAULT '{
        "wishlist_enabled": true,
        "reviews_enabled": true,
        "compare_enabled": true,
        "blog_enabled": true,
        "newsletter_enabled": true,
        "whatsapp_enabled": true,
        "guest_checkout": true,
        "multi_currency": true
    }';

-- معلومات الشركة (لصفحة "من نحن")
ALTER TABLE ecommerce_stores 
    ADD COLUMN IF NOT EXISTS company_info JSONB DEFAULT '{
        "founded_year": null,
        "employees_count": null,
        "branches": [],
        "certifications": [],
        "about_text": {}
    }';

-- توسيع store_type ليشمل أنواع أكثر
DO $$
BEGIN
    -- حذف القيد القديم
    ALTER TABLE ecommerce_stores DROP CONSTRAINT IF EXISTS ecommerce_stores_store_type_check;
    
    -- إضافة القيد الجديد مع أنواع إضافية
    ALTER TABLE ecommerce_stores ADD CONSTRAINT ecommerce_stores_store_type_check
        CHECK (store_type IN (
            'fabric',        -- أقمشة
            'clothing',      -- ملابس
            'shoes',         -- أحذية
            'accessories',   -- إكسسوارات
            'electronics',   -- إلكترونيات
            'marketplace',   -- ماركت بليس
            'general'        -- عام
        ));
    
    RAISE NOTICE '✅ store_type constraint updated (7 types)';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⚠️ store_type constraint: %', SQLERRM;
END $$;

DO $$ BEGIN RAISE NOTICE '✅ ecommerce_stores updated'; END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. Triggers للتحديث التلقائي
-- ══════════════════════════════════════════════════════════════════════════════

-- Trigger function موجود (set_updated_at) - فقط نطبقه على الجداول الجديدة
DO $$
BEGIN
    -- Newsletter
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_newsletter_updated_at') THEN
        CREATE TRIGGER set_newsletter_updated_at
            BEFORE UPDATE ON newsletter_subscribers
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;

    -- Blog Posts
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_blog_posts_updated_at') THEN
        CREATE TRIGGER set_blog_posts_updated_at
            BEFORE UPDATE ON store_blog_posts
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;

    -- Pages
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_store_pages_updated_at') THEN
        CREATE TRIGGER set_store_pages_updated_at
            BEFORE UPDATE ON store_pages
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;

    -- Banners
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_banners_updated_at') THEN
        CREATE TRIGGER set_banners_updated_at
            BEFORE UPDATE ON store_banners
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
    
    RAISE NOTICE '✅ All triggers created';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⚠️ Trigger creation: % (some may already exist)', SQLERRM;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- ✅ DONE
-- ══════════════════════════════════════════════════════════════════════════════

DO $$ 
BEGIN 
    RAISE NOTICE '';
    RAISE NOTICE '══════════════════════════════════════════════════';
    RAISE NOTICE '✅ E-Commerce Features Migration Complete!';
    RAISE NOTICE '══════════════════════════════════════════════════';
    RAISE NOTICE '   ❤️  ecommerce_wishlists    — المفضلات';
    RAISE NOTICE '   📧  newsletter_subscribers — النشرة البريدية';
    RAISE NOTICE '   📝  store_blog_posts       — المدونة';
    RAISE NOTICE '   💬  store_blog_comments    — تعليقات المدونة';
    RAISE NOTICE '   📄  store_pages            — صفحات CMS';
    RAISE NOTICE '   🖼️   store_banners          — البانرات والسلايدر';
    RAISE NOTICE '   ⚙️   ecommerce_stores      — تحديث (theme + config)';
    RAISE NOTICE '══════════════════════════════════════════════════';
    RAISE NOTICE '';
END $$;
