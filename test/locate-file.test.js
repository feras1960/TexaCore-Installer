'use strict';
// 2.0.3: the page picks the company file in the BROWSER's own chooser and this app finds the real file again by exact name + exact size + the SHA-256 of
// the whole content (POST /api/locate-picked-file). These tests run on scratch folders - never the real profile.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const lf = require('../src/locate-file');
const { mkdtemp, sha } = require('./helpers');

const HEX = 'a'.repeat(64);
const ok = (over = {}) => ({ name: 'Mine.tcdb', size: 1234, sha256: HEX, lastModified: 1760000000000, ...over });
const query = (buf, over = {}) => ({ name: 'Mine.tcdb', ext: 'tcdb', size: buf.length, sha256: sha(buf), lastModified: null, ...over });
const put = (dir, rel, content) => { const f = path.join(dir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); return f; };

test('validateLocateBody: a plain .rsf / .tcdb name, a positive size up to 1 GiB, 64 hex characters; anything else is BAD_REQUEST', () => {
  const v = lf.validateLocateBody(ok());
  assert.deepEqual(v, { name: 'Mine.tcdb', ext: 'tcdb', size: 1234, sha256: HEX, lastModified: 1760000000000 });
  assert.equal(lf.validateLocateBody(ok({ name: 'شركة النور.RSF' })).ext, 'rsf');
  assert.equal(lf.validateLocateBody(ok({ sha256: 'A'.repeat(64) })).sha256, HEX, 'the digest is lower-cased');
  assert.equal(lf.validateLocateBody(ok({ lastModified: undefined })).lastModified, null);
  assert.equal(lf.validateLocateBody(ok({ size: 1024 ** 3 })).size, 1024 ** 3);
  const bad = (over) => assert.throws(() => lf.validateLocateBody(ok(over)), (e) => e.code === 'BAD_REQUEST', JSON.stringify(over));
  for (const name of ['../Mine.tcdb', 'a/Mine.tcdb', 'a\\Mine.tcdb', '/etc/passwd.tcdb', '.hidden.tcdb', 'Mine.txt', 'Mine', 'Mine.tcdb ', 'Mi\u0000ne.tcdb', 'a..b.tcdb', 'C:\\x.tcdb', '', 5, null, {}, 'x'.repeat(130) + '.tcdb']) bad({ name });
  for (const size of [0, -1, 1.5, 1024 ** 3 + 1, '12', NaN, Infinity, null, undefined]) bad({ size });
  for (const sha256 of ['', 'z'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), null, 12, undefined]) bad({ sha256 });
  for (const lastModified of ['1', NaN, Infinity, -5, {}]) bad({ lastModified });
  for (const body of [null, undefined, 'x', 5, [], [ok()]]) assert.throws(() => lf.validateLocateBody(body), (e) => e.code === 'BAD_REQUEST');
});

test('locateRoots: the harness override replaces everything; otherwise Desktop/Documents/Downloads (+ the OS folders), iCloud Drive, OneDrive*, known company folders, the default folder - existing ones only, once each', () => {
  const dir = mkdtemp();
  const a = path.join(dir, 'a'); const b = path.join(dir, 'b');
  fs.mkdirSync(a); fs.mkdirSync(b);
  assert.deepEqual(lf.locateRoots({ override: [a, b, a] }), [a, b], 'override: no home folders at all');
  const home = path.join(dir, 'home');
  for (const d of ['Desktop', 'Documents', 'Downloads', 'Library/Mobile Documents/com~apple~CloudDocs', 'Library/Application Support/texacore-installer/backups']) fs.mkdirSync(path.join(home, d), { recursive: true });
  const mac = lf.locateRoots({ platform: 'darwin', home, companyDirs: [a, null, path.join(dir, 'missing')], defaultDir: b, extraRoots: [path.join(home, 'Documents')] });
  assert.deepEqual(mac, [
    path.join(home, 'Desktop'), path.join(home, 'Documents'), path.join(home, 'Downloads'),
    path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs'), a, b,
  ]);
  assert.ok(!mac.some((p) => p.includes('Application Support')), 'the program\'s own folder is not a place to look');
  const whome = path.join(dir, 'whome');
  for (const d of ['Desktop', 'OneDrive/Desktop', 'OneDrive - Acme/Documents', 'Onedrivefoo']) fs.mkdirSync(path.join(whome, d), { recursive: true });
  const win = lf.locateRoots({ platform: 'win32', home: whome });
  assert.deepEqual(win, [path.join(whome, 'Desktop'), path.join(whome, 'OneDrive/Desktop'), path.join(whome, 'OneDrive - Acme/Documents')]);
});

