-- 20260716b: موديول التصنيع — بيانات الأساس (P0)
-- ═══════════════════════════════════════════════════════════════════════════
-- ينشئ جداول الأساس لمحرّك المراحل (المبدأ الحاكم §1.1-أ: شامل بالمخطط، بسيط بالاستخدام):
--   mfg_work_centers · mfg_workflow_templates · mfg_workflow_stages ·
--   mfg_stage_work_centers · mfg_stage_dependencies · mfg_production_calendar · mfg_settings
-- كل الجداول: tenant_id + company_id + RLS بنمط 20260716a_roll_movements_rls.sql القياسي.
-- idempotent بالكامل (CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS + IF NOT EXISTS).
-- الأعمدة المؤجّلة وظيفياً (allow_overlap، تبعيات DAG) موجودة بالمخطط من اليوم الأول.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) محطات/مراكز العمل — mfg_work_centers
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_work_centers (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL,
    company_id     uuid NOT NULL,
    code           text NOT NULL,
    name_ar        text,
    name_en        text,
    warehouse_id   uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,  -- مستودع WIP الافتراضي
    capacity       int  DEFAULT 1,                 -- أوامر متوازية
    efficiency_pct numeric DEFAULT 100,
    -- مكوّنات التكلفة: يدعم أنواع الساعة + per_cycle (مكابس/ستامبينغ) — §4-د بند 13
    -- [{type:'labor'|'electricity'|'rent'|'consumable'|'per_cycle'|'other', rate_per_hour, rate_per_cycle}]
    cost_components jsonb DEFAULT '[]'::jsonb,
    hour_rate      numeric,                          -- مجموع مكوّنات الساعة (محسوب بالخدمة)
    status         text DEFAULT 'active' CHECK (status IN ('active','inactive','down','maintenance')),
    is_active      boolean DEFAULT true,
    notes          text,
    created_by     uuid,
    created_at     timestamptz DEFAULT now(),
    updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfg_work_centers_tenant_company ON public.mfg_work_centers (tenant_id, company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) قوالب سير العمل — mfg_workflow_templates (قلب الموديول)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_workflow_templates (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL,
    company_id    uuid NOT NULL,
    code          text NOT NULL,
    name_ar       text,
    name_en       text,
    industry_tag  text,                              -- textile|food|furniture|generic…
    is_active     boolean DEFAULT true,
    notes         text,
    created_by    uuid,
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfg_workflow_templates_tenant_company ON public.mfg_workflow_templates (tenant_id, company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3) مراحل القالب — mfg_workflow_stages
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_workflow_stages (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL,
    company_id     uuid NOT NULL,
    template_id    uuid NOT NULL REFERENCES public.mfg_workflow_templates(id) ON DELETE CASCADE,
    seq            int NOT NULL DEFAULT 0,           -- الترتيب (خطي v1)
    name_ar        text,
    name_en        text,
    work_center_id uuid REFERENCES public.mfg_work_centers(id) ON DELETE SET NULL,  -- المحطة الأساسية/الافتراضية
    is_passive     boolean DEFAULT false,            -- تجفيف/تبريد: بلا عمالة، مدة ثابتة
    min_wait_hours numeric DEFAULT 0,                -- زمن انتظار بعد المرحلة (§4-د بند 6)
    batch_min      numeric,                          -- حدود دفعة المرحلة (§4-د بند 7)
    batch_max      numeric,
    batch_multiple numeric,
    stage_type     text DEFAULT 'production' CHECK (stage_type IN ('production','cleaning','qc')),
    allow_overlap  boolean DEFAULT false,            -- خامل v1 (تمرير جزئي) — §4-ج بند 25
    expected_minutes_per_unit numeric,               -- SAM
    fixed_minutes  numeric,                          -- زمن تجهيز ثابت (setup)
    pay_type       text DEFAULT 'none' CHECK (pay_type IN ('per_piece','hourly','none')),
    piece_rate     numeric,
    qc_checklist   jsonb DEFAULT '[]'::jsonb,        -- [{item, type:'pass_fail'|'measure', min, max}]
    scrap_pct      numeric DEFAULT 0,                -- فاقد متوقع للمرحلة
    custom_data    jsonb DEFAULT '{}'::jsonb,        -- حقول ديناميكية (§2.4) — العمود من اليوم الأول
    created_at     timestamptz DEFAULT now(),
    updated_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfg_workflow_stages_tenant_company ON public.mfg_workflow_stages (tenant_id, company_id);
CREATE INDEX IF NOT EXISTS idx_mfg_workflow_stages_template ON public.mfg_workflow_stages (template_id, seq);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) محطات بديلة لكل مرحلة (جدول وصل) — mfg_stage_work_centers (§4-د بند 8)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_stage_work_centers (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      uuid NOT NULL,
    company_id     uuid NOT NULL,
    stage_id       uuid NOT NULL REFERENCES public.mfg_workflow_stages(id) ON DELETE CASCADE,
    work_center_id uuid NOT NULL REFERENCES public.mfg_work_centers(id) ON DELETE CASCADE,
    priority       int DEFAULT 0,                    -- الأولوية (الأقل = الأعلى)
    created_at     timestamptz DEFAULT now(),
    UNIQUE (stage_id, work_center_id)
);

CREATE INDEX IF NOT EXISTS idx_mfg_stage_work_centers_stage ON public.mfg_stage_work_centers (stage_id);
CREATE INDEX IF NOT EXISTS idx_mfg_stage_work_centers_tenant_company ON public.mfg_stage_work_centers (tenant_id, company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5) تبعيات المراحل (جدول وصل — خامل v1، مفاتيح حقيقية) — mfg_stage_dependencies (§4-ج بند 26)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_stage_dependencies (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             uuid NOT NULL,
    company_id            uuid NOT NULL,
    stage_id              uuid NOT NULL REFERENCES public.mfg_workflow_stages(id) ON DELETE CASCADE,
    depends_on_stage_id   uuid NOT NULL REFERENCES public.mfg_workflow_stages(id) ON DELETE CASCADE,
    created_at            timestamptz DEFAULT now(),
    UNIQUE (stage_id, depends_on_stage_id),
    CHECK (stage_id <> depends_on_stage_id)
);

CREATE INDEX IF NOT EXISTS idx_mfg_stage_dependencies_stage ON public.mfg_stage_dependencies (stage_id);
CREATE INDEX IF NOT EXISTS idx_mfg_stage_dependencies_tenant_company ON public.mfg_stage_dependencies (tenant_id, company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6) تقويم الإنتاج — mfg_production_calendar (§4-ج بند 16 — بيانات أساس، الجدولة لاحقاً)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_production_calendar (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL,
    company_id   uuid NOT NULL,
    name         text,
    working_days int[] DEFAULT '{0,1,2,3,4}',        -- 0=الأحد … 6=السبت
    shifts       jsonb DEFAULT '[]'::jsonb,          -- ورديات لكل محطة (اختياري): [{work_center_id, start, end}]
    is_default   boolean DEFAULT false,
    is_active    boolean DEFAULT true,
    created_at   timestamptz DEFAULT now(),
    updated_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfg_production_calendar_tenant_company ON public.mfg_production_calendar (tenant_id, company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7) إعدادات التصنيع — mfg_settings (§2.5) — صفّ واحد لكل tenant+company
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.mfg_settings (
    id                             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                      uuid NOT NULL,
    company_id                     uuid NOT NULL,
    default_wip_warehouse_id       uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
    default_fg_warehouse_id        uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
    default_scrap_warehouse_id     uuid REFERENCES public.warehouses(id) ON DELETE SET NULL,
    -- الحسابات المحاسبية (nullable الآن — تُربط في P2):
    wip_account_id                 uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
    labor_absorption_account_id    uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
    overhead_absorption_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
    production_variance_account_id uuid REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
    allow_negative_wip             boolean DEFAULT false,
    require_full_qc                boolean DEFAULT false,
    auto_backflush                 boolean DEFAULT true,
    batch_number_format            text DEFAULT '{product}-{yymmdd}-{seq}',  -- §4-ج بند 32
    created_at                     timestamptz DEFAULT now(),
    updated_at                     timestamptz DEFAULT now(),
    UNIQUE (tenant_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_mfg_settings_tenant_company ON public.mfg_settings (tenant_id, company_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — النمط القياسي (نموذج 20260716a): عزل tenant للقراءة، tenant+company للكتابة.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
    tbl text;
    tables text[] := ARRAY[
        'mfg_work_centers','mfg_workflow_templates','mfg_workflow_stages',
        'mfg_stage_work_centers','mfg_stage_dependencies','mfg_production_calendar','mfg_settings'
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
