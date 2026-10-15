'use strict';
// ════════════════════════════════════════════════════════════════
// locate-file — find, on THIS computer, the file the user chose in the BROWSER's own file chooser.
//
// 2.0.3 (owner 15-10): the ERP page's «فتح ملف شركة» uses the browser's <input type=file> (it is always in front, in any mode), so the page holds the
// file's bytes but not its place. The place is what keeps the 2.0.2 behaviour: the company file is created BESIDE a Rashid file, and a picked .tcdb
// is opened IN PLACE. This module finds the file again from what the browser CAN tell: the exact name, the exact size and the SHA-256 of the whole
// content (the page hashes it). Only a file whose full content hashes equal to the caller's digest is ever answered, so the answer reveals a path
// only to a caller that already holds that file's bytes.
//
// Pure of Electron (injectable fs / child_process / clock) so the tests run it on scratch folders:
//   • validateLocateBody — the request, strictly;
//   • locateRoots        — the folders that are searched (Desktop, Documents, Downloads, iCloud Drive, OneDrive, the folders of known companies, the default
//                          company folder), or the harness override;
//   • mdfind (macOS)     — Spotlight by exact name, arguments only (no shell), 2 s;
//   • a bounded walk     — breadth-first, 3 s, depth ≤ 6, no hidden / node_modules / bundle folders, symbolic links never followed;
//   • a streamed SHA-256 with an idle guard; cloud placeholders are never read (no downloads).
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const netGuard = require('./net-guard');
const companyFile = require('./company-file');

const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const WALK_BUDGET_MS = 3000;
const MDFIND_TIMEOUT_MS = 2000;
const WALK_MAX_DEPTH = 6;
const WALK_MAX_DIRS = 20000;
const MAX_HASHED = 12;
const HASH_IDLE_MS = 8000;
const HASH_BUDGET_MS = 60000;
const MTIME_TOLERANCE_MS = 2000;
const ICLOUD_DRIVE_REL = ['Library', 'Mobile Documents', 'com~apple~CloudDocs'];

const badRequest = (msg) => Object.assign(new Error(msg), { code: 'BAD_REQUEST' });
const nfc = (s) => String(s).normalize('NFC');

/**
 * The request body → { name, ext, size, sha256, lastModified } or a BAD_REQUEST error.
 * name: a plain base name (no separator, no `..`, no control character) ending .rsf or .tcdb; size: a positive integer ≤ 1 GiB;
 * sha256: 64 hex characters; lastModified: optional, a finite number of milliseconds.
 */
function validateLocateBody(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (!b) throw badRequest('Expected a JSON object');
  const name = b.name;
  const ext = typeof name === 'string' ? (netGuard.safeUploadName(name, { ext: '.rsf' }) ? 'rsf' : netGuard.safeUploadName(name, { ext: '.tcdb' }) ? 'tcdb' : null) : null;
  if (!ext) throw badRequest('name must be a plain file name ending .rsf or .tcdb');
  const size = b.size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_BYTES) throw badRequest('size must be a positive integer of at most 1 GiB');
  if (typeof b.sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(b.sha256)) throw badRequest('sha256 must be 64 hex characters');
  let lastModified = null;
  if (b.lastModified !== undefined && b.lastModified !== null) {
    if (typeof b.lastModified !== 'number' || !Number.isFinite(b.lastModified) || b.lastModified < 0) throw badRequest('lastModified must be a number of milliseconds');
    lastModified = b.lastModified;
  }
  return { name, ext, size, sha256: b.sha256.toLowerCase(), lastModified };
}

/**
 * The folders searched. `override` (harness only) replaces everything. Otherwise: Desktop / Documents / Downloads of the profile (+ the folders the OS
 * reports for them - a Windows Desktop moved into OneDrive), iCloud Drive (macOS), OneDrive* Desktop/Documents/Downloads (Windows), the folders of the
 * companies this install already knows, and the default company folder. Missing folders are dropped; duplicates removed.
 */
