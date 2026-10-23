'use strict';
// 2.0.5 RC2 — «تغيير المكان»: the safe move of the live company file (src/live-file-move.js), against the REAL BackupManager (only pg_dump is
// stubbed) and scratch folders. The old file is never touched; the program points at the new file only after the bytes were proven equal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const BackupManager = require('../src/backup-manager');
const companyFile = require('../src/company-file');
const livePolicy = require('../src/live-file-policy');
const lfm = require('../src/live-file-move');
const { mkdtemp, sha } = require('./helpers');

const DUMP = Buffer.from([
  '-- Dumped from database version 17.6', 'CREATE TABLE public.companies (id uuid, name text);',
  'COPY public.companies (id, name) FROM stdin;', '11111111-1111-1111-1111-111111111111\tSample Co', '\\.', '',
  'COPY public.a (x) FROM stdin;', '\\.', 'COPY public.b (x) FROM stdin;', '\\.', 'COPY public.c (x) FROM stdin;', '\\.', 'COPY public.d (x) FROM stdin;', '\\.', 'COPY public.e (x) FROM stdin;', '\\.', '',
].join('\n'));

function mgr(livePath) {
  const m = new BackupManager({ pgBinDir: '/nonexistent', dbPassword: 'x', backupPath: livePath, encryptionKey: 'texacore-default-backup-key-2026', onProgress: () => {}, onError: () => {}, accessGuard: null });
  m._pgDump = async () => DUMP;
  return m;
}

/** The wiring main.js does, over a scratch config object: the same quiesce / commit shape. */
function harness(root, overrides = {}) {
  const live = path.join(root, 'old', 'Acme.tcdb');
  fs.mkdirSync(path.dirname(live), { recursive: true });
  const bm = mgr(live);
  const config = { companies: [{ name: 'Acme', tcdbPath: live, storagePath: path.dirname(live), copyPath: path.join(root, 'prog', 'Acme.tcdb') }, { name: 'Later', companyId: 'c2', planned: true, plannedTcdbPath: path.join(root, 'later.tcdb') }], storagePath: path.dirname(live), currentDbPath: live };
  const events = [];
  const deps = {
    liveFile: () => bm.backupPath || livePolicy.liveEntryOf(config.companies).tcdbPath,
    pickFolder: async () => ({ canceled: true }),
    requireFolderAccess: async () => {},
    quiesce: async () => {
      if (bm._restoring) return { ok: false };
      const wasSyncing = !!bm._timer;
      bm.stopSync();
      if (!(await bm.waitIdle())) return { ok: false };
      await bm.backup();
      bm.holdWrites = true;
      events.push('paused');
      return { ok: true, resume: (switched) => { bm.holdWrites = false; events.push(`resumed:${switched}`); } };
    },
    probe: (buf) => bm.probeAccess(buf),
    commit: ({ from, to, dir }) => {
      if (bm.backupPath && path.resolve(bm.backupPath) !== path.resolve(from)) throw new Error('the live company file changed while it was being moved');
      config.companies = livePolicy.moveLiveEntry(config.companies, from, to);
      config.storagePath = dir;
      if (config.currentDbPath === from) config.currentDbPath = to;
      bm.backupPath = to;
      events.push('switched');
    },
    ...overrides,
  };
  return { live, bm, config, events, deps, mover: lfm.createLiveFileMover(deps) };
}

