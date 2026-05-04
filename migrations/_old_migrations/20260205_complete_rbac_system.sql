-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Complete RBAC System Setup
-- Date: 2026-02-05
-- Purpose: Create comprehensive Role-Based Access Control system
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. Drop existing tables if they exist (for clean setup)
-- ═══════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS user_resource_access CASCADE;
DROP TABLE IF EXISTS visibility_rules CASCADE;
DROP TABLE IF EXISTS role_delegations CASCADE;
DROP TABLE IF EXISTS role_modules CASCADE;
DROP TABLE IF EXISTS user_roles CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS brands CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 2. Create brands table (for multi-brand support)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    description TEXT,
    logo_url TEXT,
    primary_color VARCHAR(20) DEFAULT '#1a365d',
    secondary_color VARCHAR(20) DEFAULT '#38b2ac',
    available_modules TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- Example: ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'inventory']
    is_active BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 100,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default brands
INSERT INTO brands (code, name_ar, name_en, description, primary_color, secondary_color, available_modules, display_order) VALUES
('texacore', 'تيكسا كور', 'TexaCore', 'نظام ERP عام شامل', '#1a365d', '#38b2ac', 
 ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 'crm', 'pos', 'manufacturing', 'hr', 'shipments', 'reports', 'settings'], 1),

('fincore', 'فين كور', 'FinCore', 'نظام مالي ومحاسبي متقدم', '#2d3748', '#4299e1',
 ARRAY['dashboard', 'accounting', 'treasury', 'finance', 'exchange', 'reports', 'settings'], 2),

('texafabric', 'تيكسا فابريك', 'TexaFabric', 'نظام إدارة الأقمشة والنسيج', '#4a5568', '#48bb78',
 ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 'fabric', 'shipments', 'manufacturing', 'crm', 'reports', 'settings'], 3),

('texapharma', 'تيكسا فارما', 'TexaPharma', 'نظام إدارة الصيدليات', '#553c9a', '#ed64a6',
 ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'pharmacy', 'crm', 'pos', 'reports', 'settings'], 4),

('texahealth', 'تيكسا هيلث', 'TexaHealth', 'نظام إدارة المشافي والعيادات', '#2c5282', '#4fd1c5',
 ARRAY['dashboard', 'accounting', 'treasury', 'healthcare', 'doctors', 'crm', 'reports', 'settings'], 5),

('texagold', 'تيكسا جولد', 'TexaGold', 'نظام إدارة الذهب والمجوهرات', '#744210', '#d69e2e',
 ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'gold', 'exchange', 'crm', 'pos', 'manufacturing', 'reports', 'settings'], 6),

('texafood', 'تيكسا فود', 'TexaFood', 'نظام إدارة المطاعم والمقاهي', '#c53030', '#f56565',
 ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'inventory', 'restaurant', 'crm', 'pos', 'reports', 'settings'], 7),

('texareal', 'تيكسا ريل', 'TexaReal', 'نظام إدارة العقارات', '#2b6cb0', '#63b3ed',
 ARRAY['dashboard', 'accounting', 'treasury', 'real_estate', 'crm', 'reports', 'settings'], 8);

-- Add brand_id to companies table if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'brand_id') THEN
        ALTER TABLE companies ADD COLUMN brand_id UUID REFERENCES brands(id);
    END IF;
END $$;

-- Set default brand for existing companies
UPDATE companies SET brand_id = (SELECT id FROM brands WHERE code = 'texacore') WHERE brand_id IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- 3. Create roles table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    name_ar VARCHAR(100) NOT NULL,
    name_en VARCHAR(100),
    description TEXT,
    level VARCHAR(20) NOT NULL DEFAULT 'operations'
        CHECK (level IN ('system', 'tenant', 'company', 'branch', 'operations', 'custom')),
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Example: {"accounting": ["read", "write"], "sales": ["read", "write", "delete"]}
    visible_modules TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- Modules this role can see in sidebar: ARRAY['dashboard', 'accounting', 'sales']
    is_system BOOLEAN DEFAULT false,
    is_custom BOOLEAN DEFAULT false,
    can_be_deleted BOOLEAN DEFAULT true,
    display_order INTEGER DEFAULT 100,
    icon VARCHAR(50),
    color VARCHAR(20),
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint (allowing NULL tenant_id for system roles)
CREATE UNIQUE INDEX idx_roles_unique_code ON roles(
    COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::UUID),
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::UUID),
    code
);

