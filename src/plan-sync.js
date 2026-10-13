'use strict';
// ════════════════════════════════════════════════════════════════
// plan-sync — the LOCAL database follows the plan the control panel manages: plan row → tenant subscription → (trigger) tenant_modules.
//
// Where plan LIMITS and MODULES come from (owner decision 2026-10-13: never hard-coded in this program):
//   1. first run     — the plan rows bundled with the installer (src/bootstrap/reference_seed.sql: the production subscription_plans as of the
//                      release). The app installs and runs fully OFFLINE from the first launch on these.
//   2. every sync    — when the cloud is reachable, the control panel's plan catalogue (public subscription_plans, anon read) is UPSERTed
//                      into the local table: changed limits/modules AND plans the licence points to that the local copy has never seen.
//   3. offline later — nothing is written: the local rows ARE the last synced values (they live in the install's own database), so an
//                      offline start can never fall back to anything older.
//   Enforcement is the server's own: the same triggers/functions production runs (enforce_plan_limit → check_plan_limits) read these
//   rows. This module only keeps the rows (and the tenant's subscription) equal to the control panel.
//
// Per-licence settings the control panel can also set (licensing_get_license_state): `plan_code` (the plan the licence points at BY NAME),
// `custom_limits` (this licence's own max_users/max_companies/max_warehouses/max_storage_gb apply instead of the plan's) and
// `modules_admin_set` + `enabled_modules` (an explicit module grant). Anything else about limits comes from the plan.
//
// What 1.x got wrong (both found on real installs): it only UPDATEd subscription_plans WHERE code = <tier> and returned silently when the
// row was missing, and it called public.apply_tenant_plan(), which has never existed on this schema — so NO plan gating ever worked.
//
// Pure SQL-building and decisions live here (testable); the caller supplies pgQuery.
// ════════════════════════════════════════════════════════════════

/** licensing tier → plan code. Mirrors licensing.fn_plan_code_for_tier() on production (unknown → free, never fail open). Used only when
 *  the licence carries no plan_code (older licences). */
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

const PLAN_CODE = /^[A-Za-z0-9_-]{1,50}$/;
const MODULE_CODE = /^[a-zA-Z0-9_-]{1,50}$/;

// The columns of subscription_plans the control panel manages (a whitelist: column NAMES go into SQL text, values are bound).
const LIMIT_COLS = ['max_users', 'max_companies', 'max_branches', 'max_warehouses', 'max_products', 'max_invoices_monthly', 'max_customers',
  'max_documents', 'max_images', 'max_records', 'max_extensions', 'max_ai_agents', 'storage_gb'];
const INT_COLS = [...LIMIT_COLS, 'trial_days', 'display_order', 'grace_period_days'];
const NUMERIC_COLS = ['price_monthly', 'price_yearly'];
const TEXT_COLS = ['name_ar', 'name_en', 'description', 'description_ar', 'plan_type', 'currency'];
const BOOL_COLS = ['is_active', 'is_popular'];
const PLAN_COLS = [...TEXT_COLS, ...INT_COLS, ...NUMERIC_COLS, ...BOOL_COLS, 'included_modules', 'features'];

const toInt = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= -1 && n <= 2147483647 ? n : null;
};
const toNum = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 1e8 ? n : null; };

/** A cloud subscription_plans row → { code, cols } of validated values, or null when it cannot be a plan row. Unknown/invalid fields are dropped. */
function normalizeCloudPlan(row) {
  if (!row || typeof row !== 'object' || typeof row.code !== 'string' || !PLAN_CODE.test(row.code)) return null;
  const cols = {};
  for (const k of INT_COLS) { const n = toInt(row[k]); if (n !== null) cols[k] = n; }
  for (const k of NUMERIC_COLS) { const n = toNum(row[k]); if (n !== null) cols[k] = n; }
  for (const k of TEXT_COLS) if (typeof row[k] === 'string' && row[k].length <= 2000) cols[k] = row[k];
  for (const k of BOOL_COLS) if (typeof row[k] === 'boolean') cols[k] = row[k];
  if (Array.isArray(row.included_modules)) cols.included_modules = [...new Set(row.included_modules.filter((m) => typeof m === 'string' && MODULE_CODE.test(m)))];
  if (row.features && typeof row.features === 'object' && !Array.isArray(row.features)) cols.features = row.features;
  if (!cols.name_ar) cols.name_ar = cols.name_en || row.code;      // NOT NULL on the table
  if (cols.plan_type && cols.plan_type.length > 20) delete cols.plan_type;
  if (cols.currency && cols.currency.length > 3) delete cols.currency;
  return { code: row.code, cols };
}

