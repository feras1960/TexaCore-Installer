'use strict';
// 2.0.5 RC2 — the new-company wizard for an admin who is ALREADY signed in: createLocalCompany with callerAccessToken adds the company to HIS tenant
// (no tenant, no account, no session is created), and the plain "same admin name" path now says how to get out of EMAIL_EXISTS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { createLocalCompany, normaliseInput } = require('../src/provisioning');

const ADMIN = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@acme.test' };
const TENANT = '00000000-0000-4000-8000-000000000900';
const TOKEN = 'aaaaaaaa1.bbbbbbbb1.cccccccc1';
const profile = (over = {}) => ({ id: ADMIN.id, tenant_id: TENANT, company_id: null, is_tenant_admin: true, is_active: true, email: ADMIN.email, owner_email: ADMIN.email, ...over });

async function harness({ prof = profile(), userStatus = 200, companyRpc = 'ok', ensureFails = false, emailTaken = false } = {}) {
  const http_ = []; const queries = []; const subs = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = body ? JSON.parse(body) : null;
      http_.push({ method: req.method, path: req.url, body: b, auth: req.headers.authorization, apikey: req.headers.apikey });
      const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'GET' && req.url === '/user') return userStatus === 200 ? send(200, { id: ADMIN.id, email: ADMIN.email }) : send(userStatus, { message: 'invalid JWT' });
      if (req.method === 'POST' && req.url === '/rpc/fn_provision_new_company') return companyRpc === 'ok' ? send(200, { success: true, company_id: 'co-new' }) : send(400, { message: 'quota' });
      if (req.method === 'POST' && req.url === '/rpc/fn_provision_import_target_company') return companyRpc === 'ok' ? send(200, { company_id: 'co-imp', operation_key: b.p_idempotency_key }) : send(400, { message: 'nope' });
      if (req.method === 'POST' && req.url === '/admin/users') return send(422, { error_code: 'email_exists' });
      send(404, { message: `unexpected ${req.method} ${req.url}` });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const deps = {
    gotrueUrl: base, restUrl: base, anonKey: 'ANON', serviceKey: 'SERVICE', log: () => {},
    ensureSubscription: async (t) => { subs.push(t); if (ensureFails) throw new Error('plan sync failed'); },
    connect: async () => ({
      query: async (text, params) => {
        queries.push({ text, params });
        if (/FROM public\.user_profiles up JOIN auth\.users au/.test(text)) return { rowCount: prof ? 1 : 0, rows: prof ? [prof] : [] };
        if (/FROM auth\.users WHERE lower\(email\)/.test(text)) return { rowCount: emailTaken ? 1 : 0, rows: emailTaken ? [{ id: 'x' }] : [] };
        return { rowCount: 1, rows: [] };
      },
      end: async () => {},
    }),
  };
  return { deps, http_, queries, subs, close: () => server.close() };
}
const attachInput = (o = {}) => ({ companyName: 'Second Co', localCurrency: 'usd', mainCurrency: 'eur', country: 'ua', callerAccessToken: TOKEN, ...o });

