#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// legacy-tcdb-check — a .tcdb written by a REAL 1.x build (PostgreSQL 15, made by the lab 1.8.0 run: scripts/e2e/lab-180-migrations.js + the steps in docs/RELEASE_2.0.md)
// is offered to the PACKAGED 2.0 app the way a user does it after the upgrade: the 2.0 app starts over a 1.x data folder, shows the one-time notice, and the
// «فتح» button beside the old company file runs the open-tcdb flow. (First measured with the flow unguarded: docs/RELEASE_2.0.md.)
//
//   node scripts/e2e/legacy-tcdb-check.js --workdir <empty dir> --app <packaged .app> --tcdb <1.x file> --rowcounts <old-rowcounts.txt> [--email … --password …]
//
//   L1  upgrade over a 1.x folder: moved aside whole, notice written, the notice appears in the window (screenshot)
//   L2  the «فتح» button on the notice: a file written by 1.x is REFUSED with a clear message (before: the flow "succeeded" but lost most tables and weakened the database)
//   L3  nothing touched: the 1.x file byte-identical and not rewritten by the sync, the database exactly as before
//   L4  the 2.0 hardening intact (function bodies, no anon-readable table without row security)
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const { ROOT, PORTS, Results, portFree, request, startApp, stopApp, setPgPassword, pgOptions, expectedInventory } = require('./lib');
const bootstrap = require('../../src/bootstrap');

const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const WORK = path.resolve(arg('workdir', ''));
const APP = arg('app', '');
const TCDB = path.resolve(arg('tcdb', ''));
const ROWCOUNTS = arg('rowcounts', '');
const EMAIL = arg('email', 'owner@old18.test');
const PASSWORD = arg('password', 'OldPass#2026');
if (!arg('workdir') || !arg('tcdb')) { console.error('--workdir and --tcdb are required'); process.exit(2); }
const binary = APP ? path.join(path.resolve(APP), 'Contents', 'MacOS', path.basename(path.resolve(APP), '.app')) : '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const API = `http://127.0.0.1:${PORTS.api}`;
const pg = async (sql, params = []) => { const c = new Client(pgOptions()); await c.connect(); try { return await c.query(sql, params); } finally { await c.end(); } };

