#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// limits-compat-check — plan limits and seats on the DESKTOP edition (free = 1 user / 1 company, trial = texa-professional: 10 users / 3 companies), end to end on a real build
// (isolated userData, ports 47391+, never the owner's data). Written for 2.0.3, which ships the production update that
//   * enforces the company limit on every plan (triggers on companies INSERT and on UPDATE OF tenant_id, status),
//   * counts users as SEATS (accepted + active) and refuses an acceptance on a full plan (triggers on user_profiles AND tenant_users),
//   * answers get_all_plan_limits / check_plan_limits only for the caller's own tenant (privileged sessions and platform admins excepted).
// The question it answers: does ANY of that lock a desktop admin out of something the previous build allowed?  It is a DIFFERENTIAL harness: every operation is recorded as an outcome
// in <workdir>/matrix.json, and the same script can be run against the previous build (--app <2.0.2 .app>) — `--diff a.json b.json` prints the operations whose outcome differs.
//
//   node scripts/e2e/limits-compat-check.js --workdir <empty dir> --license free|trial --app "<TexaCore ERP.app>" [--erp <ERP checkout>]  (--erp enables the real-browser probe)
//   node scripts/e2e/limits-compat-check.js --diff <old matrix.json> <new matrix.json>
//
//   L1  first run + create the local company (the owner is the tenant-less→tenant admin of a NEW tenant, as the launcher does it) + a second tenant (for the cross-tenant probes)
//   L2  the admin's own plan answer (what the ERP page asks): no error, plan, modules, limits with the right numbers
//   L3  every check_plan_limits type answers for the admin's own tenant
//   L4  the company the admin owns can still be edited at the limit (a PATCH that carries status = active passes the new UPDATE trigger)
//   L5  more companies in the SAME tenant: the plan decides (free: refused with the plan message; trial: up to 3)
//   L6  warehouses and customers follow the plan (free 1 warehouse; trial more)
//   L7  employees (the installer's invite path): within seats accepted, beyond refused with the plan message; the employee works and gets his own plan answer
//   L8  deactivating a user frees a seat; a pending invitation holds none
//   L9  the other tenant's plan: the cross-tenant answer is closed (x) — recorded for the diff
//   L10 a tenant-less admin (profile detached): what he can still do — recorded for the diff
//   L11 the real ERP page (with --erp): plan answers without error, the sidebar lists modules, module routes are not blocked by the plan screen
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { PORTS, Results, portFree, request, startApp, stopApp, setPgPassword, pgOptions } = require('./lib');

function arg(name, def = '') { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }

if (process.argv.includes('--diff')) {
  const i = process.argv.indexOf('--diff');
  const a = JSON.parse(fs.readFileSync(process.argv[i + 1], 'utf8')); const b = JSON.parse(fs.readFileSync(process.argv[i + 2], 'utf8'));
  const keys = [...new Set([...Object.keys(a.matrix), ...Object.keys(b.matrix)])];
  let n = 0;
  for (const k of keys) {
    const x = JSON.stringify(a.matrix[k]); const y = JSON.stringify(b.matrix[k]);
    if (x !== y) { n++; console.log(`DIFF ${k}\n   old: ${x}\n   new: ${y}`); }
  }
  console.log(`${keys.length} operations compared, ${n} differ`);
  process.exit(0);
}

const WORK = path.resolve(arg('workdir', ''));
const LICENSE = arg('license', 'free');
const APP = arg('app', '');
const ERP = arg('erp', process.env.TEXACORE_ERP_DIR || '');
if (!arg('workdir')) { console.error('--workdir <dir> is required'); process.exit(2); }
const UI = `http://127.0.0.1:${PORTS.ui}`;
const API = `http://127.0.0.1:${PORTS.api}`;
const ADMIN = `http://127.0.0.1:${PORTS.admin}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pg(sql, params = []) {
  const c = new Client(pgOptions());
  await c.connect();
  try { return await c.query(sql, params); } finally { await c.end(); }
}
/** Run one query the way PostgREST does for a logged-in user: role authenticated + the JWT claims of that user (check_plan_limits has two overloads, so PostgREST cannot be asked for it by name). */
async function asUser(userId, sql, params = []) {
  const c = new Client(pgOptions());
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE authenticated');
    await c.query(`SELECT set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [JSON.stringify({ sub: userId, role: 'authenticated' }), userId]);
    const r = await c.query(sql, params);
    await c.query('ROLLBACK');
    return r;
  } catch (e) { try { await c.query('ROLLBACK'); } catch { /* gone */ } throw e; } finally { await c.end(); }
}
const planCheck = async (userId, tenantId, type) => (await asUser(userId, 'SELECT public.check_plan_limits($1::uuid, $2::text) AS r', [tenantId, type])).rows[0].r || {};
/** A write the installer's maintenance session makes (provisioning marks it app.is_registering, which the profile guards honour). */
async function pgRegistering(sql, params = []) {
  const c = new Client(pgOptions());
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.is_registering', 'true', true)`);
    const r = await c.query(sql, params);
    await c.query('COMMIT');
    return r;
  } catch (e) { try { await c.query('ROLLBACK'); } catch { /* gone */ } throw e; } finally { await c.end(); }
}
/** The outcome of a REST/RPC answer as a short, comparable string (never the whole body: ids and timestamps differ per run). */
function outcome(r) {
  if (!r) return 'none';
  const b = r.json;
  const code = b && (b.code || b.error_code || b.error || b.reason);
  const msg = b && (b.message || b.error_en || b.error_description || (typeof b.error === 'string' ? b.error : ''));
  const text = r.status >= 300 ? ` ${String(code || '')}${msg ? ' | ' + String(msg).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>').slice(0, 120) : ''}` : '';
  return `${r.status}${text}`.trim();
}

