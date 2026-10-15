#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// launch-check — the REAL launch test of the installer (1.9.0 failed because the build was never launched).
//
//   node scripts/e2e/launch-check.js --workdir <empty dir> [--license free|trial] [--erp <ERP checkout>] [--rsf <file.rsf>] [--app <packaged .app>]
//
// Runs the real ServiceManager in Electron dev mode — or, with --app, the PACKAGED build (headless; cloudflared + MeshAgent stubbed; ports 47391-47396 only; its own
// userData under --workdir — it never touches the real app's data), then walks the first-run path:
//   1. first run → initdb → baseline → services up (+ proof the database equals the pinned baseline)
//   2. admin created → company created (server functions as the admin) → the ERP page loads and the admin logs in
//   3. anon refused / tenant isolation / admin-API secret / tunnel default-deny
//   4. plan sync (free or trial)
//   5. (with --rsf) a Rashid import into a new company, through the real importer and the real REST gateway
// Exit code 0 = everything passed. Evidence goes to <workdir>/results.json.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const path = require('path');
const { Client } = require('pg');
const { ROOT, PORTS, Results, portFree, request, startApp, stopApp, setPgPassword, pgOptions, expectedInventory } = require('./lib');
const bootstrap = require('../../src/bootstrap');
const secretsMod = require('../../src/secrets');

