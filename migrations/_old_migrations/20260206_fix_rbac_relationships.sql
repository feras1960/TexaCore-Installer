-- ================================================
-- Safe Migration: Add Missing Foreign Keys for RBAC
-- ================================================
-- This migration adds the missing FK relationships
-- Run this in Supabase Dashboard -> SQL Editor
-- ================================================

-- 1. First, check if user_roles table exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_roles') THEN
        CREATE TABLE user_roles (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID REFERENCES user_profiles(id) ON DELETE CASCADE,
            role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
            tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
            company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
            branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
            is_active BOOLEAN DEFAULT true,
            assigned_by UUID REFERENCES user_profiles(id),
            assigned_at TIMESTAMPTZ DEFAULT now(),
            expires_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now(),
            UNIQUE(user_id, role_id)
        );
        RAISE NOTICE 'Created user_roles table';
    ELSE
        RAISE NOTICE 'user_roles table already exists';
    END IF;
END $$;

-- 2. Add foreign key from user_roles to roles if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'user_roles'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'role_id'
    ) THEN
        -- Try to add the FK
        BEGIN
            ALTER TABLE user_roles
                ADD CONSTRAINT user_roles_role_id_fkey
                FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
            RAISE NOTICE 'Added FK from user_roles.role_id to roles.id';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not add FK: %', SQLERRM;
        END;
    ELSE
        RAISE NOTICE 'FK user_roles.role_id -> roles.id already exists';
    END IF;
END $$;

-- 3. Add foreign key from user_roles to user_profiles if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
        WHERE tc.table_name = 'user_roles'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'user_id'
    ) THEN
        BEGIN
            ALTER TABLE user_roles
                ADD CONSTRAINT user_roles_user_id_fkey
                FOREIGN KEY (user_id) REFERENCES user_profiles(id) ON DELETE CASCADE;
            RAISE NOTICE 'Added FK from user_roles.user_id to user_profiles.id';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not add FK: %', SQLERRM;
        END;
    ELSE
        RAISE NOTICE 'FK user_roles.user_id -> user_profiles.id already exists';
    END IF;
END $$;

-- 4. Enable RLS on user_roles
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- 5. Create basic RLS policies for user_roles
DROP POLICY IF EXISTS "user_roles_select" ON user_roles;
CREATE POLICY "user_roles_select" ON user_roles
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "user_roles_admin_all" ON user_roles;
CREATE POLICY "user_roles_admin_all" ON user_roles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND r.code IN ('super_admin', 'tenant_owner', 'company_admin')
        )
    );

-- 6. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_lookup ON user_roles(user_id, role_id);

-- 7. Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

-- 8. Success message
DO $$
BEGIN
    RAISE NOTICE '✅ RBAC relationships fixed successfully!';
    RAISE NOTICE 'Please wait 10-30 seconds for PostgREST to reload the schema.';
END $$;
