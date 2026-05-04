-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Add visible_modules to roles table (SAFE - No data loss)
-- Date: 2026-02-05
-- Purpose: Add module visibility control to existing RBAC system
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. Add visible_modules column to roles table (if not exists)
-- ═══════════════════════════════════════════════════════════════

DO $$ 
BEGIN
    -- Add visible_modules column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'roles' AND column_name = 'visible_modules'
    ) THEN
        ALTER TABLE roles ADD COLUMN visible_modules TEXT[] DEFAULT ARRAY['dashboard']::TEXT[];
        RAISE NOTICE 'Added visible_modules column to roles table';
    ELSE
        RAISE NOTICE 'visible_modules column already exists';
    END IF;
    
    -- Add description column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'roles' AND column_name = 'description'
    ) THEN
        ALTER TABLE roles ADD COLUMN description TEXT;
        RAISE NOTICE 'Added description column to roles table';
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 2. Update existing roles with appropriate visible_modules
-- ═══════════════════════════════════════════════════════════════

-- 🔴 Super Admin (Platform Admin) - sees ALL modules
UPDATE roles 
SET 
    visible_modules = ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 'fabric', 'pharmacy', 'healthcare', 'doctors', 'restaurant', 'gold', 'shipments', 'crm', 'pos', 'real_estate', 'exchange', 'manufacturing', 'hr', 'e-commerce', 'saas', 'ai_analytics', 'activity_log', 'component_lab', 'system_config'],
    description = COALESCE(description, 'Platform administrator - not visible to tenants. Full system access.')
WHERE code = 'super_admin';

-- 🟠 Tenant Owner - sees all tenant-level modules
UPDATE roles 
SET 
    visible_modules = ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 'crm', 'pos', 'manufacturing', 'hr', 'shipments', 'activity_log', 'system_config', 'reports', 'settings', 'permissions'],
    description = COALESCE(description, 'Highest customer role - full access within tenant scope.')
WHERE code = 'tenant_owner';

-- 🟡 Company Admin - sees most modules within company
UPDATE roles 
SET 
    visible_modules = ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 'crm', 'pos', 'manufacturing', 'hr', 'shipments', 'reports', 'settings', 'permissions'],
    description = COALESCE(description, 'Company administrator - manages company operations.')
WHERE code = 'company_admin';

-- 🟢 Branch Manager
UPDATE roles 
SET 
    visible_modules = ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 'crm', 'pos', 'reports'],
    description = COALESCE(description, 'Branch manager - manages a specific branch.')
WHERE code = 'branch_manager';

-- 📊 Accountant
UPDATE roles 
SET 
    visible_modules = ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'reports'],
    description = COALESCE(description, 'Accountant - handles financial operations and reporting.')
WHERE code = 'accountant';

-- 💰 Cashier
UPDATE roles 
SET 
    visible_modules = ARRAY['dashboard', 'treasury', 'sales', 'pos'],
    description = COALESCE(description, 'Cashier - handles cash register and payments.')
WHERE code = 'cashier';

-- 📦 Warehouse Manager
UPDATE roles 
SET 
    visible_modules = ARRAY['dashboard', 'inventory', 'warehouse', 'purchases', 'manufacturing', 'shipments'],
    description = COALESCE(description, 'Warehouse manager - manages inventory and stock operations.')
WHERE code = 'warehouse_manager';

-- 🛒 Sales Representative
UPDATE roles 
SET 
    visible_modules = ARRAY['dashboard', 'sales', 'crm', 'pos', 'inventory'],
    description = COALESCE(description, 'Sales representative - handles sales and customer relations.')
WHERE code = 'sales_rep';

-- 🛍️ Purchasing Manager
UPDATE roles 
SET 
    visible_modules = ARRAY['dashboard', 'purchases', 'inventory', 'warehouse', 'shipments'],
    description = COALESCE(description, 'Purchasing manager - manages procurement and supplier relations.')
WHERE code = 'purchasing_manager';

-- 👁️ Viewer (Read-only access)
UPDATE roles 
SET 
    visible_modules = ARRAY['dashboard', 'reports'],
    description = COALESCE(description, 'Viewer - read-only access to dashboard and reports.')
WHERE code = 'viewer';

-- ═══════════════════════════════════════════════════════════════
-- 3. Set default for any roles without visible_modules
-- ═══════════════════════════════════════════════════════════════

UPDATE roles 
SET visible_modules = ARRAY['dashboard']::TEXT[]
WHERE visible_modules IS NULL OR visible_modules = '{}';

-- ═══════════════════════════════════════════════════════════════
-- 4. Add index for performance
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_roles_visible_modules ON roles USING gin(visible_modules);

-- ═══════════════════════════════════════════════════════════════
-- 5. Create helper function to get user's visible modules
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_user_visible_modules(p_user_id UUID)
RETURNS TEXT[] 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_modules TEXT[] := ARRAY[]::TEXT[];
    v_is_super_admin BOOLEAN := false;
BEGIN
    -- Check if user is super_admin
    SELECT EXISTS(
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id 
        AND r.code = 'super_admin'
        AND (ur.is_active = true OR ur.is_active IS NULL)
    ) INTO v_is_super_admin;
    
    -- If super_admin, return 'all'
    IF v_is_super_admin THEN
        RETURN ARRAY['all']::TEXT[];
    END IF;
    
    -- Get all unique modules from user's roles
    SELECT array_agg(DISTINCT module) INTO v_modules
    FROM (
        SELECT unnest(r.visible_modules) as module
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
        AND (ur.is_active = true OR ur.is_active IS NULL)
        AND r.visible_modules IS NOT NULL
    ) subq;
    
    -- Return at least dashboard
    IF v_modules IS NULL OR array_length(v_modules, 1) IS NULL THEN
        RETURN ARRAY['dashboard']::TEXT[];
    END IF;
    
    RETURN v_modules;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 6. Create function to check if user can see a module
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION can_user_see_module(p_user_id UUID, p_module_code TEXT)
RETURNS BOOLEAN 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_modules TEXT[];
BEGIN
    v_modules := get_user_visible_modules(p_user_id);
    
    -- 'all' means can see everything
    IF 'all' = ANY(v_modules) THEN
        RETURN true;
    END IF;
    
    RETURN p_module_code = ANY(v_modules);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 7. Grant permissions
-- ═══════════════════════════════════════════════════════════════

GRANT EXECUTE ON FUNCTION get_user_visible_modules(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_user_see_module(UUID, TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- Done! Migration completed successfully.
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE '✅ Migration completed: visible_modules added to roles table';
    RAISE NOTICE '📊 All existing roles updated with appropriate module visibility';
    RAISE NOTICE '🔧 Helper functions created: get_user_visible_modules, can_user_see_module';
END $$;
