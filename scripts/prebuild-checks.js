#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// prebuild-checks — run before every electron-builder build/publish. A build that would ship an install that cannot
// bootstrap is refused HERE, not discovered on a customer's machine (1.9.0's first trial died because the pinned
// baseline was never packaged).
//
//   node scripts/prebuild-checks.js [--platform mac|win|all]    (REQUIRE_LOCAL_FONTS=1 is implied)
//
// Checks: baseline files vs BASELINE_PIN.json · the incremental migrations (./migrations, fetched by sync-migrations) vs baseline/MIGRATIONS_PIN.json · the web bundle exists, carries package.json's version and local fonts ·
// the bundled PostgreSQL is 17.x for each target platform · the pinned cloudflared (mac) is present, signed and runs · no secret-looking env file is about to be packaged.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyDir } = require('./sync-baseline');

const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');

function checkBaseline(problems) {
  const dir = path.join(ROOT, 'baseline');
  let pin = null;
  try { pin = JSON.parse(fs.readFileSync(path.join(dir, 'BASELINE_PIN.json'), 'utf8')); } catch { /* reported below */ }
  for (const p of verifyDir(dir, pin)) problems.push(`baseline: ${p} — run: node scripts/sync-baseline.js --erp <ERP checkout>`);
}

function checkMigrations(problems) {
  // 2.0.2+: the incremental set production received after the baseline cut. The PIN (baseline/MIGRATIONS_PIN.json: names, order, sha256 - no SQL) is committed; the SQL itself is
  // fetched from the private ERP repo at build time into ./migrations (git-ignored) by scripts/sync-migrations.js and packed into the encrypted container by pack-baseline.
  // Tied to the pinned baseline: a re-cut that is not followed by a regenerated pin fails here.
  const MM = require('./lib/migrations-manifest');
  const bdir = path.join(ROOT, 'baseline');
  const fix = 'run: node scripts/sync-migrations.js --erp <ERP checkout>';
  let pin = null;
  try { pin = MM.loadMigrationsPin(bdir); } catch (e) { problems.push(`migrations: baseline/${MM.PIN_FILE} is unreadable (${e.message})`); return; }
  if (!pin) { problems.push(`migrations: baseline/${MM.PIN_FILE} is missing - a build must say which incremental migrations it ships (an empty list is fine after a baseline re-cut)`); return; }
  const basePin = JSON.parse(fs.readFileSync(path.join(bdir, 'BASELINE_PIN.json'), 'utf8')).files['production_baseline.sql'].sha256;
  const pp = MM.checkPin(pin, basePin);
  for (const p of pp) problems.push(`migrations: ${p}`);
  if (pp.length) return;
  const dir = path.join(ROOT, 'migrations');
  if (!pin.migrations.length) { if (fs.existsSync(dir) && fs.readdirSync(dir).length) problems.push('migrations: ./migrations holds files but the pin lists none - remove ./migrations'); return; }
  const inv = MM.checkInventory(bdir, pin);
  for (const p of inv.problems) problems.push(`migrations: ${p}`);
  if (!fs.existsSync(dir)) { problems.push(`migrations: ./migrations is missing (build output) - ${fix}`); return; }
  const r = MM.checkManifest(dir, basePin);
  for (const p of r.problems) problems.push(`migrations: ${p} - ${fix}`);
  if (r.manifest) {
    for (const p of MM.checkAgainstPin(r.manifest, pin)) problems.push(`migrations: ${p} - ${fix}`);
    if (inv.inventory && JSON.stringify(r.manifest.inventoryAfter) !== JSON.stringify(inv.inventory)) problems.push(`migrations: migrations.json inventoryAfter differs from baseline/${MM.INVENTORY_FILE} - ${fix}`);
  }
}

