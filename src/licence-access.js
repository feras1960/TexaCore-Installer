'use strict';
// ════════════════════════════════════════════════════════════════
// licence-access (2.0.8) — an expired paid licence opens the data READ-ONLY instead of refusing to start (owner decision 2026-11-11:
// «تصبح قراءة بدون تعديل»).
//
// WHAT DECIDES (decideAccess): the licence-guard validate() answer →
//   valid                         full        (unchanged)
//   expired (paid)                read_only   the decision
//   clock_tamper                  read_only   (assumption of 2026-11-11; ONE line in READ_ONLY_REASONS below turns it back into a full lock)
//   expired TRIAL                 refused     a trial lands on Free first (landTrialToFree); only one that could not land is refused, as before
//   revoked / suspended / no_license / anything else    refused (unchanged)
//
// HOW THE DATABASE IS MADE READ-ONLY (applyToDatabase) — the ERP's own cloud read-only machinery, bundled with the desktop (migrations
// 20270210j_cloud_readonly_state + 20270210k_cloud_readonly_guard, both in baseline/MIGRATIONS_PIN.json), driven by DATA only (no new migration,
// no frontend change). The guard trigger `zzzzzzzzzzzz_ro_guard` on every tenant table refuses an INSERT / UPDATE / DELETE by a SIGNED-IN user
// (PostgREST, so the LAN URL / the API too: SQLSTATE PT402 → HTTP 402 SUBSCRIPTION_READ_ONLY) when ALL of these hold (fn_ro_decide):
//   1. saas_settings.cloud_readonly_mode = 'enforce'    ('off' = the default of every local install: that is the only reason the desktop was never affected)
//   2. the tenant's subscription ended (fn_tenant_ended: no tenant_subscriptions row entitles it today — an 'expired' row with no grace never does)
//   3. the tenant is not exempt (tenants.is_protected / is_admin), and the user is not a platform admin (the vendor support account only)
// So read_only = set (1) and end every entitling subscription row (2), then VERIFY with fn_tenant_is_read_only() for every live tenant; if one
// tenant would stay writable (exempt, a 'pending' row, the functions missing) applyToDatabase THROWS and the caller refuses to run — a writable
// database is never opened on an expired licence. full = set the mode back to 'off' (plan-sync has already re-pointed the subscription).
// What stays allowed under the guard (20270210k buckets): reads, exports, printing (company_print_defaults is exempt), logins (auth.*,
// login_history, tenant_login_sessions), notifications / audit trails, the user's own profile, workspace switches; and every write made by the
// installer itself (no signed-in user: plan sync, backups, restore, the admin password) — user-triggered installer writes are refused in main.js.
// Pure (the query function is injected): test/licence-access.test.js.
// ════════════════════════════════════════════════════════════════

const READ_ONLY_REASONS = new Set([
  'expired',        // owner decision 2026-11-11: an expired paid licence opens the books read-only
  'clock_tamper',   // the clock set back > 24 h: read-only too (a dead CMOS battery must not lock the books). DELETE THIS LINE to lock it fully again.
]);

/**
 * @param {{valid:boolean, reason?:string, license?:object}} validation  LicenseGuard.validate()
 * @param {{isTrial?:boolean}} ctx
 * @returns {{mode:'full'|'read_only'|'refused', reason:string|null}}
 */
function decideAccess(validation, { isTrial = false } = {}) {
  if (!validation) return { mode: 'refused', reason: 'no_license' };
  if (validation.valid) return { mode: 'full', reason: null };
  const reason = validation.reason || 'invalid';
  if (reason === 'expired' && isTrial) return { mode: 'refused', reason };   // trials land on Free; one that could not land is refused as before
  if (READ_ONLY_REASONS.has(reason) && validation.license) return { mode: 'read_only', reason };
  return { mode: 'refused', reason };
}

// the entitlement rule of fn_tenant_ended / fn_tenant_access_state (20270210j), row by row: the last day a subscription row entitles its tenant
const ENTITLED_TO = `(CASE ts.status WHEN 'trial' THEN ts.end_date
                       WHEN 'active' THEN GREATEST(ts.end_date, COALESCE(ts.grace_period_end, ts.end_date + 7))
                       WHEN 'grace' THEN COALESCE(ts.grace_period_end, ts.end_date)
                       WHEN 'expired' THEN ts.grace_period_end END)`;

