/**
 * electron-builder afterPack hook
 * Ensures all transitive dependencies are present in the built app.
 * Fixes: "Cannot find module 'call-bind-apply-helpers'" on Windows/Mac
 */
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  const srcModules = path.join(__dirname, '..', 'node_modules');

  // ── 2.0.0 hardening: the main-process / preload / service code in the package is obfuscated BEFORE the gate (so the gate checks what ships)
  // and before signing. The sources in git stay readable. TEXACORE_NO_OBFUSCATE=1 is for debugging a build only. ──
  {
    const isMac = context.electronPlatformName === 'darwin';
    const appName = context.packager.appInfo.productFilename + '.app';
    const resourcesDir = isMac
      ? path.join(context.appOutDir, appName, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources');
    if (process.env.TEXACORE_NO_OBFUSCATE === '1') {
      console.warn('  • afterPack: ⚠️  TEXACORE_NO_OBFUSCATE=1 — this build keeps READABLE code (debug builds only, never release)');
    } else {
      const { obfuscateAppCode } = require('./lib/obfuscate-app');
      obfuscateAppCode(path.join(resourcesDir, 'app'), { log: (m) => console.log(`  • afterPack: ${m}`) });
    }
  }

  // ── 2.0.0 gate: refuse to produce an app that cannot bootstrap its database ──
  // (1.9.0's first trial died because the pinned baseline was not packaged.) Runs first (after obfuscation); a throw fails the build.
  {
    const { verifyPacked } = require('./lib/verify-packed');
    const isMac = context.electronPlatformName === 'darwin';
    const appName = context.packager.appInfo.productFilename + '.app';
    const resourcesDir = isMac
      ? path.join(context.appOutDir, appName, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources');
    const problems = verifyPacked({
      resourcesDir,
      appCodeDir: path.join(resourcesDir, 'app'),
      repoRoot: path.join(__dirname, '..'),
      platform: context.electronPlatformName === 'darwin' ? 'darwin' : 'win32',
      scanRoot: isMac ? path.join(context.appOutDir, appName) : context.appOutDir,
      expectObfuscated: process.env.TEXACORE_NO_OBFUSCATE !== '1',
    });
    if (problems.length) {
      throw new Error(`afterPack: the packaged app is incomplete —\n  - ${problems.join('\n  - ')}`);
    }
    console.log('  • afterPack: encrypted baseline container verified against BASELINE_PIN.json, no plaintext SQL in the package ✅');
  }

  // Determine the correct node_modules path based on platform
  let appDir;
  if (context.electronPlatformName === 'darwin') {
    // macOS: dist/mac-arm64/TexaCore ERP.app/Contents/Resources/app/node_modules
    const appName = context.packager.appInfo.productFilename + '.app';
    appDir = path.join(context.appOutDir, appName, 'Contents', 'Resources', 'app', 'node_modules');
  } else {
    // Windows/Linux: dist/win-unpacked/resources/app/node_modules
    appDir = path.join(context.appOutDir, 'resources', 'app', 'node_modules');
  }

  console.log(`  • afterPack: target node_modules path: ${appDir}`);

  // Modules that electron-builder's npm install sometimes misses
  const requiredModules = [
    'call-bind-apply-helpers',
    'call-bound',
    'es-errors',
    'gopd',
    'es-define-property',
    'math-intrinsics',
    'hasown',
    'function-bind',
    'side-channel-list',
    'side-channel-weakmap',
  ];

  for (const mod of requiredModules) {
    const dest = path.join(appDir, mod);
    const src = path.join(srcModules, mod);
    if (!fs.existsSync(dest) && fs.existsSync(src)) {
      console.log(`  • afterPack: copying missing module ${mod}`);
      fs.cpSync(src, dest, { recursive: true });
    }
  }

  // macOS: ad-hoc sign the whole bundle so the *downloaded* app opens with
  // "unidentified developer" (right-click → Open) instead of "damaged" on Apple
  // Silicon (no Apple Developer cert). Runs here — before the dmg is built — so
  // the dmg ships the signed app. No-op on Windows/Linux.
  if (context.electronPlatformName === 'darwin') {
    const appPath = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
    const { execFileSync } = require('child_process');
    console.log(`  • afterPack: ad-hoc signing ${appPath}`);
    // macOS tags files it sees arriving with com.apple.provenance; codesign refuses a bundle with such "detritus" (xattr) — strip first
    try { execFileSync('/usr/bin/xattr', ['-cr', appPath], { stdio: 'ignore' }); } catch { /* nothing to strip */ }
    const sign = (bundle) => {
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'inherit' });
      execFileSync('codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'inherit' });
    };
    // A build whose signature is not valid must NOT be produced: on Apple Silicon the app would not open at all ("is damaged").
    try {
      sign(appPath);
    } catch (first) {
      // A project folder that lives in an iCloud-synced location (Desktop / Documents) gets com.apple.FinderInfo + com.apple.fileprovider.fpfs#P
      // re-attached to its directories by the file-provider daemon, which xattr cannot keep off: codesign then refuses ("detritus not allowed").
      // Sign a clean copy in the system temp folder instead, check it there, and put it back without extended attributes.
      console.warn(`  • afterPack: signing in place failed (${first.message.split('\n')[0]}) — signing a clean copy in the temp folder instead`);
      const os = require('os');
      const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'texacore-sign-'));
      try {
        const copy = path.join(stage, path.basename(appPath));
        execFileSync('/usr/bin/ditto', ['--noextattr', '--norsrc', appPath, copy], { stdio: 'inherit' });
        try { execFileSync('/usr/bin/xattr', ['-cr', copy], { stdio: 'ignore' }); } catch { /* nothing to strip */ }
        sign(copy);
        fs.rmSync(appPath, { recursive: true, force: true });
        execFileSync('/usr/bin/ditto', ['--noextattr', '--norsrc', copy, appPath], { stdio: 'inherit' });
        execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });   // the bundle that ships must verify where it is
      } catch (e) {
        throw new Error(`afterPack: ad-hoc signing failed — refusing to produce an app with an invalid signature: ${e.message}`);
      } finally {
        fs.rmSync(stage, { recursive: true, force: true });
      }
    }
    console.log('  • afterPack: ad-hoc signature valid ✅');

    // The Cloud Access connector must be IN the signed app, be the pinned file, and RUN from there (2.0.0 shipped without it: Cloudflare error 1033).
    // Signing must not have altered it (it keeps Cloudflare's own Developer ID signature; Resources/bin files are sealed, not re-signed).
    {
      const pinMod = require('./lib/cloudflared-pin');
      const { verifyCloudflaredFile } = require('./prepare-cloudflared-mac');
      const packagedCf = path.join(appPath, 'Contents', 'Resources', 'bin', 'cloudflared', 'cloudflared');
      const bad = verifyCloudflaredFile(packagedCf);
      if (bad.length) throw new Error(`afterPack: the packaged cloudflared is not usable — ${bad.join('; ')}`);
      console.log(`  • afterPack: packaged cloudflared ${pinMod.version} verified (pinned sha256, Cloudflare Developer ID signature intact, runs) ✅`);
    }
  }
};
