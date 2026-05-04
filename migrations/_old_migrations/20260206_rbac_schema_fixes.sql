-- ================================================
-- Safe Migration: Add Missing Columns to Roles Table
-- ================================================
-- This migration adds columns that the RBAC system requires
-- Run this in Supabase Dashboard -> SQL Editor
-- ================================================

-- 1. Add 'level' column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'roles' AND column_name = 'level'
    ) THEN
        ALTER TABLE roles ADD COLUMN level TEXT DEFAULT 'operations';
        RAISE NOTICE 'Added level column to roles table';
    ELSE
        RAISE NOTICE 'level column already exists';
    END IF;
END $$;

-- 2. Add 'is_system' column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'roles' AND column_name = 'is_system'
    ) THEN
        ALTER TABLE roles ADD COLUMN is_system BOOLEAN DEFAULT false;
        RAISE NOTICE 'Added is_system column to roles table';
    ELSE
        RAISE NOTICE 'is_system column already exists';
    END IF;
END $$;

-- 3. Add 'can_be_deleted' column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'roles' AND column_name = 'can_be_deleted'
    ) THEN
        ALTER TABLE roles ADD COLUMN can_be_deleted BOOLEAN DEFAULT true;
        RAISE NOTICE 'Added can_be_deleted column to roles table';
    ELSE
        RAISE NOTICE 'can_be_deleted column already exists';
    END IF;
END $$;

-- 4. Add 'visible_modules' column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'roles' AND column_name = 'visible_modules'
    ) THEN
        ALTER TABLE roles ADD COLUMN visible_modules TEXT[] DEFAULT ARRAY['dashboard']::TEXT[];
        RAISE NOTICE 'Added visible_modules column to roles table';
    ELSE
        RAISE NOTICE 'visible_modules column already exists';
    END IF;
END $$;

-- 5. Add 'created_at' column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'roles' AND column_name = 'created_at'
    ) THEN
        ALTER TABLE roles ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
        RAISE NOTICE 'Added created_at column to roles table';
    ELSE
        RAISE NOTICE 'created_at column already exists';
    END IF;
END $$;

-- 6. Update existing roles with proper levels
UPDATE roles SET 
    level = 'tenant',
    is_system = true,
    can_be_deleted = false,
    visible_modules = ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 'fabric', 'pharmacy', 'healthcare', 'doctors', 'restaurant', 'gold', 'shipments', 'crm', 'pos', 'real_estate', 'exchange', 'manufacturing', 'hr', 'e-commerce', 'saas', 'ai_analytics', 'activity_log', 'system_config', 'reports']
WHERE code IN ('super_admin', 'tenant_owner') AND level IS NULL OR level = 'operations';

UPDATE roles SET 
    level = 'company',
    is_system = true,
    can_be_deleted = false,
    visible_modules = ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 'reports']
WHERE code IN ('company_admin', 'company_owner') AND (level IS NULL OR level = 'operations');

UPDATE roles SET 
    level = 'branch',
    is_system = true,
    can_be_deleted = false,
    visible_modules = ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 'reports']
WHERE code IN ('branch_manager') AND (level IS NULL OR level = 'operations');

UPDATE roles SET 
    level = 'operations',
    is_system = true,
    can_be_deleted = false,
    visible_modules = ARRAY['dashboard', 'accounting', 'treasury']
WHERE code IN ('accountant', 'cashier') AND (level IS NULL OR level = 'operations');

-- 7. Create user_resource_access table if it doesn't exist
CREATE TABLE IF NOT EXISTS user_resource_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL CHECK (resource_type IN ('branch', 'warehouse', 'cash_account', 'bank_account', 'department')),
    resource_id UUID NOT NULL,
    permissions JSONB DEFAULT '{"read": true, "write": false}'::JSONB,
    is_primary BOOLEAN DEFAULT false,
    assigned_by UUID REFERENCES user_profiles(id),
    assigned_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, resource_type, resource_id)
);

-- Enable RLS on user_resource_access
ALTER TABLE user_resource_access ENABLE ROW LEVEL SECURITY;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_user_resource_access_user_id ON user_resource_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_resource_access_resource ON user_resource_access(resource_type, resource_id);

-- 8. Create visibility_rules table if it doesn't exist
CREATE TABLE IF NOT EXISTS visibility_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    rule_type TEXT NOT NULL CHECK (rule_type IN ('page', 'field', 'module', 'report', 'action')),
    target_type TEXT NOT NULL,
    target_name TEXT NOT NULL,
    visible_to_roles TEXT[] DEFAULT ARRAY[]::TEXT[],
    hidden_from_roles TEXT[] DEFAULT ARRAY[]::TEXT[],
    mask_value TEXT,
    is_active BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 100,
    description TEXT,
    created_by UUID REFERENCES user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE visibility_rules ENABLE ROW LEVEL SECURITY;

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_visibility_rules_type ON visibility_rules(rule_type, is_active);

-- 9. Print success message
DO $$
BEGIN
    RAISE NOTICE '✅ RBAC schema updates completed successfully!';
END $$;
