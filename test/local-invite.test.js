'use strict';
// 2.0.5 RC2 — POST /local-api/invite-user and provisioning.inviteLocalUserAsCaller: the ERP's «إضافة مستخدم» on a local install.
// Against FAKE GoTrue / PostgREST servers (ephemeral loopback ports) and a fake database connection: the whole flow of the real code is exercised, and
// what the fakes recorded proves WHO each call was made as (the caller's own token), what was created and what was cleaned up.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');
const express = require('express');
const P = require('../src/provisioning');
const R = require('../src/local-invite-route');

const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TENANT = U(900);
const CO1 = U(101); const CO2 = U(102);
const ROLE1 = U(201); const ROLE2 = U(202);
const CALLER = { id: U(1), email: 'manager@example.com' };
const SERVICE_KEY = 'SERVICE-KEY-SECRET-xyz';
const ANON_KEY = 'ANON-KEY-PUBLIC-abc';
const jwt = (tag) => `aaaaaaaa${tag}.bbbbbbbb${tag}.cccccccc${tag}`;   // a JWT-shaped string (3 base64url parts)
const CALLER_JWT = jwt('caller');

function readBody(req) {
  return new Promise((resolve) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(c).toString() || 'null')); } catch { resolve(null); } }); });
}
function listen(handler) {
  return new Promise((resolve) => { const sv = http.createServer(handler); sv.listen(0, '127.0.0.1', () => resolve(sv)); });
}

