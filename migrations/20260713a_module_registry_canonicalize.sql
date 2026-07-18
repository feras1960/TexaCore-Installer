-- ═══════════════════════════════════════════════════════════════════════════
-- BATCH A — Module-registry canonicalization
-- Plan: docs/PLAN_2026-07-13_modules_plans_unification.md
-- Goal: make the DB module registries (`modules` = /saas admin registry, and its
--       mirror `system_modules`) speak the CANONICAL vocabulary = the code's
--       STATIC_MODULES codes (src/config/modules.ts), so admin ↔ app ↔ plans align.
--
-- AUTHORITY DECISION (see report): `modules` is declared the single source of
--   truth for the module registry (it is what PlatformDetailSheet's plan picker
--   reads). `system_modules` is a legacy mirror still read by the /saas
--   "الموديولات" tab (saasModulesService) + modulesService, so it is canonicalized
--   IDENTICALLY here to keep both admin surfaces consistent until Batch F merges
--   the editors onto `modules` alone.
--
-- SCOPE: registry rows + repointing of reference tables ONLY. This migration does
--   NOT touch subscription_plans.included_modules (that is Batch C). See the
--   ⚠️ SEQUENCING WARNING at the bottom about the trg_plan_modules_sync trigger.
--
-- Idempotent + re-runnable. Wrapped in a single transaction. Rollback notes at end.
-- DO NOT auto-apply — Fable reviews & applies via psql (project apply-migration skill).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 0) Canonical vocabulary mapping (old DB code → canonical STATIC_MODULES code)
--      ecommerce   → e-commerce        (rename; target absent in both registries)
--      warehouse   → inventory         (MERGE; `inventory` already exists → drop warehouse)
--      workflows   → workflow_center   (rename; target absent in both registries)
--      realestate  → real_estate       (MERGE; `real_estate` already exists → drop realestate)
-- ───────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- 1) REPOINT REFERENCE TABLES FIRST  (preserve live-subscriber referential integrity)
--    There is NO FK from these tables to modules.module_code (loose coupling),
--    so we repoint by hand. For tables with a UNIQUE key that INCLUDES module_code
--    we MERGE: update the row to the canonical code where that would not collide,
--    otherwise DELETE the duplicate (the canonical row already exists & is active).
--
--    Live inspection (READ-ONLY) confirmed EVERY tenant that has 'warehouse' also
--    already has an ACTIVE 'inventory' tenant_modules row (same for realestate ⊂
--    real_estate), so the merge never removes a subscriber's access — gating
--    resolves /warehouse → code 'inventory', which already exists.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1a) tenant_modules  — UNIQUE(tenant_id, module_code)
--     Live counts before: ecommerce=6, warehouse=6(all also have inventory=6),
--                         workflows=5, realestate=1(also has real_estate=1). All is_active=true.
DO $$
DECLARE
  m RECORD;
BEGIN
  FOR m IN SELECT * FROM (VALUES
      ('ecommerce','e-commerce'),
      ('warehouse','inventory'),
      ('workflows','workflow_center'),
      ('realestate','real_estate')
  ) AS v(old_code, new_code)
  LOOP
    -- repoint where no collision with an existing canonical row for the same tenant
    UPDATE tenant_modules t
       SET module_code = m.new_code, updated_at = now()
     WHERE t.module_code = m.old_code
       AND NOT EXISTS (
         SELECT 1 FROM tenant_modules t2
          WHERE t2.tenant_id = t.tenant_id AND t2.module_code = m.new_code);
    -- drop leftover duplicates (tenant already has the canonical row)
    DELETE FROM tenant_modules t
     WHERE t.module_code = m.old_code
       AND EXISTS (
         SELECT 1 FROM tenant_modules t2
          WHERE t2.tenant_id = t.tenant_id AND t2.module_code = m.new_code);
  END LOOP;
END $$;

-- 1b) user_module_permissions — UNIQUE(user_id, tenant_id, company_id, module_code)
--     Live: only 'ecommerce'(1) present among the four; others 0-row (defensive).
DO $$
DECLARE
  m RECORD;
