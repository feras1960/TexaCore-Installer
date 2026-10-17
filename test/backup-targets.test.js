'use strict';
// 2.0.2 - the user can SEE the sync: every file the manager keeps in step (the company file, the program's second copy) with its last
// successful sync and, when it fails, WHY (folder missing / no permission / disk full / a cloud folder not downloaded / the dump failed).
// The REAL BackupManager with only pg_dump stubbed; the failures are real filesystem failures.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const BackupManager = require('../src/backup-manager');
const cf = require('../src/company-file');
const { mkdtemp } = require('./helpers');

const DUMP = Buffer.from(['-- Dumped from database version 17.6', 'CREATE TABLE public.companies (id uuid, name text);', 'COPY public.companies (id, name) FROM stdin;', '11111111-1111-1111-1111-111111111111\tSample Co', '\\.', ''].join('\n'));
function mgr(over = {}) {
  const m = new BackupManager({ pgBinDir: '/nonexistent', dbPassword: 'x', encryptionKey: 'k', onProgress: () => {}, onError: () => {}, ...over });
  m._pgDump = async () => DUMP;
  return m;
}
const isRoot = process.getuid && process.getuid() === 0;

test('a run keeps BOTH targets in step and reports each one: path, ok, last sync, on disk', async () => {
  const dir = mkdtemp(); const app = mkdtemp();
  const m = mgr({ backupPath: path.join(dir, 'Acme.tcdb'), secondaryBackupPath: path.join(app, 'backups', 'Acme.tcdb') });
  assert.deepEqual(m.getTargets().map((t) => [t.role, t.state, t.lastSuccess]), [['primary', 'pending', null], ['copy', 'pending', null]], 'before the first run: waiting');
  const before = Date.now();
  await m.syncNow();
  const st = m.getStatus();
  assert.equal(st.state, 'ok'); assert.equal(st.consecutiveFailures, 0); assert.equal(st.lastError, null);
  assert.equal(st.backupPath, path.join(dir, 'Acme.tcdb'), 'the existing fields are unchanged');
  assert.equal(st.targets.length, 2);
  for (const t of st.targets) {
    assert.equal(t.state, 'ok'); assert.equal(t.exists, true); assert.ok(t.size > 153); assert.equal(t.error, null);
    assert.ok(new Date(t.lastSuccess).getTime() >= before - 1000);
  }
  assert.ok(fs.readFileSync(st.targets[0].path).equals(fs.readFileSync(st.targets[1].path)), 'the program\'s copy is the same file');
  assert.deepEqual(fs.readdirSync(path.join(app, 'backups')), ['Acme.tcdb'], 'no temp file left in the program folder');
});

test('the company folder disappears (deleted / drive unplugged): every run fails with "folder-missing", the count grows, nothing stray is left, and it recovers', async () => {
  const root = mkdtemp(); const dir = path.join(root, 'usb');
  fs.mkdirSync(dir);
  const m = mgr({ backupPath: path.join(dir, 'Acme.tcdb') });
  await m.syncNow();
  assert.equal(m.getStatus().state, 'ok');
  fs.rmSync(dir, { recursive: true });
  await m.syncNow(); await m.syncNow();
  const st = m.getStatus();
  assert.equal(st.state, 'error'); assert.equal(st.consecutiveFailures, 2);
  assert.equal(st.lastError.reason, 'folder-missing'); assert.equal(st.lastError.code, 'ENOENT');
  assert.equal(st.targets[0].state, 'error'); assert.equal(st.targets[0].exists, false);
  assert.equal(fs.existsSync(dir), false, 'the missing folder is REPORTED, not silently re-created');
  fs.mkdirSync(dir);
  assert.ok(await m.syncNow());
  const ok = m.getStatus();
  assert.equal(ok.state, 'ok'); assert.equal(ok.consecutiveFailures, 0); assert.equal(ok.targets[0].error, null);
});

