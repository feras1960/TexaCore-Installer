'use strict';
// 2.0.8: an expired paid licence opens the data READ-ONLY (src/licence-access.js + its wiring in main.js / service-manager.js / plan-sync.js / the launcher).
// The database part is tested against a recorded fake query function; the real guard (20270210j/k) needs one live run — see the QA protocol in the report.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const la = require('../src/licence-access');
const planSync = require('../src/plan-sync');

const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const LIC = { tier: 'pro', license_key: 'LIC-2026-AAAAA-BBBBB', expires_at: '2026-01-01T00:00:00.000Z' };

test('decideAccess: expired paid and clock_tamper → read_only; revoked / suspended / no_license / an expired trial → refused; valid → full', () => {
  assert.deepEqual(la.decideAccess({ valid: true, license: LIC }), { mode: 'full', reason: null });
  assert.deepEqual(la.decideAccess({ valid: false, reason: 'expired', license: LIC }), { mode: 'read_only', reason: 'expired' });
  assert.deepEqual(la.decideAccess({ valid: false, reason: 'clock_tamper', license: LIC }), { mode: 'read_only', reason: 'clock_tamper' });
  assert.deepEqual(la.decideAccess({ valid: false, reason: 'clock_tamper', license: LIC }, { isTrial: true }), { mode: 'read_only', reason: 'clock_tamper' });
  assert.deepEqual(la.decideAccess({ valid: false, reason: 'expired', license: LIC }, { isTrial: true }), { mode: 'refused', reason: 'expired' }, 'a trial that could not land on Free: as before');
  for (const reason of ['revoked', 'suspended', 'no_license', 'something_new']) {
    assert.equal(la.decideAccess({ valid: false, reason, license: LIC }).mode, 'refused', reason);
  }
  assert.equal(la.decideAccess({ valid: false, reason: 'expired' }).mode, 'refused', 'no licence object → nothing to open');
  assert.equal(la.decideAccess(null).mode, 'refused');
});

test('clock_tamper goes back to a full lock with ONE line (its entry in READ_ONLY_REASONS)', () => {
  const text = src('licence-access.js');
  const lines = text.split('\n').filter((l) => /^\s+'clock_tamper',/.test(l));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /DELETE THIS LINE to lock it fully again/);
  assert.deepEqual([...la.READ_ONLY_REASONS].sort(), ['clock_tamper', 'expired']);
});

function fakeDb(answers = {}) {
  const calls = [];
  const q = async (text, params) => {
    calls.push({ text: text.replace(/\s+/g, ' ').trim(), params });
    for (const [k, v] of Object.entries(answers)) if (text.includes(k)) { if (v instanceof Error) throw v; return v; }
    return { rows: [], rowCount: 0 };
  };
  return { q, calls };
}