test('skipDirName / searchPathAllowed: hidden, node_modules, bundles and the profile\'s Library (but iCloud Drive) are out', () => {
  assert.equal(lf.skipDirName('.git'), true);
  assert.equal(lf.skipDirName('node_modules'), true);
  assert.equal(lf.skipDirName('Pictures.photoslibrary', 'darwin'), true);
  assert.equal(lf.skipDirName('Docs', 'darwin'), false);
  assert.equal(lf.skipDirName('AppData', 'win32'), true);
  const home = '/Users/someone';
  const allowed = (p) => lf.searchPathAllowed(p, { home, platform: 'darwin' });
  assert.equal(allowed(`${home}/Desktop/Mine.tcdb`), true);
  assert.equal(allowed(`${home}/Documents/a/b/Mine.tcdb`), true);
  assert.equal(allowed(`${home}/Library/Mobile Documents/com~apple~CloudDocs/Work/Mine.tcdb`), true);
  assert.equal(allowed(`${home}/Library/Application Support/texacore-installer/backups/Mine.tcdb`), false);
  assert.equal(allowed(`${home}/Library/Mobile Documents/com~apple~Pages/Documents/Mine.tcdb`), false);
  assert.equal(allowed(`${home}/.Trash/Mine.tcdb`), false);
  assert.equal(allowed(`${home}/Documents/node_modules/x/Mine.tcdb`), false);
  assert.equal(allowed('/Users/other/Desktop/Mine.tcdb'), false);
  assert.equal(allowed(`${home}-evil/Desktop/Mine.tcdb`), false);
  assert.equal(allowed('relative/Mine.tcdb'), false);
});

test('mdfindArgs / mdfindCandidates: the name goes in as an ARGUMENT (never a shell string), quotes and backslashes escaped; results are filtered; any failure is just "no candidates"', async () => {
  const args = lf.mdfindArgs('/Users/x', ['A "q" \\b.tcdb']);
  assert.deepEqual(args, ['-onlyin', '/Users/x', 'kMDItemFSName == "A \\"q\\" \\\\b.tcdb"']);
  const calls = [];
  const home = '/Users/x';
  const execFile = (cmd, a, opts, cb) => {
    calls.push({ cmd, a, opts });
    cb(null, [`${home}/Desktop/Mine.tcdb`, `${home}/Library/Application Support/texacore-installer/backups/Mine.tcdb`, `${home}/.Trash/Mine.tcdb`, `${home}/Documents/Other.tcdb`, '', `${home}/Documents/Mine.tcdb`].join('\n'));
  };
  const r = await lf.mdfindCandidates('Mine.tcdb', { home, platform: 'darwin', execFile });
  assert.deepEqual(r, [`${home}/Desktop/Mine.tcdb`, `${home}/Documents/Mine.tcdb`]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'mdfind');
  assert.ok(Array.isArray(calls[0].a) && calls[0].a[0] === '-onlyin' && calls[0].a[1] === home);
  assert.equal(calls[0].opts.timeout, 2000, '2 s');
  assert.equal(calls[0].opts.shell, undefined, 'no shell');
  assert.deepEqual(await lf.mdfindCandidates('Mine.tcdb', { home, platform: 'darwin', execFile: (c, a, o, cb) => cb(new Error('boom'), '') }), []);
  assert.deepEqual(await lf.mdfindCandidates('Mine.tcdb', { home, platform: 'darwin', execFile: () => { throw new Error('ENOENT'); } }), []);
  assert.deepEqual(await lf.mdfindCandidates('Mine.tcdb', { home, platform: 'win32', execFile }), [], 'macOS only');
});

