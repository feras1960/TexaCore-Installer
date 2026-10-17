'use strict';
// ════════════════════════════════════════════════════════════════
// sql-guard - what a company file may make the program's database do (2.0.4, security findings S3 and F1).
//
// A .tcdb is a (decrypted, decompressed) pg_dump. The default encryption key of a company file is public (this repository is), so a file made by someone else can
// carry anything, and the program used to feed it to `psql -f` as the database superuser. Three layers now stand between a file and the machine:
//   1. THE SCAN (this file's lexer + statement allowlist): a psql META-COMMAND (`\! cmd`, `\copy … program`, `\i`, `\o`, `\gexec` … - a backslash outside a quoted
//      string, also right after a COPY data block), COPY … PROGRAM / to a file, ALTER SYSTEM, an unshipped extension or language, file / large-object functions,
//      role changes … refuse the file (TCDB_UNSAFE_SQL) before anything is touched. The meta-command class is closed twice: by this lexer and by psql's own
//      restricted mode (`\restrict <random key> … \unrestrict`, the program's key, the file author's pair is dropped).
//      WHAT THE SCAN CANNOT DO: tell a harmless function body from a harmful one. A real file legitimately carries thousands of functions (most of them
//      SECURITY DEFINER) and triggers, and a statement built from pieces inside such a body ('COPY x TO PROG'||'RAM') is invisible to any word scan.
//   2. DATA-ONLY RESTORE (planDataRestore / renderDataScript, below): the restore does not run the file's DDL at all. It takes the COPY data of the tables the
//      database already has and the sequence values, nothing else, and psql is given a script BUILT by the program. No function, trigger, view or policy of
//      a file ever exists in the database, so no file-supplied code runs - not during the restore and not later.
//   3. psql's restricted mode around that script (defence in depth for layer 2).
// What remains open is NOT in this file: data that a SHIPPED function later mistrusts too little (an ordinary bug class, as for any data), and the superuser
// the restore runs as (a non-superuser restore is planned). Findings carry the line number and the kind only - never the text. Pure, no dependencies.
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');

const KIND_TEXT = {
  'meta-command': 'a psql meta-command (a backslash outside a quoted string)',
  'statement': 'a statement TexaCore never writes (only table / view / function / index / trigger / policy definitions, COPY data and sequence values are accepted)',
  'copy-program': 'COPY … PROGRAM',
  'copy-file': 'COPY from or to a file on the server',
  'copy-to': 'COPY … TO',
  'copy-unterminated': 'a COPY data block that never ends',
  'copy-ambiguous-end': 'a COPY data line that starts like the end-of-data marker',
  'copy-shape': 'a COPY statement that is not "COPY <table> [(columns)] FROM stdin"',
  'alter-system': 'ALTER SYSTEM',
  'extension': 'CREATE EXTENSION of an extension the program does not ship',
  'language': 'a procedural language other than SQL / PL/pgSQL',
  'server-object': 'a foreign server / data wrapper / dblink',
  'file-function': 'a file, large-object or server-control function',
  'role': 'CREATE / ALTER / DROP ROLE, SET ROLE or SET SESSION AUTHORIZATION',
  'setting': 'a setting that changes how the script is read or what it may do',
  'unterminated': 'a string, comment or statement that never ends',
  'restrict-misplaced': 'a \\restrict / \\unrestrict line with an unexpected key',
  'trigger-state': 'ALTER TABLE … ENABLE / DISABLE ALWAYS | REPLICA TRIGGER (a trigger that fires even while a file is being loaded)',
};

/** Extensions the program's database ships and its dumps may name. Anything else is refused. */
const SAFE_EXTENSIONS = new Set([
  'pgcrypto', 'uuid-ossp', 'pg_trgm', 'btree_gin', 'btree_gist', 'citext', 'unaccent', 'fuzzystrmatch', 'hstore', 'ltree', 'intarray', 'tablefunc',
  'pg_stat_statements', 'plpgsql', 'pgjwt', 'moddatetime', 'pg_graphql', 'pgsodium', 'supabase_vault', 'vector',
]);
const SAFE_LANGUAGES = new Set(['sql', 'plpgsql', 'internal']);

