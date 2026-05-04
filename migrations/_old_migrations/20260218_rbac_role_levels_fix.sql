-- ═══════════════════════════════════════════════════════════════
-- MIGRATION: Fix Role Levels & Owner Role Full Access
-- Date: 2026-02-18
-- Status: ALREADY EXECUTED on live DB
-- ═══════════════════════════════════════════════════════════════
-- 
-- BUG: Original migration (20260206_rbac_schema_fixes.sql) had a 
-- SQL precedence bug in line 84:
--   WHERE code IN (...) AND level IS NULL OR level = 'operations'
-- Missing parentheses caused ALL 'operations' roles to become 'tenant'!
-- 
-- This migration corrects the levels and ensures owner roles have
-- full access to all modules.
-- ═══════════════════════════════════════════════════════════════

-- 0. Update the check constraint to allow 'special'
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_level_check;
ALTER TABLE roles ADD CONSTRAINT roles_level_check CHECK (level::text = ANY (ARRAY['system'::character varying, 'tenant'::character varying, 'company'::character varying, 'branch'::character varying, 'operations'::character varying, 'custom'::character varying, 'special'::character varying]::text[]));

-- 1. Fix company_owner: should be 'company' not 'tenant'
UPDATE roles SET level = 'company' 
WHERE code = 'company_owner' AND level = 'tenant';

-- 2. Fix auditor: should be 'special' not 'tenant'
UPDATE roles SET level = 'special' 
WHERE code = 'auditor' AND level = 'tenant';

-- 3. Fix employee: should be 'operations' not 'tenant'
UPDATE roles SET level = 'operations' 
WHERE code = 'employee' AND level = 'tenant';

-- 4. Fix purchaser: should be 'operations' not 'tenant'
UPDATE roles SET level = 'operations' 
WHERE code = 'purchaser' AND level = 'tenant';

-- 5. Fix driver/agent if they exist
UPDATE roles SET level = 'operations' 
WHERE code IN ('driver', 'agent') AND level = 'tenant';

-- 6. Ensure tenant_owner has ALL modules + full permissions
UPDATE roles SET 
    visible_modules = ARRAY[
        'dashboard', 'accounting', 'treasury', 'sales', 'purchases', 
        'inventory', 'warehouse', 'fabric', 'pharmacy', 'healthcare', 
        'doctors', 'restaurant', 'gold', 'shipments', 'crm', 'pos', 
        'real_estate', 'exchange', 'manufacturing', 'hr', 'e-commerce', 
        'saas', 'ai_analytics', 'activity_log', 'system_config', 'reports'
    ],
    permissions = '{"all": true}'::jsonb
WHERE code = 'tenant_owner';

-- 7. Ensure company_owner has ALL modules + full permissions
UPDATE roles SET 
    visible_modules = ARRAY[
        'dashboard', 'accounting', 'treasury', 'sales', 'purchases', 
        'inventory', 'warehouse', 'fabric', 'pharmacy', 'healthcare', 
        'doctors', 'restaurant', 'gold', 'shipments', 'crm', 'pos', 
        'real_estate', 'exchange', 'manufacturing', 'hr', 'e-commerce', 
        'saas', 'ai_analytics', 'activity_log', 'system_config', 'reports'
    ],
    permissions = '{"all": true}'::jsonb
WHERE code = 'company_owner';

-- ═══════════════════════════════════════════════════════════════
-- VERIFICATION QUERY (run manually to confirm):
-- SELECT code, level, array_length(visible_modules, 1) as modules
-- FROM roles ORDER BY level, code;
-- ═══════════════════════════════════════════════════════════════
