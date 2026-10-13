#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// auth-migration-check — an install made by an EARLIER 2.0.0 test build (pg_hba `trust`, one shared database password, no passwords on the superuser)
// is brought to scram-sha-256 on its next start, and an install whose secrets file was LOST is re-keyed instead of locked out.
//
//   node scripts/e2e/auth-migration-check.js --from <userdata dir of a pre-hardening install, e.g. a launch-check workdir's userdata> --workdir <empty dir> [--app <.app>]
//
//   M1  copy of the old install, started with the new build: it comes up, pg_hba.conf is scram-sha-256 only, a passwordless connection is refused, the
//       secrets file gained the two role passwords and kept every old value (JWT secret, keys), the admin still signs in and reads their company (RLS)
//   M2  a second copy with secrets.json DELETED: the build regenerates the secrets, re-keys the roles through a temporary loopback rule that is gone again
//       before the services start, and everything works with the NEW secrets
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Client } = require('pg');
const { PORTS, Results, portFree, request, startApp, stopApp } = require('./lib');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const FROM = path.resolve(arg('from', ''));
const WORK = path.resolve(arg('workdir', ''));
const APP = arg('app', '');
if (!arg('from') || !arg('workdir')) { console.error('--from and --workdir are required'); process.exit(2); }
const binary = APP ? path.join(path.resolve(APP), 'Contents', 'MacOS', path.basename(path.resolve(APP), '.app')) : '';
const API = `http://127.0.0.1:${PORTS.api}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const attempt = async (opts) => {
  const c = new Client({ host: '127.0.0.1', port: PORTS.pg, database: 'postgres', user: 'postgres', connectionTimeoutMillis: 5000, ...opts });
  c.on('error', () => {});
  try { await c.connect(); await c.query('SELECT 1'); return 'accepted'; } catch (e) { return `refused: ${String(e.message).slice(0, 60)}`; } finally { try { await c.end(); } catch { /* */ } }
};

(async () => {
  const R = new Results();
  for (const p of Object.values(PORTS)) if (!(await portFree(p))) { console.error(`port ${p} busy`); process.exit(2); }
  fs.rmSync(WORK, { recursive: true, force: true }); fs.mkdirSync(WORK, { recursive: true });
  let child = null;
  const copyInstall = (name) => {
    const dest = path.join(WORK, name, 'userdata');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    execFileSync('cp', ['-Rp', FROM, dest]);
    // only the database + secrets + config matter; Electron's browser profile and any stale server pid must not ride along
    for (const f of ['postmaster.pid']) fs.rmSync(path.join(dest, 'texacore-data', 'pgdata', f), { force: true });
    return dest;
  };
  const start = async (userData, tag) => {
    const s = startApp({ userData, license: 'free', logFile: path.join(WORK, `app-${tag}.log`), appBinary: binary });
    child = s.child;
    try { await s.ready; return null; } catch (e) { return e.message; }
  };
  const stop = async (userData) => { if (child) { await stopApp(child, userData); child = null; } await sleep(1500); };
  const login = async (anon) => (await request('POST', `http://127.0.0.1:${PORTS.gotrue}/token?grant_type=password`, { headers: { apikey: anon }, body: { email: 'owner@e2e.test', password: 'E2ePass#2026' } }));
  try {
    const before = JSON.parse(fs.readFileSync(path.join(FROM, 'texacore-data', 'secrets.json'), 'utf8'));
    const hbaBefore = fs.readFileSync(path.join(FROM, 'texacore-data', 'pgdata', 'pg_hba.conf'), 'utf8');
    await R.check('M1 an install from an earlier 2.0.0 test build (trust, shared database password) is migrated on its next start', async () => {
      if (!/\btrust\b/.test(hbaBefore)) throw new Error('the source install is not a pre-hardening one (its pg_hba has no trust)');
      if (before.authenticatorPassword) throw new Error('the source secrets already have role passwords');
      const ud = copyInstall('m1');
      const err = await start(ud, 'm1'); if (err) throw new Error(`start: ${err}`);
      const dataDir = path.join(ud, 'texacore-data');
      const sec = JSON.parse(fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8'));
      for (const k of ['jwtSecret', 'dbPassword', 'anonKey', 'serviceKey', 'localApiSecret']) if (sec[k] !== before[k]) throw new Error(`${k} changed during the migration`);
      if (!sec.authenticatorPassword || !sec.authAdminPassword) throw new Error('the two role passwords were not added');
      if (new Set([sec.dbPassword, sec.authenticatorPassword, sec.authAdminPassword]).size !== 3) throw new Error('role passwords are not distinct');
      const hba = fs.readFileSync(path.join(dataDir, 'pgdata', 'pg_hba.conf'), 'utf8');
      if (/\btrust\b/.test(hba.replace(/^\s*#.*$/gm, ''))) throw new Error('pg_hba.conf still has trust');
      const noPw = await attempt({ password: undefined }); const right = await attempt({ password: sec.dbPassword });
      if (!noPw.startsWith('refused') || right !== 'accepted') throw new Error(`no password → ${noPw}; right password → ${right}`);
      const authn = await attempt({ user: 'authenticator', password: sec.authenticatorPassword });
      if (authn !== 'accepted') throw new Error(`authenticator → ${authn}`);
      const si = await login(sec.anonKey); if (si.status !== 200) throw new Error(`admin sign-in → ${si.status} ${si.text.slice(0, 120)}`);
      const co = await request('GET', `${API}/rest/v1/companies?select=id`, { headers: { apikey: sec.anonKey, Authorization: `Bearer ${si.json.access_token}` } });
      if (co.status !== 200 || !co.json.length) throw new Error(`the admin cannot read their company (${co.status})`);
      await stop(ud);
      const again = await start(ud, 'm1b'); if (again) throw new Error(`second start: ${again}`);
      if ((await attempt({ password: undefined })).startsWith('accepted')) throw new Error('passwordless connection accepted after the second start');
      await stop(ud);
      return 'trust → scram-sha-256: services came up, passwordless connection refused, old secrets unchanged + 2 role passwords added, admin signs in and reads their company; a second start is a no-op';
    });
    await R.check('M2 secrets LOST (secrets.json deleted) on an existing install: regenerated, roles re-keyed through a temporary loopback rule, scram restored, nobody locked out', async () => {
      const ud = copyInstall('m2');
      fs.rmSync(path.join(ud, 'texacore-data', 'secrets.json'));
      const err = await start(ud, 'm2'); if (err) throw new Error(`start: ${err}`);
      const dataDir = path.join(ud, 'texacore-data');
      const sec = JSON.parse(fs.readFileSync(path.join(dataDir, 'secrets.json'), 'utf8'));
      if (sec.jwtSecret === before.jwtSecret || sec.dbPassword === before.dbPassword) throw new Error('the secrets were not regenerated');
      const hba = fs.readFileSync(path.join(dataDir, 'pgdata', 'pg_hba.conf'), 'utf8');
      if (/\btrust\b/.test(hba.replace(/^\s*#.*$/gm, ''))) throw new Error('the temporary recovery rule is still in pg_hba.conf');
      const noPw = await attempt({ password: undefined }); const right = await attempt({ password: sec.dbPassword }); const old = await attempt({ password: before.dbPassword });
      if (!noPw.startsWith('refused') || right !== 'accepted' || !old.startsWith('refused')) throw new Error(`no password → ${noPw}; new password → ${right}; old password → ${old}`);
      const si = await login(sec.anonKey); if (si.status !== 200) throw new Error(`admin sign-in with the new keys → ${si.status} ${si.text.slice(0, 120)}`);
      const co = await request('GET', `${API}/rest/v1/companies?select=id`, { headers: { apikey: sec.anonKey, Authorization: `Bearer ${si.json.access_token}` } });
      if (co.status !== 200 || !co.json.length) throw new Error(`RLS read after recovery → ${co.status}`);
      await stop(ud);
      return 'new secrets generated, old database password refused, new one works, scram restored (no trust left), the admin signs in with the NEW keys and reads their company';
    });
  } catch (e) {
    R.rows.push({ name: 'harness', ok: false, evidence: e.stack || e.message, ms: 0 });
    console.log(`  FAIL  harness — ${e.message}`);
  } finally { if (child) await stopApp(child, WORK); }
  fs.writeFileSync(path.join(WORK, 'auth-migration-results.json'), JSON.stringify({ at: new Date().toISOString(), app: APP || 'electron dev mode', summary: R.summary(), rows: R.rows }, null, 2));
  console.log(`\nauth-migration-check: ${R.summary()}`);
  process.exit(R.failed.length ? 1 : 0);
})();
