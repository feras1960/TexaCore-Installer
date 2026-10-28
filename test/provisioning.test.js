'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createLocalCompany, healTenantOwners, backfillUserTenantMetadata, normaliseInput } = require('../src/provisioning');

// ── fakes: a GoTrue + PostgREST on loopback and a recording pg client ─────────────────────────────
async function harness({ emailTaken = false, gotrueCreate = 'ok', companyRpc = 'ok', gotrueDelete = 200, existingUsers = [{ id: 'someone-elses', email: 'other@x.test' }] } = {}) {
  const http_ = []; // {method, path, body}
  const queries = [];
  const order = []; // interleaved log of SQL and HTTP, to assert ordering
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = body ? JSON.parse(body) : null;
      http_.push({ method: req.method, path: req.url, body: b, auth: req.headers.authorization });
      order.push(`http:${req.method} ${req.url.split('?')[0]}`);
      const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'GET' && req.url.startsWith('/admin/users')) return send(200, { users: existingUsers });   // the page of ALL users, whatever the query says
      if (req.method === 'POST' && req.url === '/admin/users') {
        return gotrueCreate === 'ok' ? send(200, { id: 'user-new', email: b.email }) : send(422, { error_code: 'email_exists', msg: 'exists' });
      }
      if (req.method === 'DELETE' && req.url.startsWith('/admin/users/')) return send(gotrueDelete, {});
      if (req.method === 'POST' && req.url.startsWith('/token')) return send(200, { access_token: 'AT', refresh_token: 'RT' });
      if (req.method === 'POST' && req.url === '/rpc/fn_provision_new_company') {
        return companyRpc === 'ok' ? send(200, { success: true, company_id: 'co-1' }) : send(400, { message: 'quota' });
      }
      if (req.method === 'POST' && req.url === '/rpc/fn_provision_import_target_company') {
        return companyRpc === 'ok' ? send(200, { company_id: 'co-2', operation_key: b.p_idempotency_key, status: 'provisioning' }) : send(400, { message: 'nope' });
      }
      send(404, { message: 'unexpected ' + req.method + ' ' + req.url });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const deps = {
    gotrueUrl: base, restUrl: base, anonKey: 'ANON', serviceKey: 'SERVICE',
    log: () => {},
    ensureSubscription: async (t) => { queries.push({ text: 'ensureSubscription', params: [t] }); },
    connect: async () => ({
      query: async (text, params) => {
        queries.push({ text, params });
        if (/DELETE FROM public\.user_roles/.test(text)) order.push('sql:user_roles');
        if (/FROM auth\.users WHERE lower\(email\)/.test(text)) return { rowCount: emailTaken ? 1 : 0, rows: emailTaken ? [{ id: 'x' }] : [] };
        if (/FROM public\.companies WHERE tenant_id/.test(text)) return { rowCount: 0, rows: [] };
        return { rowCount: 1, rows: [] };
      },
      end: async () => {},
    }),
  };
  return { deps, http_, queries, order, close: () => server.close() };
}
const input = (o = {}) => ({ companyName: 'Acme', adminEmail: 'Owner@Acme.Test', adminPassword: 'secret1', localCurrency: 'uah', mainCurrency: 'usd', country: 'ua', ...o });

test('input: there is no default currency, SAR or otherwise', () => {
  assert.equal(normaliseInput({ companyName: 'A', adminEmail: 'a@b.co', adminPassword: '123456' }).ok, false);
  assert.match(normaliseInput({ companyName: 'A', adminEmail: 'a@b.co', adminPassword: '123456' }).errors.join(), /localCurrency/);
  const v = normaliseInput(input()).value;
  assert.equal(v.localCurrency, 'UAH');
  assert.equal(v.mainCurrency, 'USD');
  assert.equal(v.email, 'owner@acme.test');
});

test('input: the legacy username-only form still derives an email', () => {
  const v = normaliseInput({ companyName: 'A', adminUsername: 'the admin', adminPassword: '123456', localCurrency: 'USD' });
  assert.equal(v.ok, true);
  assert.equal(v.value.email, 'the_admin@texacore.local');
});

test('EMAIL_EXISTS is refused BEFORE anything is written or any call is made', async () => {
  const h = await harness({ emailTaken: true });
  try {
    const r = await createLocalCompany(h.deps, input());
    assert.equal(r.success, false);
    assert.equal(r.code, 'EMAIL_EXISTS');
    assert.equal(h.http_.length, 0, 'no HTTP at all');
    assert.ok(h.queries.every((q) => /^\s*SELECT 1 FROM auth\.users/.test(q.text)), 'only the existence SELECT ran');
  } finally { h.close(); }
});

