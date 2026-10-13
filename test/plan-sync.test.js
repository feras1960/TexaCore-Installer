'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
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

test('every plan, free included, carries the fabric module (a Rashid fabric import needs it)', () => {
  for (const [code, d] of Object.entries(ps.PLAN_DEFAULTS)) assert.ok(d.modules.includes('fabric'), `${code} lacks fabric`);
});

test('the trial gets PROFESSIONAL limits from the license, with a real end date', () => {
  const lic = { tier: 'trial', max_users: 10, max_companies: 3, max_warehouses: 10, max_storage_gb: -1, activated_at: '2026-10-13T00:00:00Z', expires_at: '2026-10-27T00:00:00Z' };
  const spec = ps.buildPlanSpec({ tier: 'trial', license: lic });
  assert.equal(spec.code, 'texa-professional');
  assert.equal(spec.limits.max_users, 10);
  assert.equal(spec.limits.max_products, 5000);                     // not on the license → built-in Professional default
  const d = ps.subscriptionDates({ tier: 'trial', license: lic, today: '2026-10-13' });
  assert.deepEqual(d, { status: 'trial', start_date: '2026-10-13', end_date: '2026-10-27', trial_end_date: '2026-10-27' });
});

test('limit precedence: license value → cloud package → built-in default', () => {
  const spec = ps.buildPlanSpec({ tier: 'pro', license: { max_users: 7 }, cloudPlan: { max_users: 99, max_branches: 4, included_modules: ['fabric', 'hr'] } });
  assert.equal(spec.limits.max_users, 7);
  assert.equal(spec.limits.max_branches, 4);
  assert.equal(spec.limits.max_companies, 3);
  assert.deepEqual(spec.modules, ['fabric', 'hr']);
  assert.equal(spec.moduleSource, 'cloud-plan');
});

test('an admin module grant wins over the plan; a stale list without the admin flag is ignored; junk codes are dropped', () => {
  const base = { tier: 'basic' };
  const granted = ps.buildPlanSpec({ ...base, license: { modules_admin_set: true, enabled_modules: ['sales', 'fabric', "x'; drop table", ''] } });
  assert.deepEqual(granted.modules, ['sales', 'fabric']);
  assert.equal(granted.moduleSource, 'admin-grant');
  const stale = ps.buildPlanSpec({ ...base, license: { modules_admin_set: false, enabled_modules: ['sales'] } });
  assert.equal(stale.moduleSource, 'plan-default');
  assert.ok(stale.modules.includes('pbx'));
});

test('subscription dates: free never expires, an expired trial is expired, a paid license runs to its end date', () => {
  assert.equal(ps.subscriptionDates({ tier: 'free', license: null, today: '2026-10-13' }).end_date, '2099-12-31');
  assert.equal(ps.subscriptionDates({ tier: 'trial', license: { expires_at: '2026-10-01T00:00:00Z' }, today: '2026-10-13' }).status, 'expired');
  const paid = ps.subscriptionDates({ tier: 'pro', license: { expires_at: '2027-01-01T00:00:00Z', activated_at: '2026-01-01T00:00:00Z' }, today: '2026-10-13' });
  assert.deepEqual(paid, { status: 'active', start_date: '2026-01-01', end_date: '2027-01-01', trial_end_date: null });
  assert.equal(ps.subscriptionDates({ tier: 'pro', license: {}, today: '2026-10-13' }).end_date, '2099-12-31');
});

test('syncActivePlan INSERTs the plan when it is missing (the 1.x bug) and points every tenant at it', async () => {
  const calls = [];
  const pgQuery = async (text, params) => {
    calls.push({ text, params });
    if (/INSERT INTO public\.subscription_plans/.test(text)) return { rows: [{ id: 'plan-1' }], rowCount: 1 };
    if (/FROM public\.tenants/.test(text)) return { rows: [{ id: 't1' }, { id: 't2' }], rowCount: 2 };
    if (/UPDATE public\.tenant_subscriptions/.test(text)) return params[0] === 't1' ? { rows: [{ id: 'sub-existing' }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (/INSERT INTO public\.tenant_subscriptions/.test(text)) return { rows: [{ id: 'sub' }], rowCount: 1 };
    throw new Error('unexpected ' + text);
  };
  const res = await ps.syncActivePlan({ pgQuery }, { tier: 'trial', license: { expires_at: '2026-10-27T00:00:00Z' }, today: '2026-10-13' });
  assert.equal(res.code, 'texa-professional');
  assert.equal(res.tenants, 2);
  const upsert = calls.find((c) => /INSERT INTO public\.subscription_plans/.test(c.text));
  assert.match(upsert.text, /ON CONFLICT \(code\) DO UPDATE/);
  assert.equal(upsert.params[0], 'texa-professional');
  assert.ok(upsert.params[15].includes('hr'));                      // included_modules
  assert.equal(calls.filter((c) => /INSERT INTO public\.tenant_subscriptions/.test(c.text)).length, 1);   // t2 had none → inserted
  assert.ok(!calls.some((c) => /apply_tenant_plan/.test(c.text)), 'apply_tenant_plan never existed');
});

test('syncActivePlan fails loudly when the plan cannot be written', async () => {
  await assert.rejects(ps.syncActivePlan({ pgQuery: async () => { throw new Error('boom'); } }, { tier: 'free' }), /boom/);
});

test('the free plan never caps data volume below what a Rashid import writes, whatever the cloud package says', () => {
  const spec = ps.buildPlanSpec({ tier: 'free', cloudPlan: { max_warehouses: 1, max_products: 200, max_invoices_monthly: 200, max_customers: 200, max_documents: 500, max_users: 1, max_companies: 1, max_branches: 1 } });
  for (const k of ps.FREE_IMPORT_FLOOR) assert.equal(spec.limits[k], -1, k);
  assert.equal(spec.limits.max_users, 1);                // who may use it stays limited
  assert.equal(spec.limits.max_companies, 1);
  // a paid plan keeps what the cloud says
  assert.equal(ps.buildPlanSpec({ tier: 'pro', cloudPlan: { max_warehouses: 4 } }).limits.max_warehouses, 4);
});
