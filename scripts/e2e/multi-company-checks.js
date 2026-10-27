'use strict';
// Final-build checks (owner 27-10, E2E BUG-3 / BUG-9 / BUG-19 / BUG-20), shared by launch-check.js and the stand-alone runner multi-company-run.js:
//   9.1 an owner with THREE companies in one tenant (the first creates the tenant and the owner, the other two are attached with his own session)
//   9.2 (a) the company link ?c=<code> of EACH of the three opens THAT company after login, in a real browser: the page's active company, the login session's company and the server's
//       user_profiles.company_id all name it - in the order Two, Three, One, so a link never falls back to the account's last company
//   9.3 (b) the Users screen's role list is not empty for the owner: fn_users_screen_roles() answers his tenant's roles plus the global roles, none of them platform-level
//   9.4 (c) on the desktop an attachment upload answers DESKTOP_STORAGE_UNAVAILABLE with the reason (the shipped bundle, run in the real page), and the share hub issues no public
//       token (the shipped bundle carries the desktop gate and its reason in every language; no public token exists in the database)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');
const { pgOptions } = require('./lib');

const OWNER = { email: 'multi@e2e.test', password: 'E2ePass#2026' };

/** The free plan allows one branch per tenant (production's own plan guard), and every company brings a branch: three companies for one owner need a plan with room. The plan row is edited the way the
 *  console does it (the guard refuses a lowered mirrored limit unless the transaction carries the confirmation) and put back afterwards. */
