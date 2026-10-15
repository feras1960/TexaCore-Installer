'use strict';
// scripts/release-assets.js: the upload set of a release (feeds, binaries AND blockmaps), verified against dist/. It uploads nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { planRelease, readBlockmap } = require('../scripts/release-assets');
const { mkdtemp } = require('./helpers');

const b64 = (b) => crypto.createHash('sha512').update(b).digest('base64');
function blockmapOf(buf) {
  const sizes = []; const checksums = [];
  for (let o = 0; o < buf.length; o += 1000) { const n = Math.min(1000, buf.length - o); sizes.push(n); checksums.push(crypto.createHash('sha256').update(buf.subarray(o, o + n)).digest('base64')); }
  return zlib.gzipSync(JSON.stringify({ version: '2', files: [{ name: 'file', offset: 0, checksums, sizes }] }));
}
/** A fake dist/ for one version with every file the release needs. */
function dist(version = '9.9.9') {
  const d = mkdtemp('rel-assets-');
  const exe = Buffer.from('windows installer '.repeat(500)); const zip = Buffer.from('mac zip '.repeat(700)); const dmg = Buffer.from('mac dmg '.repeat(650));
  const names = { exe: `TexaCore-ERP-Setup-${version}.exe`, zip: `TexaCore-ERP-${version}-arm64.zip`, dmg: `TexaCore-ERP-${version}-arm64.dmg` };
  fs.writeFileSync(path.join(d, names.exe), exe); fs.writeFileSync(path.join(d, names.zip), zip); fs.writeFileSync(path.join(d, names.dmg), dmg);
  fs.writeFileSync(path.join(d, `${names.exe}.blockmap`), blockmapOf(exe)); fs.writeFileSync(path.join(d, `${names.zip}.blockmap`), blockmapOf(zip));
  fs.writeFileSync(path.join(d, 'latest.yml'), `version: ${version}\nfiles:\n  - url: ${names.exe}\n    sha512: ${b64(exe)}\n    size: ${exe.length}\npath: ${names.exe}\nsha512: ${b64(exe)}\n`);
  fs.writeFileSync(path.join(d, 'latest-mac.yml'), `version: ${version}\nfiles:\n  - url: ${names.zip}\n    sha512: ${b64(zip)}\n    size: ${zip.length}\n  - url: ${names.dmg}\n    sha512: ${b64(dmg)}\n    size: ${dmg.length}\npath: ${names.zip}\nsha512: ${b64(zip)}\n`);
  return { d, names, exe, zip, dmg };
}