-- ═══════════════════════════════════════════════════════════════
-- 3. Create user_roles table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES auth.users(id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_user_roles_unique ON user_roles(user_id, role_id, COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::UUID));

-- ═══════════════════════════════════════════════════════════════
-- 4. Create role_delegations table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE role_delegations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    delegator_role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    delegatee_role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    can_create_roles BOOLEAN DEFAULT false,
    can_manage_users BOOLEAN DEFAULT false,
    can_assign_roles BOOLEAN DEFAULT false,
    can_remove_roles BOOLEAN DEFAULT false,
    max_delegable_level VARCHAR(20) DEFAULT 'operations'
        CHECK (max_delegable_level IN ('branch', 'operations', 'custom')),
    restrictions JSONB DEFAULT '{}'::jsonb,
    -- Example: {"excluded_modules": ["settings"], "max_users": 10}
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(delegator_role_id, delegatee_role_id)
);

-- ═══════════════════════════════════════════════════════════════
-- 5. Create visibility_rules table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE visibility_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    rule_type VARCHAR(20) NOT NULL
        CHECK (rule_type IN ('page', 'field', 'module', 'report', 'action')),
    target_type VARCHAR(50) NOT NULL,
    -- For pages: 'profit_loss_report', 'supplier_list'
    -- For fields: 'products', 'sales_invoices'
    -- For modules: 'suppliers', 'reports'
    target_name VARCHAR(100) NOT NULL,
    -- For fields: 'cost_price', 'profit_margin'
    -- For pages/modules: descriptive name
    visible_to_roles UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    hidden_from_roles UUID[] DEFAULT ARRAY[]::UUID[],
    mask_value VARCHAR(100),
    -- Replacement value when hidden: '***', 'مخفي', etc.
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    -- Higher priority rules override lower ones
    description TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, company_id, rule_type, target_type, target_name)
);

-- ═══════════════════════════════════════════════════════════════
-- 6. Create user_resource_access table
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE user_resource_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    resource_type VARCHAR(30) NOT NULL
        CHECK (resource_type IN ('branch', 'warehouse', 'cash_account', 'bank_account', 'cost_center')),
    resource_id UUID NOT NULL,
    permissions JSONB DEFAULT '{"read": true}'::jsonb,
    -- Example: {"read": true, "write": true, "delete": false, "manage": false}
    is_primary BOOLEAN DEFAULT false,
    -- Is this the user's primary resource (e.g., main branch)
    assigned_by UUID REFERENCES auth.users(id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, resource_type, resource_id)
);

-- ═══════════════════════════════════════════════════════════════
-- 7. Create indexes for performance
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX idx_roles_tenant ON roles(tenant_id);
CREATE INDEX idx_roles_company ON roles(company_id);
CREATE INDEX idx_roles_level ON roles(level);
CREATE INDEX idx_roles_is_system ON roles(is_system);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);
CREATE INDEX idx_user_roles_tenant ON user_roles(tenant_id);
CREATE INDEX idx_user_roles_company ON user_roles(company_id);
CREATE INDEX idx_user_roles_active ON user_roles(is_active) WHERE is_active = true;

CREATE INDEX idx_visibility_rules_tenant ON visibility_rules(tenant_id);
CREATE INDEX idx_visibility_rules_company ON visibility_rules(company_id);
CREATE INDEX idx_visibility_rules_type ON visibility_rules(rule_type);
CREATE INDEX idx_visibility_rules_active ON visibility_rules(is_active) WHERE is_active = true;

CREATE INDEX idx_user_resource_access_user ON user_resource_access(user_id);
CREATE INDEX idx_user_resource_access_type ON user_resource_access(resource_type);
CREATE INDEX idx_user_resource_access_resource ON user_resource_access(resource_id);

-- ═══════════════════════════════════════════════════════════════
-- 9. Insert default system roles with visible_modules
-- ═══════════════════════════════════════════════════════════════

-- ⚠️ PLATFORM ADMIN ONLY - لا يظهر للعملاء
-- هذا الدور للمنصة فقط (أنت كمالك المنصة)
-- لا يتم إنشاؤه للتينانتس - يُنشأ مرة واحدة فقط على مستوى النظام
INSERT INTO roles (code, name_ar, name_en, level, is_system, can_be_deleted, display_order, icon, color, description, permissions, visible_modules)
VALUES (
    'super_admin',
    'مدير المنصة',
    'Platform Admin',
    'system',
    true,
    false,
    0,
    'ShieldCheck',
    'red',
    'Platform administrator - not visible to tenants. Full system access.',
    '{"all": true}'::jsonb,
    ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 'fabric', 'pharmacy', 'healthcare', 'doctors', 'restaurant', 'gold', 'shipments', 'crm', 'pos', 'real_estate', 'exchange', 'manufacturing', 'hr', 'e-commerce', 'saas', 'ai_analytics', 'activity_log', 'component_lab', 'system_config']
);


