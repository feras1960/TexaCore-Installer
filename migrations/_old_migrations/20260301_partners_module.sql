-- ═══════════════════════════════════════════════════════════════════════════════
-- 🏢 شركاء حقوق الملكية (Equity Partners) — تبويب الشركاء في المحاسبة
-- تاريخ: 2026-03-01
-- ═══════════════════════════════════════════════════════════════════════════════
-- ملاحظة: نستخدم equity_partners (وليس partners) لأن جدول partners موجود 
-- مسبقاً لوكلاء البيع SaaS
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. جدول شركاء حقوق الملكية
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS equity_partners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    -- البيانات الأساسية
    partner_number VARCHAR(20) NOT NULL,
    name_ar VARCHAR(200) NOT NULL,
    name_en VARCHAR(200),
    phone VARCHAR(50),
    email VARCHAR(200),
    national_id VARCHAR(100),
    address TEXT,

    -- الحصة والنسبة
    share_percentage DECIMAL(5,2) NOT NULL DEFAULT 0 CHECK (share_percentage >= 0 AND share_percentage <= 100),
    capital_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    join_date DATE DEFAULT CURRENT_DATE,

    -- الراتب الوظيفي
    has_salary BOOLEAN DEFAULT false,
    monthly_salary DECIMAL(15,2) DEFAULT 0,
    salary_currency VARCHAR(3) DEFAULT 'USD',
    job_title VARCHAR(200),

    -- ربط الحسابات
    capital_account_id UUID REFERENCES chart_of_accounts(id),   -- 311-xxx
    current_account_id UUID REFERENCES chart_of_accounts(id),   -- 341-xxx
    salary_account_id UUID REFERENCES chart_of_accounts(id),    -- 213-xxx

    -- الحالة
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'withdrawn')),
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',

    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(tenant_id, company_id, partner_number)
);

-- ═══════════════════════════════════════════════════════════════
-- 2. جدول حركات شركاء حقوق الملكية
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS equity_partner_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    partner_id UUID NOT NULL REFERENCES equity_partners(id) ON DELETE CASCADE,

    transaction_type VARCHAR(30) NOT NULL CHECK (
        transaction_type IN ('capital_deposit', 'capital_withdrawal', 'withdrawal', 'deposit', 'profit_distribution', 'salary')
    ),
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'USD',
    description TEXT,
    journal_entry_id UUID REFERENCES journal_entries(id),

    transaction_date DATE DEFAULT CURRENT_DATE,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 3. جدول توزيعات الأرباح
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS equity_profit_distributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_profit DECIMAL(15,2) NOT NULL,

    journal_entry_id UUID REFERENCES journal_entries(id),

    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'posted', 'cancelled')),

    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS equity_profit_distribution_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    distribution_id UUID NOT NULL REFERENCES equity_profit_distributions(id) ON DELETE CASCADE,
    partner_id UUID NOT NULL REFERENCES equity_partners(id),

    share_percentage DECIMAL(5,2) NOT NULL,
    profit_amount DECIMAL(15,2) NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════
-- 4. الفهارس
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_equity_partners_tenant ON equity_partners(tenant_id);
CREATE INDEX IF NOT EXISTS idx_equity_partners_company ON equity_partners(company_id);
CREATE INDEX IF NOT EXISTS idx_equity_partners_status ON equity_partners(status);
CREATE INDEX IF NOT EXISTS idx_equity_partner_tx_partner ON equity_partner_transactions(partner_id);
CREATE INDEX IF NOT EXISTS idx_equity_partner_tx_type ON equity_partner_transactions(transaction_type);
CREATE INDEX IF NOT EXISTS idx_equity_partner_tx_date ON equity_partner_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_equity_profit_dist_company ON equity_profit_distributions(company_id);

-- ═══════════════════════════════════════════════════════════════
-- 5. RLS Policies (باستخدام الدوال المساعدة الموحدة)
-- ═══════════════════════════════════════════════════════════════

