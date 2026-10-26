'use strict';
// ════════════════════════════════════════════════════════════════
// bootstrap — how a fresh 2.0.0 install builds its database, and how a data dir is classified on start.
//
// Fresh install:  initdb (ICU en-US, UTC)  →  roles/schemas  →  GoTrue migrate (owns `auth`)  →  storage stubs  →
//                 production baseline (two passes, like the ERP's CI lab)  →  reference data  →  verify  →  marker `ready`.
// The baseline is the redacted production extract pinned in baseline/BASELINE_PIN.json (scripts/sync-baseline.js);
// grants and RLS stay EXACTLY as it creates them — nothing here grants to anon or disables row level security.
//
// This file holds the parts that need no running server (classification, marker, SQL text, error analysis, verification
// arithmetic) so they can be unit-tested; ServiceManager runs the steps.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MARKER_FILE = 'bootstrap.json';
const EXPECTED_PG_MAJOR = 17;
const MARKER_VERSION = 1;

/** The four functions whose production body carries a secret that the baseline redacts (BASELINE.md, "Secret redaction"). */
const REDACTED_FUNCTIONS = [
  'public.auth_email_hook(event jsonb)',
  'public.licensing_register_free(p_hardware_id text, p_hostname text, p_os_info text, p_app_version text)',
  'public.nexa_ops_bot_dispatch()',
  'public.request_email_verification()',
];

/** The only objects a 2.0 install has beyond the baseline (src/bootstrap/local_extras.sql). Verification allows exactly these. */
const LOCAL_EXTRAS = {
  functions: ['public.verify_admin_password(p_input text)'],
  counts: { tables: 1, functions: 1, indexes: 1, views: 0, triggers: 0, policies: 0 }, // platform_admin (+ its pkey) and the gate function
  rlsTables: 1,
};

/** Baseline pass-1 errors that are expected on any non-Supabase server (Realtime's own partitions are not application DDL). */
const EXPECTED_ERROR_PATTERNS = [
  /relation "realtime\.messages_\d{4}_\d{2}_\d{2}" does not exist/,
];

// ─── marker ──────────────────────────────────────────────────────────────────
function markerPath(dataDir) { return path.join(dataDir, MARKER_FILE); }

function readMarker(dataDir) {
  try { return JSON.parse(fs.readFileSync(markerPath(dataDir), 'utf8')); } catch { return null; }
}