(async () => {
  const R = new Results();
  fs.rmSync(WORK, { recursive: true, force: true });
  const shots = path.join(WORK, 'shots'); fs.mkdirSync(shots, { recursive: true });
  for (const p of Object.values(PORTS)) if (!(await portFree(p))) { console.error(`port ${p} busy`); process.exit(2); }

  // the user's company file lives in a folder of its own (like ~/Documents/TexaCore); the 1.x data folder names it in its config
  const userFiles = path.join(WORK, 'user-files'); fs.mkdirSync(userFiles, { recursive: true });
  const original = path.join(userFiles, 'old18.tcdb'); fs.copyFileSync(TCDB, original);
  const originalSha = sha(original);
  const userData = path.join(WORK, 'userdata');
  const dd = path.join(userData, 'texacore-data');
  fs.mkdirSync(path.join(dd, 'pgdata'), { recursive: true }); fs.writeFileSync(path.join(dd, 'pgdata', 'PG_VERSION'), '15\n');
  fs.writeFileSync(path.join(dd, 'config.json'), JSON.stringify({ licenseKey: 'FREE-LOCAL', isFree: true, storagePath: userFiles, currentDbPath: original, companies: [{ name: 'شركة الاختبار القديمة', tcdbPath: original, storagePath: userFiles }] }));
  const logFile = path.join(WORK, 'app.log');
  const { child, ready } = startApp({ userData, logFile, appBinary: binary, extraEnv: { TEXACORE_UI_SMOKE: '1', TEXACORE_SHOT_DIR: shots, TEXACORE_STUB_SHELL: '1' } });
  child.on('error', () => {});
  const evidence = {};
  const readLog = () => { try { return fs.readFileSync(logFile, 'utf8'); } catch { return ''; } };
  try {
    await ready;
    const secrets = JSON.parse(fs.readFileSync(path.join(dd, 'secrets.json'), 'utf8'));
    setPgPassword(secrets.dbPassword);
    const H = { 'x-texacore-local-secret': secrets.localApiSecret };
    const ev = async (body) => { const r = await request('POST', `http://127.0.0.1:${PORTS.admin}/api/ui-eval`, { headers: H, body }); if (!r.json || !r.json.ok) throw new Error(`ui-eval: ${r.text.slice(0, 300)}`); return r.json; };
    const js = async (code) => (await ev({ js: code })).result;
    const until = async (fn, ms, what) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`); await sleep(500); } };
    await ev({ size: [900, 1300] });

    await R.check('L1 the 2.0 app over a 1.x folder: the folder is moved aside whole and the one-time notice appears in the launcher window naming the old company file', async () => {
      const asides = fs.readdirSync(userData).filter((n) => n.startsWith('texacore-data.v18-backup-'));
      if (asides.length !== 1) throw new Error(`set-aside folders: ${asides}`);
      const note = JSON.parse(fs.readFileSync(path.join(dd, 'upgrade-notice.json'), 'utf8'));
      if (note.folder !== path.join(userData, asides[0]) || note.tcdb.length !== 1 || note.tcdb[0].path !== original) throw new Error(`notice file: ${JSON.stringify(note)}`);
      await until(async () => (await js(`getComputedStyle(document.getElementById('upgrade-notice')).display`)) === 'block', 30000, 'the notice');
      await js(`window.scrollTo(0, 0)`);
      await ev({ shot: 'legacy-1-notice.png', wait: 300 });
      const w = await js(`({ a: document.getElementById('upgrade-line-a').textContent, folder: document.getElementById('upgrade-folder').textContent, b: document.getElementById('upgrade-line-b').textContent,
        files: [...document.querySelectorAll('#upgrade-file-list .upgrade-file-name')].map((e) => e.textContent), btn: !!document.querySelector('#upgrade-file-list button') })`);
      if (w.folder !== note.folder || !w.btn || w.files.length !== 1) throw new Error(`window: ${JSON.stringify(w)}`);
      evidence.notice = w;
      return `old folder ${asides[0]} kept; notice shows "${w.a}" + folder + "${w.b.slice(0, 50)}…" and the file «${w.files[0]}» with a «فتح» button`;
    });

    const snap = async () => (await pg(`SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r')::int tables,
      (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')::int functions, (SELECT count(*) FROM public.companies)::int companies,
      (SELECT count(*) FROM public.tenants)::int tenants, (SELECT count(*) FROM public.subscription_plans)::int plans, (SELECT count(*) FROM auth.users)::int users,
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity)::int rls`)).rows[0];
    const before = await snap();

    await R.check('L2 the «فتح» button on the notice runs the open-tcdb flow: a file written by 1.x (PostgreSQL 15) is REFUSED, with a clear message, before anything is touched', async () => {
      await js(`document.querySelector('#upgrade-file-list button').click()`);
      await until(() => /refused a pre-2\.0 file/.test(readLog()) && /\(from the upgrade notice\)/.test(readLog()), 120000, 'the refusal');
      await sleep(1500);
      const w = await js(`({ text: document.getElementById('upgrade-status').textContent, cls: document.getElementById('upgrade-status').className, disabled: document.querySelector('#upgrade-file-list button').disabled })`);
      await ev({ shot: 'legacy-2-refused.png', wait: 200 });
      evidence.refusal = w;
      if (!/err/.test(w.cls) || !w.text.length) throw new Error(`window: ${JSON.stringify(w)}`);
      if (/restoring|جارٍ استعادة/i.test(w.text)) throw new Error('the window still says it is restoring');
      return `refused; the window says "${w.text}" (shown as an error, button enabled again)`;
    });

    await R.check('L3 nothing was touched: the 1.x file is byte-identical (and not rewritten by the sync even after a minute); the database is exactly as before (tables, functions, row security, rows)', async () => {
      await sleep(75000);                                                       // the open flow's periodic sync writes every 60 s once it runs
      if (sha(original) !== originalSha) throw new Error('the 1.x file was modified');
      const extra = fs.readdirSync(userFiles).filter((n) => n !== 'old18.tcdb');
      if (extra.length) throw new Error(`files appeared beside it: ${extra.join(', ')}`);
      const after = await snap();
      if (JSON.stringify(after) !== JSON.stringify(before)) throw new Error(`database changed: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
      const note = JSON.parse(fs.readFileSync(path.join(dd, 'upgrade-notice.json'), 'utf8'));
      if (note.dismissedAt) throw new Error('the notice was dismissed by a refused attempt');
      const cfg = JSON.parse(fs.readFileSync(path.join(dd, 'config.json'), 'utf8'));
      if (JSON.stringify(cfg).includes('old18.tcdb')) throw new Error('the 1.x file was written into the new config as a company file');
      evidence.dbUnchanged = after;
      return `file sha256 ${originalSha.slice(0, 16)}… unchanged, no stray files; database unchanged (${after.tables} public tables, ${after.functions} functions, ${after.rls} with row security, ${after.companies} companies, ${after.plans} plans); the notice stays; the file is not registered as a company backup target`;
    });

    await R.check('L4 the 2.0 hardening is intact after the refused attempt: function bodies equal the baseline, 0 anon-readable tables without row security', async () => {
      const { inv } = expectedInventory();     // baseline + the incremental migrations' measured delta
      const fnRows = (await pg(`SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS sig, md5(p.prosrc) AS md5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                               WHERE n.nspname IN ('public','licensing','newpost','tomgenerators') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')`)).rows;
      const fn = bootstrap.compareFunctionInventory(inv.functions_md5, fnRows);
      const open = (await pg(`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity AND has_table_privilege('anon', c.oid, 'SELECT')`)).rows[0].n;
      if (!fn.ok) throw new Error(`function bodies differ: ${(fn.problems || []).slice(0, 3).join(' | ')}`);
      if (open) throw new Error(`${open} public tables are anon-readable without row security`);
      return 'function bodies equal the baseline; 0 anon-readable tables without row security';
    });
  } finally {
    await stopApp(child, userData);
  }
  fs.writeFileSync(path.join(WORK, 'results.json'), JSON.stringify({ at: new Date().toISOString(), app: APP, tcdb: TCDB, tcdbSha256: originalSha, summary: R.summary(), rows: R.rows, evidence }, null, 2));
  console.log(`\nlegacy-tcdb-check: ${R.summary()}  →  ${WORK}/results.json`);
  process.exit(R.failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
