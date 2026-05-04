-- ═══════════════════════════════════════════════════════════════════════════
-- COMPLETE RBAC SYSTEM SETUP - إعداد نظام الصلاحيات الكامل
-- ═══════════════════════════════════════════════════════════════════════════
-- Run this COMPLETE script in Supabase Dashboard -> SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1: Fix ROLES table structure
-- ═══════════════════════════════════════════════════════════════════════════

-- Add missing columns to roles table
ALTER TABLE roles ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'operations';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT false;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS can_be_deleted BOOLEAN DEFAULT true;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS visible_modules TEXT[] DEFAULT ARRAY['dashboard']::TEXT[];
ALTER TABLE roles ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::JSONB;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE roles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2: Drop and recreate USER_ROLES table with proper FKs
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop existing table if it has issues
DROP TABLE IF EXISTS user_roles CASCADE;

-- Create user_roles with proper foreign keys
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    role_id UUID NOT NULL,
    tenant_id UUID,
    company_id UUID,
    branch_id UUID,
    is_active BOOLEAN DEFAULT true,
    assigned_by UUID,
    assigned_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Foreign Keys
    CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id) 
        REFERENCES user_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id) 
        REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_tenant FOREIGN KEY (tenant_id) 
        REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_roles_company FOREIGN KEY (company_id) 
        REFERENCES companies(id) ON DELETE CASCADE,
    
    -- Unique constraint
    UNIQUE(user_id, role_id)
);

-- Indexes
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);
CREATE INDEX idx_user_roles_active ON user_roles(user_id, is_active);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3: Create USER_RESOURCE_ACCESS table for funds/warehouses/branches
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS user_resource_access CASCADE;

CREATE TABLE user_resource_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    tenant_id UUID,
    company_id UUID,
    
    -- Resource identification
    resource_type TEXT NOT NULL CHECK (resource_type IN ('branch', 'warehouse', 'cash_account', 'bank_account', 'fund')),
    resource_id UUID NOT NULL,
    
    -- Permissions
    can_read BOOLEAN DEFAULT true,
    can_write BOOLEAN DEFAULT false,
    can_delete BOOLEAN DEFAULT false,
    can_deposit BOOLEAN DEFAULT false,    -- For funds
    can_withdraw BOOLEAN DEFAULT false,   -- For funds
    can_receive BOOLEAN DEFAULT false,    -- For warehouses
    can_issue BOOLEAN DEFAULT false,      -- For warehouses
    is_keeper BOOLEAN DEFAULT false,      -- Warehouse keeper
    is_primary BOOLEAN DEFAULT false,     -- Primary branch/fund
    
    -- Metadata
    assigned_by UUID,
    assigned_at TIMESTAMPTZ DEFAULT now(),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    -- Foreign Keys
    CONSTRAINT fk_ura_user FOREIGN KEY (user_id) 
        REFERENCES user_profiles(id) ON DELETE CASCADE,
    
    -- Unique constraint
    UNIQUE(user_id, resource_type, resource_id)
);

-- Indexes
CREATE INDEX idx_ura_user ON user_resource_access(user_id);
CREATE INDEX idx_ura_resource ON user_resource_access(resource_type, resource_id);
CREATE INDEX idx_ura_lookup ON user_resource_access(user_id, resource_type);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4: Create VISIBILITY_RULES table
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS visibility_rules CASCADE;

CREATE TABLE visibility_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID,
    company_id UUID,
    
    -- Rule definition
    rule_type TEXT NOT NULL CHECK (rule_type IN ('page', 'field', 'module', 'report', 'action')),
    target_name TEXT NOT NULL,
    
    -- Visibility control
    hidden_from_roles TEXT[] DEFAULT ARRAY[]::TEXT[],
    visible_to_roles TEXT[] DEFAULT ARRAY[]::TEXT[],
    mask_value TEXT,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 100,
    description TEXT,
    
    -- Metadata
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_visibility_rules_type ON visibility_rules(rule_type, is_active);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 5: Insert DEFAULT SYSTEM ROLES (الأدوار الجاهزة)
-- ═══════════════════════════════════════════════════════════════════════════

-- Clear existing system roles first
DELETE FROM roles WHERE code IN (
    'super_admin', 'tenant_owner', 'company_admin', 'branch_manager',
    'accountant', 'cashier', 'warehouse_keeper', 'sales_rep', 'viewer'
);

-- Insert system roles
INSERT INTO roles (code, name_ar, name_en, level, is_system, can_be_deleted, icon, color, visible_modules, permissions) VALUES

