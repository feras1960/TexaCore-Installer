'use strict';
// ════════════════════════════════════════════════════════════════
// plan-sync — align the LOCAL database to the license: plan row → tenant subscription → (trigger) tenant_modules.
//
// What 1.x got wrong (both found on real installs):
//   * It only UPDATEd subscription_plans WHERE code = <tier> and returned silently when the row was missing — a fresh
//     install seeds just 'free', so a trial/pro license changed nothing.
//   * It called public.apply_tenant_plan(), which has never existed on this schema — so NO plan gating ever worked.
// 2.0.0: the plan row for the license's tier is INSERTed or UPDATEd from the license (cloud row when online — the heartbeat
// has already written it to the cached license — or the cached copy offline), then every tenant's subscription is pointed at it.
// The server does the rest: trg_tenant_sub_modules_sync → sync_tenant_plan_modules() rebuilds tenant_modules from the plan's
// included_modules + the registry's core modules. A trial gets the Professional plan with a real end date (the countdown).
//
// Pure SQL-building and decisions live here (testable); the caller supplies pgQuery.
// ════════════════════════════════════════════════════════════════

/** licensing tier → plan code. Mirrors licensing.fn_plan_code_for_tier() on production (unknown → free, never fail open). */
function planCodeForTier(tier) {
  switch (tier) {
    case 'free': return 'free';
    case 'trial': return 'texa-professional'; // the trial IS Professional, with a countdown
    case 'pro': return 'texa-professional';
    case 'basic': return 'texa-starter';
    case 'starter': return 'texa-starter';
    case 'enterprise': return 'texa-enterprise';
    default: return 'free';
  }
}

// Module sets by plan. Core modules (dashboard, accounting, inventory, sales, purchases, crm, …) come from the registry
// (modules.is_core) and are always on; these are the NON-core ones each plan adds. 'fabric' is in every plan: a Rashid
// fabric import writes materials/rolls through it (a materials import is refused with 403 without it).
const FREE_MODULES = ['fabric', 'ai_analytics', 'general_trade', 'contracts'];
const STARTER_MODULES = [...FREE_MODULES, 'pbx'];
const PRO_MODULES = [...STARTER_MODULES, 'hr', 'manufacturing', 'e-commerce', 'exchange', 'website', 'gold', 'vehicles', 'doctors', 'restaurant'];
const ENTERPRISE_MODULES = [...PRO_MODULES, 'growth-ai', 'inspiration_studio', 'component_lab'];

const PLAN_DEFAULTS = {
  free: { name_ar: 'مجاني إلى الأبد', name_en: 'Free Forever', plan_type: 'free', price_monthly: 0, trial_days: 0,
    // 2.0.0: free is limited by WHO uses it (1 user, 1 company, 1 branch), not by how much data one company holds. The free-plan
    // triggers (enforce_plan_limit) count rows, and a Rashid import writes thousands of invoices / materials / customers and
    // several warehouses at once — a "200 invoices, 1 warehouse" cap made the first import fail half-way (PLAN_LIMIT_EXCEEDED:
    // warehouses 1/1, inventory opening movements never written). See FREE_IMPORT_FLOOR.
    limits: { max_users: 1, max_companies: 1, max_branches: 1, max_warehouses: -1, max_products: -1, max_invoices_monthly: -1, max_customers: -1, max_documents: -1, max_images: -1, max_records: -1, storage_gb: -1 },
    modules: FREE_MODULES },
  'texa-starter': { name_ar: 'الباقة الأساسية', name_en: 'Basic Plan', plan_type: 'paid', price_monthly: 19, trial_days: 14,
    limits: { max_users: 3, max_companies: 1, max_branches: 1, max_warehouses: 2, max_products: 500, max_invoices_monthly: 500, max_customers: -1, max_documents: -1, max_images: -1, max_records: -1, storage_gb: 15 },
    modules: STARTER_MODULES },
  'texa-professional': { name_ar: 'الباقة الاحترافية', name_en: 'Professional Plan', plan_type: 'paid', price_monthly: 29, trial_days: 14,
    limits: { max_users: 10, max_companies: 3, max_branches: 5, max_warehouses: 10, max_products: 5000, max_invoices_monthly: 500, max_customers: -1, max_documents: -1, max_images: -1, max_records: -1, storage_gb: 100 },
    modules: PRO_MODULES },
  'texa-enterprise': { name_ar: 'باقة المؤسسات', name_en: 'Enterprise Plan', plan_type: 'paid', price_monthly: 49, trial_days: 14,
    limits: { max_users: -1, max_companies: -1, max_branches: -1, max_warehouses: -1, max_products: -1, max_invoices_monthly: 500, max_customers: -1, max_documents: -1, max_images: -1, max_records: -1, storage_gb: 300 },
    modules: ENTERPRISE_MODULES },
};