-- equity_partners (المجموعة د - شركة)
ALTER TABLE equity_partners ENABLE ROW LEVEL SECURITY;
SELECT create_company_rls_policies('equity_partners', true, true);
SELECT apply_auto_tenant_trigger('equity_partners');
SELECT apply_brand_isolation_trigger('equity_partners');

-- equity_partner_transactions (المجموعة د - شركة)
ALTER TABLE equity_partner_transactions ENABLE ROW LEVEL SECURITY;
SELECT create_company_rls_policies('equity_partner_transactions', true, true);
SELECT apply_auto_tenant_trigger('equity_partner_transactions');
SELECT apply_brand_isolation_trigger('equity_partner_transactions');

-- equity_profit_distributions (المجموعة د - شركة)
ALTER TABLE equity_profit_distributions ENABLE ROW LEVEL SECURITY;
SELECT create_company_rls_policies('equity_profit_distributions', true, true);
SELECT apply_auto_tenant_trigger('equity_profit_distributions');
SELECT apply_brand_isolation_trigger('equity_profit_distributions');

-- equity_profit_distribution_lines (المجموعة ج - تينانت)
ALTER TABLE equity_profit_distribution_lines ENABLE ROW LEVEL SECURITY;
SELECT create_company_rls_policies('equity_profit_distribution_lines', true, true);
SELECT apply_auto_tenant_trigger('equity_profit_distribution_lines');
SELECT apply_brand_isolation_trigger('equity_profit_distribution_lines');

-- ═══════════════════════════════════════════════════════════════
-- 6. Trigger: إنشاء حسابات تلقائية عند إضافة شريك
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_equity_partner_accounts()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_capital_parent_id UUID;
    v_current_parent_id UUID;
    v_salary_parent_id UUID;
    v_equity_type_id UUID;
    v_liability_type_id UUID;
    v_capital_acc_id UUID;
    v_current_acc_id UUID;
    v_salary_acc_id UUID;
    v_partner_count INT;
    v_partner_code VARCHAR(3);
    v_partner_number VARCHAR(20);
