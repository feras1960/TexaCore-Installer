#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// verify-mac-build — checks the macOS DELIVERABLES (the zip, the dmg and latest-mac.yml), not the build folder. The build folder can look
// fine while the files that ship are broken: 2.0.0 builds 10/12/13 carried an INVALID ad-hoc signature (afterPack only warned), and the
// launch checks missed it because they run the inner binary directly. macOS refuses to open an app whose signature is broken.
//
//   node scripts/verify-mac-build.js [--dist dist] [--out <evidence.json>]
//
//   M1  latest-mac.yml: version, the zip and dmg file names, sizes and sha512 match the files on disk
//   M2  the zip is extracted the way the self-updater extracts it (ditto -xk) → the app's signature verifies (codesign --verify --deep --strict)
//   M3  Info.plist: version == package.json, arm64 Mach-O executable, bundle id
//   M4  the dmg is mounted read-only: the same app is inside, its signature verifies, an /Applications link is present; the executable is
//       byte-identical to the one in the zip
//   M7  the signing identity (ad-hoc or a certificate; set TEXACORE_REQUIRE_STABLE_SIGNATURE=1 to fail on ad-hoc), the macOS folder-permission purpose strings in Info.plist + their ar/uk/ru/en localisations
//   M6  the Cloud Access connector (cloudflared) is in the zip's app AND in the dmg's: the pinned file (sha256), still carrying Cloudflare's Developer ID signature, and it RUNS (`--version` = the pinned release).
//       2.0.0 shipped without it: the public link answered Cloudflare error 1033 and the launcher still said «connected»
//   M5  the app code inside the zip is byte-identical to the repo's src/ after obfuscation is accounted for (file list equals; no source maps,
//       no plaintext SQL baseline) — via the same gate afterPack uses (verifyPacked)
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Results } = require('./e2e/lib');
const { verifyPacked } = require('./lib/verify-packed');

const ROOT = path.join(__dirname, '..');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const DIST = path.resolve(ROOT, arg('dist', 'dist'));
const OUT = arg('out', '');
const pkg = require('../package.json');
const VERSION = pkg.version;
const APP_NAME = 'TexaCore ERP.app';
const sha = (f, algo = 'sha256', enc = 'hex') => crypto.createHash(algo).update(fs.readFileSync(f)).digest(enc);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

