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
const { multiCompanyChecks } = require('./multi-company-checks');

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
  fs.mkdirSync(path.join(WORK, 'home', 'Documents'), { recursive: true });   // 2.0.4: HOME of the app in this run (the audit's "~/Documents/TexaCore" lands here, never in the real home)
  for (const p of Object.values(PORTS)) if (!(await portFree(p))) { console.error(`port ${p} is in use — stop whatever holds it first`); process.exit(2); }

  console.log(`launch-check: license=${LICENSE} workdir=${WORK}`);
  const appBinary = APP ? path.join(path.resolve(APP), 'Contents', 'MacOS', path.basename(path.resolve(APP), '.app')) : '';
  if (APP && !fs.existsSync(appBinary)) { console.error(`no executable at ${appBinary}`); process.exit(2); }
  const { child, ready } = startApp({ userData, license: LICENSE, logFile, appBinary, extraEnv: { TEXACORE_UI_SMOKE: '1', HOME: path.join(WORK, 'home'), TEXACORE_E2E_LOCATE_ROOTS: LOCATE_ROOTS.join(path.delimiter), ...(TCDB_IN_COMPANY_FOLDER ? { TEXACORE_TCDB_DIR: path.join(WORK, 'rashid-folder') } : {}) } });
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
      if (e.display !== 'flex' || !/^http:\/\/.+\/login\?c=[0-9a-f]{8}$/.test(e.link) || e.companies < 1 || e.hero !== 'ready' || e.tabs !== 3) throw new Error(`the links are not drawn from live data: ${JSON.stringify(e)}`);
      if (!u.i18n || u.i18n.length < 2) throw new Error('i18n not applied');
      return `window v${u.version}: ${u.bridgeKeys} bridge functions, state/secret/companies over IPC, links drawn (${e.link}; ${e.companies} company; hero ${e.hero}; ${e.tabs} tabs), i18n applied`;
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
    // 2.0.4 re-cut guard (the ERP's 20270222a / 20270222c): a company the installer provisions must come with the standard unit set and the Russian / Ukrainian names of the standard chart. Conditional on the
    // pin: it asks only once production has applied those migrations and the pinned list (baseline/MIGRATIONS_PIN.json) carries them, so today's 2.0.4 build is unaffected.
    await R.check('3.2b a new local company owns the standard unit set and the ru / uk chart names (once the pin carries 20270222a / 20270222c)', async () => {
      const pin = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'MIGRATIONS_PIN.json'), 'utf8'));
      const pinned = new Set((pin.migrations || []).map((m) => m.name));
      const notes = [];
      if (pinned.has('20270222a_standard_units_seed')) {
        const u = (await pg(`SELECT count(*)::int n, count(*) FILTER (WHERE is_base_unit)::int bases, count(*) FILTER (WHERE NOT is_base_unit AND base_unit_id IS NULL)::int unlinked FROM units_of_measure WHERE tenant_id=$1`, [A.tenantId])).rows[0];
        if (u.n !== 36 || u.bases !== 5 || u.unlinked !== 0) throw new Error(`units of a new tenant: ${JSON.stringify(u)} (expected 36 units, 5 base units, 0 unlinked)`);
        notes.push(`${u.n} units, ${u.bases} base, all linked`);
      } else notes.push('units: skipped (20270222a is not pinned yet)');
      if (pinned.has('20270222c_standard_chart_names_ru_uk')) {
        const c = (await pg(`SELECT count(*)::int n, count(*) FILTER (WHERE name_ru IS NOT NULL AND name_uk IS NOT NULL)::int named FROM chart_of_accounts WHERE company_id=$1`, [A.companyId])).rows[0];
        if (c.n < 100 || c.named !== c.n) throw new Error(`chart of a new company: ${c.named} of ${c.n} accounts carry name_ru and name_uk`);
        notes.push(`${c.named}/${c.n} accounts with ru + uk names`);
      } else notes.push('chart names: skipped (20270222c is not pinned yet)');
      return notes.join('; ');
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
          const r = await request('GET', `${base}/${t.relname}?select=*&limit=200`, { headers: anon });
          if (r.status === 200 && Array.isArray(r.json) && r.json.length) {
            // a tenant-scoped table may hold GLOBAL rows (tenant_id and company_id NULL: the platform's default statuses, templates ...) that production's own policies show to everybody; a row that
            // belongs to a tenant or a company is a leak, whatever the table
            const global = r.json.every((row) => (row.tenant_id === undefined || row.tenant_id === null) && (row.company_id === undefined || row.company_id === null));
            if (base === API + '/rest/v1') ((t.tenant_scoped && !global) ? leaks : publicReads).push(t.relname);
            else if (t.tenant_scoped && !global) leaks.push(`${t.relname} (via UI proxy)`);
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
    // 2.0.5 harness: the address the PRODUCT shows to staff (src/lan-address.js: the default-route adapter, never a VPN tunnel such as utun9) - the first interface of os.networkInterfaces() is a tunnel on a Mac with a VPN
    const lanIp = (() => { const a = require('../../src/lan-address').pickLanAddress(os.networkInterfaces()); return a && a !== '127.0.0.1' ? a : ''; })();
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

    // 2.0.5 RC2: the program's own «إضافة مستخدم» on a local install: POST /local-api/invite-user on the UI server (same origin: localhost, the LAN address, the tunnel), authorised as the
    // SIGNED-IN caller through his GoTrue session (never the admin secret), every guard the cloud's invite uses checked on the server.
    await R.check('4.12b in-app add-user route (/local-api/invite-user): no / bad session, cross-site and a foreign Origin are refused; the free plan limit refuses; otherwise the account is created with a one-time password that logs in from the LAN and sees only its company', async () => {
      const base = lanIp ? `http://${lanIp}:${PORTS.ui}` : UI;
      const lanHdr = lanIp ? {} : { Host: `192.168.77.20:${PORTS.ui}` };
      const login = await request('POST', `${base}/_supabase/auth/v1/token?grant_type=password`, { headers: { ...lanHdr, apikey: secrets.anonKey }, body: { email: 'owner@e2e.test', password: 'E2ePass#2026' } });
      if (login.status !== 200 || !login.json.access_token) throw new Error(`owner login from the LAN address → ${login.status} ${login.text.slice(0, 160)}`);
      const jwt = login.json.access_token;
      const roles = await request('GET', `${UI}/api/employee-roles?companyId=${A.companyId}`, { headers: H });
      const role = (roles.json.roles || []).find((r) => !/owner|admin/i.test(r.code)) || (roles.json.roles || [])[0];
      if (!role) throw new Error('no grantable role to test with');
      const counts = async () => (await pg('SELECT (SELECT count(*) FROM auth.users)::int u, (SELECT count(*) FROM public.user_profiles)::int p, (SELECT count(*) FROM public.company_membership_requests)::int req')).rows[0];
      const call = (extra = {}, body, token = jwt) => request('POST', `${base}/local-api/invite-user`, { headers: { ...lanHdr, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }, body: body || { email: 'staff3@e2e.test', full_name: 'Staff Three', items: [{ company_id: A.companyId, role_ids: [role.id] }] } });
      const before = await counts();
      const noAuth = await call({}, undefined, null);
      if (noAuth.status !== 401 || noAuth.json.code !== 'AUTH_REQUIRED') throw new Error(`no session → ${noAuth.status} ${noAuth.text.slice(0, 160)}`);
      const badJwt = await call({}, undefined, 'not-a-jwt');
      if (badJwt.status !== 401) throw new Error(`bad session → ${badJwt.status} ${badJwt.text.slice(0, 160)}`);
      const cross = await call({ 'Sec-Fetch-Site': 'cross-site' });
      if (cross.status !== 403 || cross.json.code !== 'CROSS_ORIGIN') throw new Error(`cross-site → ${cross.status} ${cross.text.slice(0, 160)}`);
      const foreign = await call({ Origin: 'https://evil.example' });
      if (foreign.status !== 403) throw new Error(`foreign Origin → ${foreign.status} ${foreign.text.slice(0, 160)}`);
      const noJson = await request('POST', `${base}/local-api/invite-user`, { headers: { ...lanHdr, 'Content-Type': 'text/plain', Authorization: `Bearer ${jwt}` }, body: 'x' });
      if (noJson.status !== 400 && noJson.status !== 415) throw new Error(`non-JSON → ${noJson.status}`);
      if (JSON.stringify(await counts()) !== JSON.stringify(before)) throw new Error('a refused call left rows behind');
      const leak = [noAuth, badJwt, cross, foreign].map((r) => r.text).join(' ');
      if (secrets.localApiSecret && leak.includes(secrets.localApiSecret)) throw new Error('a response carries the admin secret');
      if (LICENSE === 'free') {
        const r = await call();
        if (r.status !== 403 || r.json.code !== 'PLAN_LIMIT_EXCEEDED') throw new Error(`free plan → ${r.status} ${r.text.slice(0, 200)}`);
        if (JSON.stringify(await counts()) !== JSON.stringify(before)) throw new Error('the refused (limit) call left rows behind');
        return `no/bad session 401, cross-site + foreign Origin 403, non-JSON refused, free plan → ${r.json.code} (${r.json.current}/${r.json.max}); nothing created`;
      }
      const ok = await call();
      if (ok.status !== 200 || !ok.json.success || !ok.json.data.one_time_password) throw new Error(`invite → ${ok.status} ${ok.text.slice(0, 260)}`);
      const d = ok.json.data;
      if (d.is_new !== true || d.accepted < 1 || !/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(d.one_time_password)) throw new Error(`reply ${JSON.stringify({ ...d, one_time_password: '***' })}`);
      for (const f of [logFile, path.join(userData, 'logs', 'heartbeat.log')]) if (fs.existsSync(f) && fs.readFileSync(f, 'utf8').includes(d.one_time_password)) throw new Error(`the one-time password is in ${path.basename(f)}`);
      const login2 = await request('POST', `${base}/_supabase/auth/v1/token?grant_type=password`, { headers: { ...lanHdr, apikey: secrets.anonKey }, body: { email: 'staff3@e2e.test', password: d.one_time_password } });
      if (login2.status !== 200 || !login2.json.access_token) throw new Error(`the new account cannot sign in → ${login2.status}`);
      const eh = { ...lanHdr, apikey: secrets.anonKey, Authorization: `Bearer ${login2.json.access_token}` };
      const cos = await request('GET', `${base}/_supabase/rest/v1/companies?select=id`, { headers: eh });
      if (cos.status !== 200 || cos.json.length !== 1 || cos.json[0].id !== A.companyId) throw new Error(`the new account sees ${cos.text.slice(0, 160)}`);
      // the employee cannot use the route to add others (not a manager of the company)
      const asEmp = await call({}, { email: 'staff4@e2e.test', full_name: 'Staff Four', items: [{ company_id: A.companyId, role_ids: [role.id] }] }, login2.json.access_token);
      if (asEmp.status < 400 || asEmp.json.success) throw new Error(`an employee could add a user: ${asEmp.status} ${asEmp.text.slice(0, 160)}`);
      return `no/bad session 401, cross-site + foreign Origin 403; ${role.code} account created for ${d.companies && d.companies[0] ? d.companies[0].company_name : 'the company'} with a one-time password (not in any log), accepted ${d.accepted}, signs in from ${lanIp || 'a LAN-style Host'} and sees only its company; as an employee the route refuses (${asEmp.status} ${asEmp.json.code})`;
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
      // 2.0.5 final #2 (owner 27-10): the login page says what is true and is readable - the approved texts are there, the old overclaims are gone, the navy text is at least white/75
      await R.check('5.2b the login page shows the approved texts (data stays on the device, only people with an account and permission reach it, encrypted tunnel with no open ports, the AI provider receives what it needs) in Arabic and English, no overclaim, navy-panel text >= white/75, the version line readable', async () => {
        const out = require('child_process').spawnSync('node', [path.join(__dirname, 'login-texts.cjs'), '--erp', ERP, '--ui', UI, '--shots', path.join(WORK, 'shots-login-texts')], { encoding: 'utf8', timeout: 240000 });
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
      const multipart = (file, filename, fields0 = {}) => {
        const fields = { confirmReplaceAll: 'true', ...fields0 };   // 2.0.5: replacing every company needs an explicit yes (REPLACE_ALL_CONFIRM_REQUIRED without it) - the user's click in the real page
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
      // 2.0.5 (company files, part 1): a company created NEXT TO others keeps the install's live file (its own chosen file is only recorded as planned); only the FIRST company of an empty database
      // gets its file as the live one. 7.2-7.4, 7.7b and 8.1 are about that first company: they start on an empty database, the way a new install is (the product's own /api/delete-company).
      // PostgREST + GoTrue answer (a dead service shows up HERE, with its name, instead of as a connection error three checks later)
      const servicesHealthy = async (when, ms = 60000) => {
        const t0 = Date.now(); let last = '';
        for (;;) {
          try {
            const a = await request('GET', `${API}/rest/v1/tenants?select=id&limit=1`, { headers: { apikey: secrets.anonKey, Authorization: `Bearer ${secrets.anonKey}` } });
            const g = await request('GET', `${API}/auth/v1/health`, { headers: { apikey: secrets.anonKey } });
            if (a.status > 0 && a.status < 500 && g.status === 200) return;
            last = `rest ${a.status}, auth ${g.status}`;
          } catch (e) { last = e.message; }
          if (Date.now() - t0 > ms) throw new Error(`PostgREST / GoTrue do not answer ${when}: ${last}`);
          await new Promise((r) => setTimeout(r, 500));
        }
      };
      const wipeCompanies = async () => {
        const rows = (await pg('SELECT id FROM public.companies')).rows;
        for (const c of rows) {
          const d = await api('POST', '/api/delete-company', { companyId: c.id });
          if (!d.json || !d.json.success) throw new Error(`delete-company ${c.id} → ${d.status} ${d.text.slice(0, 200)}`);
        }
        const left = (await pg('SELECT count(*)::int n FROM public.companies')).rows[0].n;
        if (left !== 0) throw new Error(`${left} companies left after the wipe`);
        await new Promise((r) => setTimeout(r, 3000));     // the delete toggles triggers on every table: PostgREST reloads its schema cache several times
        await servicesHealthy('after the wipe');
        return rows.length;
      };

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
        await wipeCompanies();      // 2.0.5: the first company of an empty database (see wipeCompanies)
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
        // 2.0.5: the first company's file stays the live one; this company's chosen file ("(2)") is only RECORDED - nothing is written under that name and no second copy is made
        const first5 = path.join(rashidDir, 'شركة الرشيد.tcdb');
        if (created2.sharedLiveFile !== true || created2.liveFilePath !== first5 || created2.tcdbPath !== first5) throw new Error(`the live file did not stay: ${JSON.stringify({ shared: created2.sharedLiveFile, live: created2.liveFilePath, tcdb: created2.tcdbPath })}`);
        if (created2.plannedTcdbPath !== path.join(rashidDir, 'شركة الرشيد (2).tcdb')) throw new Error(`planned ${created2.plannedTcdbPath}`);
        if (fs.existsSync(created2.plannedTcdbPath)) throw new Error('the planned file was written');
        if (created2.tcdbCopyPath) throw new Error(`a second copy was made for a company that does not own the live file: ${created2.tcdbCopyPath}`);
        const st5 = await status();
        if (st5.backupPath !== first5 || st5.targets.length !== 2 || !st5.targets.every((t) => t.state === 'ok')) throw new Error(`the live targets changed: ${JSON.stringify(st5.targets.map((t) => t.path))}`);
        const now = fs.readFileSync(path.join(rashidDir, 'شركة الرشيد.tcdb'));
        if (now.subarray(0, 4).toString('latin1') !== 'TCDB' || now.length < first.length * 0.5) throw new Error('the first company\'s file was replaced by something else');
        // the by-hand path never replaces a file either: asking for the same folder + name again gives "(2)"
        const manual = await api('POST', '/api/create-local-company', body({ adminEmail: 'by-hand@e2e.test', companyName: 'By hand', storagePath: rashidDir, dbFileName: 'شركة الرشيد' }));
        if (!manual.json || !manual.json.success) throw new Error(`by-hand create → ${manual.text.slice(0, 300)}`);
        if (manual.json.sharedLiveFile !== true || manual.json.plannedTcdbPath !== path.join(rashidDir, 'شركة الرشيد (3).tcdb') || manual.json.tcdbCopyPath || fs.existsSync(manual.json.plannedTcdbPath)) throw new Error(`by-hand ${JSON.stringify({ shared: manual.json.sharedLiveFile, planned: manual.json.plannedTcdbPath, copy: manual.json.tcdbCopyPath })} (a planned name is taken once: "(3)"; nothing is written)`);
        return 'the live file stays; beside: planned (2), by hand: planned (3); no file written for either, one live file only';
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
        await wipeCompanies();      // 2.0.5: the company whose program copy must survive is the FIRST of an empty database (a company created next to others does not own the live file any more)
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
      const openPicked = (ref, extra = {}) => api('POST', '/api/open-picked-tcdb', { ref, confirmReplaceAll: true, ...extra });
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
        if (!line) throw new Error(`browser step failed (exit ${out.status}${out.signal ? ', signal ' + out.signal : ''}${out.error ? ', ' + out.error.message : ''}): ${((out.stderr || '') + ' | ' + (out.stdout || '')).slice(-700)}`);
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
        const rq = res.start; const cq = res.confirm;
        // 2.0.4: the page starts the search with name + size + modification time ONLY (no content hash yet) and proves possession with the digest at the end
        if (!rq || JSON.stringify(rq.keys) !== JSON.stringify(['lastModified', 'name', 'size']) || rq.hasSha || rq.name !== 'Chooser Mine.tcdb' || rq.size !== st0.size || !rq.lastModifiedIsNumber) throw new Error(`what the page started with: ${JSON.stringify(rq)}`);
        if (!cq || JSON.stringify(cq.keys) !== JSON.stringify(['job', 'sha256']) || !cq.shaOk) throw new Error(`what the page confirmed with: ${JSON.stringify(cq)}`);
        if (res.order.indexOf('locate-start') !== 0 || res.order.indexOf('locate-confirm') < 1) throw new Error(`request order ${res.order.join(' > ')}`);
        if (!res.phases.includes('ready')) throw new Error(`phases seen: ${res.phases.join(', ')}`);
        if (res.alerts.length) throw new Error(`the page alerted: ${res.alerts.join(' | ')}`);
        if (!res.located || res.located.success !== true || res.located.type !== 'tcdb' || !res.located.hasRef || path.resolve(res.located.filePath) !== path.resolve(target)) throw new Error(`located → ${JSON.stringify(res.located)}`);
        const routes = res.routes.map((r) => `${r.route}:${r.status}`);
        if (!routes.includes('open-picked-tcdb:200') || routes.some((r) => r.startsWith('restore-tcdb') || r.startsWith('pick-company-file') || r.startsWith('locate-picked-file'))) throw new Error(`the page used ${routes.join(', ')}`);
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
        return `page started with {name,size,lastModified} (no digest), confirmed with {job,sha256}; located ${path.basename(res.located.filePath)} in locate-a; open-picked-tcdb 200; the SAME file rewritten (mtime +${Math.round(st1.mtimeMs - st0.mtimeMs)} ms); folder = [${left.join(', ')}] (no restore/truncate/auth .sql, no snapshots folder; no temp SQL left in the temp folder; ${snaps} snapshot(s) in the program's backups folder); note "${res.note.text.slice(0, 60)}…"; status line(s) seen: ${JSON.stringify(res.statusTexts)}`;
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
          const res = openInBrowser(target, `7-10c-${sub}`, sub === 'rsf-real' ? ['--delay-status', '1500'] : []);
          if (!res.located || res.located.success !== true || res.located.type !== 'rsf' || path.resolve(res.located.filePath) !== path.resolve(target)) throw new Error(`${sub}: located → ${JSON.stringify(res.located)}`);
          const planned = path.join(dir, name.replace(/\.rsf$/, '.tcdb'));
          if (res.located.companyFilePath !== planned) throw new Error(`${sub}: companyFilePath ${res.located.companyFilePath}`);
          if (!res.note || res.note.testId !== 'rsf-company-file-target' || !res.note.text.includes(planned) || !NOTE_BESIDE_RSF.test(res.note.text)) throw new Error(`${sub}: form note → ${JSON.stringify(res.note)}`);
          if (!res.start || res.start.size !== fs.statSync(target).size || res.start.hasSha || !res.confirm || !res.confirm.shaOk) throw new Error(`${sub}: requests ${JSON.stringify([res.start, res.confirm])}`);
          if (res.routes.some((r) => r.route === 'create-local-company' || r.route === 'pick-company-file')) throw new Error(`${sub}: unexpected route ${JSON.stringify(res.routes)}`);
          if (walk(dir).join('|') !== name) throw new Error(`${sub}: the search or the page wrote beside the Rashid file: ${walk(dir).join(', ')}`);
          if (sub === 'rsf-real' && !res.statusTexts.some((t) => /جارٍ تحديد مكان الملف|Locating the file|Визначення місця файлу|Определение места файла/.test(t))) throw new Error(`${sub}: the page did not show the «locating…» line while the app searched: ${JSON.stringify(res.statusTexts)}`);
          ev.push(`${name}: ${res.start.size} bytes hashed in the page only after the app said ready, located in locate-a, form «${res.note.text.slice(0, 60)}…», ${Date.now() - t0} ms incl. browser start, status line(s) seen ${JSON.stringify(res.statusTexts)}`);
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
        if (r1.located || !r1.phases.includes('not-found') || r1.confirm) throw new Error(`rsf: the job should end "not-found" without a confirm (phases ${r1.phases.join(', ')}; confirm ${JSON.stringify(r1.confirm)})`);
        const info = (await api('GET', '/api/backup-export-info')).json;
        if (!r1.note || r1.note.testId !== 'rsf-company-file-fallback' || !NOTE_NOT_LOCATED_RSF.test(r1.note.text) || !r1.note.text.includes(info.defaultDir)) throw new Error(`rsf note → ${JSON.stringify(r1.note)} (default ${info.defaultDir})`);
        const outTcdb = await exportTo(path.join(OUTSIDE, 'Outside.tcdb'));
        const c0 = await counts4(); const outSha = fileSha(outTcdb);
        const r2 = openInBrowser(outTcdb, '7-10e-tcdb');
        if (r2.located || !r2.phases.includes('not-found')) throw new Error(`tcdb: the job should end "not-found" (phases ${r2.phases.join(', ')}; located ${JSON.stringify(r2.located)})`);
        const routes = r2.routes.map((r) => `${r.route}:${r.status}`);
        if (!routes.includes('restore-tcdb:200') || routes.some((r) => r.startsWith('open-picked-tcdb'))) throw new Error(`fallback routes ${routes.join(', ')}`);
        const fallbackDir = TCDB_IN_COMPANY_FOLDER ? rashidDir : path.join(WORK, 'restore-tcdb');   // where the upload fallback writes in this run (TEXACORE_TCDB_DIR)
        const copy = path.join(fallbackDir, 'Outside.tcdb');
        if (!fs.existsSync(copy)) throw new Error(`no fallback copy at ${copy}: ${walk(fallbackDir).join(', ')}`);
        if (!r2.note || r2.note.testId !== 'live-company-file-note' || !NOTE_NOT_LOCATED_TCDB.test(r2.note.text) || !r2.note.text.includes(copy)) throw new Error(`tcdb note → ${JSON.stringify(r2.note)}`);
        if (fileSha(outTcdb) !== outSha) throw new Error('the file outside was modified');
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('the fallback restore changed the rows');
        return `rsf: job ended not-found → form line with ${info.defaultDir}; tcdb: job ended not-found → upload fallback → ${copy}; the original untouched; notes shown`;
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
          const firstP = request('POST', `${ADMIN}/api/open-picked-tcdb`, { headers: H, body: { ref: loc.ref, confirmReplaceAll: true }, timeout: 300000 });
          await new Promise((r) => setTimeout(r, 4000));
          second = await request('POST', `${ADMIN}/api/open-picked-tcdb`, { headers: H, body: { ref: loc.ref, confirmReplaceAll: true }, timeout: 60000 });
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
        const ok = await api('POST', '/api/open-picked-tcdb', { ref: loc.ref, confirmReplaceAll: true });
        if (ok.status !== 200 || !ok.json.success) throw new Error(`after the lock is gone the same file opens: ${ok.status} ${ok.text.slice(0, 200)}`);
        return `open failed (${first.status}: ${first.text.slice(0, 90)}…); second open 409 RESTORE_BUSY; picked file byte-identical, nothing beside it, no temp SQL; live target back to ${path.basename(prev)} and syncing (mtime +${Math.round(fs.statSync(prev).mtimeMs - prevMtime0)} ms); rows unchanged; the same file then opens fine`;
      });

      // ═══ 2.0.4: the macOS folder permission and iCloud placeholders, driven through the PACKAGED app with the harness hooks (POST /api/e2e-folder-access: pretend verdicts,
      //     scratch folders standing in for Desktop/Documents, files that behave like cloud placeholders) - the real privacy settings are never touched ═══
      const sim = (b) => api('POST', '/api/e2e-folder-access', b);
      const simReset = () => sim({ reset: true });
      const NOTE_WAIT = /بانتظار موافقتك|Waiting for your answer|Очікуємо вашу відповідь|Ждём вашего ответа/;
      const NOTE_CLOUD = /iCloud/;
      const NOTE_CLOUD_MB = /م\.ب|\bMB\b|МБ/;
      const NOTE_CANCELLED = /أُلغي فتح الملف|was cancelled|скасовано|отменено/;
      const NOTE_DL_FAILED = /تعذّر تنزيل الملف من iCloud|could not be downloaded from iCloud|Не вдалося завантажити файл з iCloud|Не удалось загрузить файл из iCloud/;
      const AREA_DESKTOP = /سطح المكتب|Desktop|Робочий стіл|Рабочий стол/;
      const SETTINGS_WORDS = /الملفات والمجلدات|Files & Folders|Файли й папки|Файлы и папки/;
      const mk = async (sub, name) => { const dir = path.join(LA, sub); fs.mkdirSync(dir, { recursive: true }); return exportTo(path.join(dir, name)); };
      const fallbackDirOf = () => (TCDB_IN_COMPANY_FOLDER ? rashidDir : path.join(WORK, 'restore-tcdb'));

      await R.check('7.11a (2.0.4 iCloud) a file that is only a cloud placeholder: found by name+size+time WITHOUT being read, downloaded on request with progress shown on the page («جارٍ تنزيله (x من y م.ب)» + a bar), hashed only afterwards, then opened in place', async () => {
        const target = await mk('cloud', 'Cloud Mine.tcdb');
        await simReset(); await sim({ placeholders: { [target]: { steps: 8, msPerStep: 500 } } });
        const c0 = await counts4(); const sha0 = fileSha(target);
        const res = openInBrowser(target, '7-11a');
        await simReset();
        if (!res.start || res.start.hasSha || JSON.stringify(res.start.keys) !== JSON.stringify(['lastModified', 'name', 'size'])) throw new Error(`start ${JSON.stringify(res.start)}`);
        if (!res.confirm || !res.confirm.shaOk) throw new Error(`confirm ${JSON.stringify(res.confirm)}`);
        const o = res.order; if (!(o.indexOf('locate-start') === 0 && o.indexOf('locate-materialize') > 0 && o.indexOf('locate-confirm') > o.indexOf('locate-materialize'))) throw new Error(`request order ${o.join(' > ')}`);
        if (!res.candidateStates.includes('placeholder')) throw new Error(`candidate states ${res.candidateStates.join(',')}`);
        const dl = res.statusTexts.filter((t) => NOTE_CLOUD.test(t) && NOTE_CLOUD_MB.test(t));
        if (dl.length < 2) throw new Error(`the download line was seen ${dl.length} time(s): ${JSON.stringify(res.statusTexts)}`);
        if (res.progress.length < 2 || res.progress.some((v, i) => i && v < res.progress[i - 1]) || res.progress[res.progress.length - 1] < 50) throw new Error(`progress bar values ${JSON.stringify(res.progress)}`);
        if (!res.located || res.located.success !== true || path.resolve(res.located.filePath) !== path.resolve(target)) throw new Error(`located ${JSON.stringify(res.located)}`);
        if (!res.routes.some((r) => r.route === 'open-picked-tcdb' && r.status === 200)) throw new Error(`routes ${JSON.stringify(res.routes)}`);
        if (!res.note || !res.note.text.includes(target) || !NOTE_INPLACE.test(res.note.text)) throw new Error(`note ${JSON.stringify(res.note)}`);
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('the open changed the rows');
        if (walk(path.dirname(target)).join('|') !== 'Cloud Mine.tcdb') throw new Error(`files beside: ${walk(path.dirname(target)).join(', ')}`);
        void sha0;
        return `start {name,size,time} only → ready (placeholder) → materialize → ${res.progress.length} progress values ${JSON.stringify(res.progress.slice(0, 8))}… → confirm(sha256) → open-picked-tcdb 200; download line: «${dl[dl.length - 1].slice(0, 90)}»`;
      });

      await R.check('7.11k (2.0.4 iCloud + Rashid) the REAL 25 MB Rashid file as an iCloud placeholder: located without being read, downloaded with progress, read FROM DISK through the app (not a second browser read), the company file is planned beside it, and the form\'s «جارٍ قراءة عملة الملف…» ENDS with the file\'s currency (UAH) selected - no read-failure box', async () => {
        const dir = path.join(LA, 'rsf-cloud'); fs.mkdirSync(dir, { recursive: true });
        const target = path.join(dir, '2023 مطور بعد الصيانة.rsf'); fs.copyFileSync(RSF, target);
        await simReset(); await sim({ placeholders: { [target]: { steps: 6, msPerStep: 400 } } });
        const res = openInBrowser(target, '7-11k', ['--wait-currency']);
        await simReset();
        if (!res.start || res.start.hasSha || res.start.size !== fs.statSync(target).size) throw new Error(`start ${JSON.stringify(res.start)}`);
        if (!res.candidateStates.includes('placeholder') || !res.order.includes('locate-materialize')) throw new Error(`states ${res.candidateStates.join(',')} order ${res.order.join('>')}`);
        const dl = res.statusTexts.filter((t) => NOTE_CLOUD.test(t) && NOTE_CLOUD_MB.test(t));
        // the progress line names the file's size in MB (the owner's real file is ~24 MB; the 2.9 MB sample says «x of 2.8 MB») - compare with the size of the file this run was given
        const mbText = (fs.statSync(target).size / 1048576).toFixed(1);
        if (!dl.length || !dl.some((t) => t.includes(mbText) || /24\.\d|23\.\d|\b2[34]\b/.test(t))) throw new Error(`download lines (file is ${mbText} MB) ${JSON.stringify(res.statusTexts)}`);
        if (!res.located || res.located.success !== true || res.located.type !== 'rsf' || path.resolve(res.located.filePath) !== path.resolve(target)) throw new Error(`located ${JSON.stringify(res.located)}`);
        if (!res.routes.some((r) => r.route === 'picked-file' && r.status === 200)) throw new Error(`the page did not read the located file through the app: ${JSON.stringify(res.routes)}`);
        const planned = path.join(dir, '2023 مطور بعد الصيانة.tcdb');
        if (!res.note || res.note.testId !== 'rsf-company-file-target' || !res.note.text.includes(planned)) throw new Error(`form note ${JSON.stringify(res.note)}`);
        if (!res.currency || !res.currency.ended || res.currency.failureShown) throw new Error(`currency read ${JSON.stringify(res.currency)}`);
        // the owner's real file is in UAH; the 2.9 MB sample (Sample.rsf) is a Syrian company in SYP with USD as the second currency - the page must show the file's OWN currency either way
        const wantCur = /sample/i.test(path.basename(RSF)) ? 'SYP' : 'UAH';
        if (!new RegExp(wantCur).test(res.currency.detected) && !res.currency.combos.some((t) => new RegExp(wantCur).test(t))) throw new Error(`the file's currency (${wantCur}) is not shown: ${JSON.stringify(res.currency)}`);
        if (walk(dir).join('|') !== '2023 مطور بعد الصيانة.rsf') throw new Error(`files beside: ${walk(dir).join(', ')}`);
        return `download line «${dl[dl.length - 1].slice(0, 80)}»; located; read via GET /api/picked-file; form: company file planned beside the .rsf; currency read ended in ${res.currency.ms} ms: «${res.currency.detected}»`;
      });

      await R.check('7.11b (2.0.4 iCloud) cancelling the download: nothing is opened, the page says so, the file and the rows are untouched', async () => {
        const target = await mk('cloud-cancel', 'Cloud Cancel.tcdb');
        await simReset(); await sim({ placeholders: { [target]: { steps: 60, msPerStep: 400 } } });
        const c0 = await counts4(); const sha0 = fileSha(target);
        const res = openInBrowser(target, '7-11b', ['--click-cancel-at', '8']);
        await simReset();
        if (!res.cancelClicked) throw new Error(`the cancel button was never pressed (progress ${JSON.stringify(res.progress)})`);
        if (!res.order.includes('locate-cancel')) throw new Error(`the app was not told to stop: ${res.order.join(' > ')}`);
        if (res.routes.some((r) => /open-picked-tcdb|restore-tcdb|pick-company-file/.test(r.route)) || res.located) throw new Error(`something was opened: ${JSON.stringify(res.routes)}`);
        if (!res.finalNotice || !NOTE_CANCELLED.test(res.finalNotice) || res.alerts.length) throw new Error(`final notice ${res.finalNotice} / alerts ${res.alerts.join('|')}`);
        if (fileSha(target) !== sha0 || JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('the file or the rows changed');
        return `cancel pressed at ${res.progress[res.progress.length - 1]}%; locate-cancel sent; no open/restore; notice «${res.finalNotice}»`;
      });

      await R.check('7.11c (2.0.4 iCloud) a download that FAILS ends with an actionable message, not a spinner: nothing is opened', async () => {
        const target = await mk('cloud-fail', 'Cloud Fail.tcdb');
        await simReset(); await sim({ placeholders: { [target]: { fail: 'DOWNLOAD_STALLED' } } });
        const res = openInBrowser(target, '7-11c');
        await simReset();
        if (!res.finalNotice || !NOTE_DL_FAILED.test(res.finalNotice)) throw new Error(`final notice ${JSON.stringify(res.finalNotice)} statusTexts ${JSON.stringify(res.statusTexts)}`);
        if (res.routes.some((r) => /open-picked-tcdb|restore-tcdb/.test(r.route)) || res.located || res.alerts.length) throw new Error(`routes ${JSON.stringify(res.routes)} alerts ${res.alerts.join('|')}`);
        return `message: «${res.finalNotice.slice(0, 110)}…»; no open`;
      });

      await R.check('7.11d (2.0.4 macOS permission) while the system prompt is up the page WAITS and says so (the area named); the moment the user allows, the search continues by itself and the file is opened in place', async () => {
        const target = await mk('perm-pending', 'Perm Pending.tcdb');
        await simReset(); await sim({ kinds: { [LA]: 'desktop' }, sim: { desktop: { state: 'allowed', delayMs: 5000 } } });
        const c0 = await counts4();
        const res = openInBrowser(target, '7-11d');
        await simReset();
        const waits = res.statusTexts.filter((t) => NOTE_WAIT.test(t) && AREA_DESKTOP.test(t));
        if (!waits.length || !res.phases.includes('waiting-permission')) throw new Error(`waiting line not seen: texts ${JSON.stringify(res.statusTexts)} phases ${res.phases.join(',')}`);
        if (!res.located || res.located.success !== true || path.resolve(res.located.filePath) !== path.resolve(target)) throw new Error(`located ${JSON.stringify(res.located)}`);
        if (!res.note || !NOTE_INPLACE.test(res.note.text)) throw new Error(`note ${JSON.stringify(res.note)}`);
        if (res.permission.seen) throw new Error('the permission step appeared although the answer was yes');
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('the open changed the rows');
        return `phases ${res.phases.join(' > ')}; waiting line «${waits[0].slice(0, 100)}…»; then located + opened in place`;
      });

      await R.check('7.11e (2.0.4 macOS permission) «Don\'t Allow»: the page shows the permission step (the area, where to switch it on, a button that makes the APP open System Settings, «أعد المحاولة»); «try again» while it is still off says so; after the user allows, «try again» finds and opens the file', async () => {
        const target = await mk('perm-denied', 'Perm Denied.tcdb');
        await simReset(); await sim({ kinds: { [LA]: 'desktop' }, sim: { desktop: { state: 'denied' } } });
        const c0 = await counts4();
        const res = openInBrowser(target, '7-11e', ['--perm-script', JSON.stringify([{ click: 'perm-open-settings' }, { click: 'perm-retry' }, { sim: { desktop: { state: 'allowed' } } }, { click: 'perm-retry' }])]);
        const after = (await sim({})).json;
        await simReset();
        if (!res.permission.seen || res.permission.mode !== 'denied') throw new Error(`permission step ${JSON.stringify(res.permission)}`);
        if (!AREA_DESKTOP.test(res.permission.title) || !SETTINGS_WORDS.test(res.permission.body)) throw new Error(`step text: ${res.permission.title} / ${res.permission.body}`);
        if (!res.permission.still) throw new Error('«try again» while the permission is still off did not say so');
        if (res.permission.actions.join(',') !== 'click:perm-open-settings,click:perm-retry,sim,click:perm-retry') throw new Error(`actions ${res.permission.actions.join(',')}`);
        if (!res.routes.some((r) => r.route === 'open-privacy-settings' && r.status === 200) || after.settingsOpened !== 1) throw new Error(`the app was asked to open the settings ${after.settingsOpened} time(s); routes ${JSON.stringify(res.routes)}`);
        if (!res.located || res.located.success !== true || path.resolve(res.located.filePath) !== path.resolve(target)) throw new Error(`located ${JSON.stringify(res.located)}`);
        if (!res.note || !NOTE_INPLACE.test(res.note.text)) throw new Error(`note ${JSON.stringify(res.note)}`);
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('the open changed the rows');
        return `step «${res.permission.title}», still-off message «${res.permission.still.slice(0, 70)}…», settings opened ${after.settingsOpened}x by the app, then found + opened in place`;
      });

      await R.check('7.11f (2.0.4 macOS permission) «continue without locating»: denied + the user skips -> the usual fallback (a copy in the TexaCore folder, the login view says where); the chosen file is untouched', async () => {
        const target = await mk('perm-skip', 'Perm Skip.tcdb');
        await simReset(); await sim({ kinds: { [LA]: 'desktop' }, sim: { desktop: { state: 'denied' } } });
        const sha0 = fileSha(target); const c0 = await counts4();
        const res = openInBrowser(target, '7-11f', ['--perm-script', JSON.stringify([{ click: 'perm-skip' }])]);
        await simReset();
        if (!res.permission.seen) throw new Error('no permission step');
        if (res.located || !res.routes.some((r) => r.route === 'restore-tcdb' && r.status === 200) || res.routes.some((r) => r.route === 'open-picked-tcdb')) throw new Error(`routes ${JSON.stringify(res.routes)}`);
        const copy = path.join(fallbackDirOf(), 'Perm Skip.tcdb');
        if (!fs.existsSync(copy) || !res.note || !NOTE_NOT_LOCATED_TCDB.test(res.note.text) || !res.note.text.includes(copy)) throw new Error(`copy ${fs.existsSync(copy)} note ${JSON.stringify(res.note)}`);
        if (fileSha(target) !== sha0) throw new Error('the chosen file changed');
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('the fallback restore changed the rows');
        return `step shown, skipped -> upload fallback -> ${copy}; note shown; original untouched`;
      });

      await R.check('7.11g (2.0.4 macOS permission) the user does not want to wait for the prompt: «تابع بدون تحديد مكان الملف» on the waiting line goes straight to the fallback', async () => {
        const target = await mk('perm-wait-skip', 'Perm Wait Skip.tcdb');
        await simReset(); await sim({ kinds: { [LA]: 'desktop' }, sim: { desktop: { state: 'allowed', delayMs: 25000 } } });
        const res = openInBrowser(target, '7-11g', ['--click-skip-when-waiting']);
        await simReset();
        if (!res.skipClicked) throw new Error(`the skip button was never there: texts ${JSON.stringify(res.statusTexts)}`);
        const copy = path.join(fallbackDirOf(), 'Perm Wait Skip.tcdb');
        if (res.located || !res.routes.some((r) => r.route === 'restore-tcdb' && r.status === 200) || !fs.existsSync(copy)) throw new Error(`routes ${JSON.stringify(res.routes)} copy ${fs.existsSync(copy)}`);
        if (!res.note || !NOTE_NOT_LOCATED_TCDB.test(res.note.text)) throw new Error(`note ${JSON.stringify(res.note)}`);
        return 'skipped while macOS was asking -> upload fallback, note shown';
      });

      await R.check('7.11h (2.0.4 company creation) the company file\'s folder is "Documents" and macOS has not allowed it: the app answers FOLDER_PERMISSION (403 shape: area + state) BEFORE creating anything - no tenant, no user, no company, no folder - and for a still-open prompt says "pending"', async () => {
        const docs = path.join(LB, 'new-company-folder');
        await simReset(); await sim({ kinds: { [docs]: 'documents' }, sim: { documents: { state: 'denied' } } });
        const c0 = await counts4();
        const r1 = await api('POST', '/api/create-local-company', body({ companyName: 'Perm Denied Co', adminEmail: 'perm@e2e.test', storagePath: docs, dbFileName: 'permco' }));
        if (r1.json.success !== false || r1.json.code !== 'FOLDER_PERMISSION' || r1.json.area !== 'documents' || r1.json.state !== 'denied') throw new Error(`denied → ${r1.status} ${r1.text.slice(0, 220)}`);
        await sim({ sim: { documents: { state: 'allowed', delayMs: 15000 } } });
        const t0 = Date.now();
        const r2 = await api('POST', '/api/create-local-company', body({ companyName: 'Perm Pending Co', adminEmail: 'perm2@e2e.test', storagePath: docs, dbFileName: 'permco2' }));
        const waited = Date.now() - t0;
        if (r2.json.code !== 'FOLDER_PERMISSION' || r2.json.state !== 'pending') throw new Error(`pending → ${r2.status} ${r2.text.slice(0, 220)}`);
        if (waited > 12000) throw new Error(`the app waited ${waited} ms for the prompt (it must answer in a few seconds)`);
        await simReset();
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('a refused creation left rows behind');
        if (fs.existsSync(docs)) throw new Error('the folder was created although macOS had not allowed it');
        const ns = await pg("SELECT count(*)::int n FROM auth.users WHERE email IN ('perm@e2e.test','perm2@e2e.test')");
        if (ns.rows[0].n !== 0) throw new Error('an admin user was left behind');
        return `denied -> FOLDER_PERMISSION {area: documents, state: denied}; pending -> FOLDER_PERMISSION {state: pending} after ${waited} ms; nothing created`;
      });

      await R.check('7.11i (2.0.4 company file in the program\'s folder) the .tcdb upload fallback with «folder=program»: a denied Documents folder -> 403 FOLDER_PERMISSION and NOTHING written; the user\'s «keep it in the program\'s folder» choice restores into <app data>/company-files with no macOS permission', async () => {
        const dir = fallbackDirOf();
        const src = await mk('upload-program', 'Upload Program.tcdb');
        const c0 = await counts4();
        await simReset(); await sim({ kinds: { [dir]: 'documents' }, sim: { documents: { state: 'denied' } } });
        const before = walk(dir);
        const m1 = multipart(fs.readFileSync(src), 'Upload Program.tcdb', {});
        const r1 = await rawRequest('POST', `${UI}/api/restore-tcdb`, { headers: { ...H, 'Content-Type': m1.ct }, body: m1.body });
        const j1 = JSON.parse(r1.buf.toString('utf8'));
        if (r1.status !== 403 || j1.code !== 'FOLDER_PERMISSION' || j1.area !== 'documents') throw new Error(`denied → ${r1.status} ${r1.buf.toString('utf8').slice(0, 200)}`);
        if (walk(dir).join('|') !== before.join('|')) throw new Error('something was written although the folder was not allowed');
        const m2 = multipart(fs.readFileSync(src), 'Upload Program.tcdb', { folder: 'program' });
        const r2 = await rawRequest('POST', `${UI}/api/restore-tcdb`, { headers: { ...H, 'Content-Type': m2.ct }, body: m2.body });
        const j2 = JSON.parse(r2.buf.toString('utf8'));
        const progDir = path.join(userData, 'texacore-data', 'company-files');
        if (r2.status !== 200 || !j2.success || path.resolve(path.dirname(j2.tcdbPath)) !== path.resolve(progDir) || !fs.existsSync(j2.tcdbPath)) throw new Error(`program folder → ${r2.status} ${r2.buf.toString('utf8').slice(0, 220)}`);
        await simReset();
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('the restore changed the rows');
        return `denied -> 403 FOLDER_PERMISSION, ${dir} untouched; folder=program -> ${j2.tcdbPath}`;
      });

      await R.check('7.11j (2.0.4 minute sync) the company file is in a folder macOS has stopped allowing (after an update the grant is gone): the sync does NOT write, does NOT freeze, and says why (no-permission + the area); when the permission is back the next sync writes', async () => {
        const dir = path.join(LA, 'sync-perm'); fs.mkdirSync(dir, { recursive: true });
        const target = await exportTo(path.join(dir, 'Sync Perm.tcdb'));
        await simReset();
        const loc = (await locateApi(bodyOf(target))).json;
        const opened = await api('POST', '/api/open-picked-tcdb', { ref: loc.ref, confirmReplaceAll: true });
        if (opened.status !== 200) throw new Error(`open → ${opened.status} ${opened.text.slice(0, 160)}`);
        await waitFor(async () => { const s_ = await status(); return s_.backupPath && path.resolve(s_.backupPath) === path.resolve(target); }, 'the file as the live target');
        await api('POST', '/api/backup', {});
        await sim({ kinds: { [LA]: 'desktop' }, sim: { desktop: { state: 'denied' } } });
        const st0 = fs.statSync(target); const sha0 = fileSha(target);
        await new Promise((r) => setTimeout(r, 1800));   // (the allowed verdict of the first tick is trusted for a short while; forget it)
        const t0 = Date.now();
        const blocked = await waitFor(async () => { await api('POST', '/api/backup', {}); const s_ = await status(); return s_.accessBlock ? s_ : null; }, 'the blocked state', 30000);
        const took = Date.now() - t0;
        if (blocked.accessBlock.state !== 'denied' || blocked.accessBlock.area !== 'desktop') throw new Error(`accessBlock ${JSON.stringify(blocked.accessBlock)}`);
        const tgt = (blocked.targets || []).find((x) => x.role === 'primary');
        if (!tgt || !tgt.error || tgt.error.reason !== 'macos-permission' || tgt.state !== 'error') throw new Error(`primary target ${JSON.stringify(tgt)}`);
        if (fileSha(target) !== sha0 || fs.statSync(target).mtimeMs !== st0.mtimeMs) throw new Error('the file was written although the permission was missing');
        await sim({ sim: { desktop: { state: 'allowed' } } });
        await waitFor(async () => { await api('POST', '/api/backup', {}); const s_ = await status(); return !s_.accessBlock && fs.statSync(target).mtimeMs > st0.mtimeMs; }, 'the sync writing again', 40000);
        await simReset();
        return `denied: accessBlock {desktop,denied}, target error macos-permission, file untouched (answered in ${took} ms); allowed: the next sync wrote the file again`;
      });

      await R.check('7.12 (2.0.4 security S3) a crafted company file with a psql meta-command / COPY PROGRAM / DO block is refused: a psql meta-command after the SET lines, a "COPY … PROGRAM", a DO block - each is refused 422 TCDB_UNSAFE_SQL BEFORE anything is touched (rows, live target, file), nothing runs (no marker file), no temp SQL is left', async () => {
        const BM = require('../../src/backup-manager');
        const real = await mk('crafted', 'Crafted Source.tcdb');
        const bm = new BM({ pgBinDir: '/x', encryptionKey: 'texacore-default-backup-key-2026', backupPath: real });
        const dump = await bm._decompress(bm._decryptParsed(bm._parseTcdbFile(fs.readFileSync(real)), '').data);
        const marker = path.join(WORK, 'S3-MARKER-SHOULD-NOT-EXIST');
        const craft = async (name, inject) => {
          const text = dump.toString('utf8');
          const i = text.indexOf('SET client_encoding');
          const evil = Buffer.from(text.slice(0, i) + inject + '\n' + text.slice(i), 'utf8');
          const compressed = await bm._compress(evil);
          const file = path.join(OUTSIDE, name);
          fs.writeFileSync(file, bm._buildTcdbFile(bm._encrypt(compressed), evil.length, compressed.length));
          return file;
        };
        const c0 = await counts4(); const st0 = await status();
        const cases = [
          ['meta.tcdb', `\\! touch "${marker}"`],
          ['meta2.tcdb', `SELECT 1 \\gexec \\! touch "${marker}"`],
          ['program.tcdb', `COPY public.companies FROM PROGRAM 'touch "${marker}"';`],
          ['do.tcdb', `DO $$ BEGIN EXECUTE 'COPY (SELECT 1) TO PROGRAM ''touch ${marker}'''; END $$;`],
        ];
        const ev = [];
        for (const [name, inject] of cases) {
          const f = await craft(name, inject);
          const m = multipart(fs.readFileSync(f), name, {});
          const r = await rawRequest('POST', `${UI}/api/restore-tcdb`, { headers: { ...H, 'Content-Type': m.ct }, body: m.body });
          const j = JSON.parse(r.buf.toString('utf8'));
          if (r.status !== 422 || j.code !== 'TCDB_UNSAFE_SQL') throw new Error(`${name}: ${r.status} ${r.buf.toString('utf8').slice(0, 200)}`);
          if (j.error.includes(marker)) throw new Error(`${name}: the answer repeats the command`);
          ev.push(`${name} 422`);
        }
        // the in-place route too
        const f2 = await craft('meta-inplace.tcdb', `\\! touch "${marker}"`);
        const f2in = path.join(LA, 'crafted', 'meta-inplace.tcdb'); fs.mkdirSync(path.dirname(f2in), { recursive: true }); fs.copyFileSync(f2, f2in);   // (inside a searched folder, so the app can locate it)
        const loc = (await locateApi(bodyOf(f2in))).json;
        if (!loc.success) throw new Error(`could not locate the crafted file: ${JSON.stringify(loc).slice(0, 160)}`);
        const op = await api('POST', '/api/open-picked-tcdb', { ref: loc.ref, confirmReplaceAll: true });
        if (op.status !== 422 || op.json.code !== 'TCDB_UNSAFE_SQL') throw new Error(`open-picked-tcdb → ${op.status} ${op.text.slice(0, 200)}`);
        if (fs.existsSync(marker)) throw new Error('A COMMAND RAN: the marker file exists');
        if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('a refused file changed the rows');
        const st1 = await status();
        if (path.resolve(st1.backupPath || '') !== path.resolve(st0.backupPath || '')) throw new Error(`the live target moved: ${st0.backupPath} -> ${st1.backupPath}`);
        const tmpLeft = fs.readdirSync(os.tmpdir()).filter((x) => new RegExp(`^texacore-(restore|truncate|auth)-${child.pid}-[0-9a-f]+\\.sql$`).test(x));
        if (tmpLeft.length) throw new Error(`temporary SQL left: ${tmpLeft.join(', ')}`);
        const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
        if (log.includes(marker)) throw new Error('the command text reached the log');
        return `${ev.join(', ')}, open-picked-tcdb 422; no marker; rows + live target unchanged; no temp SQL; the command text is in no answer and no log`;
      });

      await R.check('7.12b (2.0.4 security F1) a company file is restored as DATA: a guard-clean file that plants a trigger on a real table, a function that builds a dangerous statement from pieces and a replacement of a shipped SECURITY DEFINER function is restored for real (200) - and none of it exists afterwards (no function, no trigger, no table, no marker, the shipped function byte-identical); the same file with ENABLE ALWAYS is refused 422; every table of the file comes back with exactly the rows the file holds', async () => {
        const BM = require('../../src/backup-manager');
        const sg = require('../../src/sql-guard');
        const real = await mk('crafted-f1', 'F1 Source.tcdb');
        const bm = new BM({ pgBinDir: '/x', encryptionKey: 'texacore-default-backup-key-2026', backupPath: real });
        const dump = await bm._decompress(bm._decryptParsed(bm._parseTcdbFile(fs.readFileSync(real)), '').data);
        const marker = path.join(WORK, 'F1-MARKER-SHOULD-NOT-EXIST');
        const shipped = (await pg("SELECT p.proname, md5(p.prosrc) AS m FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.pronargs = 0 AND p.prorettype = 'void'::regtype ORDER BY 1 LIMIT 1")).rows[0];
        if (!shipped) throw new Error('no shipped SECURITY DEFINER function to replace');
        const planted = [
          'CREATE TABLE public.f1_marker (note text);',
          "CREATE FUNCTION public.f1_evil() RETURNS trigger LANGUAGE plpgsql AS $x$ BEGIN INSERT INTO public.f1_marker VALUES ('ran as ' || current_user); RETURN NEW; END $x$;",
          `CREATE FUNCTION public.f1_split() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $x$ BEGIN EXECUTE 'COPY (SELECT 1) TO PROG' || 'RAM ''touch ${marker}'''; RETURN NEW; END $x$;`,
          'CREATE TRIGGER f1_trg BEFORE INSERT OR UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.f1_evil();',
          'CREATE TRIGGER f1_trg2 BEFORE INSERT OR UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.f1_split();',
          `CREATE OR REPLACE FUNCTION public.${shipped.proname}() RETURNS void LANGUAGE sql SECURITY DEFINER AS $x$ SELECT 1 $x$;`,
        ].join('\n') + '\n';
        const craft = async (name, extra) => {
          const text = dump.toString('utf8');
          const i = text.lastIndexOf('\\unrestrict');
          const evil = Buffer.from(text.slice(0, i) + planted + extra + text.slice(i), 'utf8');
          const compressed = await bm._compress(evil);
          const file = path.join(OUTSIDE, name);
          fs.writeFileSync(file, bm._buildTcdbFile(bm._encrypt(compressed), evil.length, compressed.length));
          return { file, evil };
        };
        const upload = async (file, name) => {
          const m = multipart(fs.readFileSync(file), name, {});
          const r = await rawRequest('POST', `${UI}/api/restore-tcdb`, { headers: { ...H, 'Content-Type': m.ct }, body: m.body });
          return { status: r.status, json: JSON.parse(r.buf.toString('utf8')) };
        };
        // the scan alone sees nothing wrong with the planted code (a real file is full of functions and triggers) - this is why the restore must not run it
        const clean = await craft('f1-clean.tcdb', '');
        const rep = sg.scanDump(clean.evil);
        if (rep.findings.length) throw new Error(`the planted file is expected to be guard-clean, findings ${JSON.stringify(rep.findings.slice(0, 3))}`);
        // ENABLE ALWAYS is refused outright
        const always = await craft('f1-always.tcdb', 'ALTER TABLE public.companies ENABLE ALWAYS TRIGGER f1_trg;\n');
        const refused = await upload(always.file, 'f1-always.tcdb');
        if (refused.status !== 422 || refused.json.code !== 'TCDB_UNSAFE_SQL') throw new Error(`ENABLE ALWAYS -> ${refused.status} ${JSON.stringify(refused.json).slice(0, 200)}`);
        // the guard-clean file IS restored - as data
        const up = await upload(clean.file, 'f1-clean.tcdb');
        if (up.status !== 200 || !up.json.success) throw new Error(`restore -> ${up.status} ${JSON.stringify(up.json).slice(0, 300)}`);
        const left = (await pg("SELECT (SELECT count(*) FROM pg_proc WHERE proname IN ('f1_evil', 'f1_split'))::int fns, (SELECT count(*) FROM pg_trigger WHERE tgname IN ('f1_trg', 'f1_trg2'))::int trg, (SELECT to_regclass('public.f1_marker') IS NOT NULL) tbl, (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure($1)) m", [`public.${shipped.proname}()`])).rows[0];
        if (left.fns !== 0 || left.trg !== 0 || left.tbl) throw new Error(`planted objects exist: ${JSON.stringify(left)}`);
        if (left.m !== shipped.m) throw new Error(`the shipped function ${shipped.proname} was replaced`);
        if (fs.existsSync(marker)) throw new Error('A COMMAND RAN: the marker file exists');
        // every table of the file has exactly the rows the file holds (the restore replaced the data: nothing lost, nothing extra)
        const plan = sg.planDataRestore(clean.evil);
        const rows = (b) => { let n = 0; for (let k = b.start; k < b.end; k++) if (clean.evil[k] === 0x0a) n++; return n; };
        const bad = []; let checked = 0; let total = 0;
        for (const b of plan.blocks.filter((x) => x.schema === 'public')) {
          const q = `SELECT count(*)::int n FROM "${b.table.replace(/"/g, '""')}"`;
          let n; try { n = (await pg(q)).rows[0].n; } catch (e) { bad.push(`${b.table}: ${String(e.message).slice(0, 60)}`); continue; }
          checked++; total += rows(b);
          if (n !== rows(b)) bad.push(`${b.table}: db ${n} vs file ${rows(b)}`);
        }
        const tolerated = /^(activity_log|audit_logs|sync_|notifications|license|app_settings|user_sessions)/;
        const real_bad = bad.filter((x) => !tolerated.test(x));
        if (real_bad.length) throw new Error(`row counts differ from the file: ${real_bad.slice(0, 8).join('; ')} (${bad.length} total)`);
        return `ENABLE ALWAYS refused 422; the guard-clean planted file restored 200 as data: no function, no trigger, no table, no marker, ${shipped.proname}() byte-identical; ${checked} tables / ${total} rows equal to the file${bad.length ? ` (${bad.length} app-written tables tolerated: ${bad.slice(0, 4).join('; ')})` : ''}; ${up.json.dataOnly ? `dataOnly ${JSON.stringify(up.json.dataOnly).slice(0, 160)}` : ''}`;
      });

      await R.check('7.13 (2.0.4) the new routes are behind the same guards and tell nothing they should not: no secret 401, wrong secret 401, a LAN Host refused, a foreign Origin refused; the job status never carries a path; the folder-access answer has the areas', async () => {
        const target = await mk('guards204', 'Guards 204.tcdb');
        const routes = [['POST', '/api/locate-start', { name: 'a.rsf', size: 10, lastModified: 1 }], ['GET', '/api/locate-status?job=x'], ['POST', '/api/locate-materialize', { job: 'x' }], ['POST', '/api/locate-cancel', { job: 'x' }],
          ['POST', '/api/locate-confirm', { job: 'x', sha256: 'a'.repeat(64) }], ['GET', '/api/folder-access?kinds=desktop'], ['POST', '/api/open-privacy-settings', {}], ['POST', '/api/e2e-folder-access', {}]];
        for (const [m, p_, b] of routes) {
          const none = await request(m, `${ADMIN}${p_}`, { body: b });
          if (none.status !== 401) throw new Error(`${p_} without the secret -> ${none.status}`);
          const wrong = await request(m, `${ADMIN}${p_}`, { headers: { 'x-texacore-local-secret': 'nope' }, body: b });
          if (wrong.status !== 401) throw new Error(`${p_} wrong secret -> ${wrong.status}`);
          const lan = await request(m, `${ADMIN}${p_}`, { headers: { ...H, Host: '192.168.77.20:80' }, body: b });
          if (lan.status !== 403) throw new Error(`${p_} LAN Host -> ${lan.status}`);
          const foreign = await request(m, `${ADMIN}${p_}`, { headers: { ...H, Origin: 'https://evil.example' }, body: b });
          if (foreign.status !== 403) throw new Error(`${p_} foreign Origin -> ${foreign.status}`);
        }
        const bad = await api('POST', '/api/locate-start', { name: '../x.rsf', size: 10, lastModified: 1 });
        if (bad.status !== 400 || bad.json.code !== 'BAD_REQUEST') throw new Error(`a bad name -> ${bad.status} ${bad.text.slice(0, 120)}`);
        const gone = await api('GET', '/api/locate-status?job=' + 'f'.repeat(24));
        if (gone.status !== 404 || gone.json.code !== 'JOB_EXPIRED') throw new Error(`an unknown job -> ${gone.status} ${gone.text.slice(0, 120)}`);
        const early = await api('POST', '/api/locate-confirm', { job: 'f'.repeat(24), sha256: 'a'.repeat(64) });
        if (early.status !== 404) throw new Error(`confirm of an unknown job -> ${early.status}`);
        // a real job: its status never reveals a path, a wrong digest finds nothing and answers no path
        const st = await api('POST', '/api/locate-start', { name: path.basename(target), size: fs.statSync(target).size, lastModified: Math.round(fs.statSync(target).mtimeMs) });
        if (!st.json.job) throw new Error(`start -> ${st.text.slice(0, 200)}`);
        const done = await waitFor(async () => { const s_ = (await api('GET', `/api/locate-status?job=${st.json.job}`)).json; return s_.phase !== 'searching' && s_.phase !== 'waiting-permission' ? s_ : null; }, 'the job to finish', 60000);
        const text = JSON.stringify(done);
        if (text.includes(WORK) || text.includes(path.basename(path.dirname(target))) || /filePath|"dir"/.test(text)) throw new Error(`the status reveals a path: ${text.slice(0, 300)}`);
        if (done.phase !== 'ready' || done.candidates.length !== 1 || done.candidates[0].state !== 'local') throw new Error(`status ${text.slice(0, 300)}`);
        const wrongDigest = await api('POST', '/api/locate-confirm', { job: st.json.job, sha256: sha(Buffer.from('somebody else')) });
        if (wrongDigest.status !== 200 || wrongDigest.json.success !== false || wrongDigest.json.code !== 'NOT_FOUND' || /filePath|"ref"/.test(wrongDigest.text)) throw new Error(`a wrong digest -> ${wrongDigest.status} ${wrongDigest.text.slice(0, 200)}`);
        const right = await api('POST', '/api/locate-confirm', { job: st.json.job, sha256: fileSha(target) });
        if (!right.json.success || path.resolve(right.json.filePath) !== path.resolve(target)) throw new Error(`the right digest -> ${right.text.slice(0, 200)}`);
        const fa = (await api('GET', '/api/folder-access?kinds=desktop,documents,downloads')).json;
        if (!fa.success || !fa.areas || !fa.areas.desktop || !fa.areas.documents || !fa.areas.downloads) throw new Error(`folder-access -> ${JSON.stringify(fa)}`);
        return `${routes.length} routes x (no secret / wrong secret / LAN Host / foreign Origin) all refused; bad name 400; unknown job 404 JOB_EXPIRED; status = ${text.length} bytes without a path; wrong digest -> NOT_FOUND without a path; right digest -> the file; folder-access areas ${Object.keys(fa.areas).join(',')} (${Object.values(fa.areas).map((a) => a.state).join(',')})`;
      });

      await R.check('7.14 (2.0.4 security S5) /config.js hands the admin secret ONLY to a request that carries a same-origin signal: a bare loopback client (no Sec-Fetch-Site, no Origin, no Referer) gets none; Sec-Fetch-Site same-origin / none, or a same-origin Referer, does; cross-site / a foreign Origin / a foreign Referer does not', async () => {
        const has = (r) => r.text.includes(secrets.localApiSecret);
        const bare = await request('GET', `${UI}/config.js`, { headers: {} });
        const same = await request('GET', `${UI}/config.js`, { headers: { 'Sec-Fetch-Site': 'same-origin' } });
        const none = await request('GET', `${UI}/config.js`, { headers: { 'Sec-Fetch-Site': 'none' } });
        const cross = await request('GET', `${UI}/config.js`, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
        const origin = await request('GET', `${UI}/config.js`, { headers: { Origin: 'https://evil.example' } });
        const refOk = await request('GET', `${UI}/config.js`, { headers: { Referer: `${UI}/login` } });
        const refBad = await request('GET', `${UI}/config.js`, { headers: { Referer: 'https://evil.example/login' } });
        if (has(bare)) throw new Error('a bare loopback client received the admin secret');
        if (!has(same) || !has(none) || !has(refOk)) throw new Error(`a same-origin page did not get it: same=${has(same)} none=${has(none)} referer=${has(refOk)}`);
        if (has(cross) || has(origin) || has(refBad)) throw new Error(`cross-site=${has(cross)} origin=${has(origin)} referer=${has(refBad)}`);
        for (const r of [bare, same, cross]) if (!r.text.includes(secrets.anonKey)) throw new Error('the public anon key is missing from config.js');
        return 'bare -> no secret; same-origin / none / same-origin Referer -> secret; cross-site / foreign Origin / foreign Referer -> none; the anon key is always there';
      });

      // ═══ 2.0.5 company files (part 1): replacing every company needs an explicit yes, and what is replaced is saved first ═══
      await R.check('7.13 (2.0.5) replacing every company needs an explicit yes: an upload without it is refused 409 (REPLACE_ALL_CONFIRM_REQUIRED) BEFORE anything is written and NOTHING changes; with the yes it works and a .tcdb of what was replaced is saved first (backups/pre-open)', async () => {
        const exp = await api('POST', '/api/export-backup', { mode: 'company-folder', fileBase: 'TexaCore-GATE' });
        if (!exp.json || !exp.json.success) throw new Error(`export → ${exp.text.slice(0, 200)}`);
        const bytes = fs.readFileSync(exp.json.path);
        const preDir = path.join(userData, 'texacore-data', 'backups', 'pre-open');
        const listPre = () => (fs.existsSync(preDir) ? fs.readdirSync(preDir).filter((f) => /^before-open-.*\.tcdb$/.test(f)).sort() : []);
        const restoreDir = TCDB_IN_COMPANY_FOLDER ? rashidDir : path.join(WORK, 'restore-tcdb');
        const filesBefore = fs.existsSync(restoreDir) ? fs.readdirSync(restoreDir).sort().join('|') : '';
        const c0 = await rowCounts(); const pre0 = listPre();
        const nCompanies = (await pg('SELECT count(*)::int n FROM public.companies')).rows[0].n;
        if (nCompanies < 1) throw new Error('the scenario needs at least one company in the database');
        const m0 = multipart(bytes, 'gate.tcdb', { confirmReplaceAll: 'false' });
        const no = await rawRequest('POST', `${UI}/api/restore-tcdb`, { headers: { ...H, 'Content-Type': m0.ct }, body: m0.body });
        if (no.status !== 409 || !(no.json && (no.json.code === 'REPLACE_ALL_CONFIRM_REQUIRED' || /replace ALL current companies/i.test(String(no.json.error))))) throw new Error(`without the yes → ${no.status} ${no.buf.toString().slice(0, 200)}`);
        const filesAfter = fs.existsSync(restoreDir) ? fs.readdirSync(restoreDir).sort().join('|') : '';
        if (filesAfter !== filesBefore) throw new Error(`a refused upload wrote files: ${filesBefore} -> ${filesAfter}`);
        if (JSON.stringify(await rowCounts()) !== JSON.stringify(c0)) throw new Error('a refused upload changed the database');
        if (listPre().join('|') !== pre0.join('|')) throw new Error('a refused upload wrote a pre-open backup');
        const m1 = multipart(bytes, 'gate.tcdb');
        const yes = await rawRequest('POST', `${UI}/api/restore-tcdb`, { headers: { ...H, 'Content-Type': m1.ct }, body: m1.body });
        if (yes.status !== 200 || !yes.json.success) throw new Error(`with the yes → ${yes.status} ${yes.buf.toString().slice(0, 250)}`);
        const pre1 = listPre();
        if (pre1.length < 1 || pre1.length !== Math.min(10, pre0.length + 1)) throw new Error(`pre-open backups ${pre0.length} -> ${pre1.length}`);
        const newest = fs.readFileSync(path.join(preDir, pre1[pre1.length - 1]));
        if (newest.subarray(0, 4).toString('latin1') !== 'TCDB' || newest.length < 100000) throw new Error('the pre-open backup is not a company file');
        if (JSON.stringify(await rowCounts()) !== JSON.stringify(c0)) throw new Error(`rows changed by restoring an export of the same database: ${JSON.stringify(c0)} -> ${JSON.stringify(await rowCounts())}`);
        await servicesHealthy('after the restore');
        return `${nCompanies} companies: no yes → 409, nothing written or changed; yes → 200, rows ${JSON.stringify(c0)} intact, pre-open backup ${pre1[pre1.length - 1]} (${newest.length} bytes)`;
      });

      // ═══ 2.0.7: a company file written on WINDOWS (pg_dump writes CRLF line ends) restores on this platform: it said «success» and left the tables EMPTY (the terminator was LF) ═══
      await R.check('7.16 (2.0.7) a company file whose dump has CRLF line ends (what Windows pg_dump writes), and one that mixes CRLF and LF, restores through the real route with the yes: success, every row comes back (rows equal before), no psql error in the answer; the unchanged export restores the same', async () => {
        const BM = require('../../src/backup-manager');
        const exp = await api('POST', '/api/export-backup', { mode: 'company-folder', fileBase: 'TexaCore-CRLF-SRC' });
        if (!exp.json || !exp.json.success) throw new Error(`export → ${exp.text.slice(0, 200)}`);
        const bm = new BM({ pgBinDir: '/x', encryptionKey: 'texacore-default-backup-key-2026', backupPath: exp.json.path });
        const dump = await bm._decompress(bm._decryptParsed(bm._parseTcdbFile(fs.readFileSync(exp.json.path)), '').data);
        if (dump.includes(0x0d)) throw new Error('the export of this platform already has CR bytes: the scenario needs an LF source');
        const asCrlf = Buffer.from(dump.toString('latin1').replace(/\n/g, '\r\n'), 'latin1');          // Windows text mode: every LF becomes CRLF, in the DDL and in the COPY data alike
        const lines = dump.toString('latin1').split('\n');
        const asMixed = Buffer.from(lines.map((l, i) => l + (i % 7 < 3 ? '\r\n' : '\n')).join('').replace(/\r?\n$/, '\n'), 'latin1');   // a blend of both writers, down to single data lines
        const make = async (buf, name) => { const compressed = await bm._compress(buf); const f = path.join(WORK, name); fs.writeFileSync(f, bm._buildTcdbFile(bm._encrypt(compressed), buf.length, compressed.length)); return f; };
        const c0 = await rowCounts(); const nCompanies = (await pg('SELECT count(*)::int n FROM public.companies')).rows[0].n;
        if (nCompanies < 1) throw new Error('the scenario needs at least one company in the database');
        const outs = [];
        for (const [label, buf] of [['CRLF', asCrlf], ['mixed', asMixed], ['LF (this platform)', dump]]) {
          const file = await make(buf, `crlf-${label.replace(/\W+/g, '')}.tcdb`);
          const m = multipart(fs.readFileSync(file), path.basename(file));
          const r = await rawRequest('POST', `${UI}/api/restore-tcdb`, { headers: { ...H, 'Content-Type': m.ct }, body: m.body });
          if (r.status !== 200 || !r.json || !r.json.success) throw new Error(`${label}: restore → ${r.status} ${r.buf.toString().slice(0, 300)}`);
          if (/end-of-copy marker|does not match previous newline/i.test(r.buf.toString())) throw new Error(`${label}: psql complained about the line ends: ${r.buf.toString().slice(0, 300)}`);
          const c1 = await rowCounts();
          if (JSON.stringify(c1) !== JSON.stringify(c0)) throw new Error(`${label}: rows ${JSON.stringify(c0)} -> ${JSON.stringify(c1)} (the restore must give every row back)`);
          await servicesHealthy(`after the ${label} restore`);
          outs.push(label);
        }
        return `${nCompanies} companies; a CRLF dump (${(asCrlf.length - dump.length).toLocaleString()} CR bytes added), a mixed dump and the plain export each restore with the yes and the rows come back equal (${JSON.stringify(c0)}); services healthy after each`;
      });

      // 2.0.5 RC2: «the default admin collides» - a company for the SIGNED-IN admin goes into HIS tenant (no new tenant / user / session); without a session the collision says how to get out
      await R.check('7.15 (RC2) new company for the signed-in admin: callerAccessToken adds it to his own tenant (attached, no session handed out, no new tenant / user); a bad token is INVALID_SESSION; a colliding admin without a token is EMAIL_EXISTS with the way out', async () => {
        const owner = (await pg(`SELECT t.id tenant_id FROM public.tenants t JOIN auth.users u ON lower(u.email) = lower(t.owner_email) WHERE u.email = 'owner@e2e.test' LIMIT 1`)).rows[0];
        if (!owner) return 'skipped: the owner of the first test tenant is not in this database any more';
        const login = await request('POST', `${API}/auth/v1/token?grant_type=password`, { headers: { apikey: secrets.anonKey }, body: { email: 'owner@e2e.test', password: 'E2ePass#2026' } });
        if (login.status !== 200 || !login.json.access_token) throw new Error(`owner login → ${login.status} ${login.text.slice(0, 160)}`);
        const snap = async () => (await pg(`SELECT (SELECT count(*) FROM public.tenants)::int t, (SELECT count(*) FROM auth.users)::int u, (SELECT count(*) FROM public.companies WHERE tenant_id = $1)::int c`, [owner.tenant_id])).rows[0];
        const base = { companyName: 'E2E Attached', localCurrency: 'UAH', mainCurrency: 'USD', country: 'UA', storagePath: path.join(WORK, 'tcdb'), dbFileName: 'e2e-attached' };
        const before = await snap();
        const bad = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: { ...base, callerAccessToken: 'not-a-jwt' } });
        if (bad.json.success || bad.json.code !== 'INVALID_SESSION') throw new Error(`bad token → ${bad.text.slice(0, 200)}`);
        const dup = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: { ...base, adminEmail: 'owner@e2e.test', adminPassword: 'E2ePass#2026' } });
        if (dup.json.success || dup.json.code !== 'EMAIL_EXISTS' || dup.json.hint !== 'sign_in_or_choose_another' || !/another admin|sign in/i.test(dup.json.error)) throw new Error(`collision → ${dup.text.slice(0, 240)}`);
        if (JSON.stringify(await snap()) !== JSON.stringify(before)) throw new Error('a refused call left rows behind');
        const ok = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: { ...base, callerAccessToken: login.json.access_token } });
        if (!ok.json || !ok.json.success) {
          if (/LIMIT|limit|max_companies/.test(ok.text)) return `the plan's company limit refused it (${ok.text.slice(0, 120)}); bad token INVALID_SESSION, collision EMAIL_EXISTS + hint, nothing written`;
          throw new Error(`attach → ${ok.status} ${ok.text.slice(0, 300)}`);
        }
        if (ok.json.attached !== true || ok.json.tenantId !== owner.tenant_id || ok.json.accessToken || ok.json.refreshToken) throw new Error(`reply ${JSON.stringify({ ...ok.json, accessToken: ok.json.accessToken ? '***' : undefined })}`);
        const after = await snap();
        if (after.t !== before.t || after.u !== before.u || after.c !== before.c + 1) throw new Error(`rows ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
        const co = (await pg(`SELECT tenant_id, status FROM public.companies WHERE id = $1`, [ok.json.companyId])).rows[0];
        if (!co || co.tenant_id !== owner.tenant_id) throw new Error(`the company is in ${co && co.tenant_id}`);
        return `attached to tenant ${owner.tenant_id.slice(0, 8)}… (company ${ok.json.companyId.slice(0, 8)}…, status ${co.status}), no tenant / user / session created; bad token INVALID_SESSION; collision EMAIL_EXISTS + hint`;
      });

      // ═══ 2.0.4 launcher audit: the NEW COMPANY wizard in a real browser, with HOME pointing at a scratch folder (so "~/TexaCore" - the default since RC2 - is the scratch one) ═══
      const HOME_DIR = path.join(WORK, 'home');
      const runAudit = (tag, extra) => {
        const out = require('child_process').spawnSync('node', [path.join(__dirname, 'launcher-audit.cjs'), '--erp', ERP, '--ui', `http://localhost:${PORTS.ui}`, '--shots', path.join(WORK, 'shots-audit'), '--tag', tag, ...extra], { encoding: 'utf8', timeout: 300000 });
        const line = (out.stdout || '').split('\n').find((l) => l.startsWith('AUDIT '));
        if (!line) throw new Error(`audit step failed (exit ${out.status}): ${(out.stderr || out.stdout || '').slice(0, 500)}`);
        return JSON.parse(line.slice('AUDIT '.length));
      };
      const hasAdmin = async (email) => (await pg("SELECT (SELECT count(*) FROM auth.users WHERE email = $1)::int u, (SELECT count(*) FROM public.tenants WHERE owner_email = $1)::int t, (SELECT count(*) FROM public.user_profiles WHERE email = $1 AND is_tenant_admin)::int p", [email])).rows[0];

      await R.check('8.1 (2.0.4 audit) new company through the wizard UI: the default folder shown is ~/TexaCore (outside Documents and iCloud), the five steps work (country Ukraine -> UAH), the admin is created and logged in, and the company file is where the page said (here the scratch HOME)', async () => {
        fs.mkdirSync(path.join(HOME_DIR, 'Documents'), { recursive: true });
        await wipeCompanies();      // 2.0.5: the first company of an empty database gets its chosen file as the live one (8.2 / 8.3 then check the rule for the companies after it)
        await simReset();
        const a = runAudit('8-1', ['--name', 'Audit One', '--file-base', 'AuditOne', '--email', 'audit1@e2e.test']);
        if (a.step1.storagePath !== '~/TexaCore') throw new Error(`default folder shown: ${a.step1.storagePath}`);
        if (a.texts.length !== 5 || a.texts.some((t) => !t)) throw new Error(`step headings ${JSON.stringify(a.texts)}`);
        if (!a.createAnswer || !a.createAnswer.success || a.createAnswer.tcdbPlacement !== 'chosen') throw new Error(`create answer ${JSON.stringify(a.createCalls)} alerts ${a.alerts.join('|')} toast ${JSON.stringify(a.toastText)}`);
        const want = path.join(HOME_DIR, 'TexaCore', 'AuditOne.tcdb');
        if (path.resolve(a.createAnswer.tcdbPath) !== path.resolve(want)) throw new Error(`company file ${a.createAnswer.tcdbPath}, expected ${want}`);
        await waitFor(async () => fs.existsSync(want) && fs.readFileSync(want).subarray(0, 4).toString() === 'TCDB', 'the first company file to be written (TCDB magic)', 120000);
        if (!a.loggedIn || !/^https?:\/\/[^/]+\/?$/.test(a.afterUrl) || !a.activeCompany || a.activeCompany.name !== 'Audit One' || !a.activeCompany.hasId) throw new Error(`after the wizard: ${JSON.stringify({ url: a.afterUrl, loggedIn: a.loggedIn, company: a.activeCompany })}`);
        const adm = await hasAdmin('audit1@e2e.test');
        if (adm.u !== 1 || adm.t !== 1 || adm.p !== 1) throw new Error(`admin rows ${JSON.stringify(adm)}`);
        const cur = await pg("SELECT c.base_currency_code AS b FROM public.companies c WHERE c.name = 'Audit One' LIMIT 1").catch(() => ({ rows: [] }));
        return `default folder «${a.step1.storagePath}»; headings ${a.texts.length}; created + logged in (${a.afterUrl}); file ${path.relative(WORK, want)} (TCDB magic); admin rows ${JSON.stringify(adm)}${cur.rows[0] ? `; base currency ${cur.rows[0].b}` : ''}`;
      });

      await R.check('8.2 (2.0.4 audit) new company when the owner CHOSE the Documents folder and macOS has NOT allowed it: nothing is created, the wizard shows the permission step with the «keep it in the program\'s folder» choice; choosing it creates the company with its file in the program\'s own folder', async () => {
        const docs = path.join(HOME_DIR, 'Documents');
        await simReset(); await sim({ kinds: { [docs]: 'documents' }, sim: { documents: { state: 'denied' } } });
        const a = runAudit('8-2', ['--name', 'Audit Two', '--file-base', 'AuditTwo', '--email', 'audit2@e2e.test', '--storage-path', '~/Documents/TexaCore', '--perm-script', JSON.stringify([{ click: 'perm-program' }])]);
        await simReset();
        if (!a.permission.seen || a.permission.mode !== 'denied' || !a.permission.hasProgramButton) throw new Error(`permission step ${JSON.stringify(a.permission)}`);
        if (!/Documents|المستندات|Документи|Документы/.test(a.permission.title)) throw new Error(`step title ${a.permission.title}`);
        if (a.createCalls.length !== 2 || a.createCalls[0].code !== 'FOLDER_PERMISSION' || a.createCalls[0].area !== 'documents' || a.createCalls[1].success !== true || a.createCalls[1].fallback !== 'program' || a.createCalls[1].tcdbPlacement !== 'program-folder') throw new Error(`create calls ${JSON.stringify(a.createCalls)}`);
        const progDir = path.join(userData, 'texacore-data', 'company-files');
        const chosen2 = a.createCalls[1].plannedTcdbPath || a.createCalls[1].tcdbPath;      // 2.0.5: next to another company the chosen file is only recorded (plannedTcdbPath)
        if (a.createCalls[1].sharedLiveFile !== true) throw new Error(`the live file moved: ${JSON.stringify(a.createCalls[1])}`);
        if (path.resolve(path.dirname(chosen2)) !== path.resolve(progDir)) throw new Error(`file at ${chosen2}`);
        const adm = await hasAdmin('audit2@e2e.test');
        if (adm.u !== 1 || adm.t !== 1) throw new Error(`admin rows ${JSON.stringify(adm)} (the refused first attempt must have created nothing, the second exactly one)`);
        if (fs.existsSync(path.join(docs, 'TexaCore', 'AuditTwo.tcdb'))) throw new Error('a file was written into the not-allowed Documents folder');
        if (!a.loggedIn || !a.activeCompany || a.activeCompany.name !== 'Audit Two') throw new Error(`after: ${JSON.stringify({ loggedIn: a.loggedIn, company: a.activeCompany, url: a.afterUrl })}`);
        return `step «${a.permission.title}» with the program-folder button; 1st create FOLDER_PERMISSION (nothing created), 2nd with fallback=program -> ${path.relative(WORK, chosen2)} (recorded; the live file stays); logged in`;
      });

      await R.check('8.3 (2.0.4 audit) new company while macOS is still ASKING about Documents: the page waits («pending» step), continues by itself when the user allows, and the file lands in Documents/TexaCore', async () => {
        const docs = path.join(HOME_DIR, 'Documents');
        await simReset(); await sim({ kinds: { [docs]: 'documents' }, sim: { documents: { state: 'allowed', delayMs: 9000 } } });
        const a = runAudit('8-3', ['--name', 'Audit Three', '--file-base', 'AuditThree', '--email', 'audit3@e2e.test', '--storage-path', '~/Documents/TexaCore']);
        await simReset();
        if (!a.permission.seen || a.permission.mode !== 'pending') throw new Error(`permission step ${JSON.stringify(a.permission)}`);
        if (a.createCalls.length !== 2 || a.createCalls[0].code !== 'FOLDER_PERMISSION' || a.createCalls[0].state !== 'pending' || a.createCalls[1].success !== true || a.createCalls[1].tcdbPlacement !== 'chosen') throw new Error(`create calls ${JSON.stringify(a.createCalls)}`);
        const want = path.join(docs, 'TexaCore', 'AuditThree.tcdb');
        const chosen3 = a.createCalls[1].plannedTcdbPath || a.createCalls[1].tcdbPath;      // 2.0.5: next to another company the chosen file is only recorded (plannedTcdbPath)
        if (a.createCalls[1].sharedLiveFile !== true) throw new Error(`the live file moved: ${JSON.stringify(a.createCalls[1])}`);
        if (path.resolve(chosen3) !== path.resolve(want)) throw new Error(`file at ${chosen3}`);
        if (!a.loggedIn || !a.activeCompany || a.activeCompany.name !== 'Audit Three') throw new Error(`after: ${JSON.stringify({ loggedIn: a.loggedIn, company: a.activeCompany })}`);
        return `pending step «${a.permission.body.slice(0, 70)}…» -> allowed by itself -> recorded for ${path.relative(WORK, want)} (the live file stays); logged in`;
      });

      await R.check('8.4 (2.0.4 audit) a company file in a READ-ONLY folder / read-only file opens: the picked file is never written, the company file gets a free name in the TexaCore folder (here the scratch HOME), the rows are intact', async () => {
        if (typeof process.getuid === 'function' && process.getuid() === 0) return 'skipped: running as root ignores read-only';
        await simReset();
        const dir = path.join(LA, 'readonly'); fs.mkdirSync(dir, { recursive: true });
        const f = await exportTo(path.join(dir, 'Read Only.tcdb'));
        const shaF = fileSha(f); const c0 = await counts4();
        fs.chmodSync(f, 0o444); fs.chmodSync(dir, 0o555);
        try {
          const loc = (await locateApi(bodyOf(f))).json;
          if (!loc.success) throw new Error(`locate -> ${JSON.stringify(loc).slice(0, 160)}`);
          const r = await api('POST', '/api/open-picked-tcdb', { ref: loc.ref, confirmReplaceAll: true });
          if (r.status !== 200 || !r.json.success || r.json.inPlace !== false) throw new Error(`open -> ${r.status} ${r.text.slice(0, 240)}`);
          const dflt = path.join(HOME_DIR, 'TexaCore');
          if (path.resolve(path.dirname(r.json.tcdbPath)) !== path.resolve(dflt)) throw new Error(`the company file went to ${r.json.tcdbPath}, expected a free name in ${dflt}`);
          if (fileSha(f) !== shaF) throw new Error('the read-only file changed');
          if (walk(dir).join('|') !== 'Read Only.tcdb') throw new Error(`files beside: ${walk(dir).join(', ')}`);
          if (JSON.stringify(await counts4()) !== JSON.stringify(c0)) throw new Error('the open changed the rows');
          return `inPlace=false; company file ${path.relative(WORK, r.json.tcdbPath)}; the read-only file byte-identical, nothing beside it`;
        } finally { fs.chmodSync(dir, 0o755); fs.chmodSync(f, 0o644); }
      });
    }

    // ── 9. final build (owner 27-10): an owner with three companies - company links, the Users screen's roles, the desktop's attachment / public-link guards ──
    await multiCompanyChecks(R, { request, ADMIN, API, UI, H, anonKey: secrets.anonKey, ERP, WORK, pg, lanIp });
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
