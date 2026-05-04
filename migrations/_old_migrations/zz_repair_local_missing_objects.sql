-- ═══════════════════════════════════════════════════════════════════════════
-- REPAIR MIGRATION v2: إصلاح شامل للبيئة المحلية
-- يُشغّل كآخر migration — يستخدم ADD COLUMN IF NOT EXISTS لتجنب التعارض
-- ═══════════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════
-- 1. أعمدة مفقودة في companies
-- ══════════════════════════════════════════
ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_type VARCHAR(50) DEFAULT 'general';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS company_type VARCHAR(20) DEFAULT 'production';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS name_ar VARCHAR(200);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS name_en VARCHAR(200);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS fiscal_year_start_month INTEGER DEFAULT 1;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS tax_system VARCHAR(50) DEFAULT 'vat_sa';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5,2) DEFAULT 15.00;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS inventory_valuation_method VARCHAR(50) DEFAULT 'weighted_average';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country_code VARCHAR(3) DEFAULT 'SA';
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

UPDATE companies SET name_ar = name WHERE name_ar IS NULL;
UPDATE companies SET name_en = name WHERE name_en IS NULL;

-- ══════════════════════════════════════════
-- 2. أعمدة مفقودة في user_profiles
-- ══════════════════════════════════════════
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS language_preference TEXT DEFAULT 'ar';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS theme_preference TEXT DEFAULT 'system';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'Asia/Riyadh';

-- ══════════════════════════════════════════
-- 3. أعمدة مفقودة في chart_of_accounts
-- ══════════════════════════════════════════
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS current_balance_fc DECIMAL(18,2) DEFAULT 0;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'USD';
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS name_ru TEXT;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS name_uk TEXT;
ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS name_tr TEXT;

-- ══════════════════════════════════════════
-- 4. company_accounting_settings — إنشاء + أعمدة مفقودة
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS company_accounting_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id),
    company_id UUID REFERENCES companies(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add all possibly-missing columns to the table (works whether table was just created or already existed)
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS supported_currencies JSONB DEFAULT '["USD"]'::jsonb;
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS base_currency VARCHAR(3) DEFAULT 'USD';
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS receipt_variance_policy TEXT DEFAULT 'bill_on_receipt';
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS inventory_valuation_method TEXT DEFAULT 'moving_average';
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS receipt_qty_tolerance_percent DECIMAL(5,2) DEFAULT 5.00;
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS receipt_price_tolerance_percent DECIMAL(5,2) DEFAULT 2.00;
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS allow_over_receipt BOOLEAN DEFAULT true;
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS auto_create_receipt_on_confirm BOOLEAN DEFAULT true;
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS require_receipt_before_post BOOLEAN DEFAULT true;
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS allow_partial_receipt BOOLEAN DEFAULT true;
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS require_approval_for_orders BOOLEAN DEFAULT true;
ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS approval_threshold_amount DECIMAL(18,2) DEFAULT 10000;

-- Add unique constraint if not exists
DO $$ BEGIN
  ALTER TABLE company_accounting_settings ADD CONSTRAINT unique_company_accounting_settings UNIQUE (tenant_id, company_id);
EXCEPTION WHEN duplicate_table THEN NULL;
         WHEN duplicate_object THEN NULL;
END $$;

-- Insert default row for every company that doesn't have one
INSERT INTO company_accounting_settings (tenant_id, company_id, base_currency, supported_currencies)
SELECT c.tenant_id, c.id, c.default_currency, jsonb_build_array(c.default_currency)
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM company_accounting_settings cas WHERE cas.company_id = c.id)
ON CONFLICT DO NOTHING;

-- ══════════════════════════════════════════
-- 5. أعمدة مفقودة في journal_entries / warehouses
-- ══════════════════════════════════════════
DO $$ BEGIN
  ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS description_ar TEXT;
  ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS is_posted BOOLEAN DEFAULT false;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS name_ar VARCHAR(200);
  ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS name_en VARCHAR(200);
  ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS warehouse_type VARCHAR(50) DEFAULT 'general';
  UPDATE warehouses SET name_ar = name WHERE name_ar IS NULL;
  UPDATE warehouses SET name_en = name WHERE name_en IS NULL;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ══════════════════════════════════════════
