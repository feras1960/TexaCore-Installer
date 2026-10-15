'use strict';
// 2.0.3 review: opening a company file IN PLACE re-points the backup manager at the user's own file BEFORE the restore runs.
//  - a restore that fails must not leave the manager writing into that file (the final backup at quit / «backup now» wrote the PREVIOUS company's database into it);
//  - the restore's psql scripts (the whole decrypted database) must not be written beside it (the user's Desktop / USB stick / cloud folder / a protected export's folder);
//  - a dump that is still running when the target moves writes into the file it started for, never into the newly opened one;
//  - only one company file is opened at a time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const BackupManager = require('../src/backup-manager');
const { mkdtemp } = require('./helpers');

/** A fake psql that copies each -f script to <dir>/seen/ (so the test sees where it was and what it held) and fails the truncate when FAIL_TRUNC is set. */
function fakePsql(dir) {
  const seen = path.join(dir, 'seen');
  fs.mkdirSync(seen);
  const script = path.join(dir, 'psql-fake.sh');
  fs.writeFileSync(script, `#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = "-f" ]; then f="$2"; fi; shift; done\necho "$f" >> "${seen}/paths"\n`
    + `case "$f" in *truncate*) [ -n "$FAIL_TRUNC" ] && { echo 'ERROR:  permission denied for table x' >&2; exit 1; } ;; esac\nexit 0\n`, { mode: 0o755 });
  return { script, paths: () => (fs.existsSync(path.join(seen, 'paths')) ? fs.readFileSync(path.join(seen, 'paths'), 'utf8').trim().split('\n') : []) };
}

function mgr(dir, backupPath) {
  const m = new BackupManager({ pgBinDir: '/nonexistent', dbPassword: 'x', backupPath, encryptionKey: 'texacore-default-backup-key-2026', onProgress: () => {}, onError: () => {} });
  m.truncateRetryDelaysMs = [1];
  m._restoreAuthData = async () => {}; m._resetAuthSessions = async () => {}; m._queryScalar = async () => '1';
  m._rotateDailySnapshot = () => {};
  return m;
}

async function container(m, sqlText) {
  const sql = Buffer.from(sqlText);
  const comp = await m._compress(sql);
  return m._buildTcdbFile(m._encrypt(comp), sql.length, comp.length);
}
const DUMP = '-- PostgreSQL database dump\n-- Dumped from database version 17.6\nCOPY public.companies (id, name) FROM stdin;\n1\tSECRET-ROW\n\\.\n';
const produceOld = async () => ({ tcdbBuffer: Buffer.from('OLD-DB'), dumpData: Buffer.from('x'), compressed: Buffer.from('x') });

test('the restore scripts are private temp files, never beside the opened file', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtemp();
  const userDir = path.join(dir, 'Desktop'); fs.mkdirSync(userDir);
  const picked = path.join(userDir, 'Picked.tcdb');
  const m = mgr(dir, picked);
  const f = fakePsql(dir); m.psql = f.script;
  fs.writeFileSync(picked, await container(m, DUMP));
  await m.restore(picked);
  const paths = f.paths();
  assert.ok(paths.length >= 2, 'truncate + restore ran');
  for (const p of paths) assert.notEqual(path.dirname(p), userDir, `${p} must not be in the user's folder`);
  assert.deepEqual(fs.readdirSync(userDir), ['Picked.tcdb'], 'nothing was left beside the file');
  for (const p of paths) assert.ok(!fs.existsSync(p), 'the temp script is removed');
});

test('a failed open that never touched the database goes back to the previous company file and its timer', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtemp();
  const prev = path.join(dir, 'A.tcdb');
  const picked = path.join(dir, 'Picked.tcdb');
  const m = mgr(dir, prev);
  const f = fakePsql(dir); m.psql = f.script;
  fs.writeFileSync(picked, await container(m, DUMP));
  const before = fs.readFileSync(picked);
  let started = 0; m.startSync = () => { started++; };
  const prevSync = { prevTarget: prev, prevSecondary: null, wasSyncing: true };
  m.backupPath = picked;                                   // what restoreTcdbFromPath does before restore()
  process.env.FAIL_TRUNC = '1';
  try {
    await assert.rejects(m.restore(picked).catch((e) => { m.afterFailedRestore(prevSync); throw e; }), /Pre-restore truncate failed/);
  } finally { delete process.env.FAIL_TRUNC; }
  assert.equal(m.lastRestoreTouchedDb, false);
  assert.equal(m.backupPath, prev, 'back on the previous company file');
  assert.equal(started, 1, 'its timer runs again');
  m._produce = produceOld;
  await m.backup();                                        // the final backup at quit / «backup now»
  assert.deepEqual(fs.readFileSync(picked), before, 'the picked file is untouched');
  assert.equal(fs.readFileSync(prev, 'utf8'), 'OLD-DB', 'the previous company keeps its own file');
});

test('a failed open after the database was replaced writes nowhere', async () => {
  const dir = mkdtemp();
  const prev = path.join(dir, 'A.tcdb');
  const picked = path.join(dir, 'Picked.tcdb');
  fs.writeFileSync(picked, 'PICKED');
  const m = mgr(dir, picked);
  m._restoreFile = async () => { m.lastRestoreTouchedDb = true; throw new Error('load failed'); };
  await assert.rejects(m.restore(picked).catch((e) => { m.afterFailedRestore({ prevTarget: prev, prevSecondary: null, wasSyncing: true }); throw e; }), /load failed/);
  assert.equal(m.backupPath, null);
  m._produce = produceOld;
  assert.equal(await m.backup(), null, 'no company file attached: skipped');
  assert.equal(fs.readFileSync(picked, 'utf8'), 'PICKED');
  assert.ok(!fs.existsSync(prev));
});

test('a dump still running when the target moves is written to the file it started for', async () => {
  const dir = mkdtemp();
  const oldT = path.join(dir, 'Old.tcdb');
  const newT = path.join(dir, 'New.tcdb');
  const m = mgr(dir, oldT);
  m._produce = () => new Promise((r) => setTimeout(() => r({ tcdbBuffer: Buffer.from('OLD-DB'), dumpData: Buffer.from('x'), compressed: Buffer.from('x') }), 150));
  const run = m.backup();
  assert.equal(await m.waitIdle(30), false, 'the caller gave up waiting');
  m.backupPath = newT;
  await run;
  assert.equal(fs.readFileSync(oldT, 'utf8'), 'OLD-DB');
  assert.ok(!fs.existsSync(newT), 'the newly opened file never received the old database');
});

test('the app opens one company file at a time (both restore paths) and a failed restore never keeps writing into the opened file', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /async function restoreTcdbFromPath\(selectedPath, opts = \{\}\) \{\s*if \(restoreInFlight\) throw [^\n]*RESTORE_BUSY/);
  assert.match(main, /finally \{ restoreInFlight = false; \}/);
  assert.match(main, /if \(restoreInFlight\) throw [^\n]*RESTORE_BUSY[^\n]*\n\s*restoreInFlight = true; heldRestore = true;/);
  assert.match(main, /if \(heldRestore\) restoreInFlight = false;/);
  assert.equal((main.match(/\.catch\(\(e\) => \{ backupManager\.afterFailedRestore\(prevSync\); throw e; \}\)/g) || []).length, 2);
  assert.match(main, /RESTORE_BUSY: 409/);
});