/** Atomic merge-write (tmp + rename) so a crash never leaves half a marker. */
function writeMarker(dataDir, patch) {
  fs.mkdirSync(dataDir, { recursive: true });
  const next = { version: MARKER_VERSION, ...(readMarker(dataDir) || {}), ...patch };
  const tmp = markerPath(dataDir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  fs.renameSync(tmp, markerPath(dataDir));
  return next;
}

/** sha256 (hex) of a Buffer / string — the marker records which reference_data.sql was loaded. */
function sha256Hex(buf) { return require('crypto').createHash('sha256').update(buf).digest('hex'); }

/** An existing, finished install whose recorded reference-data sha256 is missing or differs from the packaged file's must load it (once, idempotent). */
function referenceDataIsStale(marker, packagedSha256) {
  return !!marker && marker.status === 'ready' && !!packagedSha256 && marker.referenceDataSha256 !== packagedSha256;
}

// ─── classification ─────────────────────────────────────────────────────────
function pgMajorOf(pgDataDir) {
  try { return parseInt(String(fs.readFileSync(path.join(pgDataDir, 'PG_VERSION'), 'utf8')).trim().split('.')[0], 10); } catch { return null; }
}

/**
 * Classify a data dir WITHOUT touching it.
 *   fresh                  nothing there (or only config files) — build a new database
 *   interrupted_first_run  our own PostgreSQL 17 cluster whose first run never finished (no `ready` marker) — NOT a legacy install
 *   ready                  a finished 2.0 install
 *   legacy_v18             a pre-2.0 data dir (PostgreSQL 15/16 cluster, or a cluster with a pre-2.0 layout) — must not be reused
 *
 * The distinguishing fact is the PostgreSQL major version recorded in PG_VERSION by initdb (1.x bundled 15 on macOS and
 * 16 on Windows; 2.0 bundles 17) — never the absence of the marker alone, which an interrupted first run also lacks.
 */
function detect(dataDir, { expectedPgMajor = EXPECTED_PG_MAJOR } = {}) {
  const pgdata = path.join(dataDir, 'pgdata');
  const marker = readMarker(dataDir);
  let entries = [];
  try { entries = fs.readdirSync(pgdata); } catch { /* no pgdata */ }

  if (!entries.length) {
    // no cluster. A marker without a cluster is a leftover of a wiped dir: start over.
    return { state: 'fresh', pgMajor: null, marker, reason: entries.length === 0 && fs.existsSync(pgdata) ? 'empty pgdata' : 'no pgdata' };
  }
  const major = pgMajorOf(pgdata);
  if (major === null) {
    // initdb died before writing PG_VERSION: a partial cluster (any 1.x cluster has PG_VERSION, so it is not a legacy one).
    return { state: 'interrupted_first_run', pgMajor: null, marker, reason: 'pgdata without PG_VERSION' };
  }
  if (major !== expectedPgMajor) {
    return { state: 'legacy_v18', pgMajor: major, marker, reason: `PostgreSQL ${major} cluster (2.0 uses ${expectedPgMajor})` };
  }
  if (marker && marker.status === 'ready') return { state: 'ready', pgMajor: major, marker, reason: 'ready marker present' };
  return { state: 'interrupted_first_run', pgMajor: major, marker, reason: marker ? `bootstrap status "${marker.status}"` : 'no bootstrap marker' };
}

function stamp(now = new Date()) { return now.toISOString().replace(/[:.]/g, '-'); }

/** Rename `from` to a sibling "<name>.<label>-<timestamp>" (never overwrites, never deletes). Returns the new path. */
function moveAside(from, label, now = new Date()) {
  let to = `${from}.${label}-${stamp(now)}`;
  for (let i = 1; fs.existsSync(to); i++) to = `${from}.${label}-${stamp(now)}-${i}`;
  fs.renameSync(from, to);
  return to;
}

// ─── what survives from a pre-2.0 data dir (and what must NOT) ─────────────────────────────────────────────────────
// A 2.0 install starts a NEW, empty database, so its company list, backup paths and storage folders must not follow it: initBackupOnStartup() would
// point the periodic auto-backup at the OLD .tcdb file and overwrite it with a backup of the new empty database. What may be carried over is the account
// level state only: the licence (key + the encrypted licence.dat, hardware-bound), the cloud-access settings, the admin-portal hash and the UI choices.
const CARRY_CONFIG_FIELDS = ['licenseKey', 'isTrial', 'isFree', 'previousLicenseKey', 'subdomain', 'enableCloud', 'tunnelToken', 'adminPasswordHash', 'port', 'uiLang'];

function pickCarryFields(config) {
  const out = {};
  for (const k of CARRY_CONFIG_FIELDS) if (config && config[k] !== undefined && config[k] !== null && config[k] !== '') out[k] = config[k];
  return out;
}

/** New dir ← the account-level settings of the old one (config.json allowlist + license.dat). Never copies company/backup/storage fields. Returns what was carried. */
function carryForwardSettings(fromDir, toDir, log = () => {}) {
  const carried = { config: [], licenseDat: false };
  try {
    const old = JSON.parse(fs.readFileSync(path.join(fromDir, 'config.json'), 'utf8'));
    const keep = pickCarryFields(old);
    if (Object.keys(keep).length) {
      fs.mkdirSync(toDir, { recursive: true });
      fs.writeFileSync(path.join(toDir, 'config.json'), JSON.stringify(keep, null, 2), { mode: 0o600 });
      carried.config = Object.keys(keep);
    }
  } catch { /* no/unreadable old config */ }
  try {
    const lic = path.join(fromDir, 'license.dat');
    if (fs.existsSync(lic)) { fs.mkdirSync(toDir, { recursive: true }); fs.copyFileSync(lic, path.join(toDir, 'license.dat')); try { fs.chmodSync(path.join(toDir, 'license.dat'), 0o600); } catch { /* ignore */ } carried.licenseDat = true; }
  } catch { /* none */ }
  if (carried.config.length || carried.licenseDat) log(`[Bootstrap] carried over from the old data dir: ${carried.config.join(', ') || '(no config)'}${carried.licenseDat ? ' + license.dat' : ''}`);
  return carried;
}

/**
 * A config.json that stays in place (fresh / interrupted first run) but still holds a pre-2.0 company list or backup paths: keep the original beside it
 * (config.json.pre-2.0-<stamp>, 0600) and rewrite it with the allowlisted fields only. Returns the copy's path or null when nothing needed doing.
 */
function sanitizeConfigInPlace(dataDir, log = () => {}, now = new Date()) {
  const f = path.join(dataDir, 'config.json');
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
  const extra = Object.keys(cfg || {}).filter((k) => !CARRY_CONFIG_FIELDS.includes(k) && cfg[k] !== undefined && !(Array.isArray(cfg[k]) && cfg[k].length === 0));
  const risky = ['companies', 'storagePath', 'currentDbPath', 'tcdbPath'].some((k) => cfg[k]);
  if (!risky) return null;
  let copy = path.join(dataDir, `config.json.pre-2.0-${stamp(now)}`);
  for (let i = 1; fs.existsSync(copy); i++) copy = path.join(dataDir, `config.json.pre-2.0-${stamp(now)}-${i}`);
  fs.copyFileSync(f, copy); try { fs.chmodSync(copy, 0o600); } catch { /* ignore */ }
  fs.writeFileSync(f, JSON.stringify(pickCarryFields(cfg), null, 2), { mode: 0o600 });
  log(`[Bootstrap] old config.json named a company/backup location (${extra.join(', ')}) — the new empty database must not back up over it; original kept as ${copy}`);
  return copy;
}

// ─── the one-time "your previous data is kept here" notice (shown by the launcher window after an upgrade over a 1.x install) ──────────────────────────
const UPGRADE_NOTICE_FILE = 'upgrade-notice.json';

/** The .tcdb files a pre-2.0 config.json names (company backups) — absolute paths only, de-duplicated. */
function collectOldTcdbPaths(configFile, remap = null) {
  const out = []; const seen = new Set();
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { return out; }
  const add = (name, p) => {
    // a file that lived INSIDE the data dir went with it when the dir was moved aside: point at its new place
    if (remap && typeof p === 'string' && (p === remap.from || p.startsWith(remap.from + path.sep))) p = path.join(remap.to, path.relative(remap.from, p));
    if (typeof p !== 'string' || !/\.tcdb$/i.test(p) || !path.isAbsolute(p) || seen.has(p)) return;
    seen.add(p); out.push({ name: String(name || path.basename(p, path.extname(p))).slice(0, 120), path: p });
  };
  for (const c of Array.isArray(cfg.companies) ? cfg.companies : []) if (c) add(c.name, c.tcdbPath);
  add('', cfg.currentDbPath);
  return out;
}

/** Write the notice into the NEW data dir. `folder` = where the previous data now is; `tcdb` = the old company files the config named. Never throws. */
function writeUpgradeNotice(dataDir, { kind, folder, tcdb }, log = () => {}, now = new Date()) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const note = { schema: 1, kind, createdAt: now.toISOString(), folder, tcdb: tcdb || [], dismissedAt: null };
    fs.writeFileSync(path.join(dataDir, UPGRADE_NOTICE_FILE), JSON.stringify(note, null, 2), { mode: 0o600 });
    log(`[Bootstrap] upgrade notice written (${kind}): previous data in ${folder}${note.tcdb.length ? `, ${note.tcdb.length} company file(s) named` : ''}`);
    return note;
  } catch (e) { log(`[Bootstrap] could not write the upgrade notice: ${e.message}`); return null; }
}

