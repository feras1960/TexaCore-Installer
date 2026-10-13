#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// sync-frontend — copy the ERP's built web bundle into ./frontend (what the installer serves), then
//   1. localize the fonts (REQUIRE_LOCAL_FONTS=1 → fail if anything remote is left),
//   2. verify the bundle's injected version equals THIS package.json's version, using the ERP's own checker
//      (<erp>/scripts/verify/check-dist-version.mjs) — a mismatch fails the build.
//
//   (in the ERP checkout)  NODE_OPTIONS=--max-old-space-size=10240 npx vite build --mode selfhosted
//   node scripts/sync-frontend.js --erp <ERP checkout> [--dist <dir, default <erp>/dist>]
//
// ./frontend is build output (git-ignored since 2.0.0).
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { localize } = require('./localize-fonts');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'frontend');

function parseArgs(argv) {
  const a = { erp: process.env.TEXACORE_ERP_DIR || '', dist: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--erp') a.erp = argv[++i];
    else if (argv[i] === '--dist') a.dist = argv[++i];
    else { console.error(`unknown argument ${argv[i]}`); process.exit(2); }
  }
  return a;
}

/** Run the ERP's version checker against `dir`. Returns { ok, output }. */
function checkVersion(erp, dir) {
  const checker = path.join(erp, 'scripts', 'verify', 'check-dist-version.mjs');
  if (!fs.existsSync(checker)) return { ok: false, output: `the ERP version checker is missing: ${checker}` };
  const r = spawnSync('node', [checker, dir, path.join(ROOT, 'package.json')], { encoding: 'utf8' });
  return { ok: r.status === 0, output: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.erp) { console.error('--erp <ERP checkout> (or TEXACORE_ERP_DIR) is required'); process.exit(2); }
  const erp = path.resolve(args.erp);
  const dist = path.resolve(args.dist || path.join(erp, 'dist'));
  if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error(`${dist} is not a built dist (no index.html) — build the ERP first`); process.exit(1); }

  // 1. version of the SOURCE dist, before we touch anything
  const pre = checkVersion(erp, dist);
  if (!pre.ok) { console.error(`frontend version check FAILED:\n  ${pre.output}`); process.exit(1); }

  // 2. copy
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.cpSync(dist, OUT, { recursive: true });
  console.log(`  frontend: ${dist} → ${path.relative(ROOT, OUT)}`);

  // 3. fonts
  try { localize(OUT, { require: process.env.REQUIRE_LOCAL_FONTS === '1' }); } catch (e) { console.error(e.message); process.exit(1); }

  // 4. version again on the result (the font rewrite must not have broken the stamp)
  const post = checkVersion(erp, OUT);
  if (!post.ok) { console.error(`frontend version check FAILED after localisation:\n  ${post.output}`); process.exit(1); }
  console.log(`  ${post.output}`);
}

module.exports = { checkVersion };
if (require.main === module) main();