function locateRoots({ platform = process.platform, home = os.homedir(), override = null, companyDirs = [], defaultDir = null, extraRoots = [], readdirSync = fs.readdirSync, existsSync = fs.existsSync } = {}) {
  if (override && override.length) return [...new Set(override.map((p) => path.resolve(p)))];
  const list = [];
  for (const d of ['Desktop', 'Documents', 'Downloads']) list.push(path.join(home, d));
  list.push(...extraRoots);
  if (platform === 'darwin') list.push(path.join(home, ...ICLOUD_DRIVE_REL));
  if (platform === 'win32') {
    let names = [];
    try { names = readdirSync(home); } catch { /* unreadable profile */ }
    for (const n of names) {
      if (!/^OneDrive/i.test(n)) continue;
      for (const d of ['Desktop', 'Documents', 'Downloads']) list.push(path.join(home, n, d));
    }
  }
  list.push(...companyDirs.filter(Boolean));
  if (defaultDir) list.push(defaultDir);
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (typeof p !== 'string' || !p || !path.isAbsolute(p)) continue;
    const r = path.resolve(p);
    const key = platform === 'win32' || platform === 'darwin' ? r.toLowerCase() : r;
    if (seen.has(key) || !existsSync(r)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** A folder the walk does not enter: hidden, node_modules, package bundles (an .app / a photo library is a file to the user), Windows system folders. */
function skipDirName(name, platform = process.platform) {
  if (name.startsWith('.')) return true;
  if (name === 'node_modules') return true;
  if (platform === 'darwin' && /\.(app|photoslibrary|imovielibrary|fcpbundle|tvlibrary|musiclibrary|sparsebundle)$/i.test(name)) return true;
  if (platform === 'win32' && /^(AppData|\$RECYCLE\.BIN|System Volume Information)$/i.test(name)) return true;
  return false;
}

/**
 * May a path Spotlight returned count as a candidate? Same rules as the walk: nothing under a hidden folder, node_modules or a bundle, nothing under the
 * profile's Library except iCloud Drive (the program's own backups live there - they are never "the file the user picked").
 */
function searchPathAllowed(p, { home = os.homedir(), platform = process.platform } = {}) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
  const h = path.resolve(home);
  const r = path.resolve(p);
  const sep = path.sep;
  if (!r.startsWith(h + sep)) return false;
  const rel = r.slice(h.length + 1).split(sep);
  const dirs = rel.slice(0, -1);
  if (dirs.some((d) => skipDirName(d, platform))) return false;
  if (rel[0] === 'Library') {
    const cloud = ICLOUD_DRIVE_REL;
    if (!(rel.length > cloud.length && cloud.every((c, i) => rel[i] === c))) return false;
  }
  return true;
}

/** Spotlight's query for these names: arguments only, with quotes and backslashes escaped. */
function mdfindArgs(home, names) {
  const esc = (n) => String(n).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const uniq = [...new Set(names)];
  return ['-onlyin', home, uniq.map((n) => `kMDItemFSName == "${esc(n)}"`).join(' || ')];
}

/** Paths Spotlight knows with exactly this base name (macOS). Never throws: a missing / slow / disabled Spotlight is just "no candidates". */
function mdfindCandidates(name, { home = os.homedir(), execFile = childProcess.execFile, timeoutMs = MDFIND_TIMEOUT_MS, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    if (platform !== 'darwin') return resolve([]);
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    try {
      const args = mdfindArgs(home, [name, name.normalize('NFC'), name.normalize('NFD')]);
      execFile('mdfind', args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
        if (err && !stdout) return done([]);
        const lines = String(stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
        done(lines.filter((p) => path.isAbsolute(p) && nfc(path.basename(p)) === nfc(name) && searchPathAllowed(p, { home, platform })));
      });
    } catch { done([]); }
  });
}

/**
 * Breadth-first walk of `roots` for regular files named `name`. Bounded by time (`deadline`), depth and the number of folders; never follows a symbolic
 * link (so there are no loops) and visits every real folder once. Unreadable folders are skipped.
 */
async function walkForFile(roots, name, { deadline, now = Date.now, maxDepth = WALK_MAX_DEPTH, maxDirs = WALK_MAX_DIRS, platform = process.platform, fsp = fs.promises } = {}) {
  const want = nfc(name);
  const queue = roots.map((dir) => ({ dir, depth: 0 }));
  const seen = new Set();
  const found = [];
  let visited = 0;
  let timedOut = false;
  for (let qi = 0; qi < queue.length; qi++) {
    if (now() > deadline) { timedOut = true; break; }
    if (visited >= maxDirs) break;
    const { dir, depth } = queue[qi];
    let key;
    try {
      const st = await fsp.stat(dir, { bigint: true });
      if (!st.isDirectory()) continue;
      key = st.ino && st.ino !== 0n ? `${st.dev}:${st.ino}` : `p:${(await fsp.realpath(dir)).toLowerCase()}`;
    } catch { continue; }
    if (seen.has(key)) continue;
    seen.add(key);
    visited++;
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (depth < maxDepth && !skipDirName(ent.name, platform)) queue.push({ dir: path.join(dir, ent.name), depth: depth + 1 });
      } else if (ent.isFile() && nfc(ent.name) === want) {
        found.push(path.join(dir, ent.name));
      }
    }
  }
  return { found, visited, timedOut };
}

