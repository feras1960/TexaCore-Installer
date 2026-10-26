'use strict';
// 2.0.5 — opening a company file REPLACES every company of this computer. The server now (1) reads what would be replaced, (2) refuses
// without an explicit confirmReplaceAll:true (an older page never sends it and gets REPLACE_ALL_CONFIRM_REQUIRED + the list; nothing changes),
// (3) saves a backup of the current companies BEFORE it touches anything, and refuses to go on when that backup cannot be written.
// The helpers are cut out of main.js and run against a fake database; the wiring (every entry point, the order) is pinned on the source.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { mkdtemp } = require('./helpers');
const livePolicy = require('../src/live-file-policy');

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const helpersFrom = main.indexOf('/** What a replace-all would wipe:');
const helpersTo = main.indexOf('// ─── Open a .tcdb: restore it into the running database');
assert.ok(helpersFrom > 0 && helpersTo > helpersFrom);
const helpersSource = main.slice(helpersFrom, helpersTo);

/** A fake `pg`: the queries the snapshot sends are answered from `db`. */
function fakePg(db) {
  return {
    Client: class {
      async connect() { if (db.connectFails) throw new Error('connect ECONNREFUSED'); }
      async end() {}
      async query(sql) {
        if (/FROM public\.companies/.test(sql)) {
          if (db.noCompaniesTable) throw Object.assign(new Error('relation "public.companies" does not exist'), { code: '42P01' });
          if (db.companiesFails) throw Object.assign(new Error('boom'), { code: 'XX000' });
          return { rows: db.companies.map((c) => ({ ...c })) };
        }
        if (/FROM auth\.sessions/.test(sql)) {
          if (db.noSessions) throw Object.assign(new Error('column "refreshed_at" does not exist'), { code: '42703' });
          if (/refreshed_at/.test(sql) && db.oldGoTrue) throw Object.assign(new Error('column "refreshed_at" does not exist'), { code: '42703' });
          return { rows: [{ n: db.sessions, u: db.sessionUsers }] };
        }
        throw new Error('unexpected query: ' + sql);
      }
    },
  };
}

function world(db, { exportBehaviour } = {}) {
  const dataDir = mkdtemp('gate-');
  const exports = [];
  const sandbox = {
    console, process, Buffer, fs, path, livePolicy, DATA_DIR: dataDir,
    require: (m) => (m === 'pg' ? fakePg(db) : require(m)),
    ServiceManager: { PG_PORT: 54322 },
    svcManager: { dbPassword: 'pw' },
    fileLog: () => {},
    liveCompanyFile: () => '/Users/me/Documents/Live.tcdb',
    newBackupManager: (extra) => ({
      exportTo: async (target, opts) => {
        exports.push({ target, opts, extra });
        if (exportBehaviour === 'empty') throw Object.assign(new Error('no company data'), { code: 'EXPORT_EMPTY' });
        if (exportBehaviour === 'fail') throw new Error('disk full');
        fs.writeFileSync(target, 'TCDB-fake');
        return { path: target, size: 9 };
      },
    }),
  };
  vm.createContext(sandbox);
  vm.runInContext(helpersSource + '\n;this.__h = { replaceAllSnapshot, assertReplaceAllConfirmed, takePreOpenBackup };', sandbox);
  return { dataDir, exports, h: sandbox.__h };
}

const plain = (x) => JSON.parse(JSON.stringify(x));   // (objects made inside the vm context have another Object prototype)
const REAL = [{ id: 'c1', name: '2023 مطور بعد الصيانة' }, { id: 'c2', name: 'بروفة العرض' }];

test('snapshot: the companies, the connected sessions and users, and the live file', async () => {
  const w = world({ companies: REAL, sessions: 4, sessionUsers: 2 });
  const s = await w.h.replaceAllSnapshot();
  assert.deepEqual(plain(s.companies), REAL);
  assert.equal(s.sessions, 4);
  assert.equal(s.users, 2);
  assert.equal(s.liveFile, '/Users/me/Documents/Live.tcdb');
});

test('snapshot: an older GoTrue (no refreshed_at) still counts sessions; no auth.sessions at all => unknown (null), never a crash', async () => {
  const old = await world({ companies: REAL, sessions: 1, sessionUsers: 1, oldGoTrue: true }).h.replaceAllSnapshot();
  assert.equal(old.sessions, 1);
  const none = await world({ companies: REAL, noSessions: true }).h.replaceAllSnapshot();
  assert.equal(none.sessions, null);
  assert.deepEqual(plain(none.companies), REAL);
});

test('snapshot: no companies table = an empty database; any other read failure = unknown (null), which the gate treats as "has companies"', async () => {
  assert.deepEqual(plain((await world({ noCompaniesTable: true, sessions: 0, sessionUsers: 0 }).h.replaceAllSnapshot()).companies), []);
  assert.equal((await world({ companiesFails: true, sessions: 0, sessionUsers: 0 }).h.replaceAllSnapshot()).companies, null);
  assert.equal((await world({ connectFails: true }).h.replaceAllSnapshot()).companies, null);
});

