-- 20260717p: جعل موديول التصنيع (manufacturing) قابلاً للإدارة كاملاً من لوحة /saas
-- ═══════════════════════════════════════════════════════════════════════════
-- يكمّل ما بدأه 20260716d (تسجيل الموديول) بإغلاق فجوتين:
--   • إضافة manufacturing إلى الباقة الاحترافية (texa-professional) — قرار المالك:
--     التصنيع موديول متقدّم يخصّ الاحترافية والمؤسسات فقط. تحديث included_modules
--     يُشغّل trg_plan_modules_sync → sync_plan_modules_to_tenants فيتتالى على
--     tenant_modules لمشتركي الباقة.
--   • مزامنة جدول الربط plan_modules (قارئه محرّر الباقات في /saas) لكل باقة
--     تشمل manufacturing الآن (الاحترافية + المؤسسات).
--   • إثراء كتالوج module_features بالقدرات التي شُحنت فعلاً بعد seed 20260713d:
--     أجور القطعة، تتبّع الدُفعات، المقاولة من الباطن، الحقول المخصّصة.
-- idempotent بالكامل — قابل لإعادة التشغيل بلا أثر جانبي.

BEGIN;

-- ─── 1) إضافة manufacturing لقائمة موديولات الباقة الاحترافية (إن غابت) ───
--     UPDATE على included_modules يُشعل trg_plan_modules_sync (AFTER UPDATE OF
--     included_modules) الذي يتتالى إلى tenant_modules لكل مشترك احترافي نشِط.
UPDATE subscription_plans
   SET included_modules = included_modules || '["manufacturing"]'::jsonb  -- [installer-adapt] jsonb concat (array_append is text[]-only; local col is jsonb)
 WHERE code = 'texa-professional'
   AND NOT (included_modules ? 'manufacturing');

-- ─── 2) مزامنة plan_modules لكل باقة تشمل manufacturing الآن (احترافية + مؤسسات) ───
--     (نمط 20260716d، معمّم على كل باقة في included_modules).
INSERT INTO plan_modules (plan_id, module_id, is_enabled, is_core)
SELECT sp.id, sm.id, true, false
FROM subscription_plans sp
CROSS JOIN system_modules sm
WHERE sm.code = 'manufacturing'
  AND sp.included_modules ? 'manufacturing'  -- [installer-adapt] jsonb membership (local jsonb col)
  AND NOT EXISTS (
    SELECT 1 FROM plan_modules pm WHERE pm.plan_id = sp.id AND pm.module_id = sm.id
  );

-- ─── 3) إثراء كتالوج ميزات التصنيع بالقدرات المشحونة (P2/P3) ───
--     يتبع بنية أعمدة صفوف 20260713d بالضبط. ON CONFLICT DO NOTHING = idempotent.
INSERT INTO module_features
  (module_code, feature_code, feature_name_ar, feature_name_en, description_ar, description_en, icon, category, display_order)
VALUES
  ('manufacturing','piece_rate_labor','أجور القطعة','Piece-Rate Labor','تسجيل أجور العمّال بالقطعة وربطها بأوامر الإنتاج','Piece-rate labor logging tied to production orders','HardHat','advanced',7),
  ('manufacturing','batch_traceability','تتبّع الدُفعات والجودة','Batch Traceability & Quality','أرقام الدُفعات وتتبّع أثرها وفحوصات الجودة','Batch numbers, traceability & quality checks','ScanLine','advanced',8),
  ('manufacturing','subcontracting','المقاولة من الباطن','Subcontracting','مراحل إنتاج تُنفَّذ لدى مورّد خارجي','Production stages executed by an external vendor','Handshake','advanced',9),
  ('manufacturing','custom_fields','الحقول المخصّصة','Custom Fields','حقول ديناميكية على أوامر ومراحل الإنتاج','Dynamic fields on production orders & stages','SlidersHorizontal','advanced',10)
ON CONFLICT (module_code, feature_code) DO NOTHING;

COMMIT;
