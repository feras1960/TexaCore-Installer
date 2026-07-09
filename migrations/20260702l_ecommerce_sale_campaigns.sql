-- ═══════════════════════════════════════════════════════════════
-- Sale Campaigns — حملات خصومات جماعية (نسبة عامة + نسبة لكل مادة)
--  - ecommerce_sale_campaigns: الحملة (اسم/بانر/جدولة/حالة)
--  - ecommerce_campaign_products: مواد الحملة بنسبها + لقطة استرجاع
--  التفعيل يكتب sale_price/dates على المنتجات (فيلتقطها الموقع فوراً)،
--  والإيقاف/الانتهاء يسترجع اللقطة.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ecommerce_sale_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES ecommerce_stores(id) ON DELETE CASCADE,
    name JSONB NOT NULL DEFAULT '{}',            -- {ar,en,uk,ru}
    slug TEXT NOT NULL,
    description JSONB DEFAULT '{}',
    banner_image_url TEXT,
    default_percent NUMERIC(5,2),                -- النسبة العامة المقترحة
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'ended')),
    show_on_homepage BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(store_id, slug)
);

CREATE TABLE IF NOT EXISTS ecommerce_campaign_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES ecommerce_sale_campaigns(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
    discount_percent NUMERIC(5,2) NOT NULL CHECK (discount_percent > 0 AND discount_percent < 100),
    -- restore snapshot (taken at activate)
    original_sale_price NUMERIC,
    original_sale_start TIMESTAMPTZ,
    original_sale_end TIMESTAMPTZ,
    original_is_on_sale BOOLEAN,
    -- what was applied
    base_price_at_apply NUMERIC,
    applied_price NUMERIC,
    UNIQUE(campaign_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_esc_store_status ON ecommerce_sale_campaigns(store_id, status);
CREATE INDEX IF NOT EXISTS idx_ecp_campaign ON ecommerce_campaign_products(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ecp_product ON ecommerce_campaign_products(product_id);

-- updated_at
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column') THEN
        DROP TRIGGER IF EXISTS trg_esc_updated ON ecommerce_sale_campaigns;
        CREATE TRIGGER trg_esc_updated BEFORE UPDATE ON ecommerce_sale_campaigns
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- tenant auto-fill
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auto_set_tenant_id') THEN
        DROP TRIGGER IF EXISTS trg_esc_tenant ON ecommerce_sale_campaigns;
        CREATE TRIGGER trg_esc_tenant BEFORE INSERT ON ecommerce_sale_campaigns
            FOR EACH ROW EXECUTE FUNCTION auto_set_tenant_id();
    END IF;
END $$;

-- ─── RLS ───
ALTER TABLE ecommerce_sale_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_campaign_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "esc_public_read" ON ecommerce_sale_campaigns;
CREATE POLICY "esc_public_read" ON ecommerce_sale_campaigns
    FOR SELECT USING (
        status = 'active'
        AND (starts_at IS NULL OR starts_at <= now())
        AND (ends_at IS NULL OR ends_at >= now())
    );

DROP POLICY IF EXISTS "esc_tenant_manage" ON ecommerce_sale_campaigns;
CREATE POLICY "esc_tenant_manage" ON ecommerce_sale_campaigns
    FOR ALL USING (is_platform_admin() OR tenant_id = get_user_tenant_id());

DROP POLICY IF EXISTS "ecp_public_read" ON ecommerce_campaign_products;
CREATE POLICY "ecp_public_read" ON ecommerce_campaign_products
    FOR SELECT USING (
        campaign_id IN (
            SELECT id FROM ecommerce_sale_campaigns
            WHERE status = 'active'
              AND (starts_at IS NULL OR starts_at <= now())
              AND (ends_at IS NULL OR ends_at >= now())
        )
    );

DROP POLICY IF EXISTS "ecp_tenant_manage" ON ecommerce_campaign_products;
CREATE POLICY "ecp_tenant_manage" ON ecommerce_campaign_products
    FOR ALL USING (
        campaign_id IN (
            SELECT id FROM ecommerce_sale_campaigns
            WHERE is_platform_admin() OR tenant_id = get_user_tenant_id()
        )
    );

GRANT SELECT ON ecommerce_sale_campaigns TO anon, authenticated;
GRANT SELECT ON ecommerce_campaign_products TO anon, authenticated;
GRANT ALL ON ecommerce_sale_campaigns TO authenticated;
GRANT ALL ON ecommerce_campaign_products TO authenticated;

COMMENT ON TABLE ecommerce_sale_campaigns IS
  'حملات خصومات: التفعيل يكتب sale_price/dates على المنتجات (الموقع يلتقطها تلقائياً)، والإنهاء يسترجع اللقطة من ecommerce_campaign_products';
