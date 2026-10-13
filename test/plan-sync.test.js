'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ps = require('../src/plan-sync');

test('tier → plan code mirrors licensing.fn_plan_code_for_tier; unknown never fails open', () => {
  assert.equal(ps.planCodeForTier('free'), 'free');
  assert.equal(ps.planCodeForTier('trial'), 'texa-professional');
  assert.equal(ps.planCodeForTier('pro'), 'texa-professional');
  assert.equal(ps.planCodeForTier('basic'), 'texa-starter');
  assert.equal(ps.planCodeForTier('starter'), 'texa-starter');
  assert.equal(ps.planCodeForTier('enterprise'), 'texa-enterprise');
  for (const t of [undefined, null, '', 'unlimited', 'platinum']) assert.equal(ps.planCodeForTier(t), 'free');
});

test('NO plan limit or module list is written in the program: plan-sync.js carries none, the bundled seed holds the production rows', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'plan-sync.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /max_[a-z_]+\s*:\s*-?\d/, 'a hard-coded limit');
  assert.doesNotMatch(src, /'fabric'|'ai_analytics'|'general_trade'/, 'a hard-coded module list');
  assert.equal(ps.FREE_IMPORT_FLOOR, undefined);
  assert.equal(ps.PLAN_DEFAULTS, undefined);
  const seed = fs.readFileSync(path.join(__dirname, '..', 'src', 'bootstrap', 'reference_seed.sql'), 'utf8');
  // production subscription_plans, owner-provided 2026-10-13: users, companies, branches, warehouses, products, invoices/month, customers, documents
  const row = (code) => new RegExp(`'${code}', '[^']+', '[^']+', '(?:free|paid)', (-?\\d+), (-?\\d+), (-?\\d+), (-?\\d+), (-?\\d+), (-?\\d+), (-?\\d+), (-?\\d+), (-?\\d+), (-?\\d+), (-?\\d+),`).exec(seed).slice(1, 12).map(Number);
  assert.deepEqual(row('free').slice(0, 8), [1, 1, 1, 1, -1, 200, 200, 500]);
  assert.deepEqual(row('texa-starter').slice(0, 8), [3, 1, 1, 2, 2000, 1000, -1, -1]);
  assert.deepEqual(row('texa-professional').slice(0, 8), [10, 3, 5, 10, 20000, 5000, -1, -1]);
  assert.deepEqual(row('texa-enterprise').slice(0, 8), [-1, -1, -1, -1, -1, -1, -1, -1]);
  assert.match(seed, /'free'[\s\S]{0,400}ARRAY\['fabric'/, 'free carries the fabric module (a Rashid fabric import needs it)');
});

test('normalizeCloudPlan keeps only validated control-panel columns', () => {
  const n = ps.normalizeCloudPlan({ code: 'texa-custom', name_en: 'Custom', plan_type: 'paid', max_users: '7', max_customers: -1, max_documents: 'many', max_products: 3.5,
    included_modules: ['hr', 'bad module!', 'hr', 'fabric'], features: { a: 1 }, price_monthly: '12.50', is_active: true, evil_column: 'x', max_branches: 99999999999 });
  assert.equal(n.code, 'texa-custom');
  assert.deepEqual(n.cols, { max_users: 7, max_customers: -1, price_monthly: 12.5, name_en: 'Custom', plan_type: 'paid', is_active: true, included_modules: ['hr', 'fabric'], features: { a: 1 }, name_ar: 'Custom' });
  for (const bad of [null, {}, { code: '' }, { code: 'a b' }, { code: "x';drop" }, { code: 5 }, []]) assert.equal(ps.normalizeCloudPlan(bad), null);
});

