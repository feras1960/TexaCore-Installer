'use strict';
// 2.0.8 (launch-check 9.1, 18-11): opening a company file restarts PostgREST and GoTrue. The old process must have EXITED (its port free)
// before the new one starts - a fixed one-second wait left a busy machine with no PostgREST at all.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ServiceManager = require('../src/service-manager');

const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const self = (procs) => ({ processes: procs, _killProcess: ServiceManager.prototype._killProcess });
const slowChild = (exitAfterMs) => spawn(process.execPath, ['-e', `process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),${exitAfterMs}));setInterval(()=>{},1000)`]);
const started = (p) => new Promise((r) => setTimeout(r, 300));

test('it resolves only once the child has really exited (a slow SIGTERM handler is waited for), and flags the stop as deliberate', async () => {
  const child = slowChild(1200); await started(child);
  const sm = self({ postgrest: child });
  const t0 = Date.now();
  const ok = await ServiceManager.prototype._stopProcessAndWait.call(sm, 'postgrest', 8000);
  assert.equal(ok, true);
  assert.ok(Date.now() - t0 >= 1100, `waited ${Date.now() - t0} ms`);
  assert.ok(child.exitCode !== null || child.signalCode !== null, 'the child is gone');
  assert.equal(child.texaStopRequested, true, 'the supervisor sees a deliberate stop');
  assert.equal(sm.processes.postgrest, null);
});

test('a child that ignores SIGTERM is SIGKILLed after 3 s and the wait still ends', async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"]); await started(child);
  const ok = await ServiceManager.prototype._stopProcessAndWait.call(self({ gotrue: child }), 'gotrue', 8000);
  assert.equal(ok, true);
  assert.equal(child.signalCode, 'SIGKILL');
});

test('no process, or one already gone: resolves at once', async () => {
  assert.equal(await ServiceManager.prototype._stopProcessAndWait.call(self({}), 'postgrest'), true);
  const child = spawn(process.execPath, ['-e', '0']);
  await new Promise((r) => child.once('exit', r));
  const sm = self({ postgrest: child });
  assert.equal(await ServiceManager.prototype._stopProcessAndWait.call(sm, 'postgrest'), true);
  assert.equal(sm.processes.postgrest, null);
});

test('opening a company file waits for both old services and retries a start that finds the port still held', () => {
  const main = SRC('main.js');
  assert.match(main, /await svcManager\._stopProcessAndWait\('gotrue'\)/);
  assert.match(main, /await svcManager\._stopProcessAndWait\('postgrest'\)/);
  assert.match(main, /await startWithPortRetry\(\(\) => svcManager\.startGoTrue\(\)\)/);
  assert.match(main, /await startWithPortRetry\(\(\) => svcManager\.startPostgREST\(\)\)/);
  assert.doesNotMatch(main, /_killProcess\('(gotrue|postgrest)'\);[^\n]*\n\s*await new Promise\(r => setTimeout\(r, 1000\)\)/, 'no fixed one-second wait after a kill');
});
