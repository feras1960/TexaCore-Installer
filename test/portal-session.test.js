'use strict';
// The admin-portal session: an anonymous visitor (tunnel or office network) never gets the company list; a manager who entered the portal password does;
// an expired, forged, revoked or cleared session does not. LAN / tunnel behaviour of /api/* is untouched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');
const express = require('express');
const P = require('../src/portal-session');

const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
// the code without its comments (a comment may name /api/ or a password; code must not use them)
const CODE = (f) => SRC(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
const COMPANIES = [
  { id: '17249eed-1c2a-4b7e-9d0a-6f3b2c1d4e5f', name: '2023 مطور بعد الصيانة', tenant_id: 'SECRET-TENANT', owner_email: 'owner@example.com' },
  { id: 'a91c03de-1c2a-4b7e-9d0a-6f3b2c1d4e5f', name: 'بروفة العرض', tenant_id: 'SECRET-TENANT-2' },
];

function fakeReq({ method = 'GET', url, headers = {}, body }) {
  const req = new EventEmitter();
  Object.assign(req, { method, url, headers: { host: 'hama.texacore.ai', ...headers }, socket: {}, destroy() { req.destroyed = true; } });
  setImmediate(() => {
    if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    req.emit('end');
  });
  return req;
}
function fakeRes() {
  return { status: 0, headers: {}, raw: '', writeHead(s, h) { this.status = s; this.headers = h || {}; }, end(b) { this.raw = b || ''; }, get json() { return this.raw ? JSON.parse(this.raw) : null; } };
}
function setup({ password = 'correct horse', clock = { t: 1_000_000 }, listCalls = [] } = {}) {
  const sessions = P.createPortalSessions({ now: () => clock.t });
  const checks = [];
  const routes = P.createPortalRoutes({
    sessions,
    verifyPassword: async (pw) => { checks.push(pw); return pw === password; },
    listCompanies: async () => { listCalls.push(1); return COMPANIES; },
    log: () => {},
  });
  const call = async (opts) => { const req = fakeReq(opts); const res = fakeRes(); const handled = await routes.handle(req, res); return { handled, res }; };
  const login = async (pw = password, headers = {}) => call({ method: 'POST', url: '/portal-api/login', headers: { 'content-type': 'application/json', ...headers }, body: { password: pw } });
  const cookieOf = (res) => /tx_portal=([^;]*)/.exec(String(res.headers['Set-Cookie'] || ''))?.[1] || '';
  return { sessions, routes, call, login, cookieOf, clock, checks, listCalls };
}

test('an ANONYMOUS visitor (tunnel or office network) gets no list: 401, and the list is never even read', async () => {
  const s = setup();
  const r = await s.call({ url: '/portal-api/companies' });
  assert.equal(r.handled, true);
  assert.equal(r.res.status, 401);
  assert.equal(r.res.json.code, 'PORTAL_AUTH_REQUIRED');
  assert.equal(r.res.json.companies, undefined);
  assert.equal(s.listCalls.length, 0, 'the database was not asked');
  assert.doesNotMatch(r.res.raw, /الصيانة|بروفة|17249eed/);
});

test('a wrong password opens nothing: 401, no cookie, no list afterwards', async () => {
  const s = setup();
  const bad = await s.login('wrong password');
  assert.equal(bad.res.status, 401);
  assert.equal(bad.res.json.code, 'BAD_PASSWORD');
  assert.equal(bad.res.headers['Set-Cookie'], undefined);
  assert.equal(s.sessions.size(), 0);
  const r = await s.call({ url: '/portal-api/companies', headers: { cookie: 'tx_portal=' } });
  assert.equal(r.res.status, 401);
});

test('the right password opens a session: an HttpOnly, SameSite=Strict cookie scoped to /portal-api (Secure over https), and ONLY then the list - id + name, nothing else', async () => {
  const s = setup();
  const ok = await s.login();
  assert.equal(ok.res.status, 200);
  assert.equal(ok.res.json.success, true);
  assert.equal(ok.res.json.expiresInSec, 1800);
  const cookie = String(ok.res.headers['Set-Cookie']);
  assert.match(cookie, /^tx_portal=[A-Za-z0-9_-]{20,}; Path=\/portal-api; HttpOnly; SameSite=Strict; Max-Age=1800$/);
  assert.doesNotMatch(cookie, /Secure/, 'plain http on the office network: no Secure flag');
  const https = await s.login(undefined, { 'x-forwarded-proto': 'https' });
  assert.match(String(https.res.headers['Set-Cookie']), /; Secure$/);
  const token = s.cookieOf(ok.res);
  const list = await s.call({ url: '/portal-api/companies', headers: { cookie: `other=1; tx_portal=${token}` } });
  assert.equal(list.res.status, 200);
  assert.deepEqual(list.res.json.companies, [{ id: COMPANIES[0].id, name: COMPANIES[0].name }, { id: COMPANIES[1].id, name: COMPANIES[1].name }]);
  assert.doesNotMatch(list.res.raw, /SECRET-TENANT|owner@example/);
  assert.equal(list.res.headers['Cache-Control'], 'no-store');
  assert.equal(list.res.headers['Access-Control-Allow-Origin'], undefined, 'no CORS header is ever sent');
});

test('an EXPIRED session gets no list (30 minutes), and a FORGED, truncated or foreign token never does', async () => {
  const s = setup();
  const token = s.cookieOf((await s.login()).res);
  assert.equal((await s.call({ url: '/portal-api/companies', headers: { cookie: `tx_portal=${token}` } })).res.status, 200);
  s.clock.t += 29 * 60 * 1000;
  assert.equal((await s.call({ url: '/portal-api/companies', headers: { cookie: `tx_portal=${token}` } })).res.status, 200);
  s.clock.t += 2 * 60 * 1000;                                              // 31 minutes after the login
  const late = await s.call({ url: '/portal-api/companies', headers: { cookie: `tx_portal=${token}` } });
  assert.equal(late.res.status, 401);
  assert.equal(s.sessions.size(), 0, 'the expired session is dropped');
  for (const forged of ['', 'abc', 'x'.repeat(43), token.slice(0, -2) + 'AA', token + 'A', 'tx_portal', '../../etc', 'null', '{}']) {
    const r = await s.call({ url: '/portal-api/companies', headers: { cookie: `tx_portal=${forged}` } });
    assert.equal(r.res.status, 401, `forged: ${forged}`);
  }
  // a token minted by ANOTHER install (another process) is just random bytes here
  const other = setup();
  const foreign = other.cookieOf((await other.login()).res);
  assert.equal((await s.call({ url: '/portal-api/companies', headers: { cookie: `tx_portal=${foreign}` } })).res.status, 401);
  assert.equal(s.listCalls.length, 2, 'only the two valid reads reached the database');
});

test('logout, a password change (sessions cleared) and the session cap all end access', async () => {
  const s = setup();
  const a = s.cookieOf((await s.login()).res);
  const b = s.cookieOf((await s.login()).res);
  const out = await s.call({ method: 'POST', url: '/portal-api/logout', headers: { cookie: `tx_portal=${a}` } });
  assert.equal(out.res.status, 200);
  assert.match(String(out.res.headers['Set-Cookie']), /Max-Age=0/);
  assert.equal((await s.call({ url: '/portal-api/companies', headers: { cookie: `tx_portal=${a}` } })).res.status, 401);
  assert.equal((await s.call({ url: '/portal-api/companies', headers: { cookie: `tx_portal=${b}` } })).res.status, 200, 'logout ends only that session');
  s.sessions.clear();                                                        // what ServiceManager.setAdminPassword / syncAdminPassword do
  assert.equal((await s.call({ url: '/portal-api/companies', headers: { cookie: `tx_portal=${b}` } })).res.status, 401);
  const capped = P.createPortalSessions({ now: () => 1, max: 3 });
  const tokens = [1, 2, 3, 4, 5].map(() => capped.create().token);
  assert.equal(capped.size(), 3);
  assert.equal(capped.isValid(tokens[0]), false, 'the oldest goes first');
  assert.equal(capped.isValid(tokens[4]), true);
});

test('a cross-site request is refused (Sec-Fetch-Site / Origin), a login must be JSON, the body is capped, nothing is read from a bad body', async () => {
  const s = setup();
  const cross = await s.call({ method: 'POST', url: '/portal-api/login', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: { password: 'correct horse' } });
  assert.equal(cross.res.status, 403);
  const sameSite = await s.call({ method: 'POST', url: '/portal-api/login', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-site' }, body: { password: 'correct horse' } });
  assert.equal(sameSite.res.status, 403, 'another subdomain is same-SITE, not same-origin');
  const browserSame = await s.login(undefined, { 'sec-fetch-site': 'same-origin', origin: 'http://localhost:9' });
  assert.equal(browserSame.res.status, 200, 'a browser that says same-origin is believed (the Host header may be rewritten by a proxy)');
  const foreignOrigin = await s.call({ method: 'POST', url: '/portal-api/login', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: { password: 'correct horse' } });
  assert.equal(foreignOrigin.res.status, 403);
  const nullOrigin = await s.call({ method: 'POST', url: '/portal-api/login', headers: { 'content-type': 'application/json', origin: 'null' }, body: { password: 'correct horse' } });
  assert.equal(nullOrigin.res.status, 403);
  const sameOrigin = await s.login(undefined, { origin: 'https://hama.texacore.ai' });
  assert.equal(sameOrigin.res.status, 200);
  const form = await s.call({ method: 'POST', url: '/portal-api/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=correct%20horse' });
  assert.equal(form.res.status, 415);
  const big = await s.call({ method: 'POST', url: '/portal-api/login', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'x'.repeat(5000) }) });
  assert.equal(big.res.status, 413);
  const junk = await s.call({ method: 'POST', url: '/portal-api/login', headers: { 'content-type': 'application/json' }, body: '{not json' });
  assert.equal(junk.res.status, 400);
  const nonString = await s.call({ method: 'POST', url: '/portal-api/login', headers: { 'content-type': 'application/json' }, body: { password: { $ne: '' } } });
  assert.equal(nonString.res.status, 401);
  assert.equal(s.checks.filter((c) => typeof c !== 'string').length, 0, 'only strings ever reach the database check');
  assert.equal(s.checks.length, 2, 'the refused requests never reached the database check (only the two valid same-origin logins did)');
});

test('the database being unavailable is a 503, never a session; other paths are not this handler\'s business', async () => {
  const sessions = P.createPortalSessions();
  const routes = P.createPortalRoutes({ sessions, verifyPassword: async () => { throw new Error('connection refused'); }, listCompanies: async () => COMPANIES, log: () => {} });
  const res = fakeRes();
  await routes.handle(fakeReq({ method: 'POST', url: '/portal-api/login', headers: { 'content-type': 'application/json' }, body: { password: 'x' } }), res);
  assert.equal(res.status, 503);
  assert.equal(sessions.size(), 0);
  for (const url of ['/api/companies', '/config.js', '/', '/portal-apix/login']) assert.equal(await routes.handle(fakeReq({ url }), fakeRes()), false, url);
  const nf = fakeRes();
  await routes.handle(fakeReq({ method: 'GET', url: '/portal-api/anything' }), nf);
  assert.equal(nf.status, 404);
});

test('end to end through Express (the way service-manager mounts it): anonymous 401, login, cookie round trip, list, logout, then 401 again', async () => {
  const sessions = P.createPortalSessions();
  const routes = P.createPortalRoutes({ sessions, verifyPassword: async (pw) => pw === 'portal-pass-1', listCompanies: async () => COMPANIES, log: () => {} });
  const app = express();
  app.all('/portal-api/*', (req, res, next) => { routes.handle(req, res).then((done) => { if (!done) next(); }, next); });
  app.all('/api/*', (req, res) => res.status(403).json({ error: 'local-only' }));    // stands for the unchanged /api/* guard
  const server = await new Promise((resolve) => { const sv = app.listen(0, '127.0.0.1', () => resolve(sv)); });   // an ephemeral port: never one of the app's
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const anon = await fetch(`${base}/portal-api/companies`);
    assert.equal(anon.status, 401);
    assert.equal((await fetch(`${base}/api/companies`)).status, 403, '/api/* is still refused');
    const bad = await fetch(`${base}/portal-api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'nope' }) });
    assert.equal(bad.status, 401);
    const good = await fetch(`${base}/portal-api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'portal-pass-1' }) });
    assert.equal(good.status, 200);
    const cookie = good.headers.get('set-cookie').split(';')[0];
    const list = await fetch(`${base}/portal-api/companies`, { headers: { Cookie: cookie } });
    assert.equal(list.status, 200);
    assert.equal((await list.json()).companies.length, 2);
    const out = await fetch(`${base}/portal-api/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal(out.status, 200);
    assert.equal((await fetch(`${base}/portal-api/companies`, { headers: { Cookie: cookie } })).status, 401);
  } finally { await new Promise((r) => server.close(r)); }
});

test('wiring: /portal-api is mounted BEFORE /api/*; /api/* and REMOTE_API_ALLOW are unchanged; a password change / restore clears the sessions; no password or token is logged; net-guard is not relaxed', () => {
  const sm = SRC('service-manager.js');
  assert.ok(sm.indexOf("app.all('/portal-api/*'") > 0 && sm.indexOf("app.all('/portal-api/*'") < sm.indexOf("app.all('/api/*'"));
  assert.match(sm, /REMOTE_API_ALLOW = new Set\(\['\/api\/ping'\]\)/);
  assert.match(sm, /!netGuard\.isLocalRequest\(req\) && !REMOTE_API_ALLOW\.has\(urlPath\)/);
  const set = sm.slice(sm.indexOf('async setAdminPassword('), sm.indexOf('async syncAdminPassword('));
  assert.match(set, /this\.portalSessions\.clear\(\)/);
  const sync = sm.slice(sm.indexOf('async syncAdminPassword('), sm.indexOf('// ─── Utility: Simple HTTP request'));
  assert.match(sync, /this\.portalSessions\.clear\(\)/);
  assert.match(sm, /client\.query\('SELECT public\.verify_admin_password\(\$1\) AS ok', \[pw\]\)/, 'the password is a bound parameter');
  const portal = CODE('portal-session.js');
  assert.doesNotMatch(portal, /net-guard|isLocalRequest|isLoopback/, 'the portal neither consults nor relaxes the loopback rules');
  assert.doesNotMatch(portal, /Access-Control-Allow/i);
  for (const line of portal.split('\n').filter((l) => /\blog\(/.test(l))) assert.doesNotMatch(line, /\$\{[^}]*(password|token|cookie)/i, `a log line interpolates the password or a token: ${line.trim()}`);
  const main = SRC('main.js');
  assert.match(main, /req\.method === 'GET' && req\.url === '\/api\/companies'/);   // the local list is as before (secret + loopback)
});

test('what the portal session does NOT open: only the three portal routes exist - no admin API, no secret, no company data', () => {
  const portal = CODE('portal-session.js');
  const routes = [...portal.matchAll(/path === '(\/portal-api\/[a-z]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(routes, ['/portal-api/companies', '/portal-api/login', '/portal-api/logout']);
  assert.doesNotMatch(portal, /localApiSecret|x-texacore-local-secret|\/api\//);
});
