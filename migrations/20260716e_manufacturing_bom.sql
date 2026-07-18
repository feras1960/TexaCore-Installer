-- 20260716e: موديول التصنيع — قوائم المواد (BOM) — P1a (طبقة القاعدة)
-- ═══════════════════════════════════════════════════════════════════════════
-- ينشئ مخطط قوائم المواد بالنمطين per_unit + formula (§2.2 + المسح النهائي §4-د):
--   mfg_boms · mfg_bom_lines · mfg_bom_line_alternates · mfg_bom_outputs
-- + يضيف المفتاح الأجنبي products.default_bom_id → mfg_boms(id) (كان بلا FK في P0).
-- كل الجداول: tenant_id + company_id + RLS بالنمط القياسي (نموذج 20260716a/20260716b).
-- idempotent بالكامل (CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS + IF NOT EXISTS).
-- الأعمدة المؤجّلة وظيفياً (variant_match_attribute، is_confidential…) موجودة بالمخطط
-- من اليوم الأول (مبدأ §1.1-أ: شامل بالبيانات).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) قوائم المواد — mfg_boms (§2.2 + المسح النهائي §4-د/1,2,5)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_boms (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    company_id            uuid NOT NULL,
    product_id            uuid REFERENCES public.products(id) ON DELETE SET NULL,  -- المنتج النهائي (الرئيسي)
    bom_code              text,                              -- BOM-{sku}-{v}
    version               int DEFAULT 1,
    is_active             boolean DEFAULT true,
    is_default            boolean DEFAULT false,
    -- نسخ الوصفات + الاعتماد (§4-د/1): لا يُنتَج إلا من BOM معتمدة وسارية.
    status                text DEFAULT 'draft' CHECK (status IN ('draft','approved','archived')),
    effective_from        date,
    effective_to          date,
    bom_type              text DEFAULT 'manufacture' CHECK (bom_type IN ('manufacture','kit','subcontract')),
    bom_basis             text DEFAULT 'per_unit'    CHECK (bom_basis IN ('per_unit','formula')),
        -- per_unit: كميات لكل وحدة منتج (منفصل)
        -- formula: وصفة لدفعة مرجعية، البنود بنِسَب/كميات الدفعة، تُحجَّم لأي حجم خلطة (عملياتي)
    yield_pct             numeric DEFAULT 100,       -- نسبة المردود (عملياتي: الخارج/الداخل)
    quantity              numeric DEFAULT 1,         -- كمية الدفعة المرجعية
    unit_id               uuid REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
    workflow_template_id  uuid REFERENCES public.mfg_workflow_templates(id) ON DELETE SET NULL,
    process_loss_pct      numeric DEFAULT 0,
    overproduction_pct    numeric DEFAULT 0,         -- سماحية تجاوز الكمية (§4-د/21)
    -- حدود خلطة الوصفة (§4-د/5):
    batch_min             numeric,
    batch_max             numeric,
    is_confidential       boolean DEFAULT false,     -- سرّية الوصفة (§4-د/2)
    -- تكاليف تقديرية (تخطيطية فقط — التقييم الفعلي وقت الإنتاج) (§4-ج/17):
    est_material_cost     numeric DEFAULT 0,
    est_operating_cost    numeric DEFAULT 0,
    est_labor_cost        numeric DEFAULT 0,
    est_total_cost        numeric DEFAULT 0,
    est_costs_updated_at  timestamptz,
    subcontractor_id      uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,  -- عند bom_type='subcontract'
    custom_data           jsonb DEFAULT '{}'::jsonb, -- حقول ديناميكية (§2.4)
    notes                 text,
    created_by            uuid,
    created_at            timestamptz DEFAULT now(),
    updated_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfg_boms_tenant_company ON public.mfg_boms (tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_mfg_boms_product        ON public.mfg_boms (product_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) بنود قائمة المواد — mfg_bom_lines (§2.2 + §4-د/3,20)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_bom_lines (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                uuid NOT NULL,
    company_id               uuid NOT NULL,
    bom_id                   uuid NOT NULL REFERENCES public.mfg_boms(id) ON DELETE CASCADE,
    component_product_id     uuid REFERENCES public.products(id) ON DELETE SET NULL,
    component_bom_id         uuid REFERENCES public.mfg_boms(id) ON DELETE SET NULL,  -- ≠NULL ⇒ مجمَّع فرعي (متعدد المستويات)
    qty_per_unit             numeric,                  -- per_unit: لكل وحدة؛ formula: لكمية الدفعة المرجعية
    formula_pct              numeric,                  -- formula: نسبة مئوية من الخلطة (بديل عن الكمية)
    unit_id                  uuid REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
    stage_id                 uuid REFERENCES public.mfg_workflow_stages(id) ON DELETE SET NULL,  -- الاستهلاك بالمرحلة
    issue_method             text DEFAULT 'backflush' CHECK (issue_method IN ('backflush','manual')),
    consumption_tolerance_pct numeric,                 -- سماح انحراف الاستهلاك الفعلي (عملياتي)
    weigh_tolerance_pct      numeric,                  -- سماحية وزن لكل بند (§4-د/5)
    variant_match_attribute  text,                     -- خامل v1: حلّ القماش من متغير المنتج (§4-د/20)
    scrap_pct                numeric DEFAULT 0,
    is_roll_tracked          boolean DEFAULT false,    -- مواد رولونات (أقمشة)
    requires_batch           boolean DEFAULT false,    -- إلزام اختيار دفعة عند الصرف
    sourced_by_supplier      boolean DEFAULT false,    -- تعاقد باطن: المورّد يوفرها
    sort_order               int DEFAULT 0,
    created_at               timestamptz DEFAULT now(),
    updated_at               timestamptz DEFAULT now(),
    -- soft XOR: لا يجوز إعطاء formula_pct و qty_per_unit معاً (أحدهما، وقد يكون كلاهما NULL لمجمَّع فرعي)
    CONSTRAINT chk_mfg_bom_lines_qty_xor CHECK (num_nonnulls(formula_pct, qty_per_unit) <= 1)
);

CREATE INDEX IF NOT EXISTS idx_mfg_bom_lines_tenant_company ON public.mfg_bom_lines (tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_mfg_bom_lines_bom            ON public.mfg_bom_lines (bom_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_mfg_bom_lines_component      ON public.mfg_bom_lines (component_product_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) مواد بديلة لكل بند وصفة — mfg_bom_line_alternates (§4-د/3)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_bom_line_alternates (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    company_id            uuid NOT NULL,
    line_id               uuid NOT NULL REFERENCES public.mfg_bom_lines(id) ON DELETE CASCADE,
    alternate_product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    priority              int DEFAULT 0,               -- الأقل = الأعلى أولوية
    created_at            timestamptz DEFAULT now(),
    UNIQUE (line_id, alternate_product_id)
);

CREATE INDEX IF NOT EXISTS idx_mfg_bom_line_alternates_line          ON public.mfg_bom_line_alternates (line_id);
CREATE INDEX IF NOT EXISTS idx_mfg_bom_line_alternates_tenant_company ON public.mfg_bom_line_alternates (tenant_id, company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) مخرجات الوصفة — mfg_bom_outputs (رئيسي + مشتركة + ثانويات/خردة) (§2.2)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_bom_outputs (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    company_id            uuid NOT NULL,
    bom_id                uuid NOT NULL REFERENCES public.mfg_boms(id) ON DELETE CASCADE,
    product_id            uuid REFERENCES public.products(id) ON DELETE SET NULL,
    output_role           text DEFAULT 'byproduct' CHECK (output_role IN ('primary','co_product','byproduct','scrap')),
    qty_per_batch         numeric,
    cost_share_pct        numeric DEFAULT 0,           -- co_product: حصة تكلفة؛ primary يأخذ الباقي
    recovery_rate         numeric,                     -- byproduct/scrap: قيمة استرداد ثابتة
    default_package_size  numeric,                     -- التعبئة: حجم العبوة (1/5/20 كغ)
    unit_id               uuid REFERENCES public.units_of_measure(id) ON DELETE SET NULL,
    stage_id              uuid REFERENCES public.mfg_workflow_stages(id) ON DELETE SET NULL,  -- المرحلة المنتِجة
    sort_order            int DEFAULT 0,
    created_at            timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfg_bom_outputs_bom            ON public.mfg_bom_outputs (bom_id);
CREATE INDEX IF NOT EXISTS idx_mfg_bom_outputs_tenant_company ON public.mfg_bom_outputs (tenant_id, company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) المفتاح الأجنبي المؤجّل: products.default_bom_id → mfg_boms(id)
--    (العمود موجود من P0 بلا FK — يُضاف الآن بعد إنشاء mfg_boms)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_products_default_bom'
    ) THEN
        ALTER TABLE public.products
            ADD CONSTRAINT fk_products_default_bom
            FOREIGN KEY (default_bom_id) REFERENCES public.mfg_boms(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — النمط القياسي (نموذج 20260716a/20260716b): عزل tenant للقراءة، tenant+company للكتابة.
-- كل الجداول الأبناء تحمل tenant_id + company_id (نمط الجداول الوصلية في P0).
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'mfg_boms','mfg_bom_lines','mfg_bom_line_alternates','mfg_bom_outputs'
    ];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_select_policy', tbl);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT '
            'USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()))',
            tbl || '_select_policy', tbl);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_insert_policy', tbl);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
            'WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))',
            tbl || '_insert_policy', tbl);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_update_policy', tbl);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
            'USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))',
            tbl || '_update_policy', tbl);

        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_delete_policy', tbl);
        EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated '
            'USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))',
            tbl || '_delete_policy', tbl);
    END LOOP;
END $$;

COMMIT;