test('walkForFile: breadth-first, depth <= 6, no hidden / node_modules, links never followed (no loops), a time budget', async () => {
  const dir = mkdtemp();
  const deep6 = put(dir, 'a/b/c/d/e/f/Mine.tcdb', 'x');     // 6 folders below the root: allowed
  put(dir, 'a/b/c/d/e/f/g/Mine.tcdb', 'x');                  // 7: too deep
  const top = put(dir, 'Mine.tcdb', 'x');
  put(dir, '.hidden/Mine.tcdb', 'x');
  put(dir, 'node_modules/pkg/Mine.tcdb', 'x');
  put(dir, 'Pic.photoslibrary/Mine.tcdb', 'x');
  put(dir, 'other/Mine.tcdb.bak', 'x');
  put(dir, 'third/mine.tcdb', 'x');                          // another letter case: not the same name
  fs.symlinkSync(dir, path.join(dir, 'loop'));               // a link back to the root
  fs.symlinkSync(path.join(dir, 'a'), path.join(dir, 'linkA'));
  fs.symlinkSync(top, path.join(dir, 'other', 'Mine.tcdb')); // a link named like the file is not a regular file
  const r = await lf.walkForFile([dir, dir], 'Mine.tcdb', { deadline: Date.now() + 10000, platform: 'darwin' });
  assert.deepEqual(r.found.sort(), [deep6, top].sort());
  assert.equal(r.timedOut, false);
  // the time budget: a clock already past the deadline reads nothing
  const t = await lf.walkForFile([dir], 'Mine.tcdb', { deadline: 5, now: () => 10 });
  assert.deepEqual(t.found, []);
  assert.equal(t.timedOut, true);
  // the folder cap
  const c = await lf.walkForFile([dir], 'Mine.tcdb', { deadline: Date.now() + 10000, maxDirs: 1 });
  assert.equal(c.visited, 1);
});

test('a stalled volume cannot hold the answer back: a stat/readdir that never returns is abandoned after the budget (+1 s) and what was found so far is used; a stalled lstat just drops that candidate', async () => {
  const root = mkdtemp();
  const buf = Buffer.from('company file bytes 0123456789');
  const good = put(root, 'ok/Mine.tcdb', buf);
  const hung = path.join(root, 'hung');
  fs.mkdirSync(hung);
  // the real fs except that `hung` never answers (a dead network mount)
  const fsp = { ...fs.promises, stat: (p, o) => (p === hung ? new Promise(() => {}) : fs.promises.stat(p, o)), lstat: (p, o) => (/stalled/.test(p) ? new Promise(() => {}) : fs.promises.lstat(p, o)) };
  put(root, 'ok/stalled/Mine.tcdb', buf);
  const t0 = Date.now();
  const r = await lf.locatePickedFile(query(buf), { roots: [root], useMdfind: false, platform: 'linux', fsp, walkBudgetMs: 150, lstatTimeoutMs: 100, dirTimeoutMs: 50 });
  assert.ok(Date.now() - t0 < 4000, `answered in ${Date.now() - t0} ms`);
  assert.equal(r.found, true);
  assert.equal(r.filePath, good, 'the file the walk reached before the stall');
  assert.equal(await lf.withTimeout(new Promise(() => {}), 20, 'late'), 'late');
  assert.equal(await lf.withTimeout(Promise.reject(new Error('x')), 20, 'failed'), 'failed');
  assert.equal(await lf.withTimeout(Promise.resolve(7), 20, 'late'), 7);
});

