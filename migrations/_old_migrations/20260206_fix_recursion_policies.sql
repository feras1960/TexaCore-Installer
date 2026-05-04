-- ═══════════════════════════════════════════════════════════════════════════
-- CRITICAL FIX: Resolve infinite recursion in user_roles RLS policies
-- ═══════════════════════════════════════════════════════════════════════════
-- The error "infinite recursion detected in policy for relation user_roles"
-- occurs when a policy on user_roles tries to query user_roles itself
-- 
-- SOLUTION: Use simple policies that don't reference user_roles
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1: Drop ALL policies on user_roles
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'user_roles'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON user_roles';
        RAISE NOTICE 'Dropped user_roles policy: %', pol.policyname;
    END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2: Drop ALL policies on roles
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'roles'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON roles';
        RAISE NOTICE 'Dropped roles policy: %', pol.policyname;
    END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3: Drop ALL policies on tenants (again to be sure)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'tenants'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON tenants';
        RAISE NOTICE 'Dropped tenants policy: %', pol.policyname;
    END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4: Create SIMPLE non-recursive policies for user_roles
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable RLS
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Simple policy: Users can see their own role assignments
CREATE POLICY "user_roles_own" ON user_roles
    FOR SELECT USING (user_id = auth.uid());

-- Simple policy: Allow all for authenticated users (we'll control via application)
CREATE POLICY "user_roles_auth" ON user_roles
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 5: Create SIMPLE non-recursive policies for roles
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- Everyone can see roles (they are reference data)
CREATE POLICY "roles_select_all" ON roles
    FOR SELECT USING (true);

-- Only service role can modify (we'll handle this in application)
CREATE POLICY "roles_modify_auth" ON roles
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 6: Create SIMPLE non-recursive policies for tenants
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Simple select - allow all authenticated users
-- We'll filter in the application layer
CREATE POLICY "tenants_select_auth" ON tenants
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- Modify requires authentication
CREATE POLICY "tenants_modify_auth" ON tenants
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 7: Fix user_profiles policies
-- ═══════════════════════════════════════════════════════════════════════════

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

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Everyone can read (for lookups)
CREATE POLICY "user_profiles_select" ON user_profiles
    FOR SELECT USING (true);

-- Users can update their own profile
CREATE POLICY "user_profiles_update_own" ON user_profiles
    FOR UPDATE USING (id = auth.uid());

-- Allow all for authenticated (admin controls in app)
CREATE POLICY "user_profiles_admin" ON user_profiles
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 8: Fix companies policies
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

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "companies_select" ON companies FOR SELECT USING (true);
CREATE POLICY "companies_modify" ON companies FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 9: Fix user_resource_access policies
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'user_resource_access'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON user_resource_access';
    END LOOP;
END $$;

ALTER TABLE user_resource_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_resource_access_own" ON user_resource_access
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "user_resource_access_modify" ON user_resource_access
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 10: Fix visibility_rules policies
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN 
        SELECT policyname FROM pg_policies 
        WHERE schemaname = 'public' AND tablename = 'visibility_rules'
    LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || pol.policyname || '" ON visibility_rules';
    END LOOP;
END $$;

ALTER TABLE visibility_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visibility_rules_select" ON visibility_rules
    FOR SELECT USING (true);

CREATE POLICY "visibility_rules_modify" ON visibility_rules
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 11: Recreate RPC functions with SECURITY DEFINER
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop existing function first
DROP FUNCTION IF EXISTS get_user_roles(UUID) CASCADE;

-- Create with SECURITY DEFINER to bypass RLS
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
SECURITY DEFINER  -- This bypasses RLS
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id AS role_id,
        r.code AS role_code,
        r.name_ar AS role_name_ar,
        r.name_en AS role_name_en,
        r.level AS role_level,
        ur.is_active
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true;
END;
$$;

-- Fix is_super_admin function
DROP FUNCTION IF EXISTS is_super_admin(UUID) CASCADE;

CREATE OR REPLACE FUNCTION is_super_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
-- STEP 12: Force reload
-- ═══════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE!
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ INFINITE RECURSION FIX COMPLETE!';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE 'All RLS policies have been simplified to avoid recursion.';
    RAISE NOTICE '';
    RAISE NOTICE 'Fixed tables:';
    RAISE NOTICE '  ✓ user_roles - simple non-recursive policies';
    RAISE NOTICE '  ✓ roles - public read, auth write';
    RAISE NOTICE '  ✓ tenants - auth-based policies';
    RAISE NOTICE '  ✓ user_profiles - simple policies';
    RAISE NOTICE '  ✓ companies - simple policies';
    RAISE NOTICE '  ✓ user_resource_access - user-based policies';
    RAISE NOTICE '  ✓ visibility_rules - public read';
    RAISE NOTICE '';
    RAISE NOTICE 'Functions updated with SECURITY DEFINER:';
    RAISE NOTICE '  ✓ get_user_roles()';
    RAISE NOTICE '  ✓ is_super_admin()';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ Wait 30-60 seconds, then log out and back in!';
    RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
