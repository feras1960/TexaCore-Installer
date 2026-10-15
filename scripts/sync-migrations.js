#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// sync-migrations — the incremental migrations production received AFTER the baseline cut, fetched from the PRIVATE ERP repo at BUILD TIME into ./migrations
// (git-ignored build output, like ./frontend) together with the manifest the runtime reads. Nothing of this is committed to this PUBLIC repo: the only committed
// piece is baseline/MIGRATIONS_PIN.json (names, order, sha256, bytes — no SQL).
//
//   node scripts/sync-migrations.js --erp <ERP checkout> [--ref origin/main]
//        build mode: every pinned file is read with `git show <ref>:supabase/migrations/<file>` (the ref's content, not the working tree), must equal the pin's sha256,
//        and ./migrations is rewritten from scratch: the .sql files + migrations.json (baseline tie, pinned list, inventoryAfter). Fails on ANY difference.
//   node scripts/sync-migrations.js --erp <ERP checkout> [--ref origin/main] --update-pin --names <name1,name2,…>
//        (re)writes baseline/MIGRATIONS_PIN.json: names = file names without .sql, in the order PRODUCTION applied them (not alphabetical); sha256/bytes measured from the ref.
//        An unchanged list keeps its inventory entry; a changed list must be re-measured.
//   node scripts/sync-migrations.js --inventory <file>
//        install the measured inventory delta (scripts/e2e/migrations-check.js --write-inventory) as baseline/migrations.inventory.json (private, git-ignored) and pin its sha256
//   node scripts/sync-migrations.js --verify-only
//        no ERP needed: check ./migrations against the pin and the baseline pin
//
// The pin carries baselineSha256 (from baseline/BASELINE_PIN.json): the runtime applies the migrations only to a database built from that exact baseline.
// Re-cutting the baseline folds the applied migrations in: --update-pin --names "" and regenerate.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const M = require('./lib/migrations-manifest');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'migrations');
const BASE = path.join(ROOT, 'baseline');

function arg(n, d = '') { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; }
const has = (n) => process.argv.includes(`--${n}`);
const baselineSha = () => JSON.parse(fs.readFileSync(path.join(BASE, 'BASELINE_PIN.json'), 'utf8')).files['production_baseline.sql'].sha256;
const fail = (msg) => { console.error(msg); process.exit(1); };