test('attach: the company is created INSIDE the caller\'s tenant, with the caller\'s own JWT; no tenant, no account, no sign-in; no session in the answer', async () => {
  const h = await harness();
  try {
    const r = await createLocalCompany(h.deps, attachInput());
    assert.equal(r.success, true, JSON.stringify(r));
    assert.deepEqual(Object.keys(r).sort(), ['adminEmail', 'adminUserId', 'attached', 'companyId', 'createdSource', 'localCurrency', 'provisioningKey', 'success', 'tenantId']);
    assert.equal(r.attached, true); assert.equal(r.tenantId, TENANT); assert.equal(r.companyId, 'co-new');
    assert.equal(r.adminUserId, ADMIN.id); assert.equal(r.adminEmail, ADMIN.email); assert.equal(r.localCurrency, 'USD');
    assert.ok(!('accessToken' in r) && !('refreshToken' in r));
    assert.equal(h.http_.find((c) => c.path === '/user').auth, `Bearer ${TOKEN}`, 'GoTrue vouches for the token');
    const rpc = h.http_.find((c) => c.path === '/rpc/fn_provision_new_company');
    assert.equal(rpc.auth, `Bearer ${TOKEN}`, 'the server function runs as the CALLER');
    assert.equal(rpc.apikey, 'ANON');
    assert.equal(rpc.body.p_tenant_id, TENANT);
    assert.equal(rpc.body.p_company.default_currency, 'USD');
    assert.deepEqual(rpc.body.p_company.supported_currencies, ['USD', 'EUR']);
    // nothing of the new-tenant path ran
    assert.deepEqual(h.http_.map((c) => `${c.method} ${c.path}`), ['GET /user', 'POST /rpc/fn_provision_new_company']);
    assert.ok(!h.queries.some((q) => /INSERT INTO public\.tenants|INSERT INTO public\.user_profiles|INSERT INTO public\.user_roles|DELETE/.test(q.text)));
    assert.deepEqual(h.subs, [TENANT], 'the subscription is ensured for his tenant');
    // his active company is set only when he had none
    const upd = h.queries.find((q) => /UPDATE public\.user_profiles SET company_id = \$2 WHERE id = \$1 AND company_id IS NULL/.test(q.text));
    assert.deepEqual(upd.params, [ADMIN.id, 'co-new']);
  } finally { h.close(); }
});

test('attach with purpose rsf_import: fn_provision_import_target_company as the caller; the provisioning key and source come back', async () => {
  const h = await harness();
  try {
    const r = await createLocalCompany(h.deps, attachInput({ purpose: 'rsf_import' }));
    assert.equal(r.success, true);
    assert.deepEqual([r.companyId, r.createdSource], ['co-imp', 'rsf_import']);
    assert.ok(r.provisioningKey.startsWith('local-setup:'));
    const rpc = h.http_.find((c) => c.path === '/rpc/fn_provision_import_target_company');
    assert.equal(rpc.auth, `Bearer ${TOKEN}`);
    assert.equal(rpc.body.p_tenant_id, TENANT);
    assert.equal(rpc.body.p_currency, 'USD');
  } finally { h.close(); }
});

test('attach needs no admin e-mail or password, but still the company\'s own required fields (currency)', async () => {
  assert.equal(normaliseInput(attachInput(), { attach: true }).ok, true);
  assert.equal(normaliseInput(attachInput(), { attach: false }).ok, false, 'a normal creation still needs the admin account');
  const h = await harness();
  try {
    const r = await createLocalCompany(h.deps, attachInput({ localCurrency: '' }));
    assert.deepEqual([r.success, r.code], [false, 'INVALID_INPUT']);
    assert.equal(h.http_.length, 0);
  } finally { h.close(); }
});

test('INVALID_SESSION: a token GoTrue refuses (expired / revoked / forged), a malformed or non-string one - nothing is read or created', async () => {
  const h = await harness({ userStatus: 401 });
  try {
    for (const tok of [TOKEN, 'nope', { a: 1 }, 12345, ['x']]) {
      const r = await createLocalCompany(h.deps, attachInput({ callerAccessToken: tok }));
      assert.deepEqual([r.success, r.code], [false, 'INVALID_SESSION'], JSON.stringify(tok));
      assert.ok(!('accessToken' in r));
    }
    assert.ok(!h.http_.some((c) => c.path.startsWith('/rpc/')), 'no company function was called');
    assert.equal(h.queries.length, 0, 'the database was not even asked');
  } finally { h.close(); }
  const down = await harness();
  try {
    const r = await createLocalCompany({ ...down.deps, gotrueUrl: 'http://127.0.0.1:1' }, attachInput());
    assert.deepEqual([r.success, r.code], [false, 'SERVICES_DOWN']);
  } finally { down.close(); }
});

