'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pack, sha256 } = require('../src/baseline-pack');
const { openMigrationsStore, dirStore } = require('../src/migrations-store');
const { mkdtemp } = require('./helpers');

const MARK = 'synthetic_marker_table_xyz';
const SQL = `BEGIN;\nSELECT 1 FROM ${MARK};\nCOMMIT;\n`;
const entries = () => [
  { name: 'migrations.json', data: Buffer.from(JSON.stringify({ baselineSha256: 'x', migrations: [{ order: 1, name: '20270210z_a', file: '20270210z_a.sql', sha256: sha256(Buffer.from(SQL)) }] })) },
  { name: '20270210z_a.sql', data: Buffer.from(SQL.repeat(200)) },
];
function packedDir(key) {
  const dir = mkdtemp('mst-');
  const blob = pack(entries(), key);
  fs.writeFileSync(path.join(dir, 'migrations.bin'), blob);
  fs.writeFileSync(path.join(dir, 'MIGRATIONS_PACKED.json'), JSON.stringify({ blobBytes: blob.length, blobSha256: sha256(blob) }));
  return { dir, blob };
}

test('the packaged layout reads the encrypted container in memory: manifest + file bytes; nothing readable in the blob; release() drops the copies and the next read decrypts again', () => {
  const key = crypto.randomBytes(32);
  const { dir, blob } = packedDir(key);
  assert.ok(!blob.toString('latin1').includes(MARK), 'no plaintext SQL in migrations.bin');
  const s = openMigrationsStore({ packedDir: dir, devDir: null, keyProvider: () => key });
  assert.equal(s.packed, true); assert.equal(s.available(), true);
  assert.equal(s.manifest().migrations[0].name, '20270210z_a');
  assert.ok(s.read('20270210z_a.sql').equals(Buffer.from(SQL.repeat(200))));
  s.release();
  assert.ok(s.read('20270210z_a.sql').length > 0, 'reads again after release');
  assert.throws(() => s.read('20270210y_missing.sql'), /File not found/);
});

test('a wrong key, a flipped byte, a blob that differs from MIGRATIONS_PACKED.json are all refused', () => {
  const key = crypto.randomBytes(32);
  const { dir, blob } = packedDir(key);
  assert.throws(() => openMigrationsStore({ packedDir: dir, keyProvider: () => crypto.randomBytes(32) }).manifest(), /does not decrypt/);
  const b = Buffer.from(blob); b[b.length - 4] ^= 1;
  fs.writeFileSync(path.join(dir, 'migrations.bin'), b);
  assert.throws(() => openMigrationsStore({ packedDir: dir, keyProvider: () => key }).manifest(), /differs from MIGRATIONS_PACKED\.json/);
});

test('file names are validated: a path or a non-.sql name is never read', () => {
  const key = crypto.randomBytes(32);
  const { dir } = packedDir(key);
  const s = openMigrationsStore({ packedDir: dir, keyProvider: () => key });
  for (const bad of ['../x.sql', 'a/b.sql', 'x.txt', '', null, 'migrations.json']) assert.throws(() => s.read(bad), /not a migration file name/);
  const plain = dirStore(mkdtemp('plain-'));
  assert.throws(() => plain.read('../../etc/passwd'), /not a migration file name/);
});

test('without a container the store falls back to the plain folder (development) - and to nothing at all in a packaged app (devDir null)', () => {
  const dev = mkdtemp('dev-');
  fs.writeFileSync(path.join(dev, 'migrations.json'), JSON.stringify({ migrations: [] }));
  fs.writeFileSync(path.join(dev, 'a.sql'), 'x');
  const d = openMigrationsStore({ packedDir: mkdtemp('empty-'), devDir: dev });
  assert.equal(d.packed, false); assert.equal(d.available(), true); assert.deepEqual(d.manifest(), { migrations: [] }); assert.equal(d.read('a.sql').toString(), 'x');
  const none = openMigrationsStore({ packedDir: mkdtemp('empty-'), devDir: null });
  assert.equal(none.available(), false); assert.equal(none.manifest(), null);
});

test('the build packs the migrations into a SECOND container with the SAME key as the baseline, and no package.json extraResources entry ships a plain migrations folder', () => {
  const packSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'pack-baseline.js'), 'utf8');
  assert.match(packSrc, /pack\(migEntries, key\)/);
  assert.match(packSrc, /migrations\.bin/);
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  for (const r of pkg.build.extraResources) assert.notEqual(r.from, 'migrations', 'a plain migrations folder must not be an extraResource');
  assert.ok(pkg.build.extraResources.some((r) => r.from === 'build/baseline-pack' && r.to === 'baseline'), 'the container comes with the baseline folder');
  assert.ok(!(pkg.build.mac.extraResources || []).concat(pkg.build.win.extraResources || []).some((r) => /migrations/.test(r.from)));
});
