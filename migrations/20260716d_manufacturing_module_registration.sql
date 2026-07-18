-- 20260716d: تسجيل موديول التصنيع (manufacturing) + دور production_manager
-- ═══════════════════════════════════════════════════════════════════════════
-- بنمط 20260703d_pbx_module_registration.sql:
--   • system_modules فيه صفّ 'manufacturing' مسبقاً (مزروع) — نُواءم الأيقونة فقط.
--   • ربط manufacturing في plan_modules لكل باقة تشمله في included_modules.
--   • backfill tenant_modules للمشتركين النشطين على باقة تشمله.
--   • + دور نظام production_manager (roles، tenant_id NULL، is_system) — بند §4-ج/20.
-- idempotent بالكامل.

BEGIN;

-- 1) مواءمة صفّ manufacturing في system_modules (الأيقونة كانت NULL).
UPDATE system_modules
   SET name_ar = 'التصنيع',
       name_en = 'Manufacturing',
       icon = COALESCE(NULLIF(icon, ''), 'Factory'),
       category = 'advanced',
       is_active = true
 WHERE code = 'manufacturing';

-- 2) ربط manufacturing في plan_modules لكل باقة تشمله فعلاً في included_modules.
INSERT INTO plan_modules (plan_id, module_id, is_enabled, is_core)
SELECT sp.id, sm.id, true, false
FROM subscription_plans sp
CROSS JOIN system_modules sm
WHERE sm.code = 'manufacturing'
  AND sp.included_modules ? 'manufacturing'  -- [installer-adapt] included_modules is jsonb locally (text[] on cloud)
  AND NOT EXISTS (
    SELECT 1 FROM plan_modules pm WHERE pm.plan_id = sp.id AND pm.module_id = sm.id
  );

-- 3) Backfill tenant_modules للمستأجرين النشطين على باقة تشمل manufacturing.
INSERT INTO tenant_modules (tenant_id, module_code, source, is_active, is_enabled)
SELECT DISTINCT ts.tenant_id, 'manufacturing', 'plan', true, true
FROM tenant_subscriptions ts
JOIN subscription_plans sp ON sp.id = ts.plan_id
WHERE ts.status IN ('active', 'trial', 'grace')
  AND sp.included_modules ? 'manufacturing'  -- [installer-adapt] included_modules is jsonb locally (text[] on cloud)
  AND NOT EXISTS (
    SELECT 1 FROM tenant_modules tm
    WHERE tm.tenant_id = ts.tenant_id AND tm.module_code = 'manufacturing'
  );

-- 4) دور نظام production_manager (بنمط أدوار النظام المزروعة: tenant_id NULL، is_system، can_be_deleted=false).
--    مستحقّاته للتصنيع (read+write) — يستقبل إشعارات الإنتاج (§4-ج بند 20).
INSERT INTO roles (
    tenant_id, code, name_ar, name_en, description,
    is_super_admin, is_system, level, can_be_deleted, icon, color,
    visible_modules, permissions, special_permissions
)
SELECT
    NULL, 'production_manager', 'مدير الإنتاج', 'Production Manager',
    'يشرف على أوامر الإنتاج والمراحل ومحطات العمل',
    false, true, 'operations', false, 'Factory', 'orange',
    ARRAY['dashboard','manufacturing']::text[],
    '{"manufacturing":["read","write"]}'::jsonb,
    '{}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE code = 'production_manager' AND tenant_id IS NULL
);

COMMIT;
