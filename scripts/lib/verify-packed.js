'use strict';
// ════════════════════════════════════════════════════════════════
// verify-packed — the afterPack gate. Given the packaged Resources dir of a freshly packed app, prove that everything a
// FIRST RUN needs is in it and is exactly what the build pinned:
//   * <resources>/baseline carries the ENCRYPTED container (baseline.bin) + PACKED.json + the pin; the blob's sha256 matches, and the key module
//     AS PACKAGED opens it and every file listed in BASELINE_PIN.json inside has the pinned size + sha256
//     (1.9.0's first trial died because the pin was not packaged; a build that cannot bootstrap must not be produced)
//   * the pin that was packaged is byte-identical to the repo's pin
//   * NO plaintext database DDL anywhere in the package (outside PostgreSQL's own share files): no production_baseline.*, no src/bootstrap/*.sql,
//     no "CREATE TABLE public." / "CREATE FUNCTION public." … in any file
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
 * @param {boolean} [o.expectObfuscated] the main-process code in the package must be obfuscated and come from exactly the repo's sources
 * @param {string} [o.scanRoot]    the whole packaged app (default: resourcesDir) — scanned for plaintext database DDL
 * @returns {string[]} problems (empty = OK)
 */
function verifyPacked({ resourcesDir, appCodeDir, repoRoot, platform, scanRoot, expectObfuscated = false }) {
  const problems = [];
  const exe = (n) => (platform === 'win32' ? `${n}.exe` : n);

  // ── the baseline container (encrypted) vs the pin ──
  const bdir = path.join(resourcesDir, 'baseline');
  const repoPinPath = path.join(repoRoot, 'baseline', 'BASELINE_PIN.json');
  const packedPinPath = path.join(bdir, 'BASELINE_PIN.json');
  if (!fs.existsSync(repoPinPath)) problems.push('repo baseline/BASELINE_PIN.json is missing');
  for (const f of ['baseline.bin', 'PACKED.json', 'BASELINE_PIN.json']) {
    if (!fs.existsSync(path.join(bdir, f))) problems.push(`baseline/${f} was NOT packaged (extraResources "baseline" ← build/baseline-pack, written by scripts/pack-baseline.js)`);
  }
  if (fs.existsSync(path.join(bdir, 'baseline.bin')) && fs.existsSync(path.join(bdir, 'PACKED.json')) && fs.existsSync(packedPinPath)) {
    if (fs.existsSync(repoPinPath) && sha256File(repoPinPath) !== sha256File(packedPinPath)) problems.push('packaged BASELINE_PIN.json differs from the repo pin');
    let pin = null; let meta = null;
    try { pin = JSON.parse(fs.readFileSync(packedPinPath, 'utf8')); meta = JSON.parse(fs.readFileSync(path.join(bdir, 'PACKED.json'), 'utf8')); } catch (e) { problems.push(`packaged pin/PACKED.json unreadable: ${e.message}`); }
    const blob = fs.readFileSync(path.join(bdir, 'baseline.bin'));
    if (meta && (blob.length !== meta.blobBytes || crypto.createHash('sha256').update(blob).digest('hex') !== meta.blobSha256)) problems.push('baseline/baseline.bin: size/sha256 differ from PACKED.json');
    // decrypt it with the key module AS PACKAGED (obfuscated or not): proves the shipped code opens the shipped container, and that every
    // pinned file inside is exactly what the pin says
    const keyFile = path.join(appCodeDir, 'src', 'baseline-key.generated.js');
    if (!fs.existsSync(keyFile)) problems.push('src/baseline-key.generated.js is missing from the app code (the container could not be opened at first run)');
    else if (pin && pin.files) {
      try {
        const { unpack } = require('../../src/baseline-pack');
        delete require.cache[require.resolve(keyFile)];
        const entries = unpack(blob, require(keyFile)());
        for (const [name, m] of Object.entries(pin.files)) {
          const d = entries.get(name);
          if (!d) problems.push(`baseline container lacks ${name}`);
          else if (d.length !== m.bytes || crypto.createHash('sha256').update(d).digest('hex') !== m.sha256) problems.push(`baseline container: ${name} differs from the pin`);
        }
        if (!pin.files['production_baseline.sql']) problems.push('pin does not list production_baseline.sql');
        for (const f of ['local_extras.sql', 'reference_seed.sql', 'storage_stubs.sql', 'production_baseline.inventory.json']) if (!entries.has(f)) problems.push(`baseline container lacks ${f}`);
      } catch (e) { problems.push(`the packaged key module cannot open the baseline container: ${e.message}`); }
    }
  }
  // no plaintext SQL anywhere: neither the baseline files nor the installer-owned SQL, nor any DDL text in code or data files
  const bootDir = path.join(appCodeDir, 'src', 'bootstrap');
  if (fs.existsSync(bootDir) && fs.readdirSync(bootDir).some((f) => f.endsWith('.sql'))) problems.push('plain SQL files are in the app code (src/bootstrap/*.sql) — they belong in the encrypted container');
  if (fs.existsSync(bdir) && fs.readdirSync(bdir).some((f) => /\.(sql|json)$/.test(f) && !['BASELINE_PIN.json', 'PACKED.json'].includes(f))) problems.push('plain baseline files are in the package (baseline/)');
  problems.push(...scanForPlaintextSql(scanRoot || resourcesDir, resourcesDir));

  // ── the main-process code is hardened, and made from exactly these sources ──
  if (expectObfuscated) {
    const mf = path.join(appCodeDir, 'src-manifest.json');
    if (!fs.existsSync(mf)) problems.push('src-manifest.json is missing — the packaged code was not obfuscated');
    else {
      let man = null;
      try { man = JSON.parse(fs.readFileSync(mf, 'utf8')); } catch (e) { problems.push(`src-manifest.json unreadable: ${e.message}`); }
      if (man) {
        if (man.obfuscated !== true) problems.push('src-manifest.json says the code is not obfuscated');
        for (const [rel, hash] of Object.entries(man.files || {})) {
          const repoFile = path.join(repoRoot, 'src', rel);
          if (!fs.existsSync(repoFile)) { problems.push(`manifest lists src/${rel} which is not in the repo`); continue; }
          if (sha256File(repoFile) !== hash) problems.push(`the packaged src/${rel} was built from different source than the repo's`);
        }
        // (exported property names and regular-expression literals legitimately stay; these identifiers and strings must be gone)
        const READABLE = ['function handleCreateLocalCompany', 'adminRequestIsLocal', 'class ServiceManager', 'fn_membership_invite_create', 'SELECT public.check_plan_limits', 'INSERT INTO public.subscription_plans'];
        for (const f of ['main.js', 'service-manager.js', 'provisioning.js', 'plan-sync.js', 'secrets.js', 'preload.js', 'baseline-key.generated.js']) {
          const p = path.join(appCodeDir, 'src', f);
          if (!fs.existsSync(p)) continue;
          const t = fs.readFileSync(p, 'utf8');
          const leak = READABLE.find((x) => t.includes(x));
          if (leak) problems.push(`src/${f} is still readable ("${leak}")`);
          if (t.split('\n').length > 60 && /^\s{2,}\S/m.test(t)) problems.push(`src/${f} still looks like formatted source`);
        }
      }
    }
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


// ─── plaintext-DDL scan ─────────────────────────────────────────────────────
// PostgreSQL's own share/*.sql (information_schema, extension scripts) legitimately contain DDL, so bin/pg is skipped; everything else — app code,
// data files, the web bundle, the other binaries — must carry none of the production schema's text.
const DDL_LITERALS = ['CREATE OR REPLACE FUNCTION public.', 'CREATE FUNCTION public.', 'CREATE TABLE public.', 'CREATE TRIGGER trg_', 'ALTER TABLE ONLY public.', 'CREATE POLICY ']
  .map((x) => Buffer.from(x));
function scanForPlaintextSql(root, resourcesDir) {
  const problems = [];
  const pgDir = path.join(resourcesDir, 'bin', 'pg') + path.sep;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if ((f + path.sep).startsWith(pgDir)) continue; walk(f); continue; }
      if (/^production_baseline\./.test(e.name)) { problems.push(`plain baseline file in the package: ${path.relative(root, f)}`); continue; }
      const st = fs.statSync(f);
      if (st.size === 0 || st.size > 400e6) continue;
      const buf = fs.readFileSync(f);
      const hit = DDL_LITERALS.find((l) => buf.indexOf(l) >= 0);
      if (hit) problems.push(`plaintext database DDL ("${hit.toString()}…") in ${path.relative(root, f)}`);
    }
  };
  walk(root);
  return problems;
}

module.exports = { verifyPacked, sha256File, scanForPlaintextSql };
