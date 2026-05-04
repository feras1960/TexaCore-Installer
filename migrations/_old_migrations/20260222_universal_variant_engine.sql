-- ═══════════════════════════════════════════════════════════════════════════
-- 🏗️ Universal Variant Engine — Phase 1A: Database Schema
-- ═══════════════════════════════════════════════════════════════════════════
-- Date:    2026-02-22
-- Author:  TexaCore ERP Team
-- Purpose: Create a universal, user-customizable product variant system
--          that works across all modules (fabrics, products, services)
--
-- Tables Created:
--   1. variant_axes          — المحاور (لون، تصميم، مقاس...)
--   2. variant_axis_values   — قيم المحاور (أحمر، سادة، XL...)
--   3. product_variant_config — ربط المنتج بالمحاور المفعّلة
--   4. product_variant_values — قيم كل متغير فعلي
--
-- Tables Modified:
--   5. product_variants      — توسيع بأعمدة إضافية
--   6. fabric_materials      — إضافة أعمدة المتغيرات
--
-- Data Migrated:
--   7. fabric_colors → variant_axis_values (الألوان الموجودة)
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════
-- 1️⃣ جدول محاور المتغيرات (Variant Axes)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS variant_axes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    -- التعريف
    code            VARCHAR(50) NOT NULL,
    name_ar         VARCHAR(100) NOT NULL,
    name_en         VARCHAR(100),
    description_ar  TEXT,
    description_en  TEXT,
    
    -- النوع والسلوك
    axis_type       VARCHAR(20) NOT NULL DEFAULT 'text'
                    CHECK (axis_type IN ('color', 'text', 'number', 'image')),
    display_type    VARCHAR(20) DEFAULT 'chips'
                    CHECK (display_type IN ('chips', 'dropdown', 'color_swatches', 'images')),
    
    -- الترتيب والحالة
    sort_order      INTEGER DEFAULT 0,
    is_active       BOOLEAN DEFAULT true,
    is_system       BOOLEAN DEFAULT false,
    
    -- الطوابع
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(company_id, code)
);

COMMENT ON TABLE variant_axes IS 'محاور المتغيرات القابلة للتخصيص — يعرّفها المستخدم (لون، تصميم، مقاس، إلخ)';
COMMENT ON COLUMN variant_axes.axis_type IS 'color=ألوان مع hex | text=نصوص | number=أرقام | image=صور';
COMMENT ON COLUMN variant_axes.display_type IS 'chips=شرائح | dropdown=قائمة | color_swatches=بطاقات ألوان | images=صور';
COMMENT ON COLUMN variant_axes.is_system IS 'محاور نظامية لا يمكن للمستخدم حذفها';


-- ═══════════════════════════════════════════════
-- 2️⃣ جدول قيم المحاور (Axis Values)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS variant_axis_values (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    axis_id         UUID NOT NULL REFERENCES variant_axes(id) ON DELETE CASCADE,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    -- التعريف
    code            VARCHAR(50) NOT NULL,
    name_ar         VARCHAR(100) NOT NULL,
    name_en         VARCHAR(100),
    
    -- خصائص حسب النوع
    hex_code        VARCHAR(7),          -- '#FF0000' (لمحور الألوان)
    image_url       TEXT,                 -- رابط صورة (للتصاميم)
    numeric_value   NUMERIC,              -- قيمة رقمية (للوزن/المقاس)
    
    -- تجميع
    color_family    VARCHAR(30),          -- 'red', 'blue', 'neutral'
    
    -- الترتيب والحالة
    sort_order      INTEGER DEFAULT 0,
    is_active       BOOLEAN DEFAULT true,
    
    -- الطوابع
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(axis_id, company_id, code)
);

COMMENT ON TABLE variant_axis_values IS 'قيم كل محور — مثلاً: أحمر، أزرق، أبيض تحت محور اللون';
COMMENT ON COLUMN variant_axis_values.hex_code IS 'كود اللون السداسي — يُستخدم فقط مع محاور type=color';
COMMENT ON COLUMN variant_axis_values.color_family IS 'عائلة اللون للتجميع: red, blue, green, neutral, warm, cool';


-- ═══════════════════════════════════════════════
-- 3️⃣ جدول إعداد المنتج بالمحاور (Product Variant Config)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS product_variant_config (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID NOT NULL,
    product_table   VARCHAR(50) NOT NULL DEFAULT 'fabric_materials',
    axis_id         UUID NOT NULL REFERENCES variant_axes(id) ON DELETE CASCADE,
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    
    -- الإعدادات
    is_required     BOOLEAN DEFAULT false,
    is_hierarchical BOOLEAN DEFAULT false,
    parent_axis_id  UUID REFERENCES variant_axes(id),
    sort_order      INTEGER DEFAULT 0,
    
    created_at      TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(product_id, axis_id)
);

