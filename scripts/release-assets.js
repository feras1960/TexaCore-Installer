#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// release-assets — the complete, verified list of files one release must carry on GitHub, and the commands to upload them. It UPLOADS NOTHING: it reads dist/,
// checks it, and prints. (Earlier releases were assembled by hand and shipped without the .blockmap files, so electron-updater on Windows could never use a
// differential download, and a later release could not diff against them.)
//
//   node scripts/release-assets.js [--dist dist] [--version <x.y.z>] [--mac-tag v<x.y.z>] [--win-tag v<x.y.z>] [--hold-win-feed] [--json] [--blockmaps-only]
//   --hold-win-feed   do not upload latest.yml (the Windows feed): the exe and its blockmap go up, but no Windows client is offered the version automatically (an option: from 2.0.3 the Windows auto-update is ENABLED, latest.yml goes up with latest-mac.yml)
//   Both platforms go into ONE release, v<x.y.z> (2.0.3 on): all binaries and blockmaps first, then the two feeds (latest-mac.yml, latest.yml) last. --mac-tag / --win-tag only exist for
//   the older layout (Windows in its own v<x.y.z>-windows-test pre-release): given different tags, each platform is uploaded to its own release.
//   --blockmaps-only  for a release that is ALREADY live without its blockmaps (2.0.1): only the blockmaps are uploaded — but first prove that dist/ holds the very files that were published
//
//   Windows   latest.yml · TexaCore-ERP-Setup-<v>.exe · TexaCore-ERP-Setup-<v>.exe.blockmap
//   macOS     latest-mac.yml · TexaCore-ERP-<v>-arm64.zip · TexaCore-ERP-<v>-arm64.dmg · TexaCore-ERP-<v>-arm64.zip.blockmap
//   (the .dmg.blockmap is not uploaded: nothing reads it. The Mac self-updater (src/mac-updater.js) downloads the zip whole and resumes with HTTP Range; the zip's blockmap
//    is a few hundred KB and keeps the door open for a differential download later.)
//
// Checks: every file exists; the ymls carry <version>; each listed file's size and sha512 (base64) equal the file on disk; each blockmap is a gzip'd electron-builder blockmap
// whose block sizes add up to the size of its file (a blockmap of ANOTHER build would silently produce a corrupt differential download — electron-updater verifies the sha512
// afterwards and falls back to a full download, but the user waits twice).
// Order of upload matters: binaries and blockmaps FIRST, the ymls LAST — a client reads the yml, then fetches what it names.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const REPO = 'feras1960/TexaCore-Installer';
const hashFile = (f, algo, enc) => crypto.createHash(algo).update(fs.readFileSync(f)).digest(enc);

/** Parse an electron-builder blockmap: gzip → JSON { version, files: [{ name, offset, checksums[], sizes[] }] }. Returns { ok, total, error }. */
function readBlockmap(file) {
  try {
    const j = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    if (!j || !Array.isArray(j.files) || !j.files.length) return { ok: false, error: 'no files entry' };
    let total = 0;
    for (const f of j.files) {
      if (!Array.isArray(f.sizes) || !Array.isArray(f.checksums) || f.sizes.length !== f.checksums.length) return { ok: false, error: 'sizes / checksums do not match' };
      total += f.sizes.reduce((a, b) => a + b, 0);
    }
    return { ok: true, total, version: j.version };
  } catch (e) { return { ok: false, error: e.message }; }
}

function readYml(file, problems, label) {
  if (!fs.existsSync(file)) { problems.push(`${label}: ${path.basename(file)} is missing`); return null; }
  try { return require('js-yaml').load(fs.readFileSync(file, 'utf8')); } catch (e) { problems.push(`${label}: ${path.basename(file)} is not readable (${e.message})`); return null; }
}

