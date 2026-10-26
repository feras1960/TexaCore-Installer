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
  // fresh: no cluster, no backups, no secrets, no config, no notice - nothing is carried over from the old folder
  assert.deepEqual(fs.readdirSync(d), []);
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
  const sql = b.rolesSql({ authenticatorPassword: "pw'with'quotes", authAdminPassword: 'other' });
  assert.match(sql, /ALTER ROLE authenticator PASSWORD 'pw''with''quotes'/);
  assert.match(sql, /ALTER ROLE supabase_auth_admin PASSWORD 'other'/);
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

// ─── baseline load: only the failed statements are retried ───────────────────────────────────────────────────────
const { statementsWithEndLines, buildRetryScript } = require('../src/sql-split');
const bs = require('../src/bootstrap');

// a fake psql: each statement is "MAKE name [NEEDS other];" — it fails while `other` does not exist yet; reports psql's line (the statement's LAST line)
function fakePsql(created = new Set()) {
  const calls = [];
  const run = async (buf) => {
    const sql = buf.toString('utf8');
    const stmts = statementsWithEndLines(sql);
    calls.push(stmts.filter((x) => !x.session).length);
    let err = '';
    for (const st of stmts) {
      if (st.session) continue;
      const m = /MAKE\s+(\w+)(?:\s+NEEDS\s+(\w+))?\s*;/.exec(st.text);
      if (!m) continue;
      if (/REALTIME/.test(st.text)) { err += `psql:<stdin>:${st.endLine}: ERROR:  relation "realtime.messages_2026_10_13" does not exist\n`; continue; }
      if (m[2] && !created.has(m[2])) { err += `psql:<stdin>:${st.endLine}: ERROR:  "${m[2]}" does not exist\n`; continue; }
      if (created.has(m[1])) { err += `psql:<stdin>:${st.endLine}: ERROR:  "${m[1]}" already exists\n`; continue; }
      created.add(m[1]);
    }
    return { code: 0, stderr: err };
  };
  return { run, calls, created };
}

test('baseline load: ordering failures are retried by themselves (multi-line, dollar-quoted, same-line), nothing else is re-run', async () => {
  const sql = `SET search_path = public;
MAKE a;
MAKE b NEEDS d;
MAKE c
   NEEDS e
 ;
DO $$
BEGIN
  -- a semicolon ; inside a dollar quote
END $$;
MAKE d; MAKE e;
MAKE f NEEDS g; MAKE g;
MAKE REALTIME_PART;
`;
  const f = fakePsql();
  const r = await bs.loadBaseline(Buffer.from(sql), f.run);
  assert.deepEqual([...f.created].sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(r.unexpected.length, 0);
  assert.equal(r.summary[0].mode, 'full');
  assert.ok(f.calls.length >= 2 && f.calls[1] < f.calls[0], 'the retry runs far fewer statements than the full pass');
  assert.ok(r.summary.slice(1).every((x) => x.mode === 'selective'), 'no full second pass was needed');
  // the expected realtime error never triggers a retry
  const g = fakePsql();
  const r2 = await bs.loadBaseline(Buffer.from('SET x = 1;\nMAKE a;\nMAKE REALTIME_PART;\n'), g.run);
  assert.equal(g.calls.length, 1); assert.equal(r2.summary.length, 1); assert.equal(r2.summary[0].expected, 1);
});

test('baseline load: with no failures at all there is ONE pass (no 12,000-line "already exists" second pass)', async () => {
  const f = fakePsql();
  const r = await bs.loadBaseline(Buffer.from('MAKE a;\nMAKE b NEEDS a;\n'), f.run);
  assert.equal(f.calls.length, 1); assert.equal(r.summary.length, 1); assert.equal(r.unexpected.length, 0);
});

test('baseline load: an unmappable failure falls back to ONE full second pass, where "already exists" is benign', async () => {
  let n = 0; const calls = [];
  const run = async (buf) => { n += 1; calls.push(buf.toString('utf8').length); return { stderr: n === 1 ? 'psql: ERROR:  something odd without a line\n' : 'psql:<stdin>:3: ERROR:  relation "x" already exists\n' }; };
  const r = await bs.loadBaseline(Buffer.from('MAKE a;\nMAKE b;\nMAKE c;\n'), run);
  assert.equal(r.summary.length, 2); assert.equal(r.summary[1].mode, 'full'); assert.equal(r.unexpected.length, 0);
  assert.equal(calls[0], calls[1], 'the second pass is the whole file');
});

test('baseline load: a failure that never goes away is reported (no infinite loop)', async () => {
  const run = async (buf) => {
    const st = statementsWithEndLines(buf.toString('utf8')).filter((x) => !x.session);
    return { stderr: st.map((x) => (/BAD/.test(x.text) ? `psql:<stdin>:${x.endLine}: ERROR:  syntax error at or near "BAD"\n` : '')).join('') };
  };
  const r = await bs.loadBaseline(Buffer.from('MAKE a;\nBAD;\nMAKE b;\n'), run);
  assert.equal(r.unexpected.length, 1); assert.ok(r.summary.length <= 9);
});

test('retry script keeps every session statement and only the failed ones, in file order', () => {
  const sql = 'SET a = 1;\nCREATE x;\nCREATE y;\nSELECT pg_catalog.set_config(\'s\', \'v\', false);\nCREATE z;\n';
  const r = buildRetryScript(sql, [3, 5]);
  const order = ['SET a = 1;', 'CREATE y;', "set_config('s'", 'CREATE z;'].map((x) => r.script.indexOf(x));
  assert.ok(order.every((i) => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]), 'session + failed statements, in file order');
  assert.ok(!r.script.includes('CREATE x;'), 'the statement that succeeded is not repeated');
  assert.equal(r.retried, 2); assert.deepEqual(r.unmapped, []);
  assert.deepEqual(buildRetryScript(sql, [99]).unmapped, [99]);
});

