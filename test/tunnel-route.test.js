'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const R = require('../src/tunnel-route');

const BOOT = 'abcd1234abcd1234';
const CF_1033 = '<!DOCTYPE html><html><head><title>Cloudflare Tunnel error | dubaistroy.texacore.ai | Cloudflare</title></head><body><h1>Error 1033</h1><p>Argo Tunnel error</p></body></html>';

// ─── server side ───
test('answerProbe: only the probe path, only `texacore-probe:<nonce>:<bootId>`; a bad nonce is a plain 404; everything else is null', () => {
  assert.deepEqual(R.answerProbe('/__texacore/tunnel-probe/0123456789abcdef', BOOT), { status: 200, body: `texacore-probe:0123456789abcdef:${BOOT}` });
  assert.deepEqual(R.answerProbe('/__texacore/tunnel-probe/0123456789abcdef?x=1', BOOT).status, 200);
  for (const bad of ['/__texacore/tunnel-probe/', '/__texacore/tunnel-probe/short', '/__texacore/tunnel-probe/a b c d e f g h', '/__texacore/tunnel-probe/../../etc/passwd', '/__texacore/tunnel-probe/' + 'x'.repeat(65)]) {
    assert.equal(R.answerProbe(bad, BOOT).status, 404, bad);
    assert.equal(R.answerProbe(bad, BOOT).body, 'not found', bad);
  }
  for (const other of ['/', '/config.js', '/api/ping', '/__texacore/other', '/_supabase/rest/v1/x']) assert.equal(R.answerProbe(other, BOOT), null, other);
});

test('handleProbeRequest over a real socket, with the headers Cloudflare adds: 200 text/plain, no-store, no cookie, EXACTLY nonce + bootId; POST and other paths are not handled', async () => {
  const srv = http.createServer((req, res) => { if (!R.handleProbeRequest(req, res, BOOT)) { res.writeHead(418); res.end('next'); } });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const get = (p, method = 'GET', headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers, agent: false }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
    req.on('error', reject); req.end();
  });
  try {
    const tunnel = { host: 'dubaistroy.texacore.ai', 'cf-ray': '8abc-FRA', 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9', 'cdn-loop': 'cloudflare', 'x-forwarded-proto': 'https' };
    const ok = await get('/__texacore/tunnel-probe/aaaaaaaabbbbbbbb', 'GET', tunnel);
    assert.equal(ok.status, 200);
    assert.equal(ok.body, `texacore-probe:aaaaaaaabbbbbbbb:${BOOT}`);
    assert.match(ok.headers['content-type'], /^text\/plain/);
    assert.match(ok.headers['cache-control'], /no-store/);
    assert.equal(ok.headers['set-cookie'], undefined);
    assert.equal((await get('/__texacore/tunnel-probe/aaaaaaaabbbbbbbb', 'POST', tunnel)).status, 418, 'only GET');
    assert.equal((await get('/api/ping', 'GET', tunnel)).status, 418, 'every other path falls through to the normal routing');
    assert.equal((await get('/__texacore/tunnel-probe/x', 'GET', tunnel)).body, 'not found');
  } finally { srv.close(); }
});

test('STATIC: the probe is wired FIRST on the UI server, answers nothing but nonce + bootId, and the module holds no secret / config / token', () => {
  const sm = fs.readFileSync(path.join(__dirname, '..', 'src', 'service-manager.js'), 'utf8');
  const iProbe = sm.indexOf('handleProbeRequest(');
  const iConfig = sm.indexOf("app.get('/config.js'");
  assert.ok(iProbe > 0 && iConfig > 0 && iProbe < iConfig, 'the probe route is registered before /config.js and every other route');
  assert.equal((sm.match(/handleProbeRequest\(/g) || []).length, 1, 'one place');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'tunnel-route.js'), 'utf8');
  const serverSrc = src.slice(src.indexOf('function answerProbe'), src.indexOf('// ─── client side'));
  assert.ok(serverSrc.length > 100 && serverSrc.length < 2000, 'the server half is small');
  const server = serverSrc.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(server, /config|token|secret|password|licen|process\.env|readFile|require\(/i, 'the server half touches nothing but its arguments');
  assert.match(server, /probeBody\(nonce, bootId\)/);
  // and the web server's remote-access rules did not grow a second open route: net-guard decides local vs remote only, the routes stay as before
  const ng = fs.readFileSync(path.join(__dirname, '..', 'src', 'net-guard.js'), 'utf8');
  assert.doesNotMatch(ng, /tunnel-probe/, 'net-guard needs no exception: the probe is answered before it');
});

