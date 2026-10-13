#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// secrets-at-rest-check — the per-install secrets are encrypted at rest (Electron safeStorage) and NOWHERE else on disk, an install made with the plain
// 0600 file migrates without losing anything, and an encrypted file that cannot be opened stops the program instead of regenerating secrets.
// Runs the app against Chromium's in-memory MOCK keychain (TEXACORE_SECRETS_AT_REST=mock — isolated harness runs only), so the real Keychain is never touched.
//
//   node scripts/e2e/secrets-at-rest-check.js --workdir <empty dir> [--app <packaged .app>]
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { PORTS, Results, portFree, request, startApp, stopApp } = require('./lib');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const WORK = path.resolve(arg('workdir', ''));
const APP = arg('app', '');
if (!arg('workdir')) { console.error('--workdir is required'); process.exit(2); }
const binary = APP ? path.join(path.resolve(APP), 'Contents', 'MacOS', path.basename(path.resolve(APP), '.app')) : '';
const userData = path.join(WORK, 'userdata');
const dataDir = path.join(userData, 'texacore-data');
const UI = `http://127.0.0.1:${PORTS.ui}`;
const ADMIN = `http://127.0.0.1:${PORTS.admin}`;
const walk = (d, out = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isSymbolicLink()) continue; if (e.isDirectory()) walk(f, out); else out.push(f); } return out; };