test('read_only: settings row ensured, mode enforce, every entitling row ended, then verified per tenant', async () => {
  const db = fakeDb({ 'fn_tenant_is_read_only': { rows: [{ tenants: 2, writable: 0, guards: 740 }] }, 'fn_readonly_guard_coverage': { rows: [{ gaps: 3 }] },
    "SET status = 'expired'": { rowCount: 1 }, 'cloud_readonly_mode = $1': { rowCount: 1 } });
  const logs = [];
  const out = await la.applyToDatabase(db.q, 'read_only', { log: (m) => logs.push(m) });
  assert.deepEqual(out, { mode: 'read_only', tenants: 2, writable: 0, guards: 740, ended: 1, gaps: 3 });
  const texts = db.calls.map((c) => c.text);
  assert.match(texts[0], /^INSERT INTO public\.saas_settings \(id\) SELECT gen_random_uuid\(\) WHERE NOT EXISTS/);
  assert.match(texts[1], /^UPDATE public\.saas_settings SET cloud_readonly_mode = \$1/);
  assert.deepEqual(db.calls[1].params, ['enforce']);
  assert.match(texts[2], /^UPDATE public\.tenant_subscriptions ts SET status = 'expired', grace_period_end = NULL/);
  assert.match(texts[2], /WHERE ts\.status IN \('trial', 'active', 'grace', 'expired'\) AND \(CASE ts\.status WHEN 'trial' THEN ts\.end_date/);
  assert.match(texts[3], /fn_tenant_is_read_only\(t\.id\)/);
  assert.match(texts[3], /tgname = 'zzzzzzzzzzzz_ro_guard'/);
  assert.match(logs.join('\n'), /read-only switched ON/);
});

test('the entitlement rule is the one fn_tenant_ended uses (20270210j), status by status', () => {
  const e = la.ENTITLED_TO.replace(/\s+/g, ' ');
  assert.match(e, /WHEN 'trial' THEN ts\.end_date/);
  assert.match(e, /WHEN 'active' THEN GREATEST\(ts\.end_date, COALESCE\(ts\.grace_period_end, ts\.end_date \+ 7\)\)/);
  assert.match(e, /WHEN 'grace' THEN COALESCE\(ts\.grace_period_end, ts\.end_date\)/);
  assert.match(e, /WHEN 'expired' THEN ts\.grace_period_end END/);
});

test('read_only that cannot be proven THROWS (a writable tenant, no guard triggers, a failing statement)', async () => {
  for (const [answers, re] of [
    [{ 'fn_tenant_is_read_only': { rows: [{ tenants: 2, writable: 1, guards: 740 }] } }, /1 of 2 tenant\(s\) would stay writable/],
    [{ 'fn_tenant_is_read_only': { rows: [{ tenants: 1, writable: 0, guards: 0 }] } }, /guard triggers are not installed/],
    [{ 'fn_tenant_is_read_only': new Error('function public.fn_tenant_is_read_only(uuid) does not exist') }, /read-only could not be applied/],
    [{ 'cloud_readonly_mode = $1': new Error('column "cloud_readonly_mode" does not exist') }, /read-only could not be applied/],
  ]) {
    await assert.rejects(la.applyToDatabase(fakeDb(answers).q, 'read_only'), (e) => e.code === 'LICENCE_READ_ONLY_UNVERIFIED' && re.test(e.message));
  }
});

test('no tenant yet (a fresh install on an expired licence) is read-only as long as the guard is installed', async () => {
  const out = await la.applyToDatabase(fakeDb({ 'fn_tenant_is_read_only': { rows: [{ tenants: 0, writable: 0, guards: 700 }] } }).q, 'read_only');
  assert.equal(out.mode, 'read_only');
});

test('full: only the mode goes back to off (the plan sync has re-pointed the subscription)', async () => {
  const db = fakeDb();
  assert.deepEqual(await la.applyToDatabase(db.q, 'full'), { mode: 'full' });
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].text, /^UPDATE public\.saas_settings SET cloud_readonly_mode = \$1/);
  assert.deepEqual(db.calls[0].params, ['off']);
  await assert.rejects(la.applyToDatabase(db.q, 'refused'));
});

test('plan-sync: a read-only licence keeps its OWN plan with an ended subscription (never Free); otherwise the dates are unchanged', async () => {
  const lic = { tier: 'pro', plan_code: 'texa-professional', activated_at: '2025-01-01', expires_at: '2026-01-01' };
  const today = '2026-11-11';
  assert.equal(planSync.subscriptionDates({ tier: 'pro', license: lic, today }).status, 'expired', 'already expired by date');
  const clockBack = { ...lic, expires_at: '2027-06-01' };   // the clock was set back: by the dates it is still active
  assert.equal(planSync.subscriptionDates({ tier: 'pro', license: clockBack, today }).status, 'active');
  const ended = planSync.subscriptionDates({ tier: 'pro', license: clockBack, today, ended: true });
  assert.equal(ended.status, 'expired');
  assert.equal(ended.end_date, '2027-06-01', 'dates are kept: an expired row without grace never entitles (fn_tenant_ended)');

  const writes = [];
  const pgQuery = async (text, params) => {
    if (/FROM public\.subscription_plans WHERE code = \$1/.test(text)) return { rows: [{ id: 'plan-' + params[0], code: params[0] }] };
    if (/SELECT id FROM public\.tenants/.test(text)) return { rows: [{ id: 't1' }] };
    if (/UPDATE public\.tenant_subscriptions/.test(text)) { writes.push(params); return { rowCount: 1, rows: [{ id: 's1' }] }; }
    return { rows: [], rowCount: 0 };
  };
  const r = await planSync.syncActivePlan({ pgQuery }, { tier: 'pro', license: clockBack, cloudPlans: null, today, ended: true });
  assert.equal(r.code, 'texa-professional');
  assert.equal(writes[0][1], 'plan-texa-professional');
  assert.equal(writes[0][2], 'expired');
});