// Whatever the license or the cloud package says, a FREE install never caps the volume of data a company can hold below what an import needs.
// (users / companies / branches still follow the license and the cloud package.) -1 = unlimited.
const FREE_IMPORT_FLOOR = ['max_warehouses', 'max_products', 'max_invoices_monthly', 'max_customers', 'max_documents'];

const LIMIT_COLS = ['max_users', 'max_companies', 'max_branches', 'max_warehouses', 'max_products', 'max_invoices_monthly', 'max_customers', 'max_documents', 'max_images', 'max_records', 'storage_gb'];
const MODULE_CODE = /^[a-zA-Z0-9_-]{1,50}$/;

const int = (v) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : null; };

/**
 * The plan row for this license.
 *   license  — the (cloud or cached) license object: tier, max_users, max_companies, max_warehouses, max_storage_gb,
 *              enabled_modules + modules_admin_set (an admin's explicit per-license module grant)
 *   cloudPlan — optional: the cloud package row for the same code (fills the limits a license does not carry)
 * Precedence per limit: license value → cloud package → built-in default. A license value of null/undefined is "not set".
 */
function buildPlanSpec({ tier, license = null, cloudPlan = null }) {
  const code = planCodeForTier(tier);
  const base = PLAN_DEFAULTS[code];
  const limits = { ...base.limits };
  if (cloudPlan) for (const k of LIMIT_COLS) { const n = int(cloudPlan[k]); if (n !== null) limits[k] = n; }
  if (license) {
    for (const [lk, pk] of [['max_users', 'max_users'], ['max_companies', 'max_companies'], ['max_warehouses', 'max_warehouses'], ['max_storage_gb', 'storage_gb']]) {
      const n = int(license[lk]); if (n !== null) limits[pk] = n;
    }
  }
  if (code === 'free') for (const k of FREE_IMPORT_FLOOR) limits[k] = -1;
  let modules = base.modules;
  let moduleSource = 'plan-default';
  if (cloudPlan && Array.isArray(cloudPlan.included_modules) && cloudPlan.included_modules.length) { modules = cloudPlan.included_modules; moduleSource = 'cloud-plan'; }
  if (license && license.modules_admin_set === true && Array.isArray(license.enabled_modules) && license.enabled_modules.length) {
    modules = license.enabled_modules; moduleSource = 'admin-grant';
  }
  modules = [...new Set(modules.filter((m) => typeof m === 'string' && MODULE_CODE.test(m)))];
  return { code, tier, ...base, limits, modules, moduleSource };
}

/** The subscription row's status and dates for a tier. `today` is injectable for tests (ISO date). */
function subscriptionDates({ tier, license, today = new Date().toISOString().slice(0, 10) }) {
  const date = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };
  const exp = date(license && license.expires_at);
  const start = date(license && license.activated_at) || today;
  if (tier === 'free' || !exp) {
    // free never expires; a paid license without an end date is treated like an open-ended one
    return { status: 'active', start_date: start <= today ? start : today, end_date: '2099-12-31', trial_end_date: null };
  }
  const startFixed = start > exp ? today : start;
  if (tier === 'trial') {
    return exp < today
      ? { status: 'expired', start_date: startFixed, end_date: exp < startFixed ? startFixed : exp, trial_end_date: exp }
      : { status: 'trial', start_date: startFixed, end_date: exp, trial_end_date: exp };
  }
  return exp < today
    ? { status: 'expired', start_date: startFixed, end_date: exp < startFixed ? startFixed : exp, trial_end_date: null }
    : { status: 'active', start_date: startFixed, end_date: exp, trial_end_date: null };
}

