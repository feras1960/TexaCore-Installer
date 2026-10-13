'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../src/net-guard');

const req = (headers, peer = '127.0.0.1') => ({ headers, socket: { remoteAddress: peer } });

test('loopback Host allow-list: exact names only, any port', () => {
  for (const h of ['localhost', 'localhost:47395', '127.0.0.1', '127.0.0.1:80', '[::1]', '[::1]:47395', 'LOCALHOST:1']) assert.ok(g.isLoopbackHost(h), h);
  for (const h of ['192.168.1.20', '192.168.1.20:47395', 'erp.local', 'evil.com', 'localhost.evil.com', 'evil.com#localhost', '127.0.0.1.evil.com',
    '127.0.0.2', 'foo.texacore.ai', 'localhost:80:80', '', undefined, null, '127.0.0.1:99999999', 'localhost/x', ' evil.com localhost']) {
    assert.ok(!g.isLoopbackHost(h), String(h));
  }
});

test('loopback addresses: every spelling the OS may hand Node (IPv4, IPv6, IPv4-mapped in both notations, long IPv6 loopback, zone id)', () => {
  for (const a of ['127.0.0.1', '127.0.0.5', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:7F00:0001', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001', '::0001', '::1%lo0', '[::1]']) assert.ok(g.isLoopbackAddress(a), a);
  for (const a of ['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', '::ffff:c0a8:114', 'fe80::1', 'fe80::1%en0', '::2', '', undefined, null, '127.0.0.1.evil', 'localhost']) assert.ok(!g.isLoopbackAddress(a), String(a));
  assert.equal(g.normalizeAddress('::ffff:7f00:1'), '127.0.0.1');
  assert.equal(g.normalizeAddress('::ffff:c0a8:114'), '192.168.1.20');
  assert.equal(g.normalizeAddress('FE80::1%en0'), 'fe80::1');
});

const os = require('os');
const ownLan = () => { for (const l of Object.values(os.networkInterfaces())) for (const i of l || []) if (!i.internal && i.family === 'IPv4') return i.address; return null; };

test('isLocalRequest: loopback Host AND a peer that is this machine AND not forwarded from elsewhere', () => {
  assert.ok(g.isLocalRequest(req({ host: 'localhost:47395' })));
  assert.ok(g.isLocalRequest(req({ host: '127.0.0.1:47395' }, '::ffff:127.0.0.1')));
  assert.ok(g.isLocalRequest(req({ host: 'localhost:47395' }, '::1')));
  assert.ok(g.isLocalRequest(req({ host: 'localhost:47395' }, '::ffff:7f00:1')));
  // a LAN client that opens the LAN address
  assert.ok(!g.isLocalRequest(req({ host: '192.168.1.20:47395' }, '192.168.1.30')));
  // the machine browsing to its own LAN address (Host not loopback)
  assert.ok(!g.isLocalRequest(req({ host: '192.168.1.20:47395' }, '192.168.1.20')));
  // a LAN client that FORGES Host: 127.0.0.1 — its TCP peer gives it away
  assert.ok(!g.isLocalRequest(req({ host: '127.0.0.1:47395' }, '192.168.1.30')));
  assert.ok(!g.isLocalRequest(req({ host: 'localhost' }, '203.0.113.7')));
  // DNS rebinding: a loopback peer but the attacker's name in Host
  assert.ok(!g.isLocalRequest(req({ host: 'evil.com:47395' }, '127.0.0.1')));
  assert.ok(!g.isLocalRequest(null));
  assert.ok(!g.isLocalRequest({ headers: { host: 'localhost' } }));   // no socket
  assert.deepEqual(g.classifyRequest(req({ host: 'evil.com' }, '203.0.113.7')).reasons, ['host-not-loopback', 'peer-not-this-machine']);
});

test('the machine\'s OWN LAN address as the TCP peer (a local program bound to it — seen on Windows) is this machine; a foreign peer never is', (t) => {
  const lan = ownLan();
  if (!lan) return t.skip('no non-loopback IPv4 interface here');
  assert.ok(g.isLocalRequest(req({ host: 'localhost:47395' }, lan)));
  assert.ok(g.isLocalRequest(req({ host: 'localhost:47395' }, `::ffff:${lan}`)));
  const foreign = lan.split('.').map((x, i) => (i === 3 ? String((Number(x) % 200) + 17) : x)).join('.');
  if (foreign !== lan) assert.ok(!g.isLocalRequest(req({ host: 'localhost:47395' }, foreign)));
});