-- مدير النظام (Platform)
('super_admin', 'مدير النظام', 'Super Admin', 'system', true, false, 'Crown', 'red',
    ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 
          'fabric', 'pharmacy', 'healthcare', 'doctors', 'restaurant', 'gold', 'shipments', 
          'crm', 'pos', 'real_estate', 'exchange', 'manufacturing', 'hr', 'e-commerce', 
          'saas', 'ai_analytics', 'activity_log', 'system_config', 'reports'],
    '{"all": ["read", "write", "delete", "admin"]}'::JSONB
),

-- مالك المستأجر (Tenant Owner)
('tenant_owner', 'مالك الحساب', 'Tenant Owner', 'tenant', true, false, 'Building2', 'orange',
    ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 
          'fabric', 'shipments', 'crm', 'activity_log', 'system_config', 'reports'],
    '{"all": ["read", "write", "delete"]}'::JSONB
),

-- مدير الشركة (Company Admin)
('company_admin', 'مدير الشركة', 'Company Admin', 'company', true, false, 'Briefcase', 'blue',
    ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 
          'reports', 'system_config'],
    '{"accounting": ["read", "write"], "treasury": ["read", "write"], "sales": ["read", "write", "delete"], 
      "purchases": ["read", "write", "delete"], "inventory": ["read", "write"], "warehouse": ["read", "write"]}'::JSONB
),

-- مدير الفرع (Branch Manager)
('branch_manager', 'مدير الفرع', 'Branch Manager', 'branch', true, false, 'GitBranch', 'green',
    ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 'reports'],
    '{"accounting": ["read"], "treasury": ["read", "write"], "sales": ["read", "write", "delete"], 
      "purchases": ["read", "write"], "inventory": ["read", "write"], "warehouse": ["read", "write"]}'::JSONB
),

-- المحاسب (Accountant)
('accountant', 'محاسب', 'Accountant', 'operations', true, false, 'Calculator', 'teal',
    ARRAY['dashboard', 'accounting', 'treasury', 'reports'],
    '{"accounting": ["read", "write"], "treasury": ["read", "write"], "reports": ["read"]}'::JSONB
),

-- أمين الصندوق (Cashier)
('cashier', 'أمين صندوق', 'Cashier', 'operations', true, false, 'Wallet', 'yellow',
    ARRAY['dashboard', 'treasury', 'sales'],
    '{"treasury": ["read", "write"], "sales": ["read"]}'::JSONB
),

-- أمين المستودع (Warehouse Keeper)
('warehouse_keeper', 'أمين مستودع', 'Warehouse Keeper', 'operations', true, false, 'Warehouse', 'purple',
    ARRAY['dashboard', 'inventory', 'warehouse'],
    '{"inventory": ["read", "write"], "warehouse": ["read", "write"]}'::JSONB
),

-- مندوب مبيعات (Sales Representative)
('sales_rep', 'مندوب مبيعات', 'Sales Representative', 'operations', true, false, 'ShoppingBag', 'pink',
    ARRAY['dashboard', 'sales', 'inventory'],
    '{"sales": ["read", "write"], "inventory": ["read"]}'::JSONB
),

-- مشاهد فقط (Viewer)
('viewer', 'مشاهد', 'Viewer', 'operations', true, false, 'Eye', 'gray',
    ARRAY['dashboard', 'reports'],
    '{"all": ["read"]}'::JSONB
);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 6: Create essential RPC functions
-- ═══════════════════════════════════════════════════════════════════════════

-- Function to get user's visible modules
CREATE OR REPLACE FUNCTION get_user_visible_modules(p_user_id UUID)
RETURNS TEXT[] 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result TEXT[];
BEGIN
    SELECT COALESCE(
        array_agg(DISTINCT unnest_module),
        ARRAY['dashboard']::TEXT[]
    ) INTO result
    FROM (
        SELECT unnest(r.visible_modules) as unnest_module
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
          AND ur.is_active = true
    ) sub;
    
    RETURN COALESCE(result, ARRAY['dashboard']::TEXT[]);
END;
$$;

-- Function to check if user can see a module
CREATE OR REPLACE FUNCTION can_user_see_module(p_user_id UUID, p_module_code TEXT)
RETURNS BOOLEAN 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
          AND ur.is_active = true
          AND p_module_code = ANY(r.visible_modules)
    );
END;
$$;

