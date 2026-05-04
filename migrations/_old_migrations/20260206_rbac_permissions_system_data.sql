-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: نظام الصلاحيات والأدوار الشامل (مُحدّث)
-- Comprehensive RBAC System - UPDATED with Clear Hierarchy
-- Date: 2026-02-04
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 🔴 الهيكل الهرمي للأدوار - ROLE HIERARCHY
-- ═══════════════════════════════════════════════════════════════
-- 
-- المستوى 1: منصة SaaS (Platform Level)
-- ├── super_admin      → مدير المنصة الكامل (أنت) - يرى كل شيء
-- ├── support_senior   → دعم فني أول - يرى كل المستأجرين
-- └── support          → دعم فني عادي - قراءة محدودة
--
-- المستوى 2: المستأجر (Tenant Level)
-- └── tenant_admin     → مدير المستأجر - يدير كل شركات المستأجر
--
-- المستوى 3: الشركة (Company Level)
-- ├── company_owner    → مالك الشركة - كل الصلاحيات داخل الشركة
-- └── company_admin    → مدير الشركة - إدارة الشركة (بدون حذف)
--
-- المستوى 4: الفرع (Branch Level)
-- └── branch_manager   → مدير الفرع - يدير فرعه فقط
--
-- المستوى 5: العمليات (Operations Level)
-- ├── accountant       → محاسب
-- ├── cashier          → أمين صندوق
-- ├── warehouse_keeper → أمين مستودع
-- ├── sales_rep        → مندوب مبيعات
-- ├── purchaser        → مسؤول مشتريات
-- └── employee         → موظف عادي
--
-- المستوى الخاص:
-- └── auditor         → مدقق/مراجع (قراءة فقط + سجلات التعديل)
--
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- الجزء 1: أدوار مستوى المستأجر والشركة (Tenant & Company Roles)
-- ═══════════════════════════════════════════════════════════════

-- ⚠️ لا نُعدّل: super_admin, support, support_senior (موجودين مسبقاً للمنصة)

DELETE FROM roles WHERE code IN (
    'tenant_admin', 'company_owner', 'company_admin', 'branch_manager',
    'accountant', 'cashier', 'warehouse_keeper', 'sales_rep', 'purchaser', 'employee', 'auditor'
);

INSERT INTO roles (tenant_id, code, name_ar, name_en, is_system, permissions)
VALUES

-- ═══════════════════════════════════════════════════════════════
-- المستوى 2: مدير المستأجر
-- ═══════════════════════════════════════════════════════════════

(NULL, 'tenant_admin', 'مدير المستأجر', 'Tenant Admin', true, '{
    "level": "tenant",
    "scope": "all_companies",
    "companies": {"create": true, "read": true, "update": true, "delete": true},
    "users": {"create": true, "read": true, "update": true, "delete": true},
    "roles": {"create": true, "read": true, "update": true, "delete": false},
    "branches": {"create": true, "read": true, "update": true, "delete": true},
    "billing": {"read": true, "update": true},
    "modules": {"read": true, "update": true}
}'::jsonb),

-- ═══════════════════════════════════════════════════════════════
-- المستوى 3: أدوار الشركة
-- ═══════════════════════════════════════════════════════════════

(NULL, 'company_owner', 'مالك الشركة', 'Company Owner', true, '{
    "level": "company",
    "scope": "company",
    "all_in_company": true,
    "settings": true,
    "users": {"create": true, "read": true, "update": true, "delete": true},
    "roles": {"create": true, "read": true, "update": true},
    "branches": {"create": true, "read": true, "update": true, "delete": true},
    "accounting": {"all": true},
    "inventory": {"all": true},
    "sales": {"all": true},
    "purchases": {"all": true},
    "reports": {"all": true}
}'::jsonb),

(NULL, 'company_admin', 'مدير الشركة', 'Company Admin', true, '{
    "level": "company",
    "scope": "company",
    "settings": {"read": true, "update": true},
    "users": {"create": true, "read": true, "update": true, "delete": false},
    "roles": {"read": true},
    "branches": {"create": true, "read": true, "update": true, "delete": false},
    "accounting": {"all": true},
    "inventory": {"all": true},
    "sales": {"all": true},
    "purchases": {"all": true},
    "reports": {"all": true}
}'::jsonb),