BEGIN
  FOR m IN SELECT * FROM (VALUES
      ('ecommerce','e-commerce'),
      ('warehouse','inventory'),
      ('workflows','workflow_center'),
      ('realestate','real_estate')
  ) AS v(old_code, new_code)
  LOOP
    UPDATE user_module_permissions u
       SET module_code = m.new_code
     WHERE u.module_code = m.old_code
       AND NOT EXISTS (
         SELECT 1 FROM user_module_permissions u2
          WHERE u2.user_id = u.user_id
            AND u2.tenant_id = u.tenant_id
            AND u2.company_id IS NOT DISTINCT FROM u.company_id
            AND u2.module_code = m.new_code);
    DELETE FROM user_module_permissions u
     WHERE u.module_code = m.old_code
       AND EXISTS (
         SELECT 1 FROM user_module_permissions u2
          WHERE u2.user_id = u.user_id
            AND u2.tenant_id = u.tenant_id
            AND u2.company_id IS NOT DISTINCT FROM u.company_id
            AND u2.module_code = m.new_code);
  END LOOP;
END $$;

-- 1c) Catalog / tab tables — VERIFIED to contain NONE of the four old codes today
--     (they only reference accounting/fabric/inventory/sales, already canonical),
--     so these statements affect 0 rows now; kept for idempotent completeness in
--     case of data drift before Fable applies. ui_tabs has no unique on module_code
--     (plain rename); module_features / plan_module_features dedup on their unique keys.
--     user_feature_permissions is 0-row and FK-bound to module_features — left untouched.
DO $$
DECLARE
  m RECORD;
BEGIN
  FOR m IN SELECT * FROM (VALUES
      ('ecommerce','e-commerce'),
      ('warehouse','inventory'),
      ('workflows','workflow_center'),
      ('realestate','real_estate')
  ) AS v(old_code, new_code)
  LOOP
    -- ui_tabs: module_code not part of any unique key
    UPDATE ui_tabs SET module_code = m.new_code, updated_at = now()
     WHERE module_code = m.old_code;

    -- module_features: UNIQUE(module_code, feature_code)
    UPDATE module_features mf SET module_code = m.new_code
     WHERE mf.module_code = m.old_code
       AND NOT EXISTS (SELECT 1 FROM module_features x
                        WHERE x.module_code = m.new_code AND x.feature_code = mf.feature_code);
    DELETE FROM module_features mf
     WHERE mf.module_code = m.old_code
       AND EXISTS (SELECT 1 FROM module_features x
                    WHERE x.module_code = m.new_code AND x.feature_code = mf.feature_code);

    -- plan_module_features: UNIQUE(plan_id, module_code, feature_code)
    UPDATE plan_module_features pf SET module_code = m.new_code
     WHERE pf.module_code = m.old_code
       AND NOT EXISTS (SELECT 1 FROM plan_module_features x
                        WHERE x.plan_id = pf.plan_id AND x.module_code = m.new_code
                          AND x.feature_code = pf.feature_code);
    DELETE FROM plan_module_features pf
     WHERE pf.module_code = m.old_code
       AND EXISTS (SELECT 1 FROM plan_module_features x
                    WHERE x.plan_id = pf.plan_id AND x.module_code = m.new_code
                      AND x.feature_code = pf.feature_code);
  END LOOP;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2) CANONICALIZE THE `modules` REGISTRY  (authoritative /saas registry)
-- ═══════════════════════════════════════════════════════════════════════════

-- 2a) Renames (guarded: skip if canonical row already exists from a prior run)
UPDATE modules
   SET module_code = 'e-commerce', updated_at = now()
 WHERE module_code = 'ecommerce'
   AND NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'e-commerce');

UPDATE modules
   SET module_code = 'workflow_center',
       name_ar = 'سير العمل', name_en = 'Workflow Center',
       name_ru = COALESCE(name_ru,'Рабочие процессы'),
       name_uk = COALESCE(name_uk,'Робочі процеси'),
       category = 'operations', updated_at = now()
 WHERE module_code = 'workflows'
   AND NOT EXISTS (SELECT 1 FROM modules WHERE module_code = 'workflow_center');