/** Plan and verify the upload set of one version. Pure over the files in `dist`. */
function planRelease({ dist, version, platforms = ['win', 'mac'], blockmapsOnly = false, macTag = '', winTag = '', holdWinFeed = false }) {
  const problems = [];
  const files = [];       // { name, role: 'binary' | 'blockmap' | 'feed', platform, size, sha256 }
  const add = (name, role, platform) => {
    const f = path.join(dist, name);
    if (!fs.existsSync(f)) { problems.push(`${platform}: ${name} is missing`); return null; }
    files.push({ name, role, platform, size: fs.statSync(f).size, sha256: hashFile(f, 'sha256', 'hex') });
    return f;
  };
  const checkListed = (y, name, platform) => {
    const e = ((y && y.files) || []).find((x) => x.url === name);
    const f = path.join(dist, name);
    if (!e) { problems.push(`${platform}: the feed does not list ${name}`); return; }
    if (!fs.existsSync(f)) return;
    if (e.size !== fs.statSync(f).size) problems.push(`${platform}: ${name} is ${fs.statSync(f).size} bytes but the feed says ${e.size}`);
    else if (e.sha512 !== hashFile(f, 'sha512', 'base64')) problems.push(`${platform}: ${name} does not match the sha512 in the feed`);
  };
  const checkBlockmap = (name, platform) => {
    const bm = path.join(dist, `${name}.blockmap`);
    if (!add(`${name}.blockmap`, 'blockmap', platform)) return;
    const b = readBlockmap(bm);
    if (!b.ok) problems.push(`${platform}: ${name}.blockmap is not a blockmap (${b.error})`);
    else if (fs.existsSync(path.join(dist, name)) && b.total !== fs.statSync(path.join(dist, name)).size) problems.push(`${platform}: ${name}.blockmap describes ${b.total} bytes but ${name} is ${fs.statSync(path.join(dist, name)).size} — it belongs to another build`);
  };

  if (platforms.includes('win')) {
    const exe = `TexaCore-ERP-Setup-${version}.exe`;
    const y = readYml(path.join(dist, 'latest.yml'), problems, 'win');
    if (y && String(y.version) !== version) problems.push(`win: latest.yml says version ${y.version}, not ${version}`);
    add(exe, 'binary', 'win'); checkListed(y, exe, 'win'); checkBlockmap(exe, 'win');
    add('latest.yml', 'feed', 'win');
  }
  if (platforms.includes('mac')) {
    const zip = `TexaCore-ERP-${version}-arm64.zip`; const dmg = `TexaCore-ERP-${version}-arm64.dmg`;
    const y = readYml(path.join(dist, 'latest-mac.yml'), problems, 'mac');
    if (y && String(y.version) !== version) problems.push(`mac: latest-mac.yml says version ${y.version}, not ${version}`);
    add(zip, 'binary', 'mac'); add(dmg, 'binary', 'mac'); checkListed(y, zip, 'mac'); checkListed(y, dmg, 'mac'); checkBlockmap(zip, 'mac');
    add('latest-mac.yml', 'feed', 'mac');
  }
  // 2.0.3 on: ONE release v<version> carries both platforms (macOS: the Mac self-updater reads releases/latest/download/latest-mac.yml; Windows: electron-updater reads latest.yml
  // of the latest normal release). Whatever the tags, the files of a tag go up as ONE group - every binary and blockmap first, EVERY feed last (a client reads a feed, then fetches what it names).
  // (Releases up to 2.0.2 kept Windows in a separate pre-release v<version>-windows-test: pass --win-tag for that.)
  const tags = { mac: macTag || `v${version}`, win: winTag || `v${version}` };
  const q = (n) => `"${path.join(dist, n)}"`;
  const commands = [];
  const upload = [];
  const groups = new Map();                       // tag -> { platforms: [], files: [] }
  for (const platform of ['mac', 'win']) {
    const mine = files.filter((f) => f.platform === platform);
    if (!mine.length) continue;
    const g = groups.get(tags[platform]) || { platforms: [], files: [] };
    g.platforms.push(platform); g.files.push(...mine);
    groups.set(tags[platform], g);
  }
  const held = holdWinFeed ? files.filter((f) => f.platform === 'win' && f.role === 'feed').map((f) => f.name) : [];
  for (const [tag, g] of groups) {
    const feed = g.files.filter((f) => f.role === 'feed' && !held.includes(f.name)).map((f) => f.name);
    const rest = g.files.filter((f) => f.role !== 'feed' && (!blockmapsOnly || f.role === 'blockmap')).map((f) => f.name);
    const label = g.platforms.join(' + ');
    if (blockmapsOnly) {
      commands.push(`# ${label}: release ${tag} is already live — add ONLY the blockmap(s), and only if dist/ holds the very files that were published (GitHub keeps each asset's sha256):`);
      for (const f of g.files.filter((x) => x.role === 'binary' && rest.includes(`${x.name}.blockmap`))) {
        commands.push(`test "$(gh release view ${tag} --repo ${REPO} --json assets --jq '.assets[] | select(.name=="${f.name}") | .digest')" = "sha256:${f.sha256}" && echo "${f.name}: identical to the published file"`);
      }
      commands.push(`gh release upload ${tag} --repo ${REPO} ${rest.map(q).join(' ')}`);
      upload.push(...rest);
    } else {
      commands.push(`# ${label}: binaries + blockmaps into ${tag} (the release must already exist; --clobber replaces a file of the same name), then the feed${feed.length > 1 ? 's' : ''}`);
      commands.push(`gh release upload ${tag} --repo ${REPO} --clobber ${rest.map(q).join(' ')}`);
      if (feed.length) commands.push(`gh release upload ${tag} --repo ${REPO} --clobber ${feed.map(q).join(' ')}`);
      if (held.length) commands.push(`# HELD, not uploaded: ${held.join(', ')} (the Windows feed - upload it only when the Windows auto-update has been proven on a real PC)`);
      upload.push(...rest, ...feed);
    }
    commands.push(`gh release view ${tag} --repo ${REPO} --json assets --jq '.assets[] | [.name, .size, .digest] | @tsv'     # compare with the sha256 list above`);
  }
  return { version, files, tags, upload, held, problems, commands };
}

module.exports = { planRelease, readBlockmap, REPO };

if (require.main === module) {
  const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
  const ROOT = path.join(__dirname, '..');
  const dist = path.resolve(ROOT, arg('dist', 'dist'));
  const version = arg('version', require('../package.json').version);
  const plan = planRelease({ dist, version, blockmapsOnly: process.argv.includes('--blockmaps-only'), macTag: arg('mac-tag'), winTag: arg('win-tag'), holdWinFeed: process.argv.includes('--hold-win-feed') });
  if (process.argv.includes('--json')) { console.log(JSON.stringify(plan, null, 2)); process.exit(plan.problems.length ? 1 : 0); }
  console.log(`release-assets v${version}  (${dist})\n`);
  for (const f of plan.files) console.log(`  ${f.role.padEnd(8)} ${f.platform}  ${f.name}  ${(f.size >= 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.ceil(f.size / 1024) + ' KB')}  sha256 ${f.sha256.slice(0, 16)}…`);
  if (plan.problems.length) { console.log(`\nPROBLEMS (${plan.problems.length}):`); for (const p of plan.problems) console.log(`  - ${p}`); console.log('\nNothing should be uploaded until these are fixed.'); process.exit(1); }
  console.log(`\nAll ${plan.files.length} files are present and consistent. Nothing is uploaded by this script — the commands:\n`);
  for (const c of plan.commands) console.log(c);
  process.exit(0);
}