// ─── client: classification ───
test('classifyProbe: match only on nonce + bootId; Cloudflare 530 / error 1033 = no_route; anything else answering = wrong_target; offline / timeout / DNS / 502-504 = unverified (never a mismatch)', () => {
  const N = 'n0nce0123456789a';
  const c = (r) => R.classifyProbe(r, N, BOOT);
  assert.deepEqual(c({ status: 200, body: `texacore-probe:${N}:${BOOT}\n` }), { verdict: 'match', reason: null, http: 200, cfError: null });
  assert.deepEqual(c({ status: 530, body: CF_1033 }), { verdict: 'mismatch', reason: 'no_route', http: 530, cfError: 1033 });
  assert.deepEqual(c({ status: 530, body: '' }), { verdict: 'mismatch', reason: 'no_route', http: 530, cfError: null });
  assert.equal(c({ status: 200, body: `texacore-probe:${N}:ffffffffffffffff` }).reason, 'wrong_target', 'another process / machine answers');
  assert.equal(c({ status: 200, body: `texacore-probe:otherNonce12345:${BOOT}` }).reason, 'wrong_target', 'a replayed / cached answer');
  assert.equal(c({ status: 200, body: '<html>some other site</html>' }).verdict, 'mismatch');
  for (const s of [404, 403, 401, 301]) assert.equal(c({ status: s, body: 'x' }).reason, 'wrong_target', String(s));
  for (const s of [502, 503, 504, 522]) assert.equal(c({ status: s, body: 'bad gateway' }).verdict, 'unverified', String(s));
  assert.equal(c({ error: { timedOut: true, code: 'ETIMEDOUT' } }).reason, 'timeout');
  assert.equal(c({ error: { code: 'ENOTFOUND' } }).reason, 'dns');
  assert.equal(c({ error: { code: 'ECONNREFUSED' } }).reason, 'network');
  assert.equal(c({ error: { code: 'ENETUNREACH' } }).verdict, 'unverified');
  assert.equal(c({ error: { code: 'CERT_HAS_EXPIRED' } }).reason, 'tls');
  assert.equal(c(null).verdict, 'unverified');
});

// ─── client: the state machine ───
function machine(script, opts = {}) {
  const calls = []; const timers = []; const verdicts = []; const changes = [];
  let t = 1000;
  const m = new R.RouteVerifier({
    bootId: BOOT, now: () => t, sleep: async (ms) => { t += ms; },
    nonce: (() => { let i = 0; return () => `nonce${String(++i).padStart(10, '0')}`; })(),
    probe: async (nonce) => { calls.push(nonce); const s = typeof script === 'function' ? script(calls.length, nonce) : script[Math.min(calls.length - 1, script.length - 1)]; return typeof s === 'function' ? s(nonce) : s; },
    setTimer: (fn, ms) => { const h = { fn, ms, cleared: false, unref() {} }; timers.push(h); return h; }, clearTimer: (h) => { h.cleared = true; },
    onVerdict: (v) => verdicts.push(v), onChange: (s) => changes.push(s.state), ...opts,
  });
  return { m, calls, timers, verdicts, changes, setNow: (x) => { t = x; } };
}
const ok = (nonce) => ({ status: 200, body: `texacore-probe:${nonce}:${BOOT}` });
const cf = { status: 530, body: CF_1033 };

test('RouteVerifier: the first answer matches -> verified at once; the 30-minute re-check is armed; the verdict is reported once', async () => {
  const x = machine([ok]);
  assert.equal(x.m.state, 'idle');
  const p = x.m.begin();
  assert.equal(x.m.state, 'verifying');
  const s = await p;
  assert.equal(s.state, 'verified'); assert.equal(s.attempts, 1);
  assert.equal(x.timers.length, 1); assert.equal(x.timers[0].ms, 30 * 60 * 1000);
  assert.deepEqual(x.verdicts.map((v) => [v.state, v.kind]), [['verified', 'start']]);
  assert.deepEqual(x.changes, ['verifying', 'verified']);
  assert.equal((await x.m.begin()).state, 'verified', 'begin again is a no-op');
  assert.equal(x.calls.length, 1);
});

