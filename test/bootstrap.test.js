'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const b = require('../src/bootstrap');
const { mkdtemp, sha } = require('./helpers');

function cluster(dataDir, major) {
  fs.mkdirSync(path.join(dataDir, 'pgdata'), { recursive: true });
  if (major !== null) fs.writeFileSync(path.join(dataDir, 'pgdata', 'PG_VERSION'), `${major}\n`);
  fs.writeFileSync(path.join(dataDir, 'pgdata', 'postgresql.conf'), '# conf\n');
}

test('detect: nothing → fresh', () => {
  const d = mkdtemp();
  assert.equal(b.detect(d).state, 'fresh');
  fs.mkdirSync(path.join(d, 'pgdata'));
  assert.equal(b.detect(d).state, 'fresh');          // empty pgdata
});

test('detect: an interrupted 2.0 first run (PG 17, no ready marker) is NOT legacy', () => {
  const d = mkdtemp();
  cluster(d, 17);
  assert.equal(b.detect(d).state, 'interrupted_first_run');
  b.writeMarker(d, { status: 'schema_loading' });
  assert.equal(b.detect(d).state, 'interrupted_first_run');
  b.writeMarker(d, { status: 'verify_failed' });
  assert.equal(b.detect(d).state, 'interrupted_first_run');
});

test('detect: initdb died before PG_VERSION → interrupted, not legacy', () => {
  const d = mkdtemp();
  cluster(d, null);
  assert.equal(b.detect(d).state, 'interrupted_first_run');
});

test('detect: ready marker + PG 17 → ready', () => {
  const d = mkdtemp();
  cluster(d, 17);
  b.writeMarker(d, { status: 'ready' });
  assert.equal(b.detect(d).state, 'ready');
});

test('detect: PostgreSQL 15 (macOS 1.x) and 16 (Windows 1.x) data dirs are legacy_v18, marker or not', () => {
  for (const major of [15, 16]) {
    const d = mkdtemp();
    cluster(d, major);
    assert.equal(b.detect(d).state, 'legacy_v18');
    b.writeMarker(d, { status: 'ready' });
    assert.equal(b.detect(d).state, 'legacy_v18');
  }
});

test('prepareDataDir: a legacy dir is moved aside WHOLE, nothing deleted, a fresh dir takes its place', () => {
  const root = mkdtemp();
  const d = path.join(root, 'texacore-data');
  cluster(d, 15);
  fs.writeFileSync(path.join(d, 'config.json'), '{"licenseKey":"K"}');
  fs.writeFileSync(path.join(d, 'secrets.json'), '{"legacy":true}');
  fs.mkdirSync(path.join(d, 'backups'));
  fs.writeFileSync(path.join(d, 'backups', 'a.tcdb'), 'x');
  const r = b.prepareDataDir(d);
  assert.equal(r.state, 'legacy_v18');
  assert.ok(r.movedTo && r.movedTo.includes('.v18-backup-'));
  assert.ok(fs.existsSync(path.join(r.movedTo, 'pgdata', 'PG_VERSION')));
  assert.equal(fs.readFileSync(path.join(r.movedTo, 'config.json'), 'utf8'), '{"licenseKey":"K"}');
  assert.ok(fs.existsSync(path.join(r.movedTo, 'backups', 'a.tcdb')));
  assert.ok(fs.existsSync(d) && fs.readdirSync(d).length === 0);   // fresh, empty
  assert.equal(b.detect(d).state, 'fresh');
});

test('prepareDataDir: two legacy moves in the same instant do not collide', () => {
  const root = mkdtemp();
  const d = path.join(root, 'texacore-data');
  const now = new Date('2026-10-13T00:00:00Z');
  const a = (() => { cluster(d, 15); return b.moveAside(d, 'v18-backup', now); })();
  const c = (() => { cluster(d, 16); return b.moveAside(d, 'v18-backup', now); })();
  assert.notEqual(a, c);
  assert.ok(fs.existsSync(a) && fs.existsSync(c));
});

test('prepareDataDir: an interrupted first run sets aside only the half-built cluster (+marker, secrets); config stays', () => {
  const d = path.join(mkdtemp(), 'texacore-data');
  cluster(d, 17);
  fs.writeFileSync(path.join(d, 'config.json'), '{"licenseKey":"K"}');
  fs.writeFileSync(path.join(d, 'secrets.json'), '{}');
  b.writeMarker(d, { status: 'schema_loading' });
  const r = b.prepareDataDir(d);
  assert.equal(r.state, 'interrupted_first_run');
  assert.ok(fs.existsSync(path.join(d, 'config.json')));
  assert.ok(!fs.existsSync(path.join(d, 'pgdata')) && !fs.existsSync(path.join(d, 'secrets.json')) && !fs.existsSync(b.markerPath(d)));
  assert.ok(fs.readdirSync(d).some((n) => n.startsWith('pgdata.interrupted-')));
  assert.equal(b.detect(d).state, 'fresh');
});

test('prepareDataDir: a ready install is left untouched', () => {
  const d = path.join(mkdtemp(), 'texacore-data');
  cluster(d, 17);
  b.writeMarker(d, { status: 'ready' });
  const before = fs.readdirSync(d).sort();
  const r = b.prepareDataDir(d);
  assert.equal(r.state, 'ready');
  assert.equal(r.movedTo, null);
  assert.deepEqual(fs.readdirSync(d).sort(), before);
});