(async () => {
  const R = new Results();
  const matrix = {};
  const rec = (k, v) => { matrix[k] = v; };
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
  for (const p of Object.values(PORTS)) if (!(await portFree(p))) { console.error(`port ${p} is in use`); process.exit(2); }
  const userData = path.join(WORK, 'userdata'); const logFile = path.join(WORK, 'app.log');
  const appBinary = APP ? path.join(path.resolve(APP), 'Contents', 'MacOS', path.basename(path.resolve(APP), '.app')) : '';
  console.log(`limits-compat-check: license=${LICENSE} app=${APP || '(dev checkout)'} workdir=${WORK}`);
  const { child, ready } = startApp({ userData, license: LICENSE, logFile, appBinary, extraEnv: { TEXACORE_UI_SMOKE: '1' } });
  try {
    await ready;
    const secrets = JSON.parse(fs.readFileSync(path.join(userData, 'texacore-data', 'secrets.json'), 'utf8'));
    setPgPassword(secrets.dbPassword);
    const H = { 'x-texacore-local-secret': secrets.localApiSecret };
    const anon = secrets.anonKey;
    const hasX = (await pg(`SELECT to_regprocedure('public.fn_enforce_user_seat()') IS NOT NULL AS x`)).rows[0].x;
    rec('build.has_seat_trigger_function', hasX);
    const body = (o) => ({ companyName: 'Compat A', adminEmail: 'owner-a@compat.test', adminPassword: 'CompatPass#2026', localCurrency: 'UAH', mainCurrency: 'USD', country: 'UA', storagePath: path.join(WORK, 'tcdb'), dbFileName: 'compat-a', ...o });
    const authOf = (tok, extra = {}) => ({ apikey: anon, Authorization: `Bearer ${tok}`, ...extra });
    const rpc = (fn, args, tok) => request('POST', `${API}/rest/v1/rpc/${fn}`, { headers: authOf(tok), body: args });
    let A = null; let B = null;

    await R.check('L1 first run, then the local company (a NEW tenant with its admin, the way the launcher does it) and a second tenant for the probes', async () => {
      const a = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: body({}) });
      if (!a.json || !a.json.success) throw new Error(`company A: ${a.text.slice(0, 300)}`);
      A = a.json;
      const b = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: body({ companyName: 'Compat B', adminEmail: 'owner-b@compat.test', dbFileName: 'compat-b' }) });
      if (!b.json || !b.json.success) throw new Error(`company B: ${b.text.slice(0, 300)}`);
      B = b.json;
      // the HTTP answer carries no user id: the admin accounts by e-mail
      for (const [co, email] of [[A, 'owner-a@compat.test'], [B, 'owner-b@compat.test']]) {
        const u = await pg('SELECT id FROM auth.users WHERE lower(email) = $1', [email]);
        if (u.rowCount !== 1) throw new Error(`admin account ${email}: ${u.rowCount} rows`);
        co.adminUserId = u.rows[0].id;
      }
      const sub = (await pg(`SELECT sp.code, sp.plan_type, ts.status, sp.max_users, sp.max_companies, sp.max_warehouses, sp.max_customers FROM public.tenant_subscriptions ts JOIN public.subscription_plans sp ON sp.id = ts.plan_id WHERE ts.tenant_id = $1 ORDER BY ts.created_at DESC LIMIT 1`, [A.tenantId])).rows[0];
      rec('L1.plan', sub);
      return `A ${A.companyId.slice(0, 8)}… plan ${sub.code} (${sub.plan_type}/${sub.status}) users ${sub.max_users} companies ${sub.max_companies} warehouses ${sub.max_warehouses}`;
    });
    if (!A) throw new Error('no company: nothing else can run');
    const plan = matrix['L1.plan'];
    const tokA = A.accessToken;

    await R.check('L2 the admin\'s own plan answer (get_all_plan_limits, what the ERP page asks): no error, a plan, modules, limits with the right numbers', async () => {
      const r = await rpc('get_all_plan_limits', { p_tenant_id: A.tenantId }, tokA);
      rec('L2.get_all_plan_limits.own', outcome(r));
      const j = r.json || {};
      if (r.status !== 200 || j.error) throw new Error(`answer: ${r.status} ${r.text.slice(0, 240)}`);
      if (j.plan_code !== plan.code) throw new Error(`plan_code ${j.plan_code}, expected ${plan.code}`);
      if (!Array.isArray(j.modules) || !j.modules.length) throw new Error('no modules in the answer');
      const L = j.limits || {};
      const want = { users: [1, plan.max_users], companies: [1, plan.max_companies] };
      for (const [k, [cur, max]] of Object.entries(want)) {
        if (!L[k] || Number(L[k].current) !== cur || Number(L[k].max) !== Number(max)) throw new Error(`limits.${k} = ${JSON.stringify(L[k])}, expected ${cur}/${max}`);
      }
      rec('L2.shape', { users: L.users, companies: L.companies, warehouses: L.warehouses && { current: L.warehouses.current, max: L.warehouses.max }, customers: L.customers && { current: L.customers.current, max: L.customers.max }, plan_type: j.plan_type, subscription_status: j.subscription_status || null, modules: j.modules.length });
      return `${j.plan_code}/${j.plan_type}: users ${L.users.current}/${L.users.max}, companies ${L.companies.current}/${L.companies.max}, warehouses ${L.warehouses && L.warehouses.current}/${L.warehouses && L.warehouses.max}; ${j.modules.length} modules`;
    });

    await R.check('L3 check_plan_limits (run as the admin: role authenticated + his claims) answers every type for the admin\'s own tenant', async () => {
      const types = ['users', 'companies', 'branches', 'warehouses', 'customers', 'products', 'invoices_monthly'];
      const out = [];
      for (const t of types) {
        const j = await planCheck(A.adminUserId, A.tenantId, t);
        if (j.error === 'forbidden' || j.error === 'exception') throw new Error(`${t}: ${JSON.stringify(j).slice(0, 200)}`);
        rec(`L3.check.${t}`, { allowed: j.allowed, current: j.current, max: j.max, error: j.error || null });
        out.push(`${t} ${j.current}/${j.max} ${j.allowed ? 'ok' : 'full'}`);
      }
      return out.join(', ');
    });

    await R.check('L4 the company can still be edited at the limit: PATCH name, and PATCH with status = active (the new UPDATE trigger must not count the company against itself)', async () => {
      const h = authOf(tokA, { Prefer: 'return=minimal' });     // companies has column-level grants: a representation would SELECT columns the ERP role may not read
      const u1 = await request('PATCH', `${API}/rest/v1/companies?id=eq.${A.companyId}`, { headers: h, body: { name: 'Compat A (renamed)' } });
      const u2 = await request('PATCH', `${API}/rest/v1/companies?id=eq.${A.companyId}`, { headers: h, body: { name: 'Compat A', status: 'active' } });
      rec('L4.patch_name', outcome(u1)); rec('L4.patch_name_status_active', outcome(u2));
      for (const [n, u] of [['name', u1], ['name+status', u2]]) if (u.status >= 300) throw new Error(`PATCH ${n} → ${u.status} ${u.text.slice(0, 200)}`);
      const now = (await pg('SELECT name, status FROM public.companies WHERE id = $1', [A.companyId])).rows[0];
      if (now.name !== 'Compat A' || now.status !== 'active') throw new Error(`the row after the PATCHes: ${JSON.stringify(now)}`);
      return `both PATCHes accepted (${u1.status}/${u2.status}), row = ${now.name}/${now.status}`;
    });

    await R.check('L5 more companies in the SAME tenant: the plan decides (free 1 → the 2nd is refused with the plan message; trial 3 → the 2nd and 3rd are created, the 4th is refused)', async () => {
      const results = [];
      const make = async (i) => rpc('fn_provision_new_company', { p_tenant_id: A.tenantId, p_idempotency_key: `compat:${i}:${Date.now()}`, p_company: { name: `Compat extra ${i}`, business_type: 'general', company_type: 'production', default_currency: 'UAH', supported_currencies: ['UAH', 'USD'], chart_template: 'extended', fiscal_year_start_month: 1, language: 'ar' } }, tokA);
      const max = Number(plan.max_companies);
      const attempts = Math.min(max + 1, 5) - 1;     // companies already 1
      for (let i = 2; i <= attempts + 1; i++) {
        const r = await make(i);
        const ok = r.status === 200 && r.json && (r.json.company_id || r.json.success);
        results.push({ i, ok: !!ok, outcome: ok ? 'created' : outcome(r) });
        rec(`L5.provision.${i}`, ok ? 'created' : outcome(r));
      }
      const created = results.filter((x) => x.ok).length;
      const n = (await pg(`SELECT count(*)::int n FROM public.companies WHERE tenant_id = $1 AND COALESCE(status,'') NOT IN ('failed','cancelled','deleted')`, [A.tenantId])).rows[0].n;
      rec('L5.companies_in_tenant', n);
      if (n !== Math.min(max, 1 + attempts)) throw new Error(`the tenant holds ${n} companies, the plan allows ${max}: ${JSON.stringify(results)}`);
      const refused = results.filter((x) => !x.ok);
      if (max <= attempts && (!refused.length || !/PLAN_LIMIT_EXCEEDED|compan|plan|limit/i.test(refused[0].outcome))) throw new Error(`the over-the-limit company was not refused with a plan message: ${JSON.stringify(results)}`);
      return `plan allows ${max}: ${created} extra created, ${refused.length} refused (${refused[0] ? refused[0].outcome : '-'}); tenant holds ${n}`;
    });

    await R.check('L5b a plain INSERT into companies as the admin at the limit (the ERP does not do this; the database must still refuse it), then trash/restore through UPDATE (recorded; refused when it would exceed the limit on the new build)', async () => {
      const h = authOf(tokA, { Prefer: 'return=minimal' });
      const n0 = (await pg(`SELECT count(*)::int n FROM public.companies WHERE tenant_id = $1 AND COALESCE(status,'') NOT IN ('failed','cancelled','deleted')`, [A.tenantId])).rows[0].n;
      const ins = await request('POST', `${API}/rest/v1/companies`, { headers: h, body: { tenant_id: A.tenantId, code: 'CMPD-1', name: 'Compat direct', company_type: 'production', default_currency: 'UAH' } });
      rec('L5b.direct_insert_at_limit', outcome(ins));
      let note = `direct insert → ${outcome(ins)}`;
      if (ins.status < 300) {
        try { await pg(`DELETE FROM public.companies WHERE tenant_id = $1 AND name = 'Compat direct'`, [A.tenantId]); note += ' (accepted, row removed)'; }     // an older build accepted it: remove the row
        catch { await pg(`UPDATE public.companies SET status = 'cancelled' WHERE tenant_id = $1 AND name = 'Compat direct'`, [A.tenantId]); note += ' (accepted, row cancelled: the audit trail is append-only)'; }
      } else if (!/PLAN_LIMIT_EXCEEDED|check|limit|42501|23514|permission|policy/i.test(`${ins.status} ${ins.text}`)) note += ' (refused for another reason)';
      // soft-delete the LAST extra company and restore it: at n0 active companies (= the limit when the tenant is full) the restore of a deleted one takes a slot again
      const extra = (await pg(`SELECT id FROM public.companies WHERE tenant_id = $1 AND id <> $2 AND COALESCE(status,'') NOT IN ('failed','cancelled','deleted') ORDER BY created_at DESC LIMIT 1`, [A.tenantId, A.companyId])).rows[0];
      if (extra) {
        const del = await request('PATCH', `${API}/rest/v1/companies?id=eq.${extra.id}`, { headers: h, body: { status: 'deleted' } });
        rec('L5b.trash', outcome(del));
        // fill the freed slot, then try to bring the deleted one back
        const refill = await rpc('fn_provision_new_company', { p_tenant_id: A.tenantId, p_idempotency_key: `compat:refill:${Date.now()}`, p_company: { name: 'Compat refill', business_type: 'general', company_type: 'production', default_currency: 'UAH', supported_currencies: ['UAH'], chart_template: 'extended', fiscal_year_start_month: 1, language: 'ar' } }, tokA);
        rec('L5b.refill_slot', outcome(refill));
        const back = await request('PATCH', `${API}/rest/v1/companies?id=eq.${extra.id}`, { headers: h, body: { status: 'active' } });
        rec('L5b.restore_beyond_limit', outcome(back));
        note += `; trash ${outcome(del)}, refill ${refill.status === 200 ? 'created' : outcome(refill)}, restore beyond the limit → ${outcome(back)}`;
      }
      return note;
    });

    await R.check('L6 warehouses and customers follow the plan (free: 1 warehouse; trial: several); the admin\'s own inserts work', async () => {
      const h = authOf(tokA, { Prefer: 'return=representation' });
      const cur = (await pg('SELECT count(*)::int n FROM public.warehouses WHERE tenant_id = $1', [A.tenantId])).rows[0].n;     // the whole tenant (the plan counts the tenant)
      const out = [];
      const branch = (await pg('SELECT id FROM public.branches WHERE company_id = $1 ORDER BY created_at LIMIT 1', [A.companyId])).rows[0];
      for (let i = 1; i <= 3; i++) {
        const r = await request('POST', `${API}/rest/v1/warehouses`, { headers: h, body: { tenant_id: A.tenantId, company_id: A.companyId, ...(branch ? { branch_id: branch.id } : {}), code: `CW-${i}`, name: `Warehouse ${i}`, name_ar: `مستودع ${i}`, name_en: `Warehouse ${i}` } });
        rec(`L6.warehouse.${i}`, outcome(r));
        out.push(r.status < 300 ? 'ok' : outcome(r));
      }
      const c = await request('POST', `${API}/rest/v1/customers`, { headers: h, body: { tenant_id: A.tenantId, company_id: A.companyId, code: 'CC-1', name_ar: 'عميل التوافق' } });
      rec('L6.customer', outcome(c));
      if (c.status !== 201) throw new Error(`customer insert → ${c.status} ${c.text.slice(0, 200)}`);
      const okW = out.filter((x) => x === 'ok').length;
      const maxW = Number(plan.max_warehouses);
      if (maxW >= 0 && cur + okW > maxW) throw new Error(`${cur} existing + ${okW} created exceeds the plan's ${maxW} warehouses`);
      if (maxW < 0 || maxW > cur) { if (!okW) throw new Error(`the plan allows ${maxW} warehouses (${cur} exist) but none could be created: ${out.join(', ')}`); }
      return `warehouses: ${cur} existed, ${out.join(', ')} (plan ${maxW}); customer created`;
    });

    // ── employees ──
    const emps = [];
    await R.check('L7 employees through the installer\'s invite path: within the seats accepted (the account is created tenant-less by the server and adopted on acceptance), beyond them refused with the plan message; the employee logs in, sees only his company and gets HIS plan answer', async () => {
      const roles = await request('GET', `${UI}/api/employee-roles?companyId=${A.companyId}`, { headers: H });
      if (roles.status !== 200 || !roles.json.success || !roles.json.roles.length) throw new Error(`employee-roles → ${roles.status} ${roles.text.slice(0, 160)}`);
      const role = roles.json.roles.find((r) => !/owner|admin/i.test(r.code)) || roles.json.roles[0];
      const maxU = Number(plan.max_users);
      const results = [];
      for (let i = 1; i <= Math.min(maxU + 1, 12); i++) {
        const r = await request('POST', `${UI}/api/invite-employee`, { headers: H, body: { companyId: A.companyId, roleId: role.id, email: `staff${i}@compat.test`, fullName: `Staff ${i}` } });
        const ok = r.status === 200 && r.json && r.json.success;
        results.push({ i, ok, outcome: ok ? 'accepted' : `${r.status} ${r.json && r.json.code} ${r.json && r.json.error ? String(r.json.error).slice(0, 80) : ''}` });
        rec(`L7.invite.${i}`, ok ? 'accepted' : `${r.status} ${r.json && r.json.code}`);
        if (ok) emps.push({ i, email: `staff${i}@compat.test`, password: r.json.oneTimePassword, userId: r.json.userId });
        else break;
      }
      const okN = results.filter((x) => x.ok).length;
      if (okN !== maxU - 1) throw new Error(`${okN} employees accepted, the plan (${maxU} users incl. the owner) allows ${maxU - 1}: ${JSON.stringify(results)}`);
      const last = results[results.length - 1];
      if (last.ok || !/PLAN_LIMIT_EXCEEDED/.test(last.outcome)) throw new Error(`the employee beyond the seats was not refused with the plan message: ${JSON.stringify(last)}`);
      const users = await planCheck(A.adminUserId, A.tenantId, 'users');
      rec('L7.users_after', { current: users.current, max: users.max, allowed: users.allowed });
      if (Number(users.current) !== maxU) throw new Error(`users after the invites: ${JSON.stringify(users)}`);
      let who = 'no employee (free plan: the owner holds the only seat)';
      if (emps.length) {
        const e = emps[emps.length - 1];
        const login = await request('POST', `${API}/auth/v1/token?grant_type=password`, { headers: { apikey: anon }, body: { email: e.email, password: e.password } });
        if (login.status !== 200) throw new Error(`employee login → ${login.status} ${login.text.slice(0, 160)}`);
        e.token = login.json.access_token;
        const cos = await request('GET', `${API}/rest/v1/companies?select=id`, { headers: authOf(e.token) });
        const mine = await rpc('get_all_plan_limits', { p_tenant_id: A.tenantId }, e.token);
        rec('L7.employee.plan_answer', outcome(mine)); rec('L7.employee.companies_visible', cos.json && cos.json.length);
        if (mine.status !== 200 || (mine.json && mine.json.error)) throw new Error(`the employee's plan answer: ${mine.status} ${mine.text.slice(0, 200)}`);
        const prof = (await pg('SELECT tenant_id, company_id, is_active, is_tenant_admin FROM public.user_profiles WHERE id = $1', [e.userId])).rows[0];
        if (!prof || prof.tenant_id !== A.tenantId || prof.is_active !== true || prof.is_tenant_admin !== false) throw new Error(`employee profile after acceptance: ${JSON.stringify(prof)}`);
        who = `employee #${e.i} logs in, sees ${cos.json.length} company, gets the plan answer (${mine.json.plan_code}); profile adopted into the tenant`;
      }
      return `${okN} accepted, then refused: ${last.outcome.trim()}; users ${users.current}/${users.max}; ${who}`;
    });

    await R.check('L8 deactivating a user frees his seat (then a new invite is accepted), reactivating when the plan is full is refused (recorded), a pending invitation holds no seat', async () => {
      const usersNow = async () => planCheck(A.adminUserId, A.tenantId, 'users');
      // a pending invitation (no GoTrue stub, no acceptance) while the plan is full: created, not counted
      const before = await usersNow();
      const inv = await rpc('fn_membership_invite_create', { p_company_id: A.companyId, p_email: 'pending1@compat.test', p_role_ids: [], p_note: null, p_payload: {} }, tokA);
      rec('L8.pending_invite_when_full', `${inv.status} ${inv.json && inv.json.ok}`);
      const afterInv = await usersNow();
      if (Number(afterInv.current) !== Number(before.current)) throw new Error(`a pending invitation changed the user count ${before.current} → ${afterInv.current}`);
      let note = `pending invitation (${inv.status}${inv.json && inv.json.ok === false ? ' ' + inv.json.reason : ''}): users ${before.current} → ${afterInv.current}`;
      if (!emps.length) return `${note}; (free plan: no employee to deactivate)`;
      const e = emps[0];
      await pg('UPDATE public.user_profiles SET is_active = false WHERE id = $1', [e.userId]);
      const freed = await usersNow();
      rec('L8.users_after_deactivation', { current: freed.current, allowed: freed.allowed });
      if (!hasX) return `${note}; (previous build) deactivating a user: users ${before.current} → ${freed.current} (the seat is ${Number(freed.current) < Number(before.current) ? 'freed' : 'NOT freed - its count includes deactivated users'}); not asserted`;
      if (Number(freed.current) !== Number(before.current) - 1) throw new Error(`deactivation did not free a seat: ${before.current} → ${freed.current}`);
      const roles = await request('GET', `${UI}/api/employee-roles?companyId=${A.companyId}`, { headers: H });
      const role = roles.json.roles.find((r) => !/owner|admin/i.test(r.code)) || roles.json.roles[0];
      const again = await request('POST', `${UI}/api/invite-employee`, { headers: H, body: { companyId: A.companyId, roleId: role.id, email: 'staff-new@compat.test', fullName: 'Staff New' } });
      rec('L8.invite_after_deactivation', again.status === 200 ? 'accepted' : `${again.status} ${again.json && again.json.code}`);
      if (again.status !== 200) throw new Error(`the freed seat was not usable: ${again.status} ${again.text.slice(0, 200)}`);
      let react = 'accepted';
      try { await pg('UPDATE public.user_profiles SET is_active = true WHERE id = $1', [e.userId]); } catch (err) { react = `refused: ${String(err.message).slice(0, 90)}`; }
      rec('L8.reactivate_when_full', react.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>'));
      return `${note}; deactivated → users ${freed.current}, a new invite accepted, reactivating the old one on a full plan: ${react}`;
    });

    await R.check('L9 the other tenant\'s plan (closed on the new build, open on the old one - recorded): get_all_plan_limits / check_plan_limits for tenant B asked by the admin of A', async () => {
      const g = await rpc('get_all_plan_limits', { p_tenant_id: B.tenantId }, tokA);
      const c = await planCheck(A.adminUserId, B.tenantId, 'users');
      rec('L9.cross_tenant.get_all_plan_limits', g.json && g.json.error ? `error ${g.json.error}` : `answered ${g.json && g.json.plan_code}`);
      rec('L9.cross_tenant.check_plan_limits', c.error ? `error ${c.error}` : `answered allowed=${c.allowed}`);
      if (hasX && !(g.json && g.json.error === 'forbidden' && c.error === 'forbidden')) throw new Error(`the cross-tenant answers are not closed: ${g.text.slice(0, 120)} / ${JSON.stringify(c).slice(0, 120)}`);
      // the installer's own sessions (direct superuser connection, service key) must still be answered: plan-sync, the invite pre-check and the heartbeat depend on it
      const sys = (await pg('SELECT public.get_all_plan_limits($1::uuid) AS g, public.check_plan_limits($1::uuid, $2::text) AS c', [A.tenantId, 'users'])).rows[0];
      rec('L9.installer_direct_session', { plan: sys.g.plan_code, error: sys.g.error || null, users: sys.c.current });
      if (sys.g.error || !sys.g.plan_code) throw new Error(`the installer's own session is refused: ${JSON.stringify(sys.g).slice(0, 200)}`);
      const svc = await request('POST', `${API}/rest/v1/rpc/get_all_plan_limits`, { headers: { apikey: anon, Authorization: `Bearer ${secrets.serviceKey}` }, body: { p_tenant_id: A.tenantId } });
      rec('L9.service_key', outcome(svc) + ` ${svc.json && svc.json.error ? svc.json.error : svc.json && svc.json.plan_code}`);
      if (svc.status !== 200 || (svc.json && svc.json.error)) throw new Error(`the service key is refused: ${svc.status} ${svc.text.slice(0, 200)}`);
      return `cross-tenant: ${hasX ? 'closed (forbidden)' : 'open (old build)'}; the installer's direct session and the service key are answered (${sys.g.plan_code})`;
    });

    await R.check('L10 a tenant-less admin (the profile loses its tenant while the session still names it): what he can still do - recorded for the diff; the session itself, his profile and the tenant list keep working', async () => {
      const tokB = B.accessToken;
      const before = await rpc('get_all_plan_limits', { p_tenant_id: B.tenantId }, tokB);
      rec('L10.before.own_plan', outcome(before) + ` ${before.json && before.json.plan_code}`);
      await pgRegistering('UPDATE public.user_profiles SET tenant_id = NULL WHERE id = $1', [B.adminUserId]);
      try {
        const plan2 = await rpc('get_all_plan_limits', { p_tenant_id: B.tenantId }, tokB);
        const chk = await planCheck(B.adminUserId, B.tenantId, 'companies');
        const prof = await request('GET', `${API}/rest/v1/user_profiles?select=email,role,is_tenant_admin`, { headers: authOf(tokB) });
        const mine = await rpc('get_user_tenants', {}, tokB);
        const cos = await request('GET', `${API}/rest/v1/companies?select=id`, { headers: authOf(tokB) });
        const refresh = await request('POST', `${API}/auth/v1/token?grant_type=refresh_token`, { headers: { apikey: anon }, body: { refresh_token: B.refreshToken } });
        rec('L10.detached.get_all_plan_limits', plan2.json && plan2.json.error ? `error ${plan2.json.error}` : `answered ${plan2.json && plan2.json.plan_code}`);
        rec('L10.detached.check_plan_limits', chk.error ? `error ${chk.error}` : `answered allowed=${chk.allowed}`);
        rec('L10.detached.own_profile_readable', `${prof.status} rows=${prof.json && prof.json.length}`);
        rec('L10.detached.get_user_tenants', `${mine.status} rows=${Array.isArray(mine.json) ? mine.json.length : 'n/a'}`);
        rec('L10.detached.companies_visible', `${cos.status} rows=${cos.json && cos.json.length}`);
        rec('L10.detached.token_refresh', `${refresh.status}`);
        if (ERP) {      // what the admin SEES in the real page while detached (recorded, not asserted)
          const out = require('child_process').spawnSync('node', [path.join(__dirname, 'browser-plan-probe.cjs'), '--erp', ERP, '--ui', UI, '--company', 'Compat B', '--email', 'owner-b@compat.test', '--password', 'CompatPass#2026', '--routes', '/accounting,/sales,/warehouse'], { encoding: 'utf8', timeout: 300000 });
          const line = (out.stdout || '').split('\n').find((l) => l.startsWith('PROBE '));
          if (line) { const p = JSON.parse(line.slice(6)); rec('L10.detached.ui', { dashboardOk: p.dashboardOk, sidebarLinks: p.sidebarLinks, plan: [...new Set(p.planAnswers.map((x) => x.error || x.plan))], blockedByPlan: Object.entries(p.routes).filter(([, v]) => v.blockedByPlan).map(([k]) => k) }); }
          else rec('L10.detached.ui', `probe failed: ${String(out.stderr || out.stdout).trim().slice(-160)}`);
        }
        if (refresh.status !== 200) throw new Error(`the detached admin's session cannot refresh: ${refresh.status}`);
        return `detached admin: plan answer ${matrix['L10.detached.get_all_plan_limits']}, check ${matrix['L10.detached.check_plan_limits']}, profile ${matrix['L10.detached.own_profile_readable']}, get_user_tenants ${matrix['L10.detached.get_user_tenants']}, companies ${matrix['L10.detached.companies_visible']}, refresh ${refresh.status}`;
      } finally {
        await pgRegistering('UPDATE public.user_profiles SET tenant_id = $2 WHERE id = $1', [B.adminUserId, B.tenantId]);   // re-attach (a sole member: the seat check passes)
        const back = await rpc('get_all_plan_limits', { p_tenant_id: B.tenantId }, tokB);
        rec('L10.reattached.own_plan', outcome(back) + ` ${back.json && back.json.plan_code}`);
      }
    });

    if (ERP) {
      await R.check('L11 the real ERP page as the admin: the plan answers it receives carry no error, the sidebar lists modules, module routes the plan includes are not blocked by the plan screen', async () => {
        const out = require('child_process').spawnSync('node', [path.join(__dirname, 'browser-plan-probe.cjs'), '--erp', ERP, '--ui', UI, '--email', 'owner-a@compat.test', '--password', 'CompatPass#2026', '--shots', path.join(WORK, 'shots')], { encoding: 'utf8', timeout: 400000 });
        if (out.status !== 0) throw new Error(`${out.stdout}\n${out.stderr}`.trim().slice(-900));
        const line = out.stdout.split('\n').find((l) => l.startsWith('PROBE '));
        if (!line) throw new Error(`no PROBE line: ${out.stdout.slice(-400)}`);
        const p = JSON.parse(line.slice(6));
        rec('L11.dashboard_ok', p.dashboardOk); rec('L11.sidebar_links', p.sidebarLinks);
        rec('L11.plan_answers', p.planAnswers.map((x) => `${x.status} ${x.error || x.plan}`));
        rec('L11.routes_blocked_by_plan', Object.fromEntries(Object.entries(p.routes).map(([k, v]) => [k, v.blockedByPlan])));
        const planMods = (await pg(`SELECT sp.included_modules m FROM public.tenant_subscriptions ts JOIN public.subscription_plans sp ON sp.id = ts.plan_id WHERE ts.tenant_id = $1 ORDER BY ts.created_at DESC LIMIT 1`, [A.tenantId])).rows[0].m || [];
        const must = { '/accounting': 'accounting', '/sales': 'sales', '/warehouse': 'inventory', '/purchases': 'purchases', '/fabric': 'fabric' };
        const wrong = Object.entries(must).filter(([route, mod]) => planMods.includes(mod) && p.routes[route] && p.routes[route].blockedByPlan).map(([route]) => route);
        if (!p.dashboardOk) throw new Error('the dashboard did not render');
        if (!p.planAnswers.length) throw new Error('the page never asked for the plan');
        const bad = p.planAnswers.filter((x) => x.error || x.status !== 200);
        if (bad.length) throw new Error(`the page received plan answers with an error: ${JSON.stringify(bad)}`);
        if (p.sidebarLinks < 4) throw new Error(`the sidebar lists only ${p.sidebarLinks} links`);
        if (wrong.length) throw new Error(`routes of modules the plan includes are blocked by the plan screen: ${wrong.join(', ')}`);
        return `plan answers ${[...new Set(p.planAnswers.map((x) => x.plan))].join('/')} (${p.planAnswers.length} requests, no error); sidebar ${p.sidebarLinks} links; blocked by plan: ${Object.entries(p.routes).filter(([, v]) => v.blockedByPlan).map(([k]) => k).join(', ') || 'none'} (plan modules: ${planMods.join(',')})`;
      });
    } else console.log('  SKIP  L11 real-browser probe (no --erp given: Playwright lives in the ERP checkout)');
  } finally {
    await stopApp(child, userData);
  }
  const summary = R.summary();
  fs.writeFileSync(path.join(WORK, 'matrix.json'), JSON.stringify({ at: new Date().toISOString(), license: LICENSE, app: APP || 'dev', matrix }, null, 2));
  fs.writeFileSync(path.join(WORK, 'results.json'), JSON.stringify({ at: new Date().toISOString(), summary, rows: R.rows }, null, 2));
  console.log(`\nlimits-compat-check (${LICENSE}): ${summary}  →  ${path.join(WORK, 'results.json')}, matrix ${path.join(WORK, 'matrix.json')}`);
  process.exit(R.failed.length ? 1 : 0);
})().catch((e) => { console.error('limits-compat-check crashed:', e); process.exit(1); });