test('a complete, consistent dist: 7 files, binaries and blockmaps first, the feeds LAST, no problems', () => {
  const { d } = dist();
  const p = planRelease({ dist: d, version: '9.9.9' });
  assert.deepEqual(p.problems, []);
  assert.deepEqual(p.files.map((f) => f.name).sort(), ['TexaCore-ERP-9.9.9-arm64.dmg', 'TexaCore-ERP-9.9.9-arm64.zip', 'TexaCore-ERP-9.9.9-arm64.zip.blockmap', 'TexaCore-ERP-Setup-9.9.9.exe', 'TexaCore-ERP-Setup-9.9.9.exe.blockmap', 'latest-mac.yml', 'latest.yml']);
  const at = (n) => p.upload.indexOf(n);
  for (const n of ['TexaCore-ERP-9.9.9-arm64.zip', 'TexaCore-ERP-9.9.9-arm64.dmg', 'TexaCore-ERP-9.9.9-arm64.zip.blockmap']) assert.ok(at(n) >= 0 && at(n) < at('latest-mac.yml'), `${n} goes up before latest-mac.yml`);
  for (const n of ['TexaCore-ERP-Setup-9.9.9.exe', 'TexaCore-ERP-Setup-9.9.9.exe.blockmap']) assert.ok(at(n) >= 0 && at(n) < at('latest.yml'), `${n} goes up before latest.yml`);
  assert.ok(!p.upload.some((n) => n.endsWith('.dmg.blockmap')), 'the dmg blockmap is not part of the set (nothing reads it)');
  // ONE release (2.0.3 on): both platforms' binaries and blockmaps in the first command, both feeds in the second, nothing for another tag
  const cmds = p.commands.filter((c) => c.startsWith('gh release upload'));
  assert.equal(cmds.length, 2);
  assert.ok(cmds.every((c) => c.startsWith('gh release upload v9.9.9 --repo feras1960/TexaCore-Installer --clobber ')));
  assert.match(cmds[0], /zip\.blockmap.*|\.exe\.blockmap/);
  assert.ok(cmds[0].includes('Setup-9.9.9.exe.blockmap') && cmds[0].includes('arm64.zip.blockmap') && cmds[0].includes('arm64.dmg') && !cmds[0].includes('latest'));
  assert.ok(cmds[1].includes('latest-mac.yml') && cmds[1].includes('latest.yml') && !/\.(exe|zip|dmg|blockmap)"/.test(cmds[1]), 'the feeds go up LAST, together, after everything they name');
  assert.ok(!p.commands.join('\n').includes('windows-test'));
  assert.deepEqual(p.upload.slice(-2).sort(), ['latest-mac.yml', 'latest.yml']);
  assert.ok(p.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
});

test('the Windows blockmap is required: a dist without it (the 2.0.1 release) is a PROBLEM', () => {
  const { d, names } = dist();
  fs.rmSync(path.join(d, `${names.exe}.blockmap`));
  const p = planRelease({ dist: d, version: '9.9.9' });
  assert.ok(p.problems.some((x) => /exe\.blockmap is missing/.test(x)), p.problems.join('; '));
});

test('wrong version in a feed, a changed binary, a missing feed entry, a blockmap of another build, a corrupt blockmap — each is reported', () => {
  const a = dist();
  fs.writeFileSync(path.join(a.d, 'latest.yml'), fs.readFileSync(path.join(a.d, 'latest.yml'), 'utf8').replace('version: 9.9.9', 'version: 9.9.8'));
  assert.ok(planRelease({ dist: a.d, version: '9.9.9' }).problems.some((x) => /latest\.yml says version 9\.9\.8/.test(x)));
  const b = dist();
  fs.appendFileSync(path.join(b.d, b.names.zip), 'tampered');
  assert.ok(planRelease({ dist: b.d, version: '9.9.9' }).problems.some((x) => /zip is \d+ bytes but the feed says/.test(x)));
  const c = dist();
  fs.writeFileSync(path.join(c.d, c.names.exe), Buffer.from('X'.repeat(a.exe.length)));       // same size, other content
  assert.ok(planRelease({ dist: c.d, version: '9.9.9' }).problems.some((x) => /does not match the sha512/.test(x)));
  const e = dist();
  fs.writeFileSync(path.join(e.d, `${e.names.zip}.blockmap`), blockmapOf(Buffer.from('another build '.repeat(100))));
  assert.ok(planRelease({ dist: e.d, version: '9.9.9' }).problems.some((x) => /belongs to another build/.test(x)));
  const f = dist();
  fs.writeFileSync(path.join(f.d, `${f.names.exe}.blockmap`), 'not gzip');
  assert.ok(planRelease({ dist: f.d, version: '9.9.9' }).problems.some((x) => /is not a blockmap/.test(x)));
  const g = dist();
  fs.rmSync(path.join(g.d, 'latest-mac.yml'));
  assert.ok(planRelease({ dist: g.d, version: '9.9.9' }).problems.some((x) => /latest-mac\.yml is missing/.test(x)));
});

test('--blockmaps-only (a release already live without them): only the blockmaps are uploaded, after proving the feeds are the published ones; nothing is clobbered', () => {
  const { d } = dist();
  const p = planRelease({ dist: d, version: '9.9.9', blockmapsOnly: true });
  assert.deepEqual(p.upload.sort(), ['TexaCore-ERP-9.9.9-arm64.zip.blockmap', 'TexaCore-ERP-Setup-9.9.9.exe.blockmap']);
  const text = p.commands.join('\n');
  assert.match(text, /gh release upload v9\.9\.9 --repo feras1960\/TexaCore-Installer "[^"]*arm64\.zip\.blockmap"/);
  assert.match(text, /gh release upload v9\.9\.9 --repo feras1960\/TexaCore-Installer "[^"]*arm64\.zip\.blockmap" "[^"]*Setup-9\.9\.9\.exe\.blockmap"/, 'Windows is in the same release, one command');
  assert.match(text, /select\(\.name=="TexaCore-ERP-9\.9\.9-arm64\.zip"\) \| \.digest.*= "sha256:[0-9a-f]{64}"/, 'proves the published file is the one in dist/');
  assert.ok(!/--clobber/.test(text));
});

test('the older layout is still expressible: --win-tag v<x>-windows-test sends each platform to its own release', () => {
  const { d } = dist();
  const p = planRelease({ dist: d, version: '9.9.9', winTag: 'v9.9.9-windows-test' });
  const text = p.commands.join('\n');
  assert.match(text, /gh release upload v9\.9\.9-windows-test --repo feras1960\/TexaCore-Installer --clobber .*\.exe\.blockmap/);
  assert.match(text, /gh release upload v9\.9\.9 --repo feras1960\/TexaCore-Installer --clobber .*zip\.blockmap/);
});

test('--hold-win-feed: the exe and its blockmap go up, latest.yml (the Windows feed) is listed as HELD and never uploaded; the mac feed still goes last', () => {
  const { d } = dist();
  const p = planRelease({ dist: d, version: '9.9.9', holdWinFeed: true });
  assert.deepEqual(p.problems, []);
  assert.deepEqual(p.held, ['latest.yml']);
  assert.ok(!p.upload.includes('latest.yml') && p.upload.includes('TexaCore-ERP-Setup-9.9.9.exe') && p.upload.includes('TexaCore-ERP-Setup-9.9.9.exe.blockmap'));
  assert.equal(p.upload[p.upload.length - 1], 'latest-mac.yml');
  const text = p.commands.join('\n');
  assert.ok(!/gh release upload [^\n]*latest\.yml/.test(text.replace(/latest-mac\.yml/g, '')), 'no upload command names latest.yml');
  assert.match(text, /# HELD, not uploaded: latest\.yml/);
});

test('readBlockmap reads electron-builder\'s gzip JSON and totals the block sizes', () => {
  const d = mkdtemp('bm-'); const buf = Buffer.alloc(2500, 3);
  fs.writeFileSync(path.join(d, 'x.blockmap'), blockmapOf(buf));
  assert.deepEqual(readBlockmap(path.join(d, 'x.blockmap')), { ok: true, total: 2500, version: '2' });
  assert.equal(readBlockmap(path.join(d, 'missing.blockmap')).ok, false);
});
