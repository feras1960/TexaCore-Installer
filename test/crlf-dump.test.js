'use strict';
// 2.0.7 (Windows smoke of 2.0.6, run 40904528573): a backup RESTORE on Windows said «success» and left companies, entries and documents empty. pg_dump on Windows writes every
// line end as CRLF (289,056 CRLF, 0 LF in the real file); renderDataScript() appended its COPY terminator as `\.` + LF; psql refuses such a COPY ("end-of-copy marker does not
// match previous newline style") for every table - 79 errors. The fix normalises CRLF -> LF over the whole dump before any scan / parse (sql-guard.normalizeNewlines) and on the
// script psql gets. Proofs: the helper itself, a CRLF dump and a mixed dump that give the SAME script as the LF dump, a Mac (LF) dump that is not even copied, the decompress step
// of the restore, and - with the bundled psql 17.6 - the old script failing exactly as Windows did and the new one loading everything.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const g = require('../src/sql-guard');
const BackupManager = require('../src/backup-manager');
const { mkdtemp } = require('./helpers');

const REPLICA = "SET session_replication_role = 'replica';\n";
const ORIGIN = "\nSET session_replication_role = 'origin';\n";
const KNOWN = new Set(['public.loot', 'public.notes', 'auth.users', 'auth.identities']);

// what a pg_dump 17.6 file of a company looks like in miniature: the \restrict pair, settings, DDL with a multi-line function body, COPY blocks (Arabic text, \N, an escaped newline,
// a tab-separated empty field), the auth tables, a sequence value
const LF_LINES = [
  '\\restrict Zk3p9QwErTyUiOp1',
  "SET statement_timeout = 0;", "SET client_encoding = 'UTF8';", "SET standard_conforming_strings = on;",
  'CREATE TABLE public.loot (a integer, b text);',
  'CREATE TABLE public.notes (id integer, body text);',
  'CREATE FUNCTION public.f() RETURNS integer', '    LANGUAGE sql', '    AS $$', '  SELECT 1', '$$;',
  'COPY public.loot (a, b) FROM stdin;', '1\tسلام العالم', '2\t\\N', '3\tline one\\nline two', '4\t', '\\.', '',
  'COPY public.notes (id, body) FROM stdin;', '10\tثابت', '11\tback\\\\slash \\t tab', '\\.', '',
  'COPY auth.users (id, email) FROM stdin;', 'u1\towner@example.test', '\\.', '',
  'COPY auth.identities (id, user_id) FROM stdin;', 'i1\tu1', '\\.', '',
  "SELECT pg_catalog.setval('public.loot_a_seq', 4, true);",
  '\\unrestrict Zk3p9QwErTyUiOp1', '',
];
const LF = Buffer.from(LF_LINES.join('\n'), 'utf8');
const CRLF = Buffer.from(LF_LINES.join('\r\n'), 'utf8');
// a file whose first and last blocks come from a CRLF writer and the middle one from an LF writer (a hand-merged or re-saved file)
const MIXED = Buffer.from(LF_LINES.map((l, i) => l + (i < 14 || i > 21 ? '\r\n' : '\n')).join(''), 'utf8');

const render = (buf) => g.renderDataScript(g.planDataRestore(buf), { known: KNOWN, before: REPLICA, after: ORIGIN });
const hasCR = (buf) => buf.includes(0x0d);

test('normalizeNewlines: CRLF -> LF over a Buffer or a string; a lone CR, Arabic bytes and an LF-only input are untouched; an LF-only Buffer is returned as is (no copy)', () => {
  assert.equal(g.normalizeNewlines('a\r\nb\r\n').toString(), 'a\nb\n');
  assert.equal(g.normalizeNewlines(Buffer.from('a\r\nb\r\nc')).toString(), 'a\nb\nc');
  assert.equal(g.normalizeNewlines(Buffer.from('a\rb\r\nc\r')).toString(), 'a\rb\nc\r', 'a CR that is not followed by LF is not a line end');
  const ar = Buffer.from('سلام\r\nالعالم\r\n', 'utf8');
  assert.equal(g.normalizeNewlines(ar).toString('utf8'), 'سلام\nالعالم\n');
  const lf = Buffer.from('x\ny\n');
  assert.equal(g.normalizeNewlines(lf), lf, 'the same Buffer object: nothing was copied');
  assert.equal(g.normalizeNewlines(Buffer.alloc(0)).length, 0);
  assert.equal(g.normalizeNewlines(Buffer.from('\r\n')).toString(), '\n');
  assert.equal(g.normalizeNewlines(Buffer.from('\r\n\r\n')).toString(), '\n\n');
  // a big one (the real Windows file has ~290,000 line ends): exact against the plain regexp, and fast
  const big = Buffer.from('row\tvalue ' + 'x'.repeat(40) + '\r\n'.repeat(1)).toString('latin1').repeat(120000);
  const t0 = Date.now();
  const out = g.normalizeNewlines(Buffer.from(big, 'latin1'));
  assert.equal(out.toString('latin1'), big.replace(/\r\n/g, '\n'));
  assert.ok(Date.now() - t0 < 3000, `120,000 line ends took ${Date.now() - t0} ms`);
});