-- ═══════════════════════════════════════════════════════════════
-- المستوى 4: مدير الفرع
-- ═══════════════════════════════════════════════════════════════

(NULL, 'branch_manager', 'مدير الفرع', 'Branch Manager', true, '{
    "level": "branch",
    "scope": "assigned_branches",
    "users": {"read": true},
    "branches": {"read": true, "update": true},
    "funds": {"read": true, "update": true, "scope": "branch"},
    "warehouses": {"read": true, "update": true, "scope": "branch"},
    "accounting": {"read": true, "create": true},
    "inventory": {"read": true, "create": true, "update": true},
    "sales": {"all": true, "scope": "branch"},
    "purchases": {"all": true, "scope": "branch"},
    "reports": {"read": true, "scope": "branch"}
}'::jsonb),

-- ═══════════════════════════════════════════════════════════════
-- المستوى 5: أدوار العمليات
-- ═══════════════════════════════════════════════════════════════

(NULL, 'accountant', 'محاسب', 'Accountant', true, '{
    "level": "operations",
    "scope": "company",
    "accounting": {"all": true},
    "journal_entries": {"create": true, "read": true, "update": true, "post": true, "unpost": true},
    "chart_of_accounts": {"read": true, "create": true, "update": true},
    "fiscal_years": {"read": true, "create": true},
    "accounting_periods": {"read": true, "create": true, "close": true},
    "funds": {"read": true, "transactions": true},
    "reports": {"financial": true, "ledger": true, "trial_balance": true},
    "inventory": {"read": true},
    "sales": {"read": true},
    "purchases": {"read": true}
}'::jsonb),

(NULL, 'cashier', 'أمين صندوق', 'Cashier', true, '{
    "level": "operations",
    "scope": "assigned_funds",
    "funds": {
        "read": true,
        "scope": "assigned",
        "transactions": {"create": true, "read": true}
    },
    "receipts": {"create": true, "read": true, "print": true},
    "payments": {"create": true, "read": true, "print": true},
    "sales": {"create": true, "read": true, "print": true},
    "reports": {"daily_cash": true, "my_transactions": true}
}'::jsonb),

(NULL, 'warehouse_keeper', 'أمين مستودع', 'Warehouse Keeper', true, '{
    "level": "operations",
    "scope": "assigned_warehouses",
    "warehouses": {
        "read": true,
        "scope": "assigned"
    },
    "inventory": {
        "read": true,
        "stock_count": true,
        "transfer": true,
        "receive": true,
        "issue": true,
        "scope": "assigned"
    },
    "materials": {"read": true, "update_stock": true},
    "stock_movements": {"create": true, "read": true},
    "reports": {"stock": true, "movements": true}
}'::jsonb),

(NULL, 'sales_rep', 'مندوب مبيعات', 'Sales Representative', true, '{
    "level": "operations",
    "scope": "own",
    "customers": {"create": true, "read": true, "update": true},
    "sales": {
        "create": true,
        "read": true,
        "scope": "own"
    },
    "quotations": {"create": true, "read": true, "update": true},
    "products": {"read": true},
    "inventory": {"read": true},
    "reports": {"my_sales": true}
}'::jsonb),

(NULL, 'purchaser', 'مسؤول مشتريات', 'Purchaser', true, '{
    "level": "operations",
    "scope": "company",
    "suppliers": {"create": true, "read": true, "update": true},
    "purchases": {"all": true},
    "purchase_orders": {"create": true, "read": true, "update": true, "approve": false},
    "products": {"read": true},
    "inventory": {"read": true},
    "reports": {"purchases": true}
}'::jsonb),

(NULL, 'employee', 'موظف', 'Employee', true, '{
    "level": "operations",
    "scope": "own",
    "read_only": true,
    "sales": {"read": true, "scope": "own"},
    "inventory": {"read": true},
    "reports": {"read": true, "scope": "own"}
}'::jsonb),

-- ═══════════════════════════════════════════════════════════════
-- دور خاص: المدقق
-- ═══════════════════════════════════════════════════════════════

