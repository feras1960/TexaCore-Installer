'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const cf = require('../src/company-file');
const { mkdtemp } = require('./helpers');

test('defaultCompanyDir: ~/TexaCore on macOS/Linux (2.0.5 RC2), C:\\TexaCore on Windows - never the old ~/Documents/TexaCore for a new file', () => {
  assert.equal(cf.defaultCompanyDir('darwin', '/Users/me'), path.join('/Users/me', 'TexaCore'));
  assert.equal(cf.defaultCompanyDir('linux', '/home/me'), path.join('/home/me', 'TexaCore'));
  assert.equal(cf.defaultCompanyDir('win32', 'C:\\Users\\me'), 'C:\\TexaCore');
  assert.notEqual(cf.defaultCompanyDir('darwin', '/Users/me'), cf.legacyCompanyDirs('darwin', '/Users/me')[0]);
});

test('safeFileBase: separators and reserved characters go, Arabic stays, nothing empty or dotted comes out', () => {
  assert.equal(cf.safeFileBase('شركة النور / فرع 2'), 'شركة النور فرع 2');
  assert.equal(cf.safeFileBase('..\\..\\evil:name*?'), 'evil name');
  assert.equal(cf.safeFileBase('  .hidden.  '), 'hidden');
  assert.equal(cf.safeFileBase('///'), 'company');
  assert.equal(cf.safeFileBase('', 'x'), 'x');
  assert.equal(cf.safeFileBase('a\u0000b\u001fc'), 'a b c');
  assert.equal(cf.safeFileBase('x'.repeat(300)).length, 100);
  assert.equal(path.basename(cf.safeFileBase('a/b')), cf.safeFileBase('a/b'));
});

test('uniqueTcdbPath: the first free name, " (2)", " (3)"…; an existing company file is never the answer', () => {
  const dir = mkdtemp();
  assert.equal(cf.uniqueTcdbPath(dir, 'Acme'), path.join(dir, 'Acme.tcdb'));
  fs.writeFileSync(path.join(dir, 'Acme.tcdb'), 'x');
  assert.equal(cf.uniqueTcdbPath(dir, 'Acme'), path.join(dir, 'Acme (2).tcdb'));
  fs.writeFileSync(path.join(dir, 'Acme (2).tcdb'), 'x');
  assert.equal(cf.uniqueTcdbPath(dir, 'Acme'), path.join(dir, 'Acme (3).tcdb'));
  assert.throws(() => cf.uniqueTcdbPath(dir, 'Acme', () => true, 5), (e) => e.code === 'NO_FREE_NAME');
  // the name cannot escape the folder
  assert.equal(path.dirname(cf.uniqueTcdbPath(dir, '../../etc/passwd')), dir);
});

test('rsfCompanyFilePlan: beside the Rashid file, named after it, never over an existing .tcdb', () => {
  const dir = mkdtemp();
  const rsf = path.join(dir, 'شركة الرشيد.rsf');
  fs.writeFileSync(rsf, 'rsf');
  const a = cf.rsfCompanyFilePlan(rsf);
  assert.deepEqual([a.dir, a.base, a.tcdbPath], [dir, 'شركة الرشيد', path.join(dir, 'شركة الرشيد.tcdb')]);
  fs.writeFileSync(a.tcdbPath, 'old company file');
  assert.equal(cf.rsfCompanyFilePlan(rsf).tcdbPath, path.join(dir, 'شركة الرشيد (2).tcdb'));
  assert.equal(fs.readFileSync(a.tcdbPath, 'utf8'), 'old company file');
  // upper-case extension, spaces
  assert.equal(cf.rsfCompanyFilePlan(path.join(dir, 'My Co.RSF')).base, 'My Co');
});

test('folderIsWritable: a normal folder yes (created if missing), a read-only one no, with a code', () => {
  const dir = mkdtemp();
  assert.deepEqual(cf.folderIsWritable(path.join(dir, 'new', 'deep')), { ok: true });
  const ro = path.join(dir, 'ro'); fs.mkdirSync(ro); fs.chmodSync(ro, 0o500);
  if (process.getuid && process.getuid() !== 0) {
    const r = cf.folderIsWritable(ro);
    assert.equal(r.ok, false); assert.ok(r.reason);
  }
  fs.chmodSync(ro, 0o700);
});

