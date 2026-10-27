#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// migrations-check — the 2.0.2 INCREMENTAL migrations (production's migrations after the baseline cut, minus the production-only data one; pinned in baseline/MIGRATIONS_PIN.json,
// packed in the ENCRYPTED container baseline/migrations.bin), proved on a real app in the lab
// (isolated userData, ports 47391+, never the owner's data, nothing from production — the production post-image is a local md5 list).
//
//   node scripts/e2e/migrations-check.js --workdir <empty dir> [--app "<TexaCore ERP.app>"] [--old-app "<published 2.0.1 .app>"] [--prod-fp <fp_post_*.txt>] [--write-inventory <file>]
//     --app          the PACKAGED build under test (default: this checkout under Electron)
//     --old-app      the previously published build: provisions an install, then the new build starts on the SAME data (the upgrade path)
//     --prod-fp      production's md5 list after the last migration (lines F|signature|md5(prosrc)|secdef|acl, G|…, P|…, T|…); read, never fetched
//     --write-inventory  write the measured catalog delta + function md5s of the migrations (what manifest.inventoryAfter holds; install it with scripts/sync-migrations.js --inventory)
//
//   M1  the manifest: the generated ./migrations is exactly the pin, for the pinned baseline; the PACKAGED container (opened with the packaged key) holds the same manifest and the same bytes, and
//       the package carries no plaintext migration (no resources/migrations, no .sql file); the old build's baseline sha256 equals the new one's
//   A1  FRESH install: the baseline is provisioned, then all of them apply — public._texacore_migrations lists them in manifest order; logs/migrations.log says so
//   A2  local specifics: no pg_cron (the sweep job is skipped by the migration's own guard), fn_cloud_policy_on() is false (the cloud read-only triggers are inert), the cloud trial
//       policy (production-only data, not shipped) wrote nothing, the free plan carries fabric, no tenant / user / company appeared
//   A3  the material card: two new cards with an EMPTY code get M-000001 / M-000002 (REST, as the admin, the way the ERP's #840 sends them), a typed code is kept, a nameless card is refused
//   A5  holds: no pg_cron and no declared scheduler -> reservations cannot be switched on (reservation_sweep_missing); declared -> they can
//   A4  the units of a purchase receipt: a box line converts to base units (fn_line_unit_factor) and the cost per base unit is exact (fn_movement_base_unit_cost)
//   B1  UPGRADE: the old build provisions an install (company + one material card with a typed code), no migration table
//   B2  the new build starts on that data: they all apply, the company / users / the card are intact, the baseline marker is the manifest's
//   B3  a second start applies 0: the table, its ids and its timestamps are unchanged
//   B4  the upgraded install and the fresh install have the SAME functions, triggers, policies and table grants (the upgrade path = the fresh path)
//   A6  20270210v (one tracking mode per material): fabric -> roll, a serial flag -> serial, a plain card -> quantity; a mode change on a card with stock is refused (tracking_mode_locked); a load that switches the triggers
//       OFF leaves the default 'quantity' and the server's own repair `UPDATE fabric_materials SET tracking_mode = NULL WHERE material_type = 'fabric'` (as the app does) works and makes them roll
//   B5  RESTORE of a .tcdb written by the previous build (no tracking_mode column) into the upgraded install: the cards come back 'quantity' and the restore path repairs them by itself (fabric -> roll)
//   D   fingerprints: for every function the shipped migrations created or replaced, md5(prosrc) (and owner-side grants / SECURITY DEFINER) on this database equals production's post-image
//   C1-C4 (with --old-mig-app, the previous build that already carries the first N migrations): C1 it provisions an install and applies its N itself; C2 the new build starts on that data and applies ONLY the rest
//       (the first N rows keep their ids and timestamps, the data is intact, the company's admin still works); C3 a second start applies 0; C4 that upgraded install == the fresh install (functions, triggers, policies, grants)
//   E   (with --old-mig-app and --prod-steps) STEP BY STEP: on a 2.0.2-shaped install the files that came after its set are applied ONE AT A TIME (the way production received them) and after each one
//       every function / trigger / policy / table line the step changed is compared with production's own md5 list taken right after that step
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { PORTS, Results, portFree, request, startApp, stopApp, setPgPassword, pgOptions } = require('./lib');
const MM = require('../lib/migrations-manifest');
const { checkManifest } = MM;
const { catalogParity, materialCapabilityGrants } = require('./catalog-parity');
const { readPackedMigrations } = require('../lib/verify-packed');

function arg(name, def = '') { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const WORK = path.resolve(arg('workdir', ''));
const APP = arg('app', '') ? path.resolve(arg('app')) : '';
const OLD_APP = arg('old-app', '') ? path.resolve(arg('old-app')) : '';
// a previous build that ALREADY carries the first N migrations (2.0.2 carries 13 of the 16): the upgrade path 13 -> 16 (C1-C4) and the step-by-step proof against production's per-step images (E)
const OLD_MIG_APP = arg('old-mig-app', '') ? path.resolve(arg('old-mig-app')) : '';
// production's md5 lists after each of the migrations that came AFTER the old build's set, as `name=file` pairs separated by commas, in apply order (E)
const PROD_STEPS = arg('prod-steps', '');
const PROD_FP = arg('prod-fp', '') ? path.resolve(arg('prod-fp')) : '';
const WRITE_INV = arg('write-inventory', '');
if (!arg('workdir')) { console.error('--workdir <dir> is required'); process.exit(2); }
const ROOT = path.join(__dirname, '..', '..');
const ADMIN = `http://127.0.0.1:${PORTS.admin}`;
const API = `http://127.0.0.1:${PORTS.api}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const http = require('http');
const crypto = require('crypto');
const UI = `http://127.0.0.1:${PORTS.ui}`;
const rawRequest = (method, url, { headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const u = new URL(url);
  const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, agent: false, headers: { ...headers, ...(body ? { 'Content-Length': body.length } : {}) } }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c));
    res.on('end', () => { const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* binary */ } resolve({ status: res.statusCode, buf, json }); });
  });
  req.on('error', reject); if (body) req.write(body); req.end();
});
const multipart = (file, filename, fields0 = {}) => {
  const fields = { confirmReplaceAll: 'true', ...fields0 };   // 2.0.5: replacing every company needs an explicit yes
  const b = '----mig' + crypto.randomBytes(6).toString('hex');
  const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`));
  return { ct: `multipart/form-data; boundary=${b}`, body: Buffer.concat(parts) };
};
// production's post-image of the functions of 20270210v (coordinator, from production after the apply of 2026-10-15)
const V_MD5 = {
  'fn_guard_material_card()': '2fe6c0a6da6a31ca45e5c810ad8038cc',   // 20270210v's body ff6c7cfc… was replaced by 20270240l (production's post-image, 27-10)
   'fn_material_tracking_sync()': 'db9d6ce5a94060f3d226916ec28b4969', 'fn_material_base_unit_guard()': 'f8e16d1cd348b37965396d14aa240fe0',
  'fn_material_mode_derive(text,boolean,boolean,boolean)': '521081d97f20ee86078bc13b9cd3b78f', 'fn_material_stock_lock_reasons(uuid,boolean,boolean)': 'af15bdf8b84ddda0040b21de0eda3a59',
  'fn_material_tracking_mode(uuid)': 'e8ad0124e16ef96dbd5f00ae7ed1be7b',
};

const binOf = (app) => (app ? path.join(app, 'Contents', 'MacOS', path.basename(app, '.app')) : '');
const resOf = (app) => (app ? path.join(app, 'Contents', 'Resources') : ROOT);
// the generated build output (scripts/sync-migrations.js); the packaged app carries the same files ONLY inside the encrypted container
const GEN = path.join(ROOT, 'migrations');
const packedOf = (app) => readPackedMigrations({ resourcesDir: resOf(app), appCodeDir: path.join(resOf(app), 'app') });
const pinShaOf = (app) => JSON.parse(fs.readFileSync(path.join(app ? path.join(resOf(app), 'baseline') : path.join(ROOT, 'baseline'), 'BASELINE_PIN.json'), 'utf8')).files['production_baseline.sql'].sha256;

// the fingerprint production's md5 lists were taken with (scratchpad/fp8_ro.sql, read-only there; run here on the lab database)
const FP_SQL = [
  `SELECT 'F|' || p.oid::regprocedure::text || '|' || md5(p.prosrc) || '|' || p.prosecdef::text || '|' || COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(p.proacl) a), '') AS l FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace`,
  `SELECT 'G|' || c.relname || '.' || t.tgname || '|' || t.tgenabled::text || '|' || md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal`,
  `SELECT 'P|' || tablename || '.' || policyname || '|' || permissive || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || md5(COALESCE(qual, '')) || '|' || md5(COALESCE(with_check, '')) FROM pg_policies WHERE schemaname = 'public'`,
  `SELECT 'T|' || c.relname || '|' || c.relkind::text || '|' || COALESCE((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(c.relacl) a), '') || '|rls=' || c.relrowsecurity::text FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','v','m','p','f')`,
];
const CATALOG_SQL = `
  SELECT
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname = ANY($1) AND c.relkind IN ('r','p'))::int AS tables,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname = ANY($1) AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e'))::int AS functions,
    (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname = ANY($1) AND NOT t.tgisinternal)::int AS triggers,
    (SELECT count(*) FROM pg_policy pl JOIN pg_class c ON c.oid=pl.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname = ANY($1))::int AS policies,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname = ANY($1) AND c.relkind IN ('i','I'))::int AS indexes,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname = ANY($1) AND c.relkind IN ('v','m'))::int AS views,
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname = ANY($1) AND c.relkind IN ('r','p') AND c.relrowsecurity)::int AS "rlsTables"`;
const SCHEMAS = ['public', 'licensing', 'newpost', 'tomgenerators'];

