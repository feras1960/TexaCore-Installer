'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { verifyPacked } = require('../scripts/lib/verify-packed');
const { mkdtemp, sha } = require('./helpers');

// build a fake repo + a fake packaged tree that is correct, then break one thing at a time
const { pack } = require('../src/baseline-pack');
const crypto = require('crypto');
function fixture(platform = 'darwin') {
  const repo = mkdtemp('repo-');
  const res = mkdtemp('res-');
  const ver = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ version: ver }));
  const sql = Buffer.from('CREATE TABLE public.t();\n');
  const inv = Buffer.from('{}');
  const pin = { files: {
    'production_baseline.sql': { bytes: sql.length, sha256: sha(sql) },
    'production_baseline.inventory.json': { bytes: inv.length, sha256: sha(inv) },
  } };
  fs.mkdirSync(path.join(repo, 'baseline'));
  fs.writeFileSync(path.join(repo, 'baseline', 'BASELINE_PIN.json'), JSON.stringify(pin));
  // the encrypted container + a key module (random fragments, the same derivation as scripts/pack-baseline.js, here a trivial one)
  const key = crypto.randomBytes(32);
  const blob = pack([{ name: 'production_baseline.sql', data: sql }, { name: 'production_baseline.inventory.json', data: inv }, { name: 'storage_stubs.sql', data: Buffer.from('--') },
    { name: 'local_extras.sql', data: Buffer.from('--') }, { name: 'reference_seed.sql', data: Buffer.from('--') }], key);
  const pk = path.join(res, 'baseline');
  fs.mkdirSync(pk);
  fs.writeFileSync(path.join(pk, 'BASELINE_PIN.json'), JSON.stringify(pin));
  fs.writeFileSync(path.join(pk, 'baseline.bin'), blob);
  fs.writeFileSync(path.join(pk, 'PACKED.json'), JSON.stringify({ blobBytes: blob.length, blobSha256: sha(blob) }));
  const app = path.join(res, 'app');
  fs.mkdirSync(path.join(app, 'src', 'bootstrap'), { recursive: true });
  fs.writeFileSync(path.join(app, 'src', 'baseline-key.generated.js'), `module.exports = () => Buffer.from('${key.toString('hex')}', 'hex');\n`);
  const fe = path.join(res, 'frontend');
  fs.mkdirSync(path.join(fe, 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(fe, 'index.html'), `<html><head><meta name="texacore-app-version" content="${ver}"></head></html>`);
  fs.writeFileSync(path.join(fe, 'fonts', 'fonts.css'), '/* */');
  const exe = (n) => (platform === 'win32' ? `${n}.exe` : n);
  for (const rel of ['pg/bin/postgres', 'pg/bin/initdb', 'pg/bin/psql', 'pg/bin/pg_ctl', 'gotrue/auth', 'postgrest/postgrest']) {
    const p = path.join(res, 'bin', path.dirname(rel), exe(path.basename(rel)));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x');
  }
  fs.mkdirSync(path.join(res, 'bin', 'pg', 'share'), { recursive: true });
  // PostgreSQL's own scripts legitimately contain DDL — bin/pg is not scanned
  fs.writeFileSync(path.join(res, 'bin', 'pg', 'share', 'information_schema.sql'), 'CREATE FUNCTION public.f() ...');
  return { repo, res, key, blob, args: { resourcesDir: res, appCodeDir: app, repoRoot: repo, platform } };
}

test('a complete packaged tree passes', () => {
  assert.deepEqual(verifyPacked(fixture().args), []);
  assert.deepEqual(verifyPacked(fixture('win32').args), []);
});

test('FAILS when the pin was not packaged (the 1.9.0 first-trial failure)', () => {
  const f = fixture();
  fs.rmSync(path.join(f.res, 'baseline', 'BASELINE_PIN.json'));
  assert.match(verifyPacked(f.args).join(), /BASELINE_PIN\.json was NOT packaged/);
});