test('no permission: a read-only folder is reported as "no-permission"', { skip: isRoot }, async () => {
  const dir = mkdtemp(); fs.chmodSync(dir, 0o500);
  try {
    const m = mgr({ backupPath: path.join(dir, 'Acme.tcdb') });
    assert.equal(await m.syncNow(), null);
    const st = m.getStatus();
    assert.equal(st.lastError.reason, 'no-permission'); assert.match(st.lastError.code, /EACCES|EPERM/);
  } finally { fs.chmodSync(dir, 0o700); }
});

test('disk full: reported as "disk-full", and the half-written temp file is removed (the old company file is untouched)', async (t) => {
  const dir = mkdtemp();
  const file = path.join(dir, 'Acme.tcdb');
  fs.writeFileSync(file, 'GOOD OLD BACKUP');
  const m = mgr({ backupPath: file });
  t.mock.method(fs, 'writeFileSync', (p, data, ...rest) => { if (String(p).endsWith('.tmp')) { const fd = fs.openSync(p, 'w'); fs.writeSync(fd, 'half'); fs.closeSync(fd); throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }); } return fs.writeFileSync.mock.original(p, data, ...rest); });
  assert.equal(await m.syncNow(), null);
  t.mock.restoreAll();
  const st = m.getStatus();
  assert.equal(st.lastError.reason, 'disk-full');
  assert.equal(fs.readFileSync(file, 'utf8'), 'GOOD OLD BACKUP');
  assert.deepEqual(fs.readdirSync(dir), ['Acme.tcdb'], 'no half file left');
});

test('the dump itself failing (services down) is "dump-failed", not blamed on the folder', async () => {
  const dir = mkdtemp();
  const m = mgr({ backupPath: path.join(dir, 'Acme.tcdb') });
  m._pgDump = async () => { throw Object.assign(new Error('spawn pg_dump ENOENT'), { code: 'ENOENT' }); };
  await m.syncNow();
  assert.equal(m.getStatus().lastError.reason, 'dump-failed');
  assert.equal(m.getStatus().consecutiveFailures, 1);
});

test('the program\'s second copy failing is shown on ITS row only; the company file stays OK', { skip: isRoot }, async () => {
  const dir = mkdtemp(); const ro = mkdtemp(); fs.chmodSync(ro, 0o500);
  try {
    const m = mgr({ backupPath: path.join(dir, 'Acme.tcdb'), secondaryBackupPath: path.join(ro, 'sub', 'Acme.tcdb') });
    await m.syncNow();
    const [p, c] = m.getStatus().targets;
    assert.equal(p.state, 'ok');
    assert.equal(c.state, 'error'); assert.equal(c.error.reason, 'no-permission');
    assert.equal(m.getStatus().state, 'ok', 'the overall state follows the company file; the copy has its own row');
    assert.equal(m.getStatus().consecutiveFailures, 0);
  } finally { fs.chmodSync(ro, 0o700); }
});

test('a run in progress shows "syncing" on every target', async () => {
  const dir = mkdtemp();
  const m = mgr({ backupPath: path.join(dir, 'Acme.tcdb') });
  let release; m._pgDump = () => new Promise((r) => { release = () => r(DUMP); });
  const run = m.syncNow();
  await new Promise((r) => setImmediate(r));
  assert.equal(m.getStatus().state, 'syncing'); assert.equal(m.getTargets()[0].state, 'syncing');
  release(); await run;
  assert.equal(m.getStatus().state, 'ok');
});

// ─── the pure helpers ───
test('classifyFsError', () => {
  const c = (code, stage) => cf.classifyFsError(Object.assign(new Error('x'), { code }), stage).reason;
  assert.equal(c('ENOENT'), 'folder-missing'); assert.equal(c('ENOTDIR'), 'folder-missing');
  assert.equal(c('EACCES'), 'no-permission'); assert.equal(c('EPERM'), 'no-permission'); assert.equal(c('EROFS'), 'no-permission');
  assert.equal(c('ENOSPC'), 'disk-full'); assert.equal(c('EDQUOT'), 'disk-full');
  assert.equal(c('FILE_NOT_LOCAL'), 'not-downloaded'); assert.equal(c('ETIMEDOUT'), 'not-downloaded');
  assert.equal(c('ENOENT', 'dump'), 'dump-failed', 'at the dump stage a missing binary is not a missing folder');
  assert.equal(c('EWHATEVER'), 'unknown'); assert.equal(cf.classifyFsError(new Error('plain')).reason, 'unknown');
});