-- 2b) Merges — drop the duplicate legacy code (references already repointed in §1)
DELETE FROM modules WHERE module_code = 'warehouse'
   AND EXISTS (SELECT 1 FROM modules WHERE module_code = 'inventory');
DELETE FROM modules WHERE module_code = 'realestate'
   AND EXISTS (SELECT 1 FROM modules WHERE module_code = 'real_estate');

-- 2c) is_super_admin flag column (platform-admin-only modules never sold) — Batch F reads it
ALTER TABLE modules ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

-- 2d) Add the missing canonical modules (e-commerce & workflow_center handled by rename).
--     modules currently LACKS pbx too, so 7 physical inserts here → 9 canonical present.
INSERT INTO modules (module_code, name_ar, name_en, name_ru, name_uk, category, icon,
                     display_order, is_active, is_core, is_super_admin)
VALUES
  ('pbx',                 'المقسم السحابي',      'Cloud PBX',           'Облачная АТС',   'Хмарна АТС',        'advanced',    'Phone',            45, true, false, false),
  ('growth-ai',           'النمو والوكيل الذكي',  'Growth & AI Agent',   'Рост и AI-агент','Зростання та AI-агент','ai',       'Sparkles',         47, true, false, false),
  ('market_intelligence', 'استخبارات السوق',      'Market Intelligence', 'Аналитика рынка','Ринкова аналітика', 'advanced',   'Radar',            48, true, false, false),
  ('support_mdm',         'الدعم وإدارة الأجهزة', 'Support & MDM',       'Поддержка и MDM','Підтримка та MDM',  'advanced',   'MonitorSmartphone',49, true, false, false),
  ('general_trade',       'التجارة العامة',       'General Trade',       'Общая торговля', 'Загальна торгівля', 'specialized','ShoppingBag',      50, true, false, false),
  ('vehicles',            'معارض السيارات',       'Car Showrooms',       'Автосалоны',     'Автосалони',        'specialized','Car',              51, true, false, false),
  ('system_verify',       'التحقق من النظام',     'System Audit',        NULL,             NULL,                'development','ShieldAlert',     120, true, false, true)
ON CONFLICT (module_code) DO NOTHING;

-- 2e) Archive phantoms — keep for historical plan references, hide from admin UI
UPDATE modules
   SET is_active = false, updated_at = now()
 WHERE module_code IN ('ai','analytics','api','companies','core','customers',
                       'projects','settings','shipments','suppliers','treasury','users','wms')
   AND is_active IS DISTINCT FROM false;

-- 2f) Flag platform-admin-only modules (never sellable)
UPDATE modules
   SET is_super_admin = true, updated_at = now()
 WHERE module_code IN ('saas','system_verify','component_lab')
   AND is_super_admin IS DISTINCT FROM true;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3) MIRROR THE SAME CANONICALIZATION ONTO `system_modules`
--    (legacy registry; column is `code`, UNIQUE(code); no name_ru/name_uk cols.
--     system_modules ALREADY has pbx + crm, so only 6 inserts here.)
-- ═══════════════════════════════════════════════════════════════════════════

-- 3a) Renames
UPDATE system_modules
   SET code = 'e-commerce', updated_at = now()
 WHERE code = 'ecommerce'
   AND NOT EXISTS (SELECT 1 FROM system_modules WHERE code = 'e-commerce');

UPDATE system_modules
   SET code = 'workflow_center', name_ar = 'سير العمل', name_en = 'Workflow Center',
       category = 'operations', updated_at = now()
 WHERE code = 'workflows'
   AND NOT EXISTS (SELECT 1 FROM system_modules WHERE code = 'workflow_center');

-- 3b) Merges
DELETE FROM system_modules WHERE code = 'warehouse'
   AND EXISTS (SELECT 1 FROM system_modules WHERE code = 'inventory');
DELETE FROM system_modules WHERE code = 'realestate'
   AND EXISTS (SELECT 1 FROM system_modules WHERE code = 'real_estate');

-- 3c) is_super_admin flag column
ALTER TABLE system_modules ADD COLUMN IF NOT EXISTS is_super_admin boolean NOT NULL DEFAULT false;