/**
 * Run fn(query) so that a write to an EXISTING plan row carries the control panel's confirmation. Production guards subscription_plans
 * (licensing.trg_plan_guard): lowering a mirrored limit or deactivating a plan in use is refused unless the transaction carries
 * `texacore.plan_change_confirmed = <that plan's id>` (what console_update_subscription_plan sets after the operator confirmed). A change that
 * arrives from the control panel HAS been confirmed there; this local copy simply follows it. Same transaction, bound to that one plan id.
 */
async function confirmedPlanWrite(tx, planCode, fn) {
  return tx(async (q) => {
    const ex = await q('SELECT id FROM public.subscription_plans WHERE code = $1', [planCode]);
    if (ex.rowCount) await q(`SELECT set_config('texacore.plan_change_confirmed', $1::text, true)`, [ex.rows[0].id]);
    return fn(q);
  });
}
const asTx = (pgQuery, pgTx) => pgTx || (async (fn) => fn(pgQuery));

/** Insert-or-update ONE plan row from a normalised cloud plan. Only the columns the cloud row carried are written. Returns the plan id. */
async function upsertCloudPlan(pgQuery, plan, pgTx) {
  const names = Object.keys(plan.cols);
  for (const n of names) if (!PLAN_COLS.includes(n)) throw new Error(`plan column not allowed: ${n}`);
  const params = [plan.code];
  const ph = (v, cast = '') => { params.push(v); return `$${params.length}${cast}`; };
  const values = names.map((n) => (n === 'included_modules' ? ph(plan.cols[n], '::text[]') : n === 'features' ? ph(JSON.stringify(plan.cols[n]), '::jsonb') : ph(plan.cols[n])));
  const sets = names.map((n) => `${n} = EXCLUDED.${n}`);
  const r = await confirmedPlanWrite(asTx(pgQuery, pgTx), plan.code, (q) => q(
    `INSERT INTO public.subscription_plans (product_id, code${names.length ? ', ' + names.join(', ') : ''})
     VALUES ((SELECT id FROM public.saas_products WHERE code = 'texacore' LIMIT 1), $1${values.length ? ', ' + values.join(', ') : ''})
     ON CONFLICT (code) DO UPDATE SET ${[...sets, 'updated_at = now()'].join(', ')}
     RETURNING id`, params));
  return r.rows[0].id;
}

/** The local plan row for a code (limits + modules), or null. */
async function readPlan(pgQuery, code) {
  const r = await pgQuery(
    `SELECT id, code, plan_type, ${LIMIT_COLS.join(', ')}, included_modules FROM public.subscription_plans WHERE code = $1 LIMIT 1`, [code]);
  return r.rows[0] || null;
}

/**
 * Per-licence settings applied on top of the plan row (the control panel sets them per licence):
 *   custom_limits === true → this licence's own max_users / max_companies / max_warehouses / max_storage_gb replace the plan's
 *   modules_admin_set === true → the licence's enabled_modules replace the plan's included_modules
 * Re-applied on every sync (idempotent) and reset to the plan's values by the next catalogue sync that no longer carries them.
 */