COMMENT ON TABLE product_variant_config IS 'ربط المنتج بالمحاور المفعّلة — يحدد أي محاور تعمل لمنتج معيّن';
COMMENT ON COLUMN product_variant_config.product_table IS 'اسم جدول المنتج: fabric_materials, products, etc.';
COMMENT ON COLUMN product_variant_config.is_hierarchical IS 'إذا true: هذا المحور يظهر كشجرة تحت المحور الأب';
COMMENT ON COLUMN product_variant_config.parent_axis_id IS 'المحور الأب — مثلاً: اللون تحت التصميم';


-- ═══════════════════════════════════════════════
-- 4️⃣ توسيع جدول المتغيرات الفعلية (product_variants)
-- ═══════════════════════════════════════════════
-- الجدول موجود بـ 6 أعمدة: id, tenant_id, product_id, sku, name_ar, created_at
-- نضيف الأعمدة المطلوبة فقط

ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS parent_product_id UUID;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS product_table VARCHAR(50) DEFAULT 'fabric_materials';
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS name_en VARCHAR(255);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS display_name_ar VARCHAR(255);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS display_name_en VARCHAR(255);
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS variant_data JSONB DEFAULT '{}';
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

COMMENT ON TABLE product_variants IS 'المتغيرات الفعلية المُنشأة — كل سجل = تركيبة فريدة (مادة + لون + تصميم)';
COMMENT ON COLUMN product_variants.parent_product_id IS 'معرّف المنتج الأم في جدوله الأصلي';
COMMENT ON COLUMN product_variants.variant_data IS 'بيانات إضافية (سعر مختلف، وزن...)';

-- حذف FK القديم → products لأن product_id أصبح polymorphic
-- (يشير لأي جدول حسب product_table: fabric_materials, products, services...)
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_product_id_fkey;


-- ═══════════════════════════════════════════════
-- 5️⃣ جدول قيم المتغير الفعلي (Product Variant Values)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS product_variant_values (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    variant_id      UUID NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
    axis_id         UUID NOT NULL REFERENCES variant_axes(id) ON DELETE CASCADE,
    value_id        UUID NOT NULL REFERENCES variant_axis_values(id) ON DELETE CASCADE,
    
    created_at      TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(variant_id, axis_id)
);

COMMENT ON TABLE product_variant_values IS 'قيم كل متغير — كل صف = محور واحد لمتغير واحد (مثل: variant X → لون أحمر)';


-- ═══════════════════════════════════════════════
-- 6️⃣ إضافة أعمدة المتغيرات لجدول fabric_materials
-- ═══════════════════════════════════════════════
ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS has_variants BOOLEAN DEFAULT false;
ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS is_variant_parent BOOLEAN DEFAULT false;
ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS parent_material_id UUID REFERENCES fabric_materials(id) ON DELETE SET NULL;
ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id) ON DELETE SET NULL;

COMMENT ON COLUMN fabric_materials.has_variants IS 'هل هذه المادة لها متغيرات (مادة أم)؟';
COMMENT ON COLUMN fabric_materials.is_variant_parent IS 'علامة: هذه المادة هي أم لمتغيرات فرعية';
COMMENT ON COLUMN fabric_materials.parent_material_id IS 'معرّف المادة الأم (للمتغيرات الفرعية)';
COMMENT ON COLUMN fabric_materials.variant_id IS 'ربط بسجل المتغير في product_variants';


-- ═══════════════════════════════════════════════
-- 7️⃣ سياسات RLS
-- ═══════════════════════════════════════════════

-- 7a. variant_axes
ALTER TABLE variant_axes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "variant_axes_select" ON variant_axes;
CREATE POLICY "variant_axes_select" ON variant_axes
    FOR SELECT USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "variant_axes_insert" ON variant_axes;
CREATE POLICY "variant_axes_insert" ON variant_axes
    FOR INSERT WITH CHECK (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "variant_axes_update" ON variant_axes;
CREATE POLICY "variant_axes_update" ON variant_axes
    FOR UPDATE USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "variant_axes_delete" ON variant_axes;
CREATE POLICY "variant_axes_delete" ON variant_axes
    FOR DELETE USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()) AND is_system = false);

-- 7b. variant_axis_values
ALTER TABLE variant_axis_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "variant_axis_values_select" ON variant_axis_values;
CREATE POLICY "variant_axis_values_select" ON variant_axis_values
    FOR SELECT USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "variant_axis_values_insert" ON variant_axis_values;