(async () => {
  const R = new Results();
  for (const p of Object.values(PORTS)) if (!(await portFree(p))) { console.error(`port ${p} busy`); process.exit(2); }
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
  let child = null;
  const boot = async (mode, tag, extra = {}) => {
    const logFile = path.join(WORK, `app-${tag}.log`);
    const env = { ...(mode ? { TEXACORE_SECRETS_AT_REST: mode } : { TEXACORE_SECRETS_AT_REST: '0' }), ...extra };
    const s = startApp({ userData, license: 'free', logFile, appBinary: binary, extraEnv: env });
    child = s.child;
    try { await s.ready; } catch (e) { return { logFile, error: e.message }; }
    return { logFile };
  };
  const down = async () => { if (child) { await stopApp(child, userData); child = null; } await new Promise((r) => setTimeout(r, 1500)); };
  let plain = null; let anonKey = ''; let adminToken = '';
  try {
    await R.check('S1 default (policy off): the 0600 secrets file as before — and PostgREST gets its secrets from its environment, NOT from a config file', async () => {
      const b = await boot('0', 'plain'); if (b.error) throw new Error(b.error);
      plain = JSON.parse(fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8'));
      if ((fs.statSync(path.join(dataDir, 'secrets.json')).mode & 0o777) !== 0o600) throw new Error('secrets.json is not 0600');
      if (fs.existsSync(path.join(dataDir, 'secrets.enc'))) throw new Error('secrets.enc with the policy off');
      if (fs.existsSync(path.join(dataDir, 'postgrest.conf'))) throw new Error('postgrest.conf (secrets on disk) exists');
      const H = { 'x-texacore-local-secret': plain.localApiSecret };
      const cc = await request('POST', `${ADMIN}/api/create-local-company`, { headers: H, body: { companyName: 'Vault Co', adminEmail: 'owner@vault.test', adminPassword: 'VaultPass#2026', localCurrency: 'UAH', mainCurrency: 'USD', country: 'UA', storagePath: path.join(WORK, 'tcdb'), dbFileName: 'v' } });
      if (!cc.json || !cc.json.success) throw new Error(`create company ${cc.text.slice(0, 160)}`);
      const cfg = await request('GET', `${UI}/config.js`);
      anonKey = /supabaseKey: "([^"]+)"/.exec(cfg.text)[1];
      if (anonKey !== plain.anonKey) throw new Error('config.js anon key differs from secrets.json');
      return 'secrets.json (0600), no secrets.enc, no postgrest.conf; the app works';
    });
    await down();
    await R.check('S2 migration: with the keychain policy on, the plain file moves into secrets.enc (same secrets, same sessions), the plain file is gone', async () => {
      const b = await boot('mock', 'enc1'); if (b.error) throw new Error(b.error);
      if (fs.existsSync(path.join(dataDir, 'secrets.json'))) throw new Error('secrets.json is still there');
      if (!fs.existsSync(path.join(dataDir, 'secrets.enc'))) throw new Error('no secrets.enc');
      if ((fs.statSync(path.join(dataDir, 'secrets.enc')).mode & 0o777) !== 0o600) throw new Error('secrets.enc is not 0600');
      const cfg = await request('GET', `${UI}/config.js`);
      if (/supabaseKey: "([^"]+)"/.exec(cfg.text)[1] !== anonKey) throw new Error('the anon key changed — secrets were regenerated');
      const ok = await request('GET', `${ADMIN}/api/companies`, { headers: { 'x-texacore-local-secret': plain.localApiSecret } });
      if (ok.status !== 200) throw new Error(`the old admin secret no longer works (${ok.status})`);
      const si = await request('POST', `http://127.0.0.1:${PORTS.gotrue}/token?grant_type=password`, { headers: { apikey: anonKey }, body: { email: 'owner@vault.test', password: 'VaultPass#2026' } });
      if (si.status !== 200) throw new Error(`admin sign-in after migration ${si.status}`);
      adminToken = si.json.access_token;
      const co = await request('GET', `http://127.0.0.1:${PORTS.api}/rest/v1/companies?select=id`, { headers: { apikey: anonKey, Authorization: `Bearer ${adminToken}` } });
      if (co.status !== 200 || !co.json.length) throw new Error('RLS read as the admin failed after migration');
      const log = fs.readFileSync(b.logFile, 'utf8');
      if (!/secrets at rest: OS keychain/.test(log)) throw new Error('the log does not show the keychain path');
      return 'secrets.enc (0600) replaced secrets.json; anon key, admin secret, DB password and JWT secret unchanged (old admin secret works, admin signs in, RLS read ok)';
    });
    await R.check('S3 NOTHING else on disk holds the secrets: no file under the data directory (cluster, logs, config, markers) contains the JWT secret, any DB password, service key or admin-API secret', async () => {
      const needles = [plain.jwtSecret, plain.dbPassword, plain.authenticatorPassword, plain.authAdminPassword, plain.serviceKey, plain.localApiSecret].map((x) => Buffer.from(x));
      await new Promise((r) => setTimeout(r, 1500));
      const hits = [];
      let scanned = 0;
      for (const f of walk(userData)) {
        const st = fs.statSync(f); if (st.size === 0 || st.size > 200e6) continue;
        const buf = fs.readFileSync(f); scanned += 1;
        needles.forEach((n, i) => { if (buf.indexOf(n) >= 0) hits.push(`${['jwtSecret', 'dbPassword', 'authenticatorPassword', 'authAdminPassword', 'serviceKey', 'localApiSecret'][i]} in ${path.relative(userData, f)}`); });
      }
      if (hits.length) throw new Error(hits.slice(0, 6).join('; '));
      return `${scanned} files under the user-data directory scanned (database cluster included): none contains any of the 6 secrets`;
    });
    await down();
    await R.check('S4 a second start reads secrets.enc; a DAMAGED secrets.enc stops the program with a clear error — nothing regenerated, nothing deleted', async () => {
      const b = await boot('mock', 'enc2'); if (b.error) throw new Error(`restart: ${b.error}`);
      const cfg = await request('GET', `${UI}/config.js`);
      if (/supabaseKey: "([^"]+)"/.exec(cfg.text)[1] !== anonKey) throw new Error('the anon key changed on the second start');
      await down();
      const enc = path.join(dataDir, 'secrets.enc');
      const good = fs.readFileSync(enc);
      fs.writeFileSync(enc, '{"v":1,"provider":"safeStorage","data":"AAAA"}');
      const damaged = fs.readFileSync(enc);
      const c = await boot('mock', 'enc3');
      await down();
      if (!c.error || !/could not be unlocked/.test(c.error)) throw new Error(`a damaged secrets.enc did not stop the app with the unlock error (${c.error || 'it started'})`);
      if (!fs.readFileSync(enc).equals(damaged)) throw new Error('the damaged file was modified');
      if (fs.existsSync(path.join(dataDir, 'secrets.json'))) throw new Error('secrets were regenerated into a plain file');
      fs.writeFileSync(enc, good);
      const d = await boot('mock', 'enc4'); if (d.error) throw new Error(`restoring the good file: ${d.error}`);
      return 'second start: same secrets; damaged file → "could not be unlocked", file untouched, no regeneration; the good file works again';
    });
    await R.check('S5 the tunnel token (and every other secret) is on NO process command line: cloudflared gets TUNNEL_TOKEN through its environment, not --token', async () => {
      await down();
      const TOKEN = 'eyJ' + require('crypto').randomBytes(36).toString('base64').replace(/[^A-Za-z0-9]/g, 'x');
      const cfgFile = path.join(dataDir, 'config.json');
      const cfg = fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : {};
      fs.writeFileSync(cfgFile, JSON.stringify({ ...cfg, enableCloud: true, subdomain: 'e2e-tunnel', tunnelToken: TOKEN }, null, 2), { mode: 0o600 });
      const rec = path.join(WORK, 'fake-cloudflared.json');
      fs.rmSync(rec, { force: true });
      const b = await boot('mock', 'tunnel', { TEXACORE_STUB_TUNNEL: '', TEXACORE_CLOUDFLARED_BIN: path.join(__dirname, 'fake-cloudflared.js'), FAKE_CF_OUT: rec });
      if (b.error) throw new Error(`start with the tunnel enabled: ${b.error}`);
      for (let i = 0; i < 20 && !fs.existsSync(rec); i++) await new Promise((r) => setTimeout(r, 500));
      if (!fs.existsSync(rec)) throw new Error('the stand-in tunnel process was never started');
      const seen = JSON.parse(fs.readFileSync(rec, 'utf8'));
      if (seen.tunnelTokenInEnv !== TOKEN) throw new Error('cloudflared did not receive TUNNEL_TOKEN in its environment');
      if (seen.argv.join(' ').includes(TOKEN) || seen.argv.includes('--token')) throw new Error(`the token is on cloudflared's own argv: ${seen.argv.join(' ').slice(0, 80)}`);
      const ps = require('child_process').execFileSync('ps', ['-axww', '-o', 'command='], { encoding: 'utf8', maxBuffer: 64 << 20 });
      if (ps.includes(TOKEN)) throw new Error('the tunnel token is visible in ps');
      const tunnelLine = ps.split('\n').find((l) => l.includes('fake-cloudflared')) || '';
      const named = { tunnelToken: TOKEN, jwtSecret: plain.jwtSecret, dbPassword: plain.dbPassword, authenticatorPassword: plain.authenticatorPassword, authAdminPassword: plain.authAdminPassword, serviceKey: plain.serviceKey, localApiSecret: plain.localApiSecret };
      const leaks = Object.entries(named).filter(([, v]) => v && ps.includes(v)).map(([k]) => k);
      if (leaks.length) throw new Error(`on a command line: ${leaks.join(', ')}`);
      return `cloudflared started as "${tunnelLine.trim().slice(-60) || 'fake-cloudflared tunnel run'}" — argv ${JSON.stringify(seen.argv)}, token only in its environment; ${ps.split('\n').length} command lines searched for the token and 6 other secrets: none`;
    });
  } catch (e) {
    R.rows.push({ name: 'harness', ok: false, evidence: e.stack || e.message, ms: 0 });
    console.log(`  FAIL  harness — ${e.message}`);
  } finally { await down(); }
  fs.writeFileSync(path.join(WORK, 'secrets-results.json'), JSON.stringify({ at: new Date().toISOString(), app: APP || 'electron dev mode', summary: R.summary(), rows: R.rows }, null, 2));
  console.log(`\nsecrets-at-rest-check: ${R.summary()}`);
  process.exit(R.failed.length ? 1 : 0);
})();