-- 3d) Add missing canonical modules (pbx already present here)
INSERT INTO system_modules (code, name_ar, name_en, category, icon, display_order,
                            is_active, is_core, is_super_admin, available_in_products)
VALUES
  ('growth-ai',           'النمو والوكيل الذكي',  'Growth & AI Agent',   'ai',          'Sparkles',          47, true, false, false, '["*"]'),
  ('market_intelligence', 'استخبارات السوق',      'Market Intelligence', 'advanced',    'Radar',             48, true, false, false, '["*"]'),
  ('support_mdm',         'الدعم وإدارة الأجهزة', 'Support & MDM',       'advanced',    'MonitorSmartphone', 49, true, false, false, '["*"]'),
  ('general_trade',       'التجارة العامة',       'General Trade',       'specialized', 'ShoppingBag',       50, true, false, false, '["*"]'),
  ('vehicles',            'معارض السيارات',       'Car Showrooms',       'specialized', 'Car',               51, true, false, false, '["*"]'),
  ('system_verify',       'التحقق من النظام',     'System Audit',        'development', 'ShieldAlert',      120, true, false, true,  '["*"]')
ON CONFLICT (code) DO NOTHING;

-- 3e) Archive phantoms
UPDATE system_modules
   SET is_active = false, updated_at = now()
 WHERE code IN ('ai','analytics','api','companies','core','customers',
                'projects','settings','shipments','suppliers','treasury','users','wms')
   AND is_active IS DISTINCT FROM false;

-- 3f) Flag platform-admin-only modules
UPDATE system_modules
   SET is_super_admin = true, updated_at = now()
 WHERE code IN ('saas','system_verify','component_lab')
   AND is_super_admin IS DISTINCT FROM true;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4) REPOINT RBAC / PLATFORM-PRODUCT ARRAY REFERENCES (module codes stored in ARRAYs)
--    Live inspection found the four legacy codes inside:
--      • roles.visible_modules          (RBAC per-role visibility): ecommerce, realestate, warehouse, workflows
--      • saas_products.default_modules  (platform default modules; read by PlatformDetailSheet): ecommerce
--    Without this, PlatformDetailSheet (matches saas_products.default_modules against
--    modules.module_code) and RBAC visibility would stop matching the renamed rows.
--    Rebuild each array with the canonical mapping + DISTINCT (drops any duplicate that
--    would arise where the canonical code is already present, e.g. warehouse⊕inventory).
--    Phantom codes (core/users/companies/settings/wms) are intentionally LEFT in the
--    arrays — they are only archived (is_active=false), not renamed.
--    NOTE: plan_modules (FK plan_modules.module_id → system_modules.id) references by
--    UUID, so it auto-follows the renames; the two deleted rows (warehouse, realestate)
--    have 0 plan_modules references (verified), so §3 deletes cannot break that FK.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE roles r
   SET visible_modules = sub.arr
  FROM (
    SELECT r2.id,
           (SELECT array_agg(DISTINCT CASE elem
                     WHEN 'ecommerce'  THEN 'e-commerce'
                     WHEN 'warehouse'  THEN 'inventory'
                     WHEN 'workflows'  THEN 'workflow_center'
                     WHEN 'realestate' THEN 'real_estate'
                     ELSE elem END)
              FROM unnest(r2.visible_modules) AS elem) AS arr
      FROM roles r2
     WHERE r2.visible_modules && ARRAY['ecommerce','warehouse','workflows','realestate']::text[]
  ) sub
 WHERE r.id = sub.id;

-- [installer-adapt] saas_products.default_modules is text[] on cloud but jsonb
-- on the local hybrid schema. unnest()/&& only apply to the array form; guard by
-- column type so this repoint runs on cloud and safely skips locally.
DO $mrc_saas$
BEGIN
  IF (SELECT udt_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name='saas_products'
          AND column_name='default_modules') = '_text' THEN
    UPDATE saas_products sp
       SET default_modules = sub.arr
      FROM (
        SELECT sp2.id,
               (SELECT array_agg(DISTINCT CASE elem
                         WHEN 'ecommerce'  THEN 'e-commerce'
                         WHEN 'warehouse'  THEN 'inventory'
                         WHEN 'workflows'  THEN 'workflow_center'
                         WHEN 'realestate' THEN 'real_estate'
                         ELSE elem END)
                  FROM unnest(sp2.default_modules) AS elem) AS arr
          FROM saas_products sp2
         WHERE sp2.default_modules && ARRAY['ecommerce','warehouse','workflows','realestate']::text[]
      ) sub
     WHERE sp.id = sub.id;
  ELSE
    RAISE NOTICE 'skip saas_products.default_modules repoint on local (jsonb schema)';
  END IF;
