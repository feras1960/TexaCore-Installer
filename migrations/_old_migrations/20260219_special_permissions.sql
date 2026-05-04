-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Special Permissions for RBAC
-- Date: 2026-02-19
-- Purpose: Add special_permissions JSONB to roles table + helper function
-- Step: 1 of RBAC Implementation Plan
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. Add special_permissions column to roles table
-- ═══════════════════════════════════════════════════════════════

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'roles' 
        AND column_name = 'special_permissions'
        AND table_schema = 'public'
    ) THEN
        ALTER TABLE roles ADD COLUMN special_permissions JSONB DEFAULT '{}'::jsonb;
        RAISE NOTICE '✅ Added special_permissions column to roles table';
    ELSE
        RAISE NOTICE '⚠️ special_permissions column already exists — skipping';
    END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 2. Create check_special_permission function
-- ═══════════════════════════════════════════════════════════════
-- Returns TRUE if the user has the specified special permission
-- through any of their active roles.
-- 
-- Priority logic:
--   1. super_admin → always TRUE
--   2. Check special_permissions JSONB on role
--   3. Fallback → FALSE

CREATE OR REPLACE FUNCTION check_special_permission(
    p_user_id UUID,
    p_perm_name TEXT
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
              -- super_admin / tenant_owner / company_owner always have all permissions
              r.code IN ('super_admin', 'tenant_owner', 'company_owner')
              -- Or the role explicitly has this special permission
              OR (r.special_permissions IS NOT NULL 
                  AND (r.special_permissions ->> p_perm_name)::boolean = true)
          )
    ) INTO v_has_permission;
    
    RETURN v_has_permission;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════
-- 3. Create get_user_special_permissions function
-- ═══════════════════════════════════════════════════════════════
-- Returns merged special_permissions for a user across all roles

CREATE OR REPLACE FUNCTION get_user_special_permissions(p_user_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_permissions JSONB := '{}'::jsonb;
    v_role_sp JSONB;
    v_is_super BOOLEAN := false;
BEGIN
    -- Check if user is super_admin / tenant_owner / company_owner
    SELECT EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
          AND ur.is_active = true
          AND r.code IN ('super_admin', 'tenant_owner', 'company_owner')
    ) INTO v_is_super;
    
    -- If super_admin / tenant_owner / company_owner, return all permissions as true
    IF v_is_super THEN
        RETURN '{
            "can_edit_posted_purchase": true,
            "can_edit_posted_sale": true,
            "can_edit_posted_journal": true,
            "can_delete_posted": true,
            "can_unpost": true,
            "can_edit_closed_period": true,
            "can_view_audit_log": true,
            "can_view_all_branches": true,
            "can_manage_roles": true,
            "can_approve_transactions": true,
            "can_view_cost_prices": true,
            "can_view_profit_margins": true,
            "can_export_data": true,
            "can_manage_containers": true
        }'::jsonb;
    END IF;
    
    -- Merge special_permissions from all active roles
    FOR v_role_sp IN
        SELECT COALESCE(r.special_permissions, '{}'::jsonb)
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
          AND ur.is_active = true
          AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
          AND r.special_permissions IS NOT NULL
    LOOP
        -- Merge: true overrides false (permissive merge)
        v_permissions := v_permissions || v_role_sp;
    END LOOP;
    
    RETURN v_permissions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════
-- 4. Update default roles with special_permissions
-- ═══════════════════════════════════════════════════════════════
-- ⚠️ super_admin is NOT updated here — the function handles it 
-- automatically (always returns true for all permissions)

-- tenant_owner — full special permissions
UPDATE roles SET special_permissions = '{
    "can_edit_posted_purchase": true,
    "can_edit_posted_sale": true,
    "can_edit_posted_journal": true,
    "can_delete_posted": true,
    "can_unpost": true,
    "can_edit_closed_period": true,
    "can_view_audit_log": true,
    "can_view_all_branches": true,
    "can_manage_roles": true,
    "can_approve_transactions": true,
    "can_view_cost_prices": true,
    "can_view_profit_margins": true,
    "can_export_data": true,
    "can_manage_containers": true
}'::jsonb
WHERE code = 'tenant_owner';

-- company_owner — full special permissions (same as tenant_owner within company scope)
UPDATE roles SET special_permissions = '{
    "can_edit_posted_purchase": true,
    "can_edit_posted_sale": true,
    "can_edit_posted_journal": true,
    "can_delete_posted": true,
    "can_unpost": true,
    "can_edit_closed_period": true,
    "can_view_audit_log": true,
    "can_view_all_branches": true,
    "can_manage_roles": true,
    "can_approve_transactions": true,
    "can_view_cost_prices": true,
    "can_view_profit_margins": true,
    "can_export_data": true,
    "can_manage_containers": true
}'::jsonb
WHERE code = 'company_owner';

-- company_admin — most permissions, no edit closed period or delete posted
UPDATE roles SET special_permissions = '{
    "can_edit_posted_purchase": true,
    "can_edit_posted_sale": true,
    "can_edit_posted_journal": true,
    "can_delete_posted": false,
    "can_unpost": true,
    "can_edit_closed_period": false,
    "can_view_audit_log": true,
    "can_view_all_branches": true,
    "can_manage_roles": true,
    "can_approve_transactions": true,
    "can_view_cost_prices": true,
    "can_view_profit_margins": true,
    "can_export_data": true,
    "can_manage_containers": true
}'::jsonb
WHERE code = 'company_admin';

