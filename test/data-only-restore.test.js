'use strict';
// 2.0.4 (security F1): a company file is DATA. The restore used to hand the file's whole text to `psql -f` as the database superuser; the scan (sql-guard.js) cannot tell a
// harmless function body from a harmful one, and a real file legitimately carries ~2,300 functions and ~1,300 triggers. So the restore now runs none of the file's DDL: it
// takes the COPY data of the tables the database already has and the sequence values, in a script the program BUILDS (planDataRestore / renderDataScript).
// Proofs here: the reviewer's crafted dumps (a trigger that fires during the load, a function that builds `COPY … PROGRAM` from pieces, a replaced shipped function) are
// neutralised on a throw-away cluster with the bundled psql; the data of a real file passes through byte for byte; unknown tables / schemas / shapes are skipped.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const g = require('../src/sql-guard');
const BackupManager = require('../src/backup-manager');
const { mkdtemp } = require('./helpers');

const REPLICA = "SET session_replication_role = 'replica';\n";
const ORIGIN = "\nSET session_replication_role = 'origin';\n";
const KNOWN = new Set(['public.companies', 'public.loot', 'public.marker', 'public.customers', 'auth.users', 'auth.identities']);
const render = (sql, known = KNOWN) => g.renderDataScript(g.planDataRestore(sql), { known, before: REPLICA, after: ORIGIN });
const text = (r) => r.script.toString('latin1');

// the reviewer's proof dumps (REVIEW-OPUS F1): guard-clean except for ENABLE ALWAYS, which is now refused too
const TRIGGER_DUMP = [
  "SET standard_conforming_strings = 'on';", "SET client_encoding = 'UTF8';",
  'CREATE TABLE public.marker (note text);', 'CREATE TABLE public.loot (a int);',
  "CREATE FUNCTION public.f() RETURNS trigger LANGUAGE plpgsql AS $x$ BEGIN INSERT INTO public.marker VALUES ('ATTACKER CODE RAN during COPY as '||current_user); RETURN NEW; END $x$;",
  'CREATE TRIGGER trg BEFORE INSERT ON public.loot FOR EACH ROW EXECUTE FUNCTION public.f();',
  'ALTER TABLE public.loot ENABLE ALWAYS TRIGGER trg;',
  'COPY public.loot (a) FROM stdin;', '1', '2', '\\.', '',
].join('\n');
const TRIGGER_DUMP_NO_ALWAYS = TRIGGER_DUMP.replace('ALTER TABLE public.loot ENABLE ALWAYS TRIGGER trg;\n', '');
const SPLIT_DUMP = [
  "SET standard_conforming_strings = 'on';",
  "CREATE FUNCTION public.g() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN EXECUTE 'COPY x TO PROG'||'RAM ''touch /tmp/never-9f31'''; RETURN NEW; END $$;",
  'CREATE TRIGGER trg2 BEFORE INSERT ON public.loot FOR EACH ROW EXECUTE FUNCTION public.g();',
  // replaces a SHIPPED SECURITY DEFINER function (CREATE OR REPLACE: it would succeed, and run as the superuser the next time the program calls it)
  "CREATE OR REPLACE FUNCTION public.shipped_fn() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'attacker' $$;",
  'COPY public.loot (a) FROM stdin;', '5', '\\.', '',
].join('\n');

test('F1: the reviewer\'s ENABLE ALWAYS trigger dump is refused by the scan; without that line it is guard-clean and the data-only script holds NO function, trigger or DDL - only the COPY block', () => {
  assert.deepEqual([...new Set(g.scanDump(TRIGGER_DUMP).findings.map((f) => f.kind))], ['trigger-state']);
  assert.equal(g.scanDump(TRIGGER_DUMP_NO_ALWAYS).findings.length, 0, 'guard-clean: a trigger and a plpgsql function are what a real file has');
  const r = render(TRIGGER_DUMP_NO_ALWAYS);
  const t = text(r);
  assert.doesNotMatch(t, /FUNCTION|TRIGGER|ATTACKER|CREATE|marker|INSERT|plpgsql/i, 'nothing of the file\'s code is in the script');
  assert.match(t, /COPY public\.loot \(a\) FROM stdin;\n1\n2\n\\\.\n/);
  assert.deepEqual(r.tables, ['public.loot']);
  // the split-string function (a statement built from pieces: invisible to a word scan) and the replaced shipped function are guard-clean and equally absent
  assert.equal(g.scanDump(SPLIT_DUMP).findings.length, 0);
  const s = text(render(SPLIT_DUMP));
  assert.doesNotMatch(s, /PROG|RAM|shipped_fn|attacker|FUNCTION|TRIGGER|touch/i);
  assert.match(s, /COPY public\.loot \(a\) FROM stdin;\n5\n\\\.\n/);
});

