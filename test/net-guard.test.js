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

test('loopback addresses', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.ok(g.isLoopbackAddress(a), a);
  for (const a of ['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', 'fe80::1', '', undefined]) assert.ok(!g.isLoopbackAddress(a), String(a));
});

test('isLocalRequest needs loopback Host AND loopback peer AND no proxy/CDN header', () => {
  assert.ok(g.isLocalRequest(req({ host: 'localhost:47395' })));
  assert.ok(g.isLocalRequest(req({ host: '127.0.0.1:47395' }, '::ffff:127.0.0.1')));
  // a LAN client that opens the LAN address
  assert.ok(!g.isLocalRequest(req({ host: '192.168.1.20:47395' }, '192.168.1.30')));
  // the machine browsing to its own LAN address (Host not loopback)
  assert.ok(!g.isLocalRequest(req({ host: '192.168.1.20:47395' }, '192.168.1.20')));
  // a LAN client that FORGES Host: 127.0.0.1 — its TCP peer gives it away
  assert.ok(!g.isLocalRequest(req({ host: '127.0.0.1:47395' }, '192.168.1.30')));
  // DNS rebinding: a loopback peer but the attacker's name in Host
  assert.ok(!g.isLocalRequest(req({ host: 'evil.com:47395' }, '127.0.0.1')));
  // the tunnel: cloudflared connects from loopback; even if its origin settings rewrote Host to localhost, Cloudflare's headers remain
  for (const h of ['cf-connecting-ip', 'cf-ray', 'cf-visitor', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-real-ip', 'forwarded', 'true-client-ip', 'cdn-loop']) {
    assert.ok(!g.isLocalRequest(req({ host: 'localhost:47395', [h]: '1.2.3.4' })), h);
  }
  assert.ok(!g.isLocalRequest(null));
  assert.ok(!g.isLocalRequest({ headers: { host: 'localhost' } }));   // no socket
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
