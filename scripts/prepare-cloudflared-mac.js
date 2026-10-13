#!/usr/bin/env node
'use strict';
// prepare-cloudflared-mac — put the pinned cloudflared (macOS arm64) into bin/macos-arm64/cloudflared/ after checking it.
//
//   node scripts/prepare-cloudflared-mac.js <path to the downloaded cloudflared binary>      (copy + verify)
//   node scripts/prepare-cloudflared-mac.js --verify-only                                      (check what is in the repo)
//
// Checks: sha256 and size equal the pin · Mach-O arm64 · the signature verifies and is Cloudflare's Developer ID (team 68WVV388M8) · it RUNS and says the pinned version.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const pin = require('./lib/cloudflared-pin');

function verifyCloudflaredFile(file, { run = true } = {}) {
  const problems = [];
  if (!fs.existsSync(file)) return [`${file} is missing`];
  const st = fs.statSync(file);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (sha !== pin.mac.sha256) problems.push(`sha256 ${sha} != pinned ${pin.mac.sha256}`);
  if (st.size !== pin.mac.bytes) problems.push(`size ${st.size} != pinned ${pin.mac.bytes}`);
  if (process.platform === 'darwin') {
    if ((st.mode & 0o111) === 0) problems.push('not executable');
    const cs = spawnSync('codesign', ['--verify', '--strict', file], { encoding: 'utf8' });
    if (cs.status !== 0) problems.push(`signature does not verify: ${(cs.stderr || '').trim().split('\n')[0]}`);
    const dv = spawnSync('codesign', ['-dv', '--verbose=2', file], { encoding: 'utf8' });
    if (!(dv.stderr || '').includes(`Authority=${pin.mac.authority}`)) problems.push(`not signed by "${pin.mac.authority}"`);
    if (run && process.arch === 'arm64') {
      const r = spawnSync(file, ['--version'], { encoding: 'utf8', timeout: 15000 });
      if (r.status !== 0 || !new RegExp(`version ${pin.version.replace(/\./g, '\\.')}\\b`).test(r.stdout || '')) problems.push(`--version does not run / is not ${pin.version}: ${(r.stdout || r.stderr || String(r.error || '')).trim().slice(0, 100)}`);
    }
  }
  return problems;
}

module.exports = { verifyCloudflaredFile };

if (require.main === module) {
  const arg = process.argv[2];
  const dest = pin.mac.repoPath;
  if (arg === '--verify-only') {
    const p = verifyCloudflaredFile(dest);
    if (p.length) { console.error(`cloudflared (repo) is NOT the pinned file:\n  - ${p.join('\n  - ')}`); process.exit(1); }
    console.log(`cloudflared ${pin.version} (macOS arm64) in the repo equals the pin`); process.exit(0);
  }
  if (!arg) { console.error('usage: prepare-cloudflared-mac.js <downloaded cloudflared> | --verify-only'); process.exit(2); }
  const problems = verifyCloudflaredFile(path.resolve(arg));
  if (problems.length) { console.error(`refusing: ${arg} is not the pinned cloudflared ${pin.version}:\n  - ${problems.join('\n  - ')}`); process.exit(1); }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.resolve(arg), dest); fs.chmodSync(dest, 0o755);
  try { spawnSync('xattr', ['-c', dest]); } catch { /* ignore */ }
  const again = verifyCloudflaredFile(dest);
  if (again.length) { console.error(`the copy does not verify:\n  - ${again.join('\n  - ')}`); process.exit(1); }
  console.log(`cloudflared ${pin.version} → ${path.relative(process.cwd(), dest)} (sha256 ${pin.mac.sha256.slice(0, 16)}…, signed by Cloudflare Inc., runs)`);
}
