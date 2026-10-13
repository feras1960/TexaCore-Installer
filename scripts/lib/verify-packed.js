'use strict';
// ════════════════════════════════════════════════════════════════
// verify-packed — the afterPack gate. Given the packaged Resources dir of a freshly packed app, prove that everything a
// FIRST RUN needs is in it and is exactly what the build pinned:
//   * every file listed in baseline/BASELINE_PIN.json exists in <resources>/baseline with the pinned size + sha256
//     (1.9.0's first trial died because the pin was not packaged; a build that cannot bootstrap must not be produced)
//   * the pin that was packaged is byte-identical to the repo's pin
//   * the installer-owned bootstrap SQL is in the app code
//   * the web bundle is there and carries package.json's version; local fonts are there
//   * the bundled PostgreSQL / GoTrue / PostgREST binaries are there
//   * no 1.x migrations manifest rides along
// Pure functions of the filesystem → unit-testable with a fake tree.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/**
 * @param {object} o
 * @param {string} o.resourcesDir  <app>/Contents/Resources (mac) or <out>/resources (win)
 * @param {string} o.appCodeDir    where src/ landed (<resourcesDir>/app with asar:false)
 * @param {string} o.repoRoot      the installer repo (to compare the pin and read package.json)
 * @param {'darwin'|'win32'} o.platform
 * @returns {string[]} problems (empty = OK)
 */
function verifyPacked({ resourcesDir, appCodeDir, repoRoot, platform }) {
  const problems = [];
  const exe = (n) => (platform === 'win32' ? `${n}.exe` : n);

  // ── baseline vs pin ──
  const repoPinPath = path.join(repoRoot, 'baseline', 'BASELINE_PIN.json');
  const packedPinPath = path.join(resourcesDir, 'baseline', 'BASELINE_PIN.json');
  if (!fs.existsSync(repoPinPath)) problems.push('repo baseline/BASELINE_PIN.json is missing');
  if (!fs.existsSync(packedPinPath)) {
    problems.push('baseline/BASELINE_PIN.json was NOT packaged (extraResources "baseline")');
  } else {
    if (fs.existsSync(repoPinPath) && sha256File(repoPinPath) !== sha256File(packedPinPath)) problems.push('packaged BASELINE_PIN.json differs from the repo pin');
    let pin = null;
    try { pin = JSON.parse(fs.readFileSync(packedPinPath, 'utf8')); } catch (e) { problems.push(`packaged pin unreadable: ${e.message}`); }
    if (pin && pin.files) {
      for (const [name, meta] of Object.entries(pin.files)) {
        const f = path.join(resourcesDir, 'baseline', name);
        if (!fs.existsSync(f)) { problems.push(`baseline/${name} was NOT packaged`); continue; }
        const st = fs.statSync(f);
        if (st.size !== meta.bytes) problems.push(`baseline/${name}: ${st.size} bytes packaged, pin says ${meta.bytes}`);
        else if (sha256File(f) !== meta.sha256) problems.push(`baseline/${name}: sha256 differs from the pin`);
      }
      if (!pin.files['production_baseline.sql']) problems.push('pin does not list production_baseline.sql');
    } else if (pin) problems.push('packaged pin has no "files"');
  }

  // ── installer-owned bootstrap SQL (inside the app code) ──
  for (const f of ['local_extras.sql', 'reference_seed.sql']) {
    if (!fs.existsSync(path.join(appCodeDir, 'src', 'bootstrap', f))) problems.push(`src/bootstrap/${f} is missing from the app code`);
  }

  // ── web bundle ──
  const fe = path.join(resourcesDir, 'frontend');
  const index = path.join(fe, 'index.html');
  if (!fs.existsSync(index)) problems.push('frontend/index.html was NOT packaged');
  else {
    const html = fs.readFileSync(index, 'utf8');
    const want = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
    const m = /<meta[^>]*name=["']texacore-app-version["'][^>]*content=["']([^"']+)["']/i.exec(html) || /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']texacore-app-version["']/i.exec(html);
    if (!m) problems.push('packaged index.html has no texacore-app-version stamp');
    else if (m[1].replace(/^v/i, '') !== want) problems.push(`packaged web bundle is ${m[1]}, package.json is ${want}`);
    if (!fs.existsSync(path.join(fe, 'fonts', 'fonts.css'))) problems.push('local fonts (frontend/fonts/fonts.css) were NOT packaged');
    if (/fonts\.(?:googleapis|gstatic)\.com/.test(html)) problems.push('packaged index.html still loads Google Fonts');
  }

  // ── binaries ──
  const bin = path.join(resourcesDir, 'bin');
  for (const rel of [
    path.join('pg', 'bin', exe('postgres')), path.join('pg', 'bin', exe('initdb')), path.join('pg', 'bin', exe('psql')), path.join('pg', 'bin', exe('pg_ctl')),
    path.join('gotrue', exe('auth')), path.join('postgrest', exe('postgrest')),
  ]) {
    if (!fs.existsSync(path.join(bin, rel))) problems.push(`bin/${rel} is missing`);
  }
  if (!fs.existsSync(path.join(bin, 'pg', 'share')) && !fs.existsSync(path.join(bin, 'pg', 'share', 'postgresql'))) problems.push('bin/pg/share is missing');

  // ── nothing from 1.x that would replay old migrations ──
  const mig = path.join(resourcesDir, 'migrations', 'migrations.json');
  if (fs.existsSync(mig)) {
    try { if (!JSON.parse(fs.readFileSync(mig, 'utf8')).baselineSha256) problems.push('a 1.x migrations/migrations.json was packaged (no baselineSha256) — it must not ship'); } catch { problems.push('migrations/migrations.json is unreadable'); }
  }
  return problems;
}

module.exports = { verifyPacked, sha256File };