test('the script is BUILT: every COPY header is rebuilt from the names it parsed into (comments, odd spacing, quoted names), the data lines pass through byte for byte (UTF-8, CRLF, backslashes, \\N), sequence values only in the one literal shape', () => {
  const data = 'a1\tسلام العالم \\N\n' + 'b2\tback\\\\slash \\t tab\r\n' + '\\x41 starts with a backslash\tüñí\n';
  const sql = [
    "SET client_encoding = 'UTF8';",
    'COPY /* a comment */ public . companies ( id ,name ) FROM stdin ;', data + '\\.', '',
    'COPY public."Odd Name" ("Odd Col", b) FROM stdin;', 'x\ty', '\\.', '',
    "SELECT pg_catalog.setval('public.companies_seq', 42, true);",
    "SELECT pg_catalog.setval('public.x_seq', -1, false);",
    "SELECT pg_catalog.setval('pg_catalog.pg_class_oid_seq', 1, true);",        // another schema: not taken
    "SELECT pg_catalog.setval('public.x_seq', (SELECT 1), true);",              // not literals: not taken
    "SELECT pg_catalog.setval('public.x_seq', 7, true); SELECT pg_sleep(100);", // two statements: only the first shape is taken, the second never
    "SELECT 1;", 'DROP TABLE public.companies;', 'CREATE VIEW public.v AS SELECT 1;', "GRANT ALL ON public.companies TO anon;", "ALTER TABLE ONLY public.companies ADD CONSTRAINT c CHECK (true);",
  ].join('\n');
  const plan = g.planDataRestore(sql);
  const r = g.renderDataScript(plan, { known: new Set(['public.companies', 'public.Odd Name']), before: REPLICA, after: ORIGIN });
  const t = text(r);
  assert.match(t, /COPY public\.companies \(id, name\) FROM stdin;\n/);
  assert.ok(t.includes('COPY public."Odd Name" ("Odd Col", b) FROM stdin;\n'));
  assert.ok(r.script.includes(Buffer.from(data, 'utf8')), 'the data lines are in the script byte for byte');
  assert.ok(!t.includes('/* a comment */') && !t.includes('public . companies'));
  assert.match(t, /SELECT pg_catalog\.setval\('public\.companies_seq', 42, true\);\n/);
  assert.match(t, /SELECT pg_catalog\.setval\('public\.x_seq', -1, false\);\n/);
  assert.doesNotMatch(t, /pg_class_oid_seq|pg_sleep|DROP|VIEW|GRANT|CONSTRAINT|SELECT 1/);
  assert.deepEqual(r.tables, ['public.companies', 'public."Odd Name"']);
  assert.equal(r.loaded, 2);
  assert.ok(t.startsWith("SET client_encoding = 'UTF8';"), 'the program\'s own settings come first');
  assert.ok(plan.ignored.total >= 5);
});

test('what is taken: public tables the database has, auth.users / auth.identities (kept apart for the login step); skipped and REPORTED: tables this version does not have, other schemas, other auth tables, COPY with options, a COPY header written inside a string', () => {
  const sql = [
    'COPY public.companies (id) FROM stdin;', '1', '\\.',
    'COPY public.future_table (id) FROM stdin;', '9', '\\.',
    'COPY auth.users (id, email) FROM stdin;', 'u1\ta@b.c', '\\.',
    'COPY auth.identities (id) FROM stdin;', 'i1', '\\.',
    'COPY auth.audit_log_entries (id) FROM stdin;', 'e1', '\\.',
    'COPY pg_catalog.pg_authid (rolname) FROM stdin;', 'x', '\\.',
    'COPY public.customers (id) FROM stdin WITH (FORMAT csv);', '7', '\\.',
    // a COPY header that lives INSIDE a function body is text, not a statement
    "CREATE FUNCTION public.h() RETURNS void LANGUAGE sql AS $$ SELECT 1; -- COPY public.companies (id) FROM stdin;\n999\n\\.\nDROP SCHEMA public CASCADE; $$;",
    'COPY public.marker (note) FROM stdin;', 'm', '\\.', '',
  ].join('\n');
  const r = render(sql);
  const t = text(r);
  assert.deepEqual(r.tables, ['public.companies', 'public.marker']);
  assert.ok(r.auth.users && r.auth.users.toString().startsWith('COPY auth.users (id, email) FROM stdin;\nu1\ta@b.c\n\\.\n'));
  assert.ok(r.auth.identities && r.auth.identities.toString().startsWith('COPY auth.identities (id) FROM stdin;\ni1\n'));
  assert.doesNotMatch(t, /future_table|auth\.|pg_authid|audit_log|csv|DROP SCHEMA|999/);
  assert.deepEqual(r.skipped.map((x) => `${x.table}:${x.why}`).sort(), ['auth.audit_log_entries:auth-other', 'pg_catalog.pg_authid:schema', 'public.future_table:unknown-table']);
  assert.equal(r.loaded, 2);
  // a file with no table the database knows loads nothing (the restore refuses it before truncating anything)
  assert.equal(render('COPY public.zzz (id) FROM stdin;\n1\n\\.\n').loaded, 0);
  // prepareDump(strip:false) keeps even a data line that looks like \restrict (a one-column table could hold it); the default strips such lines
  const odd = g.renderDataScript(g.planDataRestore('COPY public.marker (note) FROM stdin;\n\\restrict abcdefghijkl\n\\.\n'), { known: KNOWN });
  assert.ok(g.prepareDump(odd.script, { strip: false }).includes(Buffer.from('\\restrict abcdefghijkl\n')));
  assert.ok(!g.prepareDump(odd.script).includes(Buffer.from('\\restrict abcdefghijkl\n')));
});