-- branch_manager — operational permissions
UPDATE roles SET special_permissions = '{
    "can_edit_posted_purchase": false,
    "can_edit_posted_sale": false,
    "can_edit_posted_journal": false,
    "can_delete_posted": false,
    "can_unpost": false,
    "can_edit_closed_period": false,
    "can_view_audit_log": true,
    "can_view_all_branches": false,
    "can_manage_roles": false,
    "can_approve_transactions": true,
    "can_view_cost_prices": true,
    "can_view_profit_margins": false,
    "can_export_data": true,
    "can_manage_containers": true
}'::jsonb
WHERE code = 'branch_manager';

-- accountant — financial view + limited edit
UPDATE roles SET special_permissions = '{
    "can_edit_posted_purchase": false,
    "can_edit_posted_sale": false,
    "can_edit_posted_journal": false,
    "can_delete_posted": false,
    "can_unpost": false,
    "can_edit_closed_period": false,
    "can_view_audit_log": true,
    "can_view_all_branches": true,
    "can_manage_roles": false,
    "can_approve_transactions": true,
    "can_view_cost_prices": true,
    "can_view_profit_margins": false,
    "can_export_data": true,
    "can_manage_containers": false
}'::jsonb
WHERE code = 'accountant';

-- cashier — minimal permissions
UPDATE roles SET special_permissions = '{
    "can_edit_posted_purchase": false,
    "can_edit_posted_sale": false,
    "can_edit_posted_journal": false,
    "can_delete_posted": false,
    "can_unpost": false,
    "can_edit_closed_period": false,
    "can_view_audit_log": false,
    "can_view_all_branches": false,
    "can_manage_roles": false,
    "can_approve_transactions": false,
    "can_view_cost_prices": false,
    "can_view_profit_margins": false,
    "can_export_data": false,
    "can_manage_containers": false
}'::jsonb
WHERE code = 'cashier';

-- warehouse_manager — warehouse-focused
UPDATE roles SET special_permissions = '{
    "can_edit_posted_purchase": false,
    "can_edit_posted_sale": false,
    "can_edit_posted_journal": false,
    "can_delete_posted": false,
    "can_unpost": false,
    "can_edit_closed_period": false,
    "can_view_audit_log": false,
    "can_view_all_branches": false,
    "can_manage_roles": false,
    "can_approve_transactions": false,
    "can_view_cost_prices": true,
    "can_view_profit_margins": false,
    "can_export_data": true,
    "can_manage_containers": true
}'::jsonb
WHERE code = 'warehouse_manager';

-- sales_rep — sales-focused, no sensitive data
UPDATE roles SET special_permissions = '{
    "can_edit_posted_purchase": false,
    "can_edit_posted_sale": false,
    "can_edit_posted_journal": false,
    "can_delete_posted": false,
    "can_unpost": false,
    "can_edit_closed_period": false,
    "can_view_audit_log": false,
    "can_view_all_branches": false,
    "can_manage_roles": false,
    "can_approve_transactions": false,
    "can_view_cost_prices": false,
    "can_view_profit_margins": false,
    "can_export_data": false,
    "can_manage_containers": false
}'::jsonb
WHERE code = 'sales_rep';

-- purchasing_manager — purchasing-focused
UPDATE roles SET special_permissions = '{
    "can_edit_posted_purchase": false,
    "can_edit_posted_sale": false,
    "can_edit_posted_journal": false,
    "can_delete_posted": false,
    "can_unpost": false,
    "can_edit_closed_period": false,
    "can_view_audit_log": false,
    "can_view_all_branches": false,
    "can_manage_roles": false,
    "can_approve_transactions": true,
    "can_view_cost_prices": true,
    "can_view_profit_margins": false,
    "can_export_data": true,
    "can_manage_containers": true
}'::jsonb
WHERE code = 'purchasing_manager';

-- viewer — read only, no special permissions
UPDATE roles SET special_permissions = '{
    "can_edit_posted_purchase": false,
    "can_edit_posted_sale": false,
    "can_edit_posted_journal": false,
    "can_delete_posted": false,
    "can_unpost": false,
    "can_edit_closed_period": false,
    "can_view_audit_log": false,
    "can_view_all_branches": false,
    "can_manage_roles": false,
    "can_approve_transactions": false,
    "can_view_cost_prices": false,
    "can_view_profit_margins": false,
    "can_export_data": false,
    "can_manage_containers": false
}'::jsonb
WHERE code = 'viewer';

-- ═══════════════════════════════════════════════════════════════
-- 5. Create index for performance
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_roles_special_perms 
ON roles USING gin (special_permissions) 
WHERE special_permissions IS NOT NULL AND special_permissions != '{}'::jsonb;

-- ═══════════════════════════════════════════════════════════════
-- ✅ Migration Complete!
-- ═══════════════════════════════════════════════════════════════
-- 
-- Added:
--   1. special_permissions JSONB column on roles table
--   2. check_special_permission(user_id, perm_name) function
--   3. get_user_special_permissions(user_id) function
--   4. Default special_permissions for 9 roles (super_admin handled by function)
--   5. GIN index for performance
--
-- 14 Special Permissions:
--   can_edit_posted_purchase, can_edit_posted_sale, can_edit_posted_journal,
--   can_delete_posted, can_unpost, can_edit_closed_period,
--   can_view_audit_log, can_view_all_branches, can_manage_roles,
--   can_approve_transactions, can_view_cost_prices, can_view_profit_margins,
--   can_export_data, can_manage_containers
-- ═══════════════════════════════════════════════════════════════
