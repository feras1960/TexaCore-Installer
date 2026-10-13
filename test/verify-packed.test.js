'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { verifyPacked } = require('../scripts/lib/verify-packed');
const { mkdtemp, sha } = require('./helpers');

// build a fake repo + a fake packaged tree that is correct, then break one thing at a time
function fixture(platform = 'darwin') {
  const repo = mkdtemp('repo-');
  const res = mkdtemp('res-');
  const ver = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ version: ver }));
  const sql = Buffer.from('CREATE TABLE t();\n');
  const inv = Buffer.from('{}');
  const pin = { files: {
    'production_baseline.sql': { bytes: sql.length, sha256: sha(sql) },
    'production_baseline.inventory.json': { bytes: inv.length, sha256: sha(inv) },
  } };
  fs.mkdirSync(path.join(repo, 'baseline'));
  fs.writeFileSync(path.join(repo, 'baseline', 'BASELINE_PIN.json'), JSON.stringify(pin));
  const pk = path.join(res, 'baseline');
  fs.mkdirSync(pk);
  fs.writeFileSync(path.join(pk, 'BASELINE_PIN.json'), JSON.stringify(pin));
  fs.writeFileSync(path.join(pk, 'production_baseline.sql'), sql);
  fs.writeFileSync(path.join(pk, 'production_baseline.inventory.json'), inv);
  const app = path.join(res, 'app');
  fs.mkdirSync(path.join(app, 'src', 'bootstrap'), { recursive: true });
  fs.writeFileSync(path.join(app, 'src', 'bootstrap', 'local_extras.sql'), '--');
  fs.writeFileSync(path.join(app, 'src', 'bootstrap', 'reference_seed.sql'), '--');
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
  return { repo, res, args: { resourcesDir: res, appCodeDir: app, repoRoot: repo, platform } };
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

test('FAILS when a baseline file is missing, truncated, or altered', () => {
  let f = fixture();
  fs.rmSync(path.join(f.res, 'baseline', 'production_baseline.sql'));
  assert.match(verifyPacked(f.args).join(), /production_baseline\.sql was NOT packaged/);
  f = fixture();
  fs.writeFileSync(path.join(f.res, 'baseline', 'production_baseline.sql'), 'CREATE TABLE x();\n');           // same length, other bytes
  assert.match(verifyPacked(f.args).join(), /sha256 differs from the pin/);
  f = fixture();
  fs.writeFileSync(path.join(f.res, 'baseline', 'production_baseline.sql'), 'CREATE');
  assert.match(verifyPacked(f.args).join(), /bytes packaged, pin says/);
});

test('FAILS when the packaged pin differs from the repo pin', () => {
  const f = fixture();
  const pk = path.join(f.res, 'baseline', 'BASELINE_PIN.json');
  fs.writeFileSync(pk, fs.readFileSync(pk, 'utf8') + '\n');
  assert.match(verifyPacked(f.args).join(), /differs from the repo pin/);
});

test('FAILS on a wrong web-bundle version, missing fonts, missing binaries, missing bootstrap SQL', () => {
  let f = fixture();
  fs.writeFileSync(path.join(f.res, 'frontend', 'index.html'), '<meta name="texacore-app-version" content="1.5.45">');
  assert.match(verifyPacked(f.args).join(), /packaged web bundle is 1\.5\.45/);
  f = fixture();
  fs.rmSync(path.join(f.res, 'frontend', 'fonts'), { recursive: true });
  assert.match(verifyPacked(f.args).join(), /local fonts/);
  f = fixture();
  fs.rmSync(path.join(f.res, 'bin', 'pg', 'bin', 'postgres'));
  assert.match(verifyPacked(f.args).join(), /bin\/pg\/bin\/postgres is missing/);
  f = fixture();
  fs.rmSync(path.join(f.args.appCodeDir, 'src', 'bootstrap', 'reference_seed.sql'));
  assert.match(verifyPacked(f.args).join(), /reference_seed\.sql is missing/);
});

test('FAILS when a 1.x migrations manifest rides along', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.res, 'migrations'));
  fs.writeFileSync(path.join(f.res, 'migrations', 'migrations.json'), '{"migrations":[]}');
  assert.match(verifyPacked(f.args).join(), /1\.x migrations/);
});
