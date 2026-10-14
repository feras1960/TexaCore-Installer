'use strict';
// 2.0.2 — the one-off export (exportTo) and the passphrase-protected .tcdb, against the REAL BackupManager with only pg_dump stubbed
// (the file format, the encryption and the checks are the production code). The live backup() path is re-proved here too, because it was
// refactored to share its steps with the export (_produce).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const BackupManager = require('../src/backup-manager');
const { mkdtemp } = require('./helpers');

const DUMP = Buffer.from([
  '-- Dumped from database version 17.6', 'CREATE TABLE public.companies (id uuid, name text);',
  'COPY public.companies (id, name) FROM stdin;', '11111111-1111-1111-1111-111111111111\tSample Co', '\\.', '',
  'COPY public.a (x) FROM stdin;', '\\.', 'COPY public.b (x) FROM stdin;', '\\.', 'COPY public.c (x) FROM stdin;', '\\.', 'COPY public.d (x) FROM stdin;', '\\.', 'COPY public.e (x) FROM stdin;', '\\.', '',
].join('\n'));
const EMPTY_DUMP = Buffer.from('CREATE TABLE public.companies (id uuid);\nCOPY public.companies (id) FROM stdin;\n\\.\n');

function mgr(dir, extra = {}) {
  const m = new BackupManager({ pgBinDir: '/nonexistent', dbPassword: 'x', backupPath: path.join(dir, 'live.tcdb'), encryptionKey: 'texacore-default-backup-key-2026', onProgress: () => {}, onError: () => {}, ...extra });
  m._pgDump = async () => DUMP;
  return m;
}

test('exportTo writes a normal .tcdb that the install opens without any phrase', async () => {
  const dir = mkdtemp();
  const m = mgr(dir);
  const out = await m.exportTo(path.join(dir, 'out', 'a.tcdb'));
  assert.equal(out.encrypted, false);
  assert.ok(fs.statSync(out.path).size > 153);
  assert.equal(fs.readFileSync(out.path).subarray(0, 4).toString('latin1'), 'TCDB');
  const probe = m.probeAccess(fs.readFileSync(out.path));
  assert.equal(probe.usedPassphrase, false);
  // the same bytes restore to the dump: decrypt + gunzip gives the original SQL
  const parsed = m._parseTcdbFile(fs.readFileSync(out.path));
  const sql = await m._decompress(m._decryptParsed(parsed, '').data);
  assert.equal(sql.toString(), DUMP.toString());
});

test('exportTo with a passphrase: it opens only with that phrase, and says which error otherwise', async () => {
  const dir = mkdtemp();
  const m = mgr(dir);
  const out = await m.exportTo(path.join(dir, 'p.tcdb'), { passphrase: 'correct horse' });
  assert.equal(out.encrypted, true);
  const buf = fs.readFileSync(out.path);
  assert.throws(() => m.probeAccess(buf), (e) => e.code === 'TCDB_PASSPHRASE_REQUIRED' && /passphrase/i.test(e.message) && /عبارة مرور/.test(e.message));
  assert.throws(() => m.probeAccess(buf, { passphrase: 'wrong phrase' }), (e) => e.code === 'TCDB_BAD_PASSPHRASE');
  const ok = m.probeAccess(buf, { passphrase: 'correct horse' });
  assert.equal(ok.usedPassphrase, true);
  // an install with a DIFFERENT configured key and the license key still needs the phrase (a protected file is not opened by the install's keys)
  const other = mgr(dir, { encryptionKey: 'some-other-key', fallbackEncryptionKeys: ['a-license-key'] });
  assert.throws(() => other.probeAccess(buf), (e) => e.code === 'TCDB_PASSPHRASE_REQUIRED');
  const sql = await m._decompress(m._decryptParsed(m._parseTcdbFile(buf), 'correct horse').data);
  assert.equal(sql.toString(), DUMP.toString());
});

test('a passphrase given for an UNprotected file is harmless (the install key opens it, usedPassphrase=false)', async () => {
  const dir = mkdtemp();
  const m = mgr(dir);
  const out = await m.exportTo(path.join(dir, 'u.tcdb'));
  assert.equal(m.probeAccess(fs.readFileSync(out.path), { passphrase: 'whatever phrase' }).usedPassphrase, false);
});