test('detectCloudFolder: iCloud Drive, Desktop/Documents with iCloud on, OneDrive / Dropbox / Google Drive; a plain folder is null', () => {
  const home = '/Users/x'; const on = (k) => k === 'FXICloudDriveDesktop' || k === 'FXICloudDriveDocuments';
  const d = (dir, o = {}) => cf.detectCloudFolder(dir, { platform: 'darwin', home, flag: () => false, ...o });
  assert.deepEqual(d(`${home}/Library/Mobile Documents/com~apple~CloudDocs/Acme`), { provider: 'icloud' });
  assert.deepEqual(d(`${home}/Desktop/Rashid`, { flag: on }), { provider: 'icloud' });
  assert.deepEqual(d(`${home}/Documents`, { flag: on }), { provider: 'icloud' });
  assert.equal(d(`${home}/Desktop/Rashid`), null, 'Desktop with iCloud Desktop & Documents OFF is just a folder');
  assert.equal(d(`${home}/Downloads/x`, { flag: on }), null);
  assert.equal(d(`${home}/DesktopStuff`, { flag: on }), null, 'a sibling that merely starts with "Desktop"');
  assert.deepEqual(d(`${home}/Library/CloudStorage/OneDrive-Acme/Co`), { provider: 'onedrive' });
  assert.deepEqual(d(`${home}/Library/CloudStorage/GoogleDrive-a@b.c/My Drive`), { provider: 'gdrive' });
  assert.deepEqual(d(`${home}/Dropbox/Acme`), { provider: 'dropbox' });
  assert.deepEqual(cf.detectCloudFolder('C:\\Users\\x\\OneDrive\\Docs', { platform: 'win32', home: 'C:\\Users\\x', flag: () => false }), { provider: 'onedrive' });
  assert.equal(cf.detectCloudFolder('C:\\TexaCore', { platform: 'win32', home: 'C:\\Users\\x', flag: () => false }), null);
  assert.equal(cf.detectCloudFolder('', {}), null);
});

test('programCopyPath: <app data>/backups/<same name>, a free name each time', () => {
  const app = mkdtemp();
  const a = cf.programCopyPath(app, '/Users/x/Desktop/Acme.tcdb');
  assert.equal(a, path.join(app, 'backups', 'Acme.tcdb'));
  fs.mkdirSync(path.join(app, 'backups')); fs.writeFileSync(a, 'another company\'s copy');
  assert.equal(cf.programCopyPath(app, '/Users/x/Desktop/Acme.tcdb'), path.join(app, 'backups', 'Acme (2).tcdb'));
  assert.equal(fs.readFileSync(a, 'utf8'), 'another company\'s copy');
});

