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
const { catalogParity } = require('./catalog-parity');

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
  const plan = (await q(`SELECT p.id, p.max_branches, p.max_warehouses, p.max_companies, p.max_users FROM public.tenant_subscriptions ts JOIN public.subscription_plans p ON p.id = ts.plan_id
                          WHERE ts.tenant_id = $1 ORDER BY ts.created_at DESC LIMIT 1`, [tenantId])).rows[0];
  if (!plan) return fn();
  const roomy = (v) => (v === null || v < 0 ? v : Math.max(v, 10));
  await q('UPDATE public.subscription_plans SET max_branches = $2, max_warehouses = $3, max_companies = $4, max_users = $5 WHERE id = $1', [plan.id, roomy(plan.max_branches), roomy(plan.max_warehouses), roomy(plan.max_companies), roomy(plan.max_users)], plan.id);
  try { return await fn(); } finally {
    await q('UPDATE public.subscription_plans SET max_branches = $2, max_warehouses = $3, max_companies = $4, max_users = $5 WHERE id = $1', [plan.id, plan.max_branches, plan.max_warehouses, plan.max_companies, plan.max_users], plan.id).catch(() => {});
  }
}

async function multiCompanyChecks(R, ctx) {
  const { request, ADMIN, API, UI, H, anonKey, ERP, WORK, pg, lanIp = '' } = ctx;
  const S = { tenantId: null, companies: [] };
  const code = (id) => String(id).split('-')[0];
  const signIn = async () => {
    const r = await request('POST', `${API}/auth/v1/token?grant_type=password`, { headers: { apikey: anonKey }, body: { email: OWNER.email, password: OWNER.password } });
    if (r.status !== 200 || !r.json.access_token) throw new Error(`owner sign-in → ${r.status} ${r.text.slice(0, 160)}`);
    return r.json;
  };

  /** Documents the page checks need, in company One (SQL as the installer's own harness does it): a customer whose receivable account carries a posted movement (so its statement has rows), a sales invoice and a sales
   *  quote with three lines each, and six material cards (a list with row «⋯» buttons). */
  const seedUiDocs = async () => {
    const co = S.companies[0].id;
    const owner = (await pg('SELECT id FROM public.user_profiles WHERE tenant_id = $1 LIMIT 1', [S.tenantId])).rows[0].id;
    const cust = (await pg(`INSERT INTO public.customers (tenant_id, company_id, code, name_ar) VALUES ($1,$2,'SEED-C1','عميل المعاينة') RETURNING id`, [S.tenantId, co])).rows[0].id;
    const mk = async (stage, no) => {
      const col = stage === 'invoice' ? 'invoice_no' : 'quotation_no';
      const t = (await pg(`INSERT INTO public.sales_transactions (tenant_id, company_id, stage, ${col}, customer_id, customer_name, doc_date, currency, subtotal, total_amount, balance, created_by, is_active)
                             VALUES ($1,$2,$3,$4,$5,'عميل المعاينة',CURRENT_DATE,'UAH',300,300,300,$6,true) RETURNING id`, [S.tenantId, co, stage, no, cust, owner])).rows[0].id;
      for (let i = 1; i <= 3; i++) await pg(`INSERT INTO public.sales_transaction_items (transaction_id, line_number, description, description_ar, quantity, unit_price, subtotal, total, unit) VALUES ($1,$2,$3,$3,$4,50,$5,$5,'piece')`, [t, i, `بند ${i}`, i, i * 50]);
      return t;
    };
    const invoice = await mk('invoice', 'SEED-INV-1'); const quote = await mk('quotation', 'SEED-Q-1');
    for (let i = 1; i <= 6; i++) await pg(`INSERT INTO public.fabric_materials (tenant_id, company_id, code, name_ar) VALUES ($1,$2,$3,$4)`, [S.tenantId, co, `SEED-M${i}`, `مادة معاينة ${i}`]);
    const accs = (await pg(`SELECT id, account_code FROM public.chart_of_accounts WHERE company_id = $1 AND COALESCE(is_group,false) = false AND COALESCE(is_active,true) ORDER BY account_code LIMIT 40`, [co])).rows;
    const recv = accs.find((a) => /^112/.test(a.account_code)) || accs[0]; const other = accs.find((a) => a.id !== recv.id && /^4/.test(a.account_code)) || accs.find((a) => a.id !== recv.id);
    await pg('UPDATE public.customers SET receivable_account_id = $2 WHERE id = $1', [cust, recv.id]);
    const t = await signIn();
    const je = await request('POST', `${API}/rest/v1/rpc/save_journal_entry_draft`, { headers: { apikey: anonKey, Authorization: `Bearer ${t.access_token}` }, body: { p_payload: {
      company_id: co, entry_date: new Date().toISOString().slice(0, 10), description: 'seed statement movement', post: true,
      lines: [{ account_id: recv.id, debit: 300, credit: 0, description: 'SEED-INV-1' }, { account_id: other.id, debit: 0, credit: 300 }] } } });
    if (je.status !== 200 || !je.json || je.json.success !== true) throw new Error(`seed journal entry → ${je.status} ${je.text.slice(0, 200)}`);
    S.seed = { customer: cust, invoice, quote };
  };
  const finalChecks = (only, extra = []) => {
    const out = spawnSync('node', [path.join(__dirname, 'browser-final-checks.cjs'), '--erp', ERP, '--ui', UI, '--code', code(S.companies[0].id), '--email', OWNER.email, '--password', OWNER.password,
      '--shots', path.join(WORK, 'shots-final'), '--only', only, ...extra], { encoding: 'utf8', timeout: 600000 });
    if (out.status !== 0) throw new Error(`${out.stdout}\n${out.stderr}`.trim().slice(-900));
    return out.stdout.trim().split('\n').slice(-1)[0].replace(/^FINAL /, '');
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

  await seedUiDocs();

  if (ERP) {
    await R.check('9.2 the company link ?c=<code> of each of the three companies opens THAT company after login (Two, Three, then One again): the page\'s active company, the session\'s company and the server\'s user_profiles.company_id all name it', async () => {
      if (S.companies.length !== 3) throw new Error('9.1 did not leave three companies');
      const order = [S.companies[1], S.companies[2], S.companies[0]];
      const seen = [];
      for (const c of order) {
        const out = spawnSync('node', [path.join(__dirname, 'browser-company-link.cjs'), '--erp', ERP, '--ui', UI, '--code', code(c.id), '--expect', c.id, '--name', c.name, '--email', OWNER.email, '--password', OWNER.password,
          '--shots', path.join(WORK, 'shots-company-link')], { encoding: 'utf8', timeout: 240000 });
        if (out.status !== 0) throw new Error(`${c.name} (${code(c.id)}): ${`${out.stdout}\n${out.stderr}`.trim().slice(-700)}`);
        seen.push(`${c.name} ← ${out.stdout.trim().split('\n').slice(-1)[0]}`);
      }
      // the OFFICE NETWORK: the same links from the machine's LAN address (no local company list there, E2E BUG-3 regression on build #3: 6 of 8 runs opened the last active company)
      let lan = 'LAN address: none on this machine (skipped)';
      if (lanIp) {
        const lanUi = UI.replace('127.0.0.1', lanIp); const lanSeen = [];
        for (const c of [S.companies[2], S.companies[0], S.companies[1], S.companies[2]]) {
          const out = spawnSync('node', [path.join(__dirname, 'browser-company-link.cjs'), '--erp', ERP, '--ui', lanUi, '--code', code(c.id), '--expect', c.id, '--name', c.name, '--email', OWNER.email, '--password', OWNER.password,
            '--shots', path.join(WORK, 'shots-company-link-lan')], { encoding: 'utf8', timeout: 240000 });
          if (out.status !== 0) throw new Error(`LAN ${lanIp}: ${c.name} (${code(c.id)}): ${`${out.stdout}\n${out.stderr}`.trim().slice(-700)}`);
          lanSeen.push(`${c.name}`);
        }
        lan = `LAN ${lanIp}: ${lanSeen.join(', ')} each opened by its own link`;
      }
      return `${seen.join(' ; ')} ; ${lan}`;
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

  // ── G3: desktop data parity ──
  await R.check('9.5 the global catalogs the desktop reads equal production\'s (g3-expected.json, counts measured read-only): print entity types 43, global print templates 72, countries, modules, statuses, chart templates ...; fn_document_qr_link answers a uuid for a sales invoice (it answered 400 «unknown entity_type» without the print catalogs)', async () => {
    const par = await catalogParity(pg);
    if (par.differences.length) throw new Error(`${par.differences.length}/${par.tables} catalogs differ: ${par.differences.slice(0, 5).join(' | ')}`);
    const t = await signIn();
    const r = await request('POST', `${API}/rest/v1/rpc/fn_document_qr_link`, { headers: { apikey: anonKey, Authorization: `Bearer ${t.access_token}` }, body: { p_entity_type: 'sales_invoice', p_entity_id: S.seed.invoice, p_doc_type: 'sales_invoice' } });
    if (r.status !== 200 || typeof r.json !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r.json)) throw new Error(`fn_document_qr_link('sales_invoice') → ${r.status} ${r.text.slice(0, 200)}`);
    return `${par.tables} catalogs = production (print_entity_types ${par.counts.print_entity_types}, print_templates ${par.counts.print_templates}, countries ${par.counts.countries}, modules ${par.counts.modules}, custom_statuses ${par.counts.custom_statuses}); fn_document_qr_link → ${r.json.slice(0, 8)}…`;
  });

  if (ERP) {
    await R.check('9.6 in the real page the share centre of a sales invoice and of a sales quote and the customer statement preview each render >= 1 page; every fn_document_qr_link answers 200; no public token is requested or stored on the desktop (document_public_tokens stays empty)', async () => {
      const r = finalChecks('print,statement');
      const tokens = (await pg(`SELECT CASE WHEN to_regclass('public.document_public_tokens') IS NULL THEN 0 ELSE (SELECT count(*)::int FROM public.document_public_tokens) END AS n`)).rows[0].n;
      if (tokens !== 0) throw new Error(`${tokens} public token(s) exist on the desktop`);
      return `${r}; document_public_tokens 0 rows`;
    });
    await R.check('9.7 the company rail never covers a list\'s «⋯» row buttons: at 1280x800 and 1440x900, rail expanded (76px) and collapsed (2.5rem), a click at the centre of every row button of the materials table hits the button itself', async () => finalChecks('rail'));
    await R.check('9.8 adding an employee on the desktop: the role list of the add-user form is populated and the toast says the account was created (not «pending invitation»)', async () => {
      let res;
      await withRoomForCompanies(S.tenantId, async () => { res = finalChecks('usersToast'); });
      return res;
    });
  } else console.log('  SKIP  9.6-9.8 page checks (no --erp given)');
}

module.exports = { multiCompanyChecks, OWNER };
