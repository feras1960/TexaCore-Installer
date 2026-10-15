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
  // the Cloud Access connector (mac: pinned file, executable; win: cloudflared.exe)
  const cfBytes = Buffer.from('cloudflared-stand-in');
  const cfPath = path.join(res, 'bin', 'cloudflared', platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  fs.mkdirSync(path.dirname(cfPath), { recursive: true });
  fs.writeFileSync(cfPath, cfBytes); fs.chmodSync(cfPath, 0o755);
  fs.mkdirSync(path.join(res, 'bin', 'pg', 'share'), { recursive: true });
  // PostgreSQL's own scripts legitimately contain DDL — bin/pg is not scanned
  fs.writeFileSync(path.join(res, 'bin', 'pg', 'share', 'information_schema.sql'), 'CREATE FUNCTION public.f() ...');
  return { repo, res, key, blob, cfPath, args: { resourcesDir: res, appCodeDir: app, repoRoot: repo, platform, cloudflaredPin: { sha256: sha(cfBytes), bytes: cfBytes.length } } };
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

test('FAILS when the macOS package has no cloudflared (2.0.0: Cloud Access dead, Cloudflare error 1033), another build of it, or a non-executable one; Windows needs cloudflared.exe', () => {
  let f = fixture();
  fs.rmSync(f.cfPath);
  assert.match(verifyPacked(f.args).join(), /bin\/cloudflared\/cloudflared is missing/);
  f = fixture();
  fs.writeFileSync(f.cfPath, 'some other binary');
  assert.match(verifyPacked(f.args).join(), /not the pinned build/);
  f = fixture();
  fs.chmodSync(f.cfPath, 0o644);
  assert.match(verifyPacked(f.args).join(), /not executable/);
  f = fixture('win32');
  fs.rmSync(f.cfPath);
  assert.match(verifyPacked(f.args).join(), /cloudflared\.exe is missing/);
});

// ── 2.0.2: the incremental migrations ship ONLY inside the encrypted container (baseline/migrations.bin, same format and key as the baseline), exactly the repo's pin.
//    There is NO plaintext exception: not a folder, not a single .sql file. ──
const MM = require('../scripts/lib/migrations-manifest');
function withMigrations(f, mutate) {
  const sql = Buffer.from('BEGIN;\nSELECT 1;\nCOMMIT;\n');
  const pinSha = JSON.parse(fs.readFileSync(path.join(f.repo, 'baseline', 'BASELINE_PIN.json'), 'utf8')).files['production_baseline.sql'].sha256;
  const inv = { catalogDelta: { tables: 1 }, functions: {}, removed: [] };
  const invBuf = Buffer.from(JSON.stringify(inv, null, 2) + '\n');
  const mpin = { schema: 1, baselineSha256: pinSha, erpCommit: 'c', migrations: [{ order: 1, name: '20270210z_x', file: '20270210z_x.sql', sha256: sha(sql), bytes: sql.length }], inventory: { file: MM.INVENTORY_FILE, sha256: sha(invBuf), bytes: invBuf.length } };
  const manifest = MM.buildManifest(mpin, inv);
  const parts = { pin: mpin, manifest, entries: [{ name: 'migrations.json', data: null }, { name: '20270210z_x.sql', data: sql }], key: f.key };
  mutate && mutate(parts, f);
  fs.writeFileSync(path.join(f.repo, 'baseline', MM.PIN_FILE), JSON.stringify(parts.pin));
  fs.writeFileSync(path.join(f.repo, 'baseline', MM.INVENTORY_FILE), invBuf);
  parts.entries[0].data = Buffer.from(JSON.stringify(parts.manifest));
  const blob = pack(parts.entries.filter((e) => e.data), parts.key);
  const pk = path.join(f.res, 'baseline');
  fs.writeFileSync(path.join(pk, 'migrations.bin'), blob);
  fs.writeFileSync(path.join(pk, 'MIGRATIONS_PACKED.json'), JSON.stringify({ blobBytes: blob.length, blobSha256: sha(blob) }));
  return f;
}
test('a package whose migrations are inside the encrypted container, exactly the repo\'s pin, passes (mac and win); nothing plain rides along', () => {
  assert.deepEqual(verifyPacked(withMigrations(fixture()).args), []);
  assert.deepEqual(verifyPacked(withMigrations(fixture('win32')).args), []);
});
test('FAILS when ANY plaintext migration is in the package: a resources/migrations folder, a lone .sql file (even one that matches the pin byte for byte), plain files beside the container - there is no exception list', () => {
  let f = withMigrations(fixture());
  fs.mkdirSync(path.join(f.res, 'migrations'));
  fs.writeFileSync(path.join(f.res, 'migrations', 'migrations.json'), '{"baselineSha256":"x","migrations":[]}');
  assert.match(verifyPacked(f.args).join(), /plaintext migrations folder/);
  f = withMigrations(fixture());
  fs.writeFileSync(path.join(f.res, 'frontend', '20270210z_x.sql'), 'BEGIN;\nSELECT 1;\nCOMMIT;\n');          // the exact pinned bytes, in a plain file
  assert.match(verifyPacked(f.args).join(), /a plain \.sql file in the package: .*20270210z_x\.sql/);
  f = withMigrations(fixture());
  fs.writeFileSync(path.join(f.res, 'baseline', 'migrations.json'), '{}');
  assert.match(verifyPacked(f.args).join(), /plain baseline files are in the package/);
  f = withMigrations(fixture());
  fs.writeFileSync(path.join(f.res, 'baseline', 'later.sql'), 'x');
  assert.match(verifyPacked(f.args).join(), /plain baseline files are in the package/);
});
test('FAILS when the pin lists migrations but the container is missing, cannot be opened by the packaged key module, or was altered', () => {
  let f = withMigrations(fixture());
  fs.rmSync(path.join(f.res, 'baseline', 'migrations.bin'));
  assert.match(verifyPacked(f.args).join(), /migrations\.bin was NOT packaged/);
  f = withMigrations(fixture());
  fs.writeFileSync(path.join(f.args.appCodeDir, 'src', 'baseline-key.generated.js'), 'module.exports = () => Buffer.alloc(32, 7);\n');
  assert.match(verifyPacked(f.args).join(), /cannot open the (baseline|migrations) container/);
  f = withMigrations(fixture());
  const bin = path.join(f.res, 'baseline', 'migrations.bin');
  const b = fs.readFileSync(bin); b[b.length - 3] ^= 0xff; fs.writeFileSync(bin, b);
  assert.match(verifyPacked(f.args).join(), /migrations\.bin: size\/sha256 differ/);
  f = withMigrations(fixture());
  fs.rmSync(path.join(f.res, 'baseline', 'MIGRATIONS_PACKED.json'));
  assert.match(verifyPacked(f.args).join(), /MIGRATIONS_PACKED\.json was NOT packaged/);
});
test('FAILS when the container is not the pin: another baseline, an edited file, an unpinned file, a reordered / shortened list, another inventory', () => {
  const other = Buffer.from('BEGIN;\nSELECT 2;\nCOMMIT;\n');
  assert.match(verifyPacked(withMigrations(fixture(), (p) => { p.manifest.baselineSha256 = 'f'.repeat(64); }).args).join(), /not for the packaged baseline|differs from the pin's/);
  assert.match(verifyPacked(withMigrations(fixture(), (p) => { p.entries[1].data = other; }).args).join(), /20270210z_x\.sql in the container differs from the pin/);
  assert.match(verifyPacked(withMigrations(fixture(), (p) => { p.entries.push({ name: 'sneaky.sql', data: Buffer.from('x') }); }).args).join(), /carries sneaky\.sql, which the pin does not list/);
  assert.match(verifyPacked(withMigrations(fixture(), (p) => { p.manifest.migrations = []; }).args).join(), /not the pin's/);
  assert.match(verifyPacked(withMigrations(fixture(), (p) => { p.manifest.migrations[0].sha256 = '9'.repeat(64); }).args).join(), /not the pin's/);
  assert.match(verifyPacked(withMigrations(fixture(), (p) => { p.manifest.inventoryAfter = { catalogDelta: { tables: 9 }, functions: {}, removed: [] }; }).args).join(), /inventoryAfter is not baseline\/migrations\.inventory\.json/);
  assert.match(verifyPacked(withMigrations(fixture(), (p) => { p.entries = p.entries.slice(0, 1); }).args).join(), /container lacks 20270210z_x\.sql/);
});
test('FAILS when a migrations container is packaged but the repo pin lists none (a stale package)', () => {
  const f = withMigrations(fixture(), () => {});
  fs.writeFileSync(path.join(f.repo, 'baseline', MM.PIN_FILE), JSON.stringify({ schema: 1, baselineSha256: 'x', migrations: [] }));
  assert.match(verifyPacked(f.args).join(), /lists no migrations/);
});