test('success (blank company): owner_email on the tenant, is_tenant_admin on the profile, company through fn_provision_new_company as the admin', async () => {
  const h = await harness();
  try {
    const r = await createLocalCompany(h.deps, input());
    assert.equal(r.success, true);
    assert.equal(r.companyId, 'co-1');
    assert.equal(r.accessToken, 'AT');
    const tenantInsert = h.queries.find((q) => /INSERT INTO public\.tenants/.test(q.text));
    assert.match(tenantInsert.text, /owner_email/);
    assert.equal(tenantInsert.params[3], 'owner@acme.test');
    assert.equal(tenantInsert.params[7], 'UAH');                                  // default_currency = the user's choice
    const profile = h.queries.find((q) => /INSERT INTO public\.user_profiles/.test(q.text));
    assert.match(profile.text, /is_tenant_admin/);
    assert.match(profile.text, /true, true\)/);
    const rpc = h.http_.find((c) => c.path === '/rpc/fn_provision_new_company');
    assert.equal(rpc.auth, 'Bearer AT');                                           // signed in as the admin, not a service key
    assert.equal(rpc.body.p_company.default_currency, 'UAH');
    assert.deepEqual(rpc.body.p_company.supported_currencies, ['UAH', 'USD']);
    assert.ok(h.queries.some((q) => q.text === 'ensureSubscription'));
    // order: tenant → user → ownership → subscription → sign-in → company
    const seq = h.http_.map((c) => `${c.method} ${c.path.split('?')[0]}`);
    assert.deepEqual(seq, ['POST /admin/users', 'POST /token', 'POST /rpc/fn_provision_new_company']);
  } finally { h.close(); }
});

test('purpose rsf_import: fn_provision_import_target_company with the confirmed currency; returns companyId + provisioningKey', async () => {
  const h = await harness();
  try {
    const r = await createLocalCompany(h.deps, input({ purpose: 'rsf_import' }));
    assert.equal(r.success, true);
    assert.equal(r.createdSource, 'rsf_import');
    assert.equal(r.companyId, 'co-2');
    assert.ok(r.provisioningKey && r.provisioningKey.startsWith('local-setup:'));
    const rpc = h.http_.find((c) => c.path === '/rpc/fn_provision_import_target_company');
    assert.equal(rpc.body.p_currency, 'UAH');
    assert.equal(rpc.body.p_country_code, 'UA');
    assert.equal(rpc.body.p_created_source, 'rsf_import');
    assert.deepEqual(rpc.body.p_supported_currencies, ['UAH', 'USD']);
    assert.ok(!h.http_.some((c) => c.path === '/rpc/fn_provision_new_company'));
  } finally { h.close(); }
});

test('NEVER lists users through GoTrue; a GoTrue email_exists race removes only the tenant THIS call created and deletes no user', async () => {
  const h = await harness({ gotrueCreate: 'exists' });
  try {
    const r = await createLocalCompany(h.deps, input());
    assert.equal(r.success, false);
    assert.equal(r.code, 'EMAIL_EXISTS');
    assert.ok(!h.http_.some((c) => c.method === 'GET'), 'no GET /admin/users?email= (GoTrue ignores the filter and returns everybody)');
    assert.ok(!h.http_.some((c) => c.method === 'DELETE'), 'no user was deleted');
    const tenantInsert = h.queries.find((q) => /INSERT INTO public\.tenants/.test(q.text));
    const del = h.queries.find((q) => /DELETE FROM public\.tenants/.test(q.text));
    assert.equal(del.params[0], tenantInsert.params[0], 'the tenant deleted is the one this call generated');
  } finally { h.close(); }
});

test('a failure after the user exists deletes exactly the user id this call was handed — not "the newest user" — dependents first', async () => {
  const h = await harness({ companyRpc: 'fail', existingUsers: [{ id: 'victim-1' }, { id: 'victim-2' }, { id: 'user-new' }] });
  try {
    const r = await createLocalCompany(h.deps, input());
    assert.equal(r.success, false);
    assert.equal(r.code, 'COMPANY_FAILED');
    const dels = h.http_.filter((c) => c.method === 'DELETE');
    assert.deepEqual(dels.map((c) => c.path), ['/admin/users/user-new']);
    assert.ok(!h.http_.some((c) => c.method === 'GET'));
    assert.ok(h.queries.some((q) => /DELETE FROM public\.tenants/.test(q.text)));
    // production's role guards refuse a cascade from GoTrue's session: the role rows of THIS user go before the GoTrue delete
    const roleDel = h.queries.find((q) => /DELETE FROM public\.user_roles WHERE user_id/.test(q.text));
    const profDel = h.queries.find((q) => /DELETE FROM public\.user_profiles WHERE id/.test(q.text));
    assert.deepEqual(roleDel.params, ['user-new']);
    assert.deepEqual(profDel.params, ['user-new']);
    assert.ok(h.order.indexOf('sql:user_roles') < h.order.indexOf('http:DELETE /admin/users/user-new'), 'dependents are deleted before the GoTrue call');
  } finally { h.close(); }
});