BEGIN
    -- الحصول على نوع حقوق الملكية
    SELECT id INTO v_equity_type_id FROM account_types WHERE code = 'EQUITY';
    SELECT id INTO v_liability_type_id FROM account_types WHERE code = 'LIABILITY';

    -- العدد الحالي للشركاء لتوليد الكود
    SELECT COUNT(*) + 1 INTO v_partner_count
    FROM equity_partners WHERE company_id = NEW.company_id;
    v_partner_code := LPAD(v_partner_count::TEXT, 3, '0');

    -- توليد رقم الشريك تلقائياً إذا لم يُحدد
    IF NEW.partner_number IS NULL OR TRIM(NEW.partner_number) = '' THEN
        v_partner_number := 'P-' || v_partner_code;
        NEW.partner_number := v_partner_number;
    ELSE
        v_partner_number := NEW.partner_number;
    END IF;

    -- البحث عن الحساب الأب 311 (حصص الشركاء)
    SELECT id INTO v_capital_parent_id
    FROM chart_of_accounts
    WHERE account_code = '311'
      AND company_id = NEW.company_id
      AND is_detail = false
    LIMIT 1;

    -- البحث عن الحساب الأب 341 (جاري الشركاء)
    SELECT id INTO v_current_parent_id
    FROM chart_of_accounts
    WHERE account_code = '341'
      AND company_id = NEW.company_id
      AND is_detail = false
    LIMIT 1;

    -- إنشاء حساب حصة رأس المال (311-xxx)
    IF v_capital_parent_id IS NOT NULL THEN
        INSERT INTO chart_of_accounts (
            tenant_id, company_id, account_code, name_ar, name_en,
            account_type_id, parent_id, is_detail, is_active,
            current_balance, opening_balance, currency
        ) VALUES (
            NEW.tenant_id, NEW.company_id,
            '311-' || v_partner_code,
            v_partner_number || ' | حصة ' || NEW.name_ar,
            v_partner_number || ' | Capital - ' || COALESCE(NEW.name_en, NEW.name_ar),
            v_equity_type_id, v_capital_parent_id, true, true,
            0, 0, 'USD'
        ) RETURNING id INTO v_capital_acc_id;
    END IF;

    -- إنشاء الحساب الجاري (341-xxx)
    IF v_current_parent_id IS NOT NULL THEN
        INSERT INTO chart_of_accounts (
            tenant_id, company_id, account_code, name_ar, name_en,
            account_type_id, parent_id, is_detail, is_active,
            current_balance, opening_balance, currency
        ) VALUES (
            NEW.tenant_id, NEW.company_id,
            '341-' || v_partner_code,
            v_partner_number || ' | جاري ' || NEW.name_ar,
            v_partner_number || ' | Current - ' || COALESCE(NEW.name_en, NEW.name_ar),
            v_equity_type_id, v_current_parent_id, true, true,
            0, 0, 'USD'
        ) RETURNING id INTO v_current_acc_id;
    END IF;

    -- إنشاء حساب المستحقات إذا كان يتقاضى راتب (213-xxx)
    IF NEW.has_salary THEN
        SELECT id INTO v_salary_parent_id
        FROM chart_of_accounts
        WHERE account_code = '213'
          AND company_id = NEW.company_id
        LIMIT 1;

        IF v_salary_parent_id IS NOT NULL THEN
            INSERT INTO chart_of_accounts (
                tenant_id, company_id, account_code, name_ar, name_en,
                account_type_id, parent_id, is_detail, is_active,
                current_balance, opening_balance, currency
            ) VALUES (
                NEW.tenant_id, NEW.company_id,
                '213-' || v_partner_code,
                v_partner_number || ' | مستحقات راتب ' || NEW.name_ar,
                v_partner_number || ' | Salary Payable - ' || COALESCE(NEW.name_en, NEW.name_ar),
                v_liability_type_id, v_salary_parent_id, true, true,
                0, 0, 'USD'
            ) RETURNING id INTO v_salary_acc_id;
        END IF;
    END IF;

    -- تحديث الشريك بمعرفات الحسابات
    NEW.capital_account_id := v_capital_acc_id;
    NEW.current_account_id := v_current_acc_id;
    NEW.salary_account_id := v_salary_acc_id;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_create_equity_partner_accounts
    BEFORE INSERT ON equity_partners
    FOR EACH ROW
    EXECUTE FUNCTION create_equity_partner_accounts();

-- ═══════════════════════════════════════════════════════════════
-- 7. Trigger: تحديث updated_at
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_equity_partners_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_equity_partners_updated_at
    BEFORE UPDATE ON equity_partners
    FOR EACH ROW
    EXECUTE FUNCTION update_equity_partners_timestamp();

-- ═══════════════════════════════════════════════════════════════
-- 8. تعليقات
-- ═══════════════════════════════════════════════════════════════

COMMENT ON TABLE equity_partners IS 'شركاء حقوق الملكية - إدارة حصص رأس المال والحسابات الجارية وتوزيع الأرباح';
COMMENT ON TABLE equity_partner_transactions IS 'حركات شركاء حقوق الملكية - تاريخ كامل للعمليات المالية';
COMMENT ON TABLE equity_profit_distributions IS 'توزيعات الأرباح - رأس التوزيع مع الفترة والقيد';
COMMENT ON TABLE equity_profit_distribution_lines IS 'تفاصيل التوزيع - حصة كل شريك';
COMMENT ON FUNCTION create_equity_partner_accounts IS 'إنشاء حسابات تلقائية (311-xxx, 341-xxx, 213-xxx) عند إضافة شريك حقوق ملكية';