test('a CRLF dump (what Windows pg_dump writes): the guard accepts it, the script psql gets has LF only and is BYTE-IDENTICAL to the one made from the LF dump of the same data', () => {
  assert.ok(hasCR(CRLF) && !LF.includes(0x0d));
  assert.equal(g.scanDump(CRLF).findings.length, 0, 'guard-clean');
  assert.doesNotThrow(() => g.assertSafeDump(CRLF));
  const plan = g.planDataRestore(CRLF);
  assert.ok(!hasCR(plan.bytes), 'the plan works on the normalised bytes');
  assert.equal(plan.blocks.length, 4);
  const w = render(CRLF); const m = render(LF);
  assert.ok(!hasCR(w.script), 'no CR anywhere in the script');
  assert.ok(w.script.equals(m.script), 'the same script as the Mac-made dump');
  assert.deepEqual(w.tables, ['public.loot', 'public.notes']);
  assert.equal(w.loaded, 2);
  assert.ok(w.auth.users && w.auth.identities && !hasCR(w.auth.users) && !hasCR(w.auth.identities), 'the login blocks are LF too');
  assert.ok(w.auth.users.equals(m.auth.users) && w.auth.identities.equals(m.auth.identities));
  // every COPY block ends with a terminator that matches the data's line ends
  const t = w.script.toString('utf8');
  assert.match(t, /COPY public\.loot \(a, b\) FROM stdin;\n1\tسلام العالم\n2\t\\N\n3\tline one\\nline two\n4\t\n\\\.\n/);
  assert.match(t, /SELECT pg_catalog\.setval\('public\.loot_a_seq', 4, true\);\n/);
  // and what reaches psql through prepareDump (the program's own wrapper) is LF as well
  assert.ok(!hasCR(g.prepareDump(w.script, { strip: false })));
});

test('a MIXED dump (CRLF and LF writers in one file) gives the same script as the LF dump', () => {
  assert.ok(hasCR(MIXED) && MIXED.includes(Buffer.from('\n10\t')), 'the fixture really mixes both');
  g.assertSafeDump(MIXED);
  assert.ok(render(MIXED).script.equals(render(LF).script));
});

test('a Mac / Linux dump (LF only) is not copied and its script is unchanged', () => {
  assert.equal(g.normalizeNewlines(LF), LF);
  const r = render(LF);
  assert.ok(!hasCR(r.script));
  assert.equal(r.loaded, 2);
});

test('the restore\'s decompress step hands every later reader LF only (scan, plan, tracking-mode check, login step), whichever platform wrote the file', async () => {
  const bm = Object.create(BackupManager.prototype);
  const fromWindows = await bm._decompress(zlib.gzipSync(CRLF));
  assert.ok(!hasCR(fromWindows) && fromWindows.equals(LF), 'Windows file -> the LF dump');
  const fromMac = await bm._decompress(zlib.gzipSync(LF));
  assert.ok(fromMac.equals(LF));
  assert.ok(render(fromWindows).script.equals(render(fromMac).script));
});