// functions / identifiers that read or write the server's files, control the server, or open other connections. Matched as whole words anywhere in a
// statement (also inside function bodies and string literals: dynamic SQL built from pieces is why the check is deliberately broad).
const DANGEROUS_WORDS = [
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_ls_logdir', 'pg_ls_waldir', 'pg_ls_tmpdir', 'pg_ls_archive_statusdir', 'pg_stat_file', 'pg_file_write',
  'pg_file_rename', 'pg_file_unlink', 'pg_logdir_ls', 'lo_import', 'lo_export', 'lo_from_bytea', 'lo_put', 'lo_creat', 'lo_create',
  'dblink', 'dblink_exec', 'dblink_connect', 'dblink_connect_u', 'postgres_fdw', 'file_fdw', 'pg_terminate_backend', 'pg_cancel_backend', 'pg_reload_conf',
  'pg_rotate_logfile', 'pg_promote', 'pg_switch_wal', 'pg_create_restore_point', 'pg_backup_start', 'pg_backup_stop', 'pg_start_backup', 'pg_stop_backup',
  'pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program', 'pg_create_physical_replication_slot', 'pg_create_logical_replication_slot',
  'pg_drop_replication_slot', 'pg_replication_origin_create', 'pg_wal_replay_pause', 'pg_wal_replay_resume', 'adminpack', 'pg_ident_file_mappings',
  'pg_hba_file_rules', 'current_setting_file', 'plpython3u', 'plpythonu', 'plperlu', 'pltclu', 'plsh',
];
const DANGEROUS_RE = new RegExp(`(^|[^A-Za-z0-9_])(${DANGEROUS_WORDS.join('|')})([^A-Za-z0-9_]|$)`, 'i');

const isIdentStart = (c) => /[A-Za-z_\u0080-￿]/.test(c);
const isIdentChar = (c) => /[A-Za-z0-9_$\u0080-￿]/.test(c);

/**
 * Lex `text` into statements. Returns { statements: [{ start, line, raw }], findings, copyBlocks }.
 * `raw` is the statement's text WITHOUT comments (quoted parts kept), used for the keyword checks; `code` has quoted parts blanked.
 */
