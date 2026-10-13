'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pack, unpack, sha256 } = require('../src/baseline-pack');
const { openBaselineStore } = require('../src/baseline-store');
const { mkdtemp } = require('./helpers');

const entries = () => [
  { name: 'production_baseline.sql', data: Buffer.from('CREATE TABLE public.t (id int);\n'.repeat(5000)) },
  { name: 'production_baseline.inventory.json', data: Buffer.from('{"functions_md5":{}}') },
  { name: 'local_extras.sql', data: Buffer.from('-- extras') }, { name: 'reference_seed.sql', data: Buffer.from('-- seed') }, { name: 'storage_stubs.sql', data: Buffer.from('-- stubs') },
];

test('round trip: compressed + encrypted, nothing readable in the blob, every entry intact', () => {
  const key = crypto.randomBytes(32);
  const blob = pack(entries(), key);
  const text = blob.toString('latin1');
  assert.ok(!text.includes('CREATE TABLE'), 'no plaintext in the container');
  assert.ok(blob.length < entries()[0].data.length / 10, 'gzip happened before encryption (repetitive input shrinks)');
  const back = unpack(blob, key);
  for (const e of entries()) assert.ok(back.get(e.name).equals(e.data), e.name);
});

test('a wrong key, one flipped byte, a truncated file or a foreign file are all refused', () => {
  const key = crypto.randomBytes(32);
  const blob = pack(entries(), key);
  assert.throws(() => unpack(blob, crypto.randomBytes(32)), /does not decrypt/);
  for (const at of [10, 20, 40, blob.length - 3]) { const b = Buffer.from(blob); b[at] ^= 1; assert.throws(() => unpack(b, key), /does not decrypt|not a TexaCore/); }
  assert.throws(() => unpack(blob.subarray(0, blob.length - 10), key), /does not decrypt/);
  assert.throws(() => unpack(Buffer.from('hello world, this is not a baseline container at all!!'), key), /not a TexaCore baseline container/);
  assert.throws(() => pack(entries(), Buffer.alloc(16)), /32 bytes/);
});

test('every blob is different (fresh IV) even for the same input and key', () => {
  const key = crypto.randomBytes(32);
  assert.ok(!pack(entries(), key).equals(pack(entries(), key)));
});

test('store: development reads the plain files; the packaged layout reads the container, in memory, and release() drops it', () => {
  // dev layout
  const dev = mkdtemp('dev-'); const boot = mkdtemp('boot-');
  fs.writeFileSync(path.join(dev, 'production_baseline.sql'), 'A'); fs.writeFileSync(path.join(boot, 'local_extras.sql'), 'B');
  const d = openBaselineStore({ baselineDir: dev, bootstrapDir: boot });
  assert.equal(d.packed, false); assert.equal(d.read('production_baseline.sql').toString(), 'A'); assert.equal(d.read('local_extras.sql').toString(), 'B'); assert.equal(d.has('nope.sql'), false);
  // packaged layout
  const key = crypto.randomBytes(32);
  const blob = pack(entries(), key);
  const pk = mkdtemp('pk-');
  fs.writeFileSync(path.join(pk, 'baseline.bin'), blob);
  fs.writeFileSync(path.join(pk, 'PACKED.json'), JSON.stringify({ blobBytes: blob.length, blobSha256: sha256(blob) }));
  const s = openBaselineStore({ baselineDir: pk, bootstrapDir: '/nonexistent', keyProvider: () => key });
  assert.equal(s.packed, true);
  assert.ok(s.read('production_baseline.sql').equals(entries()[0].data));
  assert.equal(s.has('reference_data.sql'), false);
  assert.throws(() => s.read('reference_data.sql'), /missing/);
  const pin = { files: { 'production_baseline.sql': { bytes: entries()[0].data.length, sha256: sha256(entries()[0].data) } } };
  assert.deepEqual(s.verify(pin), []);
  pin.files['production_baseline.sql'].sha256 = '0'.repeat(64);
  assert.match(s.verify(pin).join(), /sha256 differs/);
  s.release();
  assert.ok(s.read('local_extras.sql').equals(Buffer.from('-- extras')), 'reads again after release');
  // a container that does not match PACKED.json is refused before decrypting
  fs.writeFileSync(path.join(pk, 'PACKED.json'), JSON.stringify({ blobBytes: blob.length, blobSha256: '1'.repeat(64) }));
  assert.throws(() => openBaselineStore({ baselineDir: pk, bootstrapDir: '/x', keyProvider: () => key }).read('local_extras.sql'), /differs from PACKED\.json/);
});

test('the build never ships a key in source control, and the installer never writes the decrypted baseline to disk or to a log', () => {
  const gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(gi, /baseline-key\.generated\.js/);
  assert.match(gi, /build\/baseline-pack/);
  const sm = fs.readFileSync(path.join(__dirname, '..', 'src', 'service-manager.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const i = sm.indexOf('async buildDatabase');
  const body = sm.slice(i, sm.indexOf('async verifyBaselineInstall', i));
  assert.doesNotMatch(body, /writeFileSync\([^)]*(baselineSql|baselineStore|storage\b)/i, 'no baseline text is written to a file');
  assert.doesNotMatch(body, /(console\.(log|warn|error)|fileLog)\([^)]*(baselineSql|storage\b|\.toString\(\))/, 'no baseline text is logged');
  assert.match(body, /runPsqlSql\(baselineSql/);
});