test('gate: companies in the database + no yes => REPLACE_ALL_CONFIRM_REQUIRED with the list and the sessions; with the yes it passes', async () => {
  const w = world({ companies: REAL, sessions: 3, sessionUsers: 2 });
  await assert.rejects(w.h.assertReplaceAllConfirmed({}), (e) => {
    assert.equal(e.code, 'REPLACE_ALL_CONFIRM_REQUIRED');
    assert.deepEqual(plain(e.replaceAll.companies), REAL);
    assert.equal(e.replaceAll.sessions, 3);
    return true;
  });
  await assert.rejects(w.h.assertReplaceAllConfirmed({ confirmReplaceAll: 'yes' }), (e) => e.code === 'REPLACE_ALL_CONFIRM_REQUIRED');
  await assert.rejects(w.h.assertReplaceAllConfirmed(), (e) => e.code === 'REPLACE_ALL_CONFIRM_REQUIRED');
  const snap = await w.h.assertReplaceAllConfirmed({ confirmReplaceAll: true });
  assert.deepEqual(plain(snap.companies), REAL);
});

test('gate: an empty database opens a file with no question (a first run, a restore onto a fresh install)', async () => {
  const w = world({ companies: [], sessions: 0, sessionUsers: 0 });
  await assert.doesNotReject(w.h.assertReplaceAllConfirmed({}));
});

test('gate: a database that cannot be read is refused without the yes (and goes through with it)', async () => {
  const w = world({ connectFails: true });
  await assert.rejects(w.h.assertReplaceAllConfirmed({}), (e) => e.code === 'REPLACE_ALL_CONFIRM_REQUIRED' && e.replaceAll.companies === null);
  await assert.doesNotReject(w.h.assertReplaceAllConfirmed({ confirmReplaceAll: true }));
});

test('pre-open backup: companies exist => a .tcdb is written to <data dir>/backups/pre-open with the unified key manager, never over an existing file', async () => {
  const w = world({ companies: REAL, sessions: 0, sessionUsers: 0 });
  const out = await w.h.takePreOpenBackup({ companies: REAL });
  assert.ok(out && out.startsWith(path.join(w.dataDir, 'backups', 'pre-open', 'before-open-')) && out.endsWith('.tcdb'));
  assert.ok(fs.existsSync(out));
  assert.equal(w.exports.length, 1);
  assert.equal(w.exports[0].opts.overwrite, false, 'a backup never replaces another file');
  assert.equal(w.exports[0].opts.passphrase, undefined, 'the unified key: it opens on any TexaCore');
  assert.equal(w.exports[0].extra.backupPath, out);
});

test('pre-open backup: an empty database has nothing to lose - no file is written', async () => {
  const w = world({ companies: [], sessions: 0, sessionUsers: 0 });
  assert.equal(await w.h.takePreOpenBackup({ companies: [] }), null);
  assert.equal(w.exports.length, 0);
});

test('pre-open backup: the dump says "no company data" (EXPORT_EMPTY) => nothing to save, the open may go on', async () => {
  const w = world({ companies: REAL }, { exportBehaviour: 'empty' });
  assert.equal(await w.h.takePreOpenBackup({ companies: REAL }), null);
});

test('pre-open backup: companies exist and the backup FAILS => PRE_OPEN_BACKUP_FAILED - nothing may be replaced', async () => {
  const w = world({ companies: REAL }, { exportBehaviour: 'fail' });
  await assert.rejects(w.h.takePreOpenBackup({ companies: REAL }), (e) => e.code === 'PRE_OPEN_BACKUP_FAILED' && /disk full/.test(e.message));
});

test('pre-open backup: the database could not be read (unknown) and the backup fails => best effort only, the confirmed open is not blocked', async () => {
  const w = world({ connectFails: true }, { exportBehaviour: 'fail' });
  assert.equal(await w.h.takePreOpenBackup({ companies: null }), null);
});

test('pre-open backup: older ones are pruned to the newest 10 - only before-open files', async () => {
  const w = world({ companies: REAL });
  const dir = path.join(w.dataDir, 'backups', 'pre-open');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 1; i <= 12; i++) fs.writeFileSync(path.join(dir, `before-open-2026-01-${String(i).padStart(2, '0')}_000000.tcdb`), 'x');
  fs.writeFileSync(path.join(w.dataDir, 'backups', 'keep-me.tcdb'), 'x');
  await w.h.takePreOpenBackup({ companies: REAL });
  const left = fs.readdirSync(dir).filter((n) => n.startsWith('before-open-'));
  assert.equal(left.length, 10);
  assert.ok(fs.existsSync(path.join(w.dataDir, 'backups', 'keep-me.tcdb')));
});

// ─── wiring: every route that replaces the database goes through the gate, before anything is touched ───

const opener = main.slice(main.indexOf('async function openTcdbFromPathUnlocked('), main.indexOf('const httpServer = http.createServer'));

