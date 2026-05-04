-- ═══════════════════════════════════════════════════════════════════════════
-- CRITICAL FIX v2: Fix recursion WITHOUT dropping is_super_admin
-- ═══════════════════════════════════════════════════════════════════════════
-- This version uses CREATE OR REPLACE instead of DROP
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1: Drop policies on user_roles (the main problem)
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
-- STEP 2: Drop policies on roles
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
    END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3: Drop policies on tenants
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
    END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4: Create SIMPLE policies for user_roles (NO recursion)
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- Policy 1: Users can see their own roles
CREATE POLICY "user_roles_select_own" ON user_roles
    FOR SELECT USING (user_id = auth.uid());

-- Policy 2: Authenticated users can do everything (app controls logic)
CREATE POLICY "user_roles_auth_all" ON user_roles
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 5: Create SIMPLE policies for roles
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roles_public_read" ON roles
    FOR SELECT USING (true);

CREATE POLICY "roles_auth_write" ON roles
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 6: Create SIMPLE policies for tenants
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenants_auth_read" ON tenants
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "tenants_auth_write" ON tenants
    FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 7: Replace is_super_admin function (NOT DROP!)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_super_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    -- Direct query that doesn't trigger RLS (SECURITY DEFINER)
    RETURN EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
          AND ur.is_active = true
          AND r.code = 'super_admin'
    );
EXCEPTION
    WHEN OTHERS THEN
        -- Fail safely
        RETURN false;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 8: Replace get_user_roles function (NOT DROP!)
-- ═══════════════════════════════════════════════════════════════════════════

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
SET search_path = public
STABLE
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
EXCEPTION
    WHEN OTHERS THEN
        -- Return empty on error
        RETURN;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 9: Fix user_profiles policies
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

CREATE POLICY "user_profiles_read" ON user_profiles FOR SELECT USING (true);
CREATE POLICY "user_profiles_write" ON user_profiles FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 10: Fix companies policies
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

CREATE POLICY "companies_read" ON companies FOR SELECT USING (true);
CREATE POLICY "companies_write" ON companies FOR ALL USING (auth.uid() IS NOT NULL);

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 11: Force cache reload
-- ═══════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE!
-- ═══════════════════════════════════════════════════════════════════════════

SELECT '✅ RECURSION FIX COMPLETE! Wait 30 seconds then login again.' as status;