const INV_FN_SQL = `SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS sig, md5(p.prosrc) AS md5
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname = ANY($1) AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')`;
async function pg(sql, params = []) {
  const c = new Client(pgOptions());
  await c.connect();
  try { return await c.query(sql, params); } finally { await c.end(); }
}
const catalog = async () => (await pg(CATALOG_SQL, [SCHEMAS])).rows[0];
const invFns = async () => new Map((await pg(INV_FN_SQL, [SCHEMAS])).rows.map((r) => [r.sig, r.md5]));
async function fingerprint() {
  const lines = [];
  for (const q of FP_SQL) for (const r of (await pg(q)).rows) lines.push(r.l || Object.values(r)[0]);
  return lines.sort();
}
const fnMap = (lines) => new Map(lines.filter((l) => l.startsWith('F|')).map((l) => { const [, sig, md5, secdef, acl] = l.split('|'); return [sig, { md5, secdef, acl: acl || '', line: l }]; }));

const { spawn } = require('child_process');
const psqlOf = (app) => path.join(resOf(app), 'bin', 'pg', 'bin', 'psql');
/** One file the way the runner applies it: psql over stdin, ON_ERROR_STOP=1 (the file's own BEGIN … COMMIT is one transaction). Resolves { code, err } — never logs the SQL. */
function applyFile(app, secrets, buf) {
  return new Promise((resolve, reject) => {
    const p = spawn(psqlOf(app), ['-X', '-w', '-p', String(PORTS.pg), '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-f', '-'], { env: { ...process.env, PGPASSWORD: secrets.dbPassword } });
    let err = '';
    p.stdout.on('data', () => {}); p.stderr.on('data', (d) => { err += d.toString(); });
    p.stdin.on('error', () => {}); p.on('error', reject);
    p.on('close', (code) => resolve({ code, err: err.split('\n').filter((l) => /ERROR|FATAL/.test(l)).slice(0, 3).join(' | ') }));
    p.stdin.end(buf);
  });
}
/** Every line of `lines` (a fingerprint) that is not byte-identical in `prevSet` = what a step changed (new or different). */
const changedLines = (lines, prevSet) => lines.filter((l) => !prevSet.has(l));
/** Compare the F-lines a step touched with production's list taken right after it: md5(prosrc), SECURITY DEFINER flag and grants. */
function compareFns(touchedSigs, local, prod) {
  const bad = []; let same = 0;
  for (const s of touchedSigs) {
    const p = prod.get(s); const l = local.get(s);
    if (!p) { bad.push(`${s}: not in production's image`); continue; }
    if (!l) { bad.push(`${s}: missing here`); continue; }
    if (p.md5 !== l.md5) bad.push(`${s}: md5 ${l.md5.slice(0, 8)} here, ${p.md5.slice(0, 8)} in production`);
    else if (p.secdef !== l.secdef || p.acl !== l.acl) bad.push(`${s}: same body, but secdef/grants differ (here ${l.secdef} ${l.acl.slice(0, 60)} / production ${p.secdef} ${p.acl.slice(0, 60)})`);
    else same++;
  }
  return { bad, same };
}

/** Start an app on `userData` and wait until it is ready; returns { child, secrets, logFile }. */
async function boot(userData, app, tag) {
  const logFile = path.join(WORK, `app-${tag}.log`);
  const { child, ready } = startApp({ userData, license: 'free', logFile, appBinary: binOf(app), extraEnv: { TEXACORE_UI_SMOKE: '1' } });
  await ready;
  const secrets = JSON.parse(fs.readFileSync(path.join(userData, 'texacore-data', 'secrets.json'), 'utf8'));
  setPgPassword(secrets.dbPassword);
  return { child, secrets, logFile, userData };
}
async function createCompany(secrets, tag) {
  const r = await request('POST', `${ADMIN}/api/create-local-company`, { headers: { 'x-texacore-local-secret': secrets.localApiSecret },
    body: { companyName: `Mig ${tag}`, adminEmail: `owner-${tag}@mig.test`, adminPassword: 'MigPass#2026', localCurrency: 'UAH', mainCurrency: 'USD', country: 'UA', storagePath: path.join(WORK, `tcdb-${tag}`), dbFileName: `mig-${tag}` } });
  if (!r.json || !r.json.success) throw new Error(`create-local-company → ${r.text.slice(0, 300)}`);
  return r.json;
}
const appliedRows = async () => (await pg('SELECT id, name, applied_at, checksum FROM public._texacore_migrations ORDER BY id')).rows;
/** The ERP's global roles reach an install built BEFORE the reference data existed (loaded once BEFORE the migrations, like a fresh build; idempotent): every shipped role code exactly once (the installer's own
 *  four are not duplicated), the capability map, and the marker records the packaged file's sha256. Run on an UPGRADED install whose app is running. */
async function rolesAfterUpgrade(userData) {
  const ref = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'BASELINE_PIN.json'), 'utf8')).files['reference_data.sql'];
  if (!ref) return 'this build carries no reference data (skipped)';
  const marker = JSON.parse(fs.readFileSync(path.join(userData, 'texacore-data', 'bootstrap.json'), 'utf8'));
  if (marker.referenceDataSha256 !== ref.sha256) throw new Error(`the marker's reference-data sha256 (${marker.referenceDataSha256}) is not the packaged file's (${ref.sha256})`);
  const g = (await pg(`SELECT count(*)::int n, count(DISTINCT code)::int d FROM public.roles WHERE tenant_id IS NULL`)).rows[0];
  if (g.n < 27 || g.n !== g.d) throw new Error(`global roles ${g.n}, distinct codes ${g.d} (expected >= 27 and no duplicate)`);
  const four = (await pg(`SELECT code, count(*)::int n FROM public.roles WHERE tenant_id IS NULL AND code IN ('tenant_owner','tenant_admin','company_owner','platform_admin') GROUP BY code ORDER BY code`)).rows;
  if (four.length !== 4 || four.some((x) => x.n !== 1)) throw new Error(`the installer's own global roles: ${JSON.stringify(four)}`);
  const caps = (await pg(`SELECT count(*)::int n FROM public.role_capabilities WHERE tenant_id IS NULL`)).rows[0].n;
  if (caps < 852) throw new Error(`global role capabilities ${caps} (expected >= 852)`);
  const acc = (await pg(`SELECT count(*)::int n FROM public.role_capabilities WHERE tenant_id IS NULL AND role_code = 'accountant'`)).rows[0].n;
  if (!acc) throw new Error('the accountant role has no capabilities');
  // the upgraded install must hold EXACTLY the fresh install's global grants (migration-derived ones included: 20270226a mirrors inventory.delivery.issue to the draft capability for every role that holds it)
  if (freshRoleCaps) {
    const now = (await pg(`SELECT capability || '|' || role_code AS k FROM public.role_capabilities WHERE tenant_id IS NULL ORDER BY 1`)).rows.map((r) => r.k);
    const a = new Set(now); const f = new Set(freshRoleCaps);
    const d = [...now.filter((k) => !f.has(k)).map((k) => `only upgraded: ${k}`), ...freshRoleCaps.filter((k) => !a.has(k)).map((k) => `only fresh: ${k}`)];
    if (d.length) throw new Error(`global role capabilities differ from the fresh install's (${d.length}): ${d.slice(0, 6).join(' | ')}`);
  }
  // G3: the global catalogs of production (print entity types / templates, countries, modules, statuses ...) are on the upgraded install too - the reference-data file changed, so the marker's sha256 made the install load it
  const mg = await materialCapabilityGrants(pg);
  if (mg.length) throw new Error(`material capability grants differ from production's: ${mg.join(' | ')}`);
  const par = await catalogParity(pg);
  if (par.differences.length) throw new Error(`global catalogs differ from production's (${par.differences.length}/${par.tables}): ${par.differences.slice(0, 4).join(' | ')}`);
  return `${g.n} global roles (no code twice, the four seed roles once each), ${caps} capability rows${freshRoleCaps ? ' = the fresh install\'s set' : ''}, accountant holds ${acc}; marker sha256 = the packaged file's; ${par.tables} global catalogs = production's counts (print_entity_types ${par.counts.print_entity_types}, print_templates ${par.counts.print_templates})`;
}
let freshRoleCaps = null;   // the fresh install's global role capabilities (capability|role_code), filled by A1
const mlog = (userData) => { try { return fs.readFileSync(path.join(userData, 'texacore-data', 'logs', 'migrations.log'), 'utf8'); } catch { return ''; } };