test('a damaged file is reported as damaged, not as "needs a passphrase"', async () => {
  const dir = mkdtemp();
  const m = mgr(dir);
  const out = await m.exportTo(path.join(dir, 'd.tcdb'), { passphrase: 'correct horse' });
  const buf = fs.readFileSync(out.path);
  buf[200] ^= 0xff;   // a flipped byte in the payload
  assert.throws(() => m.probeAccess(buf, { passphrase: 'correct horse' }), (e) => e.code === 'TCDB_CORRUPT');
  assert.throws(() => m.probeAccess(buf), (e) => e.code === 'TCDB_CORRUPT');
});

test('exportTo never replaces an existing file (and leaves it byte-identical); overwrite:true is the explicit way', async () => {
  const dir = mkdtemp();
  const m = mgr(dir);
  const target = path.join(dir, 'keep.tcdb');
  fs.writeFileSync(target, 'precious');
  await assert.rejects(m.exportTo(target), (e) => e.code === 'EXPORT_EXISTS');
  assert.equal(fs.readFileSync(target, 'utf8'), 'precious');
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
  await m.exportTo(target, { overwrite: true });
  assert.equal(fs.readFileSync(target).subarray(0, 4).toString('latin1'), 'TCDB');
});

test('exportTo leaves nothing around the file: no snapshots folder, no secondary copy, no temp file; the live file is untouched', async () => {
  const dir = mkdtemp();
  const m = mgr(dir, { secondaryBackupPath: path.join(dir, 'secondary', 'live.tcdb') });
  fs.writeFileSync(path.join(dir, 'live.tcdb'), 'LIVE');
  const out = await m.exportTo(path.join(dir, 'x.tcdb'));
  assert.equal(fs.readFileSync(path.join(dir, 'live.tcdb'), 'utf8'), 'LIVE');
  assert.equal(fs.existsSync(path.join(dir, 'snapshots')), false);
  assert.equal(fs.existsSync(path.join(dir, 'secondary')), false);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['live.tcdb', path.basename(out.path)].sort());
  assert.equal(m._backupCount, 0);
});

test('exportTo of a database with no company data writes nothing (EXPORT_EMPTY)', async () => {
  const dir = mkdtemp();
  const m = mgr(dir);
  m._pgDump = async () => EMPTY_DUMP;
  await assert.rejects(m.exportTo(path.join(dir, 'e.tcdb')), (e) => e.code === 'EXPORT_EMPTY');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('the live backup() still works after sharing its steps with the export: same format, daily snapshot, an empty dump writes nothing', async () => {
  const dir = mkdtemp();
  const m = mgr(dir);
  const stats = await m.backup();
  assert.ok(stats && stats.size > 153 && stats.originalSize === DUMP.length);
  assert.equal(m.probeAccess(fs.readFileSync(m.backupPath)).usedPassphrase, false);
  assert.equal(fs.existsSync(path.join(dir, 'snapshots')), true);
  m._pgDump = async () => EMPTY_DUMP;
  const before = fs.readFileSync(m.backupPath);
  assert.equal(await m.backup(), null);
  assert.ok(fs.readFileSync(m.backupPath).equals(before), 'an empty dump must never replace a good backup');
});

test('restore() asks for the phrase up front: nothing is executed without it (the coded error goes up before psql)', async () => {
  const dir = mkdtemp();
  const m = mgr(dir);
  const out = await m.exportTo(path.join(dir, 'r.tcdb'), { passphrase: 'correct horse' });
  m._executeSql = async () => { throw new Error('psql must not run'); };
  m._truncatePublic = async () => { throw new Error('truncate must not run'); };
  await assert.rejects(m.restore(out.path), (e) => e.code === 'TCDB_PASSPHRASE_REQUIRED');
  await assert.rejects(m.restore(out.path, { passphrase: 'nope nope' }), (e) => e.code === 'TCDB_BAD_PASSPHRASE');
  // with the phrase the decrypt step passes (and the run reaches the database step, which the stub refuses)
  await assert.rejects(m.restore(out.path, { passphrase: 'correct horse' }), /truncate must not run|psql must not run/);
  assert.equal(await m.peekDumpMajor(out.path, { passphrase: 'correct horse' }), 17);
});

test('the file header of an export is the documented v2 container (153 bytes + payload, SHA-256 of the payload)', async () => {
  const dir = mkdtemp();
  const m = mgr(dir);
  const out = await m.exportTo(path.join(dir, 'h.tcdb'), { passphrase: 'correct horse' });
  const b = fs.readFileSync(out.path);
  assert.equal(b.readUInt8(4), 2);
  const encSize = b.readUInt32LE(21);
  assert.equal(b.length, 153 + encSize);
  assert.ok(crypto.createHash('sha256').update(b.subarray(153)).digest().equals(b.subarray(89, 121)));
});