test('NOT_TENANT_ADMIN: a member who is not the administrator, an account with no tenant, an inactive one - refused before any company is made; the tenant owner by owner_email is accepted', async () => {
  for (const prof of [profile({ is_tenant_admin: false, owner_email: 'someone-else@acme.test' }), profile({ tenant_id: null }), profile({ is_active: false }), null]) {
    const h = await harness({ prof });
    try {
      const r = await createLocalCompany(h.deps, attachInput());
      assert.deepEqual([r.success, r.code], [false, 'NOT_TENANT_ADMIN'], JSON.stringify(prof));
      assert.ok(!h.http_.some((c) => c.path.startsWith('/rpc/')));
      assert.equal(h.subs.length, 0);
    } finally { h.close(); }
  }
  const owner = await harness({ prof: profile({ is_tenant_admin: false }) });   // owner_email === email
  try { assert.equal((await createLocalCompany(owner.deps, attachInput())).success, true); } finally { owner.close(); }
  const flagged = await harness({ prof: profile({ is_tenant_admin: true, owner_email: null }) });
  try { assert.equal((await createLocalCompany(flagged.deps, attachInput())).success, true); } finally { flagged.close(); }
});

test('attach: a company the server refuses (quota) is COMPANY_FAILED and NOTHING is deleted - this call created no tenant and no user', async () => {
  const h = await harness({ companyRpc: 'fail' });
  try {
    const r = await createLocalCompany(h.deps, attachInput());
    assert.deepEqual([r.success, r.code], [false, 'COMPANY_FAILED']);
    assert.ok(!h.http_.some((c) => c.method === 'DELETE'));
    assert.ok(!h.queries.some((q) => /DELETE|UPDATE public\.user_profiles/.test(q.text)));
  } finally { h.close(); }
  const e = await harness({ ensureFails: true });
  try {
    const r = await createLocalCompany(e.deps, attachInput());
    assert.equal(r.success, false);
    assert.ok(!e.http_.some((c) => c.path.startsWith('/rpc/')), 'no company without a subscription');
  } finally { e.close(); }
});

test('EMAIL_EXISTS (no token): the code stays, the text names both ways out, and a hint is added - for the pre-check and for the GoTrue race', async () => {
  const want = 'This admin name/e-mail is already used on this computer. Choose another admin name, or sign in as that admin first and create the company from your account.';
  const h = await harness({ emailTaken: true });
  try {
    const r = await createLocalCompany(h.deps, { companyName: 'A', adminEmail: 'admin@acme.test', adminPassword: 'secret1', localCurrency: 'USD' });
    assert.deepEqual([r.success, r.code, r.error, r.hint], [false, 'EMAIL_EXISTS', want, 'sign_in_or_choose_another']);
    assert.equal(h.http_.length, 0);
  } finally { h.close(); }
  const race = await harness();
  try {
    const r = await createLocalCompany(race.deps, { companyName: 'A', adminEmail: 'admin@acme.test', adminPassword: 'secret1', localCurrency: 'USD' });
    assert.deepEqual([r.code, r.error, r.hint], ['EMAIL_EXISTS', want, 'sign_in_or_choose_another']);
  } finally { race.close(); }
});

test('wiring: handleCreateLocalCompany answers an attached company with attached/adminUserId/localCurrency and NO session; the token is never logged', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const at = main.indexOf('async function handleCreateLocalCompany');
  const fn = main.slice(at, main.indexOf("ipcMain.handle('create-local-company'", at));
  assert.match(fn, /\.\.\.\(result\.attached \? \{ attached: true, adminUserId: result\.adminUserId, localCurrency: result\.localCurrency \} : \{ accessToken, refreshToken \}\)/);
  assert.doesNotMatch(fn.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'), /callerAccessToken/, 'the handler never reads or logs the token itself');
  const prov = fs.readFileSync(path.join(__dirname, '..', 'src', 'provisioning.js'), 'utf8');
  const body = prov.slice(prov.indexOf('async function attachCompanyToCaller'), prov.indexOf('async function createLocalCompany'));
  for (const m of body.matchAll(/log\(([^;]*)\);/g)) assert.doesNotMatch(m[1], /token|password/i, `a log line mentions a secret: ${m[0]}`);
});
