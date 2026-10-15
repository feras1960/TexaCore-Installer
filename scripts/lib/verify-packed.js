'use strict';
// ════════════════════════════════════════════════════════════════
// verify-packed — the afterPack gate. Given the packaged Resources dir of a freshly packed app, prove that everything a
// FIRST RUN needs is in it and is exactly what the build pinned:
//   * <resources>/baseline carries the ENCRYPTED container (baseline.bin) + PACKED.json + the pin; the blob's sha256 matches, and the key module
//     AS PACKAGED opens it and every file listed in BASELINE_PIN.json inside has the pinned size + sha256
//     (1.9.0's first trial died because the pin was not packaged; a build that cannot bootstrap must not be produced)
//   * the pin that was packaged is byte-identical to the repo's pin
//   * NO plaintext database DDL anywhere in the package (outside PostgreSQL's own share files) - NO exception list: no production_baseline.*, no src/bootstrap/*.sql,
//     no *.sql file at all, no table / function / trigger / policy DDL of the production schema in any file
//   * the web bundle is there and carries package.json's version; local fonts are there
//   * the bundled PostgreSQL / GoTrue / PostgREST binaries are there
//   * the incremental migrations (2.0.2+) ship ONLY inside the encrypted container baseline/migrations.bin (same TXB1 format, same key): no <resources>/migrations folder (a 1.x manifest
//     must never ride along), and the container opened with the packaged key module is exactly baseline/MIGRATIONS_PIN.json: baselineSha256 = the baseline pin, the pinned names / order /
//     sha256 / sizes, the manifest, the measured inventory delta, nothing else
// Pure functions of the filesystem → unit-testable with a fake tree.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MM = require('./migrations-manifest');

const sha256File = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/**
 * The packaged migrations container opened with the key module AS PACKAGED (obfuscated or not).
 * @returns {{ problems: string[], manifest: object|null, files: Map<string, Buffer>, meta: object|null }}
 */
function readPackedMigrations({ resourcesDir, appCodeDir }) {
  const out = { problems: [], manifest: null, files: new Map(), meta: null };
  const bdir = path.join(resourcesDir, 'baseline');
  const blobF = path.join(bdir, 'migrations.bin');
  const metaF = path.join(bdir, 'MIGRATIONS_PACKED.json');
  for (const f of [blobF, metaF]) if (!fs.existsSync(f)) out.problems.push(`baseline/${path.basename(f)} was NOT packaged (written by scripts/pack-baseline.js)`);
  if (out.problems.length) return out;
  const keyFile = path.join(appCodeDir, 'src', 'baseline-key.generated.js');
  if (!fs.existsSync(keyFile)) { out.problems.push('src/baseline-key.generated.js is missing from the app code (the migrations container could not be opened)'); return out; }
  try {
    out.meta = JSON.parse(fs.readFileSync(metaF, 'utf8'));
    const blob = fs.readFileSync(blobF);
    if (blob.length !== out.meta.blobBytes || crypto.createHash('sha256').update(blob).digest('hex') !== out.meta.blobSha256) { out.problems.push('baseline/migrations.bin: size/sha256 differ from MIGRATIONS_PACKED.json'); return out; }
    const { unpack } = require('../../src/baseline-pack');
    delete require.cache[require.resolve(keyFile)];
    out.files = unpack(blob, require(keyFile)());
    const mj = out.files.get('migrations.json');
    if (!mj) out.problems.push('the migrations container carries no migrations.json');
    else out.manifest = JSON.parse(mj.toString('utf8'));
  } catch (e) { out.problems.push(`the packaged key module cannot open the migrations container: ${e.message}`); }
  return out;
}

/**
 * @param {object} o
 * @param {string} o.resourcesDir  <app>/Contents/Resources (mac) or <out>/resources (win)
 * @param {string} o.appCodeDir    where src/ landed (<resourcesDir>/app with asar:false)
 * @param {string} o.repoRoot      the installer repo (to compare the pin and read package.json)
 * @param {'darwin'|'win32'} o.platform
 * @param {boolean} [o.expectObfuscated] the main-process code in the package must be obfuscated and come from exactly the repo's sources
 * @param {string} [o.scanRoot]    the whole packaged app (default: resourcesDir) — scanned for plaintext database DDL
 * @param {{sha256:string, bytes:number}} [o.cloudflaredPin] the pinned macOS cloudflared (override for tests)
 * @returns {string[]} problems (empty = OK)
 */