test('the happy path: a verified copy in the new folder, the old file kept byte for byte, every pointer switched', async () => {
  const root = mkdtemp();
  const h = harness(root);
  await h.bm.backup();
  const target = path.join(root, 'TexaCore-new');
  const r = await h.mover.move({ dir: target });
  assert.equal(r.success, true, JSON.stringify(r));
  assert.equal(r.kept, true);
  assert.equal(r.from, h.live);
  assert.equal(r.to, path.join(target, 'Acme.tcdb'));
  assert.equal(r.bytes, fs.statSync(r.to).size);
  // the new file is the container the install opens, and equals the old file (the flush happened before the copy, nothing wrote after the pause)
  assert.equal(sha(fs.readFileSync(r.to)), sha(fs.readFileSync(h.live)));
  assert.ok(h.bm.probeAccess(fs.readFileSync(r.to)).version >= 1);
  assert.ok(fs.existsSync(h.live), 'the old file is kept');
  assert.equal(fs.readFileSync(h.live).subarray(0, 4).toString('latin1'), 'TCDB');
  // pointers: backup manager, the live config entry (other fields kept), config.storagePath/currentDbPath; the planned entry is untouched
  assert.equal(h.bm.backupPath, r.to);
  const live = livePolicy.liveEntryOf(h.config.companies);
  assert.equal(live.tcdbPath, r.to); assert.equal(live.storagePath, target); assert.equal(live.copyPath, path.join(root, 'prog', 'Acme.tcdb'));
  assert.equal(h.config.storagePath, target); assert.equal(h.config.currentDbPath, r.to);
  assert.equal(h.config.companies[1].plannedTcdbPath, path.join(root, 'later.tcdb'));
  // no temp file left behind, the writes were held while moving and released after
  assert.deepEqual(fs.readdirSync(target), ['Acme.tcdb']);
  assert.deepEqual(h.events, ['paused', 'switched', 'resumed:true']);
  assert.equal(h.bm.holdWrites, false);
  // the next sync run writes into the NEW file only
  h.bm._pgDump = async () => Buffer.concat([DUMP, Buffer.from('\n-- later\n')]);
  const oldSum = sha(fs.readFileSync(h.live));
  await h.bm.backup();
  assert.equal(sha(fs.readFileSync(h.live)), oldSum, 'the old file is no longer written');
  assert.notEqual(sha(fs.readFileSync(r.to)), oldSum);
});

test('a name that is taken in the new folder is never replaced: the copy gets " (2)"', async () => {
  const root = mkdtemp();
  const h = harness(root);
  await h.bm.backup();
  const target = path.join(root, 'other'); fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'Acme.tcdb'), 'somebody else\'s company file');
  const r = await h.mover.move({ dir: target });
  assert.equal(r.success, true);
  assert.equal(r.to, path.join(target, 'Acme (2).tcdb'));
  assert.equal(fs.readFileSync(path.join(target, 'Acme.tcdb'), 'utf8'), 'somebody else\'s company file');
});

test('SAME_FOLDER: the current folder (also spelled differently, or through a link) is refused and nothing changes', async () => {
  const root = mkdtemp();
  const h = harness(root);
  await h.bm.backup();
  const dir = path.dirname(h.live);
  for (const d of [dir, `${dir}${path.sep}`, path.join(dir, '..', 'old')]) {
    const r = await h.mover.move({ dir: d });
    assert.deepEqual([r.success, r.code], [false, 'SAME_FOLDER']);
  }
  const link = path.join(root, 'link'); fs.symlinkSync(dir, link);
  assert.equal((await h.mover.move({ dir: link })).code, 'SAME_FOLDER');
  assert.deepEqual(h.events, []);
  assert.equal(h.bm.backupPath, h.live);
});

test('CANCELED: no dir and the native window is closed → nothing happens; a dir that is not a string / not absolute is a BAD_REQUEST', async () => {
  const root = mkdtemp();
  const h = harness(root);
  await h.bm.backup();
  assert.deepEqual((({ success, code, canceled }) => ({ success, code, canceled }))(await h.mover.move({})), { success: false, code: 'CANCELED', canceled: true });
  assert.equal((await h.mover.move(undefined)).code, 'CANCELED');
  assert.equal((await h.mover.move({ dir: 42 })).code, 'BAD_REQUEST');
  assert.equal((await h.mover.move({ dir: 'relative/folder' })).code, 'BAD_REQUEST');
  assert.deepEqual(h.events, []);
});

test('no dir → the native chooser answers; its folder is used (the harness stub answers the same way)', async () => {
  const root = mkdtemp();
  const target = path.join(root, 'picked');
  let asked = null;
  const h = harness(root, { pickFolder: async (o) => { asked = o; return { dir: target }; } });
  await h.bm.backup();
  const r = await h.mover.move({});
  assert.equal(r.success, true);
  assert.equal(path.dirname(r.to), target);
  assert.equal(asked.defaultPath, path.dirname(h.live), 'the window opens at the current folder');
});

test('NO_LIVE_FILE: no file recorded, or the recorded file is gone', async () => {
  const root = mkdtemp();
  const h = harness(root);
  assert.equal((await h.mover.move({ dir: path.join(root, 'x') })).code, 'NO_LIVE_FILE', 'recorded but never written');
  const none = lfm.createLiveFileMover({ ...h.deps, liveFile: () => null });
  assert.equal((await none.move({ dir: path.join(root, 'x') })).code, 'NO_LIVE_FILE');
});

