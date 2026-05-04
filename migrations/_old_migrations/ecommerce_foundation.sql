-- ============================================================
-- 🛒 E-Commerce Foundation Tables
-- Date: 2026-02-27
-- Phase: 0 - Infrastructure
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. ecommerce_stores - إعدادات المتاجر
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ecommerce_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Basic Info
    name JSONB NOT NULL DEFAULT '{"ar": "المتجر", "en": "Store"}',
    slug TEXT NOT NULL,
    description JSONB DEFAULT '{}',
    
    -- Branding
    logo_url TEXT,
    favicon_url TEXT,
    primary_color TEXT DEFAULT '#0d9488', -- teal-600
    secondary_color TEXT DEFAULT '#134e4a', -- teal-900
    
    -- Contact
    email TEXT,
    phone TEXT,
    whatsapp TEXT,
    address JSONB DEFAULT '{}',
    
    -- Settings
    default_currency TEXT DEFAULT 'SAR',
    default_locale TEXT DEFAULT 'ar',
    supported_locales TEXT[] DEFAULT ARRAY['ar', 'en'],
    supported_currencies TEXT[] DEFAULT ARRAY['SAR', 'USD'],
    
    -- Store Type
    store_type TEXT DEFAULT 'fabric' CHECK (store_type IN ('fabric', 'clothing', 'general')),
    
    -- Domain
    custom_domain TEXT,
    
    -- Social
    social_links JSONB DEFAULT '{}',
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_maintenance BOOLEAN DEFAULT false,
    maintenance_message JSONB DEFAULT '{}',
    
    -- SEO
    seo_title JSONB DEFAULT '{}',
    seo_description JSONB DEFAULT '{}',
    seo_keywords TEXT[] DEFAULT '{}',
    
    -- Policies
    free_shipping_threshold DECIMAL(12,2) DEFAULT 500,
    min_order_amount DECIMAL(12,2) DEFAULT 0,
    tax_rate DECIMAL(5,4) DEFAULT 0.15, -- 15% VAT
    tax_inclusive BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(tenant_id, slug)
);

-- ─────────────────────────────────────────────────────────────
-- 2. ecommerce_categories - تصنيفات المتجر
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ecommerce_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
    
    -- Hierarchy
    parent_id UUID REFERENCES ecommerce_categories(id) ON DELETE SET NULL,
    
    -- Info
    name JSONB NOT NULL DEFAULT '{"ar": "", "en": ""}',
    slug TEXT NOT NULL,
    description JSONB DEFAULT '{}',
    image_url TEXT,
    icon TEXT, -- lucide icon name
    
    -- Display
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    is_featured BOOLEAN DEFAULT false,
    
    -- SEO
    seo_title JSONB DEFAULT '{}',
    seo_description JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(store_id, slug)
);

-- ─────────────────────────────────────────────────────────────
-- 3. ecommerce_products - المنتجات المنشورة
--    ⚠️ هذا الجدول لا ينسخ البيانات! يربط فقط بـ fabric_materials
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ecommerce_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
    
    -- 🔗 Link to ERP Material (NOT a copy!)
    material_id UUID NOT NULL REFERENCES fabric_materials(id) ON DELETE CASCADE,
    
    -- Marketing Content (not in fabric_materials)
    marketing_title JSONB DEFAULT '{}', -- {"ar": "قطن فاخر", "en": "Premium Cotton"}
    marketing_description JSONB DEFAULT '{}',
    short_description JSONB DEFAULT '{}',
    
    -- Gallery (separate from material images)
    gallery_images TEXT[] DEFAULT '{}',
    
    -- SEO
    seo_slug TEXT NOT NULL,
    seo_title JSONB DEFAULT '{}',
    seo_description JSONB DEFAULT '{}',
    seo_keywords TEXT[] DEFAULT '{}',
    
    -- Display
    display_order INTEGER DEFAULT 0,
    tags TEXT[] DEFAULT '{}',
    
    -- Publishing Status
    is_published BOOLEAN DEFAULT false,
    is_featured BOOLEAN DEFAULT false,
    is_new BOOLEAN DEFAULT false,
    is_bestseller BOOLEAN DEFAULT false,
    is_on_sale BOOLEAN DEFAULT false,
    
    -- Sale Price Override (optional - if NULL, use material's unit_price)
    sale_price DECIMAL(12,2),
    sale_start_date TIMESTAMPTZ,
    sale_end_date TIMESTAMPTZ,
    
    -- Minimum order
    min_order_quantity DECIMAL(12,3) DEFAULT 1,
    max_order_quantity DECIMAL(12,3),
    
    -- For fabric: unit of sale
    sale_unit TEXT DEFAULT 'meter' CHECK (sale_unit IN ('meter', 'yard', 'roll', 'piece')),
    
    -- Stats (updated by triggers)
    view_count INTEGER DEFAULT 0,
    order_count INTEGER DEFAULT 0,
    
    -- Timestamps
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(store_id, seo_slug),
    UNIQUE(store_id, material_id) -- One material can only be published once per store
);