const PG = path.join(__dirname, '..', 'bin', 'macos-arm64', 'pg', 'bin');
const haveBundledPg = process.platform === 'darwin' && process.arch === 'arm64' && fs.existsSync(path.join(PG, 'initdb')) && fs.existsSync(path.join(PG, 'psql'));
test('with the bundled psql 17.6: the OLD script (CRLF data + an LF terminator) fails exactly as it did on Windows and loads nothing; the new script loads every row with no error', { skip: !haveBundledPg && 'needs the bundled macOS PostgreSQL', timeout: 120000 }, async () => {
  const { execFileSync, spawn, spawnSync } = require('child_process');
  const dir = mkdtemp('tcx-crlf-');
  const data = path.join(dir, 'data');
  const port = 51000 + Math.floor(Math.random() * 2500);
  execFileSync(path.join(PG, 'initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-sync'], { stdio: 'ignore' });
  const srv = spawn(path.join(PG, 'postgres'), ['-D', data, '-p', String(port), '-k', dir, '-c', 'listen_addresses=127.0.0.1', '-c', 'fsync=off'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 100; i++) { try { execFileSync(path.join(PG, 'pg_isready'), ['-h', '127.0.0.1', '-p', String(port)], { stdio: 'ignore' }); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    const psql = (args, input) => spawnSync(path.join(PG, 'psql'), ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', ...args], { encoding: 'utf8', input });
    const q = (sql) => psql(['-tAc', sql]).stdout.trim();
    const fresh = () => psql(['-c', 'DROP TABLE IF EXISTS public.loot, public.notes CASCADE; CREATE TABLE public.loot (a integer, b text); CREATE TABLE public.notes (id integer, body text); DROP SEQUENCE IF EXISTS public.loot_a_seq; CREATE SEQUENCE public.loot_a_seq;']);
    const run = (buf) => { const f = path.join(dir, `s${Math.random().toString(16).slice(2)}.sql`); fs.writeFileSync(f, buf); return psql(['-f', f, '--set', 'ON_ERROR_STOP=off']); };

    // CONTROL: what 2.0.6 built on Windows - the COPY data exactly as the CRLF dump had it, the terminator LF
    fresh();
    const plan = g.planDataRestore(CRLF);
    const crlfData = (b) => Buffer.from(CRLF.toString('latin1').split('\r\n').slice(b.firstLine, b.lastLine).join('\r\n') + '\r\n', 'latin1');
    const oldScript = Buffer.concat([Buffer.from(`SET client_encoding = 'UTF8';\n${REPLICA}`, 'latin1'),
      Buffer.from('COPY public.loot (a, b) FROM stdin;\n', 'latin1'), crlfData({ firstLine: 12, lastLine: 16 }), Buffer.from('\\.\n', 'latin1'),
      Buffer.from('COPY public.notes (id, body) FROM stdin;\n', 'latin1'), crlfData({ firstLine: 19, lastLine: 21 }), Buffer.from('\\.\n', 'latin1')]);
    assert.ok(oldScript.includes(Buffer.from('\r\n')) && plan.blocks.length === 4);
    const bad = run(oldScript);
    assert.match(bad.stderr, /end-of-copy marker does not match previous newline style/, 'control: the Windows failure reproduced');
    assert.equal(q('SELECT count(*) FROM public.loot'), '0', 'control: nothing loaded');

    // the new path, on the CRLF dump, the mixed dump and the LF dump
    for (const [label, dump] of [['CRLF (Windows)', CRLF], ['mixed', MIXED], ['LF (Mac)', LF]]) {
      fresh();
      g.assertSafeDump(dump);
      const r = render(dump);
      const out = run(g.prepareDump(r.script, { strip: false }));
      assert.doesNotMatch(out.stderr, /ERROR|does not match/, `${label}: ${out.stderr}`);
      assert.equal(q('SELECT count(*) FROM public.loot'), '4', `${label}: loot rows`);
      assert.equal(q('SELECT count(*) FROM public.notes'), '2', `${label}: notes rows`);
      assert.equal(q("SELECT b FROM public.loot WHERE a = 1"), 'سلام العالم', `${label}: Arabic text intact`);
      assert.equal(q("SELECT b FROM public.loot WHERE a = 3"), 'line one\nline two', `${label}: an escaped newline stays one value`);
      assert.equal(q("SELECT (b IS NULL)::text FROM public.loot WHERE a = 2"), 'true', `${label}: \\N is NULL`);
      assert.equal(q('SELECT last_value FROM public.loot_a_seq'), '4', `${label}: the sequence value`);
      // the login blocks (auth.users / identities) are loaded by their own step from these buffers: LF, and psql takes them
      psql(['-c', 'CREATE SCHEMA IF NOT EXISTS auth; DROP TABLE IF EXISTS auth.users; CREATE TABLE auth.users (id text, email text)']);
      const au = run(Buffer.concat([Buffer.from('SET client_encoding = \'UTF8\';\n'), r.auth.users]));
      assert.doesNotMatch(au.stderr, /ERROR|does not match/, au.stderr);
      assert.equal(q('SELECT count(*) FROM auth.users'), '1', `${label}: the login row`);
    }
  } finally {
    srv.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