test('FAILS when the container is missing, altered, truncated or cannot be opened by the packaged key module', () => {
  let f = fixture();
  fs.rmSync(path.join(f.res, 'baseline', 'baseline.bin'));
  assert.match(verifyPacked(f.args).join(), /baseline\.bin was NOT packaged/);
  f = fixture();
  const bin = path.join(f.res, 'baseline', 'baseline.bin');
  const b = fs.readFileSync(bin); b[b.length - 5] ^= 0xff; fs.writeFileSync(bin, b);                       // one flipped byte
  assert.match(verifyPacked(f.args).join(), /differ from PACKED\.json/);
  f = fixture();
  fs.writeFileSync(path.join(f.args.appCodeDir, 'src', 'baseline-key.generated.js'), `module.exports = () => Buffer.alloc(32, 7);\n`);   // another key
  assert.match(verifyPacked(f.args).join(), /cannot open the baseline container/);
  f = fixture();
  fs.rmSync(path.join(f.args.appCodeDir, 'src', 'baseline-key.generated.js'));
  assert.match(verifyPacked(f.args).join(), /baseline-key\.generated\.js is missing/);
});

test('FAILS when a pinned file inside the container is not what the pin says', () => {
  const f = fixture();
  const pk = path.join(f.res, 'baseline', 'BASELINE_PIN.json');
  const pin = JSON.parse(fs.readFileSync(pk, 'utf8'));
  pin.files['production_baseline.sql'].sha256 = 'f'.repeat(64);
  fs.writeFileSync(pk, JSON.stringify(pin)); fs.writeFileSync(path.join(f.repo, 'baseline', 'BASELINE_PIN.json'), JSON.stringify(pin));
  assert.match(verifyPacked(f.args).join(), /production_baseline\.sql differs from the pin/);
});

test('FAILS on ANY plaintext database SQL in the package (baseline files, bootstrap SQL, DDL text in code or data) — but not in PostgreSQL\'s own share files', () => {
  let f = fixture();
  fs.writeFileSync(path.join(f.res, 'baseline', 'production_baseline.sql'), 'CREATE TABLE public.t();\n');
  assert.match(verifyPacked(f.args).join(), /plain baseline files are in the package|plain baseline file in the package/);
  f = fixture();
  fs.writeFileSync(path.join(f.args.appCodeDir, 'src', 'bootstrap', 'local_extras.sql'), '-- x');
  assert.match(verifyPacked(f.args).join(), /src\/bootstrap\/\*\.sql/);
  f = fixture();
  fs.writeFileSync(path.join(f.args.appCodeDir, 'src', 'main.js'), "const x = 'CREATE OR REPLACE FUNCTION public.fn_secret() RETURNS void';");
  assert.match(verifyPacked(f.args).join(), /plaintext database DDL .* in app[\\/]src[\\/]main\.js/);
  f = fixture();
  fs.mkdirSync(path.join(f.res, 'frontend', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(f.res, 'frontend', 'assets', 'a.js'), '..."CREATE TRIGGER trg_x BEFORE INSERT..."');
  assert.match(verifyPacked(f.args).join(), /plaintext database DDL/);
  assert.deepEqual(verifyPacked(fixture().args), [], 'PostgreSQL\'s share/information_schema.sql (which contains CREATE FUNCTION) is allowed');
});

test('FAILS when the packaged pin differs from the repo pin', () => {
  const f = fixture();
  const pk = path.join(f.res, 'baseline', 'BASELINE_PIN.json');
  fs.writeFileSync(pk, fs.readFileSync(pk, 'utf8') + '\n');
  assert.match(verifyPacked(f.args).join(), /differs from the repo pin/);
});

test('FAILS on a wrong web-bundle version, missing fonts, missing binaries', () => {
  let f = fixture();
  fs.writeFileSync(path.join(f.res, 'frontend', 'index.html'), '<meta name="texacore-app-version" content="1.5.45">');
  assert.match(verifyPacked(f.args).join(), /packaged web bundle is 1\.5\.45/);
  f = fixture();
  fs.rmSync(path.join(f.res, 'frontend', 'fonts'), { recursive: true });
  assert.match(verifyPacked(f.args).join(), /local fonts/);
  f = fixture();
  fs.rmSync(path.join(f.res, 'bin', 'pg', 'bin', 'postgres'));
  assert.match(verifyPacked(f.args).join(), /bin\/pg\/bin\/postgres is missing/);
});

test('FAILS when a 1.x migrations manifest rides along', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.res, 'migrations'));
  fs.writeFileSync(path.join(f.res, 'migrations', 'migrations.json'), '{"migrations":[]}');
  assert.match(verifyPacked(f.args).join(), /1\.x migrations/);
});
