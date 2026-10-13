#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// plan-sync-check — plan limits and modules come from the plan definition the control panel manages, never from the program (owner
// decision 2026-10-13), and an import is never refused by a limit. Runs the PACKAGED (or dev) app against a MOCK cloud on 127.0.0.1:47399
// (TEXACORE_CLOUD_MOCK_URL — honoured only by an isolated harness run; production is never contacted):
//
//   A  first run with the network BLOCKED (nothing listens on the mock port): the app installs and the free plan works from the bundled rows
//   B  the network returns, the control panel has CHANGED the free plan (and added a plan): the local copy picks it up on its next tick,
//      the server's own triggers enforce the new numbers; a LOWERED limit passes production's plan guard (it carries the confirmation)
//   C  offline again: the synced values stay — through more ticks AND through a restart
//   E  a Rashid import into a company on a free plan whose limits the file EXCEEDS: the import (and its preview) fully succeeds; afterwards
//      a NEW customer / warehouse is refused with the plan-limit message
//   D  the licence points at a plan this copy has never seen (+ custom limits): it is fetched and applied
//
//   node scripts/e2e/plan-sync-check.js --workdir <empty dir> [--app <packaged .app>] [--erp <ERP checkout> --rsf <file.rsf>]
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Client } = require('pg');
const { ROOT, PORTS, PORT_BASE, Results, portFree, request, startApp, stopApp, setPgPassword, pgOptions } = require('./lib');