test('if GoTrue still refuses the delete, exactly that id is removed from auth.users by SQL', async () => {
  const h = await harness({ companyRpc: 'fail', gotrueDelete: 500 });
  try {
    await createLocalCompany(h.deps, input());
    const direct = h.queries.find((q) => /DELETE FROM auth\.users WHERE id = \$1/.test(q.text));
    assert.deepEqual(direct.params, ['user-new']);
  } finally { h.close(); }
});

test('healTenantOwners: restores owner_email and the tenant-admin flag, touching only rows that lack them', async () => {
  const seen = [];
  const pgQuery = async (text) => {
    seen.push(text);
    if (/UPDATE public\.tenants/.test(text)) return { rowCount: 2, rows: [{}, {}] };
    if (/UPDATE public\.user_profiles/.test(text)) return { rowCount: 3, rows: [{}, {}, {}] };
    throw new Error('unexpected');
  };
  const r = await healTenantOwners({ pgQuery });
  assert.deepEqual(r, { tenants: 2, profiles: 3 });
  assert.match(seen[0], /owner_email IS NULL OR btrim\(t\.owner_email\) = ''/);
  assert.match(seen[1], /is_tenant_admin IS DISTINCT FROM true/);
});

test('the installer-created owner carries the tenant in BOTH user_metadata and app_metadata (the ERP screens read user_metadata.tenant_id)', async () => {
  const h = await harness();
  try {
    const r = await createLocalCompany(h.deps, input());
    assert.equal(r.success, true);
    const tenantId = h.queries.find((q) => /INSERT INTO public\.tenants/.test(q.text)).params[0];
    const create = h.http_.find((c) => c.method === 'POST' && c.path === '/admin/users');
    assert.ok(tenantId, 'a tenant id was generated');
    assert.equal(create.body.user_metadata.tenant_id, tenantId);
    assert.equal(create.body.app_metadata.tenant_id, tenantId);
    assert.equal(create.body.user_metadata.role, 'admin');                          // nothing else about the owner changed
    assert.ok(create.body.user_metadata.full_name);
  } finally { h.close(); }
});

test('backfillUserTenantMetadata: copies app_metadata.tenant_id into user_metadata only where it is missing, touches no other column, logs the count', async () => {
  const seen = []; const logs = [];
  const pgQuery = async (text, params) => { seen.push({ text, params }); return { rowCount: 2, rows: [{ id: 'a' }, { id: 'b' }] }; };
  const r = await backfillUserTenantMetadata({ pgQuery, log: (m) => logs.push(m) });
  assert.deepEqual(r, { users: 2 });
  assert.equal(seen.length, 1);
  const sql = seen[0].text.replace(/\s+/g, ' ');
  assert.match(sql, /^ ?UPDATE auth\.users SET raw_user_meta_data = COALESCE\(raw_user_meta_data, '\{\}'::jsonb\) \|\| jsonb_build_object\('tenant_id', raw_app_meta_data->>'tenant_id'\) /);
  assert.match(sql, /WHERE NULLIF\(raw_app_meta_data->>'tenant_id', ''\) IS NOT NULL AND NOT \(COALESCE\(raw_user_meta_data, '\{\}'::jsonb\) \? 'tenant_id'\)/);
  assert.equal((sql.match(/\bSET\b/g) || []).length, 1);
  assert.doesNotMatch(sql.replace(/raw_user_meta_data/g, ''), /updated_at|encrypted_password|email|raw_app_meta_data\s*=/);   // only raw_user_meta_data is assigned
  assert.match(logs.join('\n'), /\b2 user\(s\)/);
});

test('backfillUserTenantMetadata: nothing to do is a clean zero (safe on every start)', async () => {
  const logs = [];
  const r = await backfillUserTenantMetadata({ pgQuery: async () => ({ rowCount: 0, rows: [] }), log: (m) => logs.push(m) });
  assert.deepEqual(r, { users: 0 });
  assert.match(logs.join('\n'), /\b0 user\(s\)/);
});

test('the boot sequence runs the backfill right after healTenantOwners, as non-fatal', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'service-manager.js'), 'utf8');
  const heal = src.indexOf('.healTenantOwners(');
  const back = src.indexOf('.backfillUserTenantMetadata(');
  assert.ok(heal > 0 && back > heal, 'backfill comes after healTenantOwners');
  assert.ok(back < src.indexOf('startFrontendServer(uiPort)'), 'and before the front end starts');
  assert.match(src.slice(back, back + 600), /catch \(e\) \{ console\.warn\('\[ServiceManager\] backfillUserTenantMetadata failed \(non-fatal\)/);
});