test('walkForFile: an unreadable folder is skipped without counting as a stall (three stalls end the walk, any number of unreadable folders do not)', async () => {
  const root = mkdtemp();
  const f = put(root, 'z/Mine.tcdb', 'x');
  for (let i = 0; i < 5; i++) fs.mkdirSync(path.join(root, `a${i}`));
  const fsp = { ...fs.promises, readdir: (p, o) => (/[\\/]a\d$/.test(p) ? Promise.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' })) : fs.promises.readdir(p, o)) };
  const r = await lf.walkForFile([root], 'Mine.tcdb', { deadline: Date.now() + 10000, fsp });
  assert.deepEqual(r.found, [f]);
  const hang = { ...fs.promises, stat: (p, o) => (/[\\/]a\d$/.test(p) ? new Promise(() => {}) : fs.promises.stat(p, o)) };
  const h = await lf.walkForFile([root], 'Mine.tcdb', { deadline: Date.now() + 10000, fsp: hang, dirTimeoutMs: 30 });
  assert.equal(h.timedOut, true, 'three stalled folders end the walk');
  assert.deepEqual(h.found, [], 'z/ was queued after the stalled a0..a4');
});

test('sha256FileIdle: the digest of the whole content; a stalled read and a file that grows past its size are abandoned', async () => {
  const dir = mkdtemp();
  const f = put(dir, 'x.tcdb', Buffer.from('hello world'));
  const r = await lf.sha256FileIdle(f);
  assert.equal(r.hex, sha(Buffer.from('hello world')));
  assert.equal(r.bytes, 11);
  const stall = () => new Readable({ read() { /* never delivers */ } });
  await assert.rejects(lf.sha256FileIdle(f, { idleMs: 30, openStream: stall }), (e) => e.code === 'FILE_NOT_LOCAL');
  await assert.rejects(lf.sha256FileIdle(f, { expectedSize: 5 }), (e) => e.code === 'SIZE_CHANGED');
  await assert.rejects(lf.sha256FileIdle(path.join(dir, 'missing.tcdb')), (e) => e.code === 'FILE_READ_FAILED');
});

// ── locatePickedFile ──
const locate = (q, roots, extra = {}) => lf.locatePickedFile(q, { roots, useMdfind: false, platform: 'linux', ...extra });

test('locatePickedFile: one file with the same name, size and content is found; its path is the answer', async () => {
  const root = mkdtemp();
  const buf = Buffer.from('company file bytes 0123456789');
  const f = put(root, 'Docs/Clients/Mine.tcdb', buf);
  const r = await locate(query(buf), [root]);
  assert.equal(r.found, true);
  assert.equal(r.filePath, f);
  assert.equal(r.stats.matches, 1);
});

test('locatePickedFile: two files with the same name AND size but different content - only the matching one is used (and the other is never reported)', async () => {
  const root = mkdtemp();
  const mine = Buffer.from('AAAAAAAAAAAAAAAAAAAA');
  const other = Buffer.from('BBBBBBBBBBBBBBBBBBBB');
  assert.equal(mine.length, other.length);
  const fMine = put(root, 'one/Mine.tcdb', mine);
  const fOther = put(root, 'two/Mine.tcdb', other);
  let r = await locate(query(mine), [root]);
  assert.equal(r.found, true); assert.equal(r.filePath, fMine);
  assert.equal(r.stats.candidates, 2); assert.equal(r.stats.hashed, 2); assert.equal(r.stats.matches, 1);
  r = await locate(query(other), [root]);
  assert.equal(r.found, true); assert.equal(r.filePath, fOther);
});

test('locatePickedFile: SECURITY - a digest nobody holds reveals no path, however many same-name same-size files exist; no path appears anywhere in the answer', async () => {
  const root = mkdtemp();
  const buf = Buffer.from('secret company data 12345');
  put(root, 'x/Mine.tcdb', buf); put(root, 'y/Mine.tcdb', Buffer.from('another company data 123'.padEnd(buf.length, '.')));
  const r = await locate(query(buf, { sha256: sha(Buffer.from('not the file')) }), [root]);
  assert.equal(r.found, false);
  assert.equal(r.reason, 'none');
  assert.equal(r.filePath, undefined);
  assert.ok(!JSON.stringify(r).includes(root), 'the answer carries counts only');
  // a wrong size finds nothing even with the right digest
  const w = await locate(query(buf, { size: buf.length + 1 }), [root]);
  assert.equal(w.found, false); assert.equal(w.stats.candidates, 0);
  // a file that changed between listing and hashing (bytes differ from the size) is not a match
  const g = await locate(query(buf), [root], { hashFile: async () => ({ hex: sha(buf), bytes: buf.length + 3 }) });
  assert.equal(g.found, false);
});

test('locatePickedFile: not found when the file is outside the searched roots', async () => {
  const roots = mkdtemp(); const elsewhere = mkdtemp();
  const buf = Buffer.from('bytes bytes bytes');
  put(elsewhere, 'Mine.tcdb', buf);
  const r = await locate(query(buf), [roots]);
  assert.equal(r.found, false); assert.equal(r.reason, 'none');
});

test('locatePickedFile: a SINGLE match must carry the browser\'s modification time too (rv203 S1: a copy in Desktop is not the file chosen on a USB stick)', async () => {
  const root = mkdtemp();
  const buf = Buffer.from('only one copy in the searched folders');
  const a = put(root, 'Mine.tcdb', buf);
  const t0 = Date.now() / 1000 - 86400 * 2; fs.utimesSync(a, t0, t0);
  const mt = fs.statSync(a).mtimeMs;
  let r = await locate(query(buf, { lastModified: mt + 1500 }), [root]);
  assert.equal(r.found, true); assert.equal(r.filePath, a);
  r = await locate(query(buf, { lastModified: mt + 3600 * 1000 }), [root]);
  assert.equal(r.found, false); assert.equal(r.reason, 'mtime');
  r = await locate(query(buf), [root]);   // no time reported: the content match alone decides
  assert.equal(r.found, true);
});

test('locatePickedFile: identical copies - the one with the browser\'s modification time wins (+-2 s); still ambiguous otherwise; a hard link is one file', async () => {
  const root = mkdtemp();
  const buf = Buffer.from('same content in two places');
  const a = put(root, 'orig/Mine.tcdb', buf); const b = put(root, 'copy/Mine.tcdb', buf);
  const t0 = Date.now() / 1000 - 86400 * 3;
  fs.utimesSync(a, t0, t0); fs.utimesSync(b, t0 + 3600, t0 + 3600);
  const mt = fs.statSync(a).mtimeMs;
  let r = await locate(query(buf, { lastModified: mt + 1500 }), [root]);
  assert.equal(r.found, true); assert.equal(r.filePath, a);
  r = await locate(query(buf, { lastModified: fs.statSync(b).mtimeMs }), [root]);
  assert.equal(r.found, true); assert.equal(r.filePath, b);
  r = await locate(query(buf, { lastModified: mt + 60000 }), [root]);
  assert.equal(r.found, false); assert.equal(r.reason, 'ambiguous');
  r = await locate(query(buf), [root]);
  assert.equal(r.found, false); assert.equal(r.reason, 'ambiguous');
  // two copies with the SAME time cannot be told apart either
  fs.utimesSync(b, t0, t0);
  r = await locate(query(buf, { lastModified: mt }), [root]);
  assert.equal(r.reason, 'ambiguous');
  // a hard link is the same file, not a second candidate
  const root2 = mkdtemp();
  const h1 = put(root2, 'a/Mine.tcdb', buf); fs.linkSync(h1, path.join(root2, 'Mine.tcdb'));
  r = await locate(query(buf), [root2]);
  assert.equal(r.found, true);
  assert.equal(r.stats.candidates, 1);
});

test('locatePickedFile: Spotlight candidates are merged with the walk, deduplicated, and an evicted cloud placeholder is never read', async () => {
  const home = mkdtemp();
  const root = path.join(home, 'Desktop');
  const buf = Buffer.from('company bytes 0123456789 company bytes 0123456789');
  const viaWalk = put(root, 'Mine.tcdb', buf);
  const viaSpot = put(home, 'Elsewhere/Mine.tcdb', buf);
  const hourAgo = Date.now() / 1000 - 3600; fs.utimesSync(viaWalk, hourAgo, hourAgo);
  const execFile = (c, a, o, cb) => cb(null, `${viaSpot}\n${viaWalk}\n`);
  let r = await lf.locatePickedFile(query(buf, { lastModified: fs.statSync(viaSpot).mtimeMs }), { roots: [root], home, platform: 'darwin', execFile, useMdfind: true });
  assert.equal(r.stats.spotlight, 2);
  assert.equal(r.stats.candidates, 2, 'the file both sources report counts once');
  // both identical, the browser's time matches the first copy only
  assert.equal(r.found, true);
  // a placeholder (big, no blocks, macOS) is skipped and never hashed
  const fsp = { ...fs.promises, lstat: async (p, o) => { const st = await fs.promises.lstat(p, o); return p === viaSpot ? Object.create(st, { blocks: { value: 0 }, size: { value: 70 * 1024 } }) : st; } };
  const big = Buffer.alloc(70 * 1024, 7);
  const bigSpot = put(home, 'Cloud/Mine.tcdb', big);
  const hashed = [];
  r = await lf.locatePickedFile(query(big), { roots: [], home, platform: 'darwin', execFile: (c, a, o, cb) => cb(null, `${bigSpot}\n`), useMdfind: true, fsp: { ...fs.promises, lstat: async (p) => { const st = await fs.promises.lstat(p); return Object.create(st, { blocks: { value: 0 } }); } }, hashFile: async (p) => { hashed.push(p); return { hex: sha(big), bytes: big.length }; } });
  assert.equal(r.found, false);
  assert.deepEqual(hashed, [], 'no read, so no download');
  assert.equal(r.stats.candidates, 0);
  void fsp;
});

test('locatePickedFile: at most 12 candidates are hashed; the hashing has its own budget', async () => {
  const root = mkdtemp();
  const buf = Buffer.alloc(40, 1);
  for (let i = 0; i < 20; i++) put(root, `d${i}/Mine.tcdb`, Buffer.alloc(40, 2 + (i % 5)));
  const seen = [];
  const r = await locate(query(buf), [root], { hashFile: async (p) => { seen.push(p); return { hex: '0'.repeat(64), bytes: 40 }; } });
  assert.equal(r.found, false);
  assert.equal(seen.length, 12);
  let tick = 0;
  const seen2 = [];
  await locate(query(buf), [root], { now: () => (tick += 40000), hashFile: async (p) => { seen2.push(p); return { hex: '0'.repeat(64), bytes: 40 }; } });
  assert.ok(seen2.length < 12, 'the hash budget stops the loop');
});

// ── the route (main.js is not loadable without Electron: the wiring is checked in the source) ──
const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const routeAt = main.indexOf("case 'POST /api/locate-picked-file'");
const route = main.slice(routeAt, main.indexOf("// ── POST /api/open-picked-tcdb"));

test('the route is guarded like the other company-file routes and validates the body before it looks at the disk', () => {
  const set = main.slice(main.indexOf('const DESTRUCTIVE_API = new Set(['), main.indexOf(']);', main.indexOf('const DESTRUCTIVE_API')));
  assert.match(set, /'\/api\/locate-picked-file'/);
  assert.ok(routeAt > 0);
  const validate = route.indexOf('validateLocateBody(await readJsonBody(req))');
  const search = route.indexOf('locatePickedFile(');
  assert.ok(validate > 0 && search > validate, 'validate, then search');
  assert.match(main, /LOCATE_BUSY: 429/);
});

test('the route reveals a path only through a located (hash-verified) file, registers it like a native pick, and logs counts - never candidate lists', () => {
  assert.match(route, /if \(!r\.found\) \{[\s\S]*code: 'NOT_FOUND'[\s\S]*return true;\s*\}/);
  assert.match(route, /code: 'NOT_FOUND', reason: 'ambiguous'/);
  const reg = route.indexOf('registerPickedFile(r.filePath, q.ext)');
  assert.ok(reg > route.indexOf('if (!r.found)'), 'registered only after the not-found branch returned');
  assert.equal((main.match(/registerPickedFile\(/g) || []).length, 3, 'the helper + the native pick + the located pick: one answer shape');
  // no log line prints a list of paths: the count line holds r.stats numbers only, the other logs the one chosen path
  const logs = route.split('\n').filter((l) => /fileLog\(/.test(l));
  assert.equal(logs.length, 2);
  const countLine = logs.find((l) => l.includes("'[Pick] locate'"));
  assert.ok(countLine);
  for (const m of countLine.matchAll(/\$\{([^}]*)\}/g)) assert.match(m[1], /^r\.stats\.\w+( \? ' \(time budget\)' : '')?$/, m[1]);
  assert.match(route, /fileLog\('\[Pick\] located', q\.ext, r\.filePath\)/);
  assert.doesNotMatch(route, /JSON\.stringify\(r\)|r\.stats\.[a-z]+List/);
});

test('only an isolated test run may change where the route looks (TEXACORE_E2E_LOCATE_ROOTS), and then it never asks Spotlight about the real profile', () => {
  assert.match(route, /HARNESS_OK && process\.env\.TEXACORE_E2E_LOCATE_ROOTS/);
  assert.match(route, /useMdfind: !override/);
});

test('the located file is registered through the SAME registry and answer shape as a native pick (type, ref, name, filePath, dir, size, cloudFolder, companyFilePath)', () => {
  const fn = main.slice(main.indexOf('function registerPickedFile('), main.indexOf('let locateInFlight'));
  for (const k of ['success: true', 'type: ext', 'ref', 'name: path.basename(filePath)', 'filePath', 'dir: path.dirname(filePath)', 'size:', 'cloudOnly', 'cloudFolder', 'companyFilePath: ext === \'rsf\'']) assert.ok(fn.includes(k), k);
  assert.match(fn, /pickedFiles\.register\(/);
});
