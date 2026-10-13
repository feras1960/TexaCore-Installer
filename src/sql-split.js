'use strict';
// ════════════════════════════════════════════════════════════════
// sql-split — split a SQL script into top-level statements.
//
// Dollar-quote aware ($tag$ … $tag$), single-quoted strings ('' and E'\'' escapes), "quoted identifiers",
// -- line comments and /* nested block comments */. A statement ends at a ';' outside all of those.
// Used by scripts/sync-baseline.js to drop the auth.* statements from the ERP's auth/storage stub file (GoTrue owns
// that schema on a real install), by the installer's baseline load (retry only the statements psql reported as failed), and by the tests.
// ════════════════════════════════════════════════════════════════

/** @returns {string[]} statements, each including its terminating ';' (the last may lack one). */
function splitStatements(sql) {
  const out = [];
  const n = sql.length;
  let i = 0;
  let start = 0;
  while (i < n) {
    const c = sql[i];
    const c2 = sql[i + 1];
    if (c === '-' && c2 === '-') { // line comment
      const nl = sql.indexOf('\n', i);
      i = nl < 0 ? n : nl + 1;
    } else if (c === '/' && c2 === '*') { // nested block comment
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; }
        else if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; }
        else i++;
      }
    } else if (c === "'") { // string literal ('' escapes; E'..' also honours backslash escapes)
      const prev = i > 0 ? sql[i - 1] : '';
      const isE = (prev === 'E' || prev === 'e') && (i < 2 || !/[A-Za-z0-9_$]/.test(sql[i - 2]));
      i++;
      while (i < n) {
        if (isE && sql[i] === '\\') { i += 2; continue; }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
    } else if (c === '"') { // quoted identifier
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
    } else if (c === '$') { // dollar quote?
      const m = /^\$([A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/.exec(sql.slice(i, i + 80));
      const prev = i > 0 ? sql[i - 1] : '';
      if (m && !/[A-Za-z0-9_]/.test(prev)) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        i = end < 0 ? n : end + tag.length;
      } else {
        i++;
      }
    } else if (c === ';') {
      out.push(sql.slice(start, i + 1));
      i++;
      start = i;
    } else {
      i++;
    }
  }
  if (start < n && sql.slice(start).trim()) out.push(sql.slice(start));
  return out;
}

/** The statement without leading whitespace/comments — what a human would call its first line. */
function stripLeading(stmt) {
  let s = stmt;
  for (;;) {
    const t = s.replace(/^\s+/, '');
    if (t.startsWith('--')) { const nl = t.indexOf('\n'); s = nl < 0 ? '' : t.slice(nl + 1); continue; }
    if (t.startsWith('/*')) { const e = t.indexOf('*/'); s = e < 0 ? '' : t.slice(e + 2); continue; }
    return t;
  }
}

/**
 * Does this statement belong to schema `schema` (its target object, or an ON SCHEMA clause)?
 * Looks at the header only (up to the first newline, max 400 chars): the first schema-qualified identifier decides.
 */
function targetsSchema(stmt, schema) {
  const head = stripLeading(stmt).split('\n', 1)[0].slice(0, 400);
  if (new RegExp(`\\bSCHEMA\\s+"?${schema}"?(?![\\w.])`, 'i').test(head)) return true;
  const m = /(?:^|[\s(,])"?([a-z_][a-z0-9_]*)"?\."?[a-z_][a-z0-9_]*"?/i.exec(head.replace(/'[^']*'/g, "''"));
  return !!(m && m[1].toLowerCase() === schema.toLowerCase());
}

/**
 * For each statement of `sql`: the 1-based line on which psql would report an error in it. psql reports the line of the statement's LAST line
 * (the one holding its terminating ';') — verified for plain, multi-line, dollar-quoted and DO statements. Returns [{ text, endLine, session }].
 * `session` marks SET / RESET / set_config statements, which a retry must replay so the retried statements run in the same session settings.
 */
function statementsWithEndLines(sql) {
  const parts = splitStatements(sql);
  let nl = 0;
  return parts.map((text) => {
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) nl += 1;
    const head = stripLeading(text);
    return { text, endLine: nl + 1, session: /^(SET\s|RESET\s|SELECT\s+pg_catalog\.set_config\s*\()/i.test(head) };
  });
}

/**
 * The script that retries ONLY the statements psql reported as failed (by error line), preceded by every session statement, in file order.
 * Returns { script, retried, unmapped } — `unmapped` lists error lines that match no statement end (the caller then falls back to a full pass).
 */
function buildRetryScript(sql, errorLines) {
  const wanted = new Set(errorLines);
  const stmts = statementsWithEndLines(sql);
  const seen = new Set();
  const keep = [];
  for (const st of stmts) {
    if (st.session) { keep.push(st.text); continue; }
    if (wanted.has(st.endLine)) { keep.push(st.text); seen.add(st.endLine); }
  }
  const unmapped = [...wanted].filter((l) => !seen.has(l));
  return { script: keep.join(''), retried: seen.size, unmapped };
}

module.exports = { splitStatements, stripLeading, targetsSchema, statementsWithEndLines, buildRetryScript };
