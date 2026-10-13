#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// sync-baseline — embed the production schema baseline into the installer build.
//
// The fresh-install database is built from the ERP repo's redacted production extract
// (supabase/baseline/production_baseline.sql — see that folder's BASELINE.md). That file is PRIVATE
// and ~10 MB, so it is NEVER committed here: it is copied into ./baseline at build time from an ERP checkout and
// pinned by sha256 in baseline/BASELINE_PIN.json (the only baseline file that is committed).
//
//   node scripts/sync-baseline.js --erp <ERP checkout>            copy + VERIFY against the pin (build mode; fails on any difference)
//   node scripts/sync-baseline.js --erp <ERP checkout> --update-pin
//                                                                 copy + REWRITE the pin (what you run after re-cutting the baseline)
//   node scripts/sync-baseline.js --verify-only                   no ERP needed: check ./baseline against the pin
//
// Files shipped (all listed in the pin; all checked again in afterPack against the packaged copy):
//   production_baseline.sql            the app schemas (public, licensing, newpost, tomgenerators) — structure only
//   production_baseline.inventory.json counts + md5(prosrc) of every function at the cut, used to verify an install
//   storage_stubs.sql                  the ERP's auth/storage stub file WITHOUT its auth.* statements (GoTrue owns auth on a real
//                                      install; only the storage schema the baseline's policies/triggers hang on is taken)
//   reference_data.sql                 OPTIONAL global catalogs exported from production (supabase/baseline/reference_data.sql in the ERP)
//
// Re-cut checklist (the baseline changes, nothing else does):
//   1. ERP: scripts/schema/build-baseline.sh (and copy the stub file as BASELINE.md says)
//   2. here: node scripts/sync-baseline.js --erp <ERP> --update-pin   → commit baseline/BASELINE_PIN.json only
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { splitStatements, targetsSchema } = require('./lib/sql-split');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'baseline');
const PIN_FILE = path.join(OUT, 'BASELINE_PIN.json');

// shipped name → ERP-relative source (null = derived)
const SOURCES = {
  'production_baseline.sql': { src: 'supabase/baseline/production_baseline.sql', required: true },
  'production_baseline.inventory.json': { src: 'supabase/baseline/production_baseline.inventory.json', required: true },
  'storage_stubs.sql': { src: 'tests/fixtures/prod_schema_auth_storage_stubs.sql', required: true, derive: deriveStorageStubs },
  'reference_data.sql': { src: 'supabase/baseline/reference_data.sql', required: false },
};

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

/** The ERP's stub file without the statements that belong to the auth schema (GoTrue creates and owns that one). */
function deriveStorageStubs(text) {
  return splitStatements(text).filter((s) => !targetsSchema(s, 'auth')).join('\n') + '\n';
}