const SQL = {
  ensureSettingsRow: `INSERT INTO public.saas_settings (id) SELECT gen_random_uuid() WHERE NOT EXISTS (SELECT 1 FROM public.saas_settings)`,
  setMode: `UPDATE public.saas_settings SET cloud_readonly_mode = $1, updated_at = now() WHERE cloud_readonly_mode IS DISTINCT FROM $1`,
  // every row that would still entitle a tenant today becomes an ended one ('expired', no grace); dates are kept (the valid_dates check holds)
  endEntitlingRows: `UPDATE public.tenant_subscriptions ts SET status = 'expired', grace_period_end = NULL, updated_at = now()
                      WHERE ts.status IN ('trial', 'active', 'grace', 'expired') AND ${ENTITLED_TO} >= CURRENT_DATE`,
  verify: `SELECT count(*)::int AS tenants,
                  count(*) FILTER (WHERE NOT public.fn_tenant_is_read_only(t.id))::int AS writable,
                  (SELECT count(*)::int FROM pg_trigger WHERE tgname = 'zzzzzzzzzzzz_ro_guard' AND NOT tgisinternal) AS guards
             FROM public.tenants t WHERE t.deleted_at IS NULL`,
  coverage: `SELECT count(*)::int AS gaps FROM public.fn_readonly_guard_coverage()`,
};

/**
 * Put the database in the state `mode` asks for. pgQuery(text, params) → { rows, rowCount } (the installer's superuser connection: no signed-in
 * user, so the guard itself never blocks these statements).
 *   full       → mode 'off'.                                        Never throws for a data reason (a missing column is logged by the caller).
 *   read_only  → mode 'enforce' + every entitling row ended + verified. THROWS (code LICENCE_READ_ONLY_UNVERIFIED) when it cannot be proven.
 * @returns {Promise<{mode:string, tenants?:number, writable?:number, guards?:number, ended?:number, gaps?:number|null}>}
 */
async function applyToDatabase(pgQuery, mode, { log = () => {} } = {}) {
  if (mode === 'full') {
    const r = await pgQuery(SQL.setMode, ['off']);
    if (r && r.rowCount) log('[Licence] read-only switched OFF in the database (licence valid)');
    return { mode: 'full' };
  }
  if (mode !== 'read_only') throw new Error(`applyToDatabase: unexpected mode ${mode}`);
  try {
    await pgQuery(SQL.ensureSettingsRow, []);
    const m = await pgQuery(SQL.setMode, ['enforce']);
    const e = await pgQuery(SQL.endEntitlingRows, []);
    const v = (await pgQuery(SQL.verify, [])).rows[0] || {};
    let gaps = null;
    try { gaps = (await pgQuery(SQL.coverage, [])).rows[0].gaps; } catch { /* informational only */ }
    const out = { mode: 'read_only', tenants: v.tenants, writable: v.writable, guards: v.guards, ended: (e && e.rowCount) || 0, gaps };
    if (!(v.guards > 0)) throw Object.assign(new Error('the read-only guard triggers are not installed in this database'), { code: 'LICENCE_READ_ONLY_UNVERIFIED', detail: out });
    if (v.writable !== 0) throw Object.assign(new Error(`${v.writable} of ${v.tenants} tenant(s) would stay writable (exempt or pending subscription)`), { code: 'LICENCE_READ_ONLY_UNVERIFIED', detail: out });
    if ((m && m.rowCount) || out.ended) log(`[Licence] read-only switched ON in the database: ${out.tenants} tenant(s), ${out.ended} subscription row(s) ended, ${out.guards} guarded tables${gaps ? `, ${gaps} known coverage gap(s)` : ''}`);
    return out;
  } catch (err) {
    if (err && err.code === 'LICENCE_READ_ONLY_UNVERIFIED') throw err;
    throw Object.assign(new Error(`read-only could not be applied: ${err && err.message}`), { code: 'LICENCE_READ_ONLY_UNVERIFIED' });
  }
}

/** The answer of an installer action that would write while the licence is read-only (create / delete a company, an RSF import, an invitation). */
function writeRefusal() {
  return {
    success: false,
    code: 'LICENCE_READ_ONLY',
    error: 'انتهى الترخيص — البيانات للقراءة فقط. جدّد الترخيص لإضافة أو تعديل البيانات. | The licence has expired — the data is read-only. Renew the licence to add or change data.',
  };
}

module.exports = { READ_ONLY_REASONS, decideAccess, applyToDatabase, writeRefusal, SQL, ENTITLED_TO };
