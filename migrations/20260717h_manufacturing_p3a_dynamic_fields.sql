-- 20260717h: موديول التصنيع — P3a/Migration 5 — محرّك الحقول الديناميكية (§2.4 — الأنظمة الثلاثة)
-- ═══════════════════════════════════════════════════════════════════════════
-- يبني على 20260717d-g. يشمل بالضبط ما ورد في §2.4:
--   1) mfg_custom_field_defs — حقول مخصّصة على كيانات التصنيع (7 كيانات) + show_in_list/show_on_print.
--   2) mfg_custom_registers + mfg_custom_register_rows — «جداول إضافية» يعرّفها المستأجر.
--   3) mfg_field_overrides — تخصيص الحقول المدمجة (تسمية/إخفاء/إلزام/افتراضي) ضمن قائمة بيضاء.
--   • mfg_field_override_whitelist (جدول ثابت) + تريغر حارس: الحقول الجوهرية (كميات/حالات/FK) غير قابلة للتخصيص.
--   • custom_data jsonb على كل جداول المستندات (موجود على orders/boms/receipts/issues/order_stages منذ P1؛
--     يُضاف على finished_receipt_lines/labor_logs/work_centers الناقصة) + فهارس GIN.
--   • validate_custom_data(entity,tenant,company,data) → {valid, errors[]} — تحقّق طبقة الخدمة (لا تريغر إدراج، §2.4).
-- RLS قياسي على كل الجداول. idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0) custom_data على الجداول الناقصة + فهارس GIN على المستندات الرئيسية ──
ALTER TABLE public.mfg_finished_receipt_lines ADD COLUMN IF NOT EXISTS custom_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.mfg_labor_logs            ADD COLUMN IF NOT EXISTS custom_data jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.mfg_work_centers          ADD COLUMN IF NOT EXISTS custom_data jsonb DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_mfg_orders_custom_data   ON public.mfg_production_orders USING gin (custom_data);
CREATE INDEX IF NOT EXISTS idx_mfg_boms_custom_data     ON public.mfg_boms             USING gin (custom_data);
CREATE INDEX IF NOT EXISTS idx_mfg_receipts_custom_data ON public.mfg_finished_receipts USING gin (custom_data);
CREATE INDEX IF NOT EXISTS idx_mfg_issues_custom_data   ON public.mfg_material_issues   USING gin (custom_data);
CREATE INDEX IF NOT EXISTS idx_mfg_stages_custom_data   ON public.mfg_order_stages      USING gin (custom_data);

-- ── 1) mfg_custom_field_defs ──
CREATE TABLE IF NOT EXISTS public.mfg_custom_field_defs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL,
    company_id    uuid NOT NULL,
    entity        text NOT NULL,
    field_key     text NOT NULL,
    label_ar      text,
    label_en      text,
    field_type    text NOT NULL DEFAULT 'text',
    options       jsonb,
    is_required   boolean DEFAULT false,
    show_in_list  boolean DEFAULT false,
    show_on_print boolean DEFAULT false,
    sort_order    int DEFAULT 0,
    is_active     boolean DEFAULT true,
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now(),
    CONSTRAINT mfg_ccf_entity_chk CHECK (entity IN ('production_order','bom','order_stage','labor_log','finished_receipt_line','work_center','material_issue')),
    CONSTRAINT mfg_ccf_type_chk CHECK (field_type IN ('text','number','date','select','boolean','file')),
    CONSTRAINT mfg_ccf_unique UNIQUE (tenant_id, entity, field_key)
);

-- ── 2) mfg_custom_registers + rows ──
CREATE TABLE IF NOT EXISTS public.mfg_custom_registers (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL,
    company_id    uuid NOT NULL,
    register_key  text NOT NULL,
    name_ar       text,
    name_en       text,
    fields_schema jsonb DEFAULT '[]'::jsonb,
    link_entity   text,
    is_active     boolean DEFAULT true,
    created_at    timestamptz DEFAULT now(),
    updated_at    timestamptz DEFAULT now(),
    CONSTRAINT mfg_creg_unique UNIQUE (tenant_id, company_id, register_key)
);
CREATE TABLE IF NOT EXISTS public.mfg_custom_register_rows (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    register_id   uuid REFERENCES public.mfg_custom_registers(id) ON DELETE CASCADE,
    tenant_id     uuid NOT NULL,
    company_id    uuid NOT NULL,
    linked_id     uuid,
    data          jsonb DEFAULT '{}'::jsonb,
    created_by    uuid,
    created_at    timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mfg_creg_rows_reg ON public.mfg_custom_register_rows (register_id);
CREATE INDEX IF NOT EXISTS idx_mfg_creg_rows_link ON public.mfg_custom_register_rows (linked_id) WHERE linked_id IS NOT NULL;

-- ── 3) mfg_field_overrides + whitelist ──
CREATE TABLE IF NOT EXISTS public.mfg_field_overrides (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL,
    company_id          uuid NOT NULL,
    entity              text NOT NULL,
    field_key           text NOT NULL,
    label_ar_override   text,
    label_en_override   text,
    is_hidden           boolean DEFAULT false,
    is_required_override boolean,
    default_value       jsonb,
    sort_order          int,
    created_at          timestamptz DEFAULT now(),
    updated_at          timestamptz DEFAULT now(),
    CONSTRAINT mfg_fo_entity_chk CHECK (entity IN ('production_order','bom','order_stage','labor_log','finished_receipt_line','work_center','material_issue')),
    CONSTRAINT mfg_fo_unique UNIQUE (tenant_id, entity, field_key)
);