function checkFrontend(problems) {
  const dir = path.join(ROOT, 'frontend');
  const index = path.join(dir, 'index.html');
  if (!fs.existsSync(index)) { problems.push('frontend/ is missing — build the ERP and run: node scripts/sync-frontend.js --erp <ERP checkout>'); return; }
  const html = fs.readFileSync(index, 'utf8');
  const m = /<meta[^>]*name=["']texacore-app-version["'][^>]*content=["']([^"']+)["']/i.exec(html) || /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']texacore-app-version["']/i.exec(html);
  if (!m) problems.push('frontend: index.html carries no texacore-app-version stamp (built from an ERP without the 2.0.0 checker support)');
  else if (m[1].replace(/^v/i, '') !== pkg.version) problems.push(`frontend: bundle is ${m[1]} but package.json is ${pkg.version}`);
  if (!fs.existsSync(path.join(dir, 'fonts', 'fonts.css'))) problems.push('frontend: local fonts are missing (frontend/fonts/fonts.css) — run sync-frontend with REQUIRE_LOCAL_FONTS=1');
  if (/fonts\.(?:googleapis|gstatic)\.com/.test(html)) problems.push('frontend: index.html still references Google Fonts');
}

function checkPg(platform, problems) {
  if (platform === 'mac') {
    const bin = path.join(ROOT, 'bin', 'macos-arm64', 'pg', 'bin', 'postgres');
    if (!fs.existsSync(bin)) { problems.push('mac: bin/macos-arm64/pg is missing — run scripts/prepare-pg-mac.sh'); return; }
    const r = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    if (!/PostgreSQL\) 17\./.test(r.stdout || '')) problems.push(`mac: bundled PostgreSQL is "${(r.stdout || r.stderr || '').trim()}", expected 17.x`);
    // the Cloud Access connector (2.0.0 shipped without it): the pinned, Cloudflare-signed binary must be in the repo and must run
    const { verifyCloudflaredFile } = require('./prepare-cloudflared-mac');
    const cfPin = require('./lib/cloudflared-pin');
    for (const p of verifyCloudflaredFile(cfPin.mac.repoPath)) problems.push(`mac: bin/macos-arm64/cloudflared/cloudflared — ${p} — run: node scripts/prepare-cloudflared-mac.js <the official ${cfPin.version} darwin-arm64 binary>`);
  } else {
    const marker = path.join(ROOT, 'bin', 'windows-x64', 'pg', 'PG_BUNDLE_VERSION');
    if (!fs.existsSync(marker)) { problems.push('win: bin/windows-x64/pg has no PG_BUNDLE_VERSION — run scripts/prepare-pg-win.js with the EDB 17.6 zip'); return; }
    const v = fs.readFileSync(marker, 'utf8').trim();
    if (!/^17\./.test(v)) problems.push(`win: bundled PostgreSQL is ${v}, expected 17.x`);
    const redist = path.join(ROOT, 'build', 'vcredist', 'vc_redist.x64.exe');
    if (!fs.existsSync(redist)) {
      console.warn('  WARNING (win): build/vcredist/vc_redist.x64.exe is not present — the installer will NOT bring the Visual C++ runtime that PostgreSQL needs;\n'
        + '                 a PC without the VC++ 2015-2022 x64 Redistributable cannot start the database. (node scripts/prepare-vcredist.js <vc_redist.x64.exe>)');
    } else {
      const { verifyRedist } = require('./prepare-vcredist');
      const bad = verifyRedist(fs.readFileSync(redist));
      if (bad.length) problems.push(`win: build/vcredist/vc_redist.x64.exe is not the pinned Microsoft file — ${bad.join('; ')}`);
      if (!fs.existsSync(path.join(ROOT, 'build', 'vcredist', 'vcredist-version.nsh'))) problems.push('win: build/vcredist/vcredist-version.nsh is missing — run scripts/prepare-vcredist.js again');
    }
  }
}

function checkEula(problems) {
  try { require('./make-eula').build(); } catch (e) { problems.push(`EULA: ${e.message}`); }
}

function checkNoSecrets(problems) {
  for (const f of ['.env', '.env.local', '.env.selfhosted', '.env.production']) {
    if (fs.existsSync(path.join(ROOT, f))) problems.push(`${f} exists in the installer folder — remove it (it would be packaged by "src/**" rules in some setups)`);
  }
}

function run(platforms) {
  const problems = [];
  checkBaseline(problems);
  checkMigrations(problems);
  checkFrontend(problems);
  for (const p of platforms) checkPg(p, problems);
  checkNoSecrets(problems);
  checkEula(problems);
  return problems;
}

module.exports = { run };
if (require.main === module) {
  const i = process.argv.indexOf('--platform');
  const plat = i >= 0 ? process.argv[i + 1] : 'all';
  const platforms = plat === 'mac' ? ['mac'] : plat === 'win' ? ['win'] : ['mac', 'win'];
  const problems = run(platforms);
  if (problems.length) {
    console.error(`prebuild checks FAILED (${problems.length}):\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(`prebuild checks OK (${platforms.join('+')}, v${pkg.version})`);
}
