'use strict';
// 2.0.4: the search for the file the user chose is a JOB: metadata only (name + size + modification time), one protected folder at a time and only once
// macOS has said yes, a placeholder is downloaded with progress, and a path is answered only for a file whose full content hashes equal.
// Scratch folders + fake access / cloud collaborators - never the real profile.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const lj = require('../src/locate-job');
const lf = require('../src/locate-file');
const { mkdtemp, sha } = require('./helpers');

const put = (dir, rel, content, mtimeMs) => {
  const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content);
  if (mtimeMs) { const t = new Date(mtimeMs); fs.utimesSync(f, t, t); }
  return f;
};
const MT = 1760000000000;
const Q = (buf, over = {}) => lf.validateLocateBody({ name: 'Mine.rsf', size: buf.length, lastModified: MT, ...over }, { requireHash: false });
const until = async (fn, ms = 4000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout waiting'); await new Promise((r) => setTimeout(r, 10)); } };

/** a fake folderAccess: `kinds` maps a root path to its area; settle(kind) is whatever the test decides (a function returning a promise). */
function fakeAccess(kinds, settleImpl) {
  const calls = [];
  return {
    calls,
    kindOf: (p) => kinds[p] || null,
    settle: (kind, sample) => { calls.push(kind); return settleImpl(kind, sample); },
  };
}
const allowAll = (kind) => Promise.resolve({ kind, state: 'allowed' });
const localCloud = { cloudState: async () => 'local' };

test('plain folders: exact name + exact size + modification time ±2 s make a candidate; status carries NO path; a different size (the owner\'s second same-name file) is not one', async () => {
  const dir = mkdtemp();
  const buf = Buffer.alloc(5000, 1);
  const real = put(dir, 'حسابات الرشيد/Mine.rsf', buf, MT);
  put(dir, 'Mine.rsf', Buffer.alloc(4096, 2), MT);                 // same name, other size
  put(dir, 'other/Mine.rsf', buf, MT + 60_000);                    // same name + size, another time = a copy made later
  put(dir, 'near/Mine.rsf', buf, MT + 1500);                       // within the 2 s tolerance
  const jobs = lj.createLocateJobs({ folderAccess: fakeAccess({}, allowAll), cloud: localCloud, useMdfind: false, platform: 'darwin' });
  const id = jobs.start(Q(buf), { roots: [dir] });
  const st = await until(async () => { const s = jobs.status(id); return s.phase === 'ready' ? s : null; });
  assert.equal(st.candidates.length, 2, 'the exact one and the one within 2 s');
  assert.ok(st.candidates.every((c) => c.state === 'local' && c.size === buf.length));
  assert.ok(!JSON.stringify(st).includes(dir), 'the status never reveals a path');
  assert.ok(!JSON.stringify(st).includes('حسابات'));
  void real;
});

test('a browser that gave no modification time: every name + size match is a candidate (the hash decides later)', async () => {
  const dir = mkdtemp(); const buf = Buffer.alloc(300, 3);
  put(dir, 'a/Mine.rsf', buf, MT); put(dir, 'b/Mine.rsf', buf, MT + 99_000);
  const jobs = lj.createLocateJobs({ folderAccess: fakeAccess({}, allowAll), cloud: localCloud, useMdfind: false, platform: 'darwin' });
  const id = jobs.start(Q(buf, { lastModified: undefined }), { roots: [dir] });
  const st = await until(async () => { const s = jobs.status(id); return s.phase === 'ready' ? s : null; });
  assert.equal(st.candidates.length, 2);
});

test('nothing there → not-found; and a bad state is told', async () => {
  const dir = mkdtemp();
  const jobs = lj.createLocateJobs({ folderAccess: fakeAccess({}, allowAll), cloud: localCloud, useMdfind: false, platform: 'darwin' });
  const id = jobs.start(Q(Buffer.alloc(10)), { roots: [dir] });
  assert.equal((await until(async () => { const s = jobs.status(id); return s.phase !== 'searching' ? s : null; })).phase, 'not-found');
  await assert.rejects(() => jobs.confirm(id, 'a'.repeat(64)), (e) => e.code === 'BAD_STATE');
  assert.throws(() => jobs.status('nope'), (e) => e.code === 'JOB_EXPIRED');
});

test('a protected folder is not read until macOS says yes: while the prompt is up the phase is waiting-permission; the late "Allow" lets the search run and find the file', async () => {
  const home = mkdtemp(); const desktop = path.join(home, 'Desktop'); fs.mkdirSync(desktop);
  const buf = Buffer.alloc(2000, 5);
  put(desktop, 'Mine.rsf', buf, MT);
  let answer; const prompt = new Promise((r) => { answer = r; });
  const reads = [];
  const fsp = { ...fs.promises, readdir: (...a) => { reads.push(a[0]); return fs.promises.readdir(...a); } };
  const jobs = lj.createLocateJobs({ folderAccess: fakeAccess({ [desktop]: 'desktop' }, () => prompt), cloud: localCloud, useMdfind: false, platform: 'darwin', fsp });
  const id = jobs.start(Q(buf), { roots: [desktop] });
  await new Promise((r) => setTimeout(r, 80));
  const mid = jobs.status(id);
  assert.equal(mid.phase, 'waiting-permission');
  assert.deepEqual(mid.waiting, ['desktop']);
  assert.equal(mid.permissions.desktop.state, 'pending');
  assert.equal(reads.length, 0, 'nothing was listed while the prompt was up');
  answer({ kind: 'desktop', state: 'allowed' });
  const done = await until(async () => { const s = jobs.status(id); return s.phase === 'ready' ? s : null; });
  assert.equal(done.permissions.desktop.state, 'allowed');
  assert.equal(done.candidates.length, 1);
  assert.ok(reads.length > 0);
});

test('"Don\'t Allow": nothing found there → permission-denied with the area named (so the page shows the permission step); a file in an allowed area still wins', async () => {
  const home = mkdtemp(); const desktop = path.join(home, 'Desktop'); const docs = path.join(home, 'Documents');
  fs.mkdirSync(desktop); fs.mkdirSync(docs);
  const buf = Buffer.alloc(1500, 6);
  put(desktop, 'Mine.rsf', buf, MT);
  const verdicts = { desktop: { state: 'denied', code: 'EPERM' }, documents: { state: 'denied', code: 'EPERM' } };
  const access = fakeAccess({ [desktop]: 'desktop', [docs]: 'documents' }, (k) => Promise.resolve({ kind: k, ...verdicts[k] }));
  const jobs = lj.createLocateJobs({ folderAccess: access, cloud: localCloud, useMdfind: false, platform: 'darwin' });
  const id = jobs.start(Q(buf), { roots: [desktop, docs] });
  const st = await until(async () => { const s = jobs.status(id); return s.phase !== 'searching' && s.phase !== 'waiting-permission' ? s : null; });
  assert.equal(st.phase, 'permission-denied');
  assert.deepEqual(st.denied, ['desktop', 'documents']);
  assert.equal(st.candidates.length, 0);
  assert.equal(st.permissions.desktop.code, 'EPERM');
  // Desktop denied, Documents allowed and holding the file
  put(docs, 'Mine.rsf', buf, MT);
  verdicts.documents = { state: 'allowed' };
  const id2 = jobs.start(Q(buf), { roots: [desktop, docs] });
  const st2 = await until(async () => { const s = jobs.status(id2); return s.phase === 'ready' ? s : null; });
  assert.equal(st2.candidates.length, 1);
  assert.deepEqual(st2.denied, ['desktop']);
});

test('the search stops at the first area that yields a candidate: the other areas are never asked about (no needless prompts)', async () => {
  const home = mkdtemp(); const desktop = path.join(home, 'Desktop'); const docs = path.join(home, 'Documents'); const dl = path.join(home, 'Downloads');
  for (const d of [desktop, docs, dl]) fs.mkdirSync(d);
  const buf = Buffer.alloc(900, 8);
  put(desktop, 'x/Mine.rsf', buf, MT);
  const access = fakeAccess({ [desktop]: 'desktop', [docs]: 'documents', [dl]: 'downloads' }, allowAll);
  const jobs = lj.createLocateJobs({ folderAccess: access, cloud: localCloud, useMdfind: false, platform: 'darwin' });
  const id = jobs.start(Q(buf), { roots: [dl, docs, desktop] });   // given in the "wrong" order: the visit order is Desktop, Documents, Downloads
  await until(async () => jobs.status(id).phase === 'ready');
  assert.deepEqual(access.calls, ['desktop']);
});

test('cancel while a prompt is up ends the job at once and leaves nothing running', async () => {
  const home = mkdtemp(); const desktop = path.join(home, 'Desktop'); fs.mkdirSync(desktop);
  const access = fakeAccess({ [desktop]: 'desktop' }, () => new Promise(() => {}));
  const jobs = lj.createLocateJobs({ folderAccess: access, cloud: localCloud, useMdfind: false, platform: 'darwin' });
  const id = jobs.start(Q(Buffer.alloc(10)), { roots: [desktop] });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(jobs.status(id).phase, 'waiting-permission');
  assert.equal(jobs.cancel(id).phase, 'cancelled');
  await jobs._jobs.get(id).running;
  assert.equal(jobs.status(id).phase, 'cancelled');
});

test('a placeholder: found by metadata (no read), downloaded on request with progress, then confirmed by the SHA-256 of the whole content; confirming before it is local is refused', async () => {
  const dir = mkdtemp();
  const buf = Buffer.from('rashid-company-bytes'.repeat(300));
  const f = put(dir, 'Mine.rsf', buf, MT);
  let local = false;
  const cloud = {
    cloudState: async () => (local ? 'local' : 'placeholder'),
    startMaterialize: (p, o) => {
      assert.equal(p, f); assert.equal(o.size, buf.length);
      let loaded = 0; let resolve; const done = new Promise((r) => { resolve = r; });
      const t = setInterval(() => { loaded += 2000; if (loaded >= o.size) { clearInterval(t); loaded = o.size; local = true; resolve({ state: 'done', loaded: o.size, total: o.size }); } }, 15);
      return { snapshot: () => ({ state: 'running', loaded, total: o.size }), cancel: () => { clearInterval(t); resolve({ state: 'cancelled', loaded, total: o.size }); }, done };
    },
  };
  const jobs = lj.createLocateJobs({ folderAccess: fakeAccess({}, allowAll), cloud, useMdfind: false, platform: 'darwin' });
  const id = jobs.start(Q(buf), { roots: [dir] });
  const ready = await until(async () => { const s = jobs.status(id); return s.phase === 'ready' ? s : null; });
  assert.deepEqual(ready.candidates.map((c) => c.state), ['placeholder']);
  await assert.rejects(() => jobs.confirm(id, sha(buf)), (e) => e.code === 'NOT_LOCAL');
  jobs.materialize(id);
  const mid = await until(async () => { const s = jobs.status(id); return s.materialize && s.materialize.loaded > 0 && s.materialize.state === 'running' ? s : null; });
  assert.equal(mid.candidates[0].state, 'downloading');
  assert.equal(mid.materialize.total, buf.length);
  const end = await until(async () => { const s = jobs.status(id); return s.materialize.state === 'done' ? s : null; });
  assert.deepEqual(end.candidates.map((c) => c.state), ['local']);
  const r = await jobs.confirm(id, sha(buf));
  assert.deepEqual({ found: r.found, filePath: r.filePath }, { found: true, filePath: f });
  assert.equal(r.stats.hashed, 1);
});

test('materialize: a failed download is reported on the candidate (not a hang); cancel returns the candidate to "placeholder"', async () => {
  const dir = mkdtemp(); const buf = Buffer.alloc(4000, 9); put(dir, 'Mine.rsf', buf, MT);
  const mk = (final) => ({
    cloudState: async () => 'placeholder',
    startMaterialize: () => { let resolve; const done = new Promise((r) => { resolve = r; }); if (final) setTimeout(() => resolve(final), 20); return { snapshot: () => ({ state: 'running', loaded: 0, total: 4000 }), cancel: () => resolve({ state: 'cancelled', loaded: 0, total: 4000 }), done }; },
  });
  let jobs = lj.createLocateJobs({ folderAccess: fakeAccess({}, allowAll), cloud: mk({ state: 'failed', loaded: 100, total: 4000, code: 'DOWNLOAD_STALLED' }), useMdfind: false, platform: 'darwin' });
  let id = jobs.start(Q(buf), { roots: [dir] });
  await until(async () => jobs.status(id).phase === 'ready');
  jobs.materialize(id);
  const failed = await until(async () => { const s = jobs.status(id); return s.materialize && s.materialize.state === 'failed' ? s : null; });
  assert.equal(failed.materialize.code, 'DOWNLOAD_STALLED');
  assert.deepEqual([failed.candidates[0].state, failed.candidates[0].code], ['failed', 'DOWNLOAD_STALLED']);
  jobs = lj.createLocateJobs({ folderAccess: fakeAccess({}, allowAll), cloud: mk(null), useMdfind: false, platform: 'darwin' });
  id = jobs.start(Q(buf), { roots: [dir] });
  await until(async () => jobs.status(id).phase === 'ready');
  jobs.materialize(id);
  await new Promise((r) => setTimeout(r, 40));
  jobs.cancel(id);
  await jobs._jobs.get(id).mat; // (nothing to await - the state is set by the task)
  const after = await until(async () => { const s = jobs.status(id); return s.materialize && s.materialize.state === 'cancelled' ? s : null; });
  assert.equal(after.candidates[0].state, 'placeholder');
});

test('confirm: only a file whose WHOLE content hashes equal is answered; a different file with the same name, size and time is "none"; identical copies with the same time are "ambiguous"', async () => {
  const dir = mkdtemp();
  const a = Buffer.alloc(3000, 1); const b = Buffer.alloc(3000, 2);
  put(dir, 'one/Mine.rsf', b, MT);
  const jobs = lj.createLocateJobs({ folderAccess: fakeAccess({}, allowAll), cloud: localCloud, useMdfind: false, platform: 'darwin' });
  let id = jobs.start(Q(a), { roots: [dir] });
  await until(async () => jobs.status(id).phase === 'ready');
  const none = await jobs.confirm(id, sha(a));
  assert.equal(none.found, false); assert.equal(none.reason, 'none');
  assert.ok(!('filePath' in none), 'no path for a caller whose bytes do not match');
  put(dir, 'two/Mine.rsf', b, MT);
  id = jobs.start(Q(b), { roots: [dir] });
  await until(async () => jobs.status(id).phase === 'ready');
  const amb = await jobs.confirm(id, sha(b));
  assert.equal(amb.found, false); assert.equal(amb.reason, 'ambiguous');
  await assert.rejects(() => jobs.confirm(id, 'not-hex'), (e) => e.code === 'BAD_REQUEST');
});

test('Spotlight is only a second chance when the walk found nothing', async () => {
  const dir = mkdtemp(); const deep = path.join(dir, 'a/b/c/d/e/f/g/h');   // deeper than the walk goes
  const buf = Buffer.alloc(700, 4); const f = put(deep, 'Mine.rsf', buf, MT);
  const home = dir;
  const execFile = (cmd, args, o, cb) => cb(null, `${f}\n`, '');
  const jobs = lj.createLocateJobs({ folderAccess: fakeAccess({}, allowAll), cloud: localCloud, platform: 'darwin', home, execFile });
  const id = jobs.start(Q(buf), { roots: [dir], deps: { execFile } });
  const st = await until(async () => { const s = jobs.status(id); return s.phase === 'ready' ? s : null; });
  assert.equal(st.stats.spotlight, 1);
  assert.equal(st.candidates[0].area, 'spotlight');
});

test('old jobs are dropped (at most 5 at a time) and an unknown id is JOB_EXPIRED', async () => {
  const dir = mkdtemp();
  const jobs = lj.createLocateJobs({ folderAccess: fakeAccess({}, allowAll), cloud: localCloud, useMdfind: false, platform: 'darwin' });
  const ids = [];
  for (let i = 0; i < 7; i++) ids.push(jobs.start(Q(Buffer.alloc(10)), { roots: [dir] }));
  assert.ok(jobs._jobs.size <= 6);
  jobs.start(Q(Buffer.alloc(10)), { roots: [dir] });
  assert.ok(jobs._jobs.size <= 6);
  assert.throws(() => jobs.status(ids[0]), (e) => e.code === 'JOB_EXPIRED');
});

test('groupRoots: unprotected folders first, then Desktop, Documents, Downloads, iCloud... whatever order they were given in', () => {
  const k = { '/h/Downloads': 'downloads', '/h/Desktop': 'desktop', '/h/Documents/TexaCore': 'documents', '/h/Documents': 'documents', '/h/Library/Mobile Documents/x': 'icloud' };
  const g = lj.groupRoots(['/h/Downloads', '/h/Library/Mobile Documents/x', '/tmp/a', '/h/Documents', '/h/Desktop', '/h/Documents/TexaCore'], (p) => k[p] || null);
  assert.deepEqual(g.map((x) => [x.kind, x.roots.length]), [[null, 1], ['desktop', 1], ['documents', 2], ['downloads', 1], ['icloud', 1]]);
});