test('marker writes are atomic merges', () => {
  const d = mkdtemp();
  b.writeMarker(d, { status: 'initdb', a: 1 });
  b.writeMarker(d, { status: 'ready' });
  const m = b.readMarker(d);
  assert.equal(m.status, 'ready');
  assert.equal(m.a, 1);
  assert.equal(m.version, 1);
  assert.ok(!fs.existsSync(b.markerPath(d) + '.tmp'));
});

test('verifyBaselineFiles: pin vs the files on disk', () => {
  const d = mkdtemp();
  const sql = Buffer.from('CREATE TABLE t();\n');
  fs.writeFileSync(path.join(d, 'production_baseline.sql'), sql);
  const pin = { files: { 'production_baseline.sql': { bytes: sql.length, sha256: sha(sql) } } };
  fs.writeFileSync(path.join(d, 'BASELINE_PIN.json'), JSON.stringify(pin));
  assert.deepEqual(b.verifyBaselineFiles(d), []);
  fs.writeFileSync(path.join(d, 'production_baseline.sql'), Buffer.from('CREATE TABLE u();\n'));      // same size, different bytes
  assert.match(b.verifyBaselineFiles(d).join(), /sha256 differs/);
  fs.rmSync(path.join(d, 'production_baseline.sql'));
  assert.match(b.verifyBaselineFiles(d).join(), /missing/);
  fs.rmSync(path.join(d, 'BASELINE_PIN.json'));
  assert.match(b.verifyBaselineFiles(d).join(), /BASELINE_PIN.json unreadable/);
});

test('roles SQL: per-install password, no superuser login, anon cannot log in', () => {
  const sql = b.rolesSql({ dbPassword: "pw'with'quotes" });
  assert.match(sql, /ALTER ROLE authenticator PASSWORD 'pw''with''quotes'/);
  assert.match(sql, /CREATE ROLE anon NOLOGIN/);
  assert.doesNotMatch(sql, /SUPERUSER/);
  assert.match(sql, /GRANT anon, authenticated, service_role TO authenticator/);
  assert.doesNotMatch(sql, /GRANT ALL ON ALL TABLES/i);
  assert.doesNotMatch(sql, /DISABLE ROW LEVEL SECURITY/i);
});

test('baseline error analysis: only the known-benign errors are tolerated', () => {
  const stderr = [
    'psql:/x/production_baseline.sql:164506: ERROR:  relation "realtime.messages_2026_09_27" does not exist',
    'psql:/x/production_baseline.sql:10: ERROR:  relation "t" already exists',
    'psql:/x/production_baseline.sql:11: ERROR:  syntax error at or near "FOO"',
  ].join('\n');
  const errs = b.parsePsqlErrors(stderr);
  assert.equal(errs.length, 3);
  assert.equal(errs[0].line, 164506);
  const first = b.classifyBaselineErrors(errs, { second: false });
  assert.equal(first.unexpected.length, 2);                  // "already exists" is NOT benign on pass 1
  const second = b.classifyBaselineErrors(errs, { second: true });
  assert.equal(second.unexpected.length, 1);
  assert.match(second.unexpected[0].message, /syntax error/);
});

test('function inventory: bodies must match except the four redacted-secret ones; extras only the local gate', () => {
  const inv = {
    'public.f(a integer)': 'aaa', 'public.g()': 'bbb', 'public.auth_email_hook(event jsonb)': 'ccc',
    'auth.uid()': 'zzz', 'storage.x()': 'yyy',
  };
  const ok = [
    { sig: 'public.f(a integer)', md5: 'aaa' }, { sig: 'public.g()', md5: 'bbb' },
    { sig: 'public.auth_email_hook(event jsonb)', md5: 'DIFFERENT' },            // redacted secret → allowed to differ
    { sig: 'public.verify_admin_password(p_input text)', md5: 'local' },          // the local gate → allowed extra
  ];
  assert.equal(b.compareFunctionInventory(inv, ok).ok, true);
  assert.equal(b.compareFunctionInventory(inv, ok.slice(1)).missing.length, 1);
  assert.deepEqual(b.compareFunctionInventory(inv, [{ sig: 'public.f(a integer)', md5: 'OLD' }, ...ok.slice(1)]).mismatched, ['f(a integer)']);
  assert.equal(b.compareFunctionInventory(inv, [...ok, { sig: 'public.sneaky()', md5: 'q' }]).extra.length, 1);
  // composite-type arguments print schema-qualified in the inventory and unqualified in a session with search_path public
  assert.equal(b.compareFunctionInventory({ 'public.h(a public.chart_of_accounts)': 'h' }, [{ sig: 'public.h(a chart_of_accounts)', md5: 'h' }, { sig: 'public.verify_admin_password(p_input text)', md5: 'x' }]).ok, true);
});

test('totals: inventory + the local extras', () => {
  const t = { tables: '724', functions: '1993', triggers: '716', policies: '4470', indexes: '2860', views: '29' };
  assert.deepEqual(b.compareTotals(t, { tables: 725, functions: 1994, triggers: 716, policies: 4470, indexes: 2861, views: 29 }), []);
  assert.match(b.compareTotals(t, { tables: 724, functions: 1994, triggers: 716, policies: 4470, indexes: 2861, views: 29 }).join(), /tables: expected 725, installed 724/);
});
