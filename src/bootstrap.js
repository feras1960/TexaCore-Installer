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

/**
 * Called once at startup BEFORE anything reads the data dir (secrets, config, license). Applies the policy:
 *   legacy_v18            → the WHOLE data dir is moved aside (data, config, backups, legacy secrets all stay on disk,
 *                           untouched); a fresh dir is created. Reusing a 1.x cluster would also mean reusing its fixed,
 *                           public JWT secret.
 *   interrupted_first_run → only the half-built pgdata (+ marker, secrets) is moved aside; config / license stay.
 *   fresh / ready         → nothing.
 * Returns { state, movedTo } (movedTo = new path of the set-aside item, or null).
 */
function prepareDataDir(dataDir, log = () => {}) {
  const d = detect(dataDir);
  let movedTo = null;
  if (d.state === 'legacy_v18') {
    movedTo = moveAside(dataDir, 'v18-backup');
    fs.mkdirSync(dataDir, { recursive: true });
    log(`[Bootstrap] pre-2.0 data dir (${d.reason}) moved aside → ${movedTo} (never deleted)`);
  } else if (d.state === 'interrupted_first_run') {
    const pgdata = path.join(dataDir, 'pgdata');
    if (fs.existsSync(pgdata)) movedTo = moveAside(pgdata, 'interrupted');
    for (const f of [MARKER_FILE, 'secrets.json', 'secrets.enc']) { // secrets belong to the cluster we just set aside
      const p = path.join(dataDir, f);
      if (fs.existsSync(p)) moveAside(p, 'interrupted');
    }
    log(`[Bootstrap] interrupted first run (${d.reason}) — partial cluster set aside${movedTo ? ' → ' + movedTo : ''}`);
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
function rolesSql({ dbPassword }) {
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
ALTER ROLE authenticator PASSWORD ${lit(dbPassword)};
ALTER ROLE supabase_auth_admin PASSWORD ${lit(dbPassword)};
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

// ─── verification arithmetic ────────────────────────────────────────────────
const stripPublic = (s) => String(s).replace(/\bpublic\./g, '');

/**
 * Compare the installed functions to the inventory the baseline ships.
 * `rows` = [{ sig: 'schema.name(identity args)', md5 }] for the four app schemas.
 * Only the four secret-bearing functions may differ in body; none may be missing or extra.
 */
function compareFunctionInventory(inventoryMd5, rows, patched = {}) {
  const want = new Map();
  for (const [k, v] of Object.entries(inventoryMd5 || {})) {
    if (k.startsWith('auth.') || k.startsWith('storage.')) continue;
    want.set(stripPublic(k), v);
  }
  const have = new Map(rows.map((r) => [stripPublic(r.sig), r.md5]));
  const redacted = new Set(REDACTED_FUNCTIONS.map(stripPublic));
  const local = new Set(LOCAL_EXTRAS.functions.map(stripPublic));
  // a function the installer patched on purpose (function-patches.js): accepted ONLY with exactly the md5 recorded when the patch was applied
  const patchedMd5 = new Map(Object.entries(patched || {}).map(([k, v]) => [stripPublic(k), v]));
  const missing = [];
  const extra = [];
  const mismatched = [];
  for (const [k, v] of want) {
    if (!have.has(k)) missing.push(k);
    else if (have.get(k) !== v && !redacted.has(k) && patchedMd5.get(k) !== have.get(k)) mismatched.push(k);
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

module.exports = {
  MARKER_FILE, EXPECTED_PG_MAJOR, REDACTED_FUNCTIONS, LOCAL_EXTRAS,
  readMarker, writeMarker, markerPath,
  pgMajorOf, detect, moveAside, prepareDataDir,
  loadPin, verifyBaselineFiles, sha256File,
  rolesSql, postBaselineSql,
  parsePsqlErrors, classifyBaselineErrors,
  compareFunctionInventory, compareTotals, stripPublic,
};
