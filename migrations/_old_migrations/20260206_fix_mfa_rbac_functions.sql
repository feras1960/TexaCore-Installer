-- ═══════════════════════════════════════════════════════════════════════════
-- FIX: Update MFA and RLS functions to use new RBAC schema
-- ═══════════════════════════════════════════════════════════════════════════
-- This fixes functions that were using old table/column names
-- Run this in Supabase Dashboard -> SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1: Fix is_mfa_required function
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_mfa_required(p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_system_enforce_all BOOLEAN;
    v_system_enforce_admins BOOLEAN;
    v_enforced_roles TEXT[];
    v_user_roles TEXT[];
BEGIN
    -- Get system settings
    SELECT enforce_for_all, enforce_for_admins, enforced_roles 
    INTO v_system_enforce_all, v_system_enforce_admins, v_enforced_roles
    FROM mfa_system_settings LIMIT 1;
    
    -- If enforced for all
    IF COALESCE(v_system_enforce_all, false) THEN
        RETURN true;
    END IF;
    
    -- Get user roles from the new schema
    SELECT array_agg(r.code::TEXT) INTO v_user_roles
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true;
    
    -- Check if user has an enforced role
    IF v_user_roles IS NOT NULL AND v_enforced_roles IS NOT NULL THEN
        IF v_user_roles && v_enforced_roles THEN
            RETURN true;
        END IF;
    END IF;
    
    -- If enforced for admins
    IF COALESCE(v_system_enforce_admins, false) AND v_user_roles IS NOT NULL THEN
        IF v_user_roles && ARRAY['super_admin', 'tenant_owner', 'company_admin']::TEXT[] THEN
            RETURN true;
        END IF;
    END IF;
    
    RETURN false;
EXCEPTION
    WHEN OTHERS THEN
        -- If any error, return false (don't block user)
        RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2: Fix get_mfa_status function
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_mfa_status(p_user_id UUID DEFAULT auth.uid())
RETURNS TABLE (
    service_enabled BOOLEAN,
    is_required BOOLEAN,
    user_enabled BOOLEAN,
    can_enable BOOLEAN,
    preferred_method TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(ss.is_enabled, false),
        is_mfa_required(p_user_id),
        COALESCE(us.is_enabled, false),
        COALESCE(ss.is_enabled, false),
        COALESCE(us.preferred_method, 'totp')::TEXT
    FROM mfa_system_settings ss
    LEFT JOIN mfa_user_settings us ON us.user_id = p_user_id
    LIMIT 1;
EXCEPTION
    WHEN OTHERS THEN
        -- Return default values if error
        RETURN QUERY SELECT false, false, false, false, 'totp'::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3: Fix any RLS policies that use old column names
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop and recreate the admin check policies if they exist
DO $$
BEGIN
    -- These may not exist, so we use IF EXISTS pattern
    IF EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'user_roles'
        AND policyname = 'user_roles_admin_all'
    ) THEN
        DROP POLICY "user_roles_admin_all" ON user_roles;
    END IF;
END $$;

-- Recreate with correct column references
DROP POLICY IF EXISTS "user_roles_admin_all" ON user_roles;
CREATE POLICY "user_roles_admin_all" ON user_roles
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = auth.uid()
            AND r.code IN ('super_admin', 'tenant_owner', 'company_admin')
            AND ur.is_active = true
        )
    );

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 4: Create helper function to check if user is admin
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION is_admin_user(p_user_id UUID DEFAULT auth.uid())
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
          AND r.code IN ('super_admin', 'tenant_owner', 'company_admin')
    );
EXCEPTION
    WHEN OTHERS THEN
        RETURN false;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 5: Notify PostgREST to reload
-- ═══════════════════════════════════════════════════════════════════════════

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════════════
-- DONE!
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
    RAISE NOTICE '✅ MFA and RLS functions fixed successfully!';
    RAISE NOTICE '';
    RAISE NOTICE 'Updated functions:';
    RAISE NOTICE '  - is_mfa_required()';
    RAISE NOTICE '  - get_mfa_status()';
    RAISE NOTICE '  - is_admin_user()';
END $$;