test('the real file of this repository (Sample.tcdb): every COPY block of a table the database has comes through; none of its ~2,300 functions / ~1,300 triggers / policies reaches the script', async () => {
  const f = path.join(__dirname, '..', 'Sample.tcdb');
  if (!fs.existsSync(f)) return;
  const bm = new BackupManager({ pgBinDir: '/x', encryptionKey: 'texacore-default-backup-key-2026', backupPath: f });
  const sql = await bm._decompress(bm._decryptParsed(bm._parseTcdbFile(fs.readFileSync(f)), '').data);
  g.assertSafeDump(sql);
  const plan = g.planDataRestore(sql);
  const publicBlocks = plan.blocks.filter((b) => b.schema === 'public');
  assert.ok(publicBlocks.length > 700 && plan.setvals.length >= 20);
  assert.ok(plan.ignored.total > 10000 && plan.ignored.kinds['create function'] > 2000 && plan.ignored.kinds['create trigger'] > 1000);
  const known = new Set(plan.blocks.map((b) => b.qualified));
  const r = g.renderDataScript(plan, { known, before: REPLICA, after: ORIGIN });
  assert.equal(r.loaded, publicBlocks.length);
  const t = r.script.toString('latin1');
  assert.doesNotMatch(t, /CREATE |ALTER |GRANT |CREATE FUNCTION|plpgsql/, 'no DDL, no function in the script');
  // each block's data is the file's, byte for byte
  const buf = Buffer.isBuffer(sql) ? sql : Buffer.from(sql);
  for (const b of publicBlocks.slice(0, 40)) assert.ok(r.script.includes(buf.subarray(b.start, b.end)), `${b.qualified} data intact`);
  assert.ok(r.auth.users && r.auth.identities);
  assert.ok(r.script.length < sql.length, 'the script is only the data');
});

// ── the whole restore, with a fake psql that keeps every script it is given ──
function capturePsql(dir, { tables = 'public.companies\npublic.loot\nauth.users\nauth.identities\n' } = {}) {
  const seen = path.join(dir, 'seen'); fs.mkdirSync(seen, { recursive: true });
  const script = path.join(dir, 'psql-cap.sh');
  fs.writeFileSync(script, `#!/bin/sh\nf=""; c=""\nwhile [ $# -gt 0 ]; do case "$1" in -f) f="$2"; shift;; -tAc) c="$2"; shift;; esac; shift; done\n`
    + `if [ -n "$c" ]; then case "$c" in *pg_class*) printf '${tables.replace(/\n/g, '\\n')}';; *) echo 1;; esac; exit 0; fi\n`
    + `n=$(ls "${seen}" | wc -l | tr -d ' '); cp "$f" "${seen}/script-$n.sql"\nexit 0\n`, { mode: 0o755 });
  return { script, scripts: () => fs.readdirSync(seen).sort().map((n) => fs.readFileSync(path.join(seen, n), 'latin1')) };
}
const mgr = (dir, backupPath) => {
  const m = new BackupManager({ pgBinDir: '/nonexistent', dbPassword: 'x', backupPath, encryptionKey: 'texacore-default-backup-key-2026', onProgress: () => {}, onError: () => {} });
  m._resetAuthSessions = async () => {}; m._rotateDailySnapshot = () => {};
  return m;
};
const container = async (m, sqlText) => { const sql = Buffer.from(sqlText); const c = await m._compress(sql); return m._buildTcdbFile(m._encrypt(c), sql.length, c.length); };