/** SHA-256 of a whole file, streamed, abandoned when no bytes arrive for `idleMs` (a cloud placeholder that is not local) or when it is longer than `expectedSize`. */
function sha256FileIdle(filePath, { idleMs = HASH_IDLE_MS, expectedSize = Infinity, openStream = (p) => fs.createReadStream(p, { highWaterMark: 4 * 1024 * 1024 }) } = {}) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    let got = 0;
    let done = false;
    let timer = null;
    let stream = null;
    const finish = (err, hex) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) { try { stream && stream.destroy(); } catch { /* gone */ } reject(err); } else resolve({ hex, bytes: got });
    };
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => finish(Object.assign(new Error('read stalled'), { code: 'FILE_NOT_LOCAL' })), idleMs); };
    try {
      arm();
      stream = openStream(filePath);
      stream.on('data', (c) => {
        got += c.length;
        if (got > expectedSize) return finish(Object.assign(new Error('file grew'), { code: 'SIZE_CHANGED' }));
        h.update(c);
        arm();
      });
      stream.on('error', (e) => finish(Object.assign(new Error(e.message), { code: 'FILE_READ_FAILED' })));
      stream.on('end', () => finish(null, h.digest('hex')));
    } catch (e) {
      finish(Object.assign(new Error(e.message), { code: 'FILE_READ_FAILED' }));
    }
  });
}

/**
 * Find the file the caller holds: exact base name + exact size + equal SHA-256 of the whole content.
 * @param {{name:string,size:number,sha256:string,lastModified:?number}} q  validated by validateLocateBody
 * @param {object} deps  roots (required), home, platform, useMdfind, execFile, now, fsp, hashFile, budget numbers - all injectable for the tests
 * @returns {Promise<{found:true,filePath:string,stats:object}|{found:false,reason:'none'|'ambiguous',stats:object}>}
 *   The path is returned ONLY for a file whose full content hashed equal to q.sha256. `stats` holds counts only (never a path list).
 */
async function locatePickedFile(q, deps = {}) {
  const platform = deps.platform || process.platform;
  const home = deps.home || os.homedir();
  const now = deps.now || Date.now;
  const fsp = deps.fsp || fs.promises;
  const roots = deps.roots || [];
  const t0 = now();
  const stats = { roots: roots.length, spotlight: 0, walkDirs: 0, walkTimedOut: false, candidates: 0, hashed: 0, matches: 0 };

  const [fromSpotlight, walked] = await Promise.all([
    deps.useMdfind === false ? [] : mdfindCandidates(q.name, { home, platform, execFile: deps.execFile, timeoutMs: deps.mdfindTimeoutMs }),
    walkForFile(roots, q.name, { deadline: t0 + (deps.walkBudgetMs || WALK_BUDGET_MS), now, platform, fsp, maxDepth: deps.maxDepth, maxDirs: deps.maxDirs }),
  ]);
  stats.spotlight = fromSpotlight.length;
  stats.walkDirs = walked.visited;
  stats.walkTimedOut = walked.timedOut;

  // exact size, a regular file (never a link), not an evicted cloud placeholder (reading one would start a download); one entry per real file
  const byFile = new Map();
  for (const p of [...fromSpotlight, ...walked.found]) {
    let st;
    try { st = await fsp.lstat(p, { bigint: false }); } catch { continue; }
    if (!st.isFile() || st.size !== q.size) continue;
    if (companyFile.looksLikeCloudPlaceholder(st, platform)) continue;
    const key = st.ino ? `${st.dev}:${st.ino}` : `p:${p.toLowerCase()}`;
    if (!byFile.has(key)) byFile.set(key, { filePath: p, mtimeMs: st.mtimeMs });
  }
  const candidates = [...byFile.values()].slice(0, deps.maxHashed || MAX_HASHED);
  stats.candidates = byFile.size;

  const hashFile = deps.hashFile || ((p) => sha256FileIdle(p, { idleMs: deps.hashIdleMs || HASH_IDLE_MS, expectedSize: q.size }));
  const hashDeadline = now() + (deps.hashBudgetMs || HASH_BUDGET_MS);
  const matches = [];
  for (const c of candidates) {
    if (now() > hashDeadline) break;
    stats.hashed++;
    try {
      const r = await hashFile(c.filePath);
      if (r && r.hex === q.sha256 && r.bytes === q.size) matches.push(c);
    } catch { /* unreadable / stalled / changed while reading: not a match */ }
  }
  stats.matches = matches.length;

  if (matches.length === 0) return { found: false, reason: 'none', stats };
  if (matches.length === 1) return { found: true, filePath: matches[0].filePath, stats };
  // identical copies: the one the browser reported with the same modification time is the file the user chose (a copy has its own time)
  if (typeof q.lastModified === 'number') {
    const sameTime = matches.filter((m) => Math.abs(m.mtimeMs - q.lastModified) <= MTIME_TOLERANCE_MS);
    if (sameTime.length === 1) return { found: true, filePath: sameTime[0].filePath, stats };
  }
  return { found: false, reason: 'ambiguous', stats };
}

module.exports = {
  validateLocateBody, locateRoots, skipDirName, searchPathAllowed, mdfindArgs, mdfindCandidates, walkForFile, sha256FileIdle, locatePickedFile,
  MAX_FILE_BYTES, WALK_BUDGET_MS, MDFIND_TIMEOUT_MS, WALK_MAX_DEPTH,
};