function lex(text) {
  const findings = [];
  const add = (kind, line) => { if (findings.length < 50) findings.push({ kind, line }); };
  const statements = [];
  let copyBlocks = 0;
  const n = text.length;
  let i = 0;
  let line = 1;
  let raw = '';        // the statement so far, comments removed, literals kept
  let code = '';       // the statement so far, literals blanked (what the keyword checks read)
  let stmtLine = 1;
  let started = false;
  let atLineStart = true;
  let pendingCopy = false;   // a `COPY … FROM stdin;` ended on this line: its data starts on the NEXT line (the rest of THIS line is still script)
  let pendingCopyStmt = -1;  // the index (in `statements`) of that COPY statement
  const copies = [];         // [{ stmt, start, end, line }]: the data of each COPY block is text.slice(start, end) (whole lines; `end` = where the `\.` line starts)

  const begin = () => { if (!started) { started = true; stmtLine = line; } };
  const flush = (withSemicolon) => {
    if (started && (code.trim() || raw.trim())) statements.push({ line: stmtLine, raw, code, terminated: withSemicolon });
    raw = ''; code = ''; started = false;
  };

  /** `p` = the index just after the newline that ends the COPY line. Returns the index after the line that is exactly `\.` (the end of the data). */
  let lastDataEnd = -1;
  const readCopyData = (p) => {
    let curLine = line;
    while (p <= n) {
      if (p >= n) { add('copy-unterminated', curLine); line = curLine; lastDataEnd = -1; return n; }
      let e = text.indexOf('\n', p);
      if (e === -1) e = n;
      let l = text.slice(p, e);
      if (l.endsWith('\r')) l = l.slice(0, -1);
      if (l === '\\.') { lastDataEnd = p; line = curLine + 1; return e >= n ? n : e + 1; }
      if (l.startsWith('\\.')) add('copy-ambiguous-end', curLine);
      if (e >= n) { add('copy-unterminated', curLine); line = curLine; lastDataEnd = -1; return n; }
      p = e + 1; curLine += 1;
    }
    add('copy-unterminated', curLine);
    line = curLine;
    lastDataEnd = -1;
    return n;
  };

  while (i < n) {
    const c = text[i];
    const c2 = text[i + 1];
    if (c === '\n') {
      line++; raw += c; code += c; i++;
      if (pendingCopy) {
        pendingCopy = false; copyBlocks++;
        const dataStart = i; const dataLine = line;
        i = readCopyData(i);
        if (lastDataEnd >= 0) copies.push({ stmt: pendingCopyStmt, start: dataStart, end: lastDataEnd, line: dataLine });
      }
      atLineStart = true;
      continue;
    }
    // ── comments (removed from the statement) ──
    if (c === '-' && c2 === '-') { while (i < n && text[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      let depth = 1; i += 2;
      while (i < n && depth > 0) {
        if (text[i] === '/' && text[i + 1] === '*') { depth++; i += 2; }
        else if (text[i] === '*' && text[i + 1] === '/') { depth--; i += 2; }
        else { if (text[i] === '\n') line++; i++; }
      }
      if (depth > 0) add('unterminated', line);
      raw += ' '; code += ' ';
      continue;
    }
    // ── a backslash outside every quote: a psql meta-command ──
    if (c === '\\') {
      // pg_dump 17.6+ writes `\restrict KEY` first and `\unrestrict KEY` last; prepareDump() removes them, they are never executed. Anything else is refused.
      const eol = text.indexOf('\n', i);
      const lineText = text.slice(i, eol === -1 ? n : eol).replace(/\r$/, '');
      if (atLineStart && !started && /^\\(restrict|unrestrict) [A-Za-z0-9]{8,200}$/.test(lineText)) {
        i = eol === -1 ? n : eol; continue;
      }
      add('meta-command', line);
      while (i < n && text[i] !== '\n') i++;   // what follows on that line is the command's arguments
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') { raw += c; code += c; i++; continue; }
    atLineStart = false;
    begin();
    // ── quoted things ──
    if (c === '\'') {
      const prev = text[i - 1];
      const escape = (prev === 'E' || prev === 'e') && !(i >= 2 && isIdentChar(text[i - 2]));
      const startLine = line;
      let j = i + 1; let closed = false;
      while (j < n) {
        const d = text[j];
        if (d === '\n') line++;
        if (escape && d === '\\') { if (text[j + 1] === '\n') line++; j += 2; continue; }
        if (d === '\'') { if (text[j + 1] === '\'') { j += 2; continue; } closed = true; j++; break; }
        j++;
      }
      if (!closed) { add('unterminated', startLine); raw += text.slice(i); code += "''"; i = n; break; }
      raw += text.slice(i, j); code += "''";
      i = j; continue;
    }
    if (c === '"') {
      let j = i + 1; let closed = false;
      while (j < n) { if (text[j] === '\n') line++; if (text[j] === '"') { if (text[j + 1] === '"') { j += 2; continue; } closed = true; j++; break; } j++; }
      if (!closed) { add('unterminated', line); i = n; break; }
      raw += text.slice(i, j); code += text.slice(i, j).toLowerCase();   // identifiers stay visible to the keyword checks
      i = j; continue;
    }
    if (c === '$' && !isIdentChar(text[i - 1] || ' ')) {
      const m = /^\$([A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/.exec(text.slice(i, i + 128));
      if (m) {
        const tag = m[0];
        const endAt = text.indexOf(tag, i + tag.length);
        if (endAt === -1) { add('unterminated', line); raw += text.slice(i); code += '$$'; i = n; break; }
        const body = text.slice(i, endAt + tag.length);
        for (const ch of body) if (ch === '\n') line++;
        raw += body; code += '$$';
        i = endAt + tag.length; continue;
      }
    }
    // ── statement end ──
    if (c === ';') {
      // psql does not end a statement at the ';' of a SQL-standard function body (CREATE FUNCTION … BEGIN ATOMIC … ; … END)
      if (/^\s*create\b[^;]*\bfunction\b|^\s*create\b[^;]*\bprocedure\b/i.test(code) && /\bbegin\s+atomic\b/i.test(code) && !/\bend\s*$/i.test(code)) { raw += c; code += c; i++; continue; }
      raw += c; code += c; i++;
      const head = code.trim().toLowerCase().replace(/\s+/g, ' ');
      flush(true);
      if (/^copy\b/.test(head) && /\bfrom stdin\b/.test(head) && !/\bprogram\b/.test(head)) { pendingCopy = true; pendingCopyStmt = statements.length - 1; }
      continue;
    }
    raw += c; code += c.toLowerCase(); i++;
  }
  if (started && code.trim()) flush(false);   // a statement without its final ';' - psql runs it at the end of the file
  if (pendingCopy) add('copy-unterminated', line);
  return { statements, findings, copyBlocks, copies };
}

// What a TexaCore dump (pg_dump --schema=public --schema=auth --no-owner --no-acl, plain) is made of. Any other statement is refused: a DO block, a plain
// SELECT, DROP, ALTER ROLE / SYSTEM / DATABASE … are never written by the program.
const ALLOWED_HEADS = [
  /^set (?:session |local )?[a-z_.]+ ?(?:=|to) /,
  /^select pg_catalog\.(?:set_config|setval)\(/,   // (its exact shape is checked below)
  /^create (?:or replace )?(?:unlogged |temporary |temp |global |recursive )*(?:table|view|materialized view)\b/,
  /^create (?:unique )?index\b/,
  /^create (?:or replace )?(?:function|procedure|aggregate|operator|cast|collation|domain|type)\b/,
  /^create (?:or replace )?(?:constraint )?trigger\b/,
  /^create (?:sequence|policy|schema|statistics|rule|text search \w+)\b/,
  /^create extension\b/,
  /^alter (?:table|sequence|type|function|procedure|view|materialized view|index|domain|policy|trigger|aggregate|extension|schema|collation|statistics|rule|operator|text search \w+)\b/,
  /^comment on\b/,
  /^(?:grant|revoke) [^;]* on /,
  /^copy\b/,
];

/** Findings for one statement (the lexed `code`/`raw`). */
function checkStatement(st) {
  const out = [];
  const code = st.code.replace(/\s+/g, ' ').trim().toLowerCase();
  const raw = st.raw;
  const add = (kind) => out.push({ kind, line: st.line });
  if (!code) return out;
  if (!ALLOWED_HEADS.some((re) => re.test(code))) add('statement');
  if (/^copy\b/.test(code)) {
    if (/\bprogram\b/.test(code)) add('copy-program');
    else if (!/^copy (?:"[^"]*"|[a-z0-9_$.])+(?: ?\([^)]*\))? from stdin;?$/.test(code)) {
      if (/\bto\b/.test(code) && !/\bfrom\b/.test(code)) add('copy-to');
      else if (/\bfrom\b/.test(code) && !/\bfrom stdin\b/.test(code)) add('copy-file');
      else add('copy-shape');
    }
  }
  // COPY … PROGRAM written inside a function / trigger body or a string (it would run later, as the database superuser)
  if (/\bcopy\b[^;]*\bprogram\b/i.test(raw) && !/^copy\b/.test(code)) add('copy-program');
  if (/^alter system\b/.test(code)) add('alter-system');
  // 2.0.4 (F1): a trigger set ALWAYS / REPLICA fires during the restore even under session_replication_role = replica. No real dump says that (measured on the real files: none),
  // and the restore no longer runs a file's DDL anyway (planDataRestore) - refusing it is the second lock on the same door.
  if (/^alter table\b/.test(code) && /\b(?:enable|disable) (?:always|replica) (?:trigger|rule)\b/.test(code)) add('trigger-state');
  if (/^create (?:or replace )?(?:trusted )?(?:procedural )?language\b/.test(code)) add('language');
  if (/^create (?:or replace )?(?:function|procedure)\b/.test(code) || /^do\b/.test(code)) {
    // the LANGUAGE clause of a function (after its signature) / of a DO block
    for (const m of code.matchAll(/\blanguage\s+'?"?([a-z0-9_]+)/g)) if (!SAFE_LANGUAGES.has(m[1])) { add('language'); break; }
  }
  const ext = /^create extension (?:if not exists )?"?([a-z0-9_-]+)"?/.exec(code);
  if (ext && !SAFE_EXTENSIONS.has(ext[1])) add('extension');
  if (/^alter extension\b/.test(code) && !/^alter extension "?([a-z0-9_-]+)"? (?:set schema|update|add|drop)/.test(code)) add('extension');
  if (/^(create|alter|drop) (server|foreign data wrapper|foreign table|user mapping)\b/.test(code) || /^import foreign schema\b/.test(code)) add('server-object');
  if (/^(create|alter|drop) (role|user|group)\b|^set (session |local )?role\b|^set session authorization\b|^reset role\b|^reset session authorization\b/.test(code)) add('role');
  if (/^(create|drop) (publication|subscription)\b|^alter (publication|subscription)\b/.test(code)) add('server-object');
  // the only SELECTs a dump has: pg_dump's `select pg_catalog.set_config('search_path', '', false)` and the sequence values - literals only, nothing nested
  const rawN = raw.replace(/\s+/g, ' ').trim().toLowerCase();
  if (/^select\b/.test(code)
    && !/^select pg_catalog\.set_config\('search_path', '[^']*', (?:false|true)\) ?;?$/.test(rawN)
    && !/^select pg_catalog\.setval\('[a-z0-9_.\"$]+(?:'::regclass)?', -?\d+, (?:true|false)\) ?;?$/.test(rawN)) add('statement');
  // settings that change how this very script is lexed or what the session may do (read from the text WITH its literals: SET client_encoding = 'UTF8').
  // A CREATE statement cannot change the session (a function body that merely READS session_replication_role is ordinary), so they are exempt.
  if (/^create\b/.test(code)) return finish(out, raw, add);
  if (/\bstandard_conforming_strings\b/.test(rawN) && !/^set standard_conforming_strings ?(=|to) ?(on|'on'|true)\s*;?$/.test(rawN)) add('setting');
  if (/\bclient_encoding\b/.test(rawN) && !/^set client_encoding ?(=|to) ?'?utf-?8'?\s*;?$/.test(rawN)) add('setting');
  if (/\b(session_replication_role|default_transaction_read_only|session_preload_libraries|local_preload_libraries|shared_preload_libraries|dynamic_library_path|log_directory|archive_command|restore_command)\b/.test(rawN)
    && !/^set session_replication_role ?(=|to) ?'?(replica|origin)'?\s*;?$/.test(rawN)) add('setting');
  if (/^load\b/.test(code)) add('setting');
  return finish(out, raw, add);
}

/** The checks every statement gets last: file / server-control functions anywhere in it, bodies and strings included. */
function finish(out, raw, add) {
  if (DANGEROUS_RE.test(raw)) add('file-function');
  return out;
}

/** The whole report: { findings: [{kind, line}], statements, copyBlocks }. Never throws on content. */
function scanDump(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  const { statements, findings, copyBlocks } = lex(text);
  const all = [...findings];
  for (const st of statements) for (const f of checkStatement(st)) { if (all.length < 100) all.push(f); }
  all.sort((a, b) => a.line - b.line);
  return { findings: all, statements: statements.length, copyBlocks };
}

/** Throws an Error with code TCDB_UNSAFE_SQL (and `.findings`: kind + line only) when the dump holds anything above. */
function assertSafeDump(input) {
  const rep = scanDump(input);
  if (rep.findings.length) {
    const kinds = [...new Set(rep.findings.map((f) => f.kind))];
    const first = rep.findings[0];
    const err = new Error(
      `هذا الملف يحتوي أوامر لا تصدر عن TexaCore (${kinds.map((k) => KIND_TEXT[k] || k).join('، ')} — السطر ${first.line}) فرُفض فتحه ولم يتغيّر شيء. | `
      + `This file contains commands TexaCore never writes (${kinds.map((k) => KIND_TEXT[k] || k).join(', ')} - line ${first.line}); it was refused and nothing was changed.`);
    err.code = 'TCDB_UNSAFE_SQL';
    err.findings = rep.findings.slice(0, 20);
    throw err;
  }
  return rep;
}

/**
 * The script to give psql for a dump that passed assertSafeDump(): the dump's own \restrict / \unrestrict lines are removed (their key is the file author's) and
 * the program's own random pair wraps everything. `before` / `after` (statements of the program's own) go inside the wrap.
 */
function prepareDump(input, { before = '', after = '', key = crypto.randomBytes(24).toString('hex'), strip = true } = {}) {
  // byte for byte: the dump is read as latin1 (one char per byte) so no byte of it is ever re-encoded; only whole lines of the two \restrict kinds are dropped
  // (strip:false = not even those: the script is the program's own, built by renderDataScript(), and its COPY data is passed on exactly as it came)
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  const body = strip ? buf.toString('latin1').split('\n').filter((l) => !/^\\(restrict|unrestrict) [A-Za-z0-9]{8,200}\r?$/.test(l)).join('\n') : buf.toString('latin1');
  return Buffer.concat([Buffer.from(`\\restrict ${key}\n${before}`, 'latin1'), Buffer.from(body, 'latin1'), Buffer.from(`${after}\n\\unrestrict ${key}\n`, 'latin1')]);
}


// ════════════════════════════════════════════════════════════════
// DATA-ONLY RESTORE (2.0.4, security finding F1)
//
// The guard above refuses what a dump should never say. What it cannot refuse is what a dump LEGITIMATELY says: a real company file carries the whole schema -
// measured on the real files: ~2,280 functions (~1,910 of them SECURITY DEFINER), ~1,300 triggers, one constraint trigger, policies, views - and psql runs it as the
// database superuser. A file written by someone else could therefore add a trigger function (it runs when the app next touches that table) or replace a shipped
// SECURITY DEFINER function with its own (it runs as the superuser the next time the program calls it) and no word scan can tell that from the real thing.
//
// So nothing of that is run any more. A company file is DATA: the program's own database already has its schema (the baseline and the migrations the program
// ships), the restore takes from the file only
//   • the COPY data of the tables the database already has (public.*, and auth.users / auth.identities for the logins), and
//   • the sequence values (`SELECT pg_catalog.setval('public.x_seq', n, true)`, literals only),
// and every other statement - CREATE FUNCTION / TRIGGER / VIEW / POLICY / TABLE / INDEX, ALTER, GRANT, COMMENT, SET … - is skipped. The script psql gets is BUILT here:
// each COPY header is rebuilt from the table and column names it was parsed into (no byte of the file's own header text reaches psql), the data lines follow
// unchanged up to the `\.` line, and the program's own settings come first. No function, trigger, view or policy of the file ever exists in the database, and
// nothing of the file but data is executed. (Side effect for the better: an older file no longer REPLACES the shipped functions with its own, older bodies.)
// ════════════════════════════════════════════════════════════════
const IDENT_SRC = '(?:[A-Za-z_\\x80-\\xff][A-Za-z0-9_$\\x80-\\xff]*|"[^"]+")';   // an unquoted identifier, or a double-quoted one without an embedded quote
const sticky = (src) => new RegExp(src, 'y');
const IDENT_RE = sticky(IDENT_SRC);

/** `COPY [schema.]table [(col, …)] FROM stdin;` -> { schemaTok, tableTok, columnToks } (the identifier tokens exactly as written), or null for any other shape. */
function parseCopyHeader(raw) {
  const s = String(raw);
  let p = 0;
  const ws = () => { while (p < s.length && ' \t\r\n'.includes(s[p])) p++; };
  const word = (w) => {
    ws();
    if (s.slice(p, p + w.length).toLowerCase() !== w) return false;
    if (/[A-Za-z0-9_$\x80-\xff]/.test(s[p + w.length] || ' ')) return false;
    p += w.length; return true;
  };
  const ident = () => { ws(); IDENT_RE.lastIndex = p; const m = IDENT_RE.exec(s); if (!m) return null; p += m[0].length; return m[0]; };
  const ch = (c) => { ws(); if (s[p] !== c) return false; p++; return true; };
  if (!word('copy')) return null;
  let schemaTok = null; let tableTok = ident();
  if (!tableTok) return null;
  if (ch('.')) { schemaTok = tableTok; tableTok = ident(); if (!tableTok) return null; }
  let columnToks = null;
  if (ch('(')) {
    columnToks = [];
    for (;;) {
      const c = ident(); if (!c) return null;
      columnToks.push(c);
      if (ch(',')) continue;
      if (ch(')')) break;
      return null;
    }
  }
  if (!word('from') || !word('stdin')) return null;
  ch(';'); ws();
  if (p !== s.length) return null;
  return { schemaTok, tableTok, columnToks };
}

/** The name an identifier token stands for (unquoted = folded to lower case, quoted = as written), as text (the bytes of the file are latin1 chars here: decode as UTF-8). */
function identName(tok) {
  const t = tok.startsWith('"') ? tok.slice(1, -1) : tok.toLowerCase();
  return Buffer.from(t, 'latin1').toString('utf8');
}

/**
 * Read a dump as DATA. Never throws on content. Returns
 *   { blocks: [{ schema, table, qualified, copyLine, columns, start, end, line }], setvals: [text], ignored: { total, kinds: { 'create function': n, … } }, bytes }
 * `start`/`end` are BYTE offsets of the block's data lines in the input. Run assertSafeDump() first; this only decides what is taken.
 */
function planDataRestore(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  const text = buf.toString('latin1');                 // one char per byte: every offset below is a byte offset
  const { statements, copies } = lex(text);
  const copyOf = new Map(copies.map((c) => [c.stmt, c]));
  const blocks = []; const setvals = []; const kinds = {}; let ignoredTotal = 0;
  const skip = (code) => {
    ignoredTotal++;
    const k = code.replace(/\s+/g, ' ').trim().toLowerCase().split(' ').slice(0, 2).join(' ').slice(0, 40) || '(empty)';
    kinds[k] = (kinds[k] || 0) + 1;
  };
  statements.forEach((st, idx) => {
    const code = st.code;
    if (/^\s*copy\b/i.test(code)) {
      const data = copyOf.get(idx);
      const h = data ? parseCopyHeader(st.raw.trim()) : null;
      if (!h) { skip('copy (not a plain COPY … FROM stdin)'); return; }
      const schemaTok = h.schemaTok || 'public';
      const copyLine = `COPY ${schemaTok}.${h.tableTok}${h.columnToks ? ` (${h.columnToks.join(', ')})` : ''} FROM stdin;\n`;
      blocks.push({ schema: identName(schemaTok), table: identName(h.tableTok), qualified: `${identName(schemaTok)}.${identName(h.tableTok)}`, truncateName: `${schemaTok}.${h.tableTok}`, copyLine, columns: h.columnToks ? h.columnToks.map(identName) : null, start: data.start, end: data.end, line: data.line });
      return;
    }
    const rawN = st.raw.replace(/\s+/g, ' ').trim().toLowerCase();
    const sv = /^select pg_catalog\.setval\('((?:public|auth)\.[a-z0-9_]+)'(?:::regclass)?, (-?\d{1,19}), (true|false)\) ?;?$/.exec(rawN);
    if (sv) { setvals.push(`SELECT pg_catalog.setval('${sv[1]}', ${sv[2]}, ${sv[3]});\n`); return; }
    skip(code);
  });
  return { blocks, setvals, ignored: { total: ignoredTotal, kinds }, bytes: buf };
}

/**
 * The script for psql, built from a plan. `known` = a Set of 'schema.table' names the database already has (null = take every public table).
 * Takes public.* tables that exist, the sequence values, and (separately, for the login step) auth.users / auth.identities.
 * Returns { script: Buffer, tables: [truncate names], auth: { users: Buffer|null, identities: Buffer|null }, skipped: [{ table, why }], loaded: n }
 */
function renderDataScript(plan, { known = null, before = '', after = '' } = {}) {
  const buf = plan.bytes;
  const parts = [];
  const tables = []; const skipped = []; const seen = new Set();
  const auth = { users: null, identities: null };
  const piece = (b) => Buffer.concat([Buffer.from(b.copyLine, 'latin1'), buf.subarray(b.start, b.end), Buffer.from('\\.\n', 'latin1')]);
  let loaded = 0;
  for (const b of plan.blocks) {
    if (b.schema === 'auth' && (b.table === 'users' || b.table === 'identities')) {
      if (!auth[b.table] && (!known || known.has(b.qualified))) auth[b.table] = piece(b);   // the first block of each, like the previous restore
      continue;
    }
    if (b.schema === 'auth') { skipped.push({ table: b.qualified, why: 'auth-other' }); continue; }   // GoTrue's own bookkeeping (sessions, tokens, audit log, its migrations): never carried between installs
    if (b.schema !== 'public') { skipped.push({ table: b.qualified, why: 'schema' }); continue; }
    if (known && !known.has(b.qualified)) { skipped.push({ table: b.qualified, why: 'unknown-table' }); continue; }
    parts.push(piece(b)); tables.push(b.truncateName); loaded++; seen.add(b.qualified);
  }
  const seq = plan.setvals.map((t) => Buffer.from(t, 'latin1'));
  const head = Buffer.from(
    // what the dump's own first lines used to set, now the program's: UTF-8 data, no time limits on a long COPY, replica role (foreign keys / user triggers off, as before)
    `SET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\nSET statement_timeout = 0;\nSET lock_timeout = 0;\nSET idle_in_transaction_session_timeout = 0;\n${before}`, 'latin1');
  const script = Buffer.concat([head, ...parts, ...seq.map((x) => x), Buffer.from(`${after}`, 'latin1')]);
  return { script, tables, auth, skipped, loaded };
}

module.exports = { scanDump, assertSafeDump, prepareDump, planDataRestore, renderDataScript, parseCopyHeader, lex, checkStatement, KIND_TEXT, SAFE_EXTENSIONS };