test('BackupManager.restore of the reviewer\'s dumps: every script psql is given (truncate, load, logins) holds no function, trigger or DDL of the file; unknown tables are reported; a file with nothing this version knows is refused before anything is truncated', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtemp('tcx-f1-');
  const m = mgr(dir, path.join(dir, 'x.tcdb'));
  const cap = capturePsql(dir); m.psql = cap.script; m.truncateRetryDelaysMs = [1];
  const file = path.join(dir, 'evil.tcdb');
  const evil = `-- Dumped from database version 17.6\n${TRIGGER_DUMP_NO_ALWAYS}\n${SPLIT_DUMP}\n`
    + 'COPY public.companies (id, name) FROM stdin;\n1\tAcme\n\\.\nCOPY auth.users (id) FROM stdin;\nu1\n\\.\nCOPY public.future_t (id) FROM stdin;\n9\n\\.\n'
    + "SELECT pg_catalog.setval('public.companies_id_seq', 5, true);\n";
  fs.writeFileSync(file, await container(m, evil));
  const res = await m.restore(file);
  const scripts = cap.scripts();
  assert.ok(scripts.length >= 3, 'truncate + load + logins ran');
  for (const s of scripts) assert.doesNotMatch(s, /ATTACKER|marker|PROG|RAM|shipped_fn|CREATE FUNCTION|CREATE TRIGGER|plpgsql|future_t|touch \/tmp/i);
  const load = scripts.find((s) => /COPY public\.companies/.test(s));
  assert.match(load, /^\\restrict [0-9a-f]{48}\nSET client_encoding = 'UTF8';/, 'the program\'s own restricted-mode wrapper, its own settings');
  assert.match(load, /SET session_replication_role = 'replica';/);
  assert.match(load, /COPY public\.loot \(a\) FROM stdin;\n1\n2\n\\\.\n/);
  assert.match(load, /SELECT pg_catalog\.setval\('public\.companies_id_seq', 5, true\);/);
  assert.equal(res.dataOnly.skippedCount, 1);
  assert.deepEqual(res.dataOnly.skippedTables, ['public.future_t']);
  assert.ok(res.dataOnly.ignoredStatements >= 5);
  // a file none of whose tables the database has: refused (TCDB_NO_DATA), nothing truncated, nothing loaded
  const dir2 = mkdtemp('tcx-f1b-'); const m2 = mgr(dir2, path.join(dir2, 'x.tcdb')); const cap2 = capturePsql(dir2); m2.psql = cap2.script;
  const f2 = path.join(dir2, 'none.tcdb'); fs.writeFileSync(f2, await container(m2, '-- Dumped from database version 17.6\nCOPY public.nothing_here (id) FROM stdin;\n1\n\\.\n'));
  await assert.rejects(m2.restore(f2), (e) => e.code === 'TCDB_NO_DATA');
  assert.equal(cap2.scripts().length, 0, 'psql was never given a script');
  assert.equal(m2.lastRestoreTouchedDb, false);
  // a database without tables: refused too (TCDB_NO_SCHEMA)
  const dir3 = mkdtemp('tcx-f1c-'); const m3 = mgr(dir3, path.join(dir3, 'x.tcdb')); const cap3 = capturePsql(dir3, { tables: '' }); m3.psql = cap3.script;
  const f3 = path.join(dir3, 'ok.tcdb'); fs.writeFileSync(f3, await container(m3, '-- Dumped from database version 17.6\nCOPY public.companies (id) FROM stdin;\n1\n\\.\n'));
  await assert.rejects(m3.restore(f3), (e) => e.code === 'TCDB_NO_SCHEMA');
  assert.equal(cap3.scripts().length, 0);
});