/** Insert-or-update the plan row. Returns the plan id. */
async function upsertPlan(pgQuery, spec) {
  const L = spec.limits;
  const r = await pgQuery(
    `INSERT INTO public.subscription_plans
       (product_id, code, name_ar, name_en, plan_type, max_users, max_companies, max_branches, max_warehouses, max_products,
        max_invoices_monthly, max_customers, max_documents, max_images, max_records, storage_gb, included_modules, price_monthly,
        is_active, trial_days)
     VALUES ((SELECT id FROM public.saas_products WHERE code = 'texacore' LIMIT 1), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
             $16::text[], $17, true, $18)
     ON CONFLICT (code) DO UPDATE SET
       plan_type = EXCLUDED.plan_type, max_users = EXCLUDED.max_users, max_companies = EXCLUDED.max_companies,
       max_branches = EXCLUDED.max_branches, max_warehouses = EXCLUDED.max_warehouses, max_products = EXCLUDED.max_products,
       max_invoices_monthly = EXCLUDED.max_invoices_monthly, max_customers = EXCLUDED.max_customers,
       max_documents = EXCLUDED.max_documents, max_images = EXCLUDED.max_images, max_records = EXCLUDED.max_records,
       storage_gb = EXCLUDED.storage_gb, included_modules = EXCLUDED.included_modules, is_active = true, updated_at = now()
     RETURNING id`,
    [spec.code, spec.name_ar, spec.name_en, spec.plan_type, L.max_users, L.max_companies, L.max_branches, L.max_warehouses, L.max_products,
      L.max_invoices_monthly, L.max_customers, L.max_documents, L.max_images, L.max_records, L.storage_gb, spec.modules, spec.price_monthly, spec.trial_days]);
  return r.rows[0].id;
}

/** Point a tenant's live subscription at the plan (update the newest live row, else insert). The module trigger does the rest. */
async function pointTenantAtPlan(pgQuery, tenantId, planId, dates) {
  const up = await pgQuery(
    `UPDATE public.tenant_subscriptions SET plan_id = $2, status = $3, start_date = $4::date, end_date = $5::date, trial_end_date = $6::date,
            grace_period_end = NULL, updated_at = now()
      WHERE id = (SELECT id FROM public.tenant_subscriptions
                   WHERE tenant_id = $1 AND status IN ('trial', 'active', 'grace', 'expired')
                   ORDER BY (status IN ('trial','active','grace')) DESC, created_at DESC LIMIT 1)
      RETURNING id`, [tenantId, planId, dates.status, dates.start_date, dates.end_date, dates.trial_end_date]);
  if (up.rowCount) return up.rows[0].id;
  const ins = await pgQuery(
    `INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, start_date, end_date, trial_end_date, billing_cycle)
     VALUES ($1, $2, $3, $4::date, $5::date, $6::date, 'monthly') RETURNING id`,
    [tenantId, planId, dates.status, dates.start_date, dates.end_date, dates.trial_end_date]);
  return ins.rows[0].id;
}

/**
 * The whole sync. deps: { pgQuery, log }.  input: { tier, license, cloudPlan, tenantId? (default: every tenant) }.
 * Each step is its own statement (no swallowed failure hides the next one); it THROWS when the plan cannot be written —
 * callers decide whether that is fatal (company creation: yes; a heartbeat: log and retry next beat).
 */
async function syncActivePlan({ pgQuery, log = () => {} }, { tier, license = null, cloudPlan = null, tenantId = null, today }) {
  const spec = buildPlanSpec({ tier, license, cloudPlan });
  const planId = await upsertPlan(pgQuery, spec);
  const dates = subscriptionDates({ tier, license, today });
  const tenants = tenantId
    ? [{ id: tenantId }]
    : (await pgQuery('SELECT id FROM public.tenants WHERE deleted_at IS NULL')).rows;
  for (const t of tenants) await pointTenantAtPlan(pgQuery, t.id, planId, dates);
  log(`[Plan] tier=${tier} → ${spec.code} (${spec.moduleSource}), ${tenants.length} tenant(s), subscription ${dates.status}${dates.trial_end_date ? ' until ' + dates.trial_end_date : ''}`);
  return { planId, code: spec.code, dates, tenants: tenants.length, modules: spec.modules, limits: spec.limits };
}

module.exports = {
  planCodeForTier, buildPlanSpec, subscriptionDates, upsertPlan, pointTenantAtPlan, syncActivePlan,
  PLAN_DEFAULTS, FREE_MODULES, FREE_IMPORT_FLOOR, LIMIT_COLS,
};