test('localDateStamp is the LOCAL calendar day (not the UTC one)', () => {
  assert.equal(cf.localDateStamp(new Date(2026, 9, 14, 0, 30)), '2026-10-14');
  assert.equal(cf.localDateStamp(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('the pick registry: an opaque reference, expiry, a cap, and nothing else resolves', () => {
  let t = 1000;
  const reg = cf.createPickRegistry({ ttlMs: 100, max: 2, now: () => t });
  const a = reg.register({ filePath: '/x/a.rsf' });
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(reg.get(a).filePath, '/x/a.rsf');
  assert.equal(reg.get('../../etc/passwd'), null);
  assert.equal(reg.get(undefined), null);
  assert.equal(reg.get('0'.repeat(32)), null);
  t += 101; assert.equal(reg.get(a), null, 'expired');
  const r1 = reg.register({ n: 1 }); const r2 = reg.register({ n: 2 }); const r3 = reg.register({ n: 3 });
  assert.equal(reg.get(r1), null, 'oldest dropped past the cap');
  assert.equal(reg.get(r2).n, 2); assert.equal(reg.get(r3).n, 3);
  reg.drop(r2); assert.equal(reg.get(r2), null);
});

test('looksLikeCloudPlaceholder: a large file with no disk blocks on a Mac; never a small one or another OS', () => {
  assert.equal(cf.looksLikeCloudPlaceholder({ size: 50e6, blocks: 0 }, 'darwin'), true);
  assert.equal(cf.looksLikeCloudPlaceholder({ size: 50e6, blocks: 98000 }, 'darwin'), false);
  assert.equal(cf.looksLikeCloudPlaceholder({ size: 100, blocks: 0 }, 'darwin'), false);
  assert.equal(cf.looksLikeCloudPlaceholder({ size: 50e6, blocks: 0 }, 'win32'), false);
});

test('readFileIdle: reads a normal file whole', async () => {
  const dir = mkdtemp(); const f = path.join(dir, 'a.rsf');
  const data = Buffer.alloc(3 * 1024 * 1024, 7); fs.writeFileSync(f, data);
  assert.ok((await cf.readFileIdle(f)).equals(data));
});

test('readFileIdle: a read that never delivers a byte (an online-only placeholder) gives up with FILE_NOT_LOCAL instead of hanging', async () => {
  const dir = mkdtemp(); const f = path.join(dir, 'cloud.rsf'); fs.writeFileSync(f, 'x'.repeat(10));
  const t0 = Date.now();
  await assert.rejects(
    cf.readFileIdle(f, { idleMs: 80, openStream: () => new Readable({ read() { /* blocks forever */ } }) }),
    (e) => e.code === 'FILE_NOT_LOCAL' && /iCloud/.test(e.message) && /محمّل|محمَّل/.test(e.message) === false || e.code === 'FILE_NOT_LOCAL',
  );
  assert.ok(Date.now() - t0 < 2000);
});

test('readFileIdle: a stall in the MIDDLE of the file is caught too, and a slow-but-moving read is fine', async () => {
  const dir = mkdtemp(); const f = path.join(dir, 'slow.rsf'); fs.writeFileSync(f, 'x');
  let pushed = 0;
  const slow = () => new Readable({ read() { if (pushed < 3) setTimeout(() => this.push(Buffer.from(`c${pushed++}`)), 30); else this.push(null); } });
  assert.equal((await cf.readFileIdle(f, { idleMs: 100, openStream: slow })).toString(), 'c0c1c2');
  let n = 0;
  const stalls = () => new Readable({ read() { if (n++ === 0) this.push(Buffer.from('first')); /* then nothing */ } });
  await assert.rejects(cf.readFileIdle(f, { idleMs: 60, openStream: stalls }), (e) => e.code === 'FILE_NOT_LOCAL');
});

test('readFileIdle: missing file, an old-style iCloud stub, a directory and an over-size file each get their own code', async () => {
  const dir = mkdtemp();
  await assert.rejects(cf.readFileIdle(path.join(dir, 'nope.rsf')), (e) => e.code === 'FILE_NOT_FOUND');
  fs.writeFileSync(path.join(dir, '.gone.rsf.icloud'), 'stub');
  await assert.rejects(cf.readFileIdle(path.join(dir, 'gone.rsf')), (e) => e.code === 'FILE_NOT_LOCAL');
  await assert.rejects(cf.readFileIdle(dir), (e) => e.code === 'FILE_NOT_FOUND');
  fs.writeFileSync(path.join(dir, 'big.rsf'), Buffer.alloc(2048));
  await assert.rejects(cf.readFileIdle(path.join(dir, 'big.rsf'), { maxBytes: 1024 }), (e) => e.code === 'FILE_TOO_LARGE');
});