// ── psql itself, on a throw-away cluster made with the bundled binaries (macOS arm64 development machines only) ──
const PG = path.join(__dirname, '..', 'bin', 'macos-arm64', 'pg', 'bin');
const haveBundledPg = process.platform === 'darwin' && process.arch === 'arm64' && fs.existsSync(path.join(PG, 'initdb')) && fs.existsSync(path.join(PG, 'psql'));
test('F1 end to end with the bundled psql 17.6: the trigger that fired AS THE SUPERUSER during the load (control) never exists; a replaced shipped function stays the shipped one; the data loads', { skip: !haveBundledPg && 'needs the bundled macOS PostgreSQL', timeout: 180000 }, async () => {
  const { execFileSync, spawn, spawnSync } = require('child_process');
  const dir = mkdtemp('tcx-f1e-');
  const data = path.join(dir, 'data');
  const port = 48000 + Math.floor(Math.random() * 3000);
  execFileSync(path.join(PG, 'initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-sync'], { stdio: 'ignore' });
  const srv = spawn(path.join(PG, 'postgres'), ['-D', data, '-p', String(port), '-k', dir, '-c', 'listen_addresses=127.0.0.1', '-c', 'fsync=off'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 100; i++) { try { execFileSync(path.join(PG, 'pg_isready'), ['-h', '127.0.0.1', '-p', String(port)], { stdio: 'ignore' }); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const psql = (args, input) => spawnSync(path.join(PG, 'psql'), ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', ...args], { encoding: 'utf8', input });
    const q = (sql) => psql(['-tAc', sql]).stdout.trim();
    const fresh = () => {
      psql(['-c', 'DROP TABLE IF EXISTS public.marker, public.loot CASCADE; DROP FUNCTION IF EXISTS public.f() CASCADE; DROP FUNCTION IF EXISTS public.g() CASCADE;']);
      psql(['-c', "CREATE TABLE public.marker (note text); CREATE TABLE public.loot (a int); CREATE OR REPLACE FUNCTION public.shipped_fn() RETURNS text LANGUAGE sql AS $$ SELECT 'shipped' $$;"]);
    };
    const runScript = (buf) => { const f = path.join(dir, `s${Math.random().toString(16).slice(2)}.sql`); fs.writeFileSync(f, buf); return psql(['-f', f, '--set', 'ON_ERROR_STOP=off']); };

    // CONTROL: the previous restore (the whole file through psql, replica role) - the trigger set ENABLE ALWAYS fires during the COPY, as the superuser
    fresh();
    runScript(g.prepareDump(TRIGGER_DUMP, { before: REPLICA, after: ORIGIN }));
    assert.match(q('SELECT note FROM public.marker'), /ATTACKER CODE RAN during COPY as postgres/, 'control: the old way runs the file\'s trigger as the superuser');
    // the same dump through the new restore: the scan refuses it (ENABLE ALWAYS)…
    assert.throws(() => g.assertSafeDump(TRIGGER_DUMP), (e) => e.code === 'TCDB_UNSAFE_SQL');
    // …and WITHOUT that line (guard-clean) the data-only script runs: no function, no trigger, no marker row, the data is there
    fresh();
    const known = new Set(['public.marker', 'public.loot']);
    g.assertSafeDump(TRIGGER_DUMP_NO_ALWAYS);
    const r = g.renderDataScript(g.planDataRestore(TRIGGER_DUMP_NO_ALWAYS), { known, before: REPLICA, after: ORIGIN });
    const out = runScript(g.prepareDump(r.script, { strip: false }));
    assert.equal(q('SELECT count(*) FROM public.loot'), '2', 'the COPY data loaded');
    assert.equal(q('SELECT count(*) FROM public.marker'), '0', 'no attacker code ran');
    assert.equal(q("SELECT count(*) FROM pg_proc WHERE proname IN ('f', 'g')"), '0', 'the file\'s functions do not exist');
    assert.equal(q("SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg', 'trg2')"), '0', 'the file\'s triggers do not exist');
    assert.doesNotMatch(out.stderr, /ERROR/, out.stderr);

    // the split-string function and the replaced SHIPPED function: control replaces it, the new restore leaves the shipped one
    fresh();
    runScript(g.prepareDump(SPLIT_DUMP, { before: REPLICA, after: ORIGIN }));
    assert.equal(q('SELECT public.shipped_fn()'), 'attacker', 'control: the old way replaces a shipped SECURITY DEFINER function with the file\'s');
    fresh();
    g.assertSafeDump(SPLIT_DUMP);
    runScript(g.prepareDump(g.renderDataScript(g.planDataRestore(SPLIT_DUMP), { known, before: REPLICA, after: ORIGIN }).script, { strip: false }));
    assert.equal(q('SELECT public.shipped_fn()'), 'shipped', 'data-only: the shipped function is untouched');
    assert.equal(q('SELECT count(*) FROM public.loot'), '1');
    assert.equal(q("SELECT count(*) FROM pg_proc WHERE proname = 'g'"), '0');
  } finally {
    srv.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
