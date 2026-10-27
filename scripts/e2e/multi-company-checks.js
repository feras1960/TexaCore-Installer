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
const { catalogParity, materialCapabilityGrants } = require('./catalog-parity');

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

  // ── 20270240l (E2E BUG-11): who may create / edit / delete a material and change its prices - three REAL users, every refusal a REAL value change checked in the database ──
  await R.check('9.9 material capabilities over REST with three real users (sales_rep, warehouse_keeper, sales_manager) and the owner: sales_rep cannot create or change selling_price / avg_cost_per_unit; warehouse_keeper creates and edits a card without prices but cannot delete it or change a price; sales_manager changes prices only; nobody writes avg_cost_per_unit / last_cost_per_unit; the global grants equal production\'s', async () => {
    const co = S.companies[0].id;
    const mg = await materialCapabilityGrants(pg);
    if (mg.length) throw new Error(`material capability grants differ from production's: ${mg.join(' | ')}`);
    const ownerTok = (await signIn()).access_token;
    const rest = async (tok, method, p, body, prefer = 'return=representation') => request(method, `${API}/rest/v1/${p}`, { headers: { apikey: anonKey, Authorization: `Bearer ${tok}`, Prefer: prefer }, body });
    const row = async (id) => (await pg('SELECT code, name_ar, selling_price::numeric AS sp, avg_cost_per_unit::numeric AS ac, last_cost_per_unit::numeric AS lc FROM public.fabric_materials WHERE id = $1', [id])).rows[0];
    const refused = (r) => r.status >= 400 || (r.status < 300 && Array.isArray(r.json) && r.json.length === 0);
    const base = { tenant_id: S.tenantId, company_id: co };
    // the cards the owner (company_owner: create + price + edit) prepares
    const mk = async (code, extra = {}) => { const r = await rest(ownerTok, 'POST', 'fabric_materials', { ...base, code, name_ar: `مادة ${code}`, ...extra }); if (r.status !== 201) throw new Error(`owner creates ${code} → ${r.status} ${r.text.slice(0, 200)}`); return r.json[0].id; };
    const m0 = await mk('GUARD-M0', { selling_price: 100 });
    const m1 = await mk('GUARD-M1');
    const out = [];
    // three employees through the installer's own invite route (a one-time password each); the free plan's single user is raised for the test
    const roles = await request('GET', `${UI}/api/employee-roles?companyId=${co}`, { headers: H });
    if (roles.status !== 200 || !roles.json.success) throw new Error(`employee-roles → ${roles.status} ${roles.text.slice(0, 160)}`);
    const roleId = (code) => { const r = roles.json.roles.find((x) => x.code === code); if (!r) throw new Error(`the owner is not offered the role ${code}: ${roles.json.roles.map((x) => x.code).join(',')}`); return r.id; };
    const users = {};
    await withRoomForCompanies(S.tenantId, async () => {
      for (const code of ['sales_rep', 'warehouse_keeper', 'sales_manager']) {
        const email = `${code.replace('_', '-')}-guard@e2e.test`;
        const inv = await request('POST', `${UI}/api/invite-employee`, { headers: H, body: { companyId: co, roleId: roleId(code), email, fullName: `Guard ${code}` } });
        if (inv.status !== 200 || !inv.json.success || !inv.json.oneTimePassword) throw new Error(`invite ${code} → ${inv.status} ${inv.text.slice(0, 200)}`);
        const login = await request('POST', `${API}/auth/v1/token?grant_type=password`, { headers: { apikey: anonKey }, body: { email, password: inv.json.oneTimePassword } });
        if (login.status !== 200 || !login.json.access_token) throw new Error(`${code} cannot sign in with his one-time password → ${login.status} ${login.text.slice(0, 160)}`);
        users[code] = login.json.access_token;
      }
    });

    // every user: nobody writes the cost (a real change 0 -> 11 / 12)
    for (const [who, tok] of [['company_owner', ownerTok], ...Object.entries(users)]) {
      const a = await rest(tok, 'PATCH', `fabric_materials?id=eq.${m0}`, { avg_cost_per_unit: 11 });
      const b = await rest(tok, 'PATCH', `fabric_materials?id=eq.${m0}`, { last_cost_per_unit: 12 });
      const c = await rest(tok, 'POST', 'fabric_materials', { ...base, code: `GUARD-COST-${who}`, name_ar: 'مادة بتكلفة', avg_cost_per_unit: 13 });
      if (!refused(a) || !refused(b) || !refused(c)) throw new Error(`${who} wrote a material cost: avg ${a.status}, last ${b.status}, create-with-cost ${c.status}`);
      const r = await row(m0);
      if (+r.ac !== 0 || +r.lc !== 0) throw new Error(`${who}: the cost changed in the database (${r.ac} / ${r.lc})`);
    }
    out.push('nobody writes avg_cost_per_unit / last_cost_per_unit (4 users x 3 attempts, database unchanged)');

    // sales_rep: nothing
    const sr = users.sales_rep;
    const c1 = await rest(sr, 'POST', 'fabric_materials', { ...base, code: 'GUARD-SR', name_ar: 'مادة مندوب' });
    const p1 = await rest(sr, 'PATCH', `fabric_materials?id=eq.${m0}`, { selling_price: 175 });
    if (!refused(c1)) throw new Error(`sales_rep created a material → ${c1.status} ${c1.text.slice(0, 160)}`);
    if (!refused(p1) || +(await row(m0)).sp !== 100) throw new Error(`sales_rep changed selling_price 100 -> 175 (${p1.status}); database ${(await row(m0)).sp}`);
    if ((await pg(`SELECT count(*)::int n FROM public.fabric_materials WHERE code = 'GUARD-SR'`)).rows[0].n) throw new Error('the sales_rep card exists');
    out.push(`sales_rep: create refused (${c1.status}), selling_price 100->175 refused (${p1.status})`);

    // warehouse_keeper: create + edit a card WITHOUT prices; no price, no delete
    const wk = users.warehouse_keeper;
    const c2 = await rest(wk, 'POST', 'fabric_materials', { ...base, code: 'GUARD-WK', name_ar: 'مادة أمين المستودع' });
    if (c2.status !== 201) throw new Error(`warehouse_keeper cannot create a card without prices → ${c2.status} ${c2.text.slice(0, 200)}`);
    const wkId = c2.json[0].id;
    const e2 = await rest(wk, 'PATCH', `fabric_materials?id=eq.${wkId}`, { name_ar: 'مادة أمين المستودع - معدّلة' });
    if (e2.status >= 300 || (await row(wkId)).name_ar !== 'مادة أمين المستودع - معدّلة') throw new Error(`warehouse_keeper cannot edit the card's name → ${e2.status} ${e2.text.slice(0, 200)}`);
    const c3 = await rest(wk, 'POST', 'fabric_materials', { ...base, code: 'GUARD-WK-P', name_ar: 'بسعر', selling_price: 55 });
    const p2 = await rest(wk, 'PATCH', `fabric_materials?id=eq.${m0}`, { selling_price: 175 });
    const d2 = await rest(wk, 'DELETE', `fabric_materials?id=eq.${wkId}`);
    if (!refused(c3)) throw new Error(`warehouse_keeper created a card WITH a price → ${c3.status}`);
    if (!refused(p2) || +(await row(m0)).sp !== 100) throw new Error(`warehouse_keeper changed selling_price (${p2.status}); database ${(await row(m0)).sp}`);
    if (!refused(d2) || !(await row(wkId))) throw new Error(`warehouse_keeper deleted a card (${d2.status})`);
    out.push(`warehouse_keeper: create ok, rename ok, create-with-price refused (${c3.status}), price change refused (${p2.status}), delete refused (${d2.status})`);

    // sales_manager: prices only
    const sm = users.sales_manager;
    const p3 = await rest(sm, 'PATCH', `fabric_materials?id=eq.${m0}`, { selling_price: 160 });
    if (p3.status >= 300 || +(await row(m0)).sp !== 160) throw new Error(`sales_manager cannot change a price 100 -> 160 → ${p3.status} ${p3.text.slice(0, 200)}; database ${(await row(m0)).sp}`);
    const e3 = await rest(sm, 'PATCH', `fabric_materials?id=eq.${m0}`, { name_ar: 'اسم من مدير المبيعات' });
    const c4 = await rest(sm, 'POST', 'fabric_materials', { ...base, code: 'GUARD-SM', name_ar: 'مادة مدير مبيعات' });
    const d3 = await rest(sm, 'DELETE', `fabric_materials?id=eq.${m1}`);
    if (!refused(e3) || (await row(m0)).name_ar !== 'مادة GUARD-M0') throw new Error(`sales_manager edited the card (${e3.status}); name ${(await row(m0)).name_ar}`);
    if (!refused(c4)) throw new Error(`sales_manager created a card → ${c4.status}`);
    if (!refused(d3) || !(await row(m1))) throw new Error(`sales_manager deleted a card (${d3.status})`);
    out.push(`sales_manager: price 100->160 ok, rename refused (${e3.status}), create refused (${c4.status}), delete refused (${d3.status})`);

    // the owner: price + edit + delete of an unused card
    const p4 = await rest(ownerTok, 'PATCH', `fabric_materials?id=eq.${m0}`, { selling_price: 170, name_ar: 'مادة GUARD-M0 - مالك' });
    const d4 = await rest(ownerTok, 'DELETE', `fabric_materials?id=eq.${m1}`);
    if (p4.status >= 300 || +(await row(m0)).sp !== 170) throw new Error(`the owner cannot change price + name → ${p4.status} ${p4.text.slice(0, 160)}`);
    if (d4.status >= 300 || (await row(m1))) throw new Error(`the owner cannot delete an unused card → ${d4.status} ${d4.text.slice(0, 160)}`);
    out.push('company_owner: price + rename + delete ok');
    return out.join('; ');
  });

  // ── 20270240k (E2E BUG-14): account 115 «بضاعة في الطريق» is a GROUP with its general leaf in a fresh company's extended chart ──
  await R.check('9.10 a fresh company\'s chart: account 115 «goods in transit» is a group with exactly one is_system general leaf under it, and the company\'s default goods-in-transit account is that leaf (20270240k)', async () => {
    const co = S.companies[0].id;
    const accs = (await pg(`SELECT id, account_code, is_group, is_system, parent_id FROM public.chart_of_accounts WHERE company_id = $1 AND (account_code = '115' OR account_code LIKE '115_') ORDER BY account_code`, [co])).rows;
    const g = accs.find((a) => a.account_code === '115');
    if (!g) throw new Error(`no account 115 in the company's chart (${accs.length} accounts 115x)`);
    if (g.is_group !== true) throw new Error('account 115 is a leaf (20270240k makes it a group)');
    const leaves = accs.filter((a) => a.parent_id === g.id && a.is_group !== true && a.is_system === true);
    if (leaves.length !== 1) throw new Error(`account 115 has ${leaves.length} is_system general leaves (expected exactly 1): ${accs.map((a) => a.account_code).join(',')}`);
    const def = (await pg(`SELECT default_git_account_id FROM public.company_accounting_settings WHERE company_id = $1`, [co])).rows[0];
    if (!def || def.default_git_account_id !== leaves[0].id) throw new Error(`default_git_account_id is ${def && def.default_git_account_id}, expected the general leaf ${leaves[0].account_code}`);
    const fn = (await pg(`SELECT to_regprocedure('public.fn_git_general_leaf(uuid)') IS NOT NULL AS ok`)).rows[0].ok;
    if (!fn) throw new Error('fn_git_general_leaf is missing');
    return `115 is a group, general leaf ${leaves[0].account_code} (is_system), default_git_account_id = that leaf`;
  });

  // ── 20270240n (E2E BUG-13): a sale's stock never leaves at 0 - loose stock at the warehouse's weighted average, a roll at its own cost per metre, the journal's cost of sales follows ──
  await R.check('9.11 direct sales through the real create_and_post_direct_sale: loose stock leaves at the warehouse\'s weighted average (not 0, not the last cost) and the journal\'s cost of sales is qty x that cost; a roll leaves at its OWN cost per metre and the stock average is re-based so the stock value stays equal to the ledger (20270240n)', async () => {
    const co = S.companies[0].id;
    const cur = (await pg('SELECT public.fx_company_currency($1) AS currency', [co])).rows[0].currency;
    const wh = (await pg('SELECT id FROM public.warehouses WHERE company_id = $1 ORDER BY created_at LIMIT 1', [co])).rows[0];
    if (!wh) throw new Error('the company has no warehouse');
    const t = await signIn();
    const call = (header, lines, rolls) => request('POST', `${API}/rest/v1/rpc/create_and_post_direct_sale`, { headers: { apikey: anonKey, Authorization: `Bearer ${t.access_token}` },
      body: { p_header: header, p_lines: lines, p_rolls: rolls, p_idempotency_key: require('crypto').randomUUID() } });
    const customer = async (tag) => {
      const id = require('crypto').randomUUID();
      await pg(`INSERT INTO public.customers (id, tenant_id, company_id, code, name_ar, receivable_account_id) VALUES ($1::uuid,$2,$3,$4,'عميل كلفة',
                 (SELECT id FROM public.chart_of_accounts WHERE company_id = $3 AND is_receivable AND is_detail AND NOT COALESCE(is_summary_account,false) ORDER BY account_code LIMIT 1))`, [id, S.tenantId, co, `COST-${tag}-${id.slice(0, 6)}`]);
      return id;
    };
    const header = (cust) => ({ company_id: co, tenant_id: S.tenantId, customer_id: cust, warehouse_id: wh.id, stock_warehouse_id: wh.id, currency: cur, payment_terms_days: 0 });
    const near = (a, b, what) => { if (Math.abs(Number(a) - Number(b)) > 0.01) throw new Error(`${what}: ${a}, expected ${b}`); };
    const cogs = async (invoice) => {
      const je = (await pg('SELECT journal_entry_id FROM public.sales_transactions WHERE id = $1', [invoice])).rows[0].journal_entry_id;
      if (!je) throw new Error('the sale posted no journal entry');
      const rows = (await pg(`SELECT a.account_code, l.debit FROM public.journal_entry_lines l JOIN public.chart_of_accounts a ON a.id = l.account_id
                               WHERE l.entry_id = $1 AND l.debit > 0 AND l.description LIKE 'تكلفة مبيعات%'`, [je])).rows;
      if (rows.length !== 1) throw new Error(`the journal has ${rows.length} cost-of-sales lines`);
      return Number(rows[0].debit);
    };
    const out = [];

    // loose stock: 100 pieces, weighted average 70, LAST cost 55 (so «the last cost» and «the average» differ)
    const matL = require('crypto').randomUUID();
    await pg(`INSERT INTO public.fabric_materials (id, tenant_id, company_id, code, name_ar, unit, material_type, avg_cost_per_unit, track_serial, is_roll_tracked) VALUES ($1::uuid,$2,$3,$4,'مادة كلفة سائبة','piece','standard',70,false,false)`, [matL, S.tenantId, co, `COST-L-${matL.slice(0, 6)}`]);
    await pg(`INSERT INTO public.inventory_stock (tenant_id, company_id, material_id, warehouse_id, quantity_on_hand, current_quantity, average_cost, last_cost) VALUES ($1,$2,$3,$4,100,100,70,55)`, [S.tenantId, co, matL, wh.id]);
    const avgBefore = Number((await pg('SELECT average_cost FROM public.inventory_stock WHERE material_id = $1 AND warehouse_id = $2', [matL, wh.id])).rows[0].average_cost);
    const r1 = await call(header(await customer('L')), [{ material_id: matL, quantity: 3, unit: 'piece', unit_price: 100, tax_rate: 0, warehouse_id: wh.id }], []);
    if (r1.status !== 200 || !r1.json || !r1.json.invoice_id) throw new Error(`loose direct sale → ${r1.status} ${r1.text.slice(0, 240)}`);
    const mv1 = (await pg(`SELECT movement_type, quantity, unit_cost, total_cost FROM public.inventory_movements WHERE reference_type = 'sale_invoice' AND reference_id = $1 AND movement_type IN ('sale','sales_delivery')`, [r1.json.invoice_id])).rows;
    if (mv1.length !== 1) throw new Error(`the loose sale wrote ${mv1.length} issue movements`);
    if (!(Number(mv1[0].unit_cost) > 0)) throw new Error('the loose stock left at cost 0');
    near(mv1[0].unit_cost, avgBefore, 'loose issue unit cost vs the warehouse average before the sale');
    near(mv1[0].total_cost, 3 * avgBefore, 'loose issue total cost');
    near(await cogs(r1.json.invoice_id), 3 * avgBefore, 'journal cost of sales (loose)');
    const st1 = (await pg('SELECT quantity_on_hand, average_cost FROM public.inventory_stock WHERE material_id = $1 AND warehouse_id = $2', [matL, wh.id])).rows[0];
    near(st1.quantity_on_hand, 97, 'stock after the loose sale'); near(st1.average_cost, avgBefore, 'the average after a stock-out at the average');
    out.push(`loose: 3 pcs left at ${Number(mv1[0].unit_cost)} (= the warehouse average ${avgBefore}, last cost was 55), movement ${Number(mv1[0].total_cost)}, journal cost of sales ${3 * avgBefore}`);

    // a roll with its own cost: 10 m at 40 / m out of 100 m at 70 -> the average of what stays is (7000 - 400) / 90
    const matR = require('crypto').randomUUID(); const roll = require('crypto').randomUUID();
    await pg(`INSERT INTO public.fabric_materials (id, tenant_id, company_id, code, name_ar, unit, material_type, avg_cost_per_unit, track_serial, is_roll_tracked) VALUES ($1::uuid,$2,$3,$4,'قماش كلفة','meter','fabric',70,false,true)`, [matR, S.tenantId, co, `COST-R-${matR.slice(0, 6)}`]);
    await pg(`INSERT INTO public.inventory_stock (tenant_id, company_id, material_id, warehouse_id, quantity_on_hand, current_quantity, average_cost, last_cost) VALUES ($1,$2,$3,$4,100,100,70,70)`, [S.tenantId, co, matR, wh.id]);
    await pg(`INSERT INTO public.fabric_rolls (id, tenant_id, company_id, material_id, roll_number, initial_length, current_length, cost_per_meter, warehouse_id, status) VALUES ($1::uuid,$2,$3,$4,$5,10,10,40,$6,'available')`, [roll, S.tenantId, co, matR, `ROLL-${roll.slice(0, 6)}`, wh.id]);
    const r2 = await call(header(await customer('R')), [{ material_id: matR, quantity: 10, unit: 'meter', unit_price: 100, tax_rate: 0, roll_id: roll, warehouse_id: wh.id }], [{ id: roll }]);
    if (r2.status !== 200 || !r2.json || !r2.json.invoice_id) throw new Error(`roll direct sale → ${r2.status} ${r2.text.slice(0, 240)}`);
    const mv2 = (await pg(`SELECT roll_id, quantity, unit_cost, total_cost FROM public.inventory_movements WHERE reference_type = 'sale_invoice' AND reference_id = $1 AND movement_type IN ('sale','sales_delivery')`, [r2.json.invoice_id])).rows.filter((m) => m.roll_id === roll);
    if (mv2.length !== 1) throw new Error(`the roll sale wrote ${mv2.length} movements for the roll`);
    near(mv2[0].unit_cost, 40, 'the roll\'s unit cost (its own cost per metre, not the average 70)'); near(mv2[0].total_cost, 400, 'the roll movement total');
    near(await cogs(r2.json.invoice_id), 400, 'journal cost of sales (roll)');
    const st2 = (await pg('SELECT quantity_on_hand, average_cost FROM public.inventory_stock WHERE material_id = $1 AND warehouse_id = $2', [matR, wh.id])).rows[0];
    near(st2.quantity_on_hand, 90, 'stock after the roll sale'); near(Number(st2.average_cost) * 90, 6600, 'the stock value after the roll left at its own cost (value = ledger)');
    out.push(`roll: 10 m left at its own 40 / m (average was 70), movement 400, journal cost of sales 400; the average of the 90 m that stay is ${Number(st2.average_cost)} (value 6600)`);
    return out.join('; ');
  });
}

module.exports = { multiCompanyChecks, OWNER };
