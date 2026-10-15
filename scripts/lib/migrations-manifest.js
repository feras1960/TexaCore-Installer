'use strict';
// ════════════════════════════════════════════════════════════════
// migrations-manifest — the incremental SQL migrations (2.0.2+): the files production received AFTER the baseline was cut.
//
// NOTHING OF THIS IS IN GIT. The ERP repo is private; this installer repo is public. What is committed is only the PIN (baseline/MIGRATIONS_PIN.json:
// names, order, sha256, bytes — no SQL). At build time scripts/sync-migrations.js fetches the files from the ERP repo (git show <ref>:supabase/migrations/<file>),
// checks every one against the pin and writes ./migrations (git-ignored BUILD OUTPUT):
//
//   migrations/migrations.json   { schema, baselineSha256, erpCommit, migrations: [{ order, name, file, sha256, bytes }], inventoryAfter? }
//   migrations/<file>.sql        byte-for-byte copies of the ERP repo's supabase/migrations files
//
// scripts/pack-baseline.js then packs migrations.json + the .sql files into the ENCRYPTED container (migrations.bin, same TXB1 format and key as the baseline).
// The package carries NO plaintext migration at all; the runtime (src/migrations-store.js) decrypts them in memory.
//
// service-manager.runMigrations() applies the manifest only when baselineSha256 equals the install marker's baseline sha256, so a re-cut baseline
// that is not followed by a regenerated pin simply stops applying (and prebuild-checks fails the build first).
//
// checkManifest() checks a generated ./migrations folder (prebuild-checks, pack-baseline); checkAgainstPin() ties a manifest (generated or unpacked) to the pin.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PIN_FILE = 'MIGRATIONS_PIN.json';
const INVENTORY_FILE = 'migrations.inventory.json';       // private build input (baseline/, git-ignored): the measured inventory delta; the pin holds its sha256
const NAME_RE = /^[A-Za-z0-9_.-]+\.sql$/;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const sha256File = (f) => sha256(fs.readFileSync(f));

/** baseline/MIGRATIONS_PIN.json → object, or null when the file does not exist (a release without incremental migrations). Throws on unreadable JSON. */
function loadMigrationsPin(baselineDir) {
  const f = path.join(baselineDir, PIN_FILE);
  if (!fs.existsSync(f)) return null;
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/** The pin itself: shape, tied to the baseline pin, names valid and unique, order 1..n. Returns problems[]. */
function checkPin(pin, baselinePinSha256) {
  const problems = [];
  if (!pin || typeof pin !== 'object') return ['MIGRATIONS_PIN.json is not an object'];
  if (!pin.baselineSha256) problems.push('MIGRATIONS_PIN.json has no baselineSha256');
  else if (baselinePinSha256 && pin.baselineSha256 !== baselinePinSha256) problems.push(`MIGRATIONS_PIN.json is for baseline ${String(pin.baselineSha256).slice(0, 12)}…, the pinned baseline is ${String(baselinePinSha256).slice(0, 12)}… — regenerate it (node scripts/sync-migrations.js --erp <ERP checkout> --update-pin --names …)`);
  if (!Array.isArray(pin.migrations)) { problems.push('MIGRATIONS_PIN.json has no "migrations" list'); return problems; }
  const seen = new Set();
  pin.migrations.forEach((m, i) => {
    if (!m || typeof m.name !== 'string' || typeof m.file !== 'string' || !NAME_RE.test(m.file) || m.file.includes('..') || m.file !== `${m.name}.sql`) { problems.push(`a bad pin entry: ${JSON.stringify(m)}`); return; }
    if (seen.has(m.name)) problems.push(`migration ${m.name} is pinned twice`);
    seen.add(m.name);
    if (!/^[0-9a-f]{64}$/.test(m.sha256 || '')) problems.push(`${m.file}: no valid sha256 in the pin`);
    if (!Number.isInteger(m.bytes) || m.bytes <= 0) problems.push(`${m.file}: no byte size in the pin`);
    if (m.order !== i + 1) problems.push(`${m.file}: order ${m.order}, expected ${i + 1}`);
  });
  if (pin.migrations.length && !(pin.inventory && /^[0-9a-f]{64}$/.test(pin.inventory.sha256 || ''))) problems.push('MIGRATIONS_PIN.json carries no inventory sha256 — measure it (scripts/e2e/migrations-check.js --write-inventory) and run: node scripts/sync-migrations.js --inventory <file>');
  return problems;
}

/** The private inventory delta file (baseline/migrations.inventory.json) against the pin. Returns problems[]; the parsed object is returned as .inventory when it is fine. */
function checkInventory(baselineDir, pin) {
  const out = { problems: [], inventory: null };
  if (!pin || !pin.migrations || !pin.migrations.length) return out;
  const f = path.join(baselineDir, (pin.inventory && pin.inventory.file) || INVENTORY_FILE);
  if (!fs.existsSync(f)) { out.problems.push(`baseline/${path.basename(f)} is missing (the measured inventory delta of the migrations; private like the baseline)`); return out; }
  const buf = fs.readFileSync(f);
  if (!pin.inventory || sha256(buf) !== pin.inventory.sha256) { out.problems.push(`baseline/${path.basename(f)} differs from the sha256 in MIGRATIONS_PIN.json`); return out; }
  try { out.inventory = JSON.parse(buf.toString('utf8')); } catch (e) { out.problems.push(`baseline/${path.basename(f)} is unreadable: ${e.message}`); }
  return out;
}

/** The manifest the runtime reads (and the container carries): the pin's list + the baseline tie + the measured inventory delta. */
function buildManifest(pin, inventory) {
  return {
    schema: 1,
    baselineSha256: pin.baselineSha256,
    erpCommit: pin.erpCommit || '',
    migrations: pin.migrations.map((m) => ({ order: m.order, name: m.name, file: m.file, sha256: m.sha256, bytes: m.bytes })),
    ...(inventory ? { inventoryAfter: inventory } : {}),
  };
}

/** A manifest (the generated one, or the one unpacked from the container) is exactly the pin: same baseline, same names, order, sha256, bytes. Returns problems[]. */
function checkAgainstPin(manifest, pin) {
  const problems = [];
  if (!manifest) return ['no manifest'];
  if (manifest.baselineSha256 !== pin.baselineSha256) problems.push(`manifest baselineSha256 ${String(manifest.baselineSha256).slice(0, 12)}… differs from the pin's ${String(pin.baselineSha256).slice(0, 12)}…`);
  const a = (manifest.migrations || []).map((m) => `${m.order}|${m.name}|${m.file}|${m.sha256}|${m.bytes}`);
  const b = pin.migrations.map((m) => `${m.order}|${m.name}|${m.file}|${m.sha256}|${m.bytes}`);
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) problems.push(`the manifest's migration list (${a.length}) is not the pin's (${b.length}): names, order, sha256 and sizes must be identical`);
  if (pin.migrations.length && !manifest.inventoryAfter) problems.push('the manifest carries no inventoryAfter');
  return problems;
}