function verifyPacked({ resourcesDir, appCodeDir, repoRoot, platform, scanRoot, expectObfuscated = false, cloudflaredPin = require('./cloudflared-pin').mac }) {
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
  if (fs.existsSync(bdir) && fs.readdirSync(bdir).some((f) => /\.(sql|json)$/.test(f) && !['BASELINE_PIN.json', 'PACKED.json', 'MIGRATIONS_PACKED.json'].includes(f))) problems.push('plain baseline files are in the package (baseline/)');
  // the incremental migrations (2.0.2+): ONLY inside the encrypted container, exactly the pin. There is no plaintext exception of any kind.
  if (fs.existsSync(path.join(resourcesDir, 'migrations'))) problems.push('a plaintext migrations folder is in the package (resources/migrations) - migrations ship only inside the encrypted container (baseline/migrations.bin); a 1.x migrations manifest must never ride along');
  let mpin = null;
  try { mpin = MM.loadMigrationsPin(path.join(repoRoot, 'baseline')); } catch (e) { problems.push(`repo baseline/${MM.PIN_FILE} is unreadable: ${e.message}`); }
  const hasMigBlob = fs.existsSync(path.join(bdir, 'migrations.bin')) || fs.existsSync(path.join(bdir, 'MIGRATIONS_PACKED.json'));
  if (mpin && mpin.migrations && mpin.migrations.length) {
    let baseSha = null;
    try { baseSha = JSON.parse(fs.readFileSync(fs.existsSync(packedPinPath) ? packedPinPath : repoPinPath, 'utf8')).files['production_baseline.sql'].sha256; } catch { /* reported above */ }
    for (const m of MM.checkPin(mpin, baseSha)) problems.push(`migrations pin: ${m}`);
    const pm = readPackedMigrations({ resourcesDir, appCodeDir });
    for (const m of pm.problems) problems.push(`migrations: ${m}`);
    if (!pm.problems.length) {
      const wantNames = new Set(['migrations.json', ...mpin.migrations.map((m) => m.file)]);
      for (const n of pm.files.keys()) if (!wantNames.has(n)) problems.push(`migrations: the container carries ${n}, which the pin does not list`);
      for (const m of mpin.migrations) {
        const d = pm.files.get(m.file);
        if (!d) problems.push(`migrations: the container lacks ${m.file}`);
        else if (d.length !== m.bytes || crypto.createHash('sha256').update(d).digest('hex') !== m.sha256) problems.push(`migrations: ${m.file} in the container differs from the pin`);
      }
      for (const m of MM.checkAgainstPin(pm.manifest, mpin)) problems.push(`migrations: ${m}`);
      if (baseSha && pm.manifest && pm.manifest.baselineSha256 !== baseSha) problems.push('migrations: the container\'s manifest is not for the packaged baseline');
      // the measured inventory delta inside the manifest is the private input the pin names
      const inv = MM.checkInventory(path.join(repoRoot, 'baseline'), mpin);
      if (inv.inventory && JSON.stringify(pm.manifest && pm.manifest.inventoryAfter) !== JSON.stringify(inv.inventory)) problems.push('migrations: the container\'s inventoryAfter is not baseline/migrations.inventory.json');
    }
  } else if (hasMigBlob) problems.push('migrations: a migrations container is packaged but baseline/MIGRATIONS_PIN.json lists no migrations');
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

  // ── the Cloud Access connector: 2.0.0 (mac) shipped without cloudflared, so the public link answered Cloudflare error 1033. Windows has bin/cloudflared/cloudflared.exe
  //    in the repo; the mac one is pinned (scripts/lib/cloudflared-pin.js). A mac package without exactly that file, or with it not executable, is refused. ──
  if (platform === 'darwin') {
    const cf = path.join(bin, 'cloudflared', 'cloudflared');
    if (!fs.existsSync(cf)) problems.push('bin/cloudflared/cloudflared is missing — Cloud Access would be dead (Cloudflare error 1033); run scripts/prepare-cloudflared-mac.js');
    else {
      const st = fs.statSync(cf);
      if (st.size !== cloudflaredPin.bytes || sha256File(cf) !== cloudflaredPin.sha256) problems.push('the packaged bin/cloudflared/cloudflared is not the pinned build (scripts/lib/cloudflared-pin.js)');
      if ((st.mode & 0o111) === 0) problems.push('the packaged bin/cloudflared/cloudflared is not executable');
    }
  } else if (!fs.existsSync(path.join(bin, 'cloudflared', 'cloudflared.exe'))) {
    problems.push('bin/cloudflared/cloudflared.exe is missing — Cloud Access would be dead');
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
      if (/\.sql$/i.test(e.name)) { problems.push(`a plain .sql file in the package: ${path.relative(root, f)}`); continue; }
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

module.exports = { verifyPacked, readPackedMigrations, sha256File, scanForPlaintextSql };
