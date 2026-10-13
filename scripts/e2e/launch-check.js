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
const { ROOT, PORTS, Results, portFree, request, startApp, stopApp, setPgPassword, pgOptions } = require('./lib');
const bootstrap = require('../../src/bootstrap');
const secretsMod = require('../../src/secrets');

function arg(name, def = '') { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const WORK = path.resolve(arg('workdir', ''));
const LICENSE = arg('license', 'free');
const ERP = arg('erp', process.env.TEXACORE_ERP_DIR || '');
const RSF = arg('rsf', '');
const KEEP = process.argv.includes('--keep');
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
  for (const p of Object.values(PORTS)) if (!(await portFree(p))) { console.error(`port ${p} is in use — stop whatever holds it first`); process.exit(2); }

  console.log(`launch-check: license=${LICENSE} workdir=${WORK}`);
  const appBinary = APP ? path.join(path.resolve(APP), 'Contents', 'MacOS', path.basename(path.resolve(APP), '.app')) : '';
  if (APP && !fs.existsSync(appBinary)) { console.error(`no executable at ${appBinary}`); process.exit(2); }
  const { child, ready } = startApp({ userData, license: LICENSE, logFile, appBinary, extraEnv: { TEXACORE_UI_SMOKE: '1' } });
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
    await R.check('1.4 every production function body equals the baseline inventory (only the 4 redacted-secret ones differ)', async () => {
      const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'production_baseline.inventory.json'), 'utf8'));
      const rows = (await pg(`SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS sig, md5(p.prosrc) AS md5
                                FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                               WHERE n.nspname IN ('public','licensing','newpost','tomgenerators') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')`)).rows;
      const mk = bootstrap.readMarker(dataDir) || {};
      const c = bootstrap.compareFunctionInventory(inv.functions_md5, rows, mk.patchedFunctions || {});
      const patchedNote = Object.keys(mk.patchedFunctions || {}).length ? `; patched on purpose (import exemption): ${Object.keys(mk.patchedFunctions).join(', ')}` : '';
      if ((mk.patchesSkipped || []).length) throw new Error(`a function patch was skipped: ${JSON.stringify(mk.patchesSkipped)}`);
      if (!c.ok) throw new Error(`missing ${c.missing.length} extra ${c.extra.length} differ ${c.mismatched.length}: ${[...c.missing, ...c.extra, ...c.mismatched].slice(0, 3).join(' | ')}`);
      return `${c.expected} functions compared${patchedNote}`;
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
      const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'baseline', 'production_baseline.inventory.json'), 'utf8'));
      const rls = (await pg(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','licensing','newpost','tomgenerators') AND c.relkind IN ('r','p') AND c.relrowsecurity`)).rows[0].n;
      if (rls !== Number(inv.main.rls_enabled) + bootstrap.LOCAL_EXTRAS.rlsTables) throw new Error(`RLS tables ${rls}, expected ${Number(inv.main.rls_enabled) + bootstrap.LOCAL_EXTRAS.rlsTables}`);
      const noRls = (await pg(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') ORDER BY 1`)).rows.map((r) => r.relname);
      if (noRls.length) throw new Error(`anon can reach tables without RLS: ${noRls.join(', ')}`);
      return `${rls} RLS tables = inventory (+1 local gate); anon reaches no table without RLS`;
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
      if (!/appVersion: "2\.0\.0"/.test(same.text)) throw new Error('appVersion in config.js is not 2.0.0');
      return 'ok; appVersion 2.0.0';
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
      if (u.version !== '2.0.0') throw new Error(`window reports version ${u.version}`);
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
    await R.check('4.5 admin-portal gate: default = license key, "admin" refused, 5 wrong tries lock it', async () => {
      const verify = async (p) => (await request('POST', `${API}/rest/v1/rpc/verify_admin_password`, { headers: anon, body: { p_input: p } })).json;
      const key = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).licenseKey;
      if (await verify('admin') !== false) throw new Error('"admin" accepted');
      if (await verify(key) !== true) throw new Error('default (license key) not accepted');
      for (let i = 0; i < 5; i++) await verify('wrong-' + i);
      if (await verify(key) !== false) throw new Error('not locked after 5 failures');
      await pg('UPDATE platform_admin SET failed_attempts=0, locked_until=NULL');
      if (await verify(key) !== true) throw new Error('did not recover after unlock');
      return `key ${key}`;
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
      remoteCases.push([`LAN client forging Host: 127.0.0.1`, `http://${lanIp}:${PORTS.ui}`, `127.0.0.1:${PORTS.ui}`, {}]);
    }
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
    await R.check('5.1 the web bundle is served: version 2.0.0, every asset 200 with a script/style type, local fonts, no Google Fonts', async () => {
      const idx = await request('GET', `${UI}/`);
      if (idx.status !== 200) throw new Error(`/ → ${idx.status}`);
      if (!/name="texacore-app-version" content="2\.0\.0"/.test(idx.text)) throw new Error('index.html lacks the 2.0.0 stamp');
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