test('TUNNEL / CDN / reverse-proxy shapes are never local (the bypass matrix): Cloudflare headers, a foreign client in X-Forwarded-For / Forwarded / X-Real-IP / True-Client-IP, a foreign X-Forwarded-Host, unreadable forwarding values', () => {
  const host = { host: 'localhost:47395' };
  // what cloudflared really forwards (loopback peer; Host rewritten by the tunnel's origin settings)
  assert.ok(!g.isLocalRequest(req({ ...host, 'cf-ray': '8a1b2c3d4e5f-FRA', 'cf-connecting-ip': '203.0.113.9', 'cf-visitor': '{"scheme":"https"}', 'cdn-loop': 'cloudflare; loops=1', 'x-forwarded-for': '203.0.113.9', 'x-forwarded-proto': 'https' })));
  // each Cloudflare header ALONE is enough — and a spoofed "127.0.0.1" next to it changes nothing
  for (const h of ['cf-ray', 'cf-connecting-ip', 'cf-visitor', 'cf-ipcountry', 'cf-worker', 'cdn-loop', 'cf-connecting-ipv6', 'x-cf-anything']) assert.ok(!g.isLocalRequest(req({ ...host, [h]: 'x', 'x-forwarded-for': '127.0.0.1' })), h);
  // a reverse proxy that names a foreign client, whatever else it sends
  for (const [h, v] of [['x-forwarded-for', '203.0.113.9'], ['x-forwarded-for', '127.0.0.1, 203.0.113.9'], ['x-forwarded-for', '203.0.113.9, 127.0.0.1'], ['x-forwarded-for', '2001:db8::1'], ['x-forwarded-for', '[2001:db8::1]:4711'],
    ['x-real-ip', '198.51.100.4'], ['true-client-ip', '198.51.100.4'], ['x-client-ip', '198.51.100.4'], ['x-original-forwarded-for', '198.51.100.4'],
    ['forwarded', 'for=203.0.113.9;proto=https'], ['forwarded', 'for="[2001:db8::1]:4711"'], ['forwarded', 'for=127.0.0.1, for=203.0.113.9'],
    ['x-forwarded-host', 'erp.example.com'], ['x-forwarded-host', 'demo.texacore.ai'], ['x-forwarded-host', 'localhost, evil.com']]) {
    assert.ok(!g.isLocalRequest(req({ ...host, [h]: v })), `${h}: ${v}`);
  }
  // values that are not addresses at all: cannot be shown to be local → remote
  for (const v of ['unknown', '_hidden', 'evil.com', '', ',', '1.2.3']) assert.ok(!g.isLocalRequest(req({ ...host, 'x-forwarded-for': v })), `x-forwarded-for: "${v}"`);
  assert.ok(!g.isLocalRequest(req({ ...host, forwarded: 'by=203.0.113.43' })));   // a Forwarded header that names no `for=` client cannot be shown to be local
  // the reasons are codes, never header VALUES
  const r = g.classifyRequest(req({ ...host, 'cf-ray': 'SECRET-RAY', 'x-forwarded-for': '203.0.113.9' }));
  assert.deepEqual(r.reasons, ['cloudflare-header(cf-ray)', 'x-forwarded-for:foreign-address']);
  assert.ok(!JSON.stringify(r).includes('SECRET-RAY') && !JSON.stringify(r).includes('203.0.113.9'));
});