/** One file of the ERP repo at `ref` (a Buffer). git reads the object, so the checkout's working tree and branch do not matter. */
function erpFile(erp, ref, file) {
  try { return execFileSync('git', ['-C', erp, 'show', `${ref}:supabase/migrations/${file}`], { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { return fail(`${file}: not found in ${ref} of ${erp} (${String(e.stderr || e.message).trim().split('\n')[0]})`); }
}
function resolveRef(erp, ref) {
  try { return execFileSync('git', ['-C', erp, 'rev-parse', '--verify', `${ref}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { return fail(`${ref} is not a commit of ${erp}`); }
}

function updatePin(erp, ref) {
  const names = arg('names').split(',').map((s) => s.trim()).filter(Boolean);
  const commit = resolveRef(erp, ref);
  let prev = null; try { prev = M.loadMigrationsPin(BASE); } catch { /* rewritten */ }
  const list = names.map((name, i) => {
    const buf = erpFile(erp, ref, `${name}.sql`);
    return { order: i + 1, name, file: `${name}.sql`, sha256: M.sha256(buf), bytes: buf.length };
  });
  const pin = {
    schema: 1,
    note: 'The ERP repo (private) supabase/migrations files production received after the baseline cut: names, order, sha256, bytes. NO SQL here - scripts/sync-migrations.js fetches the files at build time and checks them against this pin; scripts/pack-baseline.js packs them into the encrypted container.',
    baselineSha256: baselineSha(),
    erpCommit: commit,
    migrations: list,
  };
  const same = prev && prev.migrations && JSON.stringify(prev.migrations.map((m) => [m.name, m.sha256])) === JSON.stringify(list.map((m) => [m.name, m.sha256]));
  if (same && prev.inventory && prev.baselineSha256 === pin.baselineSha256) pin.inventory = prev.inventory;
  else if (list.length) console.warn('note: the list or a file changed - the inventory delta must be re-measured: scripts/e2e/migrations-check.js --write-inventory <file>, then: node scripts/sync-migrations.js --inventory <file>');
  fs.writeFileSync(path.join(BASE, M.PIN_FILE), JSON.stringify(pin, null, 2) + '\n');
  console.log(`pin: ${list.length} migration(s) from ${commit.slice(0, 9)} written to baseline/${M.PIN_FILE} for baseline ${pin.baselineSha256.slice(0, 12)}…`);
}

function installInventory(file) {
  const pin = M.loadMigrationsPin(BASE);
  if (!pin) fail(`baseline/${M.PIN_FILE} does not exist - write the pin first (--update-pin)`);
  const inv = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  if (!inv || typeof inv.catalogDelta !== 'object' || typeof inv.functions !== 'object' || !Array.isArray(inv.removed)) fail('not an inventory delta: expected { catalogDelta, functions, removed }');
  const buf = Buffer.from(JSON.stringify(inv, null, 2) + '\n');
  fs.writeFileSync(path.join(BASE, M.INVENTORY_FILE), buf, { mode: 0o600 });
  pin.inventory = { file: M.INVENTORY_FILE, sha256: M.sha256(buf), bytes: buf.length };
  fs.writeFileSync(path.join(BASE, M.PIN_FILE), JSON.stringify(pin, null, 2) + '\n');
  console.log(`inventory: ${Object.keys(inv.functions).length} function(s), delta ${JSON.stringify(inv.catalogDelta)} → baseline/${M.INVENTORY_FILE} (private), sha256 pinned`);
}

/** Pin + generated folder + private inventory, all consistent. Returns problems[]. */
function verifyAll() {
  const pin = M.loadMigrationsPin(BASE);
  if (!pin) return [`baseline/${M.PIN_FILE} does not exist`];
  const problems = M.checkPin(pin, baselineSha());
  if (problems.length) return problems;
  if (!pin.migrations.length) return fs.existsSync(OUT) && fs.readdirSync(OUT).length ? ['./migrations holds files but the pin lists none - remove ./migrations'] : [];
  const inv = M.checkInventory(BASE, pin);
  problems.push(...inv.problems);
  const r = M.checkManifest(OUT, baselineSha());
  problems.push(...r.problems);
  if (r.manifest) problems.push(...M.checkAgainstPin(r.manifest, pin));
  if (r.manifest && inv.inventory && JSON.stringify(r.manifest.inventoryAfter) !== JSON.stringify(inv.inventory)) problems.push('migrations.json inventoryAfter differs from baseline/migrations.inventory.json');
  return problems;
}

function build(erp, ref) {
  const pin = M.loadMigrationsPin(BASE);
  if (!pin) fail(`baseline/${M.PIN_FILE} does not exist`);
  const pp = M.checkPin(pin, baselineSha());
  if (pp.length) fail(`migrations pin: ${pp.join('; ')}`);
  const commit = resolveRef(erp, ref);
  fs.rmSync(OUT, { recursive: true, force: true });
  if (!pin.migrations.length) { console.log('migrations: the pin lists none - nothing to fetch (./migrations removed)'); return; }
  const inv = M.checkInventory(BASE, pin);
  if (inv.problems.length) fail(`migrations: ${inv.problems.join('; ')}`);
  fs.mkdirSync(OUT, { recursive: true });
  for (const m of pin.migrations) {
    const buf = erpFile(erp, ref, m.file);
    if (M.sha256(buf) !== m.sha256 || buf.length !== m.bytes) {
      fs.rmSync(OUT, { recursive: true, force: true });
      fail(`${m.file} in ${ref} (${commit.slice(0, 9)}) is not what the pin says (sha256 ${M.sha256(buf).slice(0, 12)}…, ${buf.length} bytes; pinned ${m.sha256.slice(0, 12)}…, ${m.bytes}). If the change is intended, re-pin it: node scripts/sync-migrations.js --erp <ERP> --update-pin --names <list>`);
    }
    fs.writeFileSync(path.join(OUT, m.file), buf);
  }
  const manifest = { ...M.buildManifest(pin, inv.inventory), erpCommit: commit };
  fs.writeFileSync(path.join(OUT, 'migrations.json'), JSON.stringify(manifest, null, 2) + '\n');
  const problems = verifyAll();
  if (problems.length) fail(problems.join('\n'));
  console.log(`migrations: ${pin.migrations.length} file(s) fetched from ${ref} @ ${commit.slice(0, 9)} (every sha256 = the pin), manifest written for baseline ${pin.baselineSha256.slice(0, 12)}… → ./migrations (git-ignored build output)`);
}

function main() {
  if (has('inventory')) return installInventory(arg('inventory'));
  if (has('verify-only')) {
    const problems = verifyAll();
    if (problems.length) fail(`migrations: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`);
    const pin = M.loadMigrationsPin(BASE);
    return console.log(`migrations OK: ${pin.migrations.length} file(s), baseline ${pin.baselineSha256.slice(0, 12)}…`);
  }
  const erp = arg('erp');
  if (!erp) fail('--erp <ERP checkout> is required (or --verify-only / --inventory <file>)');
  const ref = arg('ref', 'origin/main');
  return has('update-pin') ? updatePin(path.resolve(erp), ref) : build(path.resolve(erp), ref);
}

if (require.main === module) main();
module.exports = { verifyAll };