/**
 * @param {string} dir            a generated migrations folder (repo ./migrations)
 * @param {string} pinSha256      the baseline pin's production_baseline.sql sha256
 * @returns {{ problems: string[], files: string[], manifest: object|null }}   files = absolute paths of the listed .sql files that passed
 */
function checkManifest(dir, pinSha256) {
  const problems = [];
  const files = [];
  const mp = path.join(dir, 'migrations.json');
  if (!fs.existsSync(mp)) return { problems: [`${mp} is missing`], files, manifest: null };
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch (e) { return { problems: [`migrations.json is unreadable (${e.message})`], files, manifest: null }; }
  if (!manifest.baselineSha256) problems.push('migrations.json has no baselineSha256 — a 1.x manifest must not ship');
  else if (pinSha256 && manifest.baselineSha256 !== pinSha256) problems.push(`migrations.json is for baseline ${String(manifest.baselineSha256).slice(0, 12)}…, the pinned baseline is ${String(pinSha256).slice(0, 12)}… — regenerate it (scripts/sync-migrations.js)`);
  const list = Array.isArray(manifest.migrations) ? manifest.migrations : null;
  if (!list) { problems.push('migrations.json has no "migrations" list'); return { problems, files, manifest }; }
  const seenNames = new Set();
  for (const m of list) {
    if (!m || typeof m.name !== 'string' || typeof m.file !== 'string' || !NAME_RE.test(m.file) || m.file.includes('..')) { problems.push(`a bad manifest entry: ${JSON.stringify(m)}`); continue; }
    if (seenNames.has(m.name)) problems.push(`migration ${m.name} is listed twice`);
    seenNames.add(m.name);
    const f = path.join(dir, m.file);
    if (!fs.existsSync(f)) { problems.push(`${m.file} is listed but missing`); continue; }
    if (!m.sha256) { problems.push(`${m.file}: no sha256 in the manifest`); continue; }
    if (sha256File(f) !== m.sha256) { problems.push(`${m.file} differs from the manifest's sha256 (edited or corrupted)`); continue; }
    files.push(f);
  }
  // nothing else may ride along: every .sql in the folder must be listed (an unlisted file would never run, and could hide anything)
  const listed = new Set(list.map((m) => m && m.file));
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && /\.sql$/i.test(e.name) && !listed.has(e.name)) problems.push(`${e.name} is in the migrations folder but not in migrations.json`);
    else if (e.isDirectory()) problems.push(`unexpected folder ${e.name} in the migrations folder`);
  }
  return { problems, files, manifest };
}

module.exports = { PIN_FILE, INVENTORY_FILE, NAME_RE, sha256, sha256File, loadMigrationsPin, checkPin, checkInventory, buildManifest, checkAgainstPin, checkManifest };