-- ═══════════════════════════════════════════════════════════════
-- 🟠 TENANT OWNER - أعلى دور متاح للعملاء
-- يُنشأ لكل تينانت جديد - يرى جميع الموديولات المتاحة للتينانت
-- ═══════════════════════════════════════════════════════════════
INSERT INTO roles (code, name_ar, name_en, level, is_system, can_be_deleted, display_order, icon, color, description, permissions, visible_modules)
VALUES (
    'tenant_owner',
    'مالك المستأجر',
    'Tenant Owner',
    'tenant',
    true,
    false,
    10,
    'Crown',
    'purple',
    'Highest customer role - full access within tenant scope. Manages all companies and users.',
    '{
        "accounting": ["read", "write", "delete"],
        "finance": ["read", "write", "delete"],
        "treasury": ["read", "write", "delete"],
        "sales": ["read", "write", "delete"],
        "purchases": ["read", "write", "delete"],
        "inventory": ["read", "write", "delete"],
        "warehouse": ["read", "write", "delete"],
        "customers": ["read", "write", "delete"],
        "suppliers": ["read", "write", "delete"],
        "employees": ["read", "write", "delete"],
        "reports": ["read", "write", "delete"],
        "settings": ["read", "write", "delete"],
        "permissions": ["read", "write", "delete"]
    }'::jsonb,
    ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 'crm', 'pos', 'manufacturing', 'hr', 'shipments', 'activity_log', 'system_config']
);

-- Insert tenant-specific roles for each existing tenant
-- Company Admin - sees most modules
INSERT INTO roles (tenant_id, code, name_ar, name_en, level, is_system, can_be_deleted, display_order, icon, color, permissions, visible_modules)
SELECT 
    t.id,
    'company_admin',
    'مدير الشركة',
    'Company Admin',
    'company',
    true,
    false,
    20,
    'Building2',
    'blue',
    '{
        "accounting": ["read", "write", "delete"],
        "finance": ["read", "write"],
        "treasury": ["read", "write", "delete"],
        "sales": ["read", "write", "delete"],
        "purchases": ["read", "write", "delete"],
        "inventory": ["read", "write", "delete"],
        "warehouse": ["read", "write", "delete"],
        "customers": ["read", "write", "delete"],
        "suppliers": ["read", "write", "delete"],
        "employees": ["read", "write", "delete"],
        "reports": ["read", "write"],
        "settings": ["read", "write"],
        "permissions": ["read", "write"]
    }'::jsonb,
    ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 'crm', 'pos', 'manufacturing', 'hr', 'shipments', 'system_config']
FROM tenants t;

-- Branch Manager - sees operational modules for their branch
INSERT INTO roles (tenant_id, code, name_ar, name_en, level, is_system, can_be_deleted, display_order, icon, color, permissions, visible_modules)
SELECT 
    t.id,
    'branch_manager',
    'مدير الفرع',
    'Branch Manager',
    'branch',
    true,
    false,
    30,
    'Store',
    'green',
    '{
        "accounting": ["read", "write"],
        "treasury": ["read", "write"],
        "sales": ["read", "write", "delete"],
        "purchases": ["read", "write"],
        "inventory": ["read", "write"],
        "warehouse": ["read", "write"],
        "customers": ["read", "write", "delete"],
        "suppliers": ["read"],
        "reports": ["read"]
    }'::jsonb,
    ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 'crm', 'pos']
FROM tenants t;

-- Accountant - sees financial modules only
INSERT INTO roles (tenant_id, code, name_ar, name_en, level, is_system, can_be_deleted, display_order, icon, color, permissions, visible_modules)
SELECT 
    t.id,
    'accountant',
    'محاسب',
    'Accountant',
    'operations',
    true,
    false,
    40,
    'Calculator',
    'amber',
    '{
        "accounting": ["read", "write", "delete"],
        "finance": ["read"],
        "treasury": ["read", "write"],
        "sales": ["read"],
        "purchases": ["read", "write"],
        "inventory": ["read"],
        "suppliers": ["read"],
        "reports": ["read"]
    }'::jsonb,
    ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory']
