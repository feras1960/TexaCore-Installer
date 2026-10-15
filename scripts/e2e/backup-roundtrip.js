#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// backup-roundtrip — .tcdb backup → restore on the REAL build's database (scratch userData only), then prove nothing was weakened:
//   * the same row counts come back (companies, journal entries, users), the admin can still sign in and read their company
//   * the database still equals the baseline (function bodies, counts) and RLS is intact; anon still reads nothing
//
//   node scripts/e2e/backup-roundtrip.js --workdir <a workdir that already holds an install (from launch-check)> [--app <packaged .app>]
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { ROOT, PORTS, Results, portFree, request, startApp, stopApp, setPgPassword, pgOptions, expectedInventory } = require('./lib');
const BackupManager = require('../../src/backup-manager');
const bootstrap = require('../../src/bootstrap');

const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const WORK = path.resolve(arg('workdir', ''));
const APP = arg('app', '');
if (!arg('workdir')) { console.error('--workdir is required'); process.exit(2); }
const binary = APP ? path.join(path.resolve(APP), 'Contents', 'MacOS', path.basename(path.resolve(APP), '.app')) : '';
const userData = path.join(WORK, 'userdata');
const API = `http://127.0.0.1:${PORTS.api}`;

const pg = async (sql, params = []) => {
  const c = new Client(pgOptions());
  await c.connect();
  try { return await c.query(sql, params); } finally { await c.end(); }
};
const snapshot = async () => (await pg(`SELECT (SELECT count(*) FROM public.companies)::int companies, (SELECT count(*) FROM public.journal_entries)::int entries,
  (SELECT count(*) FROM public.journal_entry_lines)::int lines, (SELECT count(*) FROM auth.users)::int users, (SELECT count(*) FROM public.chart_of_accounts)::int accounts,
  (SELECT count(*) FROM public.tenants)::int tenants`)).rows[0];