/** The notice that is still to be shown (not dismissed), with the `exists` flag of each file re-checked now; null when there is none. */
function readUpgradeNotice(dataDir) {
  try {
    const note = JSON.parse(fs.readFileSync(path.join(dataDir, UPGRADE_NOTICE_FILE), 'utf8'));
    if (!note || note.schema !== 1 || note.dismissedAt) return null;
    return { ...note, folderExists: !!note.folder && fs.existsSync(note.folder), tcdb: (note.tcdb || []).map((t) => ({ ...t, exists: fs.existsSync(t.path) })) };
  } catch { return null; }
}

function dismissUpgradeNotice(dataDir, now = new Date()) {
  const f = path.join(dataDir, UPGRADE_NOTICE_FILE);
  try {
    const note = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!note.dismissedAt) { note.dismissedAt = now.toISOString(); fs.writeFileSync(f, JSON.stringify(note, null, 2), { mode: 0o600 }); }
    return true;
  } catch { return false; }
}

/**
 * Called once at startup BEFORE anything reads the data dir (secrets, config, license). Applies the policy:
 *   legacy_v18            → the WHOLE data dir is moved aside (data, config, backups, legacy secrets all stay on disk,
 *                           untouched); a fresh dir is created. Reusing a 1.x cluster would also mean reusing its fixed,
 *                           public JWT secret.
 *   interrupted_first_run → only the half-built pgdata (+ marker, secrets) is moved aside; config / license stay.
 *   fresh / ready         → nothing.
 * Returns { state, movedTo } (movedTo = new path of the set-aside item, or null).
 */