FROM tenants t;

-- Cashier - sees treasury and sales only
INSERT INTO roles (tenant_id, code, name_ar, name_en, level, is_system, can_be_deleted, display_order, icon, color, permissions, visible_modules)
SELECT 
    t.id,
    'cashier',
    'أمين صندوق',
    'Cashier',
    'operations',
    true,
    false,
    50,
    'Wallet',
    'cyan',
    '{
        "treasury": ["read", "write", "delete"],
        "sales": ["read", "write"],
        "reports": ["read"]
    }'::jsonb,
    ARRAY['dashboard', 'treasury', 'sales', 'pos']
FROM tenants t;

-- Warehouse Manager - sees inventory and warehouse modules
INSERT INTO roles (tenant_id, code, name_ar, name_en, level, is_system, can_be_deleted, display_order, icon, color, permissions, visible_modules)
SELECT 
    t.id,
    'warehouse_manager',
    'مدير مستودع',
    'Warehouse Manager',
    'operations',
    true,
    false,
    60,
    'Warehouse',
    'orange',
    '{
        "inventory": ["read", "write", "delete"],
        "warehouse": ["read", "write", "delete"],
        "sales": ["read"],
        "purchases": ["read"],
        "reports": ["read"]
    }'::jsonb,
    ARRAY['dashboard', 'inventory', 'warehouse', 'manufacturing']
FROM tenants t;

-- Sales Representative - sees sales and customer modules
INSERT INTO roles (tenant_id, code, name_ar, name_en, level, is_system, can_be_deleted, display_order, icon, color, permissions, visible_modules)
SELECT 
    t.id,
    'sales_rep',
    'مندوب مبيعات',
    'Sales Representative',
    'operations',
    true,
    false,
    70,
    'UserCircle',
    'pink',
    '{
        "sales": ["read", "write", "delete"],
        "customers": ["read", "write"],
        "inventory": ["read"],
        "treasury": ["read"],
        "reports": ["read"]
    }'::jsonb,
    ARRAY['dashboard', 'sales', 'crm', 'pos', 'inventory']
FROM tenants t;

-- Purchasing Manager - sees purchasing and supplier modules
INSERT INTO roles (tenant_id, code, name_ar, name_en, level, is_system, can_be_deleted, display_order, icon, color, permissions, visible_modules)
SELECT 
    t.id,
    'purchasing_manager',
    'مسؤول المشتريات',
    'Purchasing Manager',
    'operations',
    true,
    false,
    75,
    'ShoppingCart',
    'lime',
    '{
        "purchases": ["read", "write", "delete"],
        "suppliers": ["read", "write", "delete"],
        "inventory": ["read"],
        "reports": ["read"]
    }'::jsonb,
    ARRAY['dashboard', 'purchases', 'inventory', 'shipments']
FROM tenants t;

-- Viewer - read-only access to basic modules
INSERT INTO roles (tenant_id, code, name_ar, name_en, level, is_system, can_be_deleted, display_order, icon, color, permissions, visible_modules)
SELECT 
    t.id,
    'viewer',
    'مشاهد فقط',
    'Viewer',
    'custom',
    true,
    false,
    100,
    'Eye',
    'gray',
    '{
        "accounting": ["read"],
        "treasury": ["read"],
        "sales": ["read"],
        "purchases": ["read"],
        "inventory": ["read"],
        "customers": ["read"],
        "reports": ["read"]
    }'::jsonb,
    ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'crm']
FROM tenants t;

-- ═══════════════════════════════════════════════════════════════
-- 9. Insert default visibility rules
-- ═══════════════════════════════════════════════════════════════

-- Get tenant owner role IDs for visibility rules
DO $$
DECLARE
    v_tenant_id UUID;
    v_tenant_owner_id UUID;
    v_company_admin_id UUID;
    v_accountant_id UUID;