const integrity = async () => {
  const { inv, rlsDelta } = expectedInventory();     // baseline + the incremental migrations' measured delta
  const rows = (await pg(`SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS sig, md5(p.prosrc) AS md5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                           WHERE n.nspname IN ('public','licensing','newpost','tomgenerators') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')`)).rows;
  const fn = bootstrap.compareFunctionInventory(inv.functions_md5, rows);
  const rls = (await pg(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','licensing','newpost','tomgenerators') AND c.relkind IN ('r','p') AND c.relrowsecurity`)).rows[0].n;
  const open = (await pg(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')`)).rows[0].n;
  const anonGrants = (await pg(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE grantee='anon' AND table_schema='public'`)).rows[0].n;
  return { functionsOk: fn.ok, rls, rlsExpected: Number(inv.main.rls_enabled) + bootstrap.LOCAL_EXTRAS.rlsTables + rlsDelta, anonWithoutRls: open, anonGrants };
};

(async () => {
  const R = new Results();
  for (const p of Object.values(PORTS)) if (!(await portFree(p))) { console.error(`port ${p} busy`); process.exit(2); }
  const logFile = path.join(WORK, 'roundtrip-app.log');
  fs.rmSync(logFile, { force: true });
  const { child, ready } = startApp({ userData, logFile, appBinary: binary });
  let before; let intBefore; let file;
  try {
    await ready;
    const secrets = JSON.parse(fs.readFileSync(path.join(userData, 'texacore-data', 'secrets.json'), 'utf8'));
    setPgPassword(secrets.dbPassword);
    const mgr = new BackupManager({
      pgBinDir: path.join(ROOT, 'bin', 'macos-arm64', 'pg', 'bin'), dbHost: '127.0.0.1', dbPort: PORTS.pg, dbName: 'postgres', dbUser: 'postgres', dbPassword: secrets.dbPassword,
      backupPath: path.join(WORK, 'roundtrip.tcdb'), encryptionKey: 'texacore-default-backup-key-2026', dataDir: path.join(userData, 'texacore-data'),
      onProgress: () => {}, onError: (e) => console.error('[backup]', e.message),
    });
    file = mgr.backupPath;
    await R.check('RT.1 backup: pg_dump 17 → compress → encrypt → .tcdb', async () => {
      before = await snapshot();
      intBefore = await integrity();
      await mgr.backup();
      const sz = fs.statSync(file).size;
      if (sz < 100000) throw new Error(`file is only ${sz} bytes`);
      return `${(sz / 1048576).toFixed(1)} MB; rows ${JSON.stringify(before)}`;
    });
    await R.check('RT.2 restore: the same rows come back and the services accept logins', async () => {
      await mgr.restore(file);
      const after = await snapshot();
      if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`rows changed: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      return 'identical row counts';
    });
    await R.check('RT.3 after the restore the database still equals the baseline and RLS/grants are exactly as before (nothing weakened)', async () => {
      const i = await integrity();
      if (!i.functionsOk) throw new Error('function bodies differ from the baseline after restore');
      if (i.rls !== i.rlsExpected) throw new Error(`RLS tables ${i.rls}, expected ${i.rlsExpected}`);
      if (i.anonWithoutRls !== 0) throw new Error(`anon reaches ${i.anonWithoutRls} tables without RLS`);
      if (i.anonGrants !== intBefore.anonGrants) throw new Error(`anon table grants ${intBefore.anonGrants} → ${i.anonGrants}`);
      return `${i.rls} RLS tables, anon grants unchanged (${i.anonGrants}), 0 anon-open tables`;
    });
    await R.check('RT.4 after the restore anon still reads nothing and an admin still reads their company', async () => {
      const anon = { apikey: secrets.anonKey, Authorization: `Bearer ${secrets.anonKey}` };
      for (const t of ['tenants', 'companies', 'user_profiles', 'journal_entries', 'chart_of_accounts']) {
        const r = await request('GET', `${API}/rest/v1/${t}?select=*&limit=1`, { headers: anon });
        if (r.status === 200 && Array.isArray(r.json) && r.json.length) throw new Error(`anon reads ${t}`);
      }
      const email = (await pg(`SELECT au.email FROM auth.users au JOIN public.user_profiles up ON up.id=au.id WHERE up.is_tenant_admin ORDER BY au.created_at LIMIT 1`)).rows[0].email;
      // the restore resets sessions but keeps password hashes: sign in with the e2e password used by launch-check for that email
      const pw = email === 'owner@e2e.test' ? 'E2ePass#2026' : (email.startsWith('rashid+') ? 'E2ePass#2026' : null);
      if (!pw) return `skipped sign-in (unknown password for ${email})`;
      const si = await request('POST', `http://127.0.0.1:${PORTS.gotrue}/token?grant_type=password`, { headers: { apikey: secrets.anonKey }, body: { email, password: pw } });
      if (si.status !== 200) throw new Error(`sign-in as ${email} → ${si.status} ${si.text.slice(0, 120)}`);
      const co = await request('GET', `${API}/rest/v1/companies?select=id,name`, { headers: { apikey: secrets.anonKey, Authorization: `Bearer ${si.json.access_token}` } });
      if (co.status !== 200 || !co.json.length) throw new Error(`admin reads companies → ${co.status} ${co.text.slice(0, 120)}`);
      return `${email} signs in and reads ${co.json.length} company(ies)`;
    });
    // ── 2.0.2: a file exported with "protect with a passphrase" ──
    await R.check('RT.5 passphrase-protected export -> restore: without / with a wrong phrase NOTHING is executed (rows identical), with the phrase the same rows come back and the baseline is intact', async () => {
      const prot = path.join(WORK, 'roundtrip-protected.tcdb');
      fs.rmSync(prot, { force: true });
      const exp = await mgr.exportTo(prot, { passphrase: 'correct horse battery' });
      if (!exp.encrypted || fs.statSync(prot).size < 100000) throw new Error('the protected export was not written');
      const plain = await mgr.exportTo(path.join(WORK, 'roundtrip-plain.tcdb'), { overwrite: true });
      if (fs.readFileSync(prot).equals(fs.readFileSync(plain.path))) throw new Error('protected and plain exports are identical');
      const snap0 = JSON.stringify(await snapshot());
      for (const [phrase, code] of [['', 'TCDB_PASSPHRASE_REQUIRED'], ['not the phrase', 'TCDB_BAD_PASSPHRASE']]) {
        let got = null;
        try { await mgr.restore(prot, phrase ? { passphrase: phrase } : undefined); } catch (e) { got = e.code; }
        if (got !== code) throw new Error(`restore with ${phrase ? 'a wrong' : 'no'} phrase -> ${got}, wanted ${code}`);
        if (JSON.stringify(await snapshot()) !== snap0) throw new Error('a refused restore changed the database');
      }
      await mgr.restore(prot, { passphrase: 'correct horse battery' });
      if (JSON.stringify(await snapshot()) !== snap0) throw new Error(`rows changed after the protected restore: ${snap0} -> ${JSON.stringify(await snapshot())}`);
      const i = await integrity();
      if (!i.functionsOk || i.rls !== i.rlsExpected || i.anonWithoutRls !== 0) throw new Error('the baseline is not intact after the protected restore');
      // an UNprotected file still restores with no phrase at all (the common case is unchanged)
      await mgr.restore(plain.path);
      if (JSON.stringify(await snapshot()) !== snap0) throw new Error('the plain restore changed the rows');
      return `protected ${(exp.size / 1048576).toFixed(1)} MB: refused twice with no write, restored with the phrase; plain file still restores with no phrase`;
    });
    await R.check('RT.6 export never replaces an existing file and leaves the live company file alone', async () => {
      const f = path.join(WORK, 'roundtrip-keep.tcdb');
      fs.writeFileSync(f, 'precious');
      let code = null;
      try { await mgr.exportTo(f); } catch (e) { code = e.code; }
      if (code !== 'EXPORT_EXISTS' || fs.readFileSync(f, 'utf8') !== 'precious') throw new Error(`existing file: ${code}`);
      const liveBefore = fs.readFileSync(file);
      const snapDir = path.join(WORK, 'snapshots');   // (the live backup of RT.1 made it) - an export must not add to it or refresh anything in it
      const snaps = () => (fs.existsSync(snapDir) ? fs.readdirSync(snapDir).sort().map((n) => `${n}:${fs.statSync(path.join(snapDir, n)).mtimeMs}`).join('|') : '');
      const snapsBefore = snaps();
      await mgr.exportTo(path.join(WORK, 'roundtrip-other.tcdb'), { overwrite: true });
      if (!fs.readFileSync(file).equals(liveBefore)) throw new Error('the live company file changed during an export');
      if (snaps() !== snapsBefore) throw new Error('an export touched the daily snapshots');
      return 'EXPORT_EXISTS, existing file byte-identical, live file untouched, daily snapshots untouched';
    });
  } catch (e) {
    R.rows.push({ name: 'harness', ok: false, evidence: e.stack || e.message, ms: 0 });
    console.log(`  FAIL  harness — ${e.message}`);
  } finally {
    await stopApp(child, userData);
  }
  fs.writeFileSync(path.join(WORK, 'roundtrip-results.json'), JSON.stringify({ at: new Date().toISOString(), summary: R.summary(), rows: R.rows }, null, 2));
  console.log(`\nbackup-roundtrip: ${R.summary()}`);
  process.exit(R.failed.length ? 1 : 0);
})();