test('RouteVerifier: DNS propagation — three failures, then the match: verified after 4 attempts, never shown as a mismatch on the way', async () => {
  const x = machine([{ error: { code: 'ENOTFOUND' } }, { error: { code: 'ENOTFOUND' } }, cf, ok]);
  const s = await x.m.begin();
  assert.equal(s.state, 'verified'); assert.equal(s.attempts, 4);
  assert.ok(!x.changes.includes('mismatch') && !x.changes.includes('unverified'));
});

test('RouteVerifier: Cloudflare 1033 on every attempt of the 90-second window (9 attempts) -> mismatch / no_route / HTTP 530 / 1033; reported to onVerdict as kind start', async () => {
  const x = machine([cf]);
  const s = await x.m.begin();
  assert.deepEqual([s.state, s.reason, s.http, s.cfError, s.attempts], ['mismatch', 'no_route', 530, 1033, 9]);
  assert.equal(x.verdicts.length, 1); assert.equal(x.verdicts[0].kind, 'start'); assert.equal(x.verdicts[0].state, 'mismatch');
  assert.equal(x.timers.length, 1, 'the next check is still scheduled (every 30 minutes)');
});

test('RouteVerifier: a timeout on every attempt -> unverified (cannot verify), NOT mismatch; the next check is scheduled', async () => {
  const x = machine([{ error: { timedOut: true, code: 'ETIMEDOUT' } }]);
  const s = await x.m.begin();
  assert.deepEqual([s.state, s.reason], ['unverified', 'timeout']);
  assert.equal(x.timers.length, 1);
});

test('RouteVerifier: a wrong bootId (another process / machine answers) -> mismatch / wrong_target', async () => {
  const x = machine([(nonce) => ({ status: 200, body: `texacore-probe:${nonce}:0000000000000000` })]);
  const s = await x.m.begin();
  assert.deepEqual([s.state, s.reason], ['mismatch', 'wrong_target']);
});

test('RouteVerifier: a re-check keeps the verified state while it runs, tolerates one bad answer, and flips only when the short window fails entirely', async () => {
  let phase = 'ok';
  const x = machine((i, nonce) => (phase === 'ok' ? ok(nonce) : phase === 'flaky' ? (i % 3 === 1 ? cf : ok(nonce)) : cf));
  await x.m.begin();
  assert.equal(x.m.state, 'verified');
  phase = 'flaky'; x.calls.length = 0;
  const p = x.m.recheck('timer');
  assert.equal(x.m.state, 'verified', 'no flicker during the re-check');
  assert.equal((await p).state, 'verified');
  phase = 'down';
  const s = await x.m.recheck('network-resume');
  assert.equal(s.state, 'mismatch');
  assert.equal(x.verdicts.at(-1).kind, 'recheck:network-resume');
  // and the way back: the network is back -> verified
  phase = 'ok';
  assert.equal((await x.m.recheck('network-resume')).state, 'verified');
});