test('FOLDER_PERMISSION: macOS has not allowed the folder → answered, nothing is touched or created', async () => {
  const root = mkdtemp();
  const target = path.join(root, 'Protected');
  const h = harness(root, { requireFolderAccess: async (d) => { if (d === target) throw Object.assign(new Error('no permission for the documents folder'), { code: 'FOLDER_PERMISSION', area: 'documents', state: 'denied' }); } });
  await h.bm.backup();
  const r = await h.mover.move({ dir: target });
  assert.deepEqual([r.success, r.code, r.area, r.state], [false, 'FOLDER_PERMISSION', 'documents', 'denied']);
  assert.equal(fs.existsSync(target), false, 'the folder was not even created');
  assert.deepEqual(h.events, []);
});

test('NOT_WRITABLE: a folder that cannot be written (a file in the way / read-only) → answered with the reason', async () => {
  const root = mkdtemp();
  const h = harness(root);
  await h.bm.backup();
  const blocker = path.join(root, 'a-file'); fs.writeFileSync(blocker, 'x');
  const r = await h.mover.move({ dir: path.join(blocker, 'inside') });
  assert.deepEqual([r.success, r.code], [false, 'NOT_WRITABLE']);
  assert.ok(r.reason);
  if (process.getuid && process.getuid() !== 0) {
    const ro = path.join(root, 'ro'); fs.mkdirSync(ro); fs.chmodSync(ro, 0o500);
    try { assert.equal((await h.mover.move({ dir: ro })).code, 'NOT_WRITABLE'); } finally { fs.chmodSync(ro, 0o700); }
  }
  assert.deepEqual(h.events, []);
});

test('NO_SPACE: refused before anything is written when the volume cannot hold the file + the margin; unknown free space does not block', async () => {
  const root = mkdtemp();
  const h = harness(root, { freeBytes: () => 10 });
  await h.bm.backup();
  const r = await h.mover.move({ dir: path.join(root, 'small') });
  assert.deepEqual([r.success, r.code], [false, 'NO_SPACE']);
  assert.ok(r.needed > fs.statSync(h.live).size && r.free === 10);
  assert.deepEqual(h.events, []);
  const unknown = harness(mkdtemp(), { freeBytes: () => null });
  await unknown.bm.backup();
  assert.equal((await unknown.mover.move({ dir: path.join(unknown.live, '..', '..', 'fine') })).success, true);
  assert.equal(lfm.spaceNeeded(0), 1024 * 1024);
  assert.equal(lfm.spaceNeeded(100 * 1024 * 1024), 105 * 1024 * 1024);
  assert.equal(lfm.freeBytesOf('/x', () => { throw new Error('no statfs'); }), null);
  assert.equal(lfm.freeBytesOf('/x', () => ({ bavail: 10, bsize: 4096 })), 40960);
});

test('a disk that fills up while writing → NO_SPACE, the temp file is removed, the old file and pointers are untouched, the sync resumes on the old file', async () => {
  const root = mkdtemp();
  const target = path.join(root, 'full');
  const realFs = fs;
  const h = harness(root);
  await h.bm.backup();
  const failingFs = Object.assign(Object.create(realFs), {
    writeSync: () => { throw Object.assign(new Error('no space left'), { code: 'ENOSPC' }); },
  });
  const mover = lfm.createLiveFileMover({ ...h.deps, fs: failingFs });
  const r = await mover.move({ dir: target });
  assert.deepEqual([r.success, r.code], [false, 'NO_SPACE']);
  assert.deepEqual(fs.readdirSync(target), [], 'no half file left');
  assert.equal(h.bm.backupPath, h.live);
  assert.deepEqual(h.events, ['paused', 'resumed:false']);
  assert.equal(h.bm.holdWrites, false);
});

test('VERIFY_FAILED: a copy whose bytes differ (corrupt write) is removed and nothing switches', async () => {
  const root = mkdtemp();
  const target = path.join(root, 'bad');
  const h = harness(root);
  await h.bm.backup();
  const corruptingFs = Object.assign(Object.create(fs), {
    writeSync(fd, buf, off, len, pos) { const b = Buffer.from(buf); b[b.length - 1] ^= 0xff; return fs.writeSync(fd, b, off, len, pos); },
  });
  const r = await lfm.createLiveFileMover({ ...h.deps, fs: corruptingFs }).move({ dir: target });
  assert.deepEqual([r.success, r.code], [false, 'VERIFY_FAILED']);
  assert.deepEqual(fs.readdirSync(target), []);
  assert.equal(h.bm.backupPath, h.live);
  assert.deepEqual(h.events, ['paused', 'resumed:false']);
});

