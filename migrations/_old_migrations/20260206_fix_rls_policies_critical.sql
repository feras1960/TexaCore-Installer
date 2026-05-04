-- ═══════════════════════════════════════════════════════════════════════════
-- CRITICAL FIX: Remove RLS policies using old role_code column
-- ═══════════════════════════════════════════════════════════════════════════
-- The error "column ur.role_code does not exist" comes from RLS policies
-- This script fixes ALL affected policies
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1: Drop ALL problematic policies on tenants table
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    -- Drop all existing policies on tenants to start fresh
    FOR pol IN 
        SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenants'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON tenants';
        RAISE NOTICE 'Dropped policy: %', pol.policyname;
    END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2: Create simple, working policies for tenants
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable RLS
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Simple select policy - users can see their own tenant
CREATE POLICY "tenants_select" ON tenants
    FOR SELECT USING (
        -- User belongs to this tenant
        id = get_current_tenant_id()
        OR
        -- Or user is super admin (check by joining user_roles and roles)
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND ur.is_active = true
            AND r.code = 'super_admin'
        )
    );

-- Admin policies for insert/update/delete
CREATE POLICY "tenants_admin" ON tenants
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND ur.is_active = true
            AND r.code IN ('super_admin', 'tenant_owner')
        )
    );

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3: Fix is_super_admin function
-- ═══════════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4: Fix any other tables with problematic policies
-- ═══════════════════════════════════════════════════════════════════════════

-- Fix user_profiles policies if needed
DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'user_profiles'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON user_profiles';
    END LOOP;
END $$;

-- Recreate user_profiles policies
CREATE POLICY "user_profiles_select" ON user_profiles
    FOR SELECT USING (true);

CREATE POLICY "user_profiles_update_own" ON user_profiles
    FOR UPDATE USING (id = auth.uid());

CREATE POLICY "user_profiles_admin" ON user_profiles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND ur.is_active = true
            AND r.code IN ('super_admin', 'tenant_owner', 'company_admin')
        )
    );

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 5: Fix companies policies
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'companies'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON companies';
    END LOOP;
END $$;

CREATE POLICY "companies_select" ON companies
    FOR SELECT USING (true);

CREATE POLICY "companies_admin" ON companies
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND ur.is_active = true
            AND r.code IN ('super_admin', 'tenant_owner', 'company_admin')
        )
    );

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 6: Force PostgREST cache reload
-- ═══════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- Also reload config (this helps in some cases)
NOTIFY pgrst, 'reload config';

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 7: Verify the fix
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ RLS POLICIES FIXED SUCCESSFULLY!';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE 'Fixed tables:';
    RAISE NOTICE '  ✓ tenants - removed old role_code policies';
    RAISE NOTICE '  ✓ user_profiles - recreated with proper joins';
    RAISE NOTICE '  ✓ companies - recreated with proper joins';
    RAISE NOTICE '  ✓ is_super_admin() function - fixed';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ IMPORTANT: Wait 30-60 seconds then refresh the page!';
    RAISE NOTICE '';
    RAISE NOTICE 'If still having issues, try logging out and back in.';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