BEGIN
    FOR v_tenant_id IN SELECT id FROM tenants LOOP
        -- Get role IDs for this tenant
        SELECT id INTO v_tenant_owner_id FROM roles WHERE code = 'tenant_owner' AND tenant_id IS NULL;
        SELECT id INTO v_company_admin_id FROM roles WHERE code = 'company_admin' AND tenant_id = v_tenant_id;
        SELECT id INTO v_accountant_id FROM roles WHERE code = 'accountant' AND tenant_id = v_tenant_id;
        
        -- Profit & Loss Report (owner only)
        INSERT INTO visibility_rules (tenant_id, rule_type, target_type, target_name, visible_to_roles, description)
        VALUES (v_tenant_id, 'report', 'financial', 'profit_loss_report', ARRAY[v_tenant_owner_id], 'تقرير الأرباح والخسائر - للمالك فقط')
        ON CONFLICT DO NOTHING;
        
        -- Profit Margins (owner and company admin)
        INSERT INTO visibility_rules (tenant_id, rule_type, target_type, target_name, visible_to_roles, mask_value, description)
        VALUES (v_tenant_id, 'field', 'sales_invoices', 'profit_margin', ARRAY[v_tenant_owner_id, v_company_admin_id], '***', 'هامش الربح على الفواتير')
        ON CONFLICT DO NOTHING;
        
        -- Product Cost Price (owner, admin, accountant)
        INSERT INTO visibility_rules (tenant_id, rule_type, target_type, target_name, visible_to_roles, mask_value, description)
        VALUES (v_tenant_id, 'field', 'products', 'cost_price', ARRAY[v_tenant_owner_id, v_company_admin_id, v_accountant_id], '***', 'سعر تكلفة المنتجات')
        ON CONFLICT DO NOTHING;
        
        -- Suppliers Module (owner, admin, accountant, purchasing)
        INSERT INTO visibility_rules (tenant_id, rule_type, target_type, target_name, visible_to_roles, description)
        SELECT v_tenant_id, 'module', 'navigation', 'suppliers', 
               ARRAY[v_tenant_owner_id, v_company_admin_id, v_accountant_id, r.id], 
               'قسم الموردين - مخفي عن المستودعات والمبيعات'
        FROM roles r WHERE r.code = 'purchasing_manager' AND r.tenant_id = v_tenant_id
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 10. Create helper functions
-- ═══════════════════════════════════════════════════════════════

-- Function to check if user has permission
CREATE OR REPLACE FUNCTION check_user_permission(
    p_user_id UUID,
    p_module VARCHAR(50),
    p_permission VARCHAR(20)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_has_permission BOOLEAN := false;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
          AND ur.is_active = true
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
          AND (
              r.permissions->>'all' = 'true'
              OR p_permission = ANY(SELECT jsonb_array_elements_text(r.permissions->p_module))
          )
    ) INTO v_has_permission;
    
    RETURN v_has_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user can access resource
CREATE OR REPLACE FUNCTION check_user_resource_access(
    p_user_id UUID,
    p_resource_type VARCHAR(30),
    p_resource_id UUID,
    p_permission VARCHAR(20) DEFAULT 'read'
)
RETURNS BOOLEAN AS $$
DECLARE
    v_has_access BOOLEAN := false;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM user_resource_access ura
        WHERE ura.user_id = p_user_id
          AND ura.resource_type = p_resource_type
          AND ura.resource_id = p_resource_id
          AND (ura.expires_at IS NULL OR ura.expires_at > NOW())
          AND (ura.permissions->>p_permission)::boolean = true
    ) INTO v_has_access;
    
    RETURN v_has_access;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check visibility rule