// ── 2.0.4: the minute sync and macOS' folder permission ──
test('macOS has not allowed the company file\'s folder (the grant is gone after an update): the sync does NOT write, does NOT touch the folder, says "macos-permission" + the area, and writes again once the permission is back', async () => {
  const dir = mkdtemp();
  const target = path.join(dir, 'Acme.tcdb');
  let verdict = { ok: true };
  const guardCalls = [];
  const m = mgr({ backupPath: target, accessGuard: async (d) => { guardCalls.push(d); return verdict; } });
  assert.ok(await m.syncNow(), 'allowed: the first run writes');
  const mtime0 = fs.statSync(target).mtimeMs; const bytes0 = fs.readFileSync(target);
  assert.deepEqual(guardCalls, [dir], 'the guard is asked about the company file\'s folder');
  verdict = { ok: false, state: 'denied', area: 'documents', code: 'FOLDER_PERMISSION' };
  const statCalls = []; const realStat = fs.statSync;
  fs.statSync = (...a) => { if (String(a[0]).startsWith(dir)) statCalls.push(String(a[0])); return realStat(...a); };
  try {
    assert.equal(await m.syncNow(), null, 'blocked: nothing written');
    const st = m.getStatus();
    assert.equal(st.state, 'error');
    assert.equal(st.lastError.reason, 'macos-permission'); assert.equal(st.lastError.code, 'FOLDER_PERMISSION');
    assert.deepEqual({ state: st.accessBlock.state, area: st.accessBlock.area }, { state: 'denied', area: 'documents' });
    assert.equal(st.targets[0].state, 'error'); assert.equal(st.targets[0].error.reason, 'macos-permission');
    assert.deepEqual(statCalls, [], 'the status itself never stats a folder macOS has not allowed (it would wait for the prompt)');
  } finally { fs.statSync = realStat; }
  assert.ok(fs.readFileSync(target).equals(bytes0) && fs.statSync(target).mtimeMs === mtime0, 'the file was not touched');
  await m.syncNow();
  assert.equal(m.getStatus().consecutiveFailures, 2, 'repeated failures count up (the page turns the dot red)');
  // pending (the prompt is still on screen) is the same refusal, worded as waiting
  verdict = { ok: false, state: 'pending', area: 'documents', code: 'FOLDER_PERMISSION' };
  await m.syncNow();
  assert.equal(m.getStatus().accessBlock.state, 'pending');
  assert.match(m.getStatus().lastError.message, /still asking/);
  // allowed again: the next run writes and the block is gone
  verdict = { ok: true };
  assert.ok(await m.syncNow());
  const ok = m.getStatus();
  assert.equal(ok.state, 'ok'); assert.equal(ok.accessBlock, null); assert.equal(ok.targets[0].error, null);
  assert.ok(fs.statSync(target).mtimeMs > mtime0);
});

test('review F4: the program\'s second copy in ANOTHER folder is guarded too - a blocked folder gets no write and no mkdir, the company file itself is still written, and the copy goes through once allowed', async () => {
  const dir = mkdtemp(); const other = path.join(mkdtemp(), 'later', 'made');
  const target = path.join(dir, 'Acme.tcdb'); const copy = path.join(other, 'Acme.tcdb');
  let verdict = { ok: false, state: 'denied', area: 'documents', code: 'FOLDER_PERMISSION' };
  const asked = [];
  const m = mgr({ backupPath: target, secondaryBackupPath: copy, accessGuard: async (d) => { asked.push(d); return d === other ? verdict : { ok: true }; } });
  assert.ok(await m.syncNow(), 'the company file is written');
  assert.deepEqual(asked, [dir, other], 'asked about the company folder, then the second copy\'s folder');
  assert.equal(fs.existsSync(path.dirname(other)), false, 'the blocked folder was not even created');
  const copyT = m.getStatus().targets.find((t) => t.role === 'copy');
  assert.equal(copyT.state, 'error'); assert.equal(copyT.error.reason, 'macos-permission');
  verdict = { ok: true };
  await m.syncNow();
  assert.equal(fs.existsSync(copy), true, 'allowed: the copy is written');
  assert.equal(m.getStatus().targets.find((t) => t.role === 'copy').state, 'ok');
  // the same folder as the company file is asked about once
  const same = path.join(dir, 'Copy.tcdb'); const asked2 = [];
  const m2 = mgr({ backupPath: path.join(dir, 'B.tcdb'), secondaryBackupPath: same, accessGuard: async (d) => { asked2.push(d); return { ok: true }; } });
  await m2.syncNow();
  assert.deepEqual(asked2, [dir]);
});

test('classifyFsError: FOLDER_PERMISSION is its own reason, distinct from a plain EACCES (the page tells where to switch it on)', () => {
  assert.deepEqual(cf.classifyFsError({ code: 'FOLDER_PERMISSION' }), { code: 'FOLDER_PERMISSION', reason: 'macos-permission' });
  assert.equal(cf.classifyFsError({ code: 'EACCES' }).reason, 'no-permission');
});

test('with no guard (Windows / Linux / an older caller) the sync behaves exactly as before', async () => {
  const dir = mkdtemp();
  const m = mgr({ backupPath: path.join(dir, 'Plain.tcdb') });
  assert.ok(await m.syncNow());
  assert.equal(m.getStatus().accessBlock, null);
});
