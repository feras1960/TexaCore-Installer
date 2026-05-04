-- ═══════════════════════════════════════════════════════════════════════════
-- ASSIGN SUPER ADMIN ROLE TO CURRENT USER
-- ═══════════════════════════════════════════════════════════════════════════

-- First, let's check the user_roles table structure
DO $$
DECLARE
    col_exists BOOLEAN;
BEGIN
    -- Check if user_id column exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_roles' AND column_name = 'user_id'
    ) INTO col_exists;
    
    IF NOT col_exists THEN
        RAISE NOTICE 'user_id column missing - will add it';
        ALTER TABLE user_roles ADD COLUMN user_id UUID REFERENCES auth.users(id);
    END IF;
END $$;

-- Ensure user_roles has correct structure
DO $$
BEGIN
    -- Add missing columns if they don't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_roles' AND column_name = 'role_id') THEN
        ALTER TABLE user_roles ADD COLUMN role_id UUID REFERENCES roles(id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_roles' AND column_name = 'is_active') THEN
        ALTER TABLE user_roles ADD COLUMN is_active BOOLEAN DEFAULT true;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_roles' AND column_name = 'tenant_id') THEN
        ALTER TABLE user_roles ADD COLUMN tenant_id UUID REFERENCES tenants(id);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_roles' AND column_name = 'company_id') THEN
        ALTER TABLE user_roles ADD COLUMN company_id UUID REFERENCES companies(id);
    END IF;
END $$;

-- Get the super_admin role ID
DO $$
DECLARE
    v_super_admin_role_id UUID;
    v_user_id UUID := '85adc738-b893-4c84-8b80-156679b978c1'; -- Your user ID from the error logs
    v_user_exists BOOLEAN;
BEGIN
    -- Get super_admin role
    SELECT id INTO v_super_admin_role_id FROM roles WHERE code = 'super_admin' LIMIT 1;
    
    IF v_super_admin_role_id IS NULL THEN
        RAISE NOTICE 'Creating super_admin role...';
        INSERT INTO roles (code, name_ar, name_en, description, level, is_system, can_be_deleted, visible_modules, permissions)
        VALUES (
            'super_admin',
            'مدير النظام',
            'Super Admin',
            'Full system access',
            'platform',
            true,
            false,
            ARRAY['dashboard', 'accounting', 'inventory', 'sales', 'purchases', 'hr', 'settings', 'system-config', 'reports'],
            '{"*": ["*"]}'::JSONB
        )
        RETURNING id INTO v_super_admin_role_id;
    END IF;
    
    RAISE NOTICE 'Super admin role ID: %', v_super_admin_role_id;
    
    -- Check if user exists
    SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) INTO v_user_exists;
    
    IF v_user_exists THEN
        -- Remove existing role assignments for this user
        DELETE FROM user_roles WHERE user_id = v_user_id;
        
        -- Assign super_admin role
        INSERT INTO user_roles (user_id, role_id, is_active)
        VALUES (v_user_id, v_super_admin_role_id, true);
        
        RAISE NOTICE '✅ Super admin role assigned to user: %', v_user_id;
    ELSE
        -- Try to find user by email
        SELECT id INTO v_user_id FROM auth.users WHERE email = 'feras1960@gmail.com' LIMIT 1;
        
        IF v_user_id IS NOT NULL THEN
            DELETE FROM user_roles WHERE user_id = v_user_id;
            INSERT INTO user_roles (user_id, role_id, is_active)
            VALUES (v_user_id, v_super_admin_role_id, true);
            RAISE NOTICE '✅ Super admin role assigned to user (by email): %', v_user_id;
        ELSE
            -- Assign to first user
            SELECT id INTO v_user_id FROM auth.users LIMIT 1;
            IF v_user_id IS NOT NULL THEN
                DELETE FROM user_roles WHERE user_id = v_user_id;
                INSERT INTO user_roles (user_id, role_id, is_active)
                VALUES (v_user_id, v_super_admin_role_id, true);
                RAISE NOTICE '✅ Super admin role assigned to first user: %', v_user_id;
            END IF;
        END IF;
    END IF;
END $$;

-- Also assign to user in user_profiles if different
DO $$
DECLARE
    v_super_admin_role_id UUID;
    v_user_id UUID;
BEGIN
    SELECT id INTO v_super_admin_role_id FROM roles WHERE code = 'super_admin' LIMIT 1;
    
    -- Get user from user_profiles
    SELECT id INTO v_user_id FROM user_profiles WHERE email = 'feras1960@gmail.com' LIMIT 1;
    
    IF v_user_id IS NOT NULL AND v_super_admin_role_id IS NOT NULL THEN
        -- Check if already assigned
        IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id = v_user_id AND role_id = v_super_admin_role_id) THEN
            INSERT INTO user_roles (user_id, role_id, is_active)
            VALUES (v_user_id, v_super_admin_role_id, true)
            ON CONFLICT DO NOTHING;
            RAISE NOTICE '✅ Role assigned via user_profiles ID: %', v_user_id;
        END IF;
    END IF;
END $$;

-- Verify the assignment
SELECT 
    up.full_name,
    up.email,
    r.code as role_code,
    r.name_ar as role_name,
    ur.is_active
FROM user_roles ur
JOIN user_profiles up ON ur.user_id = up.id
JOIN roles r ON ur.role_id = r.id
WHERE up.email = 'feras1960@gmail.com';

NOTIFY pgrst, 'reload schema';

SELECT '✅ SUPER ADMIN ROLE ASSIGNED! Refresh the page.' as status;