async function withRoomForCompanies(tenantId, fn) {
  const q = async (sql, params, confirm) => {
    const c = new Client(pgOptions()); await c.connect();
    try {
      await c.query('BEGIN');
      if (confirm) await c.query(`SELECT set_config('texacore.plan_change_confirmed', $1::text, true)`, [confirm]);
      const r = await c.query(sql, params); await c.query('COMMIT'); return r;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { await c.end(); }
  };
  const plan = (await q(`SELECT p.id, p.max_branches, p.max_warehouses, p.max_companies FROM public.tenant_subscriptions ts JOIN public.subscription_plans p ON p.id = ts.plan_id
                          WHERE ts.tenant_id = $1 ORDER BY ts.created_at DESC LIMIT 1`, [tenantId])).rows[0];
  if (!plan) return fn();
  const roomy = (v) => (v === null || v < 0 ? v : Math.max(v, 10));
  await q('UPDATE public.subscription_plans SET max_branches = $2, max_warehouses = $3, max_companies = $4 WHERE id = $1', [plan.id, roomy(plan.max_branches), roomy(plan.max_warehouses), roomy(plan.max_companies)], plan.id);
  try { return await fn(); } finally {
    await q('UPDATE public.subscription_plans SET max_branches = $2, max_warehouses = $3, max_companies = $4 WHERE id = $1', [plan.id, plan.max_branches, plan.max_warehouses, plan.max_companies], plan.id).catch(() => {});
  }
}

async function multiCompanyChecks(R, ctx) {
  const { request, ADMIN, API, UI, H, anonKey, ERP, WORK, pg } = ctx;
  const S = { tenantId: null, companies: [] };
  const code = (id) => String(id).split('-')[0];
  const signIn = async () => {
    const r = await request('POST', `${API}/auth/v1/token?grant_type=password`, { headers: { apikey: anonKey }, body: { email: OWNER.email, password: OWNER.password } });
    if (r.status !== 200 || !r.json.access_token) throw new Error(`owner sign-in → ${r.status} ${r.text.slice(0, 160)}`);
    return r.json;
  };

  await R.check('9.1 an owner with THREE companies in one tenant: the first creates the tenant and the owner, the other two are attached with his own session (one tenant, one user, three companies, three different link codes)', async () => {
    const dir = path.join(WORK, 'tcdb-multi'); fs.mkdirSync(dir, { recursive: true });
    const base = { adminEmail: OWNER.email, adminPassword: OWNER.password, localCurrency: 'UAH', mainCurrency: 'USD', country: 'UA', storagePath: dir };
    const first = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: { ...base, companyName: 'Multi One', dbFileName: 'multi1' } });
    if (!first.json || !first.json.success) throw new Error(`first company → ${first.text.slice(0, 300)}`);
    S.tenantId = first.json.tenantId; S.companies.push({ id: first.json.companyId, name: 'Multi One' });
    const token = (await signIn()).access_token;
    await withRoomForCompanies(S.tenantId, async () => {
      for (const [name, file] of [['Multi Two', 'multi2'], ['Multi Three', 'multi3']]) {
        const r = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: { ...base, companyName: name, dbFileName: file, callerAccessToken: token } });
        if (!r.json || !r.json.success || r.json.attached !== true || r.json.tenantId !== S.tenantId) throw new Error(`${name} → ${r.text.slice(0, 300)}`);
        S.companies.push({ id: r.json.companyId, name });
      }
    });
    const n = (await pg(`SELECT (SELECT count(*) FROM public.companies WHERE tenant_id = $1)::int c, (SELECT count(*) FROM public.user_profiles WHERE tenant_id = $1)::int u, (SELECT count(*) FROM public.tenants WHERE owner_email = $2)::int t`, [S.tenantId, OWNER.email])).rows[0];
    if (n.c !== 3 || n.u !== 1 || n.t !== 1) throw new Error(`rows ${JSON.stringify(n)} (expected 3 companies, 1 user, 1 tenant)`);
    if (new Set(S.companies.map((c) => code(c.id))).size !== 3) throw new Error('two companies share a link code');
    return `tenant ${S.tenantId.slice(0, 8)}…: ${S.companies.map((c) => `${c.name} ${code(c.id)}`).join(', ')}`;
  });

  if (ERP) {
    await R.check('9.2 the company link ?c=<code> of each of the three companies opens THAT company after login (Two, Three, then One again): the page\'s active company, the session\'s company and the server\'s user_profiles.company_id all name it', async () => {
      if (S.companies.length !== 3) throw new Error('9.1 did not leave three companies');
      const order = [S.companies[1], S.companies[2], S.companies[0]];
      const seen = [];
      for (const c of order) {
        const out = spawnSync('node', [path.join(__dirname, 'browser-company-link.cjs'), '--erp', ERP, '--ui', UI, '--code', code(c.id), '--expect', c.id, '--email', OWNER.email, '--password', OWNER.password,
          '--shots', path.join(WORK, 'shots-company-link')], { encoding: 'utf8', timeout: 240000 });
        if (out.status !== 0) throw new Error(`${c.name} (${code(c.id)}): ${`${out.stdout}\n${out.stderr}`.trim().slice(-700)}`);
        seen.push(`${c.name} ← ${out.stdout.trim().split('\n').slice(-1)[0]}`);
      }
      return seen.join(' ; ');
    });
  } else console.log('  SKIP  9.2 company links in the browser (no --erp given: Playwright lives in the ERP checkout)');

  await R.check('9.3 the Users screen\'s role list is not empty for the owner: fn_users_screen_roles() answers his tenant\'s roles and the global roles (accountant, sales_rep, warehouse_keeper … ), never a platform-level role, and no permissions column', async () => {
    const t = await signIn();
    const r = await request('POST', `${API}/rest/v1/rpc/fn_users_screen_roles`, { headers: { apikey: anonKey, Authorization: `Bearer ${t.access_token}` }, body: {} });
    if (r.status !== 200 || !Array.isArray(r.json)) throw new Error(`rpc → ${r.status} ${r.text.slice(0, 200)}`);
    const rows = r.json;
    if (!(rows.length > 0)) throw new Error('the list is EMPTY (the Users screen would say «no roles available»)');
    const codes = new Set(rows.map((x) => x.code));
    for (const must of ['accountant', 'sales_rep', 'warehouse_keeper']) if (!codes.has(must)) throw new Error(`the global role ${must} is missing: ${[...codes].slice(0, 12).join(',')}`);
    const platform = rows.filter((x) => ['platform', 'system'].includes(String(x.level || '').toLowerCase()) || ['platform_admin', 'super_admin'].includes(x.code));
    if (platform.length) throw new Error(`platform-level roles are listed: ${platform.map((x) => x.code).join(',')}`);
    if (rows.some((x) => 'permissions' in x || 'special_permissions' in x)) throw new Error('the listing carries a permissions column');
    // anonymous callers get nothing
    const anon = await request('POST', `${API}/rest/v1/rpc/fn_users_screen_roles`, { headers: { apikey: anonKey }, body: {} });
    if (anon.status === 200 && Array.isArray(anon.json) && anon.json.length) throw new Error('an anonymous caller got roles');
    return `${rows.length} roles for the owner (${[...codes].slice(0, 6).join(', ')} …), none platform-level, no permissions column; anonymous → ${anon.status}`;
  });

  if (ERP) {
    await R.check('9.4 on the desktop an attachment upload answers DESKTOP_STORAGE_UNAVAILABLE with the reason (the shipped bundle, run in the real page), and the share hub issues no public token (the shipped bundle carries the gate and its reason in every language; no public token exists)', async () => {
      const out = spawnSync('node', [path.join(__dirname, 'browser-desktop-guards.cjs'), '--erp', ERP, '--ui', UI, '--email', OWNER.email, '--password', OWNER.password, '--code', code(S.companies[0].id), '--shots', path.join(WORK, 'shots-desktop-guards')],
        { encoding: 'utf8', timeout: 240000 });
      if (out.status !== 0) throw new Error(`${out.stdout}\n${out.stderr}`.trim().slice(-900));
      const tokens = await pg(`SELECT to_regclass('public.document_public_tokens') AS t`).then((x) => x.rows[0].t);
      let n = 0;
      if (tokens) n = (await pg(`SELECT count(*)::int AS n FROM public.document_public_tokens`)).rows[0].n;
      if (n !== 0) throw new Error(`${n} public token(s) exist on the desktop`);
      return `${out.stdout.trim().split('\n').slice(-1)[0]}; document_public_tokens: ${tokens ? '0 rows' : 'table absent'}`;
    });
  } else console.log('  SKIP  9.4 desktop guards in the browser (no --erp given)');
}

module.exports = { multiCompanyChecks, OWNER };