/** The fake world: GoTrue, PostgREST and a scripted database. `script` overrides behaviour per test. */
async function world(script = {}) {
  const w = { calls: [], logs: [], queries: [], users: new Map(), tokens: new Map([[CALLER_JWT, CALLER]]), created: [], deleted: [], nextUser: 500, closeAll: null };
  const gotrue = await listen(async (req, res) => {
    const body = await readBody(req);
    const url = req.url.split('?')[0];
    const rec = { svc: 'gotrue', method: req.method, url: req.url, auth: req.headers.authorization || '', apikey: req.headers.apikey || '', body };
    w.calls.push(rec);
    const send = (st, b) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(b === undefined ? '' : JSON.stringify(b)); };
    if (script.gotrue) { const r = script.gotrue(rec, w); if (r) return send(r.status, r.body); }
    if (req.method === 'GET' && url === '/user') {
      const tok = rec.auth.replace(/^Bearer /, '');
      const u = w.tokens.get(tok);
      return u ? send(200, { id: u.id, email: u.email }) : send(401, { message: 'invalid JWT' });
    }
    if (req.method === 'POST' && url === '/admin/users') {
      if (rec.auth !== `Bearer ${SERVICE_KEY}`) return send(401, {});
      if (w.users.has(body.email)) return send(422, { error_code: 'email_exists' });
      const id = U(w.nextUser++);
      w.users.set(body.email, { id, password: body.password });
      w.created.push({ id, body });
      w.tokens.set(jwt(`new${id.slice(-3)}`), { id, email: body.email });
      return send(200, { id });
    }
    if (req.method === 'POST' && url === '/token') {
      const u = w.users.get(body.email);
      if (!u || u.password !== body.password) return send(400, { error: 'invalid_grant' });
      return send(200, { access_token: jwt(`new${u.id.slice(-3)}`), refresh_token: 'r' });
    }
    if (req.method === 'DELETE' && url.startsWith('/admin/users/')) { w.deleted.push(url.split('/').pop()); return send(200, {}); }
    return send(404, {});
  });
  const rest = await listen(async (req, res) => {
    const body = await readBody(req);
    const fn = req.url.split('?')[0].replace('/rpc/', '');
    const rec = { svc: 'rest', fn, auth: req.headers.authorization || '', apikey: req.headers.apikey || '', body };
    w.calls.push(rec);
    const send = (st, b) => { res.writeHead(st, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (script.rest) { const r = script.rest(rec, w); if (r) return send(r.status, r.body); }
    if (fn === 'fn_settings_actor_may_manage') return send(200, true);
    if (fn === 'fn_membership_invite_multi') {
      if (body.p_dry_run) return send(200, { ok: true, dry_run: true });
      const ids = body.p_items.map((_, i) => U(700 + i));
      return send(200, { ok: true, created: ids.length, skipped: [], request_ids: ids, target_exists: false, email_tokens: [{ company_id: body.p_items[0].company_id, token: 'RAW-INVITE-TOKEN' }] });
    }
    if (fn === 'fn_membership_invite_create') return send(200, { ok: true, request_id: U(750), token: 'RAW-INVITE-TOKEN-2' });
    if (fn === 'fn_membership_invite_respond') return send(200, { ok: true, status: 'accepted' });
    return send(404, { message: 'no such function' });
  });
  const dbScript = script.db || {};
  const deps = {
    gotrueUrl: `http://127.0.0.1:${gotrue.address().port}`,
    restUrl: `http://127.0.0.1:${rest.address().port}`,
    anonKey: ANON_KEY, serviceKey: SERVICE_KEY,
    log: (m) => w.logs.push(String(m)),
    connect: async () => ({
      query: async (sql, params) => {
        w.queries.push({ sql: String(sql), params });
        if (/FROM public\.companies WHERE id = ANY/.test(sql)) return dbScript.companies ? dbScript.companies(params) : { rowCount: params[0].length, rows: params[0].map((id) => ({ id, name: `Co ${id.slice(-3)}`, tenant_id: TENANT })) };
        if (/FROM auth\.users WHERE lower\(email\)/.test(sql)) return dbScript.existing ? dbScript.existing(params[0]) : { rowCount: 0, rows: [] };
        if (/check_plan_limits/.test(sql)) return { rows: [{ r: dbScript.plan || { allowed: true } }] };
        return { rowCount: 0, rows: [] };
      },
      end: async () => {},
    }),
  };
  w.deps = deps;
  w.closeAll = () => Promise.all([gotrue, rest].map((s) => new Promise((r) => s.close(r))));
  return w;
}

const INPUT = (over = {}) => ({ callerToken: CALLER_JWT, email: 'Newbie@Example.com', full_name: 'New Person', items: [{ company_id: CO1, role_ids: [ROLE1] }, { company_id: CO2, role_ids: [ROLE1, ROLE2] }], ...over });
const callsOf = (w, fn) => w.calls.filter((c) => c.fn === fn);

test('a NEW user: authorised as the CALLER, account created once, invitations created as the CALLER, accepted by the NEW account; the contract is exact', async () => {
  const w = await world();
  try {
    const r = await P.inviteLocalUserAsCaller(w.deps, INPUT());
    assert.equal(r.success, true, JSON.stringify(r));
    const d = r.data;
    assert.deepEqual(Object.keys(d).sort(), ['accepted', 'companies', 'created', 'email', 'is_new', 'one_time_password', 'request_ids', 'skipped', 'user_id']);
    assert.equal(d.is_new, true); assert.equal(d.email, 'newbie@example.com');
    assert.match(d.one_time_password, /^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
    assert.equal(d.created, 2); assert.equal(d.accepted, 2); assert.deepEqual(d.skipped, []);
    assert.deepEqual(d.request_ids, [U(700), U(701)]);
    assert.deepEqual(d.companies, [{ company_id: CO1, company_name: `Co ${CO1.slice(-3)}`, login_code: '00000000' }, { company_id: CO2, company_name: `Co ${CO2.slice(-3)}`, login_code: '00000000' }]);
    assert.equal(d.user_id, w.created[0].id);
    // the account: one admin create, with the one-time password the caller is handed, e-mail confirmed, tenant in the metadata
    assert.equal(w.created.length, 1);
    assert.equal(w.created[0].body.password, d.one_time_password);
    assert.equal(w.created[0].body.email_confirm, true);
    assert.equal(w.created[0].body.app_metadata.tenant_id, TENANT);
    assert.equal(w.created[0].body.user_metadata.invited_by, CALLER.id);
    // WHO each call was made as
    assert.equal(w.calls.find((c) => c.url === '/user').auth, `Bearer ${CALLER_JWT}`);
    assert.equal(w.calls.find((c) => c.url === '/user').apikey, ANON_KEY);
    for (const c of [...callsOf(w, 'fn_settings_actor_may_manage'), ...callsOf(w, 'fn_membership_invite_multi')]) { assert.equal(c.auth, `Bearer ${CALLER_JWT}`); assert.equal(c.apikey, ANON_KEY); }
    assert.deepEqual(callsOf(w, 'fn_settings_actor_may_manage').map((c) => [c.body.p_actor, c.body.p_company]), [[CALLER.id, CO1], [CALLER.id, CO2]]);
    const multi = callsOf(w, 'fn_membership_invite_multi');
    assert.deepEqual(multi.map((c) => c.body.p_dry_run), [true, false], 'a dry run first, then the real write');
    assert.match(multi[1].body.p_request_key, /^local-invite:/);
    assert.deepEqual(multi[1].body.p_items, [{ company_id: CO1, role_ids: [ROLE1] }, { company_id: CO2, role_ids: [ROLE1, ROLE2] }]);
    // the dry run happens BEFORE the account exists
    assert.ok(w.calls.indexOf(multi[0]) < w.calls.findIndex((c) => c.url === '/admin/users'));
    // acceptance: the NEW account's own token, once per request
    const resp = callsOf(w, 'fn_membership_invite_respond');
    assert.deepEqual(resp.map((c) => c.body), [{ p_request_id: U(700), p_accept: true }, { p_request_id: U(701), p_accept: true }]);
    for (const c of resp) assert.notEqual(c.auth, `Bearer ${CALLER_JWT}`);
    assert.equal(w.deleted.length, 0, 'nothing was cleaned up on success');
    // no secret in any log line
    const logs = w.logs.join('\n');
    for (const s of [d.one_time_password, CALLER_JWT, SERVICE_KEY, 'RAW-INVITE-TOKEN']) assert.ok(!logs.includes(s), `a log line leaks ${s.slice(0, 6)}…`);
    assert.ok(!JSON.stringify(r).includes('RAW-INVITE-TOKEN') && !JSON.stringify(r).includes(SERVICE_KEY), 'the raw invite token / service key never leave');
  } finally { await w.closeAll(); }
});

test('an EXISTING e-mail: no account is created or changed, no password, no sign-in, the invitation waits for the user (accepted 0), skipped passes through', async () => {
  const w = await world({
    db: { existing: () => ({ rowCount: 1, rows: [{ id: U(42) }] }), plan: { allowed: false, error: 'limit', current: 5, max: 5 } },
    rest: (rec) => (rec.fn === 'fn_membership_invite_multi' && !rec.body.p_dry_run
      ? { status: 200, body: { ok: true, created: 1, skipped: [{ company_id: CO1, reason: 'already_member_same_roles' }], request_ids: [U(700)], target_exists: true, email_tokens: [] } } : null),
  });
  try {
    const r = await P.inviteLocalUserAsCaller(w.deps, INPUT());
    assert.equal(r.success, true, JSON.stringify(r));
    assert.equal(r.data.is_new, false); assert.equal(r.data.user_id, U(42));
    assert.ok(!('one_time_password' in r.data));
    assert.equal(r.data.created, 1); assert.equal(r.data.accepted, 0);
    assert.deepEqual(r.data.skipped, [{ company_id: CO1, reason: 'already_member_same_roles' }]);
    assert.deepEqual(r.data.request_ids, [U(700)]);
    assert.equal(w.created.length, 0); assert.equal(w.calls.filter((c) => c.url && c.url.startsWith('/token')).length, 0);
    assert.equal(callsOf(w, 'fn_membership_invite_respond').length, 0);
    assert.ok(!w.queries.some((q) => /check_plan_limits/.test(q.sql)), 'the plan limit concerns a NEW account only - an existing user does not count against it');
  } finally { await w.closeAll(); }
});

test('refusals the SERVER gives are mapped: not allowed / cross tenant / role not grantable / bad request / company not found, and nothing is created', async () => {
  const cases = [
    [{ code: 'P0001', message: 'not_allowed', details: CO2 }, 'NOT_ALLOWED', 'not_allowed', 403],
    [{ code: 'P0001', message: 'cross_tenant', details: CO1 }, 'NOT_ALLOWED', 'cross_tenant', 403],
    [{ code: 'P0001', message: 'role_not_grantable', details: `role ${ROLE1} company ${CO1}` }, 'ROLE_NOT_GRANTABLE', 'role_not_grantable', 403],
    [{ code: 'P0001', message: 'bad_request', details: 'items' }, 'BAD_REQUEST', 'bad_request', 400],
    [{ code: 'P0001', message: 'company_not_found', details: CO1 }, 'BAD_REQUEST', 'company_not_found', 400],
  ];
  for (const [pg, code, reason, status] of cases) {
    const w = await world({ rest: (rec) => (rec.fn === 'fn_membership_invite_multi' ? { status: 400, body: pg } : null) });
    try {
      const r = await P.inviteLocalUserAsCaller(w.deps, INPUT());
      assert.deepEqual([r.success, r.code, r.reason], [false, code, reason], JSON.stringify(r));
      assert.equal(R.statusFor(r), status);
      assert.equal(w.created.length, 0, 'no account was created for a refused invitation');
      assert.equal(callsOf(w, 'fn_membership_invite_multi').length, 1, 'refused at the dry run: the real write never ran');
      assert.ok(!JSON.stringify(R.publicFailure(r)).includes('details'), 'only the documented fields are public');
    } finally { await w.closeAll(); }
  }
});

test('NOT_ALLOWED when fn_settings_actor_may_manage says no for a company (before the multi function is even asked)', async () => {
  const w = await world({ rest: (rec) => (rec.fn === 'fn_settings_actor_may_manage' && rec.body.p_company === CO2 ? { status: 200, body: false } : null) });
  try {
    const r = await P.inviteLocalUserAsCaller(w.deps, INPUT());
    assert.deepEqual([r.success, r.code, r.company_id], [false, 'NOT_ALLOWED', CO2]);
    assert.equal(callsOf(w, 'fn_membership_invite_multi').length, 0);
    assert.equal(w.created.length, 0);
  } finally { await w.closeAll(); }
});

test('AUTH_REQUIRED: a missing, malformed, unknown or expired token is refused by GoTrue/the shape check; SERVICES_DOWN when GoTrue is unreachable', async () => {
  const w = await world();
  try {
    for (const tok of [undefined, '', 'not-a-jwt', jwt('unknown'), `${CALLER_JWT}\n`.slice(0, -1) + 'x']) {
      const r = await P.inviteLocalUserAsCaller(w.deps, INPUT({ callerToken: tok }));
      assert.deepEqual([r.success, r.code], [false, 'AUTH_REQUIRED'], String(tok));
    }
    assert.equal(w.created.length, 0);
    assert.equal(w.calls.filter((c) => c.svc === 'rest').length, 0, 'no database call without a valid session');
    const down = await P.inviteLocalUserAsCaller({ ...w.deps, gotrueUrl: 'http://127.0.0.1:1' }, INPUT());
    assert.deepEqual([down.success, down.code], [false, 'SERVICES_DOWN']);
    // the token expires between the sign-in check and the database (PostgREST says JWT expired)
    const w2 = await world({ rest: (rec) => (rec.fn === 'fn_settings_actor_may_manage' ? { status: 401, body: { code: 'PGRST301', message: 'JWT expired' } } : null) });
    try {
      const r2 = await P.inviteLocalUserAsCaller(w2.deps, INPUT());
      assert.deepEqual([r2.success, r2.code], [false, 'AUTH_REQUIRED']);
    } finally { await w2.closeAll(); }
  } finally { await w.closeAll(); }
});

test('BAD_REQUEST: every malformed body is refused before anything is called', async () => {
  const w = await world();
  try {
    const bads = [
      INPUT({ email: 'nope' }), INPUT({ full_name: '  ' }), INPUT({ items: [] }), INPUT({ items: 'x' }),
      INPUT({ items: [{ company_id: 'x', role_ids: [ROLE1] }] }), INPUT({ items: [{ company_id: CO1, role_ids: [] }] }), INPUT({ items: [{ company_id: CO1, role_ids: ["x'; drop"] }] }),
      INPUT({ items: [{ company_id: CO1, role_ids: [ROLE1] }, { company_id: CO1, role_ids: [ROLE2] }] }), INPUT({ phone: '<script>' }), INPUT({ employee_id: 'x' }),
      INPUT({ employee_id: U(5) }), INPUT({ items: Array.from({ length: 21 }, (_, i) => ({ company_id: U(300 + i), role_ids: [ROLE1] })) }),
    ];
    for (const b of bads) { const r = await P.inviteLocalUserAsCaller(w.deps, b); assert.deepEqual([r.success, r.code], [false, 'BAD_REQUEST'], JSON.stringify(b).slice(0, 80)); }
    assert.equal(w.calls.length, 0);
  } finally { await w.closeAll(); }
});

test('PLAN_LIMIT_EXCEEDED: a NEW account over the plan is refused (with current/max) before any account is created; a plan without a subscription does not block', async () => {
  const w = await world({ db: { plan: { allowed: false, error: 'limit_reached', current: 5, max: 5, plan_code: 'free' } } });
  try {
    const r = await P.inviteLocalUserAsCaller(w.deps, INPUT());
    assert.deepEqual([r.success, r.code, r.current, r.max], [false, 'PLAN_LIMIT_EXCEEDED', 5, 5]);
    assert.equal(R.statusFor(r), 403);
    assert.equal(w.created.length, 0);
    assert.equal(callsOf(w, 'fn_membership_invite_multi').length, 1, 'only the dry run ran');
  } finally { await w.closeAll(); }
  const ok = await world({ db: { plan: { allowed: false, error: 'no_active_subscription' } } });
  try { assert.equal((await P.inviteLocalUserAsCaller(ok.deps, INPUT())).success, true); } finally { await ok.closeAll(); }
  // the free plan's database trigger answers inside GoTrue: still PLAN_LIMIT_EXCEEDED, nothing left behind
  const trig = await world({ gotrue: (rec) => (rec.url === '/admin/users' ? { status: 500, body: { msg: 'Database error creating new user' } } : null) });
  try {
    const r = await P.inviteLocalUserAsCaller(trig.deps, INPUT());
    assert.equal(r.code, 'PLAN_LIMIT_EXCEEDED');
    assert.equal(trig.deleted.length, 0);
  } finally { await trig.closeAll(); }
});

test('CLEANUP: a failure after the account was created removes exactly what THIS call created - the requests it was handed and the user it created, by id', async () => {
  const w = await world({ rest: (rec) => (rec.fn === 'fn_membership_invite_respond' && rec.body.p_request_id === U(701) ? { status: 200, body: { ok: false, reason: 'grant_refused' } } : null) });
  try {
    const r = await P.inviteLocalUserAsCaller(w.deps, INPUT());
    assert.equal(r.success, false);
    assert.equal(r.code, 'INVITE_FAILED'); assert.equal(r.reason, 'INVITE_NOT_APPLIED');
    assert.equal(R.statusFor(r), 500);
    const newId = w.created[0].id;
    assert.deepEqual(w.deleted, [newId], 'the GoTrue account of this call (by id) is deleted');
    const cancel = w.queries.find((q) => /UPDATE public\.company_membership_requests SET status = 'cancelled'/.test(q.sql));
    assert.ok(cancel && JSON.stringify(cancel.params) === JSON.stringify([[U(700), U(701)]]), 'the pending requests it created, by id');
    const rowDeletes = w.queries.filter((q) => /^DELETE FROM public\./.test(q.sql));
    assert.ok(rowDeletes.length >= 5 && rowDeletes.every((q) => JSON.stringify(q.params) === JSON.stringify([newId])), 'tenant rows are removed by the user id this call created');
    assert.ok(!w.queries.some((q) => /email/i.test(q.sql) && /DELETE|UPDATE/.test(q.sql)), 'nothing is looked up or removed by e-mail');
    assert.ok(!r.one_time_password && !JSON.stringify(r).includes(w.created[0].body.password), 'a failure never reveals the password');
    assert.ok(!w.logs.join('\n').includes(w.created[0].body.password));
  } finally { await w.closeAll(); }
  // the real write is refused AFTER the account exists (e.g. the inviter lost authority in between): the account goes
  const w2 = await world({ rest: (rec) => (rec.fn === 'fn_membership_invite_multi' && !rec.body.p_dry_run ? { status: 400, body: { code: 'P0001', message: 'not_allowed', details: CO1 } } : null) });
  try {
    const r = await P.inviteLocalUserAsCaller(w2.deps, INPUT());
    assert.deepEqual([r.success, r.code], [false, 'NOT_ALLOWED']);
    assert.deepEqual(w2.deleted, [w2.created[0].id]);
  } finally { await w2.closeAll(); }
});

test('an existing user whose invitation is refused leaves nothing to clean (and nothing is deleted)', async () => {
  const w = await world({
    db: { existing: () => ({ rowCount: 1, rows: [{ id: U(42) }] }) },
    rest: (rec) => (rec.fn === 'fn_membership_invite_multi' && !rec.body.p_dry_run ? { status: 400, body: { code: 'P0001', message: 'foreign_tenant_account' } } : null),
  });
  try {
    const r = await P.inviteLocalUserAsCaller(w.deps, INPUT());
    assert.deepEqual([r.success, r.code, r.reason], [false, 'INVITE_FAILED', 'foreign_tenant_account']);
    assert.equal(R.statusFor(r), 409);
    assert.deepEqual(w.deleted, []);
    assert.ok(!w.queries.some((q) => /^DELETE|^UPDATE/.test(q.sql)));
  } finally { await w.closeAll(); }
});

test('one company with an employee record goes through the single-company function (payload carries employee_id); several companies + employee_id is refused', async () => {
  const w = await world();
  try {
    const r = await P.inviteLocalUserAsCaller(w.deps, INPUT({ items: [{ company_id: CO1, role_ids: [ROLE1] }], employee_id: U(5), phone: '+963 942 337 038' }));
    assert.equal(r.success, true, JSON.stringify(r));
    const c = callsOf(w, 'fn_membership_invite_create')[0];
    assert.equal(c.auth, `Bearer ${CALLER_JWT}`);
    assert.deepEqual(c.body, { p_company_id: CO1, p_email: 'newbie@example.com', p_role_ids: [ROLE1], p_note: null, p_payload: { full_name: 'New Person', employee_id: U(5) } });
    assert.deepEqual([r.data.created, r.data.accepted, r.data.request_ids], [1, 1, [U(750)]]);
    assert.equal(w.created[0].body.user_metadata.phone, '+963 942 337 038');
  } finally { await w.closeAll(); }
});

// ─── the HTTP route ───────────────────────────────────────────

function fakeReq({ method = 'POST', url = R.ROUTE, headers = {}, body, peer = '192.168.1.20' }) {
  const req = new EventEmitter();
  Object.assign(req, { method, url, headers: { host: 'hama.texacore.ai', 'content-type': 'application/json', authorization: `Bearer ${CALLER_JWT}`, ...headers }, socket: { remoteAddress: peer }, destroy() { req.destroyed = true; } });
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}
function fakeRes() {
  return { status: 0, headers: {}, raw: '', writeHead(s, h) { this.status = s; this.headers = h || {}; }, end(b) { this.raw = b || ''; }, get json() { return this.raw ? JSON.parse(this.raw) : null; } };
}
function routes(over = {}) {
  const clock = { t: 1_000_000 };
  const invites = [];
  const logs = [];
  const r = R.createLocalInviteRoutes({
    getDeps: () => ({ fake: true }),
    authenticate: async (_d, tok) => (tok === CALLER_JWT ? { ok: true, id: CALLER.id, email: CALLER.email } : { ok: false, code: 'AUTH_REQUIRED', error: 'sign in first' }),
    invite: async (_d, input) => { invites.push(input); return { success: true, data: { user_id: U(9), email: input.email, is_new: true, one_time_password: 'ABCD-EFGH-JKMN', created: 1, skipped: [], request_ids: [U(700)], accepted: 1, companies: [] } }; },
    now: () => clock.t, log: (m) => logs.push(m), ...over,
  });
  const call = async (opts) => { const res = fakeRes(); const handled = await r.handle(fakeReq(opts), res); return { handled, res }; };
  return { r, call, clock, invites, logs };
}
const BODY = { email: 'a@b.co', full_name: 'A', items: [{ company_id: CO1, role_ids: [ROLE1] }] };

test('route: success is 200 { success, data } - no-store, and NO CORS header of any kind', async () => {
  const s = routes();
  const { handled, res } = await s.call({ body: BODY });
  assert.equal(handled, true); assert.equal(res.status, 200);
  assert.equal(res.json.success, true); assert.equal(res.json.data.one_time_password, 'ABCD-EFGH-JKMN');
  assert.match(res.headers['Cache-Control'], /no-store/);
  assert.deepEqual(Object.keys(res.headers).filter((h) => /^access-control/i.test(h)), []);
  assert.equal(s.invites[0].callerToken, CALLER_JWT);
  assert.equal(s.invites[0].caller.id, CALLER.id, 'the already-checked caller is handed over (no second GoTrue round trip)');
});

test('route: cross-site is refused (Sec-Fetch-Site / Origin) before anything else; same-origin browsers and header-less clients pass', async () => {
  const s = routes();
  for (const h of [{ 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { origin: 'https://evil.example' }, { origin: 'null' }]) {
    const { res } = await s.call({ headers: h, body: BODY });
    assert.deepEqual([res.status, res.json.code], [403, 'CROSS_ORIGIN'], JSON.stringify(h));
  }
  assert.equal(s.invites.length, 0);
  for (const h of [{ 'sec-fetch-site': 'same-origin', origin: 'http://localhost:9' }, { origin: 'https://hama.texacore.ai' }, {}]) assert.equal((await s.call({ headers: h, body: BODY })).res.status, 200, JSON.stringify(h));
});

test('route: JSON only (415), body capped at 16 KB (413), bad JSON (400), method and path, bearer required (401)', async () => {
  const s = routes();
  assert.equal((await s.call({ headers: { 'content-type': 'text/plain' }, body: 'x' })).res.status, 415);
  assert.equal((await s.call({ headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a=b' })).res.status, 415);
  const big = await s.call({ body: JSON.stringify({ ...BODY, note: 'x'.repeat(20000) }) });
  assert.deepEqual([big.res.status, big.res.json.code, big.res.json.reason], [413, 'BAD_REQUEST', 'too_large']);
  assert.equal((await s.call({ body: '{not json' })).res.status, 400);
  assert.equal((await s.call({ body: '[1,2]' })).res.status, 400);
  const get = await s.call({ method: 'GET' });
  assert.equal(get.res.status, 405); assert.equal(get.res.headers.Allow, 'POST');
  assert.equal((await s.call({ url: '/local-api/other', body: BODY })).res.status, 404);
  assert.equal((await s.call({ headers: { authorization: '' }, body: BODY })).res.status, 401);
  assert.equal((await s.call({ headers: { authorization: 'Basic abc' }, body: BODY })).res.status, 401);
  assert.equal((await s.call({ headers: { authorization: `Bearer ${jwt('other')}` }, body: BODY })).res.json.code, 'AUTH_REQUIRED');
  assert.equal(s.invites.length, 0, 'none of these reached the invite code');
  for (const url of ['/api/companies', '/portal-api/login', '/', '/local-apix/invite-user']) assert.equal(await s.r.handle(fakeReq({ url }), fakeRes()), false, url);
});

test('route: the caller is limited to 10 invitations / 10 minutes (429 + retry_after_sec + Retry-After), counted per signed-in user, and the window slides', async () => {
  const s = routes();
  for (let i = 0; i < 10; i++) {
    // different peers: only the user's own budget is under test
    assert.equal((await s.call({ body: BODY, peer: `10.0.0.${i + 1}` })).res.status, 200, `invite ${i + 1}`);
    s.clock.t += 1000;
  }
  const over = await s.call({ body: BODY, peer: '10.0.0.99' });
  assert.equal(over.res.status, 429);
  assert.equal(over.res.json.code, 'RATE_LIMITED');
  assert.ok(over.res.json.retry_after_sec >= 1 && over.res.json.retry_after_sec <= 600);
  assert.equal(over.res.headers['Retry-After'], String(over.res.json.retry_after_sec));
  assert.equal(s.invites.length, 10);
  s.clock.t += 10 * 60 * 1000;
  assert.equal((await s.call({ body: BODY, peer: '10.0.0.99' })).res.status, 200, 'the window slid');
});

test('route: a burst from one address is limited too - also for bad tokens - and a refused hit is not counted twice', async () => {
  const s = routes();
  let last;
  for (let i = 0; i < 20; i++) last = await s.call({ headers: { authorization: `Bearer ${jwt('bad')}` }, body: BODY, peer: '203.0.113.5' });
  assert.equal(last.res.status, 401);
  const over = await s.call({ headers: { authorization: `Bearer ${jwt('bad')}` }, body: BODY, peer: '203.0.113.5' });
  assert.equal(over.res.status, 429);
  assert.equal(over.res.json.code, 'RATE_LIMITED');
  assert.equal((await s.call({ body: BODY, peer: '203.0.113.6' })).res.status, 200, 'another address is unaffected');
  s.clock.t += 61 * 1000;
  assert.equal((await s.call({ headers: { authorization: `Bearer ${jwt('bad')}` }, body: BODY, peer: '203.0.113.5' })).res.status, 401, 'after the window the address may try again');
  // behind the tunnel the peer is local: the address the tunnel reports is the key
  assert.equal(R.clientAddress({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'cf-connecting-ip': '198.51.100.7' } }), 'cf:198.51.100.7');
  assert.equal(R.clientAddress({ socket: { remoteAddress: '192.168.1.5' }, headers: { 'cf-connecting-ip': '198.51.100.7' } }), '192.168.1.5', 'a LAN peer cannot choose its own key');
});

test('route: services down is 503; each failure code has its HTTP status; only the documented fields leave', async () => {
  const down = routes({ getDeps: () => null });
  assert.deepEqual([(await down.call({ body: BODY })).res.status, (await down.call({ body: BODY })).res.json.code], [503, 'SERVICES_DOWN']);
  const thrown = routes({ getDeps: () => { throw new Error('boom'); } });
  assert.equal((await thrown.call({ body: BODY })).res.status, 503);
  const expect = { BAD_REQUEST: 400, AUTH_REQUIRED: 401, NOT_ALLOWED: 403, ROLE_NOT_GRANTABLE: 403, CROSS_ORIGIN: 403, PLAN_LIMIT_EXCEEDED: 403, RATE_LIMITED: 429, SERVICES_DOWN: 503, INVITE_FAILED: 500 };
  for (const [code, status] of Object.entries(expect)) assert.equal(R.statusFor({ code }), status, code);
  const leak = routes({ invite: async () => ({ success: false, code: 'PLAN_LIMIT_EXCEEDED', error: 'x', current: 5, max: 5, secret: 'SHOULD-NOT-LEAK', stack: 'at …' }) });
  const r = await leak.call({ body: BODY });
  assert.deepEqual(Object.keys(r.res.json).sort(), ['code', 'current', 'error', 'max', 'success']);
  const boom = routes({ invite: async () => { throw new Error('password=hunter2 in a driver message'); } });
  const b = await boom.call({ body: BODY });
  assert.equal(b.res.status, 500); assert.ok(!b.res.raw.includes('hunter2')); assert.ok(!boom.logs.join('\n').includes('hunter2'));
});

test('end to end through Express (the way service-manager mounts it): the real route + real provisioning code against the fake GoTrue/PostgREST', async () => {
  const w = await world();
  const routesE = R.createLocalInviteRoutes({
    getDeps: () => w.deps, invite: (d, i) => P.inviteLocalUserAsCaller(d, i), authenticate: (d, t) => P.authenticateCaller(d, t), log: (m) => w.logs.push(m),
  });
  const app = express();
  app.all('/local-api/*', (req, res, next) => { routesE.handle(req, res).then((done) => { if (!done) next(); }, next); });
  app.all('/api/*', (req, res) => res.status(403).json({ error: 'local-only' }));
  const server = await new Promise((resolve) => { const sv = app.listen(0, '127.0.0.1', () => resolve(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bad = await fetch(`${base}/local-api/invite-user`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt('nobody')}` }, body: JSON.stringify(INPUT()) });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${base}/local-api/invite-user`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CALLER_JWT}` }, body: JSON.stringify(BODY) });
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.equal(j.success, true); assert.equal(j.data.is_new, true); assert.equal(j.data.accepted, 1);
    assert.equal(j.data.one_time_password, w.created[0].body.password);
    assert.equal([...ok.headers.keys()].filter((h) => /^access-control/i.test(h)).length, 0);
    const text = JSON.stringify(j);
    for (const s of [SERVICE_KEY, ANON_KEY, 'RAW-INVITE-TOKEN']) assert.ok(!text.includes(s));
    const noJson = await fetch(`${base}/local-api/invite-user`, { method: 'POST', headers: { Authorization: `Bearer ${CALLER_JWT}` }, body: 'x' });
    assert.equal(noJson.status, 415);
    assert.equal((await fetch(`${base}/api/companies`)).status, 403, '/api/* is still refused');
  } finally { await new Promise((r) => server.close(r)); await w.closeAll(); }
});

test('wiring: /local-api is mounted BEFORE /api/* and /portal-api stays; no admin secret or CORS in the route; secrets and the password are never logged or interpolated', () => {
  const sm = SRC('service-manager.js');
  assert.ok(sm.indexOf("app.all('/local-api/*'") > 0 && sm.indexOf("app.all('/local-api/*'") < sm.indexOf("app.all('/api/*'"));
  assert.ok(sm.indexOf("app.all('/portal-api/*'") > 0 && sm.indexOf("app.all('/portal-api/*'") < sm.indexOf("app.all('/local-api/*'"));
  assert.match(sm, /REMOTE_API_ALLOW = new Set\(\['\/api\/ping'\]\)/);
  const code = (f) => SRC(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const route = code('local-invite-route.js');
  assert.doesNotMatch(route, /Access-Control-Allow|applyCors|corsHeaders/i);
  assert.doesNotMatch(route, /localApiSecret|x-texacore-local-secret|serviceKey|ADMIN_SECRET|adminSecret/i);
  for (const line of route.split('\n').filter((l) => /\blog\(/.test(l))) assert.doesNotMatch(line, /token|password|authorization/i, `a log line mentions a secret: ${line.trim()}`);
  const prov = SRC('provisioning.js');
  const body = prov.slice(prov.indexOf('async function inviteLocalUserAsCaller'), prov.indexOf('module.exports'));
  for (const m of body.matchAll(/log\(([^;]*)\);/g)) assert.doesNotMatch(m[1], /password|otp|token|callerToken|serviceKey/i, `a log line mentions a secret: ${m[0]}`);
  assert.doesNotMatch(body, /gotrueSessionFor|ownerToken/, 'the invitation is never made with the tenant owner\'s session');
  assert.match(body, /rpcAs\(callerToken, 'fn_membership_invite_multi'/);
  assert.match(SRC('main.js'), /svcManager\.getProvisioningDeps = \(\) => provisioningDeps\(\)/);
});