test('a LOCAL security product / debugging proxy on this machine (loopback peer, loopback Host, no Cloudflare header) is still local: Via, X-Forwarded-Proto/-Port, a forwarding header naming only this machine', () => {
  const host = { host: 'localhost:47395' };
  const lan = ownLan();
  const shapes = [
    { via: '1.1 av-gateway' },
    { via: '1.1 localproxy (squid/5.7)', 'x-forwarded-proto': 'http', 'x-forwarded-port': '47395' },
    { 'x-forwarded-for': '127.0.0.1' }, { 'x-forwarded-for': '::1' }, { 'x-forwarded-for': '::ffff:127.0.0.1' }, { 'x-forwarded-for': '127.0.0.1, 127.0.0.1' }, { 'x-forwarded-for': '[::1]:51000' }, { 'x-forwarded-for': '127.0.0.1:51000' },
    { 'x-real-ip': '127.0.0.1' }, { 'true-client-ip': '127.0.0.1' }, { forwarded: 'for=127.0.0.1;proto=http' }, { forwarded: 'for="[::1]"' },
    { 'x-forwarded-host': 'localhost:47395' }, { 'x-forwarded-host': '127.0.0.1:47395', 'x-forwarded-for': '127.0.0.1', via: '1.1 scanner' },
    ...(lan ? [{ 'x-forwarded-for': lan }, { 'x-forwarded-for': `127.0.0.1, ${lan}` }] : []),
  ];
  for (const h of shapes) assert.ok(g.isLocalRequest(req({ ...host, ...h })), JSON.stringify(h));
  // …but the peer and Host rules still apply to them
  assert.ok(!g.isLocalRequest(req({ host: 'localhost:47395', via: '1.1 av-gateway' }, '203.0.113.7')));
  assert.ok(!g.isLocalRequest(req({ host: 'evil.com', via: '1.1 av-gateway' })));
  // informational: which proxy-ish headers were there (names only)
  assert.deepEqual(g.proxyHeaderNames({ Host: 'x', Via: '1', 'X-Forwarded-For': '127.0.0.1', 'Content-Type': 'a', 'Cf-Ray': 'z' }), ['cf-ray', 'via', 'x-forwarded-for']);
});

test('CORS: never "*", loopback origins reflected, everything else gets no allow-origin', () => {
  const ok = g.corsHeadersFor(req({ origin: 'http://localhost:47395' }));
  assert.equal(ok['Access-Control-Allow-Origin'], 'http://localhost:47395');
  assert.equal(ok.Vary, 'Origin');
  assert.equal(g.corsHeadersFor(req({ origin: 'http://127.0.0.1:5173' }))['Access-Control-Allow-Origin'], 'http://127.0.0.1:5173');
  for (const o of ['https://evil.com', 'http://192.168.1.20:47395', 'null', 'file://', 'http://localhost.evil.com', 'http://evil.com/localhost', '']) {
    const h = g.corsHeadersFor(req({ origin: o }));
    assert.equal(h['Access-Control-Allow-Origin'], undefined, o);
    assert.notEqual(Object.values(h).join(), '*');
  }
  assert.equal(g.corsHeadersFor(req({}))['Access-Control-Allow-Origin'], undefined);
});

test('stripCorsHeaders removes every upstream access-control-* header', () => {
  const out = g.stripCorsHeaders({ 'content-type': 'x', 'Access-Control-Allow-Origin': '*', 'access-control-expose-headers': 'a' });
  assert.deepEqual(Object.keys(out), ['content-type']);
});

test('safeUploadName refuses anything that is not a plain "<name>.tcdb"', () => {
  assert.equal(g.safeUploadName('backup.tcdb', { ext: '.tcdb' }), 'backup.tcdb');
  assert.equal(g.safeUploadName('شركة النور 2026.TCDB', { ext: '.tcdb' }), 'شركة النور 2026.TCDB');
  for (const n of ['../../etc/x.tcdb', '..\\..\\x.tcdb', '/abs/x.tcdb', 'C:\\x.tcdb', 'a/b.tcdb', 'a\\b.tcdb', '..tcdb', '.hidden.tcdb', 'x..y.tcdb',
    'x.tcdb\0.png', 'x\n.tcdb', 'x.tcdb.', 'x.tcdb ', 'x.png', 'x', '', ' ', 'a'.repeat(200) + '.tcdb', 'a:b.tcdb', 'a*b.tcdb', null, undefined, 42]) {
    assert.equal(g.safeUploadName(n, { ext: '.tcdb' }), null, JSON.stringify(n));
  }
});