test('main.js: start-erp and AutoStart start an expired paid licence READ-ONLY, applied before the API exists; the refusals stay for the rest', () => {
  const m = src('main.js');
  const start = m.slice(m.indexOf("ipcMain.handle('start-erp'"), m.indexOf("ipcMain.handle('migration-status'"));
  assert.match(start, /const access = licenceAccess\.decideAccess\(licCheck, \{ isTrial: loadConfig\(\)\.isTrial === true \}\);/);
  assert.match(start, /if \(access\.mode === 'refused'\) \{/);
  for (const r of ["revoked: 'تم إلغاء الترخيص", "suspended: 'الترخيص معلّق", "no_license: 'لا يوجد ترخيص"]) assert.ok(start.includes(r), r);
  assert.ok(start.indexOf('landTrialToFree()') < start.indexOf('licenceAccess.decideAccess'), 'a trial lands on Free first');
  assert.match(start, /beforeApi: \(\) => licenceAccessBeforeApi\(access\)/);
  const auto = m.slice(m.indexOf('// ── Auto-start the embedded services on launch ──'), m.indexOf('// Quick connectivity test'));
  assert.match(auto, /if \(access\.mode === 'refused'\) \{ fileLog\('\[AutoStart\] Skipped/);
  assert.match(auto, /beforeApi: \(\) => licenceAccessBeforeApi\(access\)/);
  const hook = m.slice(m.indexOf('async function licenceAccessBeforeApi('), m.indexOf('// While the services run'));
  assert.match(hook, /catch \(e\) \{\s*fileLog\('\[Licence\] ❌ read-only could not be guaranteed — the services are not started:'[\s\S]*?throw new Error/, 'read-only that cannot be proven fails the start');
});

test('services/service-manager.js: the hook runs after the migrations and BEFORE PostgREST; a throw fails (and stops) the start', () => {
  const sm = src('service-manager.js');
  const inner = sm.slice(sm.indexOf('  async _startAllInner('), sm.indexOf('  // ─── Start Frontend Server'));
  const mig = inner.indexOf('this.runMigrations()');
  const hook = inner.indexOf("if (typeof options.beforeApi === 'function') await options.beforeApi();");
  const rest = inner.indexOf('await this.startPostgREST();');
  assert.ok(mig > 0 && hook > mig && rest > hook);
  assert.match(inner, /catch \(err\) \{[\s\S]*?await this\.stopAll\(\);/);
});

test('every plan sync re-applies the state (heartbeat, plan tick, start, restore), and an unprovable read-only stops the services', () => {
  const m = src('main.js');
  const fn = m.slice(m.indexOf('async function syncActivePlan('), m.indexOf('// Open browser'));
  assert.match(fn, /const access = currentLicenceAccess\(\);/);
  assert.match(fn, /ended: access\.mode === 'read_only'/);
  assert.match(fn, /\} finally \{\s*await enforceLicenceAccessInDb\(access, 'plan sync'\);/);
  const enf = m.slice(m.indexOf('async function enforceLicenceAccessInDb('), m.indexOf('// A user action that would write'));
  assert.match(enf, /if \(access\.mode !== 'read_only'\)/);
  assert.match(enf, /await svcManager\.stopAll\(\);/);
  // the restores re-apply it at once, before anything else touches the restored database
  assert.equal((m.match(/await enforceLicenceAccessInDb\(currentLicenceAccess\(\), '(open|restore|restore IPC)'\);/g) || []).length, 3);
  // Task 5's re-apply goes through syncActivePlan, so it cannot undo the read-only state
  assert.match(m.slice(m.indexOf('async function reapplyLicensePlanAfterRestore('), m.indexOf('\nlet _planSyncChain')), /await syncActivePlan\(/);
  // landTrialToFree still never lands a paid licence
  assert.match(m, /if \(cfg\.isTrial !== true\) return false;\s+\/\/ only trials land — never downgrade paid/);
});

test('installer actions that write as the database owner are refused while read-only (company create / delete, invitations)', () => {
  const m = src('main.js');
  assert.match(m.slice(m.indexOf('async function handleCreateLocalCompany('), m.indexOf('async function handleCreateLocalCompany(') + 1500), /const ro = licenceWriteRefusal\(\); if \(ro\) return ro;/);
  assert.match(m.slice(m.indexOf('async function handleInviteEmployee('), m.indexOf('async function handleListEmployeeRoles(')), /const ro = licenceWriteRefusal\(\); if \(ro\) return ro;/);
  const del = m.slice(m.indexOf("req.url === '/api/delete-company'"), m.indexOf("req.url === '/api/delete-company'") + 1200);
  assert.match(del, /const ro = licenceWriteRefusal\(\);[\s\S]*?res\.writeHead\(403/);
  assert.match(m, /svcManager\.writeRefusal = \(\) => licenceWriteRefusal\(\);/);
  const sm = src('service-manager.js');
  assert.match(sm, /const ro = this\.writeRefusal \? this\.writeRefusal\(\) : null;\s*if \(ro\) return \{ success: false, code: 'NOT_ALLOWED', reason: 'licence_read_only'/);
  const r = la.writeRefusal();
  assert.equal(r.code, 'LICENCE_READ_ONLY');
  assert.match(r.error, /للقراءة فقط/); assert.match(r.error, /read-only/);
});

test('the launcher says it in every language and keeps the renew form; a read-only install can still be started and opened', () => {
  const ctx = { window: {}, document: {} };
  vm.createContext(ctx);
  vm.runInContext(src('i18n.js') + '\n;this.__I18N = I18N;', ctx);
  for (const lang of ['ar', 'en', 'ru', 'uk']) {
    for (const k of ['ui.chip.readOnly', 'ui.hero.readOnly', 'ui.license.readOnlyNote', 'ui.license.readOnlyClockNote']) assert.ok(ctx.__I18N[lang][k], `${lang} ${k}`);
  }
  assert.match(ctx.__I18N.ar['ui.license.readOnlyNote'], /للقراءة فقط/);
  assert.match(ctx.__I18N.en['ui.license.readOnlyNote'], /read-only/);
  const html = src('index.html');
  assert.equal((html.match(/id="license-readonly-note"/g) || []).length, 1);
  const r = src('renderer.js');
  assert.match(r, /function isReadOnly\(state\) \{ return !!\(state && state\.licenceAccess && state\.licenceAccess\.mode === 'read_only'\); \}/);
  assert.match(r, /if \(!state\.hasLicense && !isReadOnly\(state\)\) return 'nolicense';/);
  assert.match(r, /state\.licenceAccess\.reason === 'clock_tamper' \? t\('ui\.license\.readOnlyClockNote'\) : t\('ui\.license\.readOnlyNote'\)/);
  const m = src('main.js');
  assert.match(m, /licenceAccess: access,\n\s+port: config\.port \|\| APP_PORT,/, 'get-state reports the access mode');
});

test('the hero of a read-only install can start and open (not «no licence»); refused stays «no licence»', () => {
  const r = src('renderer.js');
  const code = r.slice(r.indexOf('function heroMode(state)'), r.indexOf('function renderHero(state)'));
  const ctx = { _empListed: true, _empCompanies: [{ id: 'c1' }] };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;this.__h = heroMode;', ctx);
  assert.equal(ctx.__h({ hasLicense: false, containerRunning: true, licenceAccess: { mode: 'read_only', reason: 'expired' } }), 'ready');
  assert.equal(ctx.__h({ hasLicense: false, containerRunning: false, licenceAccess: { mode: 'read_only', reason: 'expired' } }), 'stopped');
  assert.equal(ctx.__h({ hasLicense: false, containerRunning: true, licenceAccess: { mode: 'refused', reason: 'revoked' } }), 'nolicense');
  assert.equal(ctx.__h({ hasLicense: false, containerRunning: true }), 'nolicense');
});