test('RouteVerifier: the 30-minute timer re-checks; stop() cancels everything and a running cycle changes nothing afterwards', async () => {
  const x = machine([ok]);
  await x.m.begin();
  const before = x.calls.length;
  x.timers[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.ok(x.calls.length > before, 'the timer ran a re-check');
  // stop while a cycle is mid-flight
  let release; const gate = new Promise((r) => { release = r; });
  const y = machine([() => gate.then(() => ok('x'))]);
  const p = y.m.begin();
  await new Promise((r) => setImmediate(r));
  y.m.stop();
  release();
  const s = await p;
  assert.equal(y.m.state, 'idle'); assert.equal(s.state, 'idle');
  assert.ok(y.timers.every((t) => t.cleared || t.ms === undefined) || y.timers.length === 0, 'nothing armed after stop');
  assert.equal((await y.m.recheck('x')).state, 'idle', 'a re-check on an idle verifier does nothing');
});

test('deriveStatus: «connected» ONLY when the route is verified; mismatch / unverified / verifying / repairing / name taken are their own states; connector errors pass through', () => {
  const mon = (state, reason = null, detail = '') => ({ state, reason, detail });
  const rt = (state, extra = {}) => ({ state, reason: null, http: null, cfError: null, ...extra });
  assert.deepEqual(R.deriveStatus(mon('connected'), rt('verified')), { state: 'connected', reason: null, detail: '' });
  assert.deepEqual(R.deriveStatus(mon('connected'), rt('idle')), { state: 'starting', reason: 'verifying_route', detail: '' });
  assert.deepEqual(R.deriveStatus(mon('connected'), rt('verifying')), { state: 'starting', reason: 'verifying_route', detail: '' });
  assert.deepEqual(R.deriveStatus(mon('connected'), rt('mismatch', { reason: 'no_route', http: 530, cfError: 1033 })), { state: 'route_mismatch', reason: 'no_route', detail: 'HTTP 530 / Cloudflare 1033' });
  assert.deepEqual(R.deriveStatus(mon('connected'), rt('unverified', { reason: 'timeout' })), { state: 'connected_unverified', reason: 'timeout', detail: '' });
  assert.deepEqual(R.deriveStatus(mon('connected'), rt('verified'), { repairing: true }), { state: 'starting', reason: 'repairing', detail: '' });
  assert.equal(R.deriveStatus(mon('connected'), rt('mismatch', { reason: 'no_route' }), { nameTaken: { reason: 'taken' } }).state, 'name_taken');
  assert.equal(R.deriveStatus(mon('off', 'disabled'), rt('idle'), { nameTaken: { reason: 'taken' } }).state, 'off', 'cloud access off: nothing to report');
  assert.deepEqual(R.deriveStatus(mon('error', 'token_rejected', 'x'), rt('idle')), { state: 'error', reason: 'token_rejected', detail: 'x' });
  assert.deepEqual(R.deriveStatus(mon('starting'), rt('idle')), { state: 'starting', reason: null, detail: '' });
});

// ─── the repair ───
test('repairOutcome: every register-subdomain answer has its own outcome (and Retry-After is respected)', () => {
  const o = (status, body, extra = {}) => R.repairOutcome({ status, body, ...extra });
  assert.equal(o(200, { success: true, tunnel_token: 't', url: 'u' }).outcome, 'registered');
  assert.deepEqual(o(409, { success: false, code: 'SUBDOMAIN_TAKEN' }), { outcome: 'taken', code: 'SUBDOMAIN_TAKEN', reason: 'taken' });
  assert.equal(o(409, { success: false, code: 'SUBDOMAIN_TAKEN', reason: 'quarantined' }).reason, 'quarantined');
  assert.equal(o(403, { success: false, code: 'DEVICE_PROOF_REQUIRED' }).outcome, 'device_proof');
  assert.equal(o(403, { success: false, code: 'HARDWARE_MISMATCH' }).outcome, 'hardware_mismatch');
  assert.equal(o(403, { success: false, code: 'HARDWARE_REQUIRED' }).outcome, 'hardware_mismatch');
  assert.deepEqual(o(429, { success: false, code: 'RATE_LIMITED', retry_after_seconds: 1800 }), { outcome: 'rate_limited', code: 'RATE_LIMITED', retryAfterSec: 1800 });
  assert.equal(o(429, { success: false, code: 'RATE_LIMITED' }, { retryAfter: 120 }).retryAfterSec, 120, 'the header when the body has none');
  assert.equal(o(429, { success: false, code: 'RATE_LIMITED', retry_after_seconds: 9e9 }).retryAfterSec, 86400, 'clamped');
  assert.equal(o(502, { success: false, code: 'CLOUDFLARE_ERROR' }).outcome, 'cloudflare_error');
  assert.equal(o(400, { success: false, code: 'INVALID_SUBDOMAIN' }).outcome, 'invalid_name');
  assert.equal(o(403, { success: false, code: 'EXPIRED' }).outcome, 'license');
  assert.equal(o(503, { success: false, code: 'SERVER_ERROR' }).outcome, 'network');
  assert.equal(R.repairOutcome({ error: { code: 'ENOTFOUND' } }).outcome, 'network');
  assert.equal(R.repairOutcome({ status: 200, body: '<html>' }).outcome, 'network');
  assert.equal(R.repairOutcome(null).outcome, 'network');
});

test('parseTimingOverride (harness): only sane numbers are taken', () => {
  assert.deepEqual(R.parseTimingOverride('{"schedule":[0,200,400],"quick":[0],"recheckMs":5000,"timeoutMs":1500}'), { schedule: [0, 200, 400], quick: [0], recheckMs: 5000, timeoutMs: 1500 });
  assert.deepEqual(R.parseTimingOverride('{"schedule":["x"],"recheckMs":1}'), {});
  assert.deepEqual(R.parseTimingOverride('not json'), {});
});
