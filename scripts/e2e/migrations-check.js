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
//   D   fingerprints: for every function the shipped migrations created or replaced, md5(prosrc) (and owner-side grants / SECURITY DEFINER) on this database equals production's post-image
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { PORTS, Results, portFree, request, startApp, stopApp, setPgPassword, pgOptions } = require('./lib');
const MM = require('../lib/migrations-manifest');
const { checkManifest } = MM;
const { readPackedMigrations } = require('../lib/verify-packed');

function arg(name, def = '') { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; }
const WORK = path.resolve(arg('workdir', ''));
const APP = arg('app', '') ? path.resolve(arg('app')) : '';
const OLD_APP = arg('old-app', '') ? path.resolve(arg('old-app')) : '';
const PROD_FP = arg('prod-fp', '') ? path.resolve(arg('prod-fp')) : '';
const WRITE_INV = arg('write-inventory', '');
if (!arg('workdir')) { console.error('--workdir <dir> is required'); process.exit(2); }
const ROOT = path.join(__dirname, '..', '..');
const ADMIN = `http://127.0.0.1:${PORTS.admin}`;
const API = `http://127.0.0.1:${PORTS.api}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      return `${got.length} applied: ${NAMES.map((n) => n.replace(/^20270210/, '').split('_')[0]).join(' ')}; migrations.log: ${ok} ✅ lines`;
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
    freshFp = await fingerprint();
  } finally { if (a) await stopApp(a.child, A); }

  // ═════════ B: an UPGRADE: the previous build's install, then this build on the same data ═════════
  let preFp = null; let postFp = null; let upg = null; let catPre = null; let catPost = null; let invPre = null; let invPost = null;
  if (OLD_APP) {
    const B = path.join(WORK, 'upgrade');
    let o = null; let oc = null; let cardOld = null; let counts0 = null;
    try {
      o = await boot(B, OLD_APP, 'old');
      await R.check('B1 UPGRADE, step 1: the previous build provisions an install (no migration table), a company and one material card with a typed code', async () => {
        const t = (await pg(`SELECT to_regclass('public._texacore_migrations') IS NOT NULL AS has`)).rows[0].has;
        if (t) throw new Error('the previous build already has a migration table');
        oc = await createCompany(o.secrets, 'b');
        cardOld = (await pg(`INSERT INTO public.fabric_materials (tenant_id, company_id, code, name_ar) VALUES ($1,$2,'OLD-1','بطاقة قديمة') RETURNING id, code, created_at`, [oc.tenantId, oc.companyId])).rows[0];
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
        if (JSON.stringify(counts1) !== JSON.stringify(counts0)) throw new Error(`data changed: ${JSON.stringify(counts0)} -> ${JSON.stringify(counts1)}`);
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
        // a new card on the upgraded company: M-000001 (the typed OLD-1 is not an M-<digits> code)
        const auth = { apikey: upg.secrets.anonKey, Authorization: `Bearer ${login.json.access_token}`, Prefer: 'return=representation' };
        const r1 = await request('POST', `${API}/rest/v1/fabric_materials`, { headers: auth, body: { tenant_id: oc.tenantId, company_id: oc.companyId, code: null, name_ar: 'بطاقة جديدة' } });
        if (r1.status !== 201 || r1.json[0].code !== 'M-000001') throw new Error(`new card on the upgraded install → ${r1.status} ${r1.text.slice(0, 200)}`);
        postFp = await fingerprint(); catPost = await catalog(); invPost = await invFns();
        return `${got.length} applied on start; counts ${JSON.stringify(counts1)} unchanged; OLD-1 intact and readable by its admin; new card ${r1.json[0].code}; migrations.log ${ok} ✅`;
      });
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
    } finally { if (second) await stopApp(second.child, B); }

    await R.check('B4 the upgraded install and the fresh install have the SAME functions, triggers, policies and table grants (the upgrade path equals the fresh path)', async () => {
      const diff = (x, y) => { const sx = new Set(x); const sy = new Set(y); return [...x.filter((l) => !sy.has(l)).map((l) => `only upgraded: ${l}`), ...y.filter((l) => !sx.has(l)).map((l) => `only fresh: ${l}`)]; };
      // table lines carry grants and rls flags only; data-independent
      const d = diff(postFp, freshFp);
      if (d.length) throw new Error(`${d.length} difference(s), first: ${d.slice(0, 4).join(' | ')}`);
      return `${postFp.length} fingerprint lines identical (F ${postFp.filter((l) => l.startsWith('F|')).length}, G ${postFp.filter((l) => l.startsWith('G|')).length}, P ${postFp.filter((l) => l.startsWith('P|')).length}, T ${postFp.filter((l) => l.startsWith('T|')).length})`;
    });
  }

  // ═════════ D: fingerprints against production's post-image ═════════
  const post = postFp || freshFp;
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
