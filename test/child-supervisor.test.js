'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createSupervisor } = require('../src/child-supervisor');

// fake clock + timers
function clock() {
  let t = 0; const q = [];
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = { fn, at: t + ms, ms }; q.push(h); return h; },
    clearTimer: (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); },
    async advance(ms) { t += ms; for (const h of q.filter((x) => x.at <= t)) { q.splice(q.indexOf(h), 1); await h.fn(); } },
    pending: () => q.length,
  };
}
const make = (c, restart) => createSupervisor({ name: 'X', restart, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });

test('an unexpected exit leads to a restart after 1s', async () => {
  const c = clock(); let n = 0; const s = make(c, async () => { n++; });
  assert.strictEqual(s.onUnexpectedExit('code null'), 1000);
  await c.advance(999); assert.strictEqual(n, 0);
  await c.advance(1); assert.strictEqual(n, 1);
});

test('backoff is 1s, 2s, 5s, 5s and a second exit while one is pending adds nothing', async () => {
  const c = clock(); const s = make(c, async () => {});
  const d = [];
  for (let i = 0; i < 4; i++) { d.push(s.onUnexpectedExit('x')); assert.strictEqual(s.onUnexpectedExit('x'), null); await c.advance(d[i]); }
  assert.deepStrictEqual(d, [1000, 2000, 5000, 5000]);
});

test('capped at 5 restarts per 2 minutes, then gives up; the window then frees it', async () => {
  const c = clock(); let n = 0; const logs = []; const s = createSupervisor({ name: 'X', restart: async () => { n++; }, log: (m) => logs.push(m), now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  for (let i = 0; i < 5; i++) { const d = s.onUnexpectedExit('x'); assert.ok(d); await c.advance(d); }
  assert.strictEqual(n, 5);
  assert.strictEqual(s.onUnexpectedExit('x'), null);
  assert.ok(s.gaveUp); assert.ok(logs.some((m) => /giving up/.test(m)));
  assert.strictEqual(c.pending(), 0);
  await c.advance(2 * 60 * 1000);
  assert.ok(s.onUnexpectedExit('x'));
});

test('cancel() (a deliberate stop) drops a pending restart', async () => {
  const c = clock(); let n = 0; const s = make(c, async () => { n++; });
  s.onUnexpectedExit('x'); s.cancel();
  await c.advance(10000); assert.strictEqual(n, 0);
});

test('a failed restart is retried with the next backoff', async () => {
  const c = clock(); let n = 0; const s = make(c, async () => { n++; if (n === 1) throw new Error('boom'); });
  await c.advance(0); s.onUnexpectedExit('x');
  await c.advance(1000); assert.strictEqual(n, 1); assert.ok(s.pending);
  await c.advance(2000); assert.strictEqual(n, 2);
});

// ServiceManager wiring with fake child processes
const ServiceManager = require('../src/service-manager');
function fakeProc() { const p = new EventEmitter(); p.kill = () => {}; return p; }
function mgr() {
  const m = Object.create(ServiceManager.prototype);
  m.processes = {}; m._stopping = false;
  const calls = [];
  m.supervisors = { postgrest: { onUnexpectedExit: (d) => calls.push(['postgrest', d]), cancel() {}, reset() {} }, gotrue: { onUnexpectedExit: (d) => calls.push(['gotrue', d]), cancel() {}, reset() {} } };
  return { m, calls };
}

test('ServiceManager: a signal death of a ready PostgREST is supervised', () => {
  const { m, calls } = mgr(); const p = fakeProc(); p.texaReady = true; m.processes.postgrest = null;
  m._onSupervisedExit('postgrest', p, null, 'SIGKILL');
  assert.strictEqual(calls.length, 1);
});

test('ServiceManager: _killProcess (restore, port change, quit) never restarts', () => {
  const { m, calls } = mgr(); const p = fakeProc(); p.texaReady = true; m.processes.gotrue = p;
  m._killProcess('gotrue'); m._onSupervisedExit('gotrue', p, null, 'SIGTERM');
  assert.strictEqual(calls.length, 0);
});

test('ServiceManager: while stopping, or before first ready, or already replaced: no restart', () => {
  const { m, calls } = mgr(); const p = fakeProc(); p.texaReady = true;
  m._stopping = true; m._onSupervisedExit('postgrest', p, 1, null);
  m._stopping = false; const q = fakeProc(); m._onSupervisedExit('postgrest', q, 1, null);
  m.processes.postgrest = fakeProc(); m._onSupervisedExit('postgrest', p, 1, null);
  assert.strictEqual(calls.length, 0);
});

test('ServiceManager: restart does nothing without Postgres or when stopping', async () => {
  const { m } = mgr(); let started = 0; m.startPostgREST = async () => { started++; };
  await m._superviseRestart('postgrest'); assert.strictEqual(started, 0);
  m.processes.postgres = {}; await m._superviseRestart('postgrest'); assert.strictEqual(started, 1);
  m._stopping = true; await m._superviseRestart('postgrest'); assert.strictEqual(started, 1);
});