/** A config that was sanitised in place named company files: tell the user where the original is (the .pre-2.0 copy lives in the data dir itself). */
function noticeForSanitised(dataDir, copy, log) {
  if (!copy) return;
  const tcdb = collectOldTcdbPaths(copy);
  if (tcdb.length) writeUpgradeNotice(dataDir, { kind: 'config-kept', folder: dataDir, tcdb }, log);
}

function prepareDataDir(dataDir, log = () => {}) {
  const d = detect(dataDir);
  let movedTo = null;
  if (d.state === 'legacy_v18') {
    movedTo = moveAside(dataDir, 'v18-backup');
    fs.mkdirSync(dataDir, { recursive: true });
    log(`[Bootstrap] pre-2.0 data dir (${d.reason}) moved aside → ${movedTo} (never deleted)`);
    carryForwardSettings(movedTo, dataDir, log);                       // the licence + cloud settings continue; the company/backup locations do not
    writeUpgradeNotice(dataDir, { kind: 'legacy', folder: movedTo, tcdb: collectOldTcdbPaths(path.join(movedTo, 'config.json'), { from: dataDir, to: movedTo }) }, log);
  } else if (d.state === 'interrupted_first_run') {
    const pgdata = path.join(dataDir, 'pgdata');
    if (fs.existsSync(pgdata)) movedTo = moveAside(pgdata, 'interrupted');
    for (const f of [MARKER_FILE, 'secrets.json', 'secrets.enc']) { // secrets belong to the cluster we just set aside
      const p = path.join(dataDir, f);
      if (fs.existsSync(p)) moveAside(p, 'interrupted');
    }
    log(`[Bootstrap] interrupted first run (${d.reason}) — partial cluster set aside${movedTo ? ' → ' + movedTo : ''}`);
    noticeForSanitised(dataDir, sanitizeConfigInPlace(dataDir, log), log);
  } else if (d.state === 'fresh') {
    noticeForSanitised(dataDir, sanitizeConfigInPlace(dataDir, log), log);   // a config left behind without its cluster still names the old backup file
  }
  return { ...d, movedTo };
}