test('upsertCloudPlan binds every value and refuses a column that is not on the control-panel list', async () => {
  const calls = [];
  const pg = async (t, p) => { calls.push({ t, p }); return { rows: [{ id: 'P1' }], rowCount: 1 }; };
  await ps.upsertCloudPlan(pg, { code: 'free', cols: { max_customers: 200, included_modules: ['fabric'] } });
  const ins = calls.find((c) => /^INSERT/.test(c.t.trim()));
  assert.match(ins.t, /ON CONFLICT \(code\) DO UPDATE SET max_customers = EXCLUDED\.max_customers, included_modules = EXCLUDED\.included_modules, updated_at = now\(\)/);
  assert.match(ins.t, /\$3::text\[\]/);
  assert.deepEqual(ins.p, ['free', 200, ['fabric']]);
  assert.ok(!/200/.test(ins.t), 'values are bound, never inlined');
  assert.ok(calls.some((c) => /set_config\('texacore\.plan_change_confirmed'/.test(c.t) && c.p[0] === 'P1'), 'the confirmation is bound to the plan being written');
  await assert.rejects(ps.upsertCloudPlan(pg, { code: 'free', cols: { 'max_users; drop table x': 1 } }), /not allowed/);
});

// A tiny in-memory model of the three tables the sync touches
function fakeDb(plans) {
  const db = { plans: new Map(plans.map((p) => [p.code, { id: 'id-' + p.code, ...p }])), subs: new Map(), tenants: ['T1', 'T2'], log: [] };
  db.query = async (text, params = []) => {
    db.log.push(text);
    if (/^SELECT id FROM public\.subscription_plans WHERE code/.test(text)) { const r = db.plans.get(params[0]); return { rows: r ? [{ id: r.id }] : [], rowCount: r ? 1 : 0 }; }
    if (/set_config\('texacore\.plan_change_confirmed'/.test(text)) { db.confirmed = (db.confirmed || []).concat(params[0]); return { rows: [], rowCount: 1 }; }
    if (/^INSERT INTO public\.subscription_plans/.test(text.trim())) {
      const names = /\(product_id, code(?:, ([^)]*))?\)/.exec(text)[1] || '';
      const cols = names ? names.split(', ') : [];
      const code = params[0];
      const row = db.plans.get(code) || { id: 'id-' + code, code };
      cols.forEach((c, i) => { row[c] = params[i + 1]; });
      db.plans.set(code, row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (/^SELECT id, code, plan_type/.test(text)) { const r = db.plans.get(params[0]); return { rows: r ? [r] : [], rowCount: r ? 1 : 0 }; }
    if (/^UPDATE public\.subscription_plans SET/.test(text)) {
      const row = [...db.plans.values()].find((p) => p.id === params[0]);
      const sets = [...text.matchAll(/(\w+) = \$(\d+)(?:::text\[\])?/g)];
      for (const m of sets) row[m[1]] = params[Number(m[2]) - 1];
      return { rows: [], rowCount: 1 };
    }
    if (/^SELECT id FROM public\.tenants/.test(text)) return { rows: db.tenants.map((id) => ({ id })), rowCount: db.tenants.length };
    if (/^UPDATE public\.tenant_subscriptions/.test(text)) { db.subs.set(params[0], { plan_id: params[1], status: params[2] }); return { rows: [{ id: 's-' + params[0] }], rowCount: 1 }; }
    throw new Error('unexpected SQL: ' + text.slice(0, 80));
  };
  return db;
}
const seedFree = { code: 'free', plan_type: 'free', max_users: 1, max_companies: 1, max_customers: 200, max_documents: 500, max_warehouses: 1, included_modules: ['fabric'] };
const seedPro = { code: 'texa-professional', plan_type: 'paid', max_users: 10, included_modules: ['fabric', 'hr'] };

test('OFFLINE: nothing is written to any plan row; the tenant follows the licence tier using the rows as they are', async () => {
  const db = fakeDb([seedFree, seedPro]);
  const before = JSON.stringify([...db.plans.values()]);
  const r = await ps.syncActivePlan({ pgQuery: db.query }, { tier: 'free', license: { tier: 'free' }, cloudPlans: null });
  assert.equal(r.online, false);
  assert.equal(JSON.stringify([...db.plans.values()]), before, 'an offline sync must not touch the plan definitions');
  assert.ok(!db.log.some((t) => /^INSERT INTO public\.subscription_plans/.test(t.trim())));
  assert.deepEqual([...db.subs.values()].map((s) => s.plan_id), ['id-free', 'id-free']);
});

test('ONLINE: the control panel\'s changed limits and a brand-new plan the licence points to are applied', async () => {
  const db = fakeDb([seedFree, seedPro]);
  const cloud = [{ code: 'free', name_ar: 'مجاني', plan_type: 'free', max_customers: 50, max_documents: 120, max_warehouses: 3, included_modules: ['fabric', 'pbx'] },
    { code: 'texa-gold', name_ar: 'ذهبي', plan_type: 'paid', max_users: 25, max_customers: -1, included_modules: ['fabric', 'hr', 'gold'] }];
  const r = await ps.syncActivePlan({ pgQuery: db.query }, { tier: 'pro', license: { tier: 'pro', plan_code: 'texa-gold' }, cloudPlans: cloud });
  assert.equal(r.online, true); assert.equal(r.catalogue, 2); assert.equal(r.code, 'texa-gold');
  assert.equal(db.plans.get('free').max_customers, 50);
  assert.equal(db.plans.get('free').max_documents, 120);
  assert.equal(db.plans.get('free').max_users, 1, 'a column the cloud row did not carry keeps its last value');
  assert.deepEqual(db.plans.get('free').included_modules, ['fabric', 'pbx']);
  assert.equal(db.plans.get('texa-gold').max_users, 25);
  assert.deepEqual([...new Set(db.confirmed)].sort(), ['id-free'], 'only the plan that already existed carries the control panel\'s confirmation, bound to its own id');
  assert.deepEqual([...db.subs.values()].map((s) => s.plan_id), ['id-texa-gold', 'id-texa-gold']);
});

test('a licence that points at a plan this copy has never synced uses the FREE plan until it can (never fails open)', async () => {
  const db = fakeDb([seedFree]);
  const r = await ps.syncActivePlan({ pgQuery: db.query }, { tier: 'pro', license: { tier: 'pro', plan_code: 'texa-unknown' }, cloudPlans: null });
  assert.equal(r.code, 'free'); assert.equal(r.wanted, 'texa-unknown');
});

test('forceTier (the user chose Free) ignores the licence\'s plan_code and custom limits', async () => {
  const db = fakeDb([seedFree, seedPro]);
  const r = await ps.syncActivePlan({ pgQuery: db.query }, { tier: 'free', forceTier: true, license: { tier: 'trial', plan_code: 'texa-professional', custom_limits: true, max_users: 99 } });
  assert.equal(r.code, 'free'); assert.equal(db.plans.get('free').max_users, 1);
});

test('per-licence overrides: custom_limits replaces the four licence-level limits only when true; the module grant only with its flag', async () => {
  const lic = { tier: 'pro', plan_code: 'texa-professional', max_users: 40, max_companies: 7, max_warehouses: 20, max_storage_gb: 500, enabled_modules: ['fabric', 'gold', 'junk!'] };
  let db = fakeDb([seedFree, seedPro]);
  await ps.syncActivePlan({ pgQuery: db.query }, { tier: 'pro', license: { ...lic, custom_limits: false, modules_admin_set: false } });
  assert.equal(db.plans.get('texa-professional').max_users, 10); assert.deepEqual(db.plans.get('texa-professional').included_modules, ['fabric', 'hr']);
  db = fakeDb([seedFree, seedPro]);
  const r = await ps.syncActivePlan({ pgQuery: db.query }, { tier: 'pro', license: { ...lic, custom_limits: true, modules_admin_set: true } });
  assert.equal(db.plans.get('texa-professional').max_users, 40); assert.equal(db.plans.get('texa-professional').storage_gb, 500);
  assert.deepEqual(db.plans.get('texa-professional').included_modules, ['fabric', 'gold']);
  assert.deepEqual(r.overrides.sort(), ['included_modules', 'max_companies', 'max_users', 'max_warehouses', 'storage_gb']);
});

test('subscription dates: free never expires, an expired trial is expired, a paid license runs to its end date', () => {
  const today = '2026-10-13';
  assert.deepEqual(ps.subscriptionDates({ tier: 'free', license: {}, today }), { status: 'active', start_date: today, end_date: '2099-12-31', trial_end_date: null });
  assert.equal(ps.subscriptionDates({ tier: 'trial', license: { expires_at: '2026-10-20T00:00:00Z' }, today }).status, 'trial');
  assert.equal(ps.subscriptionDates({ tier: 'trial', license: { expires_at: '2026-10-01T00:00:00Z' }, today }).status, 'expired');
  assert.deepEqual(ps.subscriptionDates({ tier: 'pro', license: { expires_at: '2027-01-01T00:00:00Z', activated_at: '2026-01-01T00:00:00Z' }, today }), { status: 'active', start_date: '2026-01-01', end_date: '2027-01-01', trial_end_date: null });
});

test('syncActivePlan fails loudly when there is no plan row at all', async () => {
  const db = fakeDb([]);
  await assert.rejects(ps.syncActivePlan({ pgQuery: db.query }, { tier: 'free' }), /no free plan row/);
});