function git(erp, args) {
  try { return execFileSync('git', ['-C', erp, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}

function readPin() {
  try { return JSON.parse(fs.readFileSync(PIN_FILE, 'utf8')); } catch { return null; }
}

function parseArgs(argv) {
  const a = { erp: process.env.TEXACORE_ERP_DIR || '', updatePin: false, verifyOnly: false, allowDirty: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--erp') a.erp = argv[++i];
    else if (argv[i] === '--update-pin') a.updatePin = true;
    else if (argv[i] === '--verify-only') a.verifyOnly = true;
    else if (argv[i] === '--allow-dirty') a.allowDirty = true;
    else { console.error(`unknown argument ${argv[i]}`); process.exit(2); }
  }
  return a;
}

/** Verify ./baseline against the pin. Returns problems[] (empty = OK). Exported for tests and afterPack. */
function verifyDir(dir, pin) {
  const problems = [];
  if (!pin || !pin.files) return ['BASELINE_PIN.json is missing or malformed'];
  for (const [name, meta] of Object.entries(pin.files)) {
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) { problems.push(`${name}: missing`); continue; }
    const buf = fs.readFileSync(f);
    if (buf.length !== meta.bytes) problems.push(`${name}: ${buf.length} bytes, pin says ${meta.bytes}`);
    const got = sha256(buf);
    if (got !== meta.sha256) problems.push(`${name}: sha256 ${got} != pin ${meta.sha256}`);
  }
  return problems;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pin = readPin();

  if (args.verifyOnly) {
    const problems = verifyDir(OUT, pin);
    if (problems.length) { console.error('baseline verification FAILED:\n  ' + problems.join('\n  ')); process.exit(1); }
    console.log(`baseline OK (${Object.keys(pin.files).length} files, cut ${pin.cutTimestamp})`);
    return;
  }

  if (!args.erp) { console.error('--erp <ERP checkout> (or TEXACORE_ERP_DIR) is required'); process.exit(2); }
  const erp = path.resolve(args.erp);
  if (!fs.existsSync(path.join(erp, 'supabase/baseline/production_baseline.sql'))) {
    console.error(`${erp} has no supabase/baseline/production_baseline.sql — not an ERP checkout`); process.exit(2);
  }

  const dirty = git(erp, ['status', '--porcelain', '--', 'supabase/baseline', 'tests/fixtures/prod_schema_auth_storage_stubs.sql']);
  if (dirty && !args.allowDirty) {
    console.error(`the baseline files in ${erp} have uncommitted changes:\n${dirty}\n(commit them, or pass --allow-dirty for a local experiment — never for a release)`);
    process.exit(1);
  }

  fs.mkdirSync(OUT, { recursive: true });
  const files = {};
  for (const [name, spec] of Object.entries(SOURCES)) {
    const srcPath = path.join(erp, spec.src);
    if (!fs.existsSync(srcPath)) {
      if (spec.required) { console.error(`required source missing: ${srcPath}`); process.exit(1); }
      try { fs.rmSync(path.join(OUT, name)); } catch { /* none */ }
      console.log(`  - ${name}: not present in the ERP (optional) — skipped`);
      continue;
    }
    const raw = fs.readFileSync(srcPath);
    const out = spec.derive ? Buffer.from(spec.derive(raw.toString('utf8')), 'utf8') : raw;
    fs.writeFileSync(path.join(OUT, name), out);
    files[name] = {
      source: spec.src,
      sourceSha256: sha256(raw),
      sha256: sha256(out),
      bytes: out.length,
      derived: !!spec.derive,
      lastChangedCommit: git(erp, ['log', '-1', '--format=%H', '--', spec.src]),
    };
    console.log(`  + ${name}  ${out.length} bytes  sha256 ${files[name].sha256.slice(0, 16)}…`);
  }

  // cut timestamp: from BASELINE.md's table when it can be read, else from the inventory json
  let cut = '';
  try { cut = JSON.parse(fs.readFileSync(path.join(OUT, 'production_baseline.inventory.json'), 'utf8')).generated_at || ''; } catch { /* none */ }

  const next = {
    schema: 1,
    pgMajor: 17,
    cutTimestamp: cut,
    erpCommit: git(erp, ['rev-parse', 'HEAD']),
    erpBranch: git(erp, ['rev-parse', '--abbrev-ref', 'HEAD']),
    files,
  };

  if (args.updatePin) {
    fs.writeFileSync(PIN_FILE, JSON.stringify(next, null, 2) + '\n');
    console.log(`pin updated: ${path.relative(ROOT, PIN_FILE)} (cut ${cut}, ERP ${next.erpCommit.slice(0, 10)})`);
    return;
  }

  // build mode: the copied files must equal what the pin says. erpCommit/erpBranch may legitimately differ (the pin records
  // where the bytes were first taken from); the bytes may not.
  const problems = verifyDir(OUT, pin);
  if (!pin) problems.push('no baseline/BASELINE_PIN.json — run with --update-pin once and commit it');
  if (pin) for (const name of Object.keys(files)) if (!pin.files[name]) problems.push(`${name}: present in the ERP but not pinned (use --update-pin to accept it)`);
  if (pin) for (const name of Object.keys(pin.files)) if (!files[name]) problems.push(`${name}: pinned but not present in the ERP checkout`);
  if (problems.length) {
    console.error('baseline differs from the pin:\n  ' + problems.join('\n  ') + '\nIf the re-cut is intended: node scripts/sync-baseline.js --erp <ERP> --update-pin, then commit baseline/BASELINE_PIN.json.');
    process.exit(1);
  }
  console.log(`baseline matches the pin (cut ${pin.cutTimestamp})`);
}

module.exports = { verifyDir, sha256, deriveStorageStubs, PIN_FILE };
if (require.main === module) main();