(async () => {
  const R = new Results();
  for (const p of Object.values(PORTS)) if (!(await portFree(p))) { console.error(`port ${p} is in use`); process.exit(2); }
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(GEN, 'migrations.json'), 'utf8'));
  const NAMES = manifest.migrations.map((m) => m.name);
  const ev = {};
  let fresh = null; let freshFp = null;

  await R.check('M1 the generated migrations are exactly the pin for the pinned baseline; the PACKAGED container holds the same manifest and bytes and the package has no plaintext migration; the previous build was cut from the SAME baseline', async () => {
    const sha = pinShaOf(APP);
    const mc = checkManifest(GEN, sha);
    if (mc.problems.length) throw new Error(mc.problems.join('; '));
    const pin = MM.loadMigrationsPin(path.join(ROOT, 'baseline'));
    const pp = [...MM.checkPin(pin, sha), ...MM.checkAgainstPin(mc.manifest, pin)];
    if (pp.length) throw new Error(pp.join('; '));
    if (manifest.baselineSha256 !== sha) throw new Error('manifest baselineSha256 differs from the pin');
    let where = 'repo build output only (dev mode)';
    if (APP) {
      const pk = packedOf(APP);
      if (pk.problems.length) throw new Error(pk.problems.join('; '));
      if (JSON.stringify(pk.manifest) !== JSON.stringify(manifest)) throw new Error('the container\'s manifest differs from the generated migrations.json');
      for (const m of manifest.migrations) if (!pk.files.has(m.file) || !pk.files.get(m.file).equals(fs.readFileSync(path.join(GEN, m.file)))) throw new Error(`${m.file}: the container's bytes differ from the generated file`);
      if (pk.files.size !== manifest.migrations.length + 1) throw new Error(`the container holds ${pk.files.size} entries, expected ${manifest.migrations.length + 1}`);
      const res = resOf(APP);
      if (fs.existsSync(path.join(res, 'migrations'))) throw new Error('a plaintext resources/migrations folder is in the package');
      const sqlFiles = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isSymbolicLink()) continue; if (e.isDirectory()) { if (!(f + path.sep).startsWith(path.join(res, 'bin', 'pg') + path.sep)) walk(f); } else if (/\.sql$/i.test(e.name)) sqlFiles.push(path.relative(res, f)); } };
      walk(res);
      if (sqlFiles.length) throw new Error(`plain .sql files in the package: ${sqlFiles.slice(0, 3).join(', ')}`);
      where = `packaged container migrations.bin opened with the packaged key (${pk.files.size} entries = manifest + ${manifest.migrations.length} files, bytes identical), no .sql file and no migrations folder in the package`;
    }
    let old = 'n/a';
    if (OLD_APP) { old = pinShaOf(OLD_APP); if (old !== sha) throw new Error(`the old build's baseline sha256 (${old.slice(0, 12)}…) differs from this build's (${sha.slice(0, 12)}…) — an upgrade from it would NOT apply the manifest`); }
    return `${NAMES.length} migrations = the pin, baseline ${sha.slice(0, 12)}…; ${where} (old build: ${old === 'n/a' ? old : old.slice(0, 12) + '… = same'})`;
  });

  // ═════════ A: a FRESH install of the build under test ═════════
  const A = path.join(WORK, 'fresh');
  let a = null; let acc = null; let cardIds = [];
  try {
    a = await boot(A, APP, 'fresh');
    await R.check('A1 FRESH install: baseline provisioned, then all migrations applied in manifest order (public._texacore_migrations); logs/migrations.log lists them; nothing failed', async () => {
      const rows = await appliedRows();
      const got = rows.map((r) => r.name);
      if (JSON.stringify(got) !== JSON.stringify(NAMES)) throw new Error(`applied ${got.length}: ${got.join(', ')}\nexpected ${NAMES.length}: ${NAMES.join(', ')}`);
      if (rows.some((r) => /__FAILED/.test(r.name))) throw new Error('a __FAILED marker');
      const log = mlog(A);
      const ok = (log.match(/✅ \(\d+\/\d+\)/g) || []).length;
      if (ok !== NAMES.length || /❌|🛑/.test(log)) throw new Error(`migrations.log: ${ok} ok lines, errors? ${/❌|🛑/.test(log)}\n${log.slice(-600)}`);
      const lg = fs.readFileSync(a.logFile, 'utf8');
      if (/❌ \(\d+\/\d+\)/.test(lg)) throw new Error('the app log shows a failed migration');
      ev.fresh = { ms: rows.map((r) => `${r.name.slice(8, 9)}`).join(',') };
      // the reference data (the ERP's global roles + capability map) was loaded BEFORE the migrations, so 20270226a mirrored inventory.delivery.issue to the draft capability for the roles that hold it
      freshRoleCaps = (await pg(`SELECT capability || '|' || role_code AS k FROM public.role_capabilities WHERE tenant_id IS NULL ORDER BY 1`)).rows.map((r) => r.k);
      const refRoles = (await pg(`SELECT count(*)::int n, count(DISTINCT code)::int d FROM public.roles WHERE tenant_id IS NULL`)).rows[0];
      if (refRoles.n < 27 || refRoles.n !== refRoles.d) throw new Error(`fresh install: global roles ${refRoles.n}, distinct ${refRoles.d} (expected >= 27, no duplicate)`);
      if (!freshRoleCaps.includes('inventory.delivery.draft.save|warehouse_keeper')) throw new Error('fresh install: the warehouse_keeper role has no inventory.delivery.draft.save (20270226a found no roles to mirror)');
      const mgFresh = await materialCapabilityGrants(pg);
      if (mgFresh.length) throw new Error(`fresh install: material capability grants differ from production's: ${mgFresh.join(' | ')}`);
      const parFresh = await catalogParity(pg);
      if (parFresh.differences.length) throw new Error(`fresh install: global catalogs differ from production's (${parFresh.differences.length}/${parFresh.tables}): ${parFresh.differences.slice(0, 5).join(' | ')}`);
      return `${got.length} applied (${refRoles.n} global roles, ${freshRoleCaps.length} global capability rows, ${parFresh.tables} global catalogs = production's counts): ${NAMES.map((n) => n.replace(/^20270210/, '').split('_')[0]).join(' ')}; migrations.log: ${ok} ✅ lines`;
    });

    await R.check('A2 local specifics: no pg_cron (the migration\'s own guard skipped the sweep job), the cloud read-only policy is OFF, the cloud trial policy (production-only data, not shipped) wrote nothing, no company / tenant / user appeared, the free plan carries fabric', async () => {
      const q = (await pg(`SELECT
          to_regclass('cron.job') IS NOT NULL AS cron_job, to_regprocedure('cron.schedule(text,text,text)') IS NOT NULL AS cron_fn,
          (SELECT count(*)::int FROM pg_available_extensions WHERE name = 'pg_cron') AS cron_ext,
          public.fn_cloud_policy_on() AS policy_on,
          (SELECT count(*)::int FROM public.tenants) AS tenants, (SELECT count(*)::int FROM public.companies) AS companies, (SELECT count(*)::int FROM auth.users) AS users,
          (SELECT count(*)::int FROM public.saas_events WHERE event_type IN ('cloud_free_to_trial','cloud_trial_allow_other_free')) AS trial_events,
          (SELECT 'fabric' = ANY(included_modules) FROM public.subscription_plans WHERE code = 'free') AS free_has_fabric`)).rows[0];
      if (q.cron_job || q.cron_fn || q.cron_ext) throw new Error(`pg_cron is present here: ${JSON.stringify(q)}`);
      if (q.policy_on !== false) throw new Error(`fn_cloud_policy_on() = ${q.policy_on} (the BEFORE triggers of 20270210k must be inert locally)`);
      if (q.trial_events) throw new Error('the cloud trial policy wrote saas_events locally');
      if (q.tenants || q.companies || q.users) throw new Error(`rows appeared in a fresh install: ${JSON.stringify(q)}`);
      if (q.free_has_fabric !== true) throw new Error('the free plan does not carry fabric');
      const guard = (await pg(`SELECT count(*)::int n FROM pg_trigger WHERE tgname = 'trg_zz_stock_holds_enable_guard' AND NOT tgisinternal`)).rows[0].n;
      return `pg_cron: none (available extensions: 0); fn_cloud_policy_on() = false; trial events 0; tenants/companies/users 0/0/0; free plan has fabric; stock-hold enable guard trigger present: ${guard}`;
    });

    acc = await createCompany(a.secrets, 'a');
    const authA = { apikey: a.secrets.anonKey, Authorization: `Bearer ${acc.accessToken}`, Prefer: 'return=representation' };
    await R.check('A3 the material card (readiness bug 1.1-F6): two cards with an EMPTY code get M-000001 / M-000002 over REST as the admin; a typed code is kept; a nameless card is refused (23514)', async () => {
      const post = (row) => request('POST', `${API}/rest/v1/fabric_materials`, { headers: authA, body: { tenant_id: acc.tenantId, company_id: acc.companyId, ...row } });
      const r1 = await post({ code: null, name_ar: 'قماش تجريبي 1' });
      const r2 = await post({ code: '', name_ar: 'قماش تجريبي 2' });
      if (r1.status !== 201 || r2.status !== 201) throw new Error(`insert → ${r1.status} ${r1.text.slice(0, 200)} / ${r2.status} ${r2.text.slice(0, 200)}`);
      const c1 = r1.json[0].code; const c2 = r2.json[0].code;
      if (c1 !== 'M-000001' || c2 !== 'M-000002') throw new Error(`codes ${c1} / ${c2}`);
      cardIds = [r1.json[0].id, r2.json[0].id];
      const r3 = await post({ code: 'TYPED-7', name_ar: 'قماش 3' });
      if (r3.status !== 201 || r3.json[0].code !== 'TYPED-7') throw new Error(`a typed code was changed: ${r3.status} ${r3.text.slice(0, 160)}`);
      const r4 = await post({ code: null, name_ar: '', name_en: '' });
      if (r4.status === 201 || !/23514|material_name_required/.test(r4.text)) throw new Error(`a nameless card → ${r4.status} ${r4.text.slice(0, 200)}`);
      const r5 = await post({ code: null, name_ar: 'قماش تجريبي 5' });
      if (r5.json[0].code !== 'M-000003') throw new Error(`the next code is ${r5.json[0].code}`);
      cardIds.push(r3.json[0].id);
      return `${c1}, ${c2}, typed kept (TYPED-7), then ${r5.json[0].code}; nameless card refused (${r4.status})`;
    });

    await R.check('A4 purchase-receipt units (readiness 3.9-F13): 2 boxes of 12 = 24 pieces — fn_line_unit_factor(BOX) = 12 from the card\'s conversion row; the cost per base unit is 100 / 12 = 8.3333, not 8.33', async () => {
      // a fresh install has no units: the company's own two (a piece and a box), as the ERP's unit screen would create them
      const units = (await pg(`INSERT INTO public.units_of_measure (tenant_id, code, name_ar) VALUES ($1, 'T-PC', 'قطعة'), ($1, 'T-BOX', 'علبة') RETURNING id, code`, [acc.tenantId])).rows;
      const pc = units.find((u) => u.code === 'T-PC'); const box = units.find((u) => u.code === 'T-BOX');
      const card = (await pg(`UPDATE public.fabric_materials SET base_unit_id = $1 WHERE id = $2 RETURNING id`, [pc.id, cardIds[0]])).rows[0].id;
      await pg(`INSERT INTO public.material_unit_conversions (tenant_id, company_id, material_id, from_unit_id, to_unit_id, conversion_factor) VALUES ($1,$2,$3,$4,$5,12)`, [acc.tenantId, acc.companyId, card, box.id, pc.id]);
      const f = (await pg(`SELECT public.fn_line_unit_factor($1, $2) AS f, public.fn_line_unit_factor($1, $3) AS base`, [card, box.id, pc.id])).rows[0];
      if (Number(f.f) !== 12 || Number(f.base) !== 1) throw new Error(`factor BOX ${f.f}, PC ${f.base}`);
      const unit = (await pg(`SELECT public.fn_movement_base_unit_cost(24, 24, 8.33, 200.00) AS c, public.fn_movement_base_unit_cost(1000, 1000, 0.00, 4.00) AS tiny`)).rows[0];
      if (Number(unit.c) !== 8.3333 || Number(unit.tiny) !== 0.004) throw new Error(`cost per base unit ${unit.c} / ${unit.tiny}`);
      return `${box.code}→${pc.code} x12: factor ${f.f}; 24 pcs for 200.00 → ${unit.c}/pc (was 8.33); 1000 pcs for 4.00 → ${unit.tiny}/pc (was 0.00)`;
    });
    await R.check('A5 holds (20270210o): with no pg_cron and no declared scheduler a company cannot switch reservations ON (reservation_sweep_missing); once the operator declares an external scheduler it can', async () => {
      let refused = null;
      try { await pg(`INSERT INTO public.warehouse_settings (tenant_id, company_id, reservations_enabled) VALUES ($1, $2, true)`, [acc.tenantId, acc.companyId]); }
      catch (e) { refused = e; }
      if (!refused || !/reservation_sweep_missing/.test(refused.message)) throw new Error(`switching reservations on was not refused: ${refused ? refused.message : 'accepted'}`);
      await pg(`ALTER DATABASE postgres SET app.stock_holds_sweep_external = 'on'`);
      try {
        await pg(`INSERT INTO public.warehouse_settings (tenant_id, company_id, reservations_enabled) VALUES ($1, $2, true)`, [acc.tenantId, acc.companyId]);
        const on = (await pg(`SELECT reservations_enabled FROM public.warehouse_settings WHERE company_id = $1`, [acc.companyId])).rows[0];
        if (on.reservations_enabled !== true) throw new Error('reservations did not switch on with a declared scheduler');
      } finally { await pg(`ALTER DATABASE postgres RESET app.stock_holds_sweep_external`); await pg(`DELETE FROM public.warehouse_settings WHERE company_id = $1`, [acc.companyId]); }
      return 'refused: reservation_sweep_missing; accepted after ALTER DATABASE … SET app.stock_holds_sweep_external = \'on\' (reset again)';
    });
    await R.check('A6 20270210v: one tracking mode per material — fabric -> roll, a serial flag -> serial, a plain card -> quantity; a mode change on a card with stock is refused (tracking_mode_locked); a trigger-OFF load leaves the default "quantity" and the server\'s repair `UPDATE fabric_materials SET tracking_mode = NULL WHERE material_type = \'fabric\'` works and makes the cards roll', async () => {
      const mode = async (id) => (await pg('SELECT tracking_mode FROM public.fabric_materials WHERE id = $1', [id])).rows[0].tracking_mode;
      if ((await mode(cardIds[0])) !== 'roll') throw new Error(`a fabric card (default type) is ${await mode(cardIds[0])}`);
      const mk = async (code, extra = {}) => { const r = await request('POST', `${API}/rest/v1/fabric_materials`, { headers: authA, body: { tenant_id: acc.tenantId, company_id: acc.companyId, code, name_ar: `بطاقة ${code}`, ...extra } }); if (r.status !== 201) throw new Error(`insert ${code} → ${r.status} ${r.text.slice(0, 200)}`); return r.json[0].id; };
      const std = await mk('TM-STD', { material_type: 'standard' }); const ser = await mk('TM-SER', { material_type: 'standard', track_serial: true });
      if ((await mode(std)) !== 'quantity' || (await mode(ser)) !== 'serial') throw new Error(`standard ${await mode(std)}, serial-flag ${await mode(ser)}`);
      // stock on the plain card -> its mode is locked
      const wh = (await pg('SELECT id FROM public.warehouses WHERE tenant_id = $1 ORDER BY created_at LIMIT 1', [acc.tenantId])).rows[0].id;     // the company's own (the free plan allows one)
      await pg(`INSERT INTO public.inventory_stock (tenant_id, company_id, material_id, warehouse_id, quantity_on_hand) VALUES ($1, $2, $3, $4, 10)`, [acc.tenantId, acc.companyId, std, wh]);
      let locked = null; try { await pg(`UPDATE public.fabric_materials SET tracking_mode = 'batch' WHERE id = $1`, [std]); } catch (e) { locked = e; }
      if (!locked || !/tracking_mode_locked/.test(`${locked.message} ${locked.hint || ''}`)) throw new Error(`a card with stock changed its mode: ${locked ? locked.message : 'accepted'}`);
      let conflict = null; try { await pg(`UPDATE public.fabric_materials SET tracking_mode = 'quantity' WHERE id = $1`, [cardIds[0]]); } catch (e) { conflict = e; }
      if (!conflict) throw new Error('a fabric card accepted the mode quantity');
      // a load with the user triggers OFF (a .tcdb restore / pg_restore --disable-triggers): the card keeps the net default, and the app's repair works — with stock on it
      const c = new Client(pgOptions()); await c.connect();
      let loadedId;
      try {
        await c.query('BEGIN'); await c.query(`SET LOCAL session_replication_role = 'replica'`);
        loadedId = (await c.query(`INSERT INTO public.fabric_materials (tenant_id, company_id, code, name_ar, material_type) VALUES ($1, $2, 'TM-LOADED', 'بطاقة محمّلة', 'fabric') RETURNING id`, [acc.tenantId, acc.companyId])).rows[0].id;
        await c.query(`INSERT INTO public.inventory_stock (tenant_id, company_id, material_id, warehouse_id, quantity_on_hand) VALUES ($1, $2, $3, $4, 25)`, [acc.tenantId, acc.companyId, loadedId, wh]);
        await c.query('COMMIT');
      } finally { await c.end(); }
      if ((await mode(loadedId)) !== 'quantity') throw new Error(`the trigger-off load did not leave the default (it is ${await mode(loadedId)})`);
      const up = await pg(`UPDATE public.fabric_materials SET tracking_mode = NULL WHERE material_type = 'fabric'`);
      if ((await mode(loadedId)) !== 'roll' || up.rowCount < 1) throw new Error(`the repair left ${await mode(loadedId)} (rows ${up.rowCount})`);
      const bad = (await pg(`SELECT count(*)::int n FROM public.fabric_materials WHERE material_type = 'fabric' AND tracking_mode <> 'roll'`)).rows[0].n;
      if (bad) throw new Error(`${bad} fabric cards are not roll after the repair`);
      return `fabric default -> roll; standard -> quantity; serial flag -> serial; stock on a card: mode change refused (tracking_mode_locked); fabric -> quantity refused; trigger-off load: quantity, then the app's UPDATE … SET tracking_mode = NULL (${up.rowCount} card(s), one with 25 in stock) -> roll`;
    });
    freshFp = await fingerprint();
  } finally { if (a) await stopApp(a.child, A); }

  // ═════════ B: an UPGRADE: the previous build's install, then this build on the same data ═════════
  let preFp = null; let postFp = null; let upg = null; let catPre = null; let catPost = null; let invPre = null; let invPost = null;
  if (OLD_APP) {
    const B = path.join(WORK, 'upgrade');
    let o = null; let oc = null; let cardOld = null; let counts0 = null; let legacy = null; let oldTcdb = null;
    try {
      o = await boot(B, OLD_APP, 'old');
      await R.check('B1 UPGRADE, step 1: the previous build provisions an install (no migration table), a company and one material card with a typed code', async () => {
        const t = (await pg(`SELECT to_regclass('public._texacore_migrations') IS NOT NULL AS has`)).rows[0].has;
        if (t) throw new Error('the previous build already has a migration table');
        oc = await createCompany(o.secrets, 'b');
        cardOld = (await pg(`INSERT INTO public.fabric_materials (tenant_id, company_id, code, name_ar) VALUES ($1,$2,'OLD-1','بطاقة قديمة') RETURNING id, code, created_at`, [oc.tenantId, oc.companyId])).rows[0];
        // legacy cards the way the previous build wrote them (no tracking_mode column yet): a fabric with stock, a plain card, a serial-flagged card
        const whOld = (await pg('SELECT id FROM public.warehouses WHERE tenant_id = $1 ORDER BY created_at LIMIT 1', [oc.tenantId])).rows[0].id;
        const mkOld = async (code, type, flags = {}) => (await pg(`INSERT INTO public.fabric_materials (tenant_id, company_id, code, name_ar, material_type, is_roll_tracked, track_serial, track_batch) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [oc.tenantId, oc.companyId, code, `قديمة ${code}`, type, !!flags.roll, !!flags.serial, !!flags.batch])).rows[0].id;
        const oldFab = await mkOld('OLD-FAB', 'fabric'); const oldStd = await mkOld('OLD-STD', 'standard'); const oldSer = await mkOld('OLD-SER', 'standard', { serial: true });
        await pg(`INSERT INTO public.inventory_stock (tenant_id, company_id, material_id, warehouse_id, quantity_on_hand) VALUES ($1,$2,$3,$4,30)`, [oc.tenantId, oc.companyId, oldFab, whOld]);
        legacy = { oldFab, oldStd, oldSer };
        // the company file of the PREVIOUS build (what a user of 2.0.1 holds): a forced sync AFTER the inserts (the first sync after the company was made may still be running), then a copy
        const companyFile = oc.tcdbPath || path.join(WORK, 'tcdb-b', 'mig-b.tcdb');       // 2.0.1 does not return the path: storagePath + dbFileName
        const tInsert = Date.now() - 1000;
        let synced = false;
        for (let i = 0; i < 90 && !synced; i++) {
          const bk = await request('POST', `${ADMIN}/api/backup`, { headers: { 'x-texacore-local-secret': o.secrets.localApiSecret }, body: {} });
          if (bk.json && bk.json.success && !bk.json.skipped && fs.existsSync(companyFile) && fs.statSync(companyFile).mtimeMs >= tInsert) synced = true; else await sleep(1000);
        }
        if (!synced) throw new Error(`the previous build did not write a company file after the inserts (${companyFile})`);
        oldTcdb = path.join(WORK, 'old-2.0.1.tcdb'); fs.copyFileSync(companyFile, oldTcdb);
        counts0 = (await pg(`SELECT (SELECT count(*)::int FROM public.companies) c, (SELECT count(*)::int FROM public.tenants) t, (SELECT count(*)::int FROM auth.users) u, (SELECT count(*)::int FROM public.chart_of_accounts) a, (SELECT count(*)::int FROM public.fabric_materials) m`)).rows[0];
        preFp = await fingerprint(); catPre = await catalog(); invPre = await invFns();
        const v = JSON.parse(fs.readFileSync(path.join(B, 'texacore-data', 'bootstrap.json'), 'utf8'));
        return `company ${oc.companyId.slice(0, 8)}…, card OLD-1, counts ${JSON.stringify(counts0)}; marker baseline ${String(v.baselineSha256).slice(0, 12)}…`;
      });
    } finally { if (o) await stopApp(o.child, B); }

    let n1 = null;
    try {
      upg = await boot(B, APP, 'new1');
      await R.check('B2 UPGRADE, step 2: the NEW build starts on that data — the migrations apply, the company / users / chart of accounts / the card are intact, the baseline marker equals the manifest\'s', async () => {
        const rows = await appliedRows();
        const got = rows.map((r) => r.name);
        if (JSON.stringify(got) !== JSON.stringify(NAMES)) throw new Error(`applied ${got.length}: ${got.join(', ')}`);
        const counts1 = (await pg(`SELECT (SELECT count(*)::int FROM public.companies) c, (SELECT count(*)::int FROM public.tenants) t, (SELECT count(*)::int FROM auth.users) u, (SELECT count(*)::int FROM public.chart_of_accounts) a, (SELECT count(*)::int FROM public.fabric_materials) m`)).rows[0];
        // 20270240k: every EXTENDED chart whose account 115 is a leaf gets it turned into a group with one general leaf under it (+1 account per such company: this install has one)
        const leafDelta = counts1.a - counts0.a;
        if (leafDelta !== 0 && leafDelta !== 1) throw new Error(`the chart of accounts changed by ${leafDelta} (only the 20270240k general leaf, +1, is expected)`);
        if (JSON.stringify({ ...counts1, a: counts0.a }) !== JSON.stringify(counts0)) throw new Error(`data changed: ${JSON.stringify(counts0)} -> ${JSON.stringify(counts1)}`);
        const card = (await pg(`SELECT id, code, created_at FROM public.fabric_materials WHERE id = $1`, [cardOld.id])).rows[0];
        if (!card || card.code !== 'OLD-1') throw new Error('the old card changed');
        const marker = JSON.parse(fs.readFileSync(path.join(B, 'texacore-data', 'bootstrap.json'), 'utf8'));
        if (marker.baselineSha256 !== manifest.baselineSha256) throw new Error('the marker\'s baseline differs from the manifest\'s');
        const log = mlog(B);
        const ok = (log.match(/✅ \(\d+\/\d+\)/g) || []).length;
        if (ok !== NAMES.length || /❌|🛑/.test(log)) throw new Error(`migrations.log: ${ok} ✅, errors ${/❌|🛑/.test(log)}`);
        // the company still works: log in as its admin through GoTrue and read it over REST
        const login = await request('POST', `${API}/auth/v1/token?grant_type=password`, { headers: { apikey: upg.secrets.anonKey }, body: { email: 'owner-b@mig.test', password: 'MigPass#2026' } });
        if (login.status !== 200) throw new Error(`the old admin cannot log in: ${login.status} ${login.text.slice(0, 160)}`);
        const rest = await request('GET', `${API}/rest/v1/fabric_materials?select=code&id=eq.${cardOld.id}`, { headers: { apikey: upg.secrets.anonKey, Authorization: `Bearer ${login.json.access_token}` } });
        if (rest.status !== 200 || !rest.json.length || rest.json[0].code !== 'OLD-1') throw new Error(`REST read of the old card → ${rest.status} ${rest.text.slice(0, 160)}`);
        n1 = rows.map((r) => `${r.id}:${r.applied_at.toISOString()}`);
        // 2.0.3: the plan answer the ERP page asks for (closed to anybody but the caller's own tenant by 20270210x) is still given to the admin an OLDER build created
        const plan = await request('POST', `${API}/rest/v1/rpc/get_all_plan_limits`, { headers: { apikey: upg.secrets.anonKey, Authorization: `Bearer ${login.json.access_token}` }, body: { p_tenant_id: oc.tenantId } });
        if (plan.status !== 200 || !plan.json || plan.json.error || !plan.json.plan_code || !Array.isArray(plan.json.modules) || !plan.json.modules.length) throw new Error(`the old admin's plan answer: ${plan.status} ${plan.text.slice(0, 200)}`);
        // a new card on the upgraded company: M-000001 (the typed OLD-1 is not an M-<digits> code)
        const auth = { apikey: upg.secrets.anonKey, Authorization: `Bearer ${login.json.access_token}`, Prefer: 'return=representation' };
        const r1 = await request('POST', `${API}/rest/v1/fabric_materials`, { headers: auth, body: { tenant_id: oc.tenantId, company_id: oc.companyId, code: null, name_ar: 'بطاقة جديدة' } });
        if (r1.status !== 201 || r1.json[0].code !== 'M-000001') throw new Error(`new card on the upgraded install → ${r1.status} ${r1.text.slice(0, 200)}`);
        postFp = await fingerprint(); catPost = await catalog(); invPost = await invFns();
        return `${got.length} applied on start; counts ${JSON.stringify(counts1)} unchanged; OLD-1 intact and readable by its admin, who still gets his plan answer (${plan.json.plan_code}, ${plan.json.modules.length} modules); new card ${r1.json[0].code}; migrations.log ${ok} ✅`;
      });
      await R.check('B6 the ERP\'s global roles (reference data) reach the UPGRADED install: loaded once before the migrations, no duplicate of the seed roles, capabilities present', () => rolesAfterUpgrade(B));
    } finally { if (upg) await stopApp(upg.child, B); }

    let second = null;
    try {
      second = await boot(B, APP, 'new2');
      await R.check('B3 a SECOND start applies 0: the migration table, its ids and timestamps are unchanged', async () => {
        const rows = await appliedRows();
        const now = rows.map((r) => `${r.id}:${r.applied_at.toISOString()}`);
        if (JSON.stringify(now) !== JSON.stringify(n1)) throw new Error('the migration table changed on the second start');
        const log = mlog(B);
        const lastRun = log.split('\n').filter((l) => /Starting migration check|All migrations already applied|✅ \(\d+\/\d+\)/.test(l));
        if (!/All migrations already applied/.test(log)) throw new Error(`no "already applied" line in migrations.log:\n${log.slice(-500)}`);
        const okLines = (log.match(/✅ \(\d+\/\d+\)/g) || []).length;
        if (okLines !== NAMES.length) throw new Error(`${okLines} ✅ lines in total (expected ${NAMES.length}: the second start must add none)`);
        return `${rows.length} rows, same ids and timestamps; migrations.log: "All migrations already applied", still ${okLines} ✅`;
      });
      await R.check('B5 RESTORE of a .tcdb written by the PREVIOUS build (no tracking_mode column) into the upgraded install: the load runs with the triggers off, the cards come back "quantity", and the restore path repairs them by itself (fabric -> roll, serial flag -> serial); the migration table is untouched', async () => {
        const mBefore = (await appliedRows()).length;
        const m = multipart(fs.readFileSync(oldTcdb), 'old-2.0.1.tcdb', {});
        const r = await rawRequest('POST', `${UI}/api/restore-tcdb`, { headers: { 'x-texacore-local-secret': second.secrets.localApiSecret, 'Content-Type': m.ct }, body: m.body });
        if (r.status !== 200 || !r.json || !r.json.success) throw new Error(`restore → ${r.status} ${r.buf.toString().slice(0, 300)}`);
        const q = Object.fromEntries((await pg(`SELECT code, tracking_mode FROM public.fabric_materials WHERE code IN ('OLD-1','OLD-FAB','OLD-STD','OLD-SER')`)).rows.map((x) => [x.code, x.tracking_mode]));
        if (q['OLD-FAB'] !== 'roll' || q['OLD-1'] !== 'roll' || q['OLD-SER'] !== 'serial' || q['OLD-STD'] !== 'quantity') throw new Error(`modes after the restore: ${JSON.stringify(q)}`);
        const stock = (await pg(`SELECT quantity_on_hand FROM public.inventory_stock WHERE material_id = $1`, [legacy.oldFab])).rows[0];
        if (!stock || Number(stock.quantity_on_hand) !== 30) throw new Error(`the stock of the restored fabric card: ${JSON.stringify(stock)}`);
        const log = fs.readFileSync(second.logFile, 'utf8');
        const note = /\[BackupManager\] tracking_mode: (\d+) card\(s\) of an older file worked out from their flags/.exec(log);
        if (!note || Number(note[1]) < 3) throw new Error(`no repair line in the app log (${note ? note[0] : 'none'})`);
        const again = await pg(`UPDATE public.fabric_materials SET tracking_mode = NULL WHERE material_type = 'fabric'`);   // the app's own repair, run again: harmless
        if ((await appliedRows()).length !== mBefore) throw new Error('the migration table changed by the restore');
        return `restored ${legacy ? 'a 2.0.1 file' : ''}: OLD-FAB (30 in stock) ${q['OLD-FAB']}, OLD-1 ${q['OLD-1']}, OLD-SER ${q['OLD-SER']}, OLD-STD ${q['OLD-STD']}; log "${note[0].slice(0, 60)}…"; the same UPDATE again: ${again.rowCount} card(s), no error; migration table untouched (${mBefore} rows)`;
      });
    } finally { if (second) await stopApp(second.child, B); }

    await R.check('B4 the upgraded install and the fresh install have the SAME functions, triggers, policies and table grants (the upgrade path equals the fresh path)', async () => {
      const diff = (x, y) => { const sx = new Set(x); const sy = new Set(y); return [...x.filter((l) => !sy.has(l)).map((l) => `only upgraded: ${l}`), ...y.filter((l) => !sx.has(l)).map((l) => `only fresh: ${l}`)]; };
      // table lines carry grants and rls flags only; data-independent
      const d = diff(postFp, freshFp);
      if (d.length) throw new Error(`${d.length} difference(s), first: ${d.slice(0, 4).join(' | ')}`);
      return `${postFp.length} fingerprint lines identical (F ${postFp.filter((l) => l.startsWith('F|')).length}, G ${postFp.filter((l) => l.startsWith('G|')).length}, P ${postFp.filter((l) => l.startsWith('P|')).length}, T ${postFp.filter((l) => l.startsWith('T|')).length})`;
    });
  }

  // ═════════ C: an UPGRADE from a build that already carries the first N migrations (2.0.2 -> 2.0.3: 13 applied, 3 to come) ═════════
  let cPostFp = null;
  if (OLD_MIG_APP) {
    const C = path.join(WORK, 'upgrade-mig');
    let o = null; let oc = null; let cardOld = null; let counts0 = null; let rows0 = null; let nPrev = 0; let n1 = null;
    const countsOf = async () => (await pg(`SELECT (SELECT count(*)::int FROM public.companies) c, (SELECT count(*)::int FROM public.tenants) t, (SELECT count(*)::int FROM auth.users) u, (SELECT count(*)::int FROM public.chart_of_accounts) a, (SELECT count(*)::int FROM public.fabric_materials) m`)).rows[0];
    try {
      o = await boot(C, OLD_MIG_APP, 'oldmig');
      await R.check('C1 UPGRADE from the previous build that already has its set: it provisions an install and applies ITS migrations itself (a strict prefix of this build\'s list); a company and one material card with a typed code', async () => {
        const rows = await appliedRows(); nPrev = rows.length;
        const got = rows.map((r) => r.name);
        if (!nPrev || nPrev >= NAMES.length) throw new Error(`the old build applied ${nPrev}, this build ships ${NAMES.length}`);
        if (JSON.stringify(got) !== JSON.stringify(NAMES.slice(0, nPrev))) throw new Error(`the old build's set is not a prefix of this build's list: ${got.join(',')}`);
        oc = await createCompany(o.secrets, 'c');
        cardOld = (await pg(`INSERT INTO public.fabric_materials (tenant_id, company_id, code, name_ar) VALUES ($1,$2,'OLD-1','بطاقة قديمة') RETURNING id`, [oc.tenantId, oc.companyId])).rows[0];
        counts0 = await countsOf(); rows0 = (await appliedRows()).map((r) => `${r.id}:${r.applied_at.toISOString()}`);
        const v = JSON.parse(fs.readFileSync(path.join(C, 'texacore-data', 'bootstrap.json'), 'utf8'));
        return `${nPrev} applied by the old build (${got.map((n) => n.replace(/^20270210/, '').split('_')[0]).join(' ')}); company ${oc.companyId.slice(0, 8)}…, card OLD-1, counts ${JSON.stringify(counts0)}; marker baseline ${String(v.baselineSha256).slice(0, 12)}…`;
      });
    } finally { if (o) await stopApp(o.child, C); }
    let cu = null;
    try {
      cu = await boot(C, APP, 'newmig1');
      await R.check('C2 the NEW build starts on that data: ONLY the missing migrations apply (the first rows keep their ids and timestamps), the data is intact, the company\'s admin logs in and reads the old card, a new card gets its code', async () => {
        const rows = await appliedRows();
        const got = rows.map((r) => r.name);
        if (JSON.stringify(got) !== JSON.stringify(NAMES)) throw new Error(`applied ${got.length}: ${got.join(', ')}`);
        const now = rows.map((r) => `${r.id}:${r.applied_at.toISOString()}`);
        if (JSON.stringify(now.slice(0, nPrev)) !== JSON.stringify(rows0)) throw new Error('the rows the old build wrote changed (ids / timestamps)');
        const counts1 = await countsOf();
        // 20270240k: every EXTENDED chart whose account 115 is a leaf gets it turned into a group with one general leaf under it (+1 account per such company: this install has one)
        const leafDelta = counts1.a - counts0.a;
        if (leafDelta !== 0 && leafDelta !== 1) throw new Error(`the chart of accounts changed by ${leafDelta} (only the 20270240k general leaf, +1, is expected)`);
        if (JSON.stringify({ ...counts1, a: counts0.a }) !== JSON.stringify(counts0)) throw new Error(`data changed: ${JSON.stringify(counts0)} -> ${JSON.stringify(counts1)}`);
        const log = mlog(C);
        const ok = (log.match(/✅ \(\d+\/\d+\)/g) || []).length;
        if (ok !== NAMES.length || /❌|🛑/.test(log)) throw new Error(`migrations.log: ${ok} ✅ lines (expected ${NAMES.length} = ${nPrev} by the old build + ${NAMES.length - nPrev} by this one), errors ${/❌|🛑/.test(log)}`);
        const login = await request('POST', `${API}/auth/v1/token?grant_type=password`, { headers: { apikey: cu.secrets.anonKey }, body: { email: 'owner-c@mig.test', password: 'MigPass#2026' } });
        if (login.status !== 200) throw new Error(`the old admin cannot log in: ${login.status} ${login.text.slice(0, 160)}`);
        const auth = { apikey: cu.secrets.anonKey, Authorization: `Bearer ${login.json.access_token}`, Prefer: 'return=representation' };
        const rest = await request('GET', `${API}/rest/v1/fabric_materials?select=code&id=eq.${cardOld.id}`, { headers: auth });
        if (rest.status !== 200 || !rest.json.length || rest.json[0].code !== 'OLD-1') throw new Error(`REST read of the old card → ${rest.status} ${rest.text.slice(0, 160)}`);
        const plan = await request('POST', `${API}/rest/v1/rpc/get_all_plan_limits`, { headers: auth, body: { p_tenant_id: oc.tenantId } });
        if (plan.status !== 200 || !plan.json || plan.json.error || !plan.json.plan_code || !Array.isArray(plan.json.modules) || !plan.json.modules.length) throw new Error(`the old admin's plan answer: ${plan.status} ${plan.text.slice(0, 200)}`);
        const r1 = await request('POST', `${API}/rest/v1/fabric_materials`, { headers: auth, body: { tenant_id: oc.tenantId, company_id: oc.companyId, code: null, name_ar: 'بطاقة جديدة' } });
        if (r1.status !== 201 || r1.json[0].code !== 'M-000001') throw new Error(`new card on the upgraded install → ${r1.status} ${r1.text.slice(0, 200)}`);
        n1 = now;
        cPostFp = await fingerprint();
        return `${NAMES.length - nPrev} applied on start (${NAMES.slice(nPrev).map((n) => n.replace(/^2027021/, '').split('_')[0]).join(' ')}), the ${nPrev} older rows untouched; counts ${JSON.stringify(counts1)} unchanged; OLD-1 readable by its admin, who still gets his plan answer (${plan.json.plan_code}); new card ${r1.json[0].code}; migrations.log ${ok} ✅`;
      });
    } finally { if (cu) await stopApp(cu.child, C); }
    let c2 = null;
    try {
      c2 = await boot(C, APP, 'newmig2');
      await R.check('C3 a SECOND start of the new build applies 0: the table, its ids and timestamps are unchanged', async () => {
        const now = (await appliedRows()).map((r) => `${r.id}:${r.applied_at.toISOString()}`);
        if (JSON.stringify(now) !== JSON.stringify(n1)) throw new Error('the migration table changed on the second start');
        const log = mlog(C);
        if (!/All migrations already applied/.test(log)) throw new Error(`no "already applied" line in migrations.log:\n${log.slice(-500)}`);
        const okLines = (log.match(/✅ \(\d+\/\d+\)/g) || []).length;
        if (okLines !== NAMES.length) throw new Error(`${okLines} ✅ lines in total (expected ${NAMES.length}: the second start must add none)`);
        return `${now.length} rows, same ids and timestamps; "All migrations already applied", still ${okLines} ✅`;
      });
      await R.check('C5 the ERP\'s global roles (reference data) are on the install upgraded from the previous build too, once each', () => rolesAfterUpgrade(C));
    } finally { if (c2) await stopApp(c2.child, C); }
    await R.check('C4 the install upgraded from the previous build (set of ' + nPrev + ') and the fresh install have the SAME functions, triggers, policies and table grants (upgrade path == fresh path)', async () => {
      if (!cPostFp || !freshFp) throw new Error('no fingerprint to compare');
      const sx = new Set(cPostFp); const sy = new Set(freshFp);
      const d = [...cPostFp.filter((l) => !sy.has(l)).map((l) => `only upgraded: ${l}`), ...freshFp.filter((l) => !sx.has(l)).map((l) => `only fresh: ${l}`)];
      if (d.length) throw new Error(`${d.length} difference(s), first: ${d.slice(0, 4).join(' | ')}`);
      return `${cPostFp.length} fingerprint lines identical (F ${cPostFp.filter((l) => l.startsWith('F|')).length}, G ${cPostFp.filter((l) => l.startsWith('G|')).length}, P ${cPostFp.filter((l) => l.startsWith('P|')).length}, T ${cPostFp.filter((l) => l.startsWith('T|')).length})`;
    });
  }

  // ═════════ E: STEP BY STEP against production's own image after each step ═════════
  if (OLD_MIG_APP && PROD_STEPS) {
    const E = path.join(WORK, 'steps');
    let e = null;
    try {
      e = await boot(E, OLD_MIG_APP, 'steps');
      await R.check('E step by step: the files that came after the old build\'s set are applied ONE AT A TIME (psql over stdin, ON_ERROR_STOP, the way production got them); after each, the whole fingerprint (functions md5 + SECURITY DEFINER + grants, triggers, policies, table grants + RLS) differs from production\'s own list taken right after that step by NOTHING MORE than it differed before the step (the baseline\'s redacted / local-extra differences)', async () => {
        const n = (await appliedRows()).length;
        const rest = NAMES.slice(n);
        const fpFiles = PROD_STEPS.split(',').map((s) => path.resolve(s.trim())).filter(Boolean);
        if (fpFiles.length !== rest.length + 1) throw new Error(`--prod-steps needs ${rest.length + 1} files (the image after the old build's set, then one per remaining migration: ${rest.join(', ')}); got ${fpFiles.length}`);
        const prodOf = (f) => new Set(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean));
        const sets = (loc, prod) => { const ls = new Set(loc); return { localOnly: loc.filter((l) => !prod.has(l)), prodOnly: [...prod].filter((l) => !ls.has(l)) }; };
        let loc = await fingerprint();
        const base = sets(loc, prodOf(fpFiles[0]));
        const baseLocal = new Set(base.localOnly); const baseProd = new Set(base.prodOnly);
        const rows = [`start (${n} applied): ${base.localOnly.length} local-only / ${base.prodOnly.length} production-only lines (baseline differences, accepted as the start point)`];
        const problems = [];
        for (let i = 0; i < rest.length; i++) {
          const m = manifest.migrations.find((x) => x.name === rest[i]);
          const before = new Set(loc);
          const r = await applyFile(OLD_MIG_APP, e.secrets, fs.readFileSync(path.join(GEN, m.file)));
          if (r.code !== 0) throw new Error(`${m.name}: psql exit ${r.code} — ${r.err}`);
          loc = await fingerprint();
          const ch = changedLines(loc, before);
          const prod = prodOf(fpFiles[i + 1]);
          const s = sets(loc, prod);
          const newLocal = s.localOnly.filter((l) => !baseLocal.has(l));
          const newProd = s.prodOnly.filter((l) => !baseProd.has(l));
          const fCh = ch.filter((l) => l.startsWith('F|')).length;
          const fOk = ch.filter((l) => l.startsWith('F|') && prod.has(l)).length;
          rows.push(`${m.name.replace(/^2027021/, '')}: changed ${ch.length} lines (F ${fCh}, G ${ch.filter((l) => l.startsWith('G|')).length}, P ${ch.filter((l) => l.startsWith('P|')).length}, T ${ch.filter((l) => l.startsWith('T|')).length}); functions identical to production (md5+secdef+grants): ${fOk}/${fCh}; new differences: ${newLocal.length} local-only / ${newProd.length} production-only`);
          for (const l of newLocal.slice(0, 6)) problems.push(`${m.name}: here but not in production: ${l.slice(0, 150)}`);
          for (const l of newProd.slice(0, 6)) problems.push(`${m.name}: in production but not here: ${l.slice(0, 150)}`);
        }
        ev.steps = rows;
        fs.writeFileSync(path.join(WORK, 'steps-report.json'), JSON.stringify({ rows, problems }, null, 2));
        if (problems.length) throw new Error(`${problems.length} difference(s) from production after a step:\n  ${problems.slice(0, 12).join('\n  ')}`);
        return rows.join(' || ');
      });
    } finally { if (e) await stopApp(e.child, E); }
  }

  // ═════════ D: fingerprints against production's post-image ═════════
  const post = postFp || cPostFp || freshFp;
  if (PROD_FP && post) {
    await R.check('D fingerprints: every function the shipped migrations created or replaced has, on this database, the md5(prosrc) (and SECURITY DEFINER flag, and grants) of production\'s post-image', async () => {
      const prod = fnMap(fs.readFileSync(PROD_FP, 'utf8').split('\n').filter(Boolean));
      const local = fnMap(post);
      const before = preFp ? fnMap(preFp) : null;
      // the functions the migrations touched: new or changed vs the previous build's install (upgrade run); on a fresh-only run: those that differ from nothing known -> all
      const touched = before ? [...local.keys()].filter((s) => !before.has(s) || before.get(s).md5 !== local.get(s).md5 || before.get(s).acl !== local.get(s).acl || before.get(s).secdef !== local.get(s).secdef) : [...local.keys()];
      const bad = []; let same = 0; let sameMd5 = 0;
      for (const s of touched) {
        const p = prod.get(s); const l = local.get(s);
        if (!p) { bad.push(`${s}: not in production's post-image`); continue; }
        if (p.md5 !== l.md5) { bad.push(`${s}: md5 ${l.md5.slice(0, 8)} here, ${p.md5.slice(0, 8)} in production`); continue; }
        sameMd5++;
        if (p.secdef !== l.secdef || p.acl !== l.acl) bad.push(`${s}: same body, but secdef/grants differ (here ${l.secdef} ${l.acl.slice(0, 60)} / production ${p.secdef} ${p.acl.slice(0, 60)})`);
        else same++;
      }
      // the rest of the functions: how far is this database from production overall (informational: the baseline's four redacted functions + the installer's local extras live here)
      const outside = [...local.keys()].filter((s) => !touched.includes(s) && (!prod.has(s) || prod.get(s).md5 !== local.get(s).md5));
      const prodOnly = [...prod.keys()].filter((s) => !local.has(s));
      ev.d = { touched: touched.length, same, sameMd5, bad, outside, prodOnly: prodOnly.length };
      fs.writeFileSync(path.join(WORK, 'fingerprint-report.json'), JSON.stringify({ touched, bad, outsideMd5Differ: outside, productionOnly: prodOnly }, null, 2));
      if (bad.length) throw new Error(`${bad.length} of ${touched.length} touched functions differ:\n  ${bad.slice(0, 12).join('\n  ')}`);
      return `${touched.length} functions created/replaced by the shipped migrations: ${sameMd5} md5 = production, ${same} with identical SECURITY DEFINER + grants; outside them: ${outside.length} differ from production's md5 (redacted / local extras), ${prodOnly.length} production-only functions`;
    });
  }

  await R.check('V 20270210v: the six functions it creates / replaces have production\'s post-image md5 (coordinator\'s table)', async () => {
    const local = fnMap(post);
    const bad = Object.entries(V_MD5).filter(([sig, md5]) => !local.has(sig) || local.get(sig).md5 !== md5).map(([sig]) => `${sig}: ${local.has(sig) ? local.get(sig).md5.slice(0, 8) : 'missing'}`);
    if (bad.length) throw new Error(`${bad.join('; ')}`);
    return `${Object.keys(V_MD5).length}/${Object.keys(V_MD5).length} md5 equal (fn_guard_material_card 2fe6c0a6… = 20270240l, fn_material_tracking_sync db9d6ce5…, …)`;
  });

  // ═════════ the inventory delta of the migrations (what manifest.inventoryAfter carries) ═════════
  if (WRITE_INV) {
    if (!catPre || !catPost) throw new Error('--write-inventory needs --old-app (the pre-migration state is measured on the previous build\'s install)');
    const catalogDelta = {}; for (const k of Object.keys(catPost)) catalogDelta[k] = Number(catPost[k]) - Number(catPre[k]);
    const functions = {}; for (const [sig, md5] of invPost) if (!invPre.has(sig) || invPre.get(sig) !== md5) functions[sig] = md5;
    const removed = [...invPre.keys()].filter((sig) => !invPost.has(sig));
    fs.writeFileSync(WRITE_INV, JSON.stringify({ catalogDelta, functions, removed }, null, 2));
    console.log(`  wrote catalogDelta ${JSON.stringify(catalogDelta)} + ${Object.keys(functions).length} function md5s (${removed.length} removed) to ${WRITE_INV}`);
  }

  const summary = R.summary();
  console.log(`\nmigrations-check: ${summary}  →  ${path.join(WORK, 'results.json')}`);
  fs.writeFileSync(path.join(WORK, 'results.json'), JSON.stringify({ at: new Date().toISOString(), summary, rows: R.rows, evidence: ev }, null, 2));
  process.exit(R.failed.length ? 1 : 0);
})().catch((e) => { console.error('migrations-check crashed:', e); process.exit(1); });