test('pg_hba is scram-sha-256 only, loopback only; trust is detected', () => {
  const unix = bs.hbaText({ windows: false }); const win = bs.hbaText({ windows: true });
  assert.ok(!bs.hbaHasTrust(unix) && !bs.hbaHasTrust(win));
  assert.match(unix, /^local\s+all\s+all\s+scram-sha-256$/m); assert.doesNotMatch(win, /^local/m);
  for (const t of [unix, win]) { assert.match(t, /127\.0\.0\.1\/32\s+scram-sha-256/); assert.match(t, /::1\/128\s+scram-sha-256/); assert.doesNotMatch(t, /0\.0\.0\.0|::\/0/); }
  assert.ok(bs.hbaHasTrust('host all all 127.0.0.1/32 trust\n')); assert.ok(!bs.hbaHasTrust('# trust is bad\nhost all all 127.0.0.1/32 scram-sha-256\n'));
});

test('role passwords: postgres is set unconditionally, the two service roles only when they exist, values are quoted', () => {
  const sql = bs.passwordSql({ dbPassword: "pw'1", authenticatorPassword: 'a2', authAdminPassword: 'a3' });
  assert.match(sql, /ALTER ROLE postgres PASSWORD 'pw''1'/);
  assert.match(sql, /IF EXISTS \(SELECT FROM pg_roles WHERE rolname = 'authenticator'\)/);
  assert.match(sql, /rolname = 'supabase_auth_admin'/);
  const roles = bs.rolesSql({ authenticatorPassword: 'AUTHN', authAdminPassword: 'AUTHA' });
  assert.match(roles, /ALTER ROLE authenticator PASSWORD 'AUTHN'/); assert.match(roles, /ALTER ROLE supabase_auth_admin PASSWORD 'AUTHA'/);
});