(NULL, 'auditor', 'مدقق', 'Auditor', true, '{
    "level": "special",
    "scope": "company",
    "read_only": true,
    "accounting": {"read": true},
    "journal_entries": {"read": true},
    "chart_of_accounts": {"read": true},
    "audit_logs": {"read": true},
    "reports": {"all": true},
    "document_edit_history": {"read": true}
}'::jsonb);

-- ═══════════════════════════════════════════════════════════════
-- الجزء 2: ربط المستخدمين بالصناديق والمستودعات
-- ═══════════════════════════════════════════════════════════════

-- جدول صلاحيات المستخدم على الصناديق
CREATE TABLE IF NOT EXISTS user_fund_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    fund_account_id UUID NOT NULL REFERENCES chart_of_accounts(id) ON DELETE CASCADE,
    
    -- الصلاحيات
    can_view BOOLEAN DEFAULT true,
    can_deposit BOOLEAN DEFAULT false,
    can_withdraw BOOLEAN DEFAULT false,
    can_transfer BOOLEAN DEFAULT false,
    can_close BOOLEAN DEFAULT false,
    
    -- الحدود
    daily_limit DECIMAL(18,2),
    transaction_limit DECIMAL(18,2),
    
    -- البيانات
    is_primary BOOLEAN DEFAULT false,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID REFERENCES auth.users(id),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, fund_account_id)
);

-- جدول صلاحيات المستخدم على المستودعات
CREATE TABLE IF NOT EXISTS user_warehouse_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    
    -- الصلاحيات
    can_view BOOLEAN DEFAULT true,
    can_receive BOOLEAN DEFAULT false,
    can_issue BOOLEAN DEFAULT false,
    can_transfer BOOLEAN DEFAULT false,
    can_count BOOLEAN DEFAULT false,
    can_adjust BOOLEAN DEFAULT false,
    
    is_keeper BOOLEAN DEFAULT false,
    
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID REFERENCES auth.users(id),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, warehouse_id)
);

-- جدول صلاحيات المستخدم على الفروع
CREATE TABLE IF NOT EXISTS user_branch_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    
    can_access BOOLEAN DEFAULT true,
    can_manage BOOLEAN DEFAULT false,
    is_primary BOOLEAN DEFAULT false,
    
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    assigned_by UUID REFERENCES auth.users(id),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, branch_id)
);

-- ═══════════════════════════════════════════════════════════════
-- الجزء 3: الفهارس و RLS
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_user_fund_perms_user ON user_fund_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_fund_perms_fund ON user_fund_permissions(fund_account_id);
CREATE INDEX IF NOT EXISTS idx_user_fund_perms_tenant ON user_fund_permissions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_user_warehouse_perms_user ON user_warehouse_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_warehouse_perms_warehouse ON user_warehouse_permissions(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_user_warehouse_perms_tenant ON user_warehouse_permissions(tenant_id);

CREATE INDEX IF NOT EXISTS idx_user_branch_perms_user ON user_branch_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_branch_perms_branch ON user_branch_permissions(branch_id);

-- RLS
ALTER TABLE user_fund_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_warehouse_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_branch_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_fund_perms_tenant ON user_fund_permissions;
CREATE POLICY user_fund_perms_tenant ON user_fund_permissions
    FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin(auth.uid()));

DROP POLICY IF EXISTS user_warehouse_perms_tenant ON user_warehouse_permissions;
CREATE POLICY user_warehouse_perms_tenant ON user_warehouse_permissions
    FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin(auth.uid()));