test('openTcdbFromPathUnlocked: the gate and the pre-open backup come before the manager is created, stopped, re-pointed or restored', () => {
  const gate = opener.indexOf('await assertReplaceAllConfirmed({ confirmReplaceAll })');
  const backup = opener.indexOf('await takePreOpenBackup(replaceSnapshot)');
  assert.ok(gate > 0 && backup > gate);
  for (const later of ['new BackupManager(', 'peekDumpMajor(', 'backupManager.stopSync()', 'backupManager.backupPath = liveTarget', 'backupManager.restore(selectedPath']) {
    const at = opener.indexOf(later);
    assert.ok(at > backup, `${later} must come after the pre-open backup`);
  }
  assert.match(opener, /async function openTcdbFromPathUnlocked\(selectedPath, \{ passphrase = '', confirmReplaceAll = false \} = \{\}\)/);
  assert.match(opener, /preOpenBackup: preOpenBackup \|\| undefined/);
});

test('every route that opens a file passes the explicit yes through - and only an explicit one', () => {
  const picked = main.slice(main.indexOf("case 'POST /api/open-picked-tcdb'"), main.indexOf("case 'GET /api/picked-file'"));
  assert.match(picked, /restoreTcdbFromPath\(item\.filePath, \{ passphrase, confirmReplaceAll: livePolicy\.isConfirmed\(body\.confirmReplaceAll\) \}\)/);
  const getOpen = main.slice(main.indexOf("req.url === '/api/open-tcdb'"), main.indexOf("req.url === '/api/ui-smoke'"));
  assert.match(getOpen, /restoreTcdbFromPath\(selectedPath, \{ confirmReplaceAll: livePolicy\.isConfirmed\(openQuery\.get\('confirmReplaceAll'\)\) \}\)/);
  assert.match(getOpen, /fileErrorStatus\(err\.code\)/);
  assert.match(getOpen, /\.\.\.\(err && err\.replaceAll \? err\.replaceAll : \{\}\)/);
});

test('the multipart upload (/api/restore-tcdb): gate + backup after the file is validated and BEFORE anything is written to the TexaCore folder', () => {
  const up = main.slice(main.indexOf("req.method === 'POST' && req.url === '/api/restore-tcdb'"), main.indexOf('httpServer.listen('));
  const field = up.indexOf('name="confirmReplaceAll"');
  const gate = up.indexOf('await assertReplaceAllConfirmed({ confirmReplaceAll: confirmReplaceAllField })');
  const backup = up.indexOf('await takePreOpenBackup(uploadReplaceSnapshot)');
  const probe = up.indexOf('pm.preflightBuffer(fileData');
  const write = up.indexOf('fs.writeFileSync(tmpPath, fileData');
  const stop = up.indexOf('backupManager.stopSync()');
  assert.ok(probe > 0 && field > probe && gate > field && backup > gate, 'validated first (a refused/legacy file asks nothing), then the yes, then the backup');
  assert.ok(write > backup && stop > backup, 'nothing is written or stopped before the backup');
  assert.match(up, /code === 'RESTORE_BUSY' \|\| err\.code === 'REPLACE_ALL_CONFIRM_REQUIRED' \? 409/);
  assert.match(up, /\.\.\.\(err && err\.replaceAll \? err\.replaceAll : \{\}\)/);
});

test('the IPC restore (backup-restore) is gated the same way', () => {
  const ipc = main.slice(main.indexOf("ipcMain.handle('backup-restore'"), main.indexOf('// ─── RSF Import (Al-Rasheed)'));
  assert.match(ipc, /assertReplaceAllConfirmed\(\{ confirmReplaceAll: opts && opts\.confirmReplaceAll \}\)/);
  assert.ok(ipc.indexOf('takePreOpenBackup(') > 0 && ipc.indexOf('takePreOpenBackup(') < ipc.indexOf('backupManager.restore(filePath)'));
  assert.match(ipc, /\.\.\.\(e && e\.replaceAll \? e\.replaceAll : \{\}\)/);
  const pre = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  assert.match(pre, /restoreBackup: \(filePath, opts\) => ipcRenderer\.invoke\('backup-restore', filePath, opts\)/);
});

test('the coded errors map to a status the page can read: confirm-required is a 409', () => {
  assert.match(main, /REPLACE_ALL_CONFIRM_REQUIRED: 409, PRE_OPEN_BACKUP_FAILED: 500/);
  assert.match(main, /\.\.\.\(err && err\.replaceAll \? err\.replaceAll : \{\}\) \}\);\s*\n\s*else res\.end\(\);/, 'the company-file routes copy the list into the JSON answer');
});

test('the route and IPC the pages ask for the live file exist', () => {
  assert.match(main, /case 'GET \/api\/live-file-info':/);
  assert.match(main, /mode: 'single-file', liveFile: live,/);
  assert.match(main, /return \{ \.\.\.base, liveFile: liveCompanyFile\(\), plannedCompanies: planned \};/);
});