const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const WORK = path.resolve(arg('workdir', ''));
const APP = arg('app', '');
const ERP = arg('erp', '');
const RSF = arg('rsf', '');
const CONTROL = process.argv.includes('--control');     // negative control: the import exemption switched OFF → the same import must be REFUSED by the plan
if (!arg('workdir')) { console.error('--workdir is required'); process.exit(2); }
const binary = APP ? path.join(path.resolve(APP), 'Contents', 'MacOS', path.basename(path.resolve(APP), '.app')) : '';
const MOCK_PORT = PORT_BASE + 8;                       // 47399 — inside the installer's port block
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
const userData = path.join(WORK, 'userdata');
const dataDir = path.join(userData, 'texacore-data');
const UI = `http://127.0.0.1:${PORTS.ui}`;
const API = `http://127.0.0.1:${PORTS.api}`;
const ADMIN = `http://127.0.0.1:${PORTS.admin}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pg = async (sql, params = []) => {
  const c = new Client(pgOptions());
  await c.connect();
  try { return await c.query(sql, params); } finally { await c.end(); }
};
async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(500); }
}

// ── the mock control panel ──
const cloud = { server: null, plans: [], licenseState: null, hits: { plans: 0, state: 0 } };
const FREE_MODS = ['fabric', 'ai_analytics', 'general_trade', 'contracts'];
const planRow = (code, o) => ({ code, name_ar: o.name_ar || code, name_en: o.name_en || code, plan_type: o.plan_type || 'paid', is_active: true,
  max_users: 1, max_companies: 1, max_branches: 1, max_warehouses: 1, max_products: -1, max_invoices_monthly: 200, max_customers: 200, max_documents: 500, max_images: -1, max_records: -1, storage_gb: 1,
  included_modules: FREE_MODS, ...o });
function startMock() {
  return new Promise((resolve, reject) => {
    cloud.server = http.createServer((req, res) => {
      const u = new URL(req.url, MOCK_URL);
      const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (req.method === 'GET' && u.pathname === '/rest/v1/subscription_plans') {
        cloud.hits.plans += 1;
        const code = (u.searchParams.get('code') || '').replace(/^eq\./, '');
        return send(200, code ? cloud.plans.filter((p) => p.code === code) : cloud.plans.filter((p) => p.is_active));
      }
      if (req.method === 'POST' && u.pathname === '/rest/v1/rpc/licensing_get_license_state') { cloud.hits.state += 1; req.resume(); return send(200, cloud.licenseState); }
      req.resume(); return send(404, { message: 'not in the mock' });
    });
    cloud.server.on('error', reject);
    cloud.server.listen(MOCK_PORT, '127.0.0.1', resolve);
  });
}
const stopMock = () => new Promise((resolve) => { if (!cloud.server) return resolve(); cloud.server.close(() => resolve()); cloud.server.closeAllConnections && cloud.server.closeAllConnections(); cloud.server = null; });

let child = null; let ready = null;
async function boot(license) {
  const logFile = path.join(WORK, `app-${Date.now()}.log`);
  ({ child, ready } = startApp({ userData, license, logFile, appBinary: binary, extraEnv: { TEXACORE_CLOUD_MOCK_URL: MOCK_URL, TEXACORE_PLAN_SYNC_MS: '2000', ...(CONTROL ? { TEXACORE_SKIP_FUNCTION_PATCHES: '1' } : {}) } }));
  await ready;
  return logFile;
}
async function shutdown() { if (child) { await stopApp(child, userData); child = null; } }

const freeRow = async (code = 'free') => (await pg('SELECT max_users, max_companies, max_branches, max_warehouses, max_products, max_invoices_monthly, max_customers, max_documents, included_modules FROM public.subscription_plans WHERE code = $1', [code])).rows[0];

(async () => {
  const R = new Results();
  for (const p of [...Object.values(PORTS), MOCK_PORT]) if (!(await portFree(p))) { console.error(`port ${p} busy`); process.exit(2); }
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
  let secrets; let H; let A = null; let admin = null;
  const customerInsert = async (token, code) => request('POST', `${API}/rest/v1/customers`, { headers: { apikey: secrets.anonKey, Authorization: `Bearer ${token}`, Prefer: 'return=minimal' }, body: { tenant_id: A.tenantId, company_id: A.companyId, code, name_ar: 'Probe ' + code } });
  const signIn = async () => (await request('POST', `http://127.0.0.1:${PORTS.gotrue}/token?grant_type=password`, { headers: { apikey: secrets.anonKey }, body: { email: 'owner@plan.test', password: 'PlanPass#2026' } })).json.access_token;
  try {
    if (CONTROL) {
      // ─────────── control: no exemption → the plan refuses the import (proves the exemption is what lets it through) ───────────
      await R.check('CONTROL the import exemption is OFF: the same Rashid import on the same lowered free plan is REFUSED by the plan (so the patch is what allows it)', async () => {
        if (!(ERP && RSF)) throw new Error('--erp and --rsf are required');
        await boot('free');
        secrets = JSON.parse(fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8')); setPgPassword(secrets.dbPassword);
        const mk = JSON.parse(fs.readFileSync(path.join(dataDir, 'bootstrap.json'), 'utf8'));
        if (Object.keys(mk.patchedFunctions || {}).length) throw new Error('the control run still has the patch');
        cloud.plans = [planRow('free', { plan_type: 'free', max_users: 1, max_warehouses: 1, max_customers: 50, max_invoices_monthly: 5, max_documents: 100, included_modules: FREE_MODS })];
        cloud.licenseState = { license_key: 'FREE-LOCAL', tier: 'free', status: 'active', plan_code: 'free', custom_limits: false };
        await startMock();
        await until(async () => (await freeRow()).max_customers === 50, 30000, 'the lowered free plan');
        const out = require('child_process').spawnSync('node', ['--import', 'tsx', '--import', path.join(__dirname, 'rsf-register.mjs'), path.join(__dirname, 'rsf-import.mts')],
          { encoding: 'utf8', timeout: 1500000, cwd: ERP, env: { ...process.env, WT_SRC: path.join(ERP, 'src'), ERP_DIR: ERP, RSF, UI_URL: UI, API_URL: API, ADMIN_URL: ADMIN, ADMIN_SECRET: secrets.localApiSecret,
            ANON_KEY: secrets.anonKey, OUT: path.join(WORK, 'rsf'), PG_PORT: String(PORTS.pg), PG_PASSWORD: secrets.dbPassword } });
        const text = `${out.stdout || ''}\n${out.stderr || ''}`;
        if (out.status === 0) throw new Error('the import succeeded WITHOUT the exemption — the control proves nothing');
        if (!/PLAN_LIMIT_EXCEEDED/.test(text)) throw new Error(`the import failed, but not on the plan limit: ${text.slice(-500)}`);
        return `refused: ${(text.match(/PLAN_LIMIT_EXCEEDED[^"\n]{0,60}/) || [''])[0]}`;
      });
    } else {
    // ─────────── A: first run, network blocked ───────────
    await R.check('A1 first run with the network BLOCKED: the app installs and starts (no cloud answer at all)', async () => {
      await boot('free');
      secrets = JSON.parse(fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8')); setPgPassword(secrets.dbPassword);
      H = { 'x-texacore-local-secret': secrets.localApiSecret };
      const cc = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: { companyName: 'Plan Co', adminEmail: 'owner@plan.test', adminPassword: 'PlanPass#2026', localCurrency: 'UAH', mainCurrency: 'USD', country: 'UA', storagePath: path.join(WORK, 'tcdb'), dbFileName: 'plan' } });
      if (!cc.json || !cc.json.success) throw new Error(`create company: ${cc.text.slice(0, 200)}`);
      A = cc.json;
      return `company ${A.companyId.slice(0, 8)}…; mock cloud hits so far: ${JSON.stringify(cloud.hits)}`;
    });
    await R.check('A2 the free plan works from the bundled definition: production numbers, the free modules, a subscription on it', async () => {
      await sleep(5500);                                                    // > 2 sync ticks: they must change nothing while offline
      const f = await freeRow();
      const want = { max_users: 1, max_companies: 1, max_branches: 1, max_warehouses: 1, max_products: -1, max_invoices_monthly: 200, max_customers: 200, max_documents: 500 };
      for (const [k, v] of Object.entries(want)) if (f[k] !== v) throw new Error(`free.${k} = ${f[k]}, want ${v}`);
      if (!f.included_modules.includes('fabric')) throw new Error('free lacks fabric');
      const sub = (await pg(`SELECT sp.code, ts.status FROM public.tenant_subscriptions ts JOIN public.subscription_plans sp ON sp.id = ts.plan_id WHERE ts.tenant_id = $1`, [A.tenantId])).rows[0];
      if (sub.code !== 'free' || sub.status !== 'active') throw new Error(`subscription ${JSON.stringify(sub)}`);
      admin = await signIn();
      const c1 = await customerInsert(admin, 'OFF-1');
      if (c1.status >= 300) throw new Error(`offline: creating a customer failed ${c1.status} ${c1.text.slice(0, 160)}`);
      const log = fs.readFileSync(path.join(userData, 'logs', 'heartbeat.log'), 'utf8');
      if (!/cloud catalogue unreachable/.test(log) || !/offline: last synced values/.test(log)) throw new Error('the log does not show the offline path');
      return `free = users 1, companies 1, branches 1, warehouses 1, products ∞, invoices 200, customers 200, documents 500; modules ${f.included_modules.join(',')}; customer created while offline; ticks changed nothing`;
    });

    // ─────────── B: the network returns; the control panel changed the free plan ───────────
    await R.check('B1 network returns: the changed free plan (customers 200→3, documents 500→77, warehouses 1→3, users 1→2, +pbx) and a NEW plan are applied on the next tick', async () => {
      cloud.plans = [planRow('free', { plan_type: 'free', max_users: 2, max_warehouses: 3, max_customers: 3, max_documents: 77, included_modules: [...FREE_MODS, 'pbx'] }),
        planRow('texa-custom', { name_en: 'Custom', max_users: 7, max_customers: 11, max_documents: 33, included_modules: [...FREE_MODS, 'hr', 'gold'] })];
      cloud.licenseState = { license_key: 'FREE-LOCAL', tier: 'free', status: 'active', plan_code: 'free', custom_limits: false };
      await startMock();
      const f = await until(async () => { const r = await freeRow(); return r.max_customers === 3 ? r : null; }, 30000, 'the local free plan to follow the control panel');
      if (f.max_documents !== 77 || f.max_warehouses !== 3 || f.max_users !== 2 || !f.included_modules.includes('pbx')) throw new Error(`partial sync: ${JSON.stringify(f)}`);
      const custom = await freeRow('texa-custom');
      if (!custom || custom.max_users !== 7 || !custom.included_modules.includes('gold')) throw new Error(`new plan not synced: ${JSON.stringify(custom)}`);
      const pbx = (await pg(`SELECT 1 FROM public.tenant_modules WHERE tenant_id = $1 AND module_code = 'pbx' AND is_active`, [A.tenantId])).rowCount;
      if (!pbx) throw new Error('the new module did not reach tenant_modules');
      return `free now customers ${f.max_customers}, documents ${f.max_documents}, warehouses ${f.max_warehouses}, users ${f.max_users}, +pbx (tenant_modules updated); plan texa-custom added; mock hits ${JSON.stringify(cloud.hits)}`;
    });
    await R.check('B2 the server\'s own trigger enforces the NEW number: the 4th customer on the free plan is refused with the plan-limit message', async () => {
      admin = await signIn();
      const ok = [];
      for (const n of ['B-2', 'B-3']) { const r = await customerInsert(admin, n); if (r.status >= 300) throw new Error(`customer ${n} refused too early: ${r.text.slice(0, 160)}`); ok.push(n); }
      const over = await customerInsert(admin, 'B-4');
      if (over.status < 400 || !/PLAN_LIMIT_EXCEEDED: customers \(3\/3\)/.test(over.text)) throw new Error(`4th customer → ${over.status} ${over.text.slice(0, 200)}`);
      return `3 customers allowed (1 created offline + ${ok.join(', ')}), the 4th → "${JSON.parse(over.text).message}"`;
    });
    await R.check('B3 a LOWERED limit from the control panel passes production\'s plan guard (warehouses 3→2, users 2→1)', async () => {
      // production's guard: without the confirmation only the console function carries, a plain UPDATE that lowers a mirrored limit is refused
      let refused = '';
      try { await pg(`UPDATE public.subscription_plans SET max_warehouses = 1 WHERE code = 'free'`); } catch (e) { refused = e.code || e.message; }
      if (refused !== 'PC001') throw new Error(`a plain lowering UPDATE was not refused by the plan guard (${refused || 'accepted'})`);
      cloud.plans[0] = planRow('free', { plan_type: 'free', max_users: 1, max_warehouses: 2, max_customers: 3, max_documents: 77, included_modules: [...FREE_MODS, 'pbx'] });
      const f = await until(async () => { const r = await freeRow(); return r.max_warehouses === 2 && r.max_users === 1 ? r : null; }, 30000, 'the lowered limits');
      return `warehouses ${f.max_warehouses}, users ${f.max_users} (a plain UPDATE of those raises PC001 "confirm through console_update_subscription_plan" — verified just before)`;
    });

    // ─────────── C: offline again ───────────
    await R.check('C1 offline again: the synced values stay through further ticks, and enforcement still uses them', async () => {
      await stopMock();
      await sleep(7000);
      const f = await freeRow();
      if (f.max_customers !== 3 || f.max_documents !== 77 || f.max_warehouses !== 2 || !f.included_modules.includes('pbx')) throw new Error(`values changed offline: ${JSON.stringify(f)}`);
      const over = await customerInsert(admin, 'C-1');
      if (over.status < 400 || !/PLAN_LIMIT_EXCEEDED: customers \(3\/3\)/.test(over.text)) throw new Error(`offline enforcement → ${over.status} ${over.text.slice(0, 160)}`);
      return 'customers 3 / documents 77 / warehouses 2 / +pbx unchanged after 3+ offline ticks; the 4th customer is still refused';
    });
    await R.check('C2 …and through a RESTART with the network still down (nothing falls back to the bundled numbers)', async () => {
      await shutdown();
      await sleep(1500);
      await boot('free');
      await sleep(5000);
      const f = await freeRow();
      if (f.max_customers !== 3 || f.max_documents !== 77 || f.max_warehouses !== 2 || !f.included_modules.includes('pbx')) throw new Error(`values after restart: ${JSON.stringify(f)}`);
      const sub = (await pg(`SELECT sp.code FROM public.tenant_subscriptions ts JOIN public.subscription_plans sp ON sp.id = ts.plan_id WHERE ts.tenant_id = $1`, [A.tenantId])).rows[0];
      if (sub.code !== 'free') throw new Error(`subscription ${sub.code}`);
      admin = await signIn();
      const over = await customerInsert(admin, 'C-2');
      if (over.status < 400 || !/PLAN_LIMIT_EXCEEDED: customers \(3\/3\)/.test(over.text)) throw new Error(`after restart → ${over.status} ${over.text.slice(0, 160)}`);
      return 'after a restart, offline: customers 3, documents 77, warehouses 2, +pbx still in force; the 4th customer still refused';
    });

    // ─────────── E: a Rashid import that exceeds the free plan's limits ───────────
    if (ERP && RSF) {
      await R.check('E1 Rashid import on the FREE plan whose limits the file exceeds (customers 95>50, warehouses >1, invoices): import + preview fully succeed; afterwards NEW work meets the limits', async () => {
        cloud.plans[0] = planRow('free', { plan_type: 'free', max_users: 1, max_warehouses: 1, max_customers: 50, max_invoices_monthly: 5, max_documents: 100, included_modules: [...FREE_MODS, 'pbx'] });
        await startMock();
        await until(async () => (await freeRow()).max_customers === 50, 30000, 'the lowered free plan');
        const out = require('child_process').spawnSync('node', ['--import', 'tsx', '--import', path.join(__dirname, 'rsf-register.mjs'), path.join(__dirname, 'rsf-import.mts')],
          { encoding: 'utf8', timeout: 1500000, cwd: ERP, env: { ...process.env, WT_SRC: path.join(ERP, 'src'), ERP_DIR: ERP, RSF, UI_URL: UI, API_URL: API, ADMIN_URL: ADMIN, ADMIN_SECRET: secrets.localApiSecret,
            ANON_KEY: secrets.anonKey, OUT: path.join(WORK, 'rsf'), PG_PORT: String(PORTS.pg), PG_PASSWORD: secrets.dbPassword } });
        fs.mkdirSync(path.join(WORK, 'rsf'), { recursive: true });
        fs.writeFileSync(path.join(WORK, 'rsf', 'stdout.txt'), out.stdout || ''); fs.writeFileSync(path.join(WORK, 'rsf', 'stderr.txt'), out.stderr || '');
        if (out.status !== 0) throw new Error(`${(out.stdout || '').slice(-700)}\n${(out.stderr || '').slice(-400)}`);
        const last = (out.stdout || '').trim().split('\n').slice(-1)[0];
        if (!/after the import customers 9\d\/50/.test(last) || !/PLAN_LIMIT_EXCEEDED: customers/.test(last) || !/PLAN_LIMIT_EXCEEDED: warehouses/.test(last)) throw new Error(`limits not as expected: ${last}`);
        return last;
      });
    } else console.log('  SKIP  E1 Rashid import (pass --erp and --rsf)');

    // ─────────── D: the licence points at a plan this copy has never seen ───────────
    await R.check('D1 a TRIAL licence pointing at the new plan "texa-custom" (+ custom_limits): the plan is fetched, the subscription follows, its modules appear', async () => {
      await shutdown();
      await sleep(1500);
      const exp = new Date(Date.now() + 10 * 86400000).toISOString();
      cloud.licenseState = { license_key: 'TRL-E2E-0000', tier: 'trial', status: 'active', plan_code: 'texa-custom', custom_limits: true, max_users: 4, max_companies: 2, max_warehouses: 6, max_storage_gb: 9, expires_at: exp, activated_at: new Date().toISOString() };
      cloud.plans = cloud.plans.filter((p) => p.code === 'free').concat([planRow('texa-custom', { name_en: 'Custom', max_users: 7, max_customers: 11, max_documents: 33, included_modules: [...FREE_MODS, 'hr', 'gold'] })]);
      if (!cloud.server) await startMock();
      await boot('trial');
      const r = await until(async () => {
        const x = (await pg(`SELECT sp.code, ts.status, sp.max_users, sp.max_warehouses, sp.max_customers, sp.max_documents,
                                    EXISTS (SELECT 1 FROM public.tenant_modules tm WHERE tm.tenant_id = ts.tenant_id AND tm.module_code = 'gold' AND tm.is_active) gold
                               FROM public.tenant_subscriptions ts JOIN public.subscription_plans sp ON sp.id = ts.plan_id WHERE ts.tenant_id = $1`, [A.tenantId])).rows[0];
        return x && x.code === 'texa-custom' && x.max_users === 4 ? x : null;
      }, 40000, 'the tenant to follow the licence\'s plan');
      if (r.status !== 'trial' || !r.gold || r.max_warehouses !== 6 || r.max_customers !== 11) throw new Error(`plan state ${JSON.stringify(r)}`);
      return `tenant now on ${r.code} (${r.status}); plan limits: customers ${r.max_customers}, documents ${r.max_documents}; licence custom_limits applied: users 4, warehouses 6; module gold active`;
    });
    }
  } catch (e) {
    R.rows.push({ name: 'harness', ok: false, evidence: e.stack || e.message, ms: 0 });
    console.log(`  FAIL  harness — ${e.message}`);
  } finally {
    await shutdown();
    await stopMock();
  }
  fs.writeFileSync(path.join(WORK, 'plan-sync-results.json'), JSON.stringify({ at: new Date().toISOString(), app: APP || 'electron dev mode', summary: R.summary(), rows: R.rows }, null, 2));
  console.log(`\nplan-sync-check: ${R.summary()}  →  ${path.join(WORK, 'plan-sync-results.json')}`);
  process.exit(R.failed.length ? 1 : 0);
})();