CREATE POLICY "variant_axis_values_insert" ON variant_axis_values
    FOR INSERT WITH CHECK (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "variant_axis_values_update" ON variant_axis_values;
CREATE POLICY "variant_axis_values_update" ON variant_axis_values
    FOR UPDATE USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "variant_axis_values_delete" ON variant_axis_values;
CREATE POLICY "variant_axis_values_delete" ON variant_axis_values
    FOR DELETE USING (tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid()));

-- 7c. product_variant_config
ALTER TABLE product_variant_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_variant_config_select" ON product_variant_config;
CREATE POLICY "product_variant_config_select" ON product_variant_config
    FOR SELECT USING (company_id IN (SELECT id FROM companies WHERE tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())));

DROP POLICY IF EXISTS "product_variant_config_insert" ON product_variant_config;
CREATE POLICY "product_variant_config_insert" ON product_variant_config
    FOR INSERT WITH CHECK (company_id IN (SELECT id FROM companies WHERE tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())));

DROP POLICY IF EXISTS "product_variant_config_update" ON product_variant_config;
CREATE POLICY "product_variant_config_update" ON product_variant_config
    FOR UPDATE USING (company_id IN (SELECT id FROM companies WHERE tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())));

DROP POLICY IF EXISTS "product_variant_config_delete" ON product_variant_config;
CREATE POLICY "product_variant_config_delete" ON product_variant_config
    FOR DELETE USING (company_id IN (SELECT id FROM companies WHERE tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())));

-- 7d. product_variant_values
ALTER TABLE product_variant_values ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "product_variant_values_select" ON product_variant_values;
CREATE POLICY "product_variant_values_select" ON product_variant_values
    FOR SELECT USING (variant_id IN (SELECT id FROM product_variants WHERE tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())));

DROP POLICY IF EXISTS "product_variant_values_insert" ON product_variant_values;
CREATE POLICY "product_variant_values_insert" ON product_variant_values
    FOR INSERT WITH CHECK (variant_id IN (SELECT id FROM product_variants WHERE tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())));

DROP POLICY IF EXISTS "product_variant_values_update" ON product_variant_values;
CREATE POLICY "product_variant_values_update" ON product_variant_values
    FOR UPDATE USING (variant_id IN (SELECT id FROM product_variants WHERE tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())));

DROP POLICY IF EXISTS "product_variant_values_delete" ON product_variant_values;
CREATE POLICY "product_variant_values_delete" ON product_variant_values
    FOR DELETE USING (variant_id IN (SELECT id FROM product_variants WHERE tenant_id = (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())));


-- ═══════════════════════════════════════════════
-- 8️⃣ الفهارس (Indexes) للأداء
-- ═══════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_variant_axes_company ON variant_axes(company_id);
CREATE INDEX IF NOT EXISTS idx_variant_axes_tenant ON variant_axes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_variant_axis_values_axis ON variant_axis_values(axis_id);
CREATE INDEX IF NOT EXISTS idx_variant_axis_values_company ON variant_axis_values(company_id);
CREATE INDEX IF NOT EXISTS idx_product_variant_config_product ON product_variant_config(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variant_config_axis ON product_variant_config(axis_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_parent ON product_variants(parent_product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_company ON product_variants(company_id);
CREATE INDEX IF NOT EXISTS idx_product_variant_values_variant ON product_variant_values(variant_id);
CREATE INDEX IF NOT EXISTS idx_fabric_materials_parent ON fabric_materials(parent_material_id);
CREATE INDEX IF NOT EXISTS idx_fabric_materials_variant ON fabric_materials(variant_id);


-- ═══════════════════════════════════════════════
-- 9️⃣ الـ Triggers — updated_at تلقائي
-- ═══════════════════════════════════════════════

-- variant_axes
CREATE OR REPLACE FUNCTION update_variant_axes_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_variant_axes_updated ON variant_axes;
CREATE TRIGGER trg_variant_axes_updated
    BEFORE UPDATE ON variant_axes
    FOR EACH ROW
    EXECUTE FUNCTION update_variant_axes_timestamp();

-- variant_axis_values
CREATE OR REPLACE FUNCTION update_variant_axis_values_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_variant_axis_values_updated ON variant_axis_values;
CREATE TRIGGER trg_variant_axis_values_updated
    BEFORE UPDATE ON variant_axis_values
    FOR EACH ROW
    EXECUTE FUNCTION update_variant_axis_values_timestamp();

-- product_variants
CREATE OR REPLACE FUNCTION update_product_variants_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_product_variants_updated ON product_variants;
CREATE TRIGGER trg_product_variants_updated
    BEFORE UPDATE ON product_variants
    FOR EACH ROW
    EXECUTE FUNCTION update_product_variants_timestamp();


-- ═══════════════════════════════════════════════════════════════════════
-- ✅ Migration Complete — Universal Variant Engine Phase 1A
-- ═══════════════════════════════════════════════════════════════════════
