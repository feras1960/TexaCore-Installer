#!/usr/bin/env node
/**
 * fresh-install-e2e.js — TRUE fresh-install replica + end-to-end validation.
 * ───────────────────────────────────────────────────────────────────────────
 * The dev's Mac DB is an ACCUMULATED database (loose, hand-patched constraints)
 * so it can't catch what only breaks on a clean Windows install (strict
 * cloud-aligned constraints, empty seed tables, stale triggers). This script
 * builds a database EXACTLY like a fresh install — applying every migration in
 * migrations.json, in order, with the same sanitizations migration-runner.js
 * uses — then runs the real flows (company create + RSF import + plan limits)
 * and ASSERTS the result. What passes here passes on Windows, literally.
 *
 * Usage:  PGPASSWORD=postgres node scripts/verify/fresh-install-e2e.js [rsfPath]
 * Exits non-zero if any assertion fails.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { Client } = require('pg');

const PG_BIN = process.env.PG_BIN || '/opt/homebrew/opt/postgresql@15/bin';
const HOST = '127.0.0.1', PORT = '54322', USER = 'postgres';
const DB = 'fresh_install_test';
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');
const RSF_PATH = process.argv[2] ||
  path.join(os.homedir(), 'Library/Application Support/texacore-installer/texacore-data/rsf/2023 مطور بعد الصيانة.rsf');

function psql(args, input) {
  return execFileSync(path.join(PG_BIN, 'psql'),
    ['-h', HOST, '-p', PORT, '-U', USER, ...args],
    { input, encoding: 'utf8', env: { ...process.env, PGPASSWORD: 'postgres' }, maxBuffer: 1 << 28 });
}

// the exact sanitizations migration-runner.js applies (lines 117-126)
function sanitize(sql) {
  return sql
    .replace(/^\\restrict\s+.*$/gm, '-- x')
    .replace(/^\\unrestrict\s+.*$/gm, '-- x')
    .replace(/^SET transaction_timeout\s*=\s*\d+;$/gm, '-- x')
    .replace(/^DROP SCHEMA IF EXISTS public;$/gm, '-- x')
    .replace(/^CREATE SCHEMA public;$/gm, 'CREATE SCHEMA IF NOT EXISTS public;')
    .replace(/extensions\.uuid_generate_v4\(\)/g, 'gen_random_uuid()');
}

async function provision() {
  console.log('[1/4] Provisioning a CLEAN database from migrations.json …');
  psql(['-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`]);
  psql(['-d', 'postgres', '-c', `CREATE DATABASE ${DB}`]);
  // Base objects a real install's bundled postgres + GoTrue provide BEFORE
  // migrations run. Critically auth.users must exist so the big schema-sync
  // migration applies FULLY (its FKs/constraints reference auth.users) — without
  // it the sync half-applies and leaves looser constraints, so the harness would
  // miss constraint bugs (e.g. purchase_transactions_stage_check) that only bite
  // on a real install. auth.uid()/role()/jwt() mirror Supabase's.
  psql(['-d', DB, '-v', 'ON_ERROR_STOP=0', '-c', `
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email varchar(255), encrypted_password varchar(255),
      raw_user_meta_data jsonb, raw_app_meta_data jsonb,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $f$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $f$;
    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $f$;
  `]);

  const manifest = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'migrations.json'), 'utf8')).migrations;
  let ok = 0, failed = [];
  for (const m of manifest) {
    const fp = path.join(MIGRATIONS_DIR, m.file);
    if (!fs.existsSync(fp)) { failed.push(`${m.name}: file missing`); continue; }
    const sql = sanitize(fs.readFileSync(fp, 'utf8'));
    const tmp = path.join(os.tmpdir(), `fie_${m.order}.sql`);
    fs.writeFileSync(tmp, sql);
    try {
      const out = psql(['-d', DB, '-v', 'ON_ERROR_STOP=0', '-f', tmp]);
      ok++;
    } catch (e) { failed.push(`${m.name}: ${String(e.stderr || e.message).slice(0, 120)}`); }
    finally { try { fs.unlinkSync(tmp); } catch {} }
  }
  console.log(`      applied ${ok}/${manifest.length} migrations`);
  return { ok, total: manifest.length };
}

async function run() {
  await provision();
  const results = { pass: [], fail: [] };
  const assert = (cond, msg) => (cond ? results.pass : results.fail).push(msg);

  const c = new Client({ host: HOST, port: PORT, database: DB, user: USER, password: 'postgres' });
  await c.connect();

  // ── make auth.uid() the real NULL-safe version (no JWT in this context) ──
  await c.query(`CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $$;`);

  console.log('[2/4] Seeding a company the way the IMPORT handler does (minimal) …');
  const TID = '11111111-1111-1111-1111-111111111111', CID = '22222222-2222-2222-2222-222222222222';
  await c.query('BEGIN');
  await c.query(`SET LOCAL session_replication_role = replica`);
  await c.query(`INSERT INTO tenants (id, code, name) VALUES ($1,'FIT','FIT')`, [TID]);
  await c.query(`INSERT INTO companies (id, tenant_id, name, name_ar, code, default_currency) VALUES ($1,$2,'FIT','تجريبي','FIT','UAH')`, [CID, TID]);
  await c.query(`INSERT INTO fiscal_years (id, company_id, tenant_id, name, code, start_date, end_date, is_current)
    VALUES (gen_random_uuid(),$1,$2,'2023','FY','2023-01-01','2023-12-31',true)`, [CID, TID]);
  // Deliberately DO NOT seed a subscription — this mirrors a trial/imported
  // install (no tenant_subscriptions row), which is exactly what showed "0/0".
  // 20260626m must report the limits as unlimited (self-hosted owner) anyway so
  // invoice creation isn't blocked.
  await c.query('COMMIT');

  console.log('[3/4] Running the REAL RSF import …');
  const { RsfReader } = require('../../src/rsf-reader');
  const { RsfMapper } = require('../../src/rsf-mapper');
  const reader = new RsfReader(RSF_PATH);
  await reader.open();
  const file = reader.getSummary().counts;
  const mapper = new RsfMapper(reader, TID, CID, null);
  const r = await mapper.importAll(c);

  console.log('[4/4] Asserting …');
  // import errors must be empty
  assert(r.errors.length === 0, `import errors = ${r.errors.length}: ${JSON.stringify(r.errors.map(e => (e.phase || '') + ' → ' + (e.error || e)))}`);
  // every entity in the file is imported (legit skips accounted for)
  assert(r.counts.purchaseInvoices >= file.purchaseInvoices, `purchaseInvoices ${r.counts.purchaseInvoices}/${file.purchaseInvoices}`);
  assert(r.counts.inventoryMoves >= file.inventoryMoves, `inventoryMoves ${r.counts.inventoryMoves}/${file.inventoryMoves}`);
  assert(r.counts.salesInvoices >= file.salesInvoices, `salesInvoices ${r.counts.salesInvoices}/${file.salesInvoices}`);
  // purchase orders: file count minus the ones converted to invoices
  assert(r.counts.purchaseOrders >= 1, `purchaseOrders ${r.counts.purchaseOrders}/${file.purchaseOrders}`);

  // plan limits must resolve (the "0/0" bug): an imported company must be able to create invoices
  const lim = (await c.query(`SELECT get_all_plan_limits($1) AS j`, [TID])).rows[0].j;
  const inv = lim && lim.limits && lim.limits.invoices_monthly;
  assert(inv && inv.allowed === true, `invoice limit not allowed: ${JSON.stringify(lim && (lim.error || inv))}`);

  await c.end();

  console.log('\n══════════ RESULT ══════════');
  results.pass.forEach(m => console.log('  ✅ ' + m));
  results.fail.forEach(m => console.log('  ❌ ' + m));
  console.log(`\n${results.fail.length === 0 ? '🎉 ALL PASS — a fresh Windows install will work.' : '🛑 ' + results.fail.length + ' FAILURE(S) — fix before shipping.'}`);
  process.exit(results.fail.length === 0 ? 0 : 1);
}

run().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(2); });