-- ─────────────────────────────────────────────────────────────
-- 4. ecommerce_product_categories - Many-to-Many
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ecommerce_product_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES ecommerce_categories(id) ON DELETE CASCADE,
    display_order INTEGER DEFAULT 0,
    
    UNIQUE(product_id, category_id)
);

-- ─────────────────────────────────────────────────────────────
-- 5. Triggers - updated_at
-- ─────────────────────────────────────────────────────────────

-- Generic updated_at trigger function (may already exist)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all ecommerce tables
CREATE TRIGGER set_ecommerce_stores_updated_at
    BEFORE UPDATE ON ecommerce_stores
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_ecommerce_categories_updated_at
    BEFORE UPDATE ON ecommerce_categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_ecommerce_products_updated_at
    BEFORE UPDATE ON ecommerce_products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Auto-set published_at when publishing
CREATE OR REPLACE FUNCTION set_published_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_published = true AND (OLD.is_published = false OR OLD.is_published IS NULL) THEN
        NEW.published_at = now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_ecommerce_products_published_at
    BEFORE UPDATE ON ecommerce_products
    FOR EACH ROW EXECUTE FUNCTION set_published_at();

-- ─────────────────────────────────────────────────────────────
-- 6. Indexes
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ecommerce_stores_tenant ON ecommerce_stores(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ecommerce_categories_store ON ecommerce_categories(store_id);
CREATE INDEX IF NOT EXISTS idx_ecommerce_categories_parent ON ecommerce_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_ecommerce_products_store ON ecommerce_products(store_id);
CREATE INDEX IF NOT EXISTS idx_ecommerce_products_material ON ecommerce_products(material_id);
CREATE INDEX IF NOT EXISTS idx_ecommerce_products_published ON ecommerce_products(store_id, is_published) WHERE is_published = true;
CREATE INDEX IF NOT EXISTS idx_ecommerce_products_slug ON ecommerce_products(store_id, seo_slug);
CREATE INDEX IF NOT EXISTS idx_ecommerce_products_featured ON ecommerce_products(store_id, is_featured) WHERE is_featured = true;

-- ─────────────────────────────────────────────────────────────
-- 7. RLS Policies (متوافقة مع نمط النظام الموحد)
-- Uses: get_user_tenant_id(), is_platform_admin()
-- ─────────────────────────────────────────────────────────────

-- Enable RLS
ALTER TABLE ecommerce_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_product_categories ENABLE ROW LEVEL SECURITY;

-- ═══ STORES ═══

-- Public read (active stores only) — for anonymous storefront visitors
CREATE POLICY "ecommerce_stores_public_read" ON ecommerce_stores
    FOR SELECT USING (is_active = true);

-- Admin: full access for tenant members
CREATE POLICY "ecommerce_stores_tenant_manage" ON ecommerce_stores
    FOR ALL USING (
        is_platform_admin() 
        OR tenant_id = get_user_tenant_id()
    );

-- ═══ CATEGORIES ═══

-- Public read (active categories)
CREATE POLICY "ecommerce_categories_public_read" ON ecommerce_categories
    FOR SELECT USING (is_active = true);

-- Admin: full access for tenant members
CREATE POLICY "ecommerce_categories_tenant_manage" ON ecommerce_categories
    FOR ALL USING (
        is_platform_admin() 
        OR tenant_id = get_user_tenant_id()
    );

-- ═══ PRODUCTS ═══

-- Public read (published products only)
CREATE POLICY "ecommerce_products_public_read" ON ecommerce_products
    FOR SELECT USING (is_published = true);

-- Admin: full access for tenant members (see all including unpublished)
CREATE POLICY "ecommerce_products_tenant_manage" ON ecommerce_products
    FOR ALL USING (
        is_platform_admin() 
        OR tenant_id = get_user_tenant_id()
    );

-- ═══ PRODUCT_CATEGORIES ═══

-- Public read (join table — filtered through product join)
CREATE POLICY "ecommerce_product_categories_public_read" ON ecommerce_product_categories
    FOR SELECT USING (true);

-- Admin: manage through product ownership
CREATE POLICY "ecommerce_product_categories_tenant_manage" ON ecommerce_product_categories
    FOR ALL USING (
        product_id IN (
            SELECT id FROM ecommerce_products 
            WHERE is_platform_admin() OR tenant_id = get_user_tenant_id()
        )
    );

-- ─────────────────────────────────────────────────────────────
-- 7b. Grant access to anon role for public storefront
-- ─────────────────────────────────────────────────────────────
GRANT SELECT ON ecommerce_stores TO anon;
GRANT SELECT ON ecommerce_categories TO anon;
GRANT SELECT ON ecommerce_products TO anon;
GRANT SELECT ON ecommerce_product_categories TO anon;

-- Also grant to authenticated (for B2B logged-in customers)
GRANT SELECT ON ecommerce_stores TO authenticated;
GRANT SELECT ON ecommerce_categories TO authenticated;
GRANT SELECT ON ecommerce_products TO authenticated;
GRANT SELECT ON ecommerce_product_categories TO authenticated;
GRANT ALL ON ecommerce_stores TO authenticated;
GRANT ALL ON ecommerce_categories TO authenticated;
GRANT ALL ON ecommerce_products TO authenticated;
GRANT ALL ON ecommerce_product_categories TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- 8. Helper: Get product with live price and stock
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_ecommerce_products(
    p_store_id UUID,
    p_category_slug TEXT DEFAULT NULL,
    p_search TEXT DEFAULT NULL,
    p_featured_only BOOLEAN DEFAULT false,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    material_id UUID,
    marketing_title JSONB,
    marketing_description JSONB,
    short_description JSONB,
    gallery_images TEXT[],
    seo_slug TEXT,
    tags TEXT[],
    is_featured BOOLEAN,
    is_new BOOLEAN,
    is_bestseller BOOLEAN,
    is_on_sale BOOLEAN,
    sale_price DECIMAL,
    sale_unit TEXT,
    min_order_quantity DECIMAL,
    view_count INTEGER,
    order_count INTEGER,
    published_at TIMESTAMPTZ,
    -- From fabric_materials (LIVE!)
    material_code TEXT,
    material_name_ar TEXT,
    material_name_en TEXT,
    unit_price DECIMAL,
    material_image TEXT,
    -- Calculated
    effective_price DECIMAL,
    category_slugs TEXT[]
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ep.id,
        ep.material_id,
        ep.marketing_title,
        ep.marketing_description,
        ep.short_description,
        ep.gallery_images,
        ep.seo_slug,
        ep.tags,
        ep.is_featured,
        ep.is_new,
        ep.is_bestseller,
        ep.is_on_sale,
        ep.sale_price,
        ep.sale_unit,
        ep.min_order_quantity,
        ep.view_count,
        ep.order_count,
        ep.published_at,
        -- Live from fabric_materials
        fm.code AS material_code,
        fm.name_ar AS material_name_ar,
        fm.name_en AS material_name_en,
        fm.unit_price,
        fm.image_url AS material_image,
        -- Effective price: sale_price if on sale, otherwise unit_price
        COALESCE(
            CASE WHEN ep.is_on_sale AND ep.sale_price IS NOT NULL 
                 AND (ep.sale_start_date IS NULL OR ep.sale_start_date <= now())
                 AND (ep.sale_end_date IS NULL OR ep.sale_end_date >= now())
            THEN ep.sale_price 
            ELSE NULL END,
            fm.unit_price
        ) AS effective_price,
        -- Category slugs
        ARRAY(
            SELECT ec.slug FROM ecommerce_product_categories epc
            JOIN ecommerce_categories ec ON ec.id = epc.category_id
            WHERE epc.product_id = ep.id
        ) AS category_slugs
    FROM ecommerce_products ep
    JOIN fabric_materials fm ON fm.id = ep.material_id
    WHERE ep.store_id = p_store_id
      AND ep.is_published = true
      AND (p_featured_only = false OR ep.is_featured = true)
      AND (p_search IS NULL OR (
          fm.name_ar ILIKE '%' || p_search || '%' OR
          fm.name_en ILIKE '%' || p_search || '%' OR
          fm.code ILIKE '%' || p_search || '%' OR
          ep.marketing_title::text ILIKE '%' || p_search || '%' OR
          p_search = ANY(ep.tags)
      ))
      AND (p_category_slug IS NULL OR EXISTS (
          SELECT 1 FROM ecommerce_product_categories epc
          JOIN ecommerce_categories ec ON ec.id = epc.category_id
          WHERE epc.product_id = ep.id AND ec.slug = p_category_slug
      ))
    ORDER BY ep.display_order ASC, ep.published_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant RPC to anon for storefront
GRANT EXECUTE ON FUNCTION get_ecommerce_products(UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) TO anon;
GRANT EXECUTE ON FUNCTION get_ecommerce_products(UUID, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER) TO authenticated;

-- ============================================================
-- ✅ END OF ECOMMERCE FOUNDATION
-- ============================================================