CREATE OR REPLACE FUNCTION check_visibility(
    p_user_id UUID,
    p_rule_type VARCHAR(20),
    p_target_type VARCHAR(50),
    p_target_name VARCHAR(100)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_is_visible BOOLEAN := true;
    v_user_roles UUID[];
BEGIN
    -- Get user's role IDs
    SELECT ARRAY_AGG(role_id) INTO v_user_roles
    FROM user_roles
    WHERE user_id = p_user_id AND is_active = true;
    
    -- Check if any visibility rule applies
    SELECT NOT EXISTS (
        SELECT 1
        FROM visibility_rules vr
        WHERE vr.rule_type = p_rule_type
          AND vr.target_type = p_target_type
          AND vr.target_name = p_target_name
          AND vr.is_active = true
          AND NOT (vr.visible_to_roles && v_user_roles)
    ) INTO v_is_visible;
    
    RETURN v_is_visible;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user's effective permissions
CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_permissions JSONB := '{}'::jsonb;
    v_role_perms JSONB;
BEGIN
    FOR v_role_perms IN
        SELECT r.permissions
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
          AND ur.is_active = true
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
    LOOP
        -- Merge permissions (later ones override)
        v_permissions := v_permissions || v_role_perms;
    END LOOP;
    
    RETURN v_permissions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user can delegate to another role
CREATE OR REPLACE FUNCTION can_delegate_to_role(
    p_user_id UUID,
    p_target_role_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    v_can_delegate BOOLEAN := false;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN role_delegations rd ON ur.role_id = rd.delegator_role_id
        JOIN roles target_role ON rd.delegatee_role_id = target_role.id
        WHERE ur.user_id = p_user_id
          AND ur.is_active = true
          AND rd.can_manage_users = true
          AND target_role.id = p_target_role_id
    ) INTO v_can_delegate;
    
    RETURN v_can_delegate;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════
-- 11. Enable RLS and create policies
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE visibility_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_resource_access ENABLE ROW LEVEL SECURITY;

-- Roles: Users can see system roles and their tenant's roles
CREATE POLICY "roles_select_policy" ON roles
    FOR SELECT
    USING (
        is_system = true
        OR tenant_id IS NULL
        OR tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
    );

-- Roles: Only admins can modify
CREATE POLICY "roles_modify_policy" ON roles
    FOR ALL
    USING (
        check_user_permission(auth.uid(), 'permissions', 'write')
    );

-- User Roles: Users can see their own roles and admins can see all
CREATE POLICY "user_roles_select_policy" ON user_roles
    FOR SELECT
    USING (
        user_id = auth.uid()
        OR tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
    );

-- User Roles: Only authorized users can modify
CREATE POLICY "user_roles_modify_policy" ON user_roles
    FOR ALL
    USING (
        check_user_permission(auth.uid(), 'permissions', 'write')
    );

-- Visibility Rules: Only admins can view and modify
CREATE POLICY "visibility_rules_policy" ON visibility_rules
    FOR ALL
    USING (
        check_user_permission(auth.uid(), 'permissions', 'write')
        OR tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
    );

-- User Resource Access: Users can see their own, admins can see all
CREATE POLICY "user_resource_access_select_policy" ON user_resource_access
    FOR SELECT
    USING (
        user_id = auth.uid()
        OR tenant_id IN (SELECT tenant_id FROM user_profiles WHERE id = auth.uid())
    );

CREATE POLICY "user_resource_access_modify_policy" ON user_resource_access
    FOR ALL
    USING (
        check_user_permission(auth.uid(), 'permissions', 'write')
    );

-- ═══════════════════════════════════════════════════════════════
-- 12. Create triggers for updated_at
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS roles_updated_at ON roles;
CREATE TRIGGER roles_updated_at
    BEFORE UPDATE ON roles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS user_roles_updated_at ON user_roles;
CREATE TRIGGER user_roles_updated_at
    BEFORE UPDATE ON user_roles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS visibility_rules_updated_at ON visibility_rules;
CREATE TRIGGER visibility_rules_updated_at
    BEFORE UPDATE ON visibility_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS user_resource_access_updated_at ON user_resource_access;
CREATE TRIGGER user_resource_access_updated_at
    BEFORE UPDATE ON user_resource_access
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════
-- ✅ Migration Complete!
-- ═══════════════════════════════════════════════════════════════
-- 
-- Tables created:
--   1. roles - الأدوار والمجموعات
--   2. user_roles - ربط المستخدمين بالأدوار
--   3. role_delegations - تفويض الصلاحيات
--   4. visibility_rules - قواعد الإخفاء
--   5. user_resource_access - ربط المستخدمين بالموارد
--
-- Functions created:
--   - check_user_permission() - التحقق من صلاحية المستخدم
--   - check_user_resource_access() - التحقق من الوصول للموارد
--   - check_visibility() - التحقق من قواعد الإخفاء
--   - get_user_permissions() - الحصول على صلاحيات المستخدم
--   - can_delegate_to_role() - التحقق من إمكانية التفويض
--
-- Default roles inserted:
--   - super_admin (مدير النظام)
--   - tenant_owner (مالك المستأجر)
--   - company_admin (مدير الشركة)
--   - branch_manager (مدير الفرع)
--   - accountant (محاسب)
--   - cashier (أمين صندوق)
--   - warehouse_manager (مدير مستودع)
--   - sales_rep (مندوب مبيعات)
--   - purchasing_manager (مسؤول المشتريات)
--   - viewer (مشاهد فقط)
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 13. System Admin Functions
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION is_super_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
          AND ur.is_active = true
          AND r.code = 'super_admin'
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN false;
END;
$$;
