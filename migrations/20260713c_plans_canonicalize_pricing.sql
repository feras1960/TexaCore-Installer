-- ═══════════════════════════════════════════════════════════════════════════
-- BATCH C — texacore plans: canonicalize included_modules + pricing/invoice caps + archive dups
-- Plan: docs/PLAN_2026-07-13_modules_plans_unification.md
-- Scope: ONLY texacore product (id 25fdcf30-ebd3-468d-993a-8ca5fdd8fb94) + its free plan.
--        Never touches other products (nexacore/fincore/medcore/inducore/erp-saas).
-- Prereq: Batch A applied (module registry canonical). Apply A+C same window (trg_plan_modules_sync).
-- Rollback: restore from snapshot ~/Desktop/TexaCore_Backups_Archive/module-plan-snapshots/
--           snapshot_pre-unification_2026-07-13.json (subscription_plans array has exact prior values).
-- ═══════════════════════════════════════════════════════════════════════════

-- Canonical module sets (STATIC_MODULES vocab). Core-3 (dashboard/system_config/activity_log)
-- are ALWAYS_ALLOWED in code but kept in lists for clarity. Excludes super-admin
-- (saas/system_verify/component_lab) and coming_soon (pharmacy/healthcare/restaurant).

-- [installer-adapt] max_ai_agents exists on cloud but not on the local hybrid
-- subscription_plans; add it idempotently so the pricing UPDATEs below succeed.
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS max_ai_agents integer DEFAULT 0;

-- 1) FREE (small-business ERP hook) + invoice cap 200
UPDATE subscription_plans SET
  included_modules = to_jsonb(ARRAY['dashboard','accounting','inventory','sales','purchases','crm','ai_analytics','system_config','activity_log']::text[]),
  price_monthly = 0, price_yearly = 0, max_invoices_monthly = 200,
  max_users = 1, max_companies = 1, max_warehouses = 1, max_products = 200, max_customers = 200,
  storage_gb = 1, max_ai_agents = 0, display_order = 0, is_active = true, updated_at = now()
WHERE code = 'free' AND plan_type = 'free';

-- 2) STARTER $19 — free + pos/fabric/hr, invoices 1000
UPDATE subscription_plans SET
  included_modules = to_jsonb(ARRAY['dashboard','accounting','inventory','sales','purchases','crm','ai_analytics','system_config','activity_log','pos','fabric','hr']::text[]),
  price_monthly = 19, price_yearly = 190, max_invoices_monthly = 1000,
  max_users = 3, max_companies = 1, max_warehouses = 2, max_products = 2000, storage_gb = 15,
  max_ai_agents = 1, is_popular = false, display_order = 1, is_active = true, is_archived = false, updated_at = now()
WHERE code = 'texa-starter' AND product_id = '25fdcf30-ebd3-468d-993a-8ca5fdd8fb94';

-- 3) PROFESSIONAL $49 ⭐ — rich set, invoices 5000
UPDATE subscription_plans SET
  included_modules = to_jsonb(ARRAY['dashboard','accounting','inventory','sales','purchases','crm','ai_analytics','system_config','activity_log','pos','fabric','hr','e-commerce','manufacturing','workflow_center','support_mdm','exchange','pbx','growth-ai','inspiration_studio','website','general_trade']::text[]),
  price_monthly = 49, price_yearly = 490, max_invoices_monthly = 5000,
  max_users = 10, max_companies = 3, max_branches = 5, max_warehouses = 10, max_products = 20000, storage_gb = 100,
  max_ai_agents = 3, is_popular = true, display_order = 2, is_active = true, is_archived = false, updated_at = now()
WHERE code = 'texa-professional' AND product_id = '25fdcf30-ebd3-468d-993a-8ca5fdd8fb94';

-- 4) ENTERPRISE $149 — ALL sellable (excl super-admin + coming_soon), invoices UNLIMITED
UPDATE subscription_plans SET
  included_modules = to_jsonb(ARRAY['dashboard','fabric','accounting','inventory','sales','purchases','crm','hr','e-commerce','growth-ai','market_intelligence','pbx','ai_analytics','inspiration_studio','workflow_center','support_mdm','system_config','general_trade','pos','doctors','gold','real_estate','vehicles','exchange','manufacturing','website','activity_log']::text[]),
  price_monthly = 149, price_yearly = 1490, max_invoices_monthly = -1,
  max_users = -1, max_companies = -1, max_branches = -1, max_warehouses = -1, max_products = -1, max_customers = -1,
  max_ai_agents = -1, storage_gb = 300, is_popular = false, display_order = 3, is_active = true, is_archived = false, updated_at = now()
WHERE code = 'texa-enterprise' AND product_id = '25fdcf30-ebd3-468d-993a-8ca5fdd8fb94';

-- 5) ARCHIVE duplicate generic plans inside the texacore product (0 subscribers, not texa-*)
UPDATE subscription_plans SET
  is_active = false, is_archived = true, archived_at = now(), updated_at = now()
WHERE product_id = '25fdcf30-ebd3-468d-993a-8ca5fdd8fb94'
  AND code IN ('starter','professional','enterprise')
  AND code NOT LIKE 'texa-%';

-- ═══════════════════════════════════════════════════════════════════════════
-- NOTE: trg_plan_modules_sync fires on included_modules change → repopulates
--       tenant_modules with the new canonical codes (propagates to the owner tenant).
-- ROLLBACK: restore subscription_plans rows from the pre-unification snapshot JSON.
-- ═══════════════════════════════════════════════════════════════════════════