END $mrc_saas$;


COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ SEQUENCING WARNING (for Fable) — trg_plan_modules_sync
--   subscription_plans.included_modules STILL contains the legacy codes
--   (ecommerce/warehouse/workflows/realestate + phantoms). The trigger
--   `trg_plan_modules_sync` (fn trg_sync_plan_modules) repopulates tenant_modules
--   FROM included_modules on ANY edit to a plan. If a plan is edited AFTER this
--   migration but BEFORE Batch C canonicalizes included_modules, the trigger will
--   RE-INSERT the legacy codes into tenant_modules (re-diverging from §1).
--   → Apply Batch A and Batch C in the SAME maintenance window, and do NOT edit
--     subscription_plans between them. Batch A alone is safe (no plan edits occur
--     during the migration itself); the risk is only manual/UI plan edits in the gap.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK  (manual; run inside its own BEGIN/COMMIT if needed)
--   NOTE: renames/merges of tenant_modules are lossy (merged duplicate rows are
--   deleted), so a perfect data rollback is not possible. This restores the
--   REGISTRY vocabulary and the added column/flags; tenant_modules would be
--   re-derived by the sync trigger from included_modules on the next plan edit.
--
-- BEGIN;
--   -- undo registry renames
--   UPDATE modules        SET module_code='ecommerce' WHERE module_code='e-commerce';
--   UPDATE modules        SET module_code='workflows' WHERE module_code='workflow_center';
--   UPDATE system_modules SET code='ecommerce'        WHERE code='e-commerce';
--   UPDATE system_modules SET code='workflows'        WHERE code='workflow_center';
--   -- remove the modules added by this migration
--   DELETE FROM modules        WHERE module_code IN ('pbx','growth-ai','market_intelligence','support_mdm','general_trade','vehicles','system_verify');
--   DELETE FROM system_modules WHERE code        IN ('growth-ai','market_intelligence','support_mdm','general_trade','vehicles','system_verify');
--   -- un-archive phantoms
--   UPDATE modules        SET is_active=true WHERE module_code IN ('ai','analytics','api','companies','core','customers','projects','settings','shipments','suppliers','treasury','users','wms');
--   UPDATE system_modules SET is_active=true WHERE code        IN ('ai','analytics','api','companies','core','customers','projects','settings','shipments','suppliers','treasury','users','wms');
--   -- reverse the RBAC / platform-product array renames (order not preserved)
--   UPDATE roles         SET visible_modules = (SELECT array_agg(DISTINCT CASE elem WHEN 'e-commerce' THEN 'ecommerce' WHEN 'workflow_center' THEN 'workflows' ELSE elem END) FROM unnest(visible_modules) elem) WHERE visible_modules && ARRAY['e-commerce','workflow_center']::text[];
--   UPDATE saas_products SET default_modules = (SELECT array_agg(DISTINCT CASE elem WHEN 'e-commerce' THEN 'ecommerce' WHEN 'workflow_center' THEN 'workflows' ELSE elem END) FROM unnest(default_modules) elem) WHERE default_modules && ARRAY['e-commerce','workflow_center']::text[];
--   -- drop the flag column (also clears the flags)
--   ALTER TABLE modules        DROP COLUMN IF EXISTS is_super_admin;
--   ALTER TABLE system_modules DROP COLUMN IF EXISTS is_super_admin;
--   -- (warehouse/inventory & realestate/real_estate merges + tenant_modules repoints
--   --  are NOT restorable to their exact prior rows; rely on the sync trigger.)
-- COMMIT;
-- ═══════════════════════════════════════════════════════════════════════════
