'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TunnelMonitor, redact, GRACE_MS } = require('../src/tunnel-monitor');

const clock = () => { let t = 1_000_000; const now = () => t; now.advance = (ms) => { t += ms; }; return now; };
const REG = (i) => `2026-10-13T21:06:30Z INF Registered tunnel connection connIndex=${i} connection=6bbf1b1c-0000-4d4e-9d1f-aaaaaaaaaaaa event=0 ip=198.41.200.73 location=fra08 protocol=quic`;
const UNREG = (i) => `2026-10-13T21:09:00Z INF Unregistered tunnel connection connIndex=${i}`;
const REJECT = '2026-10-13T21:06:28Z ERR Register tunnel error from server side error="Failed to get tunnel" connIndex=0 event=0 ip=198.41.200.73';

test('starting → connected only after a REGISTERED connection; never merely because the process runs', () => {
  const now = clock(); const m = new TunnelMonitor({ now });
  assert.equal(m.snapshot().state, 'off');
  m.begin({ binary: '/x/cloudflared', version: '2026.10.0', pid: 123 });
  m.feed('2026-10-13T21:06:27Z INF Starting tunnel tunnelID=11111111-2222-3333-4444-555555555555');
  m.feed('2026-10-13T21:06:27Z INF Initial protocol quic');
  assert.equal(m.snapshot().state, 'starting');
  m.feed(REG(0));
  const s = m.snapshot();
  assert.equal(s.state, 'connected'); assert.equal(s.connections, 1); assert.equal(s.everConnected, true);
  m.feed(REG(1)); assert.equal(m.snapshot().connections, 2);
});

test('losing every connection goes back to starting (reconnecting); one left stays connected', () => {
  const m = new TunnelMonitor({ now: clock() }); m.begin({ pid: 1 });
  m.feed(REG(0)); m.feed(REG(1));
  m.feed(UNREG(0)); assert.equal(m.snapshot().state, 'connected');
  m.feed(UNREG(1)); assert.equal(m.snapshot().state, 'starting');
  m.feed(REG(0)); assert.equal(m.snapshot().state, 'connected');
});

test('no registration within the grace period is an ERROR (not_registered), and a late registration recovers', () => {
  const now = clock(); const m = new TunnelMonitor({ now }); m.begin({ pid: 1 });
  now.advance(GRACE_MS - 1); assert.equal(m.snapshot().state, 'starting');
  now.advance(2);
  const s = m.snapshot(); assert.equal(s.state, 'error'); assert.equal(s.reason, 'not_registered');
  m.feed(REG(0)); assert.equal(m.snapshot().state, 'connected');
});

test('the real cloudflared message for a malformed token is an immediate token_invalid error and the exit does not blur it', () => {
  const m = new TunnelMonitor({ now: clock() }); m.begin({ pid: 9 });
  m.feed('Provided Tunnel token is not valid.');
  let s = m.snapshot(); assert.equal(s.state, 'error'); assert.equal(s.reason, 'token_invalid');
  m.exited({ code: 255, signal: null });
  s = m.snapshot(); assert.equal(s.reason, 'token_invalid'); assert.equal(s.exitCode, 255);
});

test('a well-formed token the edge refuses ("Failed to get tunnel") is token_rejected after 3 refusals, never connected', () => {
  const m = new TunnelMonitor({ now: clock() }); m.begin({ pid: 9 });
  m.feed(REJECT); m.feed(REJECT); assert.equal(m.snapshot().state, 'starting');
  m.feed(REJECT);
  const s = m.snapshot(); assert.equal(s.state, 'error'); assert.equal(s.reason, 'token_rejected'); assert.equal(s.connections, 0);
});

test('an unexpected exit is an error with the exit code and the last lines; a stop we asked for is "off", not an error', () => {
  const m = new TunnelMonitor({ now: clock() }); m.begin({ pid: 9 });
  m.feed('2026-10-13T21:06:27Z ERR something broke');
  m.exited({ code: 1, signal: null });
  let s = m.snapshot(); assert.equal(s.state, 'error'); assert.equal(s.reason, 'exited'); assert.match(s.detail, /exit code 1/); assert.match(s.detail, /something broke/);
  m.begin({ pid: 10 }); m.exited({ code: null, signal: 'SIGTERM' });
  s = m.snapshot(); assert.equal(s.state, 'off'); assert.equal(s.reason, 'stopped');
});

test('network failures with nothing registered become a network error; they clear when a connection registers', () => {
  const m = new TunnelMonitor({ now: clock() }); m.begin({ pid: 9 });
  for (let i = 0; i < 5; i++) m.feed('2026-10-13T21:06:30Z ERR Unable to establish connection with Cloudflare edge error="dial tcp: lookup region1.v2.argotunnel.com: no such host"');
  assert.equal(m.snapshot().reason, 'network');
  m.feed(REG(0)); assert.equal(m.snapshot().state, 'connected');
});

test('fail() with a code outside the list falls back to "exited"; binary_missing carries its detail', () => {
  const m = new TunnelMonitor({ now: clock() });
  m.fail('binary_missing', 'looked in /a /b'); assert.equal(m.snapshot().reason, 'binary_missing'); assert.match(m.snapshot().detail, /looked in/);
  m.fail('nonsense'); assert.equal(m.snapshot().reason, 'exited');
});

test('redaction: the token (exact value), JWT-shaped and long opaque strings, and token=… arguments never reach a kept or logged line', () => {
  const token = Buffer.from(JSON.stringify({ a: '0123456789abcdef0123456789abcdef', t: '11111111-2222-3333-4444-555555555555', s: 'c2VjcmV0c2VjcmV0c2VjcmV0c2VjcmV0' })).toString('base64');
  const m = new TunnelMonitor({ now: clock() }); m.setSecrets([token]); m.begin({ pid: 1 });
  const out = m.feed(`INF starting with ${token} and eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij and TUNNEL_TOKEN=abc123 ok`);
  assert.ok(!out.includes(token)); assert.ok(!out.includes('eyJhbGci')); assert.ok(!out.includes('abc123'));
  assert.equal(redact('x'.repeat(10)), 'xxxxxxxxxx');
  assert.match(redact('A'.repeat(80)), /<redacted>/);
  assert.ok(m.snapshot().lastLines.every((l) => !l.includes(token)));
  m.fail('exited', `boom ${token}`); assert.ok(!m.snapshot().detail.includes(token));
});