test('a baseline with a bare "null;" statement (an object whose definition came back NULL) is refused', () => {
  const { baselineProblems } = require('../scripts/sync-baseline');
  assert.deepEqual(baselineProblems('CREATE TABLE public.t (id int);\nCREATE TRIGGER x BEFORE INSERT ON public.t FOR EACH ROW EXECUTE FUNCTION f();\n'), []);
  const bad = baselineProblems('CREATE TABLE public.t (id int);\nnull;\nCREATE TRIGGER y ...;\n  NULL ;\n');
  assert.equal(bad.length, 1); assert.match(bad[0], /2 top-level statement\(s\) that are just "null;" \(line 2, 4\)/);
  // a plpgsql body may contain `null;` lines
  assert.deepEqual(baselineProblems('CREATE TABLE public.t (id int);\nCREATE FUNCTION f() RETURNS void AS $f$\nBEGIN\n  null;\nEND;\n$f$ LANGUAGE plpgsql;\n'), []);
  // a statement that merely CONTAINS null is fine
  assert.deepEqual(baselineProblems('CREATE TABLE public.t (a int DEFAULT null);\nSELECT null;\n'), []);
});

// ─── what a pre-2.0 dir leaves behind for the new install ───────────────────────────────────────────────────────
test('legacy dir: moved aside whole and untouched; the new dir carries NOTHING over (no licence, no cloud settings, no company list, no backup location, no notice)', () => {
  const d = mkdtemp('dd-');
  fs.mkdirSync(path.join(d, 'pgdata'), { recursive: true }); fs.writeFileSync(path.join(d, 'pgdata', 'PG_VERSION'), '15\n');
  fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify({ licenseKey: 'TRL-2026-OLD', isTrial: true, subdomain: 'acme', enableCloud: true, tunnelToken: 'T', port: 8080, dbPassword: 'old',
    storagePath: '/old/backups', currentDbPath: '/old/backups/x.tcdb', companies: [{ name: 'Old Co', tcdbPath: '/old/backups/old.tcdb' }] }));
  fs.writeFileSync(path.join(d, 'license.dat'), 'encrypted-licence'); fs.mkdirSync(path.join(d, 'backups')); fs.writeFileSync(path.join(d, 'backups', 'old.tcdb'), 'OLD BACKUP');
  const r = b.prepareDataDir(d);
  assert.equal(r.state, 'legacy_v18');
  assert.deepEqual(fs.readdirSync(d), [], 'the new dir is empty');
  // the old dir is untouched
  assert.equal(fs.readFileSync(path.join(r.movedTo, 'backups', 'old.tcdb'), 'utf8'), 'OLD BACKUP');
  assert.equal(fs.readFileSync(path.join(r.movedTo, 'license.dat'), 'utf8'), 'encrypted-licence');
  assert.ok(JSON.parse(fs.readFileSync(path.join(r.movedTo, 'config.json'), 'utf8')).companies);
});

test('the 1.x upgrade path is gone: no carry-over, no upgrade notice, no old-company-file collector', () => {
  for (const name of ['carryForwardSettings', 'collectOldTcdbPaths', 'writeUpgradeNotice', 'readUpgradeNotice', 'dismissUpgradeNotice', 'UPGRADE_NOTICE_FILE']) assert.equal(b[name], undefined, name);
});

test('interrupted first run / fresh with an old config: the company list and backup paths are removed from config.json (the auto-backup must not overwrite the old .tcdb); the original is kept', () => {
  for (const state of ['interrupted', 'fresh']) {
    const d = mkdtemp('dd-');
    if (state === 'interrupted') { fs.mkdirSync(path.join(d, 'pgdata'), { recursive: true }); fs.writeFileSync(path.join(d, 'pgdata', 'PG_VERSION'), '17\n'); }
    const old = { licenseKey: 'TRL-2026-OLD', isTrial: true, storagePath: '/old/backups', companies: [{ name: 'Old Co', tcdbPath: '/old/backups/old.tcdb' }] };
    fs.writeFileSync(path.join(d, 'config.json'), JSON.stringify(old)); fs.writeFileSync(path.join(d, 'license.dat'), 'lic');
    b.prepareDataDir(d);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'config.json'), 'utf8')), { licenseKey: 'TRL-2026-OLD', isTrial: true }, state);
    const copy = fs.readdirSync(d).find((n) => n.startsWith('config.json.pre-2.0-'));
    assert.ok(copy, state); assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, copy), 'utf8')), old);
    assert.equal(fs.readFileSync(path.join(d, 'license.dat'), 'utf8'), 'lic');
  }
});