-- 6. get_user_companies function
-- ══════════════════════════════════════════
CREATE OR REPLACE FUNCTION get_user_companies(p_user_id UUID DEFAULT NULL)
RETURNS TABLE (
    id UUID, code VARCHAR, name VARCHAR, name_ar VARCHAR, name_en VARCHAR,
    business_type VARCHAR, company_type VARCHAR, is_active BOOLEAN, is_current BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id UUID; v_tenant_id UUID; v_current_company_id UUID;
BEGIN
    v_user_id := COALESCE(p_user_id, auth.uid());
    IF v_user_id IS NULL THEN RAISE EXCEPTION 'User ID is required'; END IF;

    SELECT up.tenant_id, up.company_id INTO v_tenant_id, v_current_company_id
    FROM user_profiles up WHERE up.id = v_user_id;

    IF v_tenant_id IS NULL THEN
        SELECT c.tenant_id INTO v_tenant_id FROM companies c WHERE c.id = v_current_company_id;
    END IF;

    RETURN QUERY
    SELECT c.id, c.code, c.name, c.name_ar, c.name_en, c.business_type, c.company_type, c.is_active,
           (c.id = v_current_company_id) AS is_current
    FROM companies c WHERE c.tenant_id = v_tenant_id
    ORDER BY c.company_type DESC, c.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_companies(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_companies(UUID) TO anon;

-- ══════════════════════════════════════════
-- 7. switch_user_company function
-- ══════════════════════════════════════════
CREATE OR REPLACE FUNCTION switch_user_company(p_user_id UUID, p_new_company_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_company_name VARCHAR;
BEGIN
    SELECT name INTO v_company_name FROM companies WHERE id = p_new_company_id;
    IF v_company_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Company not found');
    END IF;
    UPDATE user_profiles SET company_id = p_new_company_id, updated_at = NOW() WHERE id = p_user_id;
    RETURN jsonb_build_object('success', true, 'company_id', p_new_company_id, 'company_name', v_company_name);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION switch_user_company(UUID, UUID) TO authenticated;

-- ══════════════════════════════════════════
-- 8. refresh_company_insights (stub)
-- ══════════════════════════════════════════
CREATE OR REPLACE FUNCTION refresh_company_insights(p_company_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
AS $$ BEGIN RETURN jsonb_build_object('success', true, 'message', 'Insights refreshed'); END; $$;
GRANT EXECUTE ON FUNCTION refresh_company_insights(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_company_insights(UUID) TO anon;

-- ══════════════════════════════════════════
-- 9. get_ticker_kpis (stub)
-- ══════════════════════════════════════════
DO $$ BEGIN
  CREATE OR REPLACE FUNCTION get_ticker_kpis(p_tenant_id UUID DEFAULT NULL)
  RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
  AS $fn$ BEGIN RETURN '{}'::jsonb; END; $fn$;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION get_ticker_kpis(UUID) TO authenticated;
  GRANT EXECUTE ON FUNCTION get_ticker_kpis(UUID) TO anon;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ══════════════════════════════════════════
-- 10. setup_exchange_accounts (stub)
-- ══════════════════════════════════════════
DO $$ BEGIN
  CREATE OR REPLACE FUNCTION setup_exchange_accounts(p_company_id UUID DEFAULT NULL)
  RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
  AS $fn$ BEGIN RETURN jsonb_build_object('success', true); END; $fn$;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$ BEGIN
  GRANT EXECUTE ON FUNCTION setup_exchange_accounts(UUID) TO authenticated;
  GRANT EXECUTE ON FUNCTION setup_exchange_accounts(UUID) TO anon;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ══════════════════════════════════════════
-- 11. Stub tables for modules
-- ══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID, company_id UUID,
    employee_number VARCHAR(50), first_name VARCHAR(100), last_name VARCHAR(100),
    full_name VARCHAR(200), full_name_ar VARCHAR(200),
    email VARCHAR(200), phone VARCHAR(50), department_id UUID,
    position_title VARCHAR(200), hire_date DATE,
    employment_status VARCHAR(20) DEFAULT 'active', is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS full_name_ar VARCHAR(200);

CREATE TABLE IF NOT EXISTS employee_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID, employee_id UUID,
    contract_type VARCHAR(50) DEFAULT 'full_time',
    start_date DATE, end_date DATE, status VARCHAR(20) DEFAULT 'active',
    employee_number VARCHAR(50), created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS containers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID, company_id UUID,
    container_number VARCHAR(50), status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID, employee_id UUID, leave_type_id UUID,
    leave_type VARCHAR(50), status VARCHAR(20) DEFAULT 'pending',
    start_date DATE, end_date DATE, created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS leave_type_id UUID;

CREATE TABLE IF NOT EXISTS leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID, name_ar VARCHAR(100), name_en VARCHAR(100),
    color VARCHAR(20) DEFAULT '#3B82F6', created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID, employee_id UUID, attendance_date DATE,
    status VARCHAR(20) DEFAULT 'present', created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID, company_id UUID,
    settings JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exchange_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID, company_id UUID, name VARCHAR(200),
    status VARCHAR(20) DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID, company_id UUID, message TEXT,
    role VARCHAR(20) DEFAULT 'user', created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ══════════════════════════════════════════
-- 12. RLS — open for local mode
-- ══════════════════════════════════════════
DO $$ 
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'employees','employee_contracts','containers','leave_requests',
        'leave_types','attendance','exchange_settings','exchange_partners',
        'chat_messages','company_accounting_settings'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        BEGIN
            EXECUTE format('CREATE POLICY "%s_local_all" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t, t);
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
            EXECUTE format('CREATE POLICY "%s_anon_select" ON %I FOR SELECT TO anon USING (true)', t, t);
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END LOOP;
END $$;

-- ══════════════════════════════════════════
-- 13. RELOAD PostgREST schema cache
-- ══════════════════════════════════════════
NOTIFY pgrst, 'reload schema';

DO $$ BEGIN
    RAISE NOTICE '═══════════════════════════════════════════';
    RAISE NOTICE '✅ REPAIR MIGRATION v2 completed!';
    RAISE NOTICE '═══════════════════════════════════════════';
END $$;