test('VERIFY_FAILED: identical bytes that are not an openable container are refused too (the probe is part of the proof)', async () => {
  const root = mkdtemp();
  const h = harness(root, { probe: () => { throw Object.assign(new Error('cannot decrypt'), { code: 'TCDB_CORRUPT' }); } });
  await h.bm.backup();
  const r = await h.mover.move({ dir: path.join(root, 'p') });
  assert.equal(r.code, 'VERIFY_FAILED');
  assert.deepEqual(fs.readdirSync(path.join(root, 'p')), []);
});

test('a failing switch (config cannot be saved) removes the new copy and keeps the old pointers; the old file is intact', async () => {
  const root = mkdtemp();
  const target = path.join(root, 'sw');
  const h = harness(root, { commit: () => { throw new Error('disk error while saving the config'); } });
  await h.bm.backup();
  const r = await h.mover.move({ dir: target });
  assert.deepEqual([r.success, r.code], [false, 'MOVE_FAILED']);
  assert.deepEqual(fs.readdirSync(target), []);
  assert.ok(h.bm.probeAccess(fs.readFileSync(h.live)).version >= 1, 'the old file is still a good company file (it only got the last flush)');
  assert.equal(h.bm.backupPath, h.live);
});

test('a restore that re-points the manager during the move aborts the switch (commit refuses) and the copy is removed', async () => {
  const root = mkdtemp();
  const target = path.join(root, 'race');
  const h = harness(root);
  await h.bm.backup();
  const other = path.join(root, 'opened-by-user.tcdb');
  const mover = lfm.createLiveFileMover({ ...h.deps, readSource: async (p) => { h.bm.backupPath = other; return fs.promises.readFile(p); } });
  const r = await mover.move({ dir: target });
  assert.deepEqual([r.success, r.code], [false, 'MOVE_FAILED']);
  assert.deepEqual(fs.readdirSync(target), []);
  assert.equal(h.bm.backupPath, other);
});

test('BUSY: a second move while one runs, or a restore in progress, is refused; the sync is not paused for it', async () => {
  const root = mkdtemp();
  let release; const gate = new Promise((r) => { release = r; });
  const h = harness(root, { pickFolder: async () => { await gate; return { dir: path.join(root, 'slow') }; } });
  await h.bm.backup();
  const first = h.mover.move({});
  const second = await h.mover.move({ dir: path.join(root, 'x') });
  assert.equal(second.code, 'BUSY');
  release();
  assert.equal((await first).success, true);
  h.bm._restoring = true;
  const h2 = harness(mkdtemp());
  await h2.bm.backup(); h2.bm._restoring = true;
  assert.equal((await h2.mover.move({ dir: path.join(mkdtemp(), 'z') })).code, 'BUSY');
  assert.deepEqual(h2.events, []);
});

test('the backup manager writes nothing while writes are held (the minute sync cannot touch either file during the copy)', async () => {
  const root = mkdtemp();
  const m = mgr(path.join(root, 'live.tcdb'));
  m.holdWrites = true;
  assert.equal(await m.backup(), null);
  assert.equal(fs.existsSync(path.join(root, 'live.tcdb')), false);
  m.holdWrites = false;
  assert.ok(await m.backup());
});

test('moveLiveEntry (live-file-policy): the live entry moves, a missing one is made first, planned entries stay; a bad target changes nothing', () => {
  const a = path.join(path.sep, 'a', 'X.tcdb'); const b = path.join(path.sep, 'b', 'X.tcdb');
  const list = [{ name: 'X', tcdbPath: a, storagePath: path.dirname(a), copyPath: '/c/X.tcdb' }, { name: 'P', planned: true, plannedTcdbPath: '/p.tcdb' }];
  const moved = livePolicy.moveLiveEntry(list, a, b);
  assert.deepEqual(moved[0], { name: 'X', tcdbPath: b, storagePath: path.dirname(b), copyPath: '/c/X.tcdb' });
  assert.deepEqual(moved[1], list[1]);
  assert.equal(list[0].tcdbPath, a, 'the input is not mutated');
  assert.deepEqual(livePolicy.moveLiveEntry([{ name: 'P', planned: true, plannedTcdbPath: '/p.tcdb' }], a, b)[0], { name: 'X', tcdbPath: b, storagePath: path.dirname(b) });
  assert.deepEqual(livePolicy.moveLiveEntry([], a, 'relative.tcdb'), []);
  assert.equal(livePolicy.liveEntryOf(moved).tcdbPath, b);
});

