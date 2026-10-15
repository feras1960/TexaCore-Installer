'use strict';
// 2.0.3: opening a company file while something else talks to the database. The pre-restore truncate is one atomic transaction (a failure rolls it back), and the
// deadlock detector picks it as the victim when another client's query (PostgREST for an ERP page open in a browser tab) is in flight: the launch checks showed
// «Pre-restore truncate failed: deadlock detected» on about one run in three. A retry is safe, and a backup that is still running must finish before the restore
// starts - a dump reads the very tables the restore truncates, and one that ends after the target was re-pointed would write the OLD database into the opened file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const BackupManager = require('../src/backup-manager');
const { mkdtemp } = require('./helpers');

function mgr(dir) {
  const m = new BackupManager({ pgBinDir: '/nonexistent', dbPassword: 'x', backupPath: path.join(dir, 'live.tcdb'), encryptionKey: 'texacore-default-backup-key-2026', onProgress: () => {}, onError: () => {} });
  m.truncateRetryDelaysMs = [5, 5, 5];
  return m;
}

/** A fake psql: prints `stderr` and exits 1 for the first `failTimes` runs, then exits 0; every run is counted in <dir>/calls. */
function fakePsql(dir, failTimes, stderr) {
  const script = path.join(dir, 'psql-fake.sh');
  fs.writeFileSync(script, `#!/bin/sh\nn=$(cat "${dir}/calls" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "${dir}/calls"\nif [ "$n" -le ${failTimes} ]; then echo '${stderr}' >&2; exit 1; fi\nexit 0\n`, { mode: 0o755 });
  return { script, calls: () => Number(fs.readFileSync(path.join(dir, 'calls'), 'utf8')) };
}

test('the pre-restore truncate is retried when it is the deadlock victim, then succeeds', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtemp();
  const m = mgr(dir);
  const f = fakePsql(dir, 2, 'psql:x.truncate.sql:9: ERROR:  deadlock detected');
  m.psql = f.script;
  await m._truncatePublic(['public.a', 'public.b']);
  assert.equal(f.calls(), 3, 'two deadlocks, then the truncate went through');
  assert.ok(!fs.existsSync(`${m.backupPath}.truncate.sql`), 'the temp script is removed after every attempt');
});

test('a lock timeout is transient too; any other failure is not retried; the retries are bounded and the last error is reported', { skip: process.platform === 'win32' }, async () => {
  let dir = mkdtemp();
  let m = mgr(dir);
  let f = fakePsql(dir, 1, 'ERROR:  canceling statement due to lock timeout');
  m.psql = f.script;
  await m._truncatePublic(['public.a']);
  assert.equal(f.calls(), 2);

  dir = mkdtemp(); m = mgr(dir);
  f = fakePsql(dir, 99, 'ERROR:  permission denied for table a');
  m.psql = f.script;
  await assert.rejects(m._truncatePublic(['public.a']), /Pre-restore truncate failed: .*permission denied/);
  assert.equal(f.calls(), 1, 'a real error stops at once');

  dir = mkdtemp(); m = mgr(dir);
  f = fakePsql(dir, 99, 'ERROR:  deadlock detected');
  m.psql = f.script;
  await assert.rejects(m._truncatePublic(['public.a']), /Pre-restore truncate failed: .*deadlock detected/);
  assert.equal(f.calls(), 4, 'one try + three retries, then it fails loudly');
});

test('restore() waits for a running backup, starts no new one meanwhile, and re-opens the timer\'s backup() afterwards - even when the restore fails', async () => {
  const dir = mkdtemp();
  const m = mgr(dir);
  const order = [];
  m._restoreFile = async () => { order.push(`restore(running=${m._running})`); return { ok: true }; };
  m._running = true;                                   // a dump in flight
  const p = m.restore('x.tcdb');
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(order, [], 'the restore has not started while the dump runs');
  assert.equal(m._restoring, true);
  assert.equal(await m.backup(), null, 'the timer\'s backup() skips while a restore is pending');
  m._running = false;                                  // the dump ends
  assert.deepEqual(await p, { ok: true });
  assert.deepEqual(order, ['restore(running=false)']);
  assert.equal(m._restoring, false);
  m._restoreFile = async () => { throw new Error('boom'); };
  await assert.rejects(m.restore('x.tcdb'), /boom/);
  assert.equal(m._restoring, false, 'a failed restore does not leave backups blocked');
});

test('waitIdle: true as soon as nothing runs; gives up after maxMs', async () => {
  const m = mgr(mkdtemp());
  assert.equal(await m.waitIdle(50), true);
  m._running = true;
  const t0 = Date.now();
  assert.equal(await m.waitIdle(150), false);
  assert.ok(Date.now() - t0 >= 140);
});

test('both restore paths of the app let a running dump finish before the target is re-pointed', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const inPlace = main.slice(main.indexOf('async function restoreTcdbFromPath('), main.indexOf('const restoreResult = await backupManager.restore(selectedPath'));
  assert.ok(inPlace.indexOf('backupManager.stopSync()') > 0 && inPlace.indexOf('await backupManager.waitIdle()') > inPlace.indexOf('backupManager.stopSync()'));
  assert.ok(inPlace.indexOf('backupManager.backupPath = liveTarget') > inPlace.indexOf('await backupManager.waitIdle()'), 'idle first, then the target moves');
  const upload = main.slice(main.indexOf("// Restore the database from TCDB\n        try { backupManager.stopSync()"), main.indexOf('const restoreResult = await backupManager.restore(tcdbPath'));
  assert.ok(upload.indexOf('await backupManager.waitIdle()') > 0 && upload.indexOf('backupManager.backupPath = tcdbPath') > upload.indexOf('await backupManager.waitIdle()'));
});