test('a finished 2.0 install and a config without risky fields are left exactly as they are', () => {
  const d = mkdtemp('dd-');
  fs.mkdirSync(path.join(d, 'pgdata'), { recursive: true }); fs.writeFileSync(path.join(d, 'pgdata', 'PG_VERSION'), '17\n');
  fs.writeFileSync(path.join(d, 'bootstrap.json'), JSON.stringify({ status: 'ready' }));
  const cfg = JSON.stringify({ licenseKey: 'K', companies: [{ name: 'New Co', tcdbPath: '/new/x.tcdb' }] });
  fs.writeFileSync(path.join(d, 'config.json'), cfg);
  assert.equal(b.prepareDataDir(d).state, 'ready');
  assert.equal(fs.readFileSync(path.join(d, 'config.json'), 'utf8'), cfg);
  const e = mkdtemp('dd-'); fs.writeFileSync(path.join(e, 'config.json'), JSON.stringify({ licenseKey: 'K', port: 80 }));
  assert.equal(b.sanitizeConfigInPlace(e), null);
});


// ── reference data on an EXISTING install (the ERP's global roles + capability map; loaded once after the migrations, idempotent) ──
test('referenceDataIsStale: a finished install that never recorded the reference data (2.0.4 / RC) must load it; one that did, with the same sha256, must not', () => {
  const sha = b.sha256Hex(Buffer.from('-- reference data\n'));
  assert.equal(sha, sha256Of('-- reference data\n'));
  assert.equal(b.referenceDataIsStale({ status: 'ready' }, sha), true);                                         // never recorded
  assert.equal(b.referenceDataIsStale({ status: 'ready', referenceDataSha256: 'a'.repeat(64) }, sha), true);    // an older file
  assert.equal(b.referenceDataIsStale({ status: 'ready', referenceDataSha256: sha }, sha), false);              // up to date
});

test('referenceDataIsStale: never for an unfinished install, a missing marker, or when the package carries no reference data', () => {
  const sha = b.sha256Hex(Buffer.from('x'));
  assert.equal(b.referenceDataIsStale({ status: 'verify_failed' }, sha), false);
  assert.equal(b.referenceDataIsStale(null, sha), false);
  assert.equal(b.referenceDataIsStale({ status: 'ready' }, null), false);
});

test('the marker keeps the reference-data sha256 across writeMarker patches (the first build writes it, the upgrade step only reads it)', () => {
  const d = mkdtemp('mk-');
  b.writeMarker(d, { status: 'ready', referenceDataSha256: 'f'.repeat(64) });
  b.writeMarker(d, { verified: { ok: true } });
  assert.equal(b.readMarker(d).referenceDataSha256, 'f'.repeat(64));
});

test('service-manager: buildDatabase records the reference-data sha256 in the ready marker, and an existing install loads it once BEFORE the migrations (never on a fresh build)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'service-manager.js'), 'utf8');
  assert.match(src, /referenceDataSha256 = bootstrap\.sha256Hex\(buf\)/);
  assert.match(src, /status: 'ready',[^\n]*\.\.\.\(referenceDataSha256 \? \{ referenceDataSha256 \} : \{\}\)/);
  const runIdx = src.indexOf('migrationResult = await this.runMigrations()');
  const ensureIdx = src.indexOf('if (!fresh) await this.ensureReferenceData()');
  assert.ok(ensureIdx > 0 && runIdx > ensureIdx, 'ensureReferenceData must run BEFORE runMigrations (the order a fresh build uses), for existing installs only');
});

function sha256Of(s) { return require('crypto').createHash('sha256').update(s).digest('hex'); }
