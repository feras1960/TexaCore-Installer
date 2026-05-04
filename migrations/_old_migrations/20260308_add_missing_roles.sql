-- ═══════════════════════════════════════════════════════════════════════════
-- إضافة الأدوار المفقودة - Add Missing Roles
-- Date: 2026-03-08
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. مالك الشركة (Company Owner) — إذا غير موجود
INSERT INTO roles (code, name_ar, name_en, level, is_system, can_be_deleted, icon, color, visible_modules, permissions)
SELECT 'company_owner', 'مالك الشركة', 'Company Owner', 'company', true, false, 'Crown', 'amber',
    ARRAY['dashboard', 'accounting', 'treasury', 'sales', 'purchases', 'inventory', 'warehouse', 
          'fabric', 'shipments', 'crm', 'pos', 'manufacturing', 'hr', 'activity_log', 'system_config', 'reports'],
    '{"all": ["read", "write", "delete"]}'::JSONB
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'company_owner');

-- 2. السائق (Driver)
INSERT INTO roles (code, name_ar, name_en, level, is_system, can_be_deleted, icon, color, visible_modules, permissions, display_order)
SELECT 'driver', 'سائق', 'Driver', 'operations', true, false, 'Truck', 'cyan',
    ARRAY['dashboard'],
    '{"delivery": ["read", "write"]}'::JSONB,
    130
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'driver');

-- 3. العتّال / جامع المواد (Picker)  
INSERT INTO roles (code, name_ar, name_en, level, is_system, can_be_deleted, icon, color, visible_modules, permissions, display_order)
SELECT 'picker', 'عتّال', 'Picker', 'operations', true, false, 'Package', 'violet',
    ARRAY['dashboard', 'warehouse', 'inventory'],
    '{"warehouse": ["read", "write"], "inventory": ["read"]}'::JSONB,
    135
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'picker');

-- 4. مسؤول المشتريات (Purchaser) — إذا غير موجود
INSERT INTO roles (code, name_ar, name_en, level, is_system, can_be_deleted, icon, color, visible_modules, permissions, display_order)
SELECT 'purchaser', 'مسؤول مشتريات', 'Purchaser', 'operations', true, false, 'ShoppingCart', 'lime',
    ARRAY['dashboard', 'purchases', 'inventory', 'shipments'],
    '{"purchases": ["read", "write", "delete"], "inventory": ["read"], "suppliers": ["read", "write"]}'::JSONB,
    85
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'purchaser');

-- 5. الموظف (Employee) — إذا غير موجود
INSERT INTO roles (code, name_ar, name_en, level, is_system, can_be_deleted, icon, color, visible_modules, permissions, display_order)
SELECT 'employee', 'موظف', 'Employee', 'operations', true, false, 'User', 'slate',
    ARRAY['dashboard'],
    '{"dashboard": ["read"]}'::JSONB,
    140
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'employee');

-- 6. المدقق (Auditor) — إذا غير موجود
INSERT INTO roles (code, name_ar, name_en, level, is_system, can_be_deleted, icon, color, visible_modules, permissions, display_order)
SELECT 'auditor', 'مدقق', 'Auditor', 'special', true, false, 'ClipboardCheck', 'gray',
    ARRAY['dashboard', 'accounting', 'reports', 'activity_log'],
    '{"accounting": ["read"], "reports": ["read"], "activity_log": ["read"]}'::JSONB,
    150
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'auditor');

-- 7. الوكيل (Agent) — إذا غير موجود
INSERT INTO roles (code, name_ar, name_en, level, is_system, can_be_deleted, icon, color, visible_modules, permissions, display_order)
SELECT 'agent', 'وكيل', 'Agent', 'operations', true, false, 'UserCircle', 'rose',
    ARRAY['dashboard', 'sales', 'crm'],
    '{"sales": ["read", "write"], "crm": ["read", "write"]}'::JSONB,
    120
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = 'agent');

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
    RAISE NOTICE '✅ Missing roles added successfully!';
    RAISE NOTICE '  ✓ company_owner - مالك الشركة';
    RAISE NOTICE '  ✓ driver - سائق';
    RAISE NOTICE '  ✓ picker - عتّال';
    RAISE NOTICE '  ✓ purchaser - مسؤول مشتريات';
    RAISE NOTICE '  ✓ employee - موظف';
    RAISE NOTICE '  ✓ auditor - مدقق';
    RAISE NOTICE '  ✓ agent - وكيل';
END $$;