// ─── pin / files ────────────────────────────────────────────────────────────
function sha256File(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function loadPin(baselineDir) {
  return JSON.parse(fs.readFileSync(path.join(baselineDir, 'BASELINE_PIN.json'), 'utf8'));
}

/** Every file the pin lists must exist with the pinned size and sha256. Returns problems[]. */
function verifyBaselineFiles(baselineDir) {
  let pin;
  try { pin = loadPin(baselineDir); } catch (e) { return [`BASELINE_PIN.json unreadable: ${e.message}`]; }
  const problems = [];
  for (const [name, meta] of Object.entries(pin.files || {})) {
    const f = path.join(baselineDir, name);
    if (!fs.existsSync(f)) { problems.push(`${name} missing`); continue; }
    if (fs.statSync(f).size !== meta.bytes) problems.push(`${name}: size ${fs.statSync(f).size} != ${meta.bytes}`);
    else if (sha256File(f) !== meta.sha256) problems.push(`${name}: sha256 differs from the pin`);
  }
  if (!pin.files || !pin.files['production_baseline.sql']) problems.push('pin does not list production_baseline.sql');
  return problems;
}

// ─── SQL text ───────────────────────────────────────────────────────────────
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Cluster roles + schemas that must exist before GoTrue's migrations and the baseline. Passwords are per-install. */
function rolesSql({ authenticatorPassword, authAdminPassword }) {
  return `
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN CREATE ROLE authenticator LOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin LOGIN NOINHERIT CREATEROLE; END IF;
  -- the rest are owners/grantees the baseline names; none of them can log in
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dashboard_user') THEN CREATE ROLE dashboard_user NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pgbouncer') THEN CREATE ROLE pgbouncer NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN CREATE ROLE supabase_storage_admin NOLOGIN NOINHERIT CREATEROLE; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_realtime_admin') THEN CREATE ROLE supabase_realtime_admin NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_replication_admin') THEN CREATE ROLE supabase_replication_admin NOLOGIN NOINHERIT REPLICATION; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_read_only_user') THEN CREATE ROLE supabase_read_only_user NOLOGIN NOINHERIT BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_functions_admin') THEN CREATE ROLE supabase_functions_admin NOLOGIN NOINHERIT CREATEROLE; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_etl_admin') THEN CREATE ROLE supabase_etl_admin NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_privileged_role') THEN CREATE ROLE supabase_privileged_role NOLOGIN NOINHERIT; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cli_login_postgres') THEN CREATE ROLE cli_login_postgres NOLOGIN NOINHERIT; END IF;
END $$;
ALTER ROLE authenticator PASSWORD ${lit(authenticatorPassword)};
ALTER ROLE supabase_auth_admin PASSWORD ${lit(authAdminPassword)};
GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role, supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO authenticator, anon, authenticated, service_role;

-- as on Supabase: extension functions (uuid_generate_v4, digest, gen_salt, crypt …) live in "extensions" and resolve through search_path
ALTER DATABASE postgres SET search_path TO "$user", public, extensions;
`;
}

// ─── database authentication ───────────────────────────────────────────────
/**
 * pg_hba.conf of a 2.0 install: loopback only, scram-sha-256 for EVERY connection (no `trust` anywhere). The superuser and the two service roles have
 * their own per-install passwords (secrets). On Windows there is no unix socket, so no `local` line.
 */
function hbaText({ windows = false } = {}) {
  return [
    '# TexaCore ERP — generated; rewritten at every start. No trust, no remote hosts.',
    '# TYPE  DATABASE  USER  ADDRESS  METHOD',
    ...(windows ? [] : ['local   all       all                scram-sha-256']),
    'host    all       all   127.0.0.1/32  scram-sha-256',
    'host    all       all   ::1/128       scram-sha-256',
    '',
  ].join('\n');
}

/** Does this pg_hba.conf let anyone in without a password? (`trust`, `password` is fine over loopback but we want scram.) */
function hbaHasTrust(text) {
  return String(text || '').split('\n').some((l) => !/^\s*#/.test(l) && /\btrust\b/.test(l));
}

/** Rows of the SQL that make the superuser / service roles use their per-install passwords (idempotent; roles that do not exist yet are skipped). */
function passwordSql({ dbPassword, authenticatorPassword, authAdminPassword }) {
  return `
ALTER ROLE postgres PASSWORD ${lit(dbPassword)};
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN EXECUTE 'ALTER ROLE authenticator PASSWORD ' || quote_literal(${lit(authenticatorPassword)}); END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN EXECUTE 'ALTER ROLE supabase_auth_admin PASSWORD ' || quote_literal(${lit(authAdminPassword)}); END IF;
END $$;
`;
}

/** After the baseline: nothing that widens access. Only makes PostgREST re-read the catalog. */
function postBaselineSql() {
  return `NOTIFY pgrst, 'reload schema';\n`;
}

// ─── psql output analysis ───────────────────────────────────────────────────
/** psql -q stderr → [{ line, message }] for every "ERROR:" line. */
function parsePsqlErrors(stderr) {
  const out = [];
  for (const l of String(stderr || '').split('\n')) {
    const m = /(?:^|:)(?:\s*psql:[^:]*:(\d+):)?\s*ERROR:\s+(.*)$/.exec(l);
    if (m) out.push({ line: m[1] ? Number(m[1]) : null, message: m[2].trim() });
  }
  return out;
}

/** Split errors into expected / unexpected. A pass-2 "already exists" is the second pass doing its job, not a defect. */
function classifyBaselineErrors(errors, { second }) {
  const expected = [];
  const unexpected = [];
  for (const e of errors) {
    const benign = EXPECTED_ERROR_PATTERNS.some((re) => re.test(e.message))
      || (second && /already exists|is already member of publication|multiple primary keys/.test(e.message));
    (benign ? expected : unexpected).push(e);
  }
  return { expected, unexpected };
}

// ─── loading the baseline: one full pass, then ONLY what failed ──────────────────────────────────────────────────
// The baseline is a plain script with forward references, so a statement may fail on the first pass for a reason a later statement removes. Re-running the
// WHOLE file (the 1.9/early-2.0 way) turned every one of its ~25,000 statements into an "already exists" error (≈12,000 error lines — and, in the
// server log, the text of each statement). Now: psql reports the LINE of every failing statement; the retry script is exactly those statements (plus the
// session SET lines), repeated while it keeps shrinking. A full second pass is the fallback, used only when a failure cannot be mapped to a
// statement or the selective retries stop making progress.
function planRetry(sqlText, errors, { second = false } = {}) {
  const { unexpected } = classifyBaselineErrors(errors, { second });
  if (!unexpected.length) return { mode: 'none', unexpected: 0 };
  if (unexpected.some((e) => e.line == null)) return { mode: 'full', unexpected: unexpected.length, reason: 'an error without a line number' };
  const r = require('./sql-split').buildRetryScript(sqlText, unexpected.map((e) => e.line));
  if (r.unmapped.length) return { mode: 'full', unexpected: unexpected.length, reason: `error line(s) ${r.unmapped.slice(0, 5).join(',')} match no statement` };
  return { mode: 'selective', unexpected: unexpected.length, script: r.script, retried: r.retried };
}

/**
 * run(buf) → { stderr } executes SQL with psql (ON_ERROR_STOP=0). Returns { summary: [{ pass, mode, statements, errors, expected, unexpected }], unexpected: [...] }.
 * No SQL text is kept in the summary or logged — only counts and psql's error messages.
 */
async function loadBaseline(sqlBuf, run, { maxSelective = 6, log = () => {} } = {}) {
  const original = sqlBuf.toString('utf8');
  const summary = [];
  let text = original; let buf = sqlBuf; let mode = 'full'; let fullAgain = false;
  let prev = Infinity; let last = null;
  for (let pass = 1; pass <= maxSelective + 2; pass++) {
    const r = await run(buf);
    const errors = parsePsqlErrors(r.stderr);
    // ("already exists" in a retry = a statement that shares its line with the failed one and had succeeded — benign)
    const cls = classifyBaselineErrors(errors, { second: pass > 1 });
    last = cls.unexpected;
    summary.push({ pass, mode: pass === 1 ? 'full' : mode, errors: errors.length, expected: cls.expected.length, unexpected: cls.unexpected.length });
    if (!cls.unexpected.length) break;
    const plan = planRetry(text, errors, { second: pass > 1 });
    if (plan.mode === 'selective' && plan.unexpected < prev && pass <= maxSelective) {
      prev = plan.unexpected; text = plan.script; buf = Buffer.from(plan.script, 'utf8'); mode = 'selective';
      log(`[Bootstrap] baseline pass ${pass}: ${plan.unexpected} unexpected error(s) — retrying exactly those statements`);
      continue;
    }
    if (!fullAgain) {
      fullAgain = true; text = original; buf = sqlBuf; mode = 'full'; prev = Infinity;
      log(`[Bootstrap] baseline pass ${pass}: ${plan.reason || 'the selective retries stopped making progress'} — one full second pass`);
      continue;
    }
    break;
  }
  return { summary, unexpected: last || [] };
}

// ─── verification arithmetic ────────────────────────────────────────────────
const stripPublic = (s) => String(s).replace(/\bpublic\./g, '');

/**
 * Compare the installed functions to the inventory the baseline ships.
 * `rows` = [{ sig: 'schema.name(identity args)', md5 }] for the four app schemas.
 * Only the four secret-bearing functions may differ in body; none may be missing or extra.
 */
function compareFunctionInventory(inventoryMd5, rows) {
  const want = new Map();
  for (const [k, v] of Object.entries(inventoryMd5 || {})) {
    if (k.startsWith('auth.') || k.startsWith('storage.')) continue;
    want.set(stripPublic(k), v);
  }
  const have = new Map(rows.map((r) => [stripPublic(r.sig), r.md5]));
  const redacted = new Set(REDACTED_FUNCTIONS.map(stripPublic));
  const local = new Set(LOCAL_EXTRAS.functions.map(stripPublic));
  const missing = [];
  const extra = [];
  const mismatched = [];
  for (const [k, v] of want) {
    if (!have.has(k)) missing.push(k);
    else if (have.get(k) !== v && !redacted.has(k)) mismatched.push(k);
  }
  for (const k of have.keys()) if (!want.has(k) && !local.has(k)) extra.push(k);
  return { ok: !missing.length && !extra.length && !mismatched.length, missing, extra, mismatched, expected: want.size, installed: have.size };
}

/** catalog_totals from the inventory (+ the local extras) vs counts measured on the installed database. */
function compareTotals(expectedTotals, measured) {
  const problems = [];
  for (const k of ['tables', 'functions', 'triggers', 'policies', 'indexes', 'views']) {
    if (expectedTotals[k] === undefined) continue;
    const want = Number(expectedTotals[k]) + (LOCAL_EXTRAS.counts[k] || 0);
    if (want !== Number(measured[k])) problems.push(`${k}: expected ${want}, installed ${measured[k]}`);
  }
  return problems;
}

/**
 * The inventory a database is expected to match once the manifest's incremental migrations (2.0.2+: migrations/migrations.json) have ALL been applied:
 * the baseline's counts + the manifest's measured delta, and the baseline's function map with the added / changed functions merged in.
 * `manifest.inventoryAfter` = { catalogDelta: { tables, functions, triggers, policies, indexes, views, rlsTables }, functions: { 'public.f(args)': md5 }, removed: [sig] },
 * measured on a lab install before and after the migrations (and proved against production's post-image: scripts/e2e/migrations-check.js).
 * Returns { inv, rlsDelta }; without inventoryAfter the baseline inventory is returned unchanged.
 */
function applyMigrationInventory(inv, manifest) {
  const after = manifest && manifest.inventoryAfter;
  if (!after) return { inv, rlsDelta: 0 };
  const out = { ...inv, catalog_totals: { ...(inv.catalog_totals || {}) }, functions_md5: { ...(inv.functions_md5 || {}) } };
  for (const [k, d] of Object.entries(after.catalogDelta || {})) if (k !== 'rlsTables' && out.catalog_totals[k] !== undefined) out.catalog_totals[k] = Number(out.catalog_totals[k]) + Number(d);
  for (const [sig, md5] of Object.entries(after.functions || {})) out.functions_md5[sig] = md5;
  for (const sig of after.removed || []) delete out.functions_md5[sig];
  return { inv: out, rlsDelta: Number((after.catalogDelta || {}).rlsTables || 0) };
}

module.exports = {
  applyMigrationInventory,
  MARKER_FILE, EXPECTED_PG_MAJOR, REDACTED_FUNCTIONS, LOCAL_EXTRAS,
  readMarker, writeMarker, markerPath, sha256Hex, referenceDataIsStale,
  pgMajorOf, detect, moveAside, prepareDataDir,
  carryForwardSettings, sanitizeConfigInPlace, CARRY_CONFIG_FIELDS,
  collectOldTcdbPaths, writeUpgradeNotice, readUpgradeNotice, dismissUpgradeNotice, UPGRADE_NOTICE_FILE,
  loadPin, verifyBaselineFiles, sha256File, hbaText, hbaHasTrust, passwordSql,
  rolesSql, postBaselineSql, planRetry, loadBaseline,
  parsePsqlErrors, classifyBaselineErrors,
  compareFunctionInventory, compareTotals, stripPublic,
};