(async () => {
  const R = new Results();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-mac-'));
  let mountPoint = '';
  const cleanup = () => {
    if (mountPoint) { try { run('hdiutil', ['detach', mountPoint, '-force']); } catch { /* already gone */ } }
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  try {
    const yml = path.join(DIST, 'latest-mac.yml');
    const zip = path.join(DIST, `TexaCore-ERP-${VERSION}-arm64.zip`);
    const dmg = path.join(DIST, `TexaCore-ERP-${VERSION}-arm64.dmg`);

    await R.check('M1. latest-mac.yml names the zip and dmg of this version; sizes and sha512 match the files', async () => {
      for (const f of [yml, zip, dmg]) if (!fs.existsSync(f)) throw new Error(`missing ${path.basename(f)}`);
      const y = require('js-yaml').load(fs.readFileSync(yml, 'utf8'));
      if (y.version !== VERSION) throw new Error(`latest-mac.yml version ${y.version} != ${VERSION}`);
      const out = [];
      for (const f of [zip, dmg]) {
        const e = (y.files || []).find((x) => x.url === path.basename(f));
        if (!e) throw new Error(`latest-mac.yml has no entry for ${path.basename(f)}`);
        if (e.size !== fs.statSync(f).size) throw new Error(`${path.basename(f)}: size ${e.size} != ${fs.statSync(f).size}`);
        if (e.sha512 !== sha(f, 'sha512', 'base64')) throw new Error(`${path.basename(f)}: sha512 differs`);
        out.push(`${path.basename(f)} ${e.size}B`);
      }
      if (y.path !== path.basename(zip) && y.path !== path.basename(dmg)) throw new Error(`top-level path ${y.path} is neither file`);
      return `version ${y.version}; ${out.join('; ')}`;
    });

    // ── zip → extracted exactly the way mac-updater.js does it ──
    const zdir = path.join(tmp, 'zip');
    fs.mkdirSync(zdir);
    const zapp = path.join(zdir, APP_NAME);
    await R.check('M2. the zip extracts (ditto -xk, as the self-updater does) to an app whose signature VERIFIES', async () => {
      run('ditto', ['-xk', zip, zdir]);
      if (!fs.existsSync(zapp)) throw new Error(`${APP_NAME} not in the zip (${fs.readdirSync(zdir).join(', ')})`);
      let r;
      try { r = run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', zapp]); }
      catch (e) { throw new Error(`INVALID SIGNATURE: ${String(e.stderr || e.message).trim().split('\n').slice(0, 3).join(' | ')}`); }
      return 'codesign --verify --deep --strict: valid on disk';
    });

    await R.check('M3. Info.plist version equals package.json; the executable is a single arm64 Mach-O', async () => {
      const plist = path.join(zapp, 'Contents', 'Info.plist');
      const v = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist]).trim();
      const id = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist]).trim();
      const exe = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist]).trim();
      if (v !== VERSION) throw new Error(`Info.plist version ${v} != ${VERSION}`);
      const file = run('file', [path.join(zapp, 'Contents', 'MacOS', exe)]);
      if (!/Mach-O 64-bit executable arm64/.test(file) || /x86_64/.test(file)) throw new Error(`unexpected executable: ${file.trim()}`);
      return `${id} ${v}; ${exe}: arm64`;
    });

    await R.check('M4. the dmg mounts read-only; the same signed app is inside, with an /Applications link', async () => {
      const attach = run('hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-noverify', '-noautoopen', '-mountrandom', tmp, '-plist'], { input: 'Y\n', stdio: ['pipe', 'pipe', 'pipe'] });   // the dmg carries the EULA (software licence agreement): answer the prompt as Finder's "Agree" would
      const m = attach.match(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/);
      if (!m) throw new Error('could not read the mount point');
      mountPoint = m[1];
      const dapp = path.join(mountPoint, APP_NAME);
      if (!fs.existsSync(dapp)) throw new Error(`${APP_NAME} not in the dmg (${fs.readdirSync(mountPoint).join(', ')})`);
      if (!fs.existsSync(path.join(mountPoint, 'Applications'))) throw new Error('no /Applications link in the dmg');
      try { run('codesign', ['--verify', '--deep', '--strict', dapp]); }
      catch (e) { throw new Error(`INVALID SIGNATURE in the dmg: ${String(e.stderr || e.message).trim().split('\n').slice(0, 3).join(' | ')}`); }
      const exe = path.join('Contents', 'MacOS', 'TexaCore ERP');
      if (sha(path.join(dapp, exe)) !== sha(path.join(zapp, exe))) throw new Error('the executable in the dmg differs from the one in the zip');
      const cfRel = path.join('Contents', 'Resources', 'bin', 'cloudflared', 'cloudflared');
      if (!fs.existsSync(path.join(dapp, cfRel)) || sha(path.join(dapp, cfRel)) !== sha(path.join(zapp, cfRel))) throw new Error('cloudflared is missing from the dmg or differs from the zip\'s');
      return 'dmg app signature valid; executable identical to the zip\'s';
    });

    await R.check('M5. the packaged app passes the same gate as the build (encrypted baseline == pin, no plaintext SQL, code obfuscated)', async () => {
      const resourcesDir = path.join(zapp, 'Contents', 'Resources');
      const problems = verifyPacked({ resourcesDir, appCodeDir: path.join(resourcesDir, 'app'), repoRoot: ROOT, platform: 'darwin', scanRoot: zapp, expectObfuscated: true });
      if (problems.length) throw new Error(problems.join('; '));
      return 'verifyPacked: clean';
    });

    await R.check('M6. cloudflared is in the packaged app: the pinned file, Cloudflare\'s Developer ID signature intact, and it RUNS from there', async () => {
      const { verifyCloudflaredFile } = require('./prepare-cloudflared-mac');
      const pinMod = require('./lib/cloudflared-pin');
      const cf = path.join(zapp, 'Contents', 'Resources', 'bin', 'cloudflared', 'cloudflared');
      const bad = verifyCloudflaredFile(cf);
      if (bad.length) throw new Error(bad.join('; '));
      const v = run(cf, ['--version']).trim();
      return `${v}; sha256 ${pinMod.mac.sha256.slice(0, 16)}… = the pin; signed by ${pinMod.mac.authority}`;
    });

    await R.check('M7. the signing identity: which kind it is, whether the permission requirement survives an update, and the privacy purpose strings are in Info.plist (+ ar/uk/ru/en)', async () => {
      const macSign = require('./lib/mac-sign');
      const spawnSync = require('child_process').spawnSync;
      const info = macSign.parseSignatureInfo(spawnSync('codesign', ['-dvv', zapp], { encoding: 'utf8' }).stderr);
      const req = spawnSync('codesign', ['-d', '-r-', zapp], { encoding: 'utf8' });
      const stable = macSign.requirementIsStable(`${req.stdout}\n${req.stderr}`);
      if (process.env.TEXACORE_REQUIRE_STABLE_SIGNATURE === '1' && (!stable || info.adhoc)) throw new Error(`a stable signing identity was required (TEXACORE_REQUIRE_STABLE_SIGNATURE=1) but the app is ${info.adhoc ? 'ad-hoc' : 'signed with a requirement that changes per build'}`);
      const plist = path.join(zapp, 'Contents', 'Info.plist');
      const missing = [];
      for (const k of ['NSDesktopFolderUsageDescription', 'NSDocumentsFolderUsageDescription', 'NSDownloadsFolderUsageDescription', 'NSRemovableVolumesUsageDescription', 'NSNetworkVolumesUsageDescription', 'NSFileProviderDomainUsageDescription']) {
        let val = '';
        try { val = run('/usr/libexec/PlistBuddy', ['-c', `Print :${k}`, plist]).trim(); } catch { val = ''; }
        if (val.length < 20 || !/TexaCore/.test(val)) missing.push(k);
      }
      if (missing.length) throw new Error(`Info.plist lacks a purpose string for: ${missing.join(', ')}`);
      const loc = [];
      for (const l of ['en', 'ar', 'uk', 'ru']) {
        const f = path.join(zapp, 'Contents', 'Resources', `${l}.lproj`, 'InfoPlist.strings');
        if (!fs.existsSync(f)) throw new Error(`${l}.lproj/InfoPlist.strings is not in the app`);
        try { run('plutil', ['-lint', f]); } catch (e) { throw new Error(`${l}.lproj/InfoPlist.strings is not valid: ${String(e.stdout || e.message).trim()}`); }
        loc.push(l);
      }
      return `${info.adhoc ? 'AD-HOC (a code hash: macOS asks for folder access again after every update)' : `identity ${info.authority}`}; requirement ${stable ? 'stable across builds' : 'changes per build'}; 6 purpose strings; localised: ${loc.join(', ')}`;
    });
  } finally {
    cleanup();
  }
  console.log(`\nverify-mac-build: ${R.summary()}`);
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), dist: DIST, version: VERSION, summary: R.summary(), rows: R.rows }, null, 2));
  process.exit(R.failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