-- Function to get user's roles
CREATE OR REPLACE FUNCTION get_user_roles(p_user_id UUID)
RETURNS TABLE (
    role_id UUID,
    role_code TEXT,
    role_name_ar TEXT,
    role_name_en TEXT,
    role_level TEXT,
    is_active BOOLEAN
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.code,
        r.name_ar,
        r.name_en,
        r.level,
        ur.is_active
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 7: Enable RLS and create policies
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable RLS
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_resource_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE visibility_rules ENABLE ROW LEVEL SECURITY;

-- User roles policies
DROP POLICY IF EXISTS "user_roles_select_policy" ON user_roles;
CREATE POLICY "user_roles_select_policy" ON user_roles 
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "user_roles_insert_policy" ON user_roles;
CREATE POLICY "user_roles_insert_policy" ON user_roles 
    FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "user_roles_update_policy" ON user_roles;
CREATE POLICY "user_roles_update_policy" ON user_roles 
    FOR UPDATE USING (true);

DROP POLICY IF EXISTS "user_roles_delete_policy" ON user_roles;
CREATE POLICY "user_roles_delete_policy" ON user_roles 
    FOR DELETE USING (true);

-- Resource access policies
DROP POLICY IF EXISTS "ura_select_policy" ON user_resource_access;
CREATE POLICY "ura_select_policy" ON user_resource_access 
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "ura_all_policy" ON user_resource_access;
CREATE POLICY "ura_all_policy" ON user_resource_access 
    FOR ALL USING (true);

-- Visibility rules policies
DROP POLICY IF EXISTS "vr_select_policy" ON visibility_rules;
CREATE POLICY "vr_select_policy" ON visibility_rules 
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "vr_all_policy" ON visibility_rules;
CREATE POLICY "vr_all_policy" ON visibility_rules 
    FOR ALL USING (true);

-- Roles table policies (ensure roles can be read)
DROP POLICY IF EXISTS "roles_select_policy" ON roles;
CREATE POLICY "roles_select_policy" ON roles 
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "roles_all_policy" ON roles;
CREATE POLICY "roles_all_policy" ON roles 
    FOR ALL USING (true);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 8: Assign initial role to current user
-- ═══════════════════════════════════════════════════════════════════════════

-- Assign super_admin role to the current user if they exist
DO $$
DECLARE
    v_user_id UUID;
    v_super_admin_role_id UUID;
BEGIN
    -- Get super_admin role id
    SELECT id INTO v_super_admin_role_id FROM roles WHERE code = 'super_admin';
    
    -- Get first user (or specific user)
    SELECT id INTO v_user_id FROM user_profiles LIMIT 1;
    
    IF v_user_id IS NOT NULL AND v_super_admin_role_id IS NOT NULL THEN
        INSERT INTO user_roles (user_id, role_id, is_active)
        VALUES (v_user_id, v_super_admin_role_id, true)
        ON CONFLICT (user_id, role_id) DO UPDATE SET is_active = true;
        
        RAISE NOTICE 'Assigned super_admin role to user: %', v_user_id;
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 9: Reload PostgREST schema cache
-- ═══════════════════════════════════════════════════════════════════════════

-- This tells PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE! ✅
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ RBAC SYSTEM SETUP COMPLETED SUCCESSFULLY!';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE 'Created:';
    RAISE NOTICE '  ✓ user_roles table with proper FKs';
    RAISE NOTICE '  ✓ user_resource_access table for funds/warehouses/branches';
    RAISE NOTICE '  ✓ visibility_rules table';
    RAISE NOTICE '  ✓ 9 default system roles';
    RAISE NOTICE '  ✓ RPC functions for RBAC';
    RAISE NOTICE '  ✓ RLS policies';
    RAISE NOTICE '';
    RAISE NOTICE 'Default Roles:';
    RAISE NOTICE '  1. super_admin - مدير النظام (Full access)';
    RAISE NOTICE '  2. tenant_owner - مالك الحساب (Tenant level)';
    RAISE NOTICE '  3. company_admin - مدير الشركة (Company level)';
    RAISE NOTICE '  4. branch_manager - مدير الفرع (Branch level)';
    RAISE NOTICE '  5. accountant - محاسب (Accounting operations)';
    RAISE NOTICE '  6. cashier - أمين صندوق (Treasury operations)';
    RAISE NOTICE '  7. warehouse_keeper - أمين مستودع (Warehouse operations)';
    RAISE NOTICE '  8. sales_rep - مندوب مبيعات (Sales operations)';
    RAISE NOTICE '  9. viewer - مشاهد (Read-only access)';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ IMPORTANT: Wait 10-30 seconds for PostgREST to reload!';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