DROP POLICY IF EXISTS user_branch_perms_tenant ON user_branch_permissions;
CREATE POLICY user_branch_perms_tenant ON user_branch_permissions
    FOR ALL USING (tenant_id = get_current_tenant_id() OR is_super_admin(auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- الجزء 4: الدوال المساعدة
-- ═══════════════════════════════════════════════════════════════

-- التحقق من مستوى الدور
CREATE OR REPLACE FUNCTION get_user_role_level(
    p_user_id UUID DEFAULT auth.uid()
)
RETURNS TEXT AS $$
DECLARE
    v_level TEXT;
BEGIN
    -- التحقق من super_admin أولاً
    IF is_super_admin(p_user_id) THEN
        RETURN 'platform';
    END IF;
    
    -- الحصول على أعلى مستوى
    SELECT COALESCE(
        (r.permissions->>'level')::TEXT,
        'operations'
    ) INTO v_level
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true
    ORDER BY 
        CASE (r.permissions->>'level')::TEXT
            WHEN 'tenant' THEN 1
            WHEN 'company' THEN 2
            WHEN 'branch' THEN 3
            WHEN 'operations' THEN 4
            ELSE 5
        END
    LIMIT 1;
    
    RETURN COALESCE(v_level, 'none');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- التحقق من أن المستخدم tenant_admin
CREATE OR REPLACE FUNCTION is_tenant_admin(
    p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN AS $$
BEGIN
    IF is_super_admin(p_user_id) THEN
        RETURN true;
    END IF;
    
    RETURN EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
          AND r.code = 'tenant_admin'
          AND ur.is_active = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- التحقق من أن المستخدم company_owner أو company_admin
CREATE OR REPLACE FUNCTION is_company_admin(
    p_user_id UUID DEFAULT auth.uid(),
    p_company_id UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    IF is_super_admin(p_user_id) OR is_tenant_admin(p_user_id) THEN
        RETURN true;
    END IF;
    
    RETURN EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
          AND r.code IN ('company_owner', 'company_admin')
          AND ur.is_active = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- التحقق من صلاحية الوصول للصندوق
CREATE OR REPLACE FUNCTION can_access_fund(
    p_fund_account_id UUID,
    p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Platform & Tenant admins see all
    IF is_super_admin(p_user_id) OR is_tenant_admin(p_user_id) THEN
        RETURN true;
    END IF;
    
    -- Company admins see all company funds
    IF is_company_admin(p_user_id) THEN
        RETURN true;
    END IF;
    
    -- Check direct permission
    RETURN EXISTS (
        SELECT 1 FROM user_fund_permissions
        WHERE user_id = p_user_id
          AND fund_account_id = p_fund_account_id
          AND can_view = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- التحقق من صلاحية الوصول للمستودع
CREATE OR REPLACE FUNCTION can_access_warehouse(
    p_warehouse_id UUID,
    p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN AS $$
BEGIN
    IF is_super_admin(p_user_id) OR is_tenant_admin(p_user_id) THEN
        RETURN true;
    END IF;
    
    IF is_company_admin(p_user_id) THEN
        RETURN true;
    END IF;
    
    RETURN EXISTS (
        SELECT 1 FROM user_warehouse_permissions
        WHERE user_id = p_user_id
          AND warehouse_id = p_warehouse_id
          AND can_view = true
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- الحصول على الصناديق المتاحة للمستخدم
CREATE OR REPLACE FUNCTION get_user_accessible_funds(
    p_user_id UUID DEFAULT auth.uid()
)
RETURNS TABLE (
    fund_account_id UUID,
    can_deposit BOOLEAN,
    can_withdraw BOOLEAN,
    can_transfer BOOLEAN,
    is_primary BOOLEAN
) AS $$
BEGIN
    -- Platform/Tenant/Company admins see all
    IF is_super_admin(p_user_id) OR is_tenant_admin(p_user_id) OR is_company_admin(p_user_id) THEN
        RETURN QUERY
        SELECT coa.id, true, true, true, false
        FROM chart_of_accounts coa
        WHERE coa.account_type IN ('cash', 'bank')
          AND coa.is_active = true
          AND coa.tenant_id = get_current_tenant_id();
        RETURN;
    END IF;
    
    -- Regular users - assigned funds only
    RETURN QUERY
    SELECT 
        ufp.fund_account_id,
        ufp.can_deposit,
        ufp.can_withdraw,
        ufp.can_transfer,
        ufp.is_primary
    FROM user_fund_permissions ufp
    WHERE ufp.user_id = p_user_id
      AND ufp.can_view = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- الحصول على المستودعات المتاحة للمستخدم
CREATE OR REPLACE FUNCTION get_user_accessible_warehouses(
    p_user_id UUID DEFAULT auth.uid()
)
RETURNS TABLE (
    warehouse_id UUID,
    can_receive BOOLEAN,
    can_issue BOOLEAN,
    can_transfer BOOLEAN,
    can_count BOOLEAN,
    is_keeper BOOLEAN
) AS $$
BEGIN
    IF is_super_admin(p_user_id) OR is_tenant_admin(p_user_id) OR is_company_admin(p_user_id) THEN
        RETURN QUERY
        SELECT w.id, true, true, true, true, false
        FROM warehouses w
        WHERE w.is_active = true
          AND w.tenant_id = get_current_tenant_id();
        RETURN;
    END IF;
    
    RETURN QUERY
    SELECT 
        uwp.warehouse_id,
        uwp.can_receive,
        uwp.can_issue,
        uwp.can_transfer,
        uwp.can_count,
        uwp.is_keeper
    FROM user_warehouse_permissions uwp
    WHERE uwp.user_id = p_user_id
      AND uwp.can_view = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- الحصول على صلاحيات المستخدم الكاملة
CREATE OR REPLACE FUNCTION get_user_full_permissions(
    p_user_id UUID DEFAULT auth.uid()
)
RETURNS JSONB AS $$
DECLARE
    v_result JSONB;
    v_roles JSONB;
    v_funds JSONB;
    v_warehouses JSONB;
    v_branches JSONB;
    v_level TEXT;
BEGIN
    -- Get role level
    v_level := get_user_role_level(p_user_id);
    
    -- Get roles
    SELECT jsonb_agg(jsonb_build_object(
        'role_code', r.code,
        'role_name', r.name_ar,
        'level', COALESCE(r.permissions->>'level', 'operations'),
        'permissions', r.permissions
    ))
    INTO v_roles
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true;
    
    -- Get funds (only for non-admins)
    IF v_level NOT IN ('platform', 'tenant', 'company') THEN
        SELECT jsonb_agg(jsonb_build_object(
            'fund_id', ufp.fund_account_id,
            'can_deposit', ufp.can_deposit,
            'can_withdraw', ufp.can_withdraw,
            'is_primary', ufp.is_primary
        ))
        INTO v_funds
        FROM user_fund_permissions ufp
        WHERE ufp.user_id = p_user_id AND ufp.can_view = true;
    ELSE
        v_funds := '"all"'::jsonb;
    END IF;
    
    -- Get warehouses
    IF v_level NOT IN ('platform', 'tenant', 'company') THEN
        SELECT jsonb_agg(jsonb_build_object(
            'warehouse_id', uwp.warehouse_id,
            'is_keeper', uwp.is_keeper,
            'can_receive', uwp.can_receive,
            'can_issue', uwp.can_issue
        ))
        INTO v_warehouses
        FROM user_warehouse_permissions uwp
        WHERE uwp.user_id = p_user_id AND uwp.can_view = true;
    ELSE
        v_warehouses := '"all"'::jsonb;
    END IF;
    
    -- Get branches
    IF v_level NOT IN ('platform', 'tenant', 'company') THEN
        SELECT jsonb_agg(jsonb_build_object(
            'branch_id', ubp.branch_id,
            'is_primary', ubp.is_primary,
            'can_manage', ubp.can_manage
        ))
        INTO v_branches
        FROM user_branch_permissions ubp
        WHERE ubp.user_id = p_user_id AND ubp.can_access = true;
    ELSE
        v_branches := '"all"'::jsonb;
    END IF;
    
    -- Build result
    v_result := jsonb_build_object(
        'user_id', p_user_id,
        'is_super_admin', is_super_admin(p_user_id),
        'is_tenant_admin', is_tenant_admin(p_user_id),
        'is_company_admin', is_company_admin(p_user_id),
        'level', v_level,
        'roles', COALESCE(v_roles, '[]'::jsonb),
        'funds', COALESCE(v_funds, '[]'::jsonb),
        'warehouses', COALESCE(v_warehouses, '[]'::jsonb),
        'branches', COALESCE(v_branches, '[]'::jsonb)
    );
    
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ═══════════════════════════════════════════════════════════════
-- ✅ MIGRATION COMPLETED
-- ═══════════════════════════════════════════════════════════════
--
-- الهيكل الهرمي:
-- super_admin (منصة) → لا يتغير، أنت فقط
-- tenant_admin (مستأجر) → يدير كل شركات المستأجر
-- company_owner (شركة) → مالك الشركة
-- company_admin (شركة) → مدير الشركة
-- branch_manager (فرع) → مدير الفرع
-- accountant, cashier, etc. (عمليات) → أدوار تشغيلية
--