function arg(name, def = '') { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const WORK = path.resolve(arg('workdir', ''));
const LICENSE = arg('license', 'free');
const ERP = arg('erp', process.env.TEXACORE_ERP_DIR || '');
const RSF = arg('rsf', '');
const KEEP = process.argv.includes('--keep');
// security review F1: the folder the upload-restore writes to IS the folder the "company folder" export writes to (the reviewer's scenario: a passphrase-protected export saved in the company folder, then opened)
const TCDB_IN_COMPANY_FOLDER = process.argv.includes('--tcdb-in-company-folder');
const APP = arg('app', '');   // path to a PACKAGED …/TexaCore ERP.app (the real build) instead of Electron dev mode on this checkout
if (!arg('workdir')) { console.error('--workdir <dir> is required'); process.exit(2); }

const UI = `http://127.0.0.1:${PORTS.ui}`;
const API = `http://127.0.0.1:${PORTS.api}`;
const ADMIN = `http://127.0.0.1:${PORTS.admin}`;

async function pg(sql, params = []) {
  const c = new Client(pgOptions());
  await c.connect();
  try { return await c.query(sql, params); } finally { await c.end(); }
}

/** A plan edit the way the console does it: production's plan guard refuses lowering a mirrored limit unless the transaction carries the confirmation. */
async function pgConfirmedPlan(planId, sql, params) {
  const c = new Client(pgOptions());
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('texacore.plan_change_confirmed', $1::text, true)`, [planId]);
    await c.query(sql, params);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { await c.end(); }
}

async function main() {
  const R = new Results();
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  const userData = path.join(WORK, 'userdata');
  const logFile = path.join(WORK, 'app.log');
  // 2.0.3: the folders POST /api/locate-picked-file may search in this run (it never scans the real profile): the checks below put their files here
  const LOCATE_ROOTS = [path.join(WORK, 'locate-a'), path.join(WORK, 'locate-b')];
  for (const d of LOCATE_ROOTS) fs.mkdirSync(d, { recursive: true });
  for (const p of Object.values(PORTS)) if (!(await portFree(p))) { console.error(`port ${p} is in use — stop whatever holds it first`); process.exit(2); }

  console.log(`launch-check: license=${LICENSE} workdir=${WORK}`);
  const appBinary = APP ? path.join(path.resolve(APP), 'Contents', 'MacOS', path.basename(path.resolve(APP), '.app')) : '';
  if (APP && !fs.existsSync(appBinary)) { console.error(`no executable at ${appBinary}`); process.exit(2); }
  const { child, ready } = startApp({ userData, license: LICENSE, logFile, appBinary, extraEnv: { TEXACORE_UI_SMOKE: '1', TEXACORE_E2E_LOCATE_ROOTS: LOCATE_ROOTS.join(path.delimiter), ...(TCDB_IN_COMPANY_FOLDER ? { TEXACORE_TCDB_DIR: path.join(WORK, 'rashid-folder') } : {}) } });
  let secrets = null;
  try {
    await R.check('1.1 first run: initdb → baseline → services up', async () => {
      const r = await ready;
      return `ports ${r.ports.pg}-${r.ports.admin}`;
    });
    const dataDir = path.join(userData, 'texacore-data');
    secrets = JSON.parse(fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8'));
    setPgPassword(secrets.dbPassword);

    await R.check('1.2 bootstrap marker is ready and pins the baseline sha', async () => {
      const m = bootstrap.readMarker(dataDir);
      const pin = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'BASELINE_PIN.json'), 'utf8'));
      if (m.status !== 'ready') throw new Error(`status ${m.status}`);
      if (m.baselineSha256 !== pin.files['production_baseline.sql'].sha256) throw new Error('marker sha != pin sha');
      return `ready, cut ${m.baselineCut}, sha ${m.baselineSha256.slice(0, 12)}…`;
    });
    await R.check('1.3 PostgreSQL 17.6, ICU en-US collation, UTC, UTF8', async () => {
      const r = (await pg(`SELECT current_setting('server_version') v, current_setting('TimeZone') tz, d.datlocprovider p, d.datlocale l, pg_encoding_to_char(d.encoding) e
                             FROM pg_database d WHERE d.datname='postgres'`)).rows[0];
      if (!r.v.startsWith('17.6')) throw new Error(`server ${r.v}`);
      if (r.p !== 'i' || r.l !== 'en-US') throw new Error(`collation provider ${r.p} / ${r.l}`);
      if (r.tz !== 'UTC' || r.e !== 'UTF8') throw new Error(`tz ${r.tz} enc ${r.e}`);
      return `${r.v} provider=${r.p} locale=${r.l} tz=${r.tz} ${r.e}`;
    });
    await R.check('1.4 every production function body equals the baseline inventory + the incremental migrations\' measured functions (only the 4 redacted-secret ones differ)', async () => {
      const { inv } = expectedInventory();
      const rows = (await pg(`SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS sig, md5(p.prosrc) AS md5
                                FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                               WHERE n.nspname IN ('public','licensing','newpost','tomgenerators') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')`)).rows;
      const c = bootstrap.compareFunctionInventory(inv.functions_md5, rows);
      if (!c.ok) throw new Error(`missing ${c.missing.length} extra ${c.extra.length} differ ${c.mismatched.length}: ${[...c.missing, ...c.extra, ...c.mismatched].slice(0, 3).join(' | ')}`);
      return `${c.expected} functions compared (baseline + the incremental migrations; none patched by hand: the baseline carries production's own enforce_plan_limit, 20270210h)`;
    });
    await R.check('1.4b database authentication: scram-sha-256 for EVERYONE — no password / wrong password / another role\'s password are refused; pg_hba has no trust; roles hold SCRAM hashes', async () => {
      const attempt = async (opts) => {
        const c = new Client({ ...pgOptions(), connectionTimeoutMillis: 5000, ...opts });
        c.on('error', () => {});
        try { await c.connect(); await c.query('SELECT 1'); return 'accepted'; } catch (e) { return `refused: ${String(e.message).slice(0, 70)}`; } finally { try { await c.end(); } catch { /* */ } }
      };
      const sp = secrets.dbPassword;
      const noPw = await attempt({ password: undefined });
      const wrong = await attempt({ password: 'definitely-wrong' });
      const wrongSuper = await attempt({ password: secrets.authenticatorPassword });
      const authnRight = await attempt({ user: 'authenticator', password: secrets.authenticatorPassword });
      const authnNoPw = await attempt({ user: 'authenticator', password: undefined });
      const authnSuper = await attempt({ user: 'authenticator', password: sp });
      const adminRight = await attempt({ user: 'supabase_auth_admin', password: secrets.authAdminPassword });
      const adminOther = await attempt({ user: 'supabase_auth_admin', password: secrets.authenticatorPassword });
      const ok = await attempt({});
      if (!noPw.startsWith('refused') || !wrong.startsWith('refused') || !wrongSuper.startsWith('refused')) throw new Error(`superuser: no password → ${noPw}; wrong → ${wrong}; the authenticator's password → ${wrongSuper}`);
      if (ok !== 'accepted') throw new Error(`the right superuser password was ${ok}`);
      if (authnRight !== 'accepted' || !authnNoPw.startsWith('refused') || !authnSuper.startsWith('refused')) throw new Error(`authenticator: right ${authnRight}; none ${authnNoPw}; superuser's password ${authnSuper}`);
      if (adminRight !== 'accepted' || !adminOther.startsWith('refused')) throw new Error(`supabase_auth_admin: right ${adminRight}; authenticator's password ${adminOther}`);
      if (new Set([secrets.dbPassword, secrets.authenticatorPassword, secrets.authAdminPassword]).size !== 3) throw new Error('the three database passwords are not distinct');
      // the command-line client too (psql without PGPASSWORD must not get in)
      const psqlBin = APP ? path.join(path.resolve(APP), 'Contents', 'Resources', 'bin', 'pg', 'bin', 'psql') : path.join(ROOT, 'bin', 'macos-arm64', 'pg', 'bin', 'psql');
      const env = { ...process.env }; delete env.PGPASSWORD;
      const cli = require('child_process').spawnSync(psqlBin, ['-w', '-X', '-h', '127.0.0.1', '-p', String(PORTS.pg), '-U', 'postgres', '-d', 'postgres', '-c', 'SELECT 1'], { env, encoding: 'utf8', timeout: 15000 });
      if (cli.status === 0) throw new Error('psql without a password connected');
      const hbaPath = path.join(dataDir, 'pgdata', 'pg_hba.conf');
      const hba = fs.readFileSync(hbaPath, 'utf8');
      const rules = hba.split('\n').filter((l) => l.trim() && !/^\s*#/.test(l));
      if (/\btrust\b/.test(hba.replace(/^\s*#.*$/gm, '')) || rules.some((l) => !/scram-sha-256\s*$/.test(l))) throw new Error(`pg_hba.conf has a rule that is not scram-sha-256:\n${rules.join('\n')}`);
      const q = (await pg(`SELECT current_setting('password_encryption') pe, current_setting('log_min_error_statement') lm, current_setting('log_statement') ls, current_setting('listen_addresses') la,
                                  (SELECT count(*)::int FROM pg_authid WHERE rolname IN ('postgres','authenticator','supabase_auth_admin') AND rolpassword LIKE 'SCRAM-SHA-256$%') scram`)).rows[0];
      if (q.pe !== 'scram-sha-256' || q.lm !== 'panic' || q.ls !== 'none' || q.la !== '127.0.0.1' || q.scram !== 3) throw new Error(`settings ${JSON.stringify(q)}`);
      return `superuser: no password / wrong / authenticator's → refused, right → ok; authenticator & supabase_auth_admin: own password ok, none or the other's refused; psql without PGPASSWORD refused; ${rules.length} pg_hba rules, all scram-sha-256 (none trust); 3 roles hold SCRAM-SHA-256 hashes; log_min_error_statement=panic`;
    });
    await R.check('1.4c nothing leaks into files: no CREATE TABLE / CREATE POLICY / ALTER TABLE / CREATE FUNCTION text in any file outside the database cluster (logs, config, markers, Electron data); logs and secrets are private', async () => {
      const needles = ['CREATE TABLE', 'CREATE POLICY', 'ALTER TABLE', 'CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 'CREATE TRIGGER', 'CREATE INDEX', 'CREATE VIEW'].map((x) => Buffer.from(x));
      const pgdata = path.join(dataDir, 'pgdata') + path.sep;
      const hits = []; let scanned = 0; let bytes = 0; let chromiumDbs = 0;     // (Electron's own browser-profile SQLite files — Cookies, Trust Tokens … — carry their own schema text: not ours)
      const walkAll = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isSymbolicLink()) continue; if (e.isDirectory()) { if ((f + path.sep).startsWith(pgdata)) continue; walkAll(f); } else { const st = fs.statSync(f); if (st.size === 0 || st.size > 300e6) continue; const b = fs.readFileSync(f); if (b.subarray(0, 15).toString('latin1') === 'SQLite format 3') { chromiumDbs += 1; continue; } scanned += 1; bytes += st.size; const n = needles.find((x) => b.indexOf(x) >= 0); if (n) hits.push(`${path.relative(userData, f)} (${n})`); } } };
      walkAll(userData);
      if (hits.length) throw new Error(`SQL text found in: ${hits.slice(0, 6).join('; ')}`);
      const mode = (f) => (fs.statSync(f).mode & 0o777).toString(8);
      const modes = { 'logs/postgres.log': mode(path.join(dataDir, 'logs', 'postgres.log')), 'logs/gotrue.log': mode(path.join(dataDir, 'logs', 'gotrue.log')), 'logs/postgrest.log': mode(path.join(dataDir, 'logs', 'postgrest.log')),
        'logs/': mode(path.join(dataDir, 'logs')), 'secrets.json': mode(path.join(dataDir, 'secrets.json')), 'config.json': mode(path.join(dataDir, 'config.json')), 'pg_hba.conf': mode(path.join(dataDir, 'pgdata', 'pg_hba.conf')) };
      const loose = Object.entries(modes).filter(([k, v]) => (k === 'logs/' ? v !== '700' : v !== '600'));
      if (loose.length) throw new Error(`not private: ${loose.map(([k, v]) => `${k} ${v}`).join(', ')}`);
      const plog = fs.statSync(path.join(dataDir, 'logs', 'postgres.log')).size;
      if (plog > 20000) throw new Error(`postgres.log is ${plog} bytes right after the first run (the bootstrap's lines should be gone)`);
      const bl = JSON.parse(fs.readFileSync(path.join(dataDir, 'logs', 'baseline-load.json'), 'utf8'));
      return `${scanned} files (${(bytes / 1e6).toFixed(1)} MB) outside pgdata scanned (+${chromiumDbs} Chromium profile SQLite files skipped): no DDL text; modes ${Object.entries(modes).map(([k, v]) => k + ' ' + v).join(', ')}; postgres.log ${plog} bytes; baseline load: ${bl.map((p) => `pass ${p.pass} ${p.mode} ${p.errors} err`).join(' → ')}`;
    });
    await R.check('1.4d no secret appears on any process command line (ps): JWT secret, the three database passwords, service key, admin-API secret', async () => {
      const ps = require('child_process').execFileSync('ps', ['-axww', '-o', 'command='], { encoding: 'utf8', maxBuffer: 64 << 20 });
      const named = { jwtSecret: secrets.jwtSecret, dbPassword: secrets.dbPassword, authenticatorPassword: secrets.authenticatorPassword, authAdminPassword: secrets.authAdminPassword, serviceKey: secrets.serviceKey, localApiSecret: secrets.localApiSecret };
      const leaks = Object.entries(named).filter(([, v]) => v && ps.includes(v)).map(([k]) => k);
      if (leaks.length) throw new Error(`on a command line: ${leaks.join(', ')}`);
      const mine = ps.split('\n').filter((l) => l.includes(dataDir) || l.includes('postgrest') || /\/auth\b/.test(l) || l.includes('texacore')).length;
      return `${ps.split('\n').length} process command lines on this machine searched (${mine} are this install's): none contains any of the 6 secrets`;
    });
    await R.check('1.5 extensions usable as extensions.* (uuid-ossp, pgcrypto); the rest of the baseline\'s extension list accounted for', async () => {
      const r = (await pg(`SELECT extensions.uuid_generate_v4() IS NOT NULL u, length(extensions.gen_salt('bf'))>0 c, encode(extensions.digest('a','sha256'),'hex') h`)).rows[0];
      if (!r.u || !r.c || !r.h.startsWith('ca978112')) throw new Error('not usable');
      const have = (await pg(`SELECT e.extname, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY 1`)).rows;
      for (const need of ['uuid-ossp', 'pgcrypto']) if (!have.some((x) => x.extname === need && x.nspname === 'extensions')) throw new Error(`${need} is not in schema extensions`);
      const wanted = ['pg_cron', 'pg_net', 'pg_stat_statements', 'pgcrypto', 'supabase_vault', 'uuid-ossp'];        // what the baseline asks for (CREATE EXTENSION)
      const skipped = wanted.filter((w) => !have.some((x) => x.extname === w));
      // pg_cron / pg_net / supabase_vault are Supabase-platform extensions: not in the PostgreSQL bundle, skipped by the baseline's guarded DO blocks
      if (skipped.some((x) => !['pg_cron', 'pg_net', 'supabase_vault'].includes(x))) throw new Error(`unexpectedly missing: ${skipped.join(', ')}`);
      const netStub = (await pg(`SELECT net.http_post('http://example.invalid') IS NULL AS ok`)).rows[0].ok;
      if (!netStub) throw new Error('net.http_post stub missing');
      return `installed: ${have.map((x) => x.extname).join(', ')}; platform-only, skipped: ${skipped.join(', ')} (net.http_* stubbed)`;
    });
    await R.check('1.6 production grants/RLS intact: no GRANT-to-anon added, no table lost RLS', async () => {
      const { inv, rlsDelta } = expectedInventory();     // the baseline's + the migrations' own bookkeeping table (RLS, no policy)
      const rls = (await pg(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','licensing','newpost','tomgenerators') AND c.relkind IN ('r','p') AND c.relrowsecurity`)).rows[0].n;
      if (rls !== Number(inv.main.rls_enabled) + bootstrap.LOCAL_EXTRAS.rlsTables + rlsDelta) throw new Error(`RLS tables ${rls}, expected ${Number(inv.main.rls_enabled) + bootstrap.LOCAL_EXTRAS.rlsTables + rlsDelta}`);
      const noRls = (await pg(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') ORDER BY 1`)).rows.map((r) => r.relname);
      if (noRls.length) throw new Error(`anon can reach tables without RLS: ${noRls.join(', ')}`);
      return `${rls} RLS tables = inventory (+1 local gate${rlsDelta ? `, +${rlsDelta} migration bookkeeping table` : ''}); anon reaches no table without RLS`;
    });

    if (ERP) {
      await R.check('1.7 (informational) the baseline contains every RPC this ERP build calls', async () => {
        const r = require('../check-rpc-coverage').coverage(ERP);
        if (r.missing.length) { R.warnings.push(`${r.missing.length} RPCs called by the ERP are missing from the baseline (stale cut): ${r.missing.join(', ')}`); return `WARNING — ${r.missing.length} of ${r.called} missing: ${r.missing.slice(0, 8).join(', ')}…`; }
        return `all ${r.called} present`;
      });
    }

    // ── 2. admin API + config.js ──
    await R.check('2.1 admin API: /api/ping open, everything else needs the install secret', async () => {
      const ping = await request('GET', `${ADMIN}/api/ping`);
      if (ping.status !== 200) throw new Error(`ping ${ping.status}`);
      const noSecret = await request('GET', `${ADMIN}/api/companies`);
      if (noSecret.status !== 401) throw new Error(`/api/companies without secret → ${noSecret.status}`);
      const wrong = await request('GET', `${ADMIN}/api/companies`, { headers: { 'x-texacore-local-secret': 'nope' } });
      if (wrong.status !== 401) throw new Error(`wrong secret → ${wrong.status}`);
      const ok = await request('GET', `${ADMIN}/api/companies`, { headers: { 'x-texacore-local-secret': secrets.localApiSecret } });
      if (ok.status !== 200) throw new Error(`right secret → ${ok.status}`);
      const create = await request('POST', `${ADMIN}/api/create-local-company`, { body: { companyName: 'x' } });
      if (create.status !== 401) throw new Error(`create-local-company without secret → ${create.status}`);
    });
    await R.check('2.2 /config.js: anon key + admin secret for a same-origin page ONLY; never the service key; nothing over the tunnel', async () => {
      const same = await request('GET', `${UI}/config.js`, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
      const cross = await request('GET', `${UI}/config.js`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
      const tunnel = await request('GET', `${UI}/config.js`, { headers: { Host: 'demo.texacore.ai', 'Sec-Fetch-Site': 'same-origin', 'x-forwarded-proto': 'https' } });
      if (!same.text.includes(secrets.anonKey) || !same.text.includes(secrets.localApiSecret)) throw new Error('same-origin config.js lacks anon key / secret');
      if (cross.text.includes(secrets.localApiSecret)) throw new Error('cross-site page received the admin secret');
      if (tunnel.text.includes(secrets.localApiSecret)) throw new Error('tunnel request received the admin secret');
      for (const t of [same.text, cross.text, tunnel.text]) if (t.includes(secrets.serviceKey) || t.includes(secrets.jwtSecret) || t.includes(secrets.dbPassword)) throw new Error('config.js leaks a server secret');
      const WANT = require('../../package.json').version;
      if (!same.text.includes(`appVersion: "${WANT}"`)) throw new Error(`appVersion in config.js is not ${WANT}`);
      return `ok; appVersion ${WANT}`;
    });

    // ── 3. owner provisioning ──
    const body = (o) => ({ companyName: 'E2E Trading', adminEmail: 'owner@e2e.test', adminPassword: 'E2ePass#2026', localCurrency: 'UAH', mainCurrency: 'USD', country: 'UA',
      storagePath: path.join(WORK, 'tcdb'), dbFileName: 'e2e', ...o });
    const H = { 'x-texacore-local-secret': secrets.localApiSecret };
    let A = null;
    await R.check('3.1 create company (blank) through /api/create-local-company', async () => {
      const r = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: body({}) });
      if (!r.json || !r.json.success) throw new Error(`failed: ${r.text.slice(0, 300)}`);
      A = r.json;
      if (!A.companyId || !A.accessToken || !A.refreshToken) throw new Error('response lacks companyId / session');
      return `company ${A.companyId.slice(0, 8)}…`;
    });
    await R.check('3.1b the installer window works in THIS build (preload bridge, IPC handlers, renderer, i18n) against the live services', async () => {
      const r = await request('GET', `${ADMIN}/api/ui-smoke`, { headers: H });
      if (r.status !== 200 || !r.json || !r.json.ok) throw new Error(`ui-smoke → ${r.status} ${r.text.slice(0, 300)}`);
      const u = r.json;
      if (u.version !== require('../../package.json').version) throw new Error(`window reports version ${u.version}`);
      if (!(u.bridgeKeys >= 20)) throw new Error(`preload bridge exposes only ${u.bridgeKeys} functions`);
      if (!u.state.ok || !u.state.hasConfig) throw new Error(`get-state over IPC: ${JSON.stringify(u.state)}`);
      if (u.secretLength < 32) throw new Error('the window did not receive the admin secret over IPC');
      if (!u.companies.success || u.companies.n < 1) throw new Error(`list-local-companies over IPC: ${JSON.stringify(u.companies)}`);
      const e = u.employeesBox;
      if (e.display !== 'block' || !/^http:\/\/.+\/login\?c=[0-9a-f]{8}$/.test(e.link) || e.companies < 1 || e.roles < 1) throw new Error(`employees box not drawn from live data: ${JSON.stringify(e)}`);
      if (!u.i18n || u.i18n.length < 2) throw new Error('i18n not applied');
      return `window v${u.version}: ${u.bridgeKeys} bridge functions, state/secret/companies over IPC, employees box drawn (${e.link}; ${e.companies} company, ${e.roles} roles), i18n applied`;
    });
    await R.check('3.2 tenants.owner_email + user_profiles.is_tenant_admin set; base currency from the user\'s choice (UAH, not SAR)', async () => {
      const r = (await pg(`SELECT t.owner_email, up.is_tenant_admin, up.role, c.default_currency, cas.base_currency, cas.supported_currencies::text sc
                             FROM tenants t JOIN user_profiles up ON up.tenant_id=t.id JOIN companies c ON c.tenant_id=t.id JOIN company_accounting_settings cas ON cas.company_id=c.id
                            WHERE t.id=$1`, [A.tenantId])).rows[0];
      if (r.owner_email !== 'owner@e2e.test') throw new Error(`owner_email=${r.owner_email}`);
      if (r.is_tenant_admin !== true) throw new Error('is_tenant_admin not true');
      if (r.default_currency !== 'UAH' || r.base_currency !== 'UAH') throw new Error(`currency ${r.default_currency}/${r.base_currency}`);
      return `owner_email ok, is_tenant_admin t, ${r.default_currency}/${r.base_currency} ${r.sc}`;
    });
    await R.check('3.3 healTenantOwners repairs a tenant that lost owner_email / the admin flag', async () => {
      await pg(`UPDATE tenants SET owner_email = NULL WHERE id=$1`, [A.tenantId]);
      await pg(`UPDATE user_profiles SET is_tenant_admin = false WHERE id=$1`, [A.adminUserId || (await pg('SELECT id FROM user_profiles WHERE tenant_id=$1', [A.tenantId])).rows[0].id]);
      const { healTenantOwners } = require('../../src/provisioning');
      const r = await healTenantOwners({ pgQuery: (t, p) => pg(t, p) });
      const row = (await pg('SELECT t.owner_email, up.is_tenant_admin FROM tenants t JOIN user_profiles up ON up.tenant_id=t.id WHERE t.id=$1', [A.tenantId])).rows[0];
      if (row.owner_email !== 'owner@e2e.test' || row.is_tenant_admin !== true) throw new Error(`not healed: ${JSON.stringify(row)} ${JSON.stringify(r)}`);
      return JSON.stringify(r);
    });
    await R.check('3.4 duplicate admin email → EMAIL_EXISTS, nothing written', async () => {
      const before = (await pg(`SELECT (SELECT count(*) FROM tenants)::int t, (SELECT count(*) FROM auth.users)::int u, (SELECT count(*) FROM companies)::int c`)).rows[0];
      const r = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: body({ companyName: 'Dup' }) });
      const after = (await pg(`SELECT (SELECT count(*) FROM tenants)::int t, (SELECT count(*) FROM auth.users)::int u, (SELECT count(*) FROM companies)::int c`)).rows[0];
      if (!r.json || r.json.code !== 'EMAIL_EXISTS') throw new Error(`got ${r.text.slice(0, 200)}`);
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`rows changed ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    });
    await R.check('3.5 a request without a currency is refused (no hidden SAR)', async () => {
      const r = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: body({ adminEmail: 'nocur@e2e.test', localCurrency: undefined }) });
      if (!r.json || r.json.success !== false || r.json.code !== 'INVALID_INPUT') throw new Error(r.text.slice(0, 200));
    });
    let B = null;
    await R.check('3.6 a second tenant (for isolation tests)', async () => {
      const r = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: body({ companyName: 'Other Co', adminEmail: 'owner2@e2e.test', localCurrency: 'USD', mainCurrency: '', country: 'US' }) });
      if (!r.json || !r.json.success) throw new Error(r.text.slice(0, 300));
      B = r.json;
      return `company ${B.companyId.slice(0, 8)}…`;
    });
    await R.check('3.6b a company creation that FAILS after the admin exists leaves no tenant, auth user, profile or role behind (live cleanup)', async () => {
      const counts = async () => (await pg(`SELECT (SELECT count(*) FROM tenants)::int t, (SELECT count(*) FROM auth.users)::int u, (SELECT count(*) FROM user_profiles)::int p, (SELECT count(*) FROM user_roles)::int r`)).rows[0];
      const before = await counts();
      await pg('REVOKE EXECUTE ON FUNCTION public.fn_provision_new_company(uuid, jsonb, text) FROM authenticated');
      let r;
      try { r = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: body({ companyName: 'Boom', adminEmail: 'boom@e2e.test' }) }); }
      finally { await pg('GRANT EXECUTE ON FUNCTION public.fn_provision_new_company(uuid, jsonb, text) TO authenticated'); }
      if (!r.json || r.json.success !== false || r.json.code !== 'COMPANY_FAILED') throw new Error(`expected COMPANY_FAILED, got ${r.text.slice(0, 200)}`);
      const after = await counts();
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`leftovers: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      const again = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: body({ companyName: 'Boom', adminEmail: 'boom@e2e.test', adminPassword: 'E2ePass#2026' }) });
      if (!again.json || !again.json.success) throw new Error(`the same email could not be used again after the failure: ${again.text.slice(0, 160)}`);
      return `refused cleanly (${JSON.stringify(after)} unchanged); the same email registers fine afterwards`;
    });
    await R.check('3.7 plan sync: subscription, plan and modules follow the license', async () => {
      const r = (await pg(`SELECT sp.code, ts.status, ts.trial_end_date::text tend, ts.end_date::text endd, (SELECT count(*)::int FROM tenant_modules tm WHERE tm.tenant_id=ts.tenant_id AND tm.is_active) mods,
                                  EXISTS (SELECT 1 FROM tenant_modules tm WHERE tm.tenant_id=ts.tenant_id AND tm.is_active AND tm.module_code='fabric') fabric,
                                  EXISTS (SELECT 1 FROM tenant_modules tm WHERE tm.tenant_id=ts.tenant_id AND tm.is_active AND tm.module_code='hr') hr
                             FROM tenant_subscriptions ts JOIN subscription_plans sp ON sp.id=ts.plan_id WHERE ts.tenant_id=$1`, [A.tenantId])).rows[0];
      if (!r.fabric) throw new Error('fabric module not active');
      if (LICENSE === 'trial') {
        if (r.code !== 'texa-professional' || r.status !== 'trial') throw new Error(`trial → ${r.code}/${r.status}`);
        const days = Math.round((new Date(r.tend) - new Date()) / 86400000);
        if (days < 12 || days > 14) throw new Error(`trial countdown ${days} days`);
        if (!r.hr) throw new Error('Professional modules missing');
        return `${r.code} ${r.status} until ${r.tend} (${days} days), ${r.mods} modules`;
      }
      if (r.code !== 'free' || r.status !== 'active') throw new Error(`free → ${r.code}/${r.status}`);
      return `${r.code} ${r.status}, ${r.mods} modules`;
    });

    await R.check('3.8 heartbeat: the active-modules query runs on the baseline schema (included_modules is text[]) and returns the plan\'s modules — the 2.0.0 text fails with 42883', async () => {
      const { ACTIVE_MODULES_SQL } = require('../../src/heartbeat-queries');
      const rows = (await pg(ACTIVE_MODULES_SQL)).rows;
      if (!rows.length) throw new Error('no active subscription row');
      const got = rows[0][Object.keys(rows[0])[0]];
      if (!Array.isArray(got)) throw new Error(`not a JSON array: ${JSON.stringify(got)}`);
      const want = (await pg(`SELECT COALESCE(array_agg(DISTINCT m ORDER BY m), '{}') AS mods FROM tenant_subscriptions ts JOIN subscription_plans sp ON sp.id=ts.plan_id, unnest(sp.included_modules) m
                               WHERE ts.status IN ('active','trial','grace') AND ts.updated_at = (SELECT max(updated_at) FROM tenant_subscriptions WHERE status IN ('active','trial','grace'))`)).rows[0].mods;
      if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`reported ${JSON.stringify(got)} but the plan holds ${JSON.stringify(want)}`);
      if (!got.length) throw new Error('the plan reports no modules at all');
      let old = 'ran';
      try { await pg(`SELECT jsonb_agg(DISTINCT m) FROM public.tenant_subscriptions ts JOIN public.subscription_plans sp ON sp.id=ts.plan_id, jsonb_array_elements_text(sp.included_modules) m LIMIT 1`); }
      catch (e) { old = e.code; }
      if (old !== '42883') throw new Error(`the pre-2.0.1 text was expected to fail with 42883 on this schema, got: ${old}`);
      return `${got.length} modules reported (${got.slice(0, 5).join(', ')}…) = the plan's included_modules; the old text fails with 42883 (function jsonb_array_elements_text(text[]) does not exist)`;
    });

    // ── 3.9 the module guards of the ERP's row-level policies / RPCs, on the plan rows the installer BUNDLES (this run is OFFLINE: no control panel to sync from) ──
    await R.check(`3.9 OFFLINE first run on the ${LICENSE} plan: the admin can read the chart of accounts, insert a customer, insert a fabric_materials row and post a manual journal entry (the bundled plan rows carry the modules the guards need)`, async () => {
      const hb = path.join(userData, 'logs', 'heartbeat.log');
      const logs = [logFile, hb].filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
      if (!/active plan synced: .*\(offline: last synced values\)/.test(logs)) throw new Error('this run is not offline (the plan was not taken from the bundled rows): ' + (logs.match(/\[Plan\][^\n]*/g) || []).slice(-2).join(' | '));
      const mods = (await pg(`SELECT array_agg(module_code ORDER BY module_code) m FROM tenant_modules WHERE tenant_id=$1 AND is_active AND is_enabled`, [A.tenantId])).rows[0].m || [];
      const need = ['accounting', 'sales', 'inventory', 'purchases', 'fabric'];
      // the PLAN ROW itself (not the always-on core modules that the bundled `modules` table adds to every tenant): it is what the control panel's row is replaced by online, and
      // what any database whose `modules` rows are not flagged core (production's) gets its modules from — so it must carry what the guards need
      const planMods = (await pg(`SELECT sp.code, sp.included_modules FROM tenant_subscriptions ts JOIN subscription_plans sp ON sp.id=ts.plan_id WHERE ts.tenant_id=$1 AND ts.status IN ('active','trial','grace') ORDER BY ts.created_at DESC LIMIT 1`, [A.tenantId])).rows[0];
      const planMissing = need.filter((m) => !(planMods.included_modules || []).includes(m));
      if (planMissing.length) throw new Error(`the bundled plan row "${planMods.code}" lacks ${planMissing.join(', ')} (it has: ${(planMods.included_modules || []).join(', ')})`);
      const missing = need.filter((m) => !mods.includes(m));
      if (missing.length) throw new Error(`tenant modules lack ${missing.join(', ')} (have: ${mods.join(', ')})`);
      const authA = { apikey: secrets.anonKey, Authorization: `Bearer ${A.accessToken}` };
      const inDb = (await pg('SELECT count(*)::int n FROM chart_of_accounts WHERE company_id=$1', [A.companyId])).rows[0].n;
      const chart = await request('GET', `${API}/rest/v1/chart_of_accounts?select=id&company_id=eq.${A.companyId}&limit=1000`, { headers: authA });
      if (chart.status !== 200) throw new Error(`chart read → ${chart.status} ${chart.text.slice(0, 200)}`);
      if (!inDb || chart.json.length !== Math.min(inDb, 1000)) throw new Error(`the admin sees ${chart.json.length} chart rows, the company has ${inDb}`);
      const colsOf = async (t) => (await pg(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [t])).rows.map((r) => r.column_name);
      const withCompany = async (t, row) => ((await colsOf(t)).includes('company_id') ? { ...row, company_id: A.companyId } : row);
      const cust = await request('POST', `${API}/rest/v1/customers`, { headers: { ...authA, Prefer: 'return=representation' }, body: await withCompany('customers', { tenant_id: A.tenantId, code: 'LC-CUST-1', name_ar: 'عميل فحص الإطلاق' }) });
      if (cust.status !== 201) throw new Error(`insert customer → ${cust.status} ${cust.text.slice(0, 240)}`);
      const mat = await request('POST', `${API}/rest/v1/fabric_materials`, { headers: { ...authA, Prefer: 'return=representation' }, body: await withCompany('fabric_materials', { tenant_id: A.tenantId, code: 'LC-MAT-1', name_ar: 'مادة فحص الإطلاق' }) });
      if (mat.status !== 201) throw new Error(`insert fabric_materials → ${mat.status} ${mat.text.slice(0, 240)}`);
      const leaf = (await pg(`SELECT id FROM chart_of_accounts WHERE company_id=$1 AND COALESCE(is_group,false)=false AND COALESCE(is_active,true) ORDER BY account_code LIMIT 2`, [A.companyId])).rows;
      if (leaf.length < 2) throw new Error(`the chart has ${leaf.length} postable accounts`);
      const je = await request('POST', `${API}/rest/v1/rpc/save_journal_entry_draft`, { headers: authA, body: { p_payload: {
        company_id: A.companyId, entry_date: new Date().toISOString().slice(0, 10), description: 'launch-check manual entry', post: true,
        lines: [{ account_id: leaf[0].id, debit: 100, credit: 0 }, { account_id: leaf[1].id, debit: 0, credit: 100 }] } } });
      if (je.status !== 200 || !je.json || je.json.success !== true) throw new Error(`manual journal entry → ${je.status} ${je.text.slice(0, 300)}`);
      const posted = (await pg('SELECT is_posted, status FROM journal_entries WHERE company_id=$1 AND description=$2', [A.companyId, 'launch-check manual entry'])).rows[0];
      if (!posted || posted.is_posted !== true) throw new Error(`the entry was not posted: ${JSON.stringify(posted)}`);
      return `offline plan sync (bundled rows); plan "${planMods.code}" carries ${need.join('/')} itself; tenant modules ${mods.length}; chart ${chart.json.length}/${inDb} rows visible; customer + fabric_materials inserted; manual journal entry posted`;
    });

    // ── 4. security ──
    const anon = { apikey: secrets.anonKey, Authorization: `Bearer ${secrets.anonKey}` };
    await R.check('4.1 anon cannot read any tenant data through the proxy (every public table)', async () => {
      const tables = (await pg(`SELECT c.relname, EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname IN ('tenant_id','company_id') AND NOT a.attisdropped) AS tenant_scoped
                                  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') ORDER BY 1`)).rows;
      const leaks = []; const publicReads = []; let denied = 0; let empty = 0;
      for (const t of tables) {
        for (const base of [API + '/rest/v1', `${UI}/_supabase/rest/v1`]) {
          const r = await request('GET', `${base}/${t.relname}?select=*&limit=1`, { headers: anon });
          if (r.status === 200 && Array.isArray(r.json) && r.json.length) {
            if (base === API + '/rest/v1') (t.tenant_scoped ? leaks : publicReads).push(t.relname);
            else if (t.tenant_scoped) leaks.push(`${t.relname} (via UI proxy)`);
          } else if (r.status >= 400) denied += 1; else empty += 1;
        }
      }
      if (leaks.length) throw new Error(`anon READ tenant-scoped rows: ${leaks.join(', ')}`);
      return `${tables.length} tables × 2 routes: ${denied} refused, ${empty} empty, anon-readable GLOBAL catalogs only: [${publicReads.join(', ')}]`;
    });
    await R.check('4.2 anon cannot modify/delete any existing row through the proxy; RLS denies anon INSERT on every tenant-scoped table', async () => {
      const tables = (await pg(`SELECT c.relname, EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname IN ('tenant_id','company_id') AND NOT a.attisdropped) AS tenant_scoped,
                                       EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='id' AND NOT a.attisdropped) AS has_id
                                  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY 1`)).rows;
      // (a) through the proxy: no PATCH/DELETE touches a row, no POST of {} is ever accepted
      const bad = [];
      for (const t of tables) {
        const h = { ...anon, Prefer: 'return=representation' };
        const filter = t.has_id ? 'id=not.is.null' : (t.tenant_scoped ? 'tenant_id=not.is.null' : null);
        if (filter) {
          const p = await request('PATCH', `${API}/rest/v1/${t.relname}?${filter}`, { headers: h, body: {} });
          if (p.status < 300 && Array.isArray(p.json) && p.json.length) bad.push(`PATCH ${t.relname} touched ${p.json.length}`);
          const d = await request('DELETE', `${API}/rest/v1/${t.relname}?${filter}`, { headers: h });
          if (d.status < 300 && Array.isArray(d.json) && d.json.length) bad.push(`DELETE ${t.relname} removed ${d.json.length}`);
        }
        const i = await request('POST', `${API}/rest/v1/${t.relname}`, { headers: { ...anon, Prefer: 'return=minimal' }, body: {} });
        if (i.status < 300) bad.push(`INSERT ${t.relname} accepted`);
      }
      if (bad.length) throw new Error(bad.join('; '));
      // (b) catalog-level proof, independent of guard triggers: PostgreSQL checks RLS WITH CHECK before any constraint, so with the
      //     tables' USER triggers disabled (inside a rolled-back transaction) an anon INSERT … DEFAULT VALUES fails with 42501 iff
      //     privileges/RLS deny it. Anything else means RLS let the row through.
      const c = new Client(pgOptions());
      await c.connect();
      const allowedGlobal = []; const holes = [];
      try {
        for (const t of tables) {
          if (!(await c.query(`SELECT has_table_privilege('anon', $1::regclass, 'INSERT') AS p`, [`public."${t.relname}"`])).rows[0].p) continue;
          await c.query('BEGIN');
          try {
            await c.query(`ALTER TABLE public."${t.relname}" DISABLE TRIGGER USER`);
            await c.query('SET LOCAL ROLE anon');
            await c.query('SAVEPOINT s');
            try {
              await c.query(`INSERT INTO public."${t.relname}" DEFAULT VALUES`);
              (t.tenant_scoped ? holes : allowedGlobal).push(`${t.relname}:inserted`);
            } catch (e) {
              if (e.code !== '42501') (t.tenant_scoped ? holes : allowedGlobal).push(`${t.relname}:${e.code}`);
            }
          } finally { await c.query('ROLLBACK'); }
        }
      } finally { await c.end(); }
      // Production's own public intake form: a storefront visitor can POST a contact message for a store (insert-only: anon has no
      // SELECT on it — proven by 4.1 — and cannot touch an existing row). Anything else tenant-scoped is a hole.
      const INTAKE = new Set(['storefront_contact_messages']);
      const intake = holes.filter((h) => INTAKE.has(h.split(':')[0]));
      const real = holes.filter((h) => !INTAKE.has(h.split(':')[0]));
      if (real.length) throw new Error(`RLS lets anon INSERT into tenant-scoped tables: ${real.join(', ')}`);
      return `0 rows modified/deleted/inserted via the proxy over ${tables.length} tables; anon INSERT denied by RLS/privilege on every tenant-scoped table except production's public intake [${intake.join(', ')}] (insert-only); other by-design public intake (global tables): [${allowedGlobal.join(', ')}]`;
    });
    await R.check('4.3 the shared 1.x anon key is worthless against this install', async () => {
      const r = await request('GET', `${API}/rest/v1/tenants?select=id`, { headers: { apikey: secretsMod.LEGACY.anonKey, Authorization: `Bearer ${secretsMod.LEGACY.anonKey}` } });
      if (r.status !== 401) throw new Error(`legacy key → ${r.status}`);
      const s = await request('GET', `${API}/rest/v1/tenants?select=id`, { headers: { apikey: secretsMod.LEGACY.serviceKey, Authorization: `Bearer ${secretsMod.LEGACY.serviceKey}` } });
      if (s.status !== 401) throw new Error(`legacy service key → ${s.status}`);
      return 'both 401';
    });
    await R.check('4.4 a logged-in admin sees only THEIR tenant (read, update, insert across tenants)', async () => {
      const authA = { apikey: secrets.anonKey, Authorization: `Bearer ${A.accessToken}` };
      const own = await request('GET', `${API}/rest/v1/companies?select=id,tenant_id`, { headers: authA });
      if (own.status !== 200 || !own.json.length || own.json.some((c) => c.tenant_id !== A.tenantId)) throw new Error(`companies: ${own.text.slice(0, 200)}`);
      const scoped = (await pg(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='tenant_id' AND NOT a.attisdropped)
                                   AND has_table_privilege('authenticated', c.oid, 'SELECT') ORDER BY 1`)).rows.map((r) => r.relname);
      const foreign = [];
      let checked = 0;
      for (const t of scoped) {
        const r = await request('GET', `${API}/rest/v1/${t}?select=tenant_id&tenant_id=eq.${B.tenantId}&limit=1`, { headers: authA });
        if (r.status === 200) { checked += 1; if (r.json.length) foreign.push(t); }
      }
      if (foreign.length) throw new Error(`tenant A reads tenant B rows in: ${foreign.join(', ')}`);
      const upd = await request('PATCH', `${API}/rest/v1/companies?id=eq.${B.companyId}`, { headers: { ...authA, Prefer: 'return=representation' }, body: { name: 'HACKED' } });
      if (upd.status < 300 && upd.json && upd.json.length) throw new Error('tenant A modified tenant B company');
      const ins = await request('POST', `${API}/rest/v1/branches`, { headers: { ...authA, Prefer: 'return=minimal' }, body: { tenant_id: B.tenantId, company_id: B.companyId, name: 'x', code: 'X1' } });
      if (ins.status < 300) throw new Error('tenant A inserted a branch into tenant B');
      const stillB = (await pg('SELECT name FROM companies WHERE id=$1', [B.companyId])).rows[0].name;
      if (stillB !== 'Other Co') throw new Error(`B's company name is now ${stillB}`);
      return `${checked} tenant-scoped tables read as A: 0 rows of tenant B; cross-tenant UPDATE/INSERT refused`;
    });
    await R.check('4.5 admin-portal gate: a FREE key is no default (locked), a paid/trial key is; "admin" refused; 5 wrong tries lock it', async () => {
      const verify = async (p) => (await request('POST', `${API}/rest/v1/rpc/verify_admin_password`, { headers: anon, body: { p_input: p } })).json;
      const key = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).licenseKey;
      const free = /^FREE/i.test(key);
      if (await verify('admin') !== false) throw new Error('"admin" accepted');
      let pw = key;
      if (free) {
        // a FREE key is not a secret ("FREE-LOCAL" is in the source; FREE-2026-NNNNN are short numbers shown in the launcher): there is NO default password, the portal is locked
        if (await verify(key) !== false) throw new Error('a FREE licence key opens the admin portal');
        pw = 'Correct#Horse9';
        await pg(`UPDATE platform_admin SET password_hash = extensions.crypt($1, extensions.gen_salt('bf')), failed_attempts = 0, locked_until = NULL`, [pw]);   // what ServiceManager.setAdminPassword stores
        if (await verify(pw) !== true) throw new Error('a password the manager set is not accepted');
      } else if (await verify(key) !== true) throw new Error('default (paid/trial license key) not accepted');
      for (let i = 0; i < 5; i++) await verify('wrong-' + i);
      if (await verify(pw) !== false) throw new Error('not locked after 5 failures');
      await pg('UPDATE platform_admin SET failed_attempts=0, locked_until=NULL');
      if (await verify(pw) !== true) throw new Error('did not recover after unlock');
      return free ? `free key ${key}: no default (locked); a manager-set password works; lock after 5 failures` : `key ${key} is the default; lock after 5 failures`;
    });
    await R.check('4.6 over the tunnel (a *.texacore.ai Host) the admin API is default-deny', async () => {
      const t = { Host: 'demo.texacore.ai', ...H };
      const companies = await request('GET', `${UI}/api/companies`, { headers: t });
      const create = await request('POST', `${UI}/api/create-local-company`, { headers: t, body: body({ adminEmail: 'x@tunnel.test' }) });
      const backup = await request('GET', `${UI}/api/backup-status`, { headers: t });
      const ping = await request('GET', `${UI}/api/ping`, { headers: { Host: 'demo.texacore.ai' } });
      if (companies.status !== 403 || create.status !== 403 || backup.status !== 403) throw new Error(`tunnel: companies ${companies.status} create ${create.status} backup ${backup.status}`);
      if (ping.status !== 200) throw new Error(`ping ${ping.status}`);
      const local = await request('GET', `${UI}/api/companies`, { headers: H });
      if (local.status !== 200) throw new Error(`same call locally (through the UI proxy, with the secret) → ${local.status}`);
      return 'tunnel: 403/403/403, /api/ping 200; local with secret 200';
    });

    await R.check('4.7 GoTrue: signup is off, and neither the anon key nor a plain user can reach its admin API', async () => {
      const signup = await request('POST', `${API}/auth/v1/signup`, { headers: anon, body: { email: 'stranger@evil.test', password: 'Passw0rd!stranger' } });
      if (signup.status < 400) throw new Error(`signup accepted (${signup.status})`);
      const exists = (await pg(`SELECT count(*)::int n FROM auth.users WHERE email='stranger@evil.test'`)).rows[0].n;
      if (exists) throw new Error('signup created a user');
      const asAnon = await request('GET', `${API}/auth/v1/admin/users`, { headers: anon });
      const asUser = await request('GET', `${API}/auth/v1/admin/users`, { headers: { apikey: secrets.anonKey, Authorization: `Bearer ${A.accessToken}` } });
      if (asAnon.status < 400 || asUser.status < 400) throw new Error(`admin users: anon ${asAnon.status}, user ${asUser.status}`);
      return `signup ${signup.status}, admin/users anon ${asAnon.status} / user ${asUser.status}`;
    });
    await R.check('4.8 listeners: PostgreSQL, PostgREST, GoTrue and the admin API are bound to 127.0.0.1 only', async () => {
      const out = require('child_process').execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8' });
      const lines = out.split('\n');
      const bad = []; const seen = [];
      for (const [name, port] of [['postgres', PORTS.pg], ['postgrest', PORTS.postgrest], ['gotrue', PORTS.gotrue], ['admin API', PORTS.admin]]) {
        const l = lines.filter((x) => new RegExp(`:${port} \\(LISTEN\\)`).test(x));
        if (!l.length) { bad.push(`${name}:${port} not listening`); continue; }
        for (const x of l) { if (!/(127\.0\.0\.1|\[::1\]|localhost):\d+ \(LISTEN\)/.test(x)) bad.push(`${name}:${port} → ${x.split(/\s+/).slice(-2, -1)[0]}`); }
        seen.push(`${name}:${port}`);
      }
      if (bad.length) throw new Error(bad.join('; '));
      return `loopback only: ${seen.join(', ')} (the web UI + API gateway are the two LAN-facing ports by design)`;
    });

    // ── 4.9–4.11 the LAN is a second open front: the UI server listens on 0.0.0.0 (office PCs open the ERP from it) ──
    const lanIp = Object.values(os.networkInterfaces()).flat().filter((i) => i && (i.family === 'IPv4' || i.family === 4) && !i.internal && !String(i.address).startsWith('169.254.'))
      .map((i) => i.address)[0] || '';
    const refusedTcp = (host, port) => new Promise((resolve) => {
      const sock = net.connect({ host, port, timeout: 3000 });
      sock.on('connect', () => { sock.destroy(); resolve(false); });
      sock.on('error', () => resolve(true));
      sock.on('timeout', () => { sock.destroy(); resolve(true); });
    });
    // one origin of requests the admin surface must refuse: [label, base URL to connect to, Host header to send (or '' for the natural one), extra headers]
    const remoteCases = [];
    if (lanIp) {
      remoteCases.push([`LAN client at ${lanIp} (natural Host)`, `http://${lanIp}:${PORTS.ui}`, '', {}]);
      // NB: a connection from THIS machine to its own LAN address with a forged `Host: 127.0.0.1` is NOT a remote client — the peer address is one of the machine's own
      // addresses, which only a program on this machine can have (net-guard rule 2; Windows shows a local program bound to the LAN address that way). A real LAN client
      // can't be simulated from one host, so the forged-Host remote shapes below are the ones a real remote peer can produce: a reverse proxy / tunnel naming the client.
    }
    remoteCases.push(['reverse proxy on this machine in front of a LAN client: Host: 127.0.0.1 + X-Forwarded-For naming the LAN client', UI, `127.0.0.1:${PORTS.ui}`, { 'x-forwarded-for': '192.168.77.20' }]);
    remoteCases.push(['reverse proxy with the standard Forwarded header naming a remote client, Host: localhost', UI, `localhost:${PORTS.ui}`, { forwarded: 'for=198.51.100.7;proto=https' }]);
    remoteCases.push(['loopback socket, LAN-style Host header (forged)', UI, `192.168.77.20:${PORTS.ui}`, {}]);
    remoteCases.push(['loopback socket, Host: localhost + tunnel headers (a tunnel whose origin settings rewrite Host)', UI, `localhost:${PORTS.ui}`, { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9', 'cf-ray': 'abc-FRA' }]);
    await R.check('4.9 LAN / forged-Host callers: never the admin secret in /config.js, 403 on every /api/* except ping, no raw API/admin ports on the LAN', async () => {
      const notes = [];
      for (const [label, base, host, extra] of remoteCases) {
        const hdr = { ...(host ? { Host: host } : {}), ...extra };
        for (const [variant, extraHdr] of [['curl (no Origin, no Sec-Fetch-Site)', {}], ['browser same-origin', { 'Sec-Fetch-Site': 'same-origin' }], ['browser, navigation', { 'Sec-Fetch-Site': 'none' }]]) {
          const cfg = await request('GET', `${base}/config.js`, { headers: { ...hdr, ...extraHdr } });
          if (cfg.status !== 200) throw new Error(`${label}: config.js → ${cfg.status}`);
          if (cfg.text.includes(secrets.localApiSecret) || /localApiSecret/.test(cfg.text)) throw new Error(`${label} / ${variant}: config.js handed out the admin secret`);
          if (!cfg.text.includes('/_supabase')) throw new Error(`${label} / ${variant}: config.js does not point the page at its own /_supabase proxy`);
          if (cfg.text.includes(secrets.serviceKey) || cfg.text.includes(secrets.jwtSecret) || cfg.text.includes(secrets.dbPassword)) throw new Error(`${label}: config.js leaks a server secret`);
        }
        for (const [method, p, bodyObj] of [['GET', '/api/companies'], ['GET', '/api/backup-status'], ['GET', '/api/tunnel-status'], ['POST', '/api/create-local-company', body({ adminEmail: 'x@lan.test' })],
          ['POST', '/api/delete-company', { companyId: '00000000-0000-0000-0000-000000000000' }], ['POST', '/api/backup', {}], ['POST', '/api/restore-tcdb', ''], ['POST', '/api/update/install', {}], ['GET', '/api/open-tcdb'],
          ['GET', `/api/employee-roles?companyId=${A.companyId}`], ['POST', '/api/invite-employee', { companyId: A.companyId, roleId: '00000000-0000-0000-0000-000000000000', email: 'x@lan.test', fullName: 'x' }]]) {
          const r = await request(method, `${base}${p}`, { headers: { ...hdr, ...H }, body: bodyObj });
          if (r.status !== 403) throw new Error(`${label}: ${method} ${p} WITH the admin secret → ${r.status} (want 403)`);
        }
        const ping = await request('GET', `${base}/api/ping`, { headers: hdr });
        if (ping.status !== 200) throw new Error(`${label}: /api/ping → ${ping.status}`);
        notes.push(label);
      }
      let rawNote = 'no LAN interface on this machine — the LAN-listener cases were exercised with forged Host headers only';
      if (lanIp) {
        for (const [name, port] of [['API gateway', PORTS.api], ['admin API', PORTS.admin], ['PostgREST', PORTS.postgrest], ['GoTrue', PORTS.gotrue], ['PostgreSQL', PORTS.pg]]) {
          if (!(await refusedTcp(lanIp, port))) throw new Error(`${name} (port ${port}) accepts connections on the LAN address ${lanIp}`);
        }
        const ui = await refusedTcp(lanIp, PORTS.ui);
        if (ui) throw new Error('the UI server is NOT reachable on the LAN address — office PCs could not use the ERP');
        rawNote = `LAN address ${lanIp}: UI port open; API gateway / admin / PostgREST / GoTrue / PostgreSQL ports refuse connections`;
      }
      return `${notes.length} caller shapes × 3 config.js variants (secret never served) × 11 admin calls (incl. the employee-invite routes) with the REAL secret (all 403), ping 200; ${rawNote}`;
    });
    await R.check('4.9b the same LAN PC still USES the ERP: anon sees nothing, the admin logs in through /_supabase and reads only their tenant under RLS', async () => {
      const base = lanIp ? `http://${lanIp}:${PORTS.ui}` : UI;
      const lanHdr = lanIp ? {} : { Host: `192.168.77.20:${PORTS.ui}` };
      const cfg = await request('GET', `${base}/config.js`, { headers: lanHdr });
      if (!cfg.text.includes(secrets.anonKey)) throw new Error('config.js lacks the public anon key');
      const anonRead = await request('GET', `${base}/_supabase/rest/v1/companies?select=id&limit=5`, { headers: { ...lanHdr, apikey: secrets.anonKey, Authorization: `Bearer ${secrets.anonKey}` } });
      if (anonRead.status === 200 && Array.isArray(anonRead.json) && anonRead.json.length) throw new Error('anon reads companies from the LAN');
      const login = await request('POST', `${base}/_supabase/auth/v1/token?grant_type=password`, { headers: { ...lanHdr, apikey: secrets.anonKey }, body: { email: 'owner@e2e.test', password: 'E2ePass#2026' } });
      if (login.status !== 200 || !login.json || !login.json.access_token) throw new Error(`LAN login → ${login.status} ${login.text.slice(0, 160)}`);
      const au = { ...lanHdr, apikey: secrets.anonKey, Authorization: `Bearer ${login.json.access_token}` };
      const own = await request('GET', `${base}/_supabase/rest/v1/companies?select=id,tenant_id`, { headers: au });
      if (own.status !== 200 || !own.json.length || own.json.some((c) => c.tenant_id !== A.tenantId)) throw new Error(`LAN admin reads companies: ${own.status} ${own.text.slice(0, 160)}`);
      const foreign = await request('GET', `${base}/_supabase/rest/v1/companies?select=id&tenant_id=eq.${B.tenantId}`, { headers: au });
      if (foreign.status === 200 && foreign.json.length) throw new Error('LAN admin of tenant A reads tenant B companies');
      const upd = await request('PATCH', `${base}/_supabase/rest/v1/companies?id=eq.${B.companyId}`, { headers: { ...au, Prefer: 'return=representation' }, body: { name: 'LAN-HACK' } });
      if (upd.status < 300 && upd.json && upd.json.length) throw new Error('LAN admin modified tenant B');
      const adminApi = await request('GET', `${base}/_supabase/auth/v1/admin/users`, { headers: au });
      if (adminApi.status < 400) throw new Error('LAN reached GoTrue admin');
      return `via ${lanIp || 'forged-Host loopback'}: anon sees 0 rows; admin logs in (200), reads ${own.json.length} own company(ies), 0 of tenant B, cross-tenant PATCH refused`;
    });
    await R.check('4.10 CORS: never "*"; a foreign website origin gets no allow-origin from any local server; loopback origins are reflected', async () => {
      const targets = [['API gateway', 'GET', `${API}/rest/v1/companies?select=id&limit=1`, anon], ['UI /_supabase', 'GET', `${UI}/_supabase/rest/v1/companies?select=id&limit=1`, anon],
        ['UI /api/ping', 'GET', `${UI}/api/ping`, {}], ['admin API ping', 'GET', `${ADMIN}/api/ping`, {}], ['UI /config.js (a <script src>, never needs CORS)', 'GET', `${UI}/config.js`, {}, false]];
      for (const [name, method, url, base, reflect = true] of targets) {
        for (const origin of ['https://evil.example', 'http://192.168.1.50:47395', 'null', 'http://localhost.evil.example']) {
          for (const m of [method, 'OPTIONS']) {
            const r = await request(m, url, { headers: { ...base, Origin: origin, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'apikey' } });
            const acao = r.headers['access-control-allow-origin'];
            if (acao !== undefined) throw new Error(`${name} ${m} with Origin ${origin} → Access-Control-Allow-Origin: ${acao}`);
          }
        }
        const ok = await request(method, url, { headers: { ...base, Origin: `http://localhost:${PORTS.ui}` } });
        if (reflect && ok.headers['access-control-allow-origin'] !== `http://localhost:${PORTS.ui}`) throw new Error(`${name}: a loopback origin is not reflected (${ok.headers['access-control-allow-origin']})`);
        if (ok.headers['access-control-allow-origin'] === '*') throw new Error(`${name}: wildcard CORS`);
      }
      return `${targets.length} servers × 4 foreign origins × (GET + preflight): no Access-Control-Allow-Origin; loopback origin reflected, never "*"`;
    });
    await R.check('4.11 restore-tcdb: path traversal / absolute / bad-magic uploads are refused BEFORE anything is written', async () => {
      const restoreDir = path.join(WORK, 'restore-tcdb');
      const tag = 'rel200-probe-' + crypto.randomBytes(4).toString('hex');
      const tcdbLike = 'TCDB\x02' + '\x00'.repeat(220);
      const mp = (filename, content) => {
        const b = '----rel200' + crypto.randomBytes(6).toString('hex');
        return { b, text: `--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n${content}\r\n--${b}--\r\n` };
      };
      // where each hostile name WOULD land if it escaped restoreDir (and a clean-name file in the dir)
      const wouldBe = [path.join(WORK, `${tag}-a.tcdb`), path.join(path.dirname(WORK), `${tag}-b.tcdb`), path.join(WORK, `${tag}-c.tcdb`), path.join(WORK, `${tag}-abs.tcdb`)];
      const attempts = [
        [`../../${tag}-a.tcdb`, tcdbLike, 'invalid file name'],
        [`..\\..\\${tag}-b.tcdb`, tcdbLike, 'invalid file name'],
        [`../${tag}-c.tcdb`, tcdbLike, 'invalid file name'],
        [path.join(WORK, `${tag}-abs.tcdb`), tcdbLike, 'invalid file name'],
        [`C:\\${tag}.tcdb`, tcdbLike, 'invalid file name'],
        [`${tag}.tcdb\u0000.png`, tcdbLike, 'invalid file name'],
        [`.hidden-${tag}.tcdb`, tcdbLike, 'invalid file name'],
        [`${tag}.sh`, tcdbLike, 'invalid file name'],
        [`${tag}-clean.tcdb`, 'this is not a TexaCore backup, just text'.padEnd(300, 'x'), 'not a texacore backup'],
        [`${tag}-short.tcdb`, 'TCDB\x02', 'not a texacore backup'],
      ];
      for (const [name, content, want] of attempts) {
        const { b, text } = mp(name, content);
        const r = await request('POST', `${UI}/api/restore-tcdb`, { headers: { ...H, 'Content-Type': `multipart/form-data; boundary=${b}` }, body: text });
        if (r.status !== 400 || !String(r.text).toLowerCase().includes(want)) throw new Error(`upload "${JSON.stringify(name)}" → ${r.status} ${r.text.slice(0, 120)} (want 400 "${want}")`);
      }
      const leaked = wouldBe.filter((f) => fs.existsSync(f));
      const inDir = fs.existsSync(restoreDir) ? fs.readdirSync(restoreDir) : [];
      if (leaked.length) throw new Error(`files escaped the folder: ${leaked.join(', ')}`);
      if (inDir.length) throw new Error(`refused uploads left files in the restore folder: ${inDir.join(', ')}`);
      // an oversize / wrong-method / secret-less call is also refused
      const noSecret = await request('POST', `${UI}/api/restore-tcdb`, { headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body: '--x--' });
      if (noSecret.status !== 401) throw new Error(`restore-tcdb without the secret → ${noSecret.status}`);
      // the other caller-chosen file name: create-local-company's dbFileName must be a plain name (refused before any tenant/user is created)
      const before = (await pg('SELECT (SELECT count(*) FROM public.tenants)::int t, (SELECT count(*) FROM auth.users)::int u')).rows[0];
      for (const bad of [`../../${tag}-db`, `..\\..\\${tag}-db`, `/tmp/${tag}-db`, `a/b-${tag}`]) {
        const r = await request('POST', `${UI}/api/create-local-company`, { headers: H, body: body({ adminEmail: `traversal-${crypto.randomBytes(3).toString('hex')}@e2e.test`, dbFileName: bad }) });
        if (!(r.json && r.json.success === false && r.json.code === 'INVALID_FILE_NAME')) throw new Error(`create-local-company with dbFileName ${JSON.stringify(bad)} → ${r.status} ${r.text.slice(0, 160)}`);
      }
      const after = (await pg('SELECT (SELECT count(*) FROM public.tenants)::int t, (SELECT count(*) FROM auth.users)::int u')).rows[0];
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`a refused company creation left rows behind: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      return `${attempts.length} hostile uploads → 400 each; nothing written anywhere (checked ${wouldBe.length} escape targets + the restore folder); without the secret → 401; 4 hostile dbFileName values refused before any write`;
    });

    await R.check('4.12 local employee invite: server-side account, one-time password, plan max_users respected, the employee uses the ERP from the LAN and sees only their company', async () => {
      const roles = await request('GET', `${UI}/api/employee-roles?companyId=${A.companyId}`, { headers: H });
      if (roles.status !== 200 || !roles.json.success || !roles.json.roles.length) throw new Error(`employee-roles → ${roles.status} ${roles.text.slice(0, 160)}`);
      const role = roles.json.roles.find((r) => !/owner|admin/i.test(r.code)) || roles.json.roles[0];
      if (roles.json.roles.some((r) => /^(platform|super)/i.test(r.code))) throw new Error(`the owner is offered a platform/super role: ${roles.json.roles.map((r) => r.code).join(',')}`);
      const counts = async () => (await pg('SELECT (SELECT count(*) FROM auth.users)::int u, (SELECT count(*) FROM public.user_profiles)::int p, (SELECT count(*) FROM public.tenant_users)::int tu, (SELECT count(*) FROM public.company_membership_requests)::int req')).rows[0];
      const emp = { companyId: A.companyId, roleId: role.id, email: 'staff1@e2e.test', fullName: 'Staff One' };
      if (LICENSE === 'free') {
        // the free plan has 1 user (the owner): the second one is refused BEFORE anything is created
        const before = await counts();
        const r = await request('POST', `${UI}/api/invite-employee`, { headers: H, body: emp });
        if (r.status !== 402 || r.json.code !== 'PLAN_LIMIT_EXCEEDED' || !/users \(1\/1\)/.test(r.json.error)) throw new Error(`free plan invite → ${r.status} ${r.text.slice(0, 200)}`);
        if (JSON.stringify(await counts()) !== JSON.stringify(before)) throw new Error('a refused invite left rows behind');
        return `free plan (1 user): refused with "${r.json.error}", nothing created; roles offered: ${roles.json.roles.map((x) => x.code).join(', ')}`;
      }
      const planMax = (await pg(`SELECT sp.id, sp.max_users FROM public.tenant_subscriptions ts JOIN public.subscription_plans sp ON sp.id = ts.plan_id WHERE ts.tenant_id = $1 AND ts.status IN ('trial','active') ORDER BY ts.created_at DESC LIMIT 1`, [A.tenantId])).rows[0];
      const ok = await request('POST', `${UI}/api/invite-employee`, { headers: H, body: emp });
      if (ok.status !== 200 || !ok.json.success || !ok.json.oneTimePassword) throw new Error(`invite → ${ok.status} ${ok.text.slice(0, 240)}`);
      const otp = ok.json.oneTimePassword;
      if (!/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(otp)) throw new Error(`odd one-time password shape`);
      // the password is shown once and never written to a log
      for (const f of [logFile, path.join(userData, 'logs', 'heartbeat.log')]) if (fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes(otp)) throw new Error(`the one-time password is in ${path.basename(f)}`);
      // server-side facts
      const prof = (await pg(`SELECT up.tenant_id, up.company_id, up.is_tenant_admin, up.is_active FROM public.user_profiles up WHERE up.id = $1`, [ok.json.userId])).rows[0];
      const mem = (await pg(`SELECT (SELECT count(*) FROM public.tenant_users WHERE user_id=$1 AND tenant_id=$2 AND is_active)::int tu, (SELECT count(*) FROM public.user_roles WHERE user_id=$1 AND role_id=$3 AND is_active)::int ur,
                                    (SELECT status FROM public.company_membership_requests WHERE email=$4 ORDER BY created_at DESC LIMIT 1) req`, [ok.json.userId, A.tenantId, role.id, emp.email])).rows[0];
      if (!prof || prof.tenant_id !== A.tenantId || prof.is_tenant_admin !== false || prof.is_active !== true) throw new Error(`profile ${JSON.stringify(prof)}`);
      if (mem.tu !== 1 || mem.ur < 1 || mem.req !== 'accepted') throw new Error(`membership ${JSON.stringify(mem)}`);
      // the employee works from the LAN address (anon key + RLS through /_supabase, no admin secret anywhere)
      const base = lanIp ? `http://${lanIp}:${PORTS.ui}` : UI;
      const lanHdr = lanIp ? {} : { Host: `192.168.77.20:${PORTS.ui}` };
      const login = await request('POST', `${base}/_supabase/auth/v1/token?grant_type=password`, { headers: { ...lanHdr, apikey: secrets.anonKey }, body: { email: emp.email, password: otp } });
      if (login.status !== 200 || !login.json.access_token) throw new Error(`employee LAN login → ${login.status} ${login.text.slice(0, 160)}`);
      const eh = { ...lanHdr, apikey: secrets.anonKey, Authorization: `Bearer ${login.json.access_token}` };
      const cos = await request('GET', `${base}/_supabase/rest/v1/companies?select=id,tenant_id`, { headers: eh });
      if (cos.status !== 200 || cos.json.length !== 1 || cos.json[0].id !== A.companyId) throw new Error(`employee sees companies ${cos.text.slice(0, 200)}`);
      const other = await request('GET', `${base}/_supabase/rest/v1/companies?select=id&id=eq.${B.companyId}`, { headers: eh });
      if (other.status === 200 && other.json.length) throw new Error('the employee sees tenant B');
      const upd = await request('PATCH', `${base}/_supabase/rest/v1/companies?id=eq.${B.companyId}`, { headers: { ...eh, Prefer: 'return=representation' }, body: { name: 'EMP-HACK' } });
      if (upd.status < 300 && upd.json && upd.json.length) throw new Error('the employee modified tenant B');
      const adm = await request('GET', `${base}/api/companies`, { headers: lanHdr });
      if (adm.status !== 403) throw new Error(`employee LAN /api/companies → ${adm.status}`);
      const gadmin = await request('GET', `${base}/_supabase/auth/v1/admin/users`, { headers: eh });
      if (gadmin.status < 400) throw new Error('the employee reached the GoTrue admin API');
      const su = await request('POST', `${base}/_supabase/auth/v1/signup`, { headers: { ...lanHdr, apikey: secrets.anonKey }, body: { email: 'stranger2@evil.test', password: 'Passw0rd!stranger' } });
      if (su.status < 400) throw new Error('signup is open');
      // duplicate → EMAIL_EXISTS, nothing written
      const before = await counts();
      const dup = await request('POST', `${UI}/api/invite-employee`, { headers: H, body: emp });
      if (dup.status !== 409 || dup.json.code !== 'EMAIL_EXISTS' || JSON.stringify(await counts()) !== JSON.stringify(before)) throw new Error(`duplicate invite → ${dup.status} ${dup.text.slice(0, 160)}`);
      // the plan's max_users is respected on a PAID plan too (the database trigger only enforces the free plan): owner + employee = 2 → cap at 2
      await pgConfirmedPlan(planMax.id, 'UPDATE public.subscription_plans SET max_users = 2 WHERE id = $1', [planMax.id]);
      let limited;
      try { limited = await request('POST', `${UI}/api/invite-employee`, { headers: H, body: { ...emp, email: 'staff2@e2e.test', fullName: 'Staff Two' } }); }
      finally { await pgConfirmedPlan(planMax.id, 'UPDATE public.subscription_plans SET max_users = $2 WHERE id = $1', [planMax.id, planMax.max_users]); }
      if (limited.status !== 402 || limited.json.code !== 'PLAN_LIMIT_EXCEEDED' || !/users \(2\/2\)/.test(limited.json.error)) throw new Error(`user limit → ${limited.status} ${limited.text.slice(0, 200)}`);
      if (JSON.stringify(await counts()) !== JSON.stringify(before)) throw new Error('the refused (limit) invite left rows behind');
      return `${emp.email} added as ${role.code} (profile in the tenant, not an admin, tenant_users+role+accepted request), one-time password not in any log; from ${lanIp || 'LAN-style Host'}: logs in, sees 1 company (own) and nothing of tenant B, admin API 403, signup refused; duplicate → 409 EMAIL_EXISTS; paid-plan max_users 2/2 → 402 PLAN_LIMIT_EXCEEDED, nothing created`;
    });

    // ── 5. the web UI ──
    await R.check('5.1 the web bundle is served: the installer\'s version, every asset 200 with a script/style type, local fonts, no Google Fonts', async () => {
      const idx = await request('GET', `${UI}/`);
      if (idx.status !== 200) throw new Error(`/ → ${idx.status}`);
      const WANT = require('../../package.json').version;
      if (!new RegExp(`name="texacore-app-version" content="${WANT.replace(/\./g, '\\.')}"`).test(idx.text)) throw new Error(`index.html lacks the ${WANT} stamp`);
      if (/fonts\.(googleapis|gstatic)\.com/.test(idx.text)) throw new Error('index.html loads Google Fonts');
      const refs = [...idx.text.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css|woff2))"/g)].map((m) => m[1]);
      let n = 0;
      for (const ref of refs) {
        const r = await request('GET', `${UI}${ref}`);
        const ct = String(r.headers['content-type'] || '');
        if (r.status !== 200 || /text\/html/.test(ct)) throw new Error(`${ref} → ${r.status} ${ct}`);
        n += 1;
      }
      const fonts = await request('GET', `${UI}/fonts/fonts.css`);
      const w2 = /url\(\.\/([^)]+\.woff2)\)/.exec(fonts.text);
      const font = await request('GET', `${UI}/fonts/${w2[1]}`);
      if (fonts.status !== 200 || font.status !== 200 || !/font|octet/.test(String(font.headers['content-type']))) throw new Error('local fonts not served');
      return `${n} referenced assets ok, fonts.css + ${w2[1]} served`;
    });
    if (ERP) {
      await R.check('5.2 browser: the page loads, the company is listed, the admin logs in and reaches the dashboard', async () => {
        const out = require('child_process').spawnSync('node', [path.join(__dirname, 'browser-login.cjs'), '--erp', ERP, '--ui', UI, '--email', 'owner@e2e.test', '--password', 'E2ePass#2026', '--shots', path.join(WORK, 'shots')], { encoding: 'utf8', timeout: 240000 });
        if (out.status !== 0) throw new Error(`${out.stdout}\n${out.stderr}`.trim().slice(-900));
        return out.stdout.trim().split('\n').slice(-1)[0];
      });
      // A PC in the office opens the ERP at the machine's LAN address: the page points at its own /_supabase proxy, gets no admin secret,
      // picks its company with the employee link (/login?c=<code> — the company picker needs the admin API, which is local-only) and logs in.
      await R.check('5.3 browser from the LAN address: the ERP loads, the employee link selects the company, the admin logs in and reaches the dashboard', async () => {
        const base = lanIp ? `http://${lanIp}:${PORTS.ui}` : UI;
        const code = String(A.companyId).split('-')[0];
        const out = require('child_process').spawnSync('node', [path.join(__dirname, 'browser-login.cjs'), '--erp', ERP, '--ui', base, '--code', code, '--email', 'owner@e2e.test', '--password', 'E2ePass#2026', '--shots', path.join(WORK, 'shots-lan')], { encoding: 'utf8', timeout: 240000 });
        if (out.status !== 0) throw new Error(`${out.stdout}\n${out.stderr}`.trim().slice(-900));
        return `${lanIp ? 'via ' + lanIp : 'loopback (no LAN interface)'}; ${out.stdout.trim().split('\n').slice(-1)[0].replace(/ \(screenshots:.*$/, '')}`;
      });
    } else console.log('  SKIP  5.2 browser login (no --erp given: Playwright lives in the ERP checkout)');

    // ── 6. Rashid import ──
    if (RSF && ERP) {
      await R.check('6.1 Rashid import into a NEW company (real importer, real REST gateway, as the admin)', async () => {
        const out = require('child_process').spawnSync('node', ['--import', 'tsx', '--import', path.join(__dirname, 'rsf-register.mjs'), path.join(__dirname, 'rsf-import.mts')],
          { encoding: 'utf8', timeout: 1500000, cwd: ERP, env: { ...process.env, WT_SRC: path.join(ERP, 'src'), ERP_DIR: ERP, RSF, UI_URL: UI, API_URL: API, ADMIN_URL: ADMIN, ADMIN_SECRET: secrets.localApiSecret,
            ANON_KEY: secrets.anonKey, OUT: path.join(WORK, 'rsf'), PG_PORT: String(PORTS.pg), PG_PASSWORD: secrets.dbPassword } });
        fs.mkdirSync(path.join(WORK, 'rsf'), { recursive: true });
        fs.writeFileSync(path.join(WORK, 'rsf', 'stdout.txt'), out.stdout || '');
        fs.writeFileSync(path.join(WORK, 'rsf', 'stderr.txt'), out.stderr || '');
        if (out.status !== 0) throw new Error(`${(out.stdout || '').slice(-700)}\n${(out.stderr || '').slice(-500)}`);
        return (out.stdout || '').trim().split('\n').slice(-1)[0];
      });
    } else console.log('  SKIP  6.1 Rashid import (pass --rsf <file> and --erp <ERP checkout>)');

    // ── 7. company files (2.0.2): where a company's .tcdb lives, that the user can SEE it stay in step, the one-off export, a protected file ──
    // The native windows are answered through the harness route (POST /api/e2e-dialog, isolated runs only); everything else is the real server.
    {
      const http = require('http');
      const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
      const rawRequest = (method, url, { headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, agent: false, headers: { ...headers, ...(body ? { 'Content-Length': body.length } : {}) } }, (res) => {
          const chunks = []; res.on('data', (c) => chunks.push(c));
          res.on('end', () => { const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* binary */ } resolve({ status: res.statusCode, headers: res.headers, buf, json }); });
        });
        req.on('error', reject); if (body) req.write(body); req.end();
      });
      const multipart = (file, filename, fields = {}) => {
        const b = '----rel202' + crypto.randomBytes(6).toString('hex');
        const parts = [];
        for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
        parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file, Buffer.from(`\r\n--${b}--\r\n`));
        return { ct: `multipart/form-data; boundary=${b}`, body: Buffer.concat(parts) };
      };
      const api = (method, p, body, extra = {}) => request(method, `${ADMIN}${p}`, { headers: { ...H, ...extra }, body });
      const dialog = (o) => api('POST', '/api/e2e-dialog', o);
      const status = async () => (await api('GET', '/api/backup-status')).json;
      const waitFor = async (pred, what, ms = 90000) => { const t0 = Date.now(); for (;;) { const v = await pred(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 700)); } };
      const rashidDir = path.join(WORK, 'rashid-folder');
      fs.mkdirSync(rashidDir, { recursive: true });
      const rsfFile = path.join(rashidDir, 'شركة الرشيد.rsf');
      const rsfBytes = crypto.randomBytes(300000);
      fs.writeFileSync(rsfFile, rsfBytes);   // the installer no longer parses .rsf (the ERP wizard does) - it only has to know WHERE the file is and hand out its bytes
      const copyDir = path.join(userData, 'texacore-data', 'backups');
      let pick1 = null; let created1 = null; let created2 = null;

      await R.check('7.1 the app opens the native window and knows the real path: a reference + the folder, the bytes are served (identical), a made-up reference is refused', async () => {
        await dialog({ open: rsfFile });
        const r = await api('POST', '/api/pick-company-file', {});
        if (!r.json || !r.json.success) throw new Error(`pick → ${r.status} ${r.text.slice(0, 200)}`);
        pick1 = r.json;
        if (pick1.type !== 'rsf' || !/^[0-9a-f]{32}$/.test(pick1.ref) || pick1.dir !== rashidDir || pick1.filePath !== rsfFile) throw new Error(`unexpected pick ${JSON.stringify(pick1)}`);
        if (pick1.companyFilePath !== path.join(rashidDir, 'شركة الرشيد.tcdb')) throw new Error(`companyFilePath ${pick1.companyFilePath}`);
        const bytes = await rawRequest('GET', `${ADMIN}/api/picked-file?ref=${pick1.ref}`, { headers: H });
        if (bytes.status !== 200 || sha(bytes.buf) !== sha(rsfBytes)) throw new Error(`the served bytes differ (${bytes.status}, ${bytes.buf.length} bytes)`);
        if (decodeURIComponent(bytes.headers['x-texacore-file-name']) !== 'شركة الرشيد.rsf') throw new Error('file name header');
        const bad = await api('GET', `/api/picked-file?ref=${'0'.repeat(32)}`);
        if (bad.status !== 404 || bad.json.code !== 'PICK_EXPIRED') throw new Error(`unknown ref → ${bad.status} ${bad.text.slice(0, 100)}`);
        const path_ = await api('GET', `/api/picked-file?ref=${encodeURIComponent(rsfFile)}`);
        if (path_.status === 200) throw new Error('a PATH was accepted where only a reference is allowed');
        await dialog({ open: null });
        const cancelled = await api('POST', '/api/pick-company-file', {});
        if (!cancelled.json || cancelled.json.canceled !== true) throw new Error('a cancelled window is not reported as canceled');
        return `ref ${pick1.ref.slice(0, 8)}…, folder ${pick1.dir}, ${bytes.buf.length} bytes served identical`;
      });

      await R.check('7.1b the picker and its siblings are guarded like the rest of the admin API: secret needed, foreign Origin refused, not from a LAN Host', async () => {
        for (const [m, p_] of [['POST', '/api/pick-company-file'], ['POST', '/api/export-backup'], ['POST', '/api/reveal-in-folder'], ['POST', '/api/pick-save-location'], ['GET', '/api/picked-file?ref=' + '0'.repeat(32)], ['GET', '/api/backup-export-info']]) {
          const noSecret = await request(m, `${ADMIN}${p_}`, { body: m === 'POST' ? {} : undefined });
          if (noSecret.status !== 401) throw new Error(`${p_} without the secret → ${noSecret.status}`);
          const lan = await request(m, `${ADMIN}${p_}`, { headers: { ...H, Host: '192.168.77.20:80' }, body: m === 'POST' ? {} : undefined });
          if (lan.status !== 403) throw new Error(`${p_} with a LAN Host → ${lan.status}`);
        }
        for (const p_ of ['/api/pick-company-file', '/api/export-backup', '/api/reveal-in-folder', '/api/pick-save-location']) {
          const foreign = await request('POST', `${ADMIN}${p_}`, { headers: { ...H, Origin: 'https://evil.example' }, body: {} });
          if (foreign.status !== 403) throw new Error(`${p_} from a foreign Origin → ${foreign.status}`);
        }
        return 'no secret → 401, LAN Host → 403, foreign Origin → 403 on every new route';
      });

      await R.check('7.2 a company made from the Rashid file: its .tcdb is BESIDE the .rsf (<rsf name>.tcdb) AND a second copy sits in the program\'s own backup folder; both are written', async () => {
        await dialog({ open: rsfFile });
        pick1 = (await api('POST', '/api/pick-company-file', {})).json;
        const r = await api('POST', '/api/create-local-company', body({ adminEmail: 'rashid-beside@e2e.test', companyName: 'شركة الرشيد', storagePath: undefined, dbFileName: undefined, purpose: 'rsf_import', rsfSourceRef: pick1.ref }));
        if (!r.json || !r.json.success) throw new Error(`create → ${r.text.slice(0, 300)}`);
        created1 = r.json;
        const want = path.join(rashidDir, 'شركة الرشيد.tcdb');
        if (created1.tcdbPath !== want || created1.tcdbPlacement !== 'beside-rsf') throw new Error(`tcdb ${created1.tcdbPath} (${created1.tcdbPlacement}), wanted ${want}`);
        const wantCopy = path.join(copyDir, 'شركة الرشيد.tcdb');
        if (created1.tcdbCopyPath !== wantCopy) throw new Error(`copy ${created1.tcdbCopyPath}, wanted ${wantCopy}`);
        const st = await waitFor(async () => { const s_ = await status(); return s_.targets && s_.targets.length === 2 && s_.targets.every((t) => t.state === 'ok') ? s_ : null; }, 'both targets to be written');
        for (const f of [want, wantCopy]) {
          const b = fs.readFileSync(f);
          if (b.subarray(0, 4).toString('latin1') !== 'TCDB' || b.length < 100000) throw new Error(`${f} is not a company file (${b.length} bytes)`);
        }
        if (!fs.readFileSync(want).equals(fs.readFileSync(wantCopy))) throw new Error('the two copies differ');
        if (!fs.existsSync(rsfFile) || !fs.readFileSync(rsfFile).equals(rsfBytes)) throw new Error('the Rashid file itself was touched');
        // the reference is single-use for creation: it is gone
        const again = await api('GET', `/api/picked-file?ref=${pick1.ref}`);
        if (again.status !== 404) throw new Error(`the used reference still reads (${again.status})`);
        const cfg = JSON.parse(fs.readFileSync(path.join(userData, 'texacore-data', 'config.json'), 'utf8'));
        if (cfg.companies[0].tcdbPath !== want || cfg.companies[0].copyPath !== wantCopy) throw new Error(`config.json: ${JSON.stringify(cfg.companies[0])}`);
        return `${want} + ${wantCopy}; targets ${st.targets.map((t) => t.role + ':' + t.state).join(', ')}`;
      });

      await R.check('7.3 the user can SEE the sync: each target\'s path, last successful sync, state; "sync now" refreshes both; the old fields of /api/backup-status are intact', async () => {
        const s0 = await status();
        for (const k of ['initialized', 'syncing', 'running', 'lastBackup', 'backupCount', 'backupPath']) if (!(k in s0)) throw new Error(`the existing field ${k} is gone`);
        if (s0.state !== 'ok' || s0.consecutiveFailures !== 0 || s0.lastError !== null) throw new Error(`state ${s0.state}`);
        const before = s0.targets.map((t) => Date.parse(t.lastSuccess));
        await new Promise((r) => setTimeout(r, 1200));
        const sync = await api('POST', '/api/backup', {});
        if (!sync.json || !sync.json.success || sync.json.skipped || !sync.json.targets || sync.json.targets.length !== 2) throw new Error(`sync now → ${sync.text.slice(0, 200)}`);
        const s1 = await status();
        s1.targets.forEach((t, i) => { if (!(Date.parse(t.lastSuccess) > before[i])) throw new Error(`${t.role}: lastSuccess did not move`); if (t.state !== 'ok' || !t.exists || !(t.size > 100000)) throw new Error(`${t.role}: ${t.state}`); });
        return s1.targets.map((t) => `${t.role} ${t.path.split(path.sep).slice(-2).join('/')} ok @ ${t.lastSuccess}`).join('; ');
      });

      await R.check('7.4 the Rashid folder disappears: the failure is VISIBLE with its reason (folder missing), repeats count up, nothing is re-created behind the user\'s back; it recovers when the folder is back', async () => {
        const gone = rashidDir + '.gone';
        fs.renameSync(rashidDir, gone);
        try {
          await api('POST', '/api/backup', {}); await api('POST', '/api/backup', {});
          const s_ = await status();
          if (s_.state !== 'error' || s_.consecutiveFailures < 2 || !s_.lastError || s_.lastError.reason !== 'folder-missing') throw new Error(`status ${JSON.stringify({ state: s_.state, n: s_.consecutiveFailures, e: s_.lastError })}`);
          const prim = s_.targets.find((t) => t.role === 'primary');
          if (prim.state !== 'error' || prim.exists !== false) throw new Error('the primary row does not show the failure');
          if (fs.existsSync(rashidDir)) throw new Error('the missing folder was silently re-created');
          const cp = s_.targets.find((t) => t.role === 'copy');
          if (!cp || !cp.exists) throw new Error('the program\'s own copy vanished with the folder');
        } finally { fs.renameSync(gone, rashidDir); }
        await api('POST', '/api/backup', {});
        const ok = await status();
        if (ok.state !== 'ok' || ok.consecutiveFailures !== 0) throw new Error(`did not recover: ${ok.state}`);
        return 'error(folder-missing) ×2 → ok after the folder came back';
      });

      await R.check('7.5 a second company from a Rashid file of the same name: " (2)", the first company\'s file is never replaced', async () => {
        const first = fs.readFileSync(path.join(rashidDir, 'شركة الرشيد.tcdb'));
        await dialog({ open: rsfFile });
        const p2 = (await api('POST', '/api/pick-company-file', {})).json;
        if (p2.companyFilePath !== path.join(rashidDir, 'شركة الرشيد (2).tcdb')) throw new Error(`planned ${p2.companyFilePath}`);
        const r = await api('POST', '/api/create-local-company', body({ adminEmail: 'rashid-beside2@e2e.test', companyName: 'شركة الرشيد 2', storagePath: undefined, dbFileName: undefined, purpose: 'rsf_import', rsfSourceRef: p2.ref }));
        if (!r.json || !r.json.success) throw new Error(`create → ${r.text.slice(0, 300)}`);
        created2 = r.json;
        if (created2.tcdbPath !== path.join(rashidDir, 'شركة الرشيد (2).tcdb')) throw new Error(`tcdb ${created2.tcdbPath}`);
        if (created2.tcdbCopyPath !== path.join(copyDir, 'شركة الرشيد (2).tcdb')) throw new Error(`copy ${created2.tcdbCopyPath}`);
        await waitFor(async () => { const s_ = await status(); return s_.backupPath === created2.tcdbPath && s_.targets.length === 2 && s_.targets.every((t) => t.state === 'ok'); }, 'the second company\'s targets');
        const now = fs.readFileSync(path.join(rashidDir, 'شركة الرشيد.tcdb'));
        if (now.subarray(0, 4).toString('latin1') !== 'TCDB' || now.length < first.length * 0.5) throw new Error('the first company\'s file was replaced by something else');
        // the by-hand path never replaces a file either: asking for the same folder + name again gives "(2)"
        const manual = await api('POST', '/api/create-local-company', body({ adminEmail: 'by-hand@e2e.test', companyName: 'By hand', storagePath: rashidDir, dbFileName: 'شركة الرشيد' }));
        if (!manual.json || !manual.json.success) throw new Error(`by-hand create → ${manual.text.slice(0, 300)}`);
        if (manual.json.tcdbPath !== path.join(rashidDir, 'شركة الرشيد (3).tcdb') || manual.json.tcdbCopyPath) throw new Error(`by-hand ${manual.json.tcdbPath} copy=${manual.json.tcdbCopyPath} (a by-hand company has ONE file)`);
        return 'beside: (2); by hand: (3), one file only';
      });

      let protectedExport = null; let counts0 = null;
      const rowCounts = async () => (await pg('SELECT (SELECT count(*) FROM public.companies)::int c, (SELECT count(*) FROM public.tenants)::int t, (SELECT count(*) FROM auth.users)::int u, (SELECT count(*) FROM public.chart_of_accounts)::int a')).rows[0];
      await R.check('7.6 export: "company folder" (no window) and "choose a folder" (the OS window) write a .tcdb; an existing file is never replaced; the live company file is refused; the full path comes back', async () => {
        const info = await api('GET', '/api/backup-export-info');
        if (!info.json.success || !info.json.ready || !info.json.companyDir || !info.json.defaultDir) throw new Error(`info ${info.text.slice(0, 200)}`);
        const live = info.json.companyFile;
        const a = await api('POST', '/api/export-backup', { mode: 'company-folder', fileBase: 'TexaCore-E2E-2026-10-14' });
        if (!a.json.success || a.json.path !== path.join(info.json.companyDir, 'TexaCore-E2E-2026-10-14.tcdb') || a.json.encrypted !== false) throw new Error(`company-folder → ${a.text.slice(0, 250)}`);
        const a2 = await api('POST', '/api/export-backup', { mode: 'company-folder', fileBase: 'TexaCore-E2E-2026-10-14' });
        if (!a2.json.success || a2.json.path !== path.join(info.json.companyDir, 'TexaCore-E2E-2026-10-14 (2).tcdb')) throw new Error(`second export did not get "(2)": ${a2.text.slice(0, 250)}`);
        if (sha(fs.readFileSync(a.json.path)).length !== 64 || fs.readFileSync(a.json.path).subarray(0, 4).toString('latin1') !== 'TCDB') throw new Error('not a .tcdb');
        const chosenDir = path.join(WORK, 'chosen folder'); const chosen = path.join(chosenDir, 'my export.tcdb');
        await dialog({ save: chosen });
        const b = await api('POST', '/api/export-backup', { mode: 'choose', fileBase: 'ignored' });
        if (!b.json.success || b.json.path !== chosen || !fs.existsSync(chosen)) throw new Error(`choose → ${b.text.slice(0, 250)}`);
        const chosenSha = sha(fs.readFileSync(chosen));
        const b2 = await api('POST', '/api/export-backup', { mode: 'choose', fileBase: 'ignored' });
        if (b2.status !== 409 || b2.json.code !== 'EXPORT_EXISTS') throw new Error(`choosing an existing file (never asked by the OS) → ${b2.status} ${b2.text.slice(0, 150)}`);
        if (sha(fs.readFileSync(chosen)) !== chosenSha) throw new Error('the existing export was modified');
        if (fs.readdirSync(chosenDir).some((f) => f.endsWith('.tmp'))) throw new Error('a temp file was left behind');
        await dialog({ save: live });
        const c = await api('POST', '/api/export-backup', { mode: 'choose', fileBase: 'x' });
        if (c.status !== 409 || c.json.code !== 'EXPORT_IS_LIVE_FILE') throw new Error(`the live file was not refused → ${c.status} ${c.text.slice(0, 150)}`);
        await dialog({ save: null });
        const d = await api('POST', '/api/export-backup', { mode: 'choose', fileBase: 'x' });
        if (d.json.canceled !== true) throw new Error('a cancelled save window is not reported');
        const e = await api('POST', '/api/export-backup', { mode: 'company-folder', fileBase: 'p', passphrase: 'short' });
        if (e.status !== 400 || e.json.code !== 'PASSPHRASE_TOO_SHORT') throw new Error(`a 5-character phrase → ${e.status}`);
        const f = await api('POST', '/api/export-backup', { mode: 'nonsense' });
        if (f.status !== 400) throw new Error(`bad mode → ${f.status}`);
        const rev = await api('POST', '/api/reveal-in-folder', { path: a.json.path });
        if (!rev.json.success) throw new Error('reveal');
        const bad1 = await api('POST', '/api/reveal-in-folder', { path: '/etc/passwd' });
        const bad2 = await api('POST', '/api/reveal-in-folder', { path: path.join(WORK, 'nope.tcdb') });
        if (bad1.status !== 404 || bad2.status !== 404) throw new Error(`reveal of a non-company file → ${bad1.status}/${bad2.status}`);
        return `company folder: ${path.basename(a.json.path)} then ${path.basename(a2.json.path)}; chosen: ${chosen}; existing/live refused; cancel/short phrase/bad mode refused`;
      });

      await R.check('7.7 a passphrase-protected export: written, reported as protected, and a restore asks for the phrase BEFORE anything is written or replaced (none -> 422, wrong -> 422, right -> restored, same rows)', async () => {
        const exp = await api('POST', '/api/export-backup', { mode: 'company-folder', fileBase: 'TexaCore-PROTECTED', passphrase: 'correct horse battery' });
        if (!exp.json.success || exp.json.encrypted !== true) throw new Error(`protected export → ${exp.text.slice(0, 250)}`);
        protectedExport = exp.json.path;
        const bytes = fs.readFileSync(protectedExport);
        const plain = fs.readFileSync(path.join(path.dirname(protectedExport), 'TexaCore-E2E-2026-10-14.tcdb'));
        if (bytes.equals(plain)) throw new Error('the protected export equals the plain one');
        const protectedSha = sha(bytes);
        counts0 = await rowCounts();
        const restoreDir = TCDB_IN_COMPANY_FOLDER ? rashidDir : path.join(WORK, 'restore-tcdb');
        const filesBefore = fs.existsSync(restoreDir) ? fs.readdirSync(restoreDir).sort().join('|') : '';
        const post = async (fields) => { const m = multipart(bytes, 'TexaCore-PROTECTED.tcdb', fields); return rawRequest('POST', `${UI}/api/restore-tcdb`, { headers: { ...H, 'Content-Type': m.ct }, body: m.body }); };
        const none = await post({});
        if (none.status !== 422 || none.json.code !== 'TCDB_PASSPHRASE_REQUIRED') throw new Error(`no phrase → ${none.status} ${none.buf.toString().slice(0, 150)}`);
        const wrong = await post({ passphrase: 'not the phrase' });
        if (wrong.status !== 422 || wrong.json.code !== 'TCDB_BAD_PASSPHRASE') throw new Error(`wrong phrase → ${wrong.status} ${wrong.buf.toString().slice(0, 150)}`);
        const filesAfter = fs.existsSync(restoreDir) ? fs.readdirSync(restoreDir).sort().join('|') : '';
        if (filesAfter !== filesBefore) throw new Error(`a refused restore wrote files: ${filesBefore} -> ${filesAfter}`);
        if (JSON.stringify(await rowCounts()) !== JSON.stringify(counts0)) throw new Error('a refused restore changed the database');
        const good = await post({ passphrase: 'correct horse battery' });
        if (good.status !== 200 || !good.json.success) throw new Error(`right phrase → ${good.status} ${good.buf.toString().slice(0, 250)}`);
        const after = await rowCounts();
        if (JSON.stringify(after) !== JSON.stringify(counts0)) throw new Error(`rows changed: ${JSON.stringify(counts0)} -> ${JSON.stringify(after)}`);
        if (sha(fs.readFileSync(protectedExport)) !== protectedSha) throw new Error('the protected export file was modified by the restore');
        const still = await post({});
        if (still.status !== 422) throw new Error('the export lost its protection');
        return `refused twice with no write; opened with the phrase; rows ${JSON.stringify(after)}`;
      });

      if (TCDB_IN_COMPANY_FOLDER) {
        await R.check('7.7c (review F1) the protected export lives in the SAME folder the restore writes to: the restore lands under a NEW free name; after sync ticks the export on disk is byte-identical and STILL asks for its phrase', async () => {
          if (!protectedExport) throw new Error('7.7 did not run');
          const protDir = path.dirname(protectedExport);
          if (protDir !== rashidDir) throw new Error(`the export is in ${protDir}, not in the folder the restore writes to (${rashidDir}) - the scenario is not set up`);
          const protectedSha = sha(fs.readFileSync(protectedExport));
          const free = path.join(protDir, 'TexaCore-PROTECTED (2).tcdb');
          if (!fs.existsSync(free)) throw new Error(`the restore did not land under the free name: ${fs.readdirSync(protDir).filter((f) => /PROTECTED/.test(f)).join(', ')}`);
          for (let i = 0; i < 3; i++) { await api('POST', '/api/backup', {}); await new Promise((r) => setTimeout(r, 700)); }   // sync ticks (the restore re-armed the timer on its target)
          const onDisk = fs.readFileSync(protectedExport);
          if (sha(onDisk) !== protectedSha) throw new Error('the protected export was REWRITTEN after the restore (a sync tick wrote the install-key dump over it)');
          const m = multipart(onDisk, 'TexaCore-PROTECTED.tcdb', {});
          const again = await rawRequest('POST', `${UI}/api/restore-tcdb`, { headers: { ...H, 'Content-Type': m.ct }, body: m.body });
          if (again.status !== 422 || again.json.code !== 'TCDB_PASSPHRASE_REQUIRED') throw new Error(`the export on disk lost its protection: ${again.status} ${again.buf.toString().slice(0, 150)}`);
          const st = await status();
          if (st.backupPath !== free) throw new Error(`the live target is ${st.backupPath}, expected ${free}`);
          const live = fs.readFileSync(free);
          if (live.subarray(0, 4).toString('latin1') !== 'TCDB' || sha(live) === protectedSha) throw new Error('the live file is not a fresh install-key dump');
          if (fs.readdirSync(protDir).some((f) => /^\.restore-.*\.tmp$/.test(f))) throw new Error('a temp file was left behind');
          return `restore -> "${path.basename(free)}" (live target); "${path.basename(protectedExport)}" untouched after sync ticks and still asks for its phrase`;
        });
      }

      await R.check('7.7b opening another .tcdb never writes this company\'s data over the PREVIOUS company\'s program copy; the previous manager stops', async () => {
        await dialog({ open: rsfFile });
        const p3 = (await api('POST', '/api/pick-company-file', {})).json;
        const r = await api('POST', '/api/create-local-company', body({ adminEmail: 'rashid-third@e2e.test', companyName: 'شركة ثالثة', storagePath: undefined, dbFileName: undefined, purpose: 'rsf_import', rsfSourceRef: p3.ref }));
        if (!r.json || !r.json.success) throw new Error(`create → ${r.text.slice(0, 300)}`);
        const copy3 = r.json.tcdbCopyPath;
        await waitFor(async () => { const s_ = await status(); return s_.backupPath === r.json.tcdbPath && s_.targets.length === 2 && s_.targets.every((t) => t.state === 'ok'); }, 'the third company\'s targets');
        const copyShaBefore = sha(fs.readFileSync(copy3));
        // (a restore REPLACES the tables of the file: use an export of the database as it is NOW, so the replace is exact)
        const fresh = await api('POST', '/api/export-backup', { mode: 'company-folder', fileBase: 'TexaCore-REOPEN' });
        if (!fresh.json.success) throw new Error(`export → ${fresh.text.slice(0, 200)}`);
        const bytes = fs.readFileSync(fresh.json.path);
        const m = multipart(bytes, 'reopened.tcdb');
        const post = await rawRequest('POST', `${UI}/api/restore-tcdb`, { headers: { ...H, 'Content-Type': m.ct }, body: m.body });
        if (post.status !== 200 || !post.json.success) throw new Error(`restore → ${post.status} ${post.buf.toString().slice(0, 200)}`);
        await api('POST', '/api/backup', {}); await api('POST', '/api/backup', {});
        const s_ = await status();
        if (s_.targets.length !== 1 || !/reopened\.tcdb$/.test(s_.backupPath)) throw new Error(`targets after the reopen: ${JSON.stringify(s_.targets.map((t) => t.path))}`);
        if (sha(fs.readFileSync(copy3)) !== copyShaBefore) throw new Error('the previous company\'s program copy was overwritten by the reopened company');
        return 'the reopened file is the only live target; the previous program copy is byte-identical';
      });

      await R.check('7.8 pick-save-location: the native save window for a NEW company (nothing is written; an existing name is not replaced)', async () => {
        const target = path.join(WORK, 'by hand', 'My Shop.tcdb');
        await dialog({ save: target });
        const r = await api('POST', '/api/pick-save-location', { suggestedName: 'My Shop' });
        if (!r.json.success || r.json.tcdbPath !== target || r.json.renamed !== false || r.json.dir !== path.dirname(target) || r.json.fileBase !== 'My Shop') throw new Error(`save location → ${r.text.slice(0, 250)}`);
        if (fs.existsSync(target)) throw new Error('the picker wrote the file');
        fs.writeFileSync(target, 'existing');
        const r2 = await api('POST', '/api/pick-save-location', { suggestedName: 'My Shop' });
        if (!r2.json.renamed || r2.json.tcdbPath !== path.join(path.dirname(target), 'My Shop (2).tcdb')) throw new Error(`existing name → ${r2.text.slice(0, 250)}`);
        if (fs.readFileSync(target, 'utf8') !== 'existing') throw new Error('an existing file was touched');
        await dialog({ save: null });
        return 'ok';
      });

      // ── 2.0.3: a company file picked in the native window opens IN PLACE (POST /api/open-picked-tcdb) ──
      const exportTo = async (target, passphrase) => {
        await dialog({ save: target });
        const r = await api('POST', '/api/export-backup', { mode: 'choose', fileBase: 'ignored', ...(passphrase ? { passphrase } : {}) });
        await dialog({ save: null });
        if (!r.json.success || r.json.path !== target) throw new Error(`export to ${target} → ${r.text.slice(0, 250)}`);
        return target;
      };
      const pickTcdb = async (file) => { await dialog({ open: file }); const r = (await api('POST', '/api/pick-company-file', {})).json; await dialog({ open: null }); return r; };
      const openPicked = (ref, extra = {}) => api('POST', '/api/open-picked-tcdb', { ref, ...extra });
      const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : []);
      const counts4 = async () => (await pg('SELECT (SELECT count(*) FROM public.companies)::int c, (SELECT count(*) FROM public.tenants)::int t, (SELECT count(*) FROM auth.users)::int u, (SELECT count(*) FROM public.chart_of_accounts)::int a')).rows[0];

      await R.check('7.9a (2.0.3) an UNPROTECTED .tcdb picked in the native window opens IN PLACE: success + inPlace, the minute sync then rewrites the SAME file (no "(2)" file appears), one safety copy lands in the program\'s backups folder, the rows are those of the file', async () => {
        const dir = path.join(WORK, 'inplace-plain'); fs.mkdirSync(dir, { recursive: true });
        const target = await exportTo(path.join(dir, 'Mine.tcdb'));
        const c0 = await counts4();
        const bytes0 = fs.readFileSync(target); const sha0 = sha(bytes0); const st0 = fs.statSync(target);
        const filesBefore = walk(dir).join('|');
        const copiesBefore = walk(copyDir).filter((f) => /^Mine\.opened-\d{4}-\d{2}-\d{2}\.tcdb$/.test(f));
        const pick = await pickTcdb(target);
        if (!pick.success || pick.type !== 'tcdb' || !pick.ref) throw new Error(`pick → ${JSON.stringify(pick).slice(0, 200)}`);
        const r = await openPicked(pick.ref);
        if (r.status !== 200 || !r.json.success) throw new Error(`open-picked-tcdb → ${r.status} ${r.text.slice(0, 300)}`);
        if (r.json.inPlace !== true || path.resolve(r.json.tcdbPath) !== path.resolve(target) || path.resolve(r.json.openedFrom) !== path.resolve(target)) throw new Error(`not in place: ${JSON.stringify({ inPlace: r.json.inPlace, tcdbPath: r.json.tcdbPath, openedFrom: r.json.openedFrom })}`);
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('the opened file changed the rows');
        // sync ticks: the live target is the picked file itself
        await waitFor(async () => { const s_ = await status(); return s_.backupPath && path.resolve(s_.backupPath) === path.resolve(target); }, 'the picked file as the live target');
        let changed = false; let st1 = st0;
        for (let i = 0; i < 6 && !changed; i++) {
          await api('POST', '/api/backup', {}); await new Promise((x) => setTimeout(x, 800));
          st1 = fs.statSync(target);
          changed = st1.mtimeMs > st0.mtimeMs || st1.size !== st0.size;
        }
        if (!changed) throw new Error(`the picked file was never rewritten by the sync (mtime ${st0.mtimeMs} -> ${st1.mtimeMs}, size ${st0.size} -> ${st1.size})`);
        const after = fs.readFileSync(target);
        if (after.subarray(0, 4).toString('latin1') !== 'TCDB') throw new Error('the file in place is not a .tcdb any more');
        const filesAfter = walk(dir).join('|');
        // the restore's own "statements that did not load" log lands beside the file it restored from (backup-manager: <file>.restore-errors.log; a full-schema dump onto an existing schema always reports the
        // already-existing primary keys of the auth tables) - 2.0.2 wrote it into <Documents>/TexaCore beside the program copy. Nothing ELSE may appear.
        const extra = walk(dir).filter((f) => f !== 'Mine.tcdb' && f !== 'Mine.tcdb.restore-errors.log');
        if (extra.length) throw new Error(`files appeared beside the picked one: ${filesBefore} -> ${filesAfter}`);
        if (walk(dir).some((f) => /\(2\)/.test(f) || /\.tmp$/.test(f))) throw new Error(`a "(2)" / temp file exists: ${walk(dir).join(', ')}`);
        const errLog = path.join(dir, 'Mine.tcdb.restore-errors.log'); const errLogNote = fs.existsSync(errLog) ? `; restore log beside it: ${fs.statSync(errLog).size} bytes` : '';
        const copiesAfter = walk(copyDir).filter((f) => /^Mine\.opened-\d{4}-\d{2}-\d{2}\.tcdb$/.test(f));
        if (copiesAfter.length !== copiesBefore.length + 1) throw new Error(`safety copy: ${copiesBefore.length} -> ${copiesAfter.length} (${walk(copyDir).join(', ')})`);
        const copy = fs.readFileSync(path.join(copyDir, copiesAfter.filter((f) => !copiesBefore.includes(f))[0]));
        if (sha(copy) !== sha0) throw new Error('the safety copy is not the file as it was picked');
        const st = await status();
        return `inPlace=true; the SAME file rewritten by the sync (mtime +${Math.round(st1.mtimeMs - st0.mtimeMs)} ms, size ${st0.size} -> ${st1.size}), folder unchanged (${filesAfter}); safety copy ${copiesAfter.filter((f) => !copiesBefore.includes(f))[0]} = the picked bytes; sync state ${st.state}${errLogNote}`;
      });

      await R.check('7.9b (2.0.3) a PROTECTED export is never overwritten: without the phrase 422 TCDB_PASSPHRASE_REQUIRED (nothing changes), wrong phrase 422 TCDB_BAD_PASSPHRASE, with the phrase success + inPlace=false and the company file gets a free name BESIDE it; the export keeps its bytes and its protection after sync ticks', async () => {
        const dir = path.join(WORK, 'inplace-protected'); fs.mkdirSync(dir, { recursive: true });
        const prot = await exportTo(path.join(dir, 'Protected.tcdb'), 'correct horse battery');
        const protSha = sha(fs.readFileSync(prot));
        const c0 = await counts4(); const stBefore = await status();
        const filesBefore = walk(dir).join('|');
        const pick = await pickTcdb(prot);
        if (!pick.success || !pick.ref) throw new Error(`pick → ${JSON.stringify(pick).slice(0, 200)}`);
        const none = await openPicked(pick.ref);
        if (none.status !== 422 || none.json.code !== 'TCDB_PASSPHRASE_REQUIRED') throw new Error(`no phrase → ${none.status} ${none.text.slice(0, 200)}`);
        const wrong = await openPicked(pick.ref, { passphrase: 'not the phrase' });
        if (wrong.status !== 422 || wrong.json.code !== 'TCDB_BAD_PASSPHRASE') throw new Error(`wrong phrase → ${wrong.status} ${wrong.text.slice(0, 200)}`);
        if (walk(dir).join('|') !== filesBefore) throw new Error(`a refused open wrote files: ${filesBefore} -> ${walk(dir).join('|')}`);
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('a refused open changed the database');
        const stMid = await status();
        if (stMid.backupPath !== stBefore.backupPath) throw new Error(`a refused open moved the live target: ${stBefore.backupPath} -> ${stMid.backupPath}`);
        const good = await openPicked(pick.ref, { passphrase: 'correct horse battery' });
        if (good.status !== 200 || !good.json.success) throw new Error(`right phrase → ${good.status} ${good.text.slice(0, 300)}`);
        const free = path.join(dir, 'Protected (2).tcdb');
        if (good.json.inPlace !== false || path.resolve(good.json.tcdbPath) !== path.resolve(free)) throw new Error(`expected a new file beside the export: ${JSON.stringify({ inPlace: good.json.inPlace, tcdbPath: good.json.tcdbPath })}`);
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('the protected file changed the rows');
        await waitFor(async () => { const s_ = await status(); return s_.backupPath && path.resolve(s_.backupPath) === path.resolve(free); }, 'the free name as the live target');
        for (let i = 0; i < 3; i++) { await api('POST', '/api/backup', {}); await new Promise((x) => setTimeout(x, 800)); }
        if (sha(fs.readFileSync(prot)) !== protSha) throw new Error('the protected export was rewritten');
        const m = multipart(fs.readFileSync(prot), 'Protected.tcdb', {});
        const again = await rawRequest('POST', `${UI}/api/restore-tcdb`, { headers: { ...H, 'Content-Type': m.ct }, body: m.body });
        if (again.status !== 422 || again.json.code !== 'TCDB_PASSPHRASE_REQUIRED') throw new Error(`the export lost its protection: ${again.status}`);
        const live = fs.readFileSync(free);
        if (live.subarray(0, 4).toString('latin1') !== 'TCDB' || sha(live) === protSha) throw new Error('the live file is not a fresh install-key dump');
        if (walk(dir).some((f) => /\.tmp$/.test(f))) throw new Error(`a temp file was left: ${walk(dir).join(', ')}`);
        const stray = walk(dir).filter((f) => f !== 'Protected.tcdb' && f !== 'Protected (2).tcdb' && f !== 'Protected (2).tcdb.restore-errors.log');
        if (stray.length) throw new Error(`unexpected files beside the export: ${stray.join(', ')}`);
        return `no phrase / wrong phrase: 422 with no write and the live target unchanged; with the phrase: inPlace=false, "${path.basename(free)}" is the live target; "${path.basename(prot)}" byte-identical after sync ticks and still asks for its phrase`;
      });

      await R.check('7.9c (2.0.3) a made-up / expired reference is refused: 404 PICK_EXPIRED, nothing changes', async () => {
        const c0 = await counts4(); const st0 = await status();
        const r = await openPicked('does-not-exist-0000');
        const r2 = await api('POST', '/api/open-picked-tcdb', {});
        if (r.status !== 404 || r.json.code !== 'PICK_EXPIRED') throw new Error(`unknown ref → ${r.status} ${r.text.slice(0, 200)}`);
        if (r2.status !== 404 || r2.json.code !== 'PICK_EXPIRED') throw new Error(`no ref → ${r2.status} ${r2.text.slice(0, 200)}`);
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0) || (await status()).backupPath !== st0.backupPath) throw new Error('a refused open changed something');
        return 'unknown ref and no ref: 404 PICK_EXPIRED';
      });

      await R.check('7.9d (2.0.3) a picked .rsf is not a company file: open-picked-tcdb answers 400 BAD_REQUEST, nothing changes; the route needs the install secret and is not served to a LAN Host', async () => {
        const c0 = await counts4(); const st0 = await status();
        const pick = await pickTcdb(rsfFile);
        if (!pick.success || pick.type !== 'rsf' || !pick.ref) throw new Error(`pick rsf → ${JSON.stringify(pick).slice(0, 200)}`);
        const r = await openPicked(pick.ref);
        if (r.status !== 400 || r.json.code !== 'BAD_REQUEST') throw new Error(`rsf ref → ${r.status} ${r.text.slice(0, 200)}`);
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0) || (await status()).backupPath !== st0.backupPath) throw new Error('a refused open changed something');
        const noSecret = await request('POST', `${ADMIN}/api/open-picked-tcdb`, { body: { ref: pick.ref } });
        if (noSecret.status !== 401) throw new Error(`without the secret → ${noSecret.status}`);
        const lan = await request('POST', `${UI}/api/open-picked-tcdb`, { headers: { ...H, Host: `192.168.77.20:${PORTS.ui}` }, body: { ref: pick.ref } });
        if (lan.status < 400) throw new Error(`from a LAN Host → ${lan.status}`);
        return `rsf ref: 400 BAD_REQUEST; without the secret: ${noSecret.status}; from a LAN Host: ${lan.status}`;
      });

      // ── 2.0.3 round 2: the page picks the file in the BROWSER's own chooser (Playwright setInputFiles on the launcher input = the same path), the page hashes it and
      //    POST /api/locate-picked-file finds the real file; the app only searches the folders of TEXACORE_E2E_LOCATE_ROOTS (locate-a, locate-b) in this run ──
      const LA = LOCATE_ROOTS[0]; const LB = LOCATE_ROOTS[1]; const OUTSIDE = path.join(WORK, 'locate-outside'); fs.mkdirSync(OUTSIDE, { recursive: true });
      const ui2 = `http://localhost:${PORTS.ui}`;
      const openInBrowser = (file, tag, extra = []) => {
        const out = require('child_process').spawnSync('node', [path.join(__dirname, 'browser-open-file.cjs'), '--erp', ERP, '--ui', ui2, '--file', file, '--shots', path.join(WORK, 'shots-open'), '--tag', tag, ...extra], { encoding: 'utf8', timeout: 240000 });
        const line = (out.stdout || '').split('\n').find((l) => l.startsWith('OPENFILE '));
        if (!line) throw new Error(`browser step failed (exit ${out.status}): ${(out.stderr || out.stdout || '').slice(0, 400)}`);
        return JSON.parse(line.slice('OPENFILE '.length));
      };
      const locateApi = (b) => api('POST', '/api/locate-picked-file', b);
      const fileSha = (f) => sha(fs.readFileSync(f));
      const bodyOf = (f) => ({ name: path.basename(f), size: fs.statSync(f).size, lastModified: Math.round(fs.statSync(f).mtimeMs), sha256: fileSha(f) });
      const NOTE_INPLACE = /الملف نفسه الذي فتحته|file you opened|відкритий вами файл|открытый вами файл/;
      const NOTE_BESIDE = /بقي كما هو|stays as it was|залишився без змін|остался без изменений/;
      const NOTE_NOT_LOCATED_TCDB = /تعذّر تحديد مكان الملف الذي اخترته|could not be located on this computer|Не вдалося визначити місце вибраного файлу|Не удалось определить место выбранного файла/;
      const NOTE_NOT_LOCATED_RSF = /تعذّر تحديد مكان ملف الرشيد|Rashid file could not be located|Не вдалося визначити місце файлу Рашид|Не удалось определить место файла Рашид/;
      const NOTE_BESIDE_RSF = /سيُحفظ ملف الشركة \(\.tcdb\) بجانب ملف الرشيد|will be saved beside the Rashid file|буде збережено поруч із файлом Рашид|будет сохранён рядом с файлом Рашид/;

      await R.check('7.10a (2.0.3 browser chooser) an UNPROTECTED .tcdb chosen in the BROWSER\'s chooser is located by name+size+SHA-256 and opened IN PLACE: the page sends no path, the same file is rewritten by the sync (no "(2)", no restore log beside it), the login view says it is saved into that file', async () => {
        const dir = path.join(LA, 'plain'); fs.mkdirSync(dir, { recursive: true });
        const target = await exportTo(path.join(dir, 'Chooser Mine.tcdb'));
        const c0 = await counts4(); const st0 = fs.statSync(target); const sha0 = fileSha(target);
        const copiesBefore = walk(copyDir).filter((f) => /^Chooser Mine\.opened-\d{4}-\d{2}-\d{2}\.tcdb$/.test(f));
        const res = openInBrowser(target, '7-10a');
        const rq = res.locateRequest;
        if (!rq || JSON.stringify(rq.keys) !== JSON.stringify(['lastModified', 'name', 'sha256', 'size']) || rq.name !== 'Chooser Mine.tcdb' || rq.size !== st0.size || !rq.shaOk || !rq.lastModifiedIsNumber) throw new Error(`what the page sent: ${JSON.stringify(rq)}`);
        if (res.alerts.length) throw new Error(`the page alerted: ${res.alerts.join(' | ')}`);
        if (!res.located || res.located.success !== true || res.located.type !== 'tcdb' || !res.located.hasRef || path.resolve(res.located.filePath) !== path.resolve(target)) throw new Error(`located → ${JSON.stringify(res.located)}`);
        const routes = res.routes.map((r) => `${r.route}:${r.status}`);
        if (!routes.includes('open-picked-tcdb:200') || routes.some((r) => r.startsWith('restore-tcdb') || r.startsWith('pick-company-file'))) throw new Error(`the page used ${routes.join(', ')}`);
        if (!res.note || res.note.testId !== 'live-company-file-note' || !res.note.text.includes(target) || !NOTE_INPLACE.test(res.note.text)) throw new Error(`login-view note → ${JSON.stringify(res.note)}`);
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('the opened file changed the rows');
        await waitFor(async () => { const s_ = await status(); return s_.backupPath && path.resolve(s_.backupPath) === path.resolve(target); }, 'the chosen file as the live target');
        let changed = false; let st1 = st0;
        for (let i = 0; i < 6 && !changed; i++) { await api('POST', '/api/backup', {}); await new Promise((x) => setTimeout(x, 800)); st1 = fs.statSync(target); changed = st1.mtimeMs > st0.mtimeMs || st1.size !== st0.size; }
        if (!changed) throw new Error('the chosen file was never rewritten by the sync');
        const left = walk(dir);
        if (left.join('|') !== 'Chooser Mine.tcdb') throw new Error(`files in the folder: ${left.join(', ')} (a "(2)" copy or a restore log beside the user's file)`);
        // review rv203: the restore's temporary SQL (the whole DECRYPTED database) and the daily snapshots never go beside the user's own file
        if (left.some((f) => /\.(restore|truncate|auth)\.sql$/i.test(f) || f === 'snapshots')) throw new Error(`temporary SQL / snapshots beside the user's file: ${left.join(', ')}`);
        const tmpLeft = fs.readdirSync(os.tmpdir()).filter((f) => new RegExp(`^texacore-(restore|truncate|auth)-${child.pid}-[0-9a-f]+\\.sql$`).test(f));
        if (tmpLeft.length) throw new Error(`temporary SQL left in the temp folder: ${tmpLeft.join(', ')}`);
        const snapDir = path.join(copyDir, 'snapshots'); const snaps = fs.existsSync(snapDir) ? fs.readdirSync(snapDir).length : 0;
        const copiesAfter = walk(copyDir).filter((f) => /^Chooser Mine\.opened-\d{4}-\d{2}-\d{2}\.tcdb$/.test(f));
        if (copiesAfter.length !== copiesBefore.length + 1 || sha(fs.readFileSync(path.join(copyDir, copiesAfter.filter((f) => !copiesBefore.includes(f))[0]))) !== sha0) throw new Error('the safety copy of the opened file is missing or differs');
        return `page sent {name,size,lastModified,sha256} only; located ${path.basename(res.located.filePath)} in locate-a; open-picked-tcdb 200; the SAME file rewritten (mtime +${Math.round(st1.mtimeMs - st0.mtimeMs)} ms); folder = [${left.join(', ')}] (no restore/truncate/auth .sql, no snapshots folder; no temp SQL left in the temp folder; ${snaps} snapshot(s) in the program's backups folder); note "${res.note.text.slice(0, 60)}…"; status line(s) seen: ${JSON.stringify(res.statusTexts)}`;
      });

      await R.check('7.10b (2.0.3 browser chooser) a PROTECTED export chosen in the browser: the page asks for the phrase, nothing is overwritten - the company file is "<name> (2).tcdb" BESIDE it, the export stays byte-identical (and protected), the note says so', async () => {
        const dir = path.join(LA, 'protected'); fs.mkdirSync(dir, { recursive: true });
        const prot = await exportTo(path.join(dir, 'Protected.tcdb'), 'correct horse battery');
        const protSha = fileSha(prot); const c0 = await counts4();
        const res = openInBrowser(prot, '7-10b', ['--phrase', 'correct horse battery']);
        if (!res.prompt) throw new Error('the page never asked for the phrase');
        if (!res.located || res.located.success !== true || path.resolve(res.located.filePath) !== path.resolve(prot)) throw new Error(`located → ${JSON.stringify(res.located)}`);
        const routes = res.routes.map((r) => `${r.route}:${r.status}`);
        if (!routes.includes('open-picked-tcdb:422') || !routes.includes('open-picked-tcdb:200')) throw new Error(`routes ${routes.join(', ')} (expected 422 without the phrase, then 200)`);
        const free = path.join(dir, 'Protected (2).tcdb');
        if (!res.note || !res.note.text.includes(free) || !NOTE_BESIDE.test(res.note.text)) throw new Error(`note → ${JSON.stringify(res.note)}`);
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('the protected file changed the rows');
        await waitFor(async () => { const s_ = await status(); return s_.backupPath && path.resolve(s_.backupPath) === path.resolve(free); }, 'the free name as the live target');
        for (let i = 0; i < 3; i++) { await api('POST', '/api/backup', {}); await new Promise((x) => setTimeout(x, 800)); }
        if (fileSha(prot) !== protSha) throw new Error('the protected export was rewritten');
        const m = multipart(fs.readFileSync(prot), 'Protected.tcdb', {});
        const again = await rawRequest('POST', `${UI}/api/restore-tcdb`, { headers: { ...H, 'Content-Type': m.ct }, body: m.body });
        if (again.status !== 422 || again.json.code !== 'TCDB_PASSPHRASE_REQUIRED') throw new Error(`the export lost its protection: ${again.status}`);
        const stray = walk(dir).filter((f) => f !== 'Protected.tcdb' && f !== 'Protected (2).tcdb');
        if (stray.length) throw new Error(`unexpected files beside the export: ${stray.join(', ')}`);
        return `prompt shown; 422 then 200; "${path.basename(free)}" is the live target; the export is byte-identical and still asks for its phrase`;
      });

      await R.check('7.10c (2.0.3 browser chooser) a Rashid .rsf chosen in the browser: the app locates it and the page shows the company file will be saved BESIDE it - for the small synthetic file with an Arabic name AND for the REAL 25 MB file (the page hashes the whole content itself; the «جارٍ تحديد مكان الملف…» line is the page\'s own)', async () => {
        const ev = [];
        for (const [sub, name, srcFile] of [['rsf', 'شركة الرشيد.rsf', rsfFile], ['rsf-real', 'real_2023.rsf', RSF]]) {
          const dir = path.join(LA, sub); fs.mkdirSync(dir, { recursive: true });
          const target = path.join(dir, name); fs.copyFileSync(srcFile, target);
          const t0 = Date.now();
          const res = openInBrowser(target, `7-10c-${sub}`, sub === 'rsf-real' ? ['--delay-locate', '1500'] : []);
          if (!res.located || res.located.success !== true || res.located.type !== 'rsf' || path.resolve(res.located.filePath) !== path.resolve(target)) throw new Error(`${sub}: located → ${JSON.stringify(res.located)}`);
          const planned = path.join(dir, name.replace(/\.rsf$/, '.tcdb'));
          if (res.located.companyFilePath !== planned) throw new Error(`${sub}: companyFilePath ${res.located.companyFilePath}`);
          if (!res.note || res.note.testId !== 'rsf-company-file-target' || !res.note.text.includes(planned) || !NOTE_BESIDE_RSF.test(res.note.text)) throw new Error(`${sub}: form note → ${JSON.stringify(res.note)}`);
          if (res.locateRequest.size !== fs.statSync(target).size || !res.locateRequest.shaOk) throw new Error(`${sub}: request ${JSON.stringify(res.locateRequest)}`);
          if (res.routes.some((r) => r.route === 'create-local-company' || r.route === 'pick-company-file')) throw new Error(`${sub}: unexpected route ${JSON.stringify(res.routes)}`);
          if (walk(dir).join('|') !== name) throw new Error(`${sub}: the search or the page wrote beside the Rashid file: ${walk(dir).join(', ')}`);
          if (sub === 'rsf-real' && !res.statusTexts.some((t) => /جارٍ تحديد مكان الملف|Locating the file|Визначення місця файлу|Определение места файла/.test(t))) throw new Error(`${sub}: the page did not show the «locating…» line while the app searched: ${JSON.stringify(res.statusTexts)}`);
          ev.push(`${name}: ${res.locateRequest.size} bytes hashed in the page, located in locate-a, form «${res.note.text.slice(0, 60)}…», ${Date.now() - t0} ms incl. browser start, status line(s) seen ${JSON.stringify(res.statusTexts)}`);
        }
        return ev.join(' | ');
      });

      await R.check('7.10d (2.0.3 locate) two files with the SAME name and size but different content: only the matching one is ever used or answered (browser: the real .tcdb opens in place, the decoy is untouched; API: each digest finds its own file, a digest nobody holds finds nothing and leaks no path; identical copies are told apart by modification time)', async () => {
        fs.mkdirSync(path.join(LA, 'dup'), { recursive: true });
        const real = await exportTo(path.join(LA, 'dup', 'Dup.tcdb'));
        fs.mkdirSync(path.join(LB, 'dup'), { recursive: true });
        const decoy = path.join(LB, 'dup', 'Dup.tcdb'); const bytes = Buffer.from(fs.readFileSync(real)); bytes[bytes.length - 3] ^= 0xff; fs.writeFileSync(decoy, bytes);
        const otherSize = path.join(LB, 'dup2', 'Dup.tcdb'); fs.mkdirSync(path.dirname(otherSize), { recursive: true }); fs.writeFileSync(otherSize, Buffer.concat([bytes, Buffer.from('x')]));
        const decoySha = fileSha(decoy); const decoyMtime = fs.statSync(decoy).mtimeMs;
        const res = openInBrowser(real, '7-10d');
        if (!res.located || res.located.success !== true || path.resolve(res.located.filePath) !== path.resolve(real)) throw new Error(`browser located → ${JSON.stringify(res.located)}`);
        if (!res.routes.some((r) => r.route === 'open-picked-tcdb' && r.status === 200)) throw new Error(`routes ${JSON.stringify(res.routes)}`);
        if (fileSha(decoy) !== decoySha || fs.statSync(decoy).mtimeMs !== decoyMtime) throw new Error('the decoy was touched');
        // API level: each digest finds exactly its own file
        const a = (await locateApi(bodyOf(real))).json; const b = (await locateApi(bodyOf(decoy))).json;
        if (!a.success || path.resolve(a.filePath) !== path.resolve(real)) throw new Error(`real → ${JSON.stringify(a).slice(0, 200)}`);
        if (!b.success || path.resolve(b.filePath) !== path.resolve(decoy)) throw new Error(`decoy → ${JSON.stringify(b).slice(0, 200)}`);
        const nobody = await locateApi({ ...bodyOf(real), sha256: sha(Buffer.from('nobody holds this file')) });
        if (nobody.status !== 200 || nobody.json.success !== false || nobody.json.code !== 'NOT_FOUND' || JSON.stringify(nobody.json).includes(WORK)) throw new Error(`a digest nobody holds → ${nobody.status} ${nobody.text.slice(0, 200)}`);
        const wrongSize = await locateApi({ ...bodyOf(real), size: bodyOf(real).size + 1 });
        if (wrongSize.json.success !== false || wrongSize.json.code !== 'NOT_FOUND') throw new Error(`a wrong size → ${wrongSize.text.slice(0, 200)}`);
        // identical copies: the browser's modification time decides; otherwise ambiguous
        const sameA = path.join(LA, 'same', 'Z.rsf'); const sameB = path.join(LB, 'same', 'Z.rsf');
        for (const f of [sameA, sameB]) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.from('identical rashid bytes '.repeat(40))); }
        const t0 = Date.now() / 1000 - 86400 * 4; fs.utimesSync(sameA, t0, t0); fs.utimesSync(sameB, t0 + 7200, t0 + 7200);
        const zb = bodyOf(sameA);
        const z1 = (await locateApi(zb)).json; const z2 = (await locateApi({ ...zb, lastModified: Math.round(fs.statSync(sameB).mtimeMs) })).json; const z3 = (await locateApi({ ...zb, lastModified: zb.lastModified + 3600000 })).json;
        if (!z1.success || path.resolve(z1.filePath) !== path.resolve(sameA)) throw new Error(`copy A by time → ${JSON.stringify(z1).slice(0, 160)}`);
        if (!z2.success || path.resolve(z2.filePath) !== path.resolve(sameB)) throw new Error(`copy B by time → ${JSON.stringify(z2).slice(0, 160)}`);
        if (z3.success !== false || z3.code !== 'NOT_FOUND' || z3.reason !== 'ambiguous') throw new Error(`neither time → ${JSON.stringify(z3).slice(0, 160)}`);
        return 'browser: the real file opened in place, the decoy byte-identical; API: own digest → own file, unknown digest / wrong size → NOT_FOUND without a path, identical copies → told apart by mtime else NOT_FOUND ambiguous';
      });

      await R.check('7.10e (2.0.3 fallback) a file OUTSIDE the searched folders is not found: a .tcdb falls back to the upload (a copy in the TexaCore folder - here the scratch one) and the login view says where; a .rsf shows the TexaCore-folder line in the form; neither crashes', async () => {
        const outRsf = path.join(OUTSIDE, 'Outside Rashid.rsf'); fs.copyFileSync(rsfFile, outRsf);
        const r1 = openInBrowser(outRsf, '7-10e-rsf');
        if (!r1.located || r1.located.success !== false || r1.located.code !== 'NOT_FOUND' || r1.locateStatus !== 200) throw new Error(`rsf located → ${JSON.stringify(r1.located)} (${r1.locateStatus})`);
        const info = (await api('GET', '/api/backup-export-info')).json;
        if (!r1.note || r1.note.testId !== 'rsf-company-file-fallback' || !NOTE_NOT_LOCATED_RSF.test(r1.note.text) || !r1.note.text.includes(info.defaultDir)) throw new Error(`rsf note → ${JSON.stringify(r1.note)} (default ${info.defaultDir})`);
        const outTcdb = await exportTo(path.join(OUTSIDE, 'Outside.tcdb'));
        const c0 = await counts4(); const outSha = fileSha(outTcdb);
        const r2 = openInBrowser(outTcdb, '7-10e-tcdb');
        if (!r2.located || r2.located.success !== false || r2.located.code !== 'NOT_FOUND') throw new Error(`tcdb located → ${JSON.stringify(r2.located)}`);
        const routes = r2.routes.map((r) => `${r.route}:${r.status}`);
        if (!routes.includes('restore-tcdb:200') || routes.some((r) => r.startsWith('open-picked-tcdb'))) throw new Error(`fallback routes ${routes.join(', ')}`);
        const fallbackDir = TCDB_IN_COMPANY_FOLDER ? rashidDir : path.join(WORK, 'restore-tcdb');   // where the upload fallback writes in this run (TEXACORE_TCDB_DIR)
        const copy = path.join(fallbackDir, 'Outside.tcdb');
        if (!fs.existsSync(copy)) throw new Error(`no fallback copy at ${copy}: ${walk(fallbackDir).join(', ')}`);
        if (!r2.note || r2.note.testId !== 'live-company-file-note' || !NOTE_NOT_LOCATED_TCDB.test(r2.note.text) || !r2.note.text.includes(copy)) throw new Error(`tcdb note → ${JSON.stringify(r2.note)}`);
        if (fileSha(outTcdb) !== outSha) throw new Error('the file outside was modified');
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('the fallback restore changed the rows');
        return `rsf: NOT_FOUND (HTTP 200) → form line with ${info.defaultDir}; tcdb: NOT_FOUND → upload fallback → ${copy}; the original untouched; notes shown`;
      });

      await R.check('7.10f (2.0.3 locate) the route is behind the same guards: no secret 401; a LAN Host refused; a foreign Origin refused; an older-style empty body is a 400, never a search', async () => {
        fs.mkdirSync(path.join(LA, 'guard'), { recursive: true });
        const real = await exportTo(path.join(LA, 'guard', 'G.tcdb'));
        const b = bodyOf(real);
        const noSecret = await request('POST', `${ADMIN}/api/locate-picked-file`, { body: b });
        if (noSecret.status !== 401) throw new Error(`without the secret → ${noSecret.status}`);
        const wrongSecret = await request('POST', `${ADMIN}/api/locate-picked-file`, { headers: { 'x-texacore-local-secret': 'nope' }, body: b });
        if (wrongSecret.status !== 401) throw new Error(`wrong secret → ${wrongSecret.status}`);
        const lan = await request('POST', `${UI}/api/locate-picked-file`, { headers: { ...H, Host: `192.168.77.20:${PORTS.ui}` }, body: b });
        if (lan.status < 400 || /filePath|"ref"/.test(lan.text)) throw new Error(`from a LAN Host → ${lan.status} ${lan.text.slice(0, 120)}`);
        const foreign = await api('POST', '/api/locate-picked-file', b, { Origin: 'https://evil.example' });
        if (foreign.status !== 403 || /filePath|"ref"/.test(foreign.text)) throw new Error(`foreign Origin → ${foreign.status}`);
        const empty = await locateApi({});
        if (empty.status !== 400 || empty.json.code !== 'BAD_REQUEST') throw new Error(`empty body → ${empty.status} ${empty.text.slice(0, 120)}`);
        const ok = await locateApi(b);
        if (ok.status !== 200 || !ok.json.success) throw new Error(`the guarded route does not work with the secret: ${ok.status} ${ok.text.slice(0, 160)}`);
        return `no secret ${noSecret.status}, wrong secret ${wrongSecret.status}, LAN Host ${lan.status}, foreign Origin ${foreign.status}, empty body 400; with the secret it answers`;
      });

      await R.check('7.10g (2.0.3 locate) a bad body is a 400 and never searches or answers a path: separators / traversal / wrong extension / hidden names in the name, size 0 / negative / fractional / over 1 GiB / not a number, a short or non-hex digest, a non-number time, a non-JSON body', async () => {
        const good = { name: 'Mine.tcdb', size: 1234, lastModified: 1760000000000, sha256: 'a'.repeat(64) };
        const bad = [
          { ...good, name: '../Mine.tcdb' }, { ...good, name: 'a/Mine.tcdb' }, { ...good, name: 'a\\Mine.tcdb' }, { ...good, name: '/etc/passwd.tcdb' }, { ...good, name: 'Mine.txt' },
          { ...good, name: '.hidden.tcdb' }, { ...good, name: 'a..b.rsf' }, { ...good, name: '' }, { ...good, name: 5 },
          { ...good, size: 0 }, { ...good, size: -4 }, { ...good, size: 1.5 }, { ...good, size: 1024 ** 3 + 1 }, { ...good, size: '1234' },
          { ...good, sha256: 'a'.repeat(63) }, { ...good, sha256: 'z'.repeat(64) }, { ...good, sha256: '' }, { ...good, lastModified: 'yesterday' },
        ];
        for (const b of bad) {
          const r = await locateApi(b);
          if (r.status !== 400 || r.json.code !== 'BAD_REQUEST' || /filePath|"ref"/.test(r.text)) throw new Error(`${JSON.stringify(b)} → ${r.status} ${r.text.slice(0, 120)}`);
        }
        const notJson = await request('POST', `${ADMIN}/api/locate-picked-file`, { headers: { ...H, 'Content-Type': 'application/json' }, body: '{"name":' });
        const arr = await request('POST', `${ADMIN}/api/locate-picked-file`, { headers: H, body: [good] });
        if (notJson.status !== 400 || arr.status !== 400) throw new Error(`non-JSON → ${notJson.status}, array → ${arr.status}`);
        const fine = await locateApi(good);   // well formed, nobody holds it
        if (fine.status !== 200 || fine.json.code !== 'NOT_FOUND') throw new Error(`a well-formed unknown file → ${fine.status} ${fine.text.slice(0, 120)}`);
        return `${bad.length} malformed bodies → 400 BAD_REQUEST, non-JSON 400, array 400; a well-formed unknown file → 200 NOT_FOUND`;
      });

      await R.check('7.10h (review rv203) a FAILED open never writes into the picked file: the restore is forced to fail (another session holds a lock the pre-restore truncate needs, 20 s x 4 tries) - the picked file stays byte-identical with nothing beside it, the PREVIOUS company file is the live target again and still syncing, the rows are unchanged; a second open meanwhile is refused 409 RESTORE_BUSY', async () => {
        const dir = path.join(LA, 'failopen'); fs.mkdirSync(dir, { recursive: true });
        const picked = await exportTo(path.join(dir, 'Fail Open.tcdb'));
        const pickedSha = fileSha(picked); const pickedMtime = fs.statSync(picked).mtimeMs;
        const st0 = await status(); const prev = st0.backupPath;
        if (!prev || path.resolve(prev) === path.resolve(picked) || !st0.syncing) throw new Error(`no previous syncing company file to fall back to: ${JSON.stringify({ prev, syncing: st0.syncing })}`);
        const prevMtime0 = fs.statSync(prev).mtimeMs; const c0 = await counts4();
        const loc = (await locateApi(bodyOf(picked))).json;
        if (!loc.success || !loc.ref) throw new Error(`locate → ${JSON.stringify(loc).slice(0, 160)}`);
        const locker = new Client(pgOptions());
        await locker.connect();
        let first; let second;
        try {
          await locker.query('BEGIN');
          await locker.query('LOCK TABLE public.companies IN ACCESS SHARE MODE');   // the restore's TRUNCATE (ACCESS EXCLUSIVE) now waits for this
          const firstP = request('POST', `${ADMIN}/api/open-picked-tcdb`, { headers: H, body: { ref: loc.ref }, timeout: 300000 });
          await new Promise((r) => setTimeout(r, 4000));
          second = await request('POST', `${ADMIN}/api/open-picked-tcdb`, { headers: H, body: { ref: loc.ref }, timeout: 60000 });
          first = await firstP;
        } finally { try { await locker.query('ROLLBACK'); } catch { /* connection gone */ } await locker.end().catch(() => {}); }
        if (second.status !== 409 || second.json.code !== 'RESTORE_BUSY') throw new Error(`a second open while one runs → ${second.status} ${second.text.slice(0, 160)}`);
        if (first.status === 200) throw new Error('the forced failure did not happen (the open succeeded)');
        if (!/truncate failed|lock timeout|deadlock/i.test(first.text)) throw new Error(`unexpected failure: ${first.status} ${first.text.slice(0, 240)}`);
        if (fileSha(picked) !== pickedSha || fs.statSync(picked).mtimeMs !== pickedMtime) throw new Error('the picked file was written to');
        if (walk(dir).join('|') !== 'Fail Open.tcdb') throw new Error(`files beside the picked file: ${walk(dir).join(', ')}`);
        const tmpLeft = fs.readdirSync(os.tmpdir()).filter((f) => new RegExp(`^texacore-(restore|truncate|auth)-${child.pid}-[0-9a-f]+\\.sql$`).test(f));
        if (tmpLeft.length) throw new Error(`temporary SQL left in the temp folder: ${tmpLeft.join(', ')}`);
        const st1 = await status();
        if (path.resolve(st1.backupPath || '') !== path.resolve(prev)) throw new Error(`the live target is ${st1.backupPath}, expected the previous company file ${prev}`);
        await waitFor(async () => { await api('POST', '/api/backup', {}); return fs.statSync(prev).mtimeMs > prevMtime0; }, 'the previous company file syncing again');
        if (!(await status()).syncing) throw new Error('the timer is not running again');
        if (fileSha(picked) !== pickedSha) throw new Error('the picked file changed while the previous file synced');
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('the failed open changed the rows');
        const ok = await api('POST', '/api/open-picked-tcdb', { ref: loc.ref });
        if (ok.status !== 200 || !ok.json.success) throw new Error(`after the lock is gone the same file opens: ${ok.status} ${ok.text.slice(0, 200)}`);
        return `open failed (${first.status}: ${first.text.slice(0, 90)}…); second open 409 RESTORE_BUSY; picked file byte-identical, nothing beside it, no temp SQL; live target back to ${path.basename(prev)} and syncing (mtime +${Math.round(fs.statSync(prev).mtimeMs - prevMtime0)} ms); rows unchanged; the same file then opens fine`;
      });
    }
  } catch (e) {
    R.rows.push({ name: 'harness', ok: false, evidence: e.stack || e.message, ms: 0 });
    console.log(`  FAIL  harness — ${e.message}`);
  } finally {
    await stopApp(child, userData);
  }

  fs.writeFileSync(path.join(WORK, 'results.json'), JSON.stringify({ at: new Date().toISOString(), license: LICENSE, app: APP || 'electron dev mode', summary: R.summary(), warnings: R.warnings, rows: R.rows }, null, 2));
  for (const w of R.warnings) console.log(`  WARN  ${w.slice(0, 300)}`);
  console.log(`\nlaunch-check (${LICENSE}): ${R.summary()}  →  ${path.join(WORK, 'results.json')}`);
  if (!KEEP) { /* the workdir is kept on purpose: it holds the evidence */ }
  process.exit(R.failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