test('sameFolder / expandHome / writeFailureCode', () => {
  assert.equal(lfm.sameFolder('/A/b', '/a/B/', 'darwin'), true);
  assert.equal(lfm.sameFolder('/A/b', '/a/B/', 'linux'), false);
  assert.equal(lfm.sameFolder('/a/b', '/a/c', 'darwin'), false);
  assert.equal(lfm.expandHome('~/TexaCore', '/home/u'), path.join('/home/u', 'TexaCore'));
  assert.equal(lfm.expandHome('/abs', '/home/u'), '/abs');
  assert.equal(lfm.writeFailureCode({ code: 'ENOSPC' }), 'NO_SPACE');
  assert.equal(lfm.writeFailureCode({ code: 'EACCES' }), 'NOT_WRITABLE');
  assert.equal(lfm.writeFailureCode({ code: 'FOLDER_PERMISSION' }), 'FOLDER_PERMISSION');
  assert.equal(lfm.writeFailureCode({ code: 'EWHATEVER' }), 'MOVE_FAILED');
});

test('default folder (2.0.5 RC2): ~/TexaCore on macOS/Linux, C:\\TexaCore on Windows; the 2.0.4 folder stays a TexaCore folder for installs that already use it', () => {
  assert.equal(companyFile.defaultCompanyDir('darwin', '/Users/me'), path.join('/Users/me', 'TexaCore'));
  assert.equal(companyFile.defaultCompanyDir('linux', '/home/me'), path.join('/home/me', 'TexaCore'));
  assert.equal(companyFile.defaultCompanyDir('win32', 'C:\\Users\\me'), 'C:\\TexaCore');
  assert.deepEqual(companyFile.legacyCompanyDirs('darwin', '/Users/me'), [path.join('/Users/me', 'Documents', 'TexaCore')]);
  assert.deepEqual(companyFile.legacyCompanyDirs('win32', 'C:\\Users\\me'), []);
  assert.equal(companyFile.isCompanyFolder('/Users/me/TexaCore', 'darwin', '/Users/me'), true);
  assert.equal(companyFile.isCompanyFolder('/Users/me/Documents/TexaCore', 'darwin', '/Users/me'), true, 'an existing install keeps its snapshots beside its file');
  assert.equal(companyFile.isCompanyFolder('/Users/me/Desktop', 'darwin', '/Users/me'), false);
  assert.equal(companyFile.isCompanyFolder('', 'darwin', '/Users/me'), false);
  // iCloud / Documents notice still works for a path under Documents with iCloud on, and ~/TexaCore is a plain folder
  const on = (k) => k === 'FXICloudDriveDocuments' || k === 'FXICloudDriveDesktop';
  assert.deepEqual(companyFile.detectCloudFolder('/Users/me/Documents/TexaCore', { platform: 'darwin', home: '/Users/me', flag: on }), { provider: 'icloud' });
  assert.equal(companyFile.detectCloudFolder('/Users/me/TexaCore', { platform: 'darwin', home: '/Users/me', flag: on }), null);
});

test('wiring: the IPC, the preload bridge and the main-process function exist and use the shared dialog + folder permission + no deletion of the old file', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const pre = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  assert.match(pre, /moveLiveFile:\s*\(opts\)\s*=>\s*ipcRenderer\.invoke\('move-live-file', opts\)/);
  assert.match(main, /ipcMain\.handle\('move-live-file',\s*async \(_, opts\) => moveLiveFile\(opts\)\)/);
  const at = main.indexOf('const liveFileMover = liveFileMove.createLiveFileMover(');
  const block = main.slice(at, main.indexOf("ipcMain.handle('move-live-file'", at));
  assert.ok(at > 0);
  assert.match(block, /showNativeDialog\('open'/, 'the folder chooser is the shared native dialog (the E2E_DIALOG stub answers it in harness runs)');
  assert.match(block, /properties: \['openDirectory', 'createDirectory'\]/);
  assert.match(block, /requireFolderAccess\(dir\)/);
  assert.match(block, /livePolicy\.moveLiveEntry\(/);
  assert.match(block, /holdWrites = true/);
  assert.doesNotMatch(block + fs.readFileSync(path.join(__dirname, '..', 'src', 'live-file-move.js'), 'utf8'), /unlinkSync\((from|d\.liveFile|bm\.backupPath|cfg\.)/, 'the old file is never deleted');
  // a default-folder switch must not re-point what an install already stores
  assert.match(main, /companyFile\.isCompanyFolder\(path\.dirname\(liveTarget\)\)/);
  assert.doesNotMatch(main, /'Documents',\s*'TexaCore'/);
});