async function applyLicenseOverrides(pgQuery, planId, license, pgTx) {
  if (!license) return [];
  const sets = []; const params = [planId]; const applied = [];
  if (license.custom_limits === true) {
    for (const [lk, pk] of [['max_users', 'max_users'], ['max_companies', 'max_companies'], ['max_warehouses', 'max_warehouses'], ['max_storage_gb', 'storage_gb']]) {
      const n = toInt(license[lk]);
      if (n !== null) { params.push(n); sets.push(`${pk} = $${params.length}`); applied.push(pk); }
    }
  }
  if (license.modules_admin_set === true && Array.isArray(license.enabled_modules) && license.enabled_modules.length) {
    const mods = [...new Set(license.enabled_modules.filter((m) => typeof m === 'string' && MODULE_CODE.test(m)))];
    if (mods.length) { params.push(mods); sets.push(`included_modules = $${params.length}::text[]`); applied.push('included_modules'); }
  }
  if (!sets.length) return [];
  await asTx(pgQuery, pgTx)(async (q) => {
    await q(`SELECT set_config('texacore.plan_change_confirmed', $1::text, true)`, [planId]);
    return q(`UPDATE public.subscription_plans SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
  });
  return applied;
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
 * The whole sync. deps: { pgQuery, log }.
 * input: { tier, license, cloudPlans, tenantId? (default: every tenant), forceTier?, today? }
 *   cloudPlans — the control panel's plan rows when the cloud answered, else null/[] (offline: the local rows are used as they are)
 *   forceTier  — plan by tier only, ignoring the licence's plan_code/custom_limits (the user chose Free: a cloud 'trial' must not override it)
 * Throws when no plan row exists at all; callers decide whether that is fatal (company creation: yes; a heartbeat: log and retry).
 */
async function syncActivePlan({ pgQuery, pgTx, log = () => {} }, { tier, license = null, cloudPlans = null, tenantId = null, today, forceTier = false }) {
  let catalogue = 0;
  if (Array.isArray(cloudPlans)) {
    for (const row of cloudPlans) {
      const plan = normalizeCloudPlan(row);
      if (!plan) continue;
      try { await upsertCloudPlan(pgQuery, plan, pgTx); catalogue += 1; } catch (e) { log(`[Plan] catalogue row "${plan.code}" skipped: ${e.message}`); }
    }
  }
  const lic = forceTier ? null : license;
  const wanted = (lic && typeof lic.plan_code === 'string' && PLAN_CODE.test(lic.plan_code)) ? lic.plan_code : planCodeForTier(tier);
  let code = wanted;
  let plan = await readPlan(pgQuery, wanted);
  if (!plan) {
    log(`[Plan] the licence points at "${wanted}" which this copy has not synced yet — using the free plan until it can`);
    code = 'free';
    plan = await readPlan(pgQuery, 'free');
    if (!plan) throw new Error('no free plan row in this database');
  }
  const overrides = await applyLicenseOverrides(pgQuery, plan.id, forceTier ? null : license, pgTx);
  const dates = subscriptionDates({ tier, license, today });
  const tenants = tenantId
    ? [{ id: tenantId }]
    : (await pgQuery('SELECT id FROM public.tenants WHERE deleted_at IS NULL')).rows;
  for (const t of tenants) await pointTenantAtPlan(pgQuery, t.id, plan.id, dates);
  log(`[Plan] tier=${tier} → ${code}${code !== wanted ? ` (wanted ${wanted})` : ''}; catalogue ${Array.isArray(cloudPlans) ? `synced ${catalogue}/${cloudPlans.length}` : 'offline (last synced values kept)'}${overrides.length ? '; licence overrides: ' + overrides.join(',') : ''}; ${tenants.length} tenant(s), subscription ${dates.status}${dates.trial_end_date ? ' until ' + dates.trial_end_date : ''}`);
  return { planId: plan.id, code, wanted, dates, tenants: tenants.length, catalogue, overrides, online: Array.isArray(cloudPlans) };
}

module.exports = {
  planCodeForTier, normalizeCloudPlan, upsertCloudPlan, readPlan, applyLicenseOverrides, subscriptionDates, pointTenantAtPlan, syncActivePlan,
  LIMIT_COLS, PLAN_COLS,
};