-- قائمة بيضاء ثابتة للحقول القابلة للتخصيص (الجوهرية: كميات/حالات/FK — مستبعدة)
CREATE TABLE IF NOT EXISTS public.mfg_field_override_whitelist (
    entity     text NOT NULL,
    field_key  text NOT NULL,
    PRIMARY KEY (entity, field_key)
);
INSERT INTO public.mfg_field_override_whitelist (entity, field_key) VALUES
    ('production_order','notes'), ('production_order','planned_start_date'), ('production_order','planned_end_date'),
    ('bom','notes'),
    ('order_stage','name_ar'), ('order_stage','name_en'), ('order_stage','piece_rate'),
    ('order_stage','expected_minutes_per_unit'), ('order_stage','fixed_minutes'), ('order_stage','min_wait_hours'),
    ('labor_log','notes'), ('labor_log','work_date'),
    ('finished_receipt_line','package_size'),
    ('work_center','name_ar'), ('work_center','name_en'), ('work_center','efficiency_pct'), ('work_center','capacity'),
    ('material_issue','issue_date'), ('material_issue','notes')
ON CONFLICT (entity, field_key) DO NOTHING;
-- القائمة البيضاء عامة (مرجع ثابت) — قراءة للجميع فقط
ALTER TABLE public.mfg_field_override_whitelist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfg_fow_select_policy ON public.mfg_field_override_whitelist;
CREATE POLICY mfg_fow_select_policy ON public.mfg_field_override_whitelist FOR SELECT USING (true);

-- تريغر حارس: يرفض تخصيص أي حقل خارج القائمة البيضاء (حقل جوهري)
CREATE OR REPLACE FUNCTION public.mfg_field_override_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.mfg_field_override_whitelist w
                    WHERE w.entity = NEW.entity AND w.field_key = NEW.field_key) THEN
        RAISE EXCEPTION 'الحقل %/% غير قابل للتخصيص — حقل جوهري خارج القائمة البيضاء', NEW.entity, NEW.field_key
            USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_mfg_field_override_guard ON public.mfg_field_overrides;
CREATE TRIGGER trg_mfg_field_override_guard
    BEFORE INSERT OR UPDATE ON public.mfg_field_overrides
    FOR EACH ROW EXECUTE FUNCTION public.mfg_field_override_guard();

-- ── RLS قياسي على الجداول الأربعة (نموذج 20260716a) ──
DO $$
DECLARE tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['mfg_custom_field_defs','mfg_custom_registers','mfg_custom_register_rows','mfg_field_overrides'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_select_policy', tbl);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT USING (is_platform_admin() OR (tenant_id = get_current_tenant_id_fallback()))', tbl || '_select_policy', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_insert_policy', tbl);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))', tbl || '_insert_policy', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_update_policy', tbl);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))', tbl || '_update_policy', tbl);
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', tbl || '_delete_policy', tbl);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND can_access_company(company_id)))', tbl || '_delete_policy', tbl);
    END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) validate_custom_data — تحقّق الإلزام والنوع مقابل التعريفات (طبقة الخدمة — لا تريغر إدراج)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.validate_custom_data(
    p_entity text, p_tenant uuid, p_company uuid, p_data jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $fn$
DECLARE
    v_def   RECORD;
    v_errs  jsonb := '[]'::jsonb;
    v_val   text;
    v_has   boolean;
BEGIN
    p_data := COALESCE(p_data, '{}'::jsonb);
    FOR v_def IN
        SELECT field_key, field_type, is_required, options
          FROM public.mfg_custom_field_defs
         WHERE tenant_id = p_tenant AND entity = p_entity AND COALESCE(is_active,true) = true
    LOOP
        v_has := (p_data ? v_def.field_key) AND (p_data->>v_def.field_key) IS NOT NULL AND (p_data->>v_def.field_key) <> '';
        -- الإلزام
        IF COALESCE(v_def.is_required,false) AND NOT v_has THEN
            v_errs := v_errs || jsonb_build_object('field_key', v_def.field_key, 'error', 'required');
            CONTINUE;
        END IF;
        IF NOT v_has THEN CONTINUE; END IF;
        v_val := p_data->>v_def.field_key;
        -- النوع
        IF v_def.field_type = 'number' THEN
            IF v_val !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
                v_errs := v_errs || jsonb_build_object('field_key', v_def.field_key, 'error', 'not_a_number');
            END IF;
        ELSIF v_def.field_type = 'boolean' THEN
            IF lower(v_val) NOT IN ('true','false','t','f','0','1') THEN
                v_errs := v_errs || jsonb_build_object('field_key', v_def.field_key, 'error', 'not_a_boolean');
            END IF;
        ELSIF v_def.field_type = 'date' THEN
            BEGIN
                PERFORM v_val::date;
            EXCEPTION WHEN OTHERS THEN
                v_errs := v_errs || jsonb_build_object('field_key', v_def.field_key, 'error', 'not_a_date');
            END;
        ELSIF v_def.field_type = 'select' THEN
            IF v_def.options IS NOT NULL AND jsonb_typeof(v_def.options) = 'array'
               AND NOT (v_def.options ? v_val) THEN
                v_errs := v_errs || jsonb_build_object('field_key', v_def.field_key, 'error', 'invalid_option');
            END IF;
        END IF;
    END LOOP;
    RETURN jsonb_build_object('valid', (jsonb_array_length(v_errs) = 0), 'errors', v_errs);
END;
$fn$;
COMMENT ON FUNCTION public.validate_custom_data(text,uuid,uuid,jsonb) IS
  'تحقّق الحقول المخصّصة (إلزام + نوع) مقابل mfg_custom_field_defs → {valid, errors[]}. يُستدعى من طبقة الخدمة (§2.4).';
GRANT EXECUTE ON FUNCTION public.validate_custom_data(text,uuid,uuid,jsonb) TO authenticated, service_role;
