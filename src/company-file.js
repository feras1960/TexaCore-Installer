'use strict';
// ════════════════════════════════════════════════════════════════
// company-file — where a company's .tcdb file lives, and how the launcher reads a file the user picked.
//
// 1.x kept the company file BESIDE the Rashid file (POST /api/import-rsf-path: tcdbPath = <folder of the .rsf>/<rsf name>.tcdb,
// config.companies[0] = { name, tcdbPath, storagePath: <that folder> }), the way Rashid itself keeps its file. 2.0 imports inside the app,
// so the installer no longer reads the .rsf — but the same placement is wanted. This module is the pure part of that (no Electron):
//   • the naming/placement rules — NEVER an existing file, never a path escaping the folder;
//   • a registry of the files the user picked in the native dialog, so a later call names a pick by an opaque reference instead of
//     sending a path back (the admin API never reads an arbitrary path a caller makes up);
//   • a read of the picked file that cannot hang: an iCloud/OneDrive "online-only" placeholder blocks a read until the whole file has
//     been downloaded, so the read is abandoned when no bytes arrive for a while and the user is told to download the file first.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/** The folder a company file goes to when no better place is known (the same default 1.x and the restore route use). */
function defaultCompanyDir(platform = process.platform, home = os.homedir()) {
  return platform === 'win32' ? 'C:\\TexaCore' : path.join(home, 'Documents', 'TexaCore');
}

/**
 * A file NAME (no folder) made from free text: separators, reserved characters and control characters become a space, runs of
 * spaces collapse, a leading dot / trailing dot-or-space is removed (Windows trims those and they would alias another name).
 * The Arabic letters stay. Falls back to `fallback` when nothing is left.
 */
function safeFileBase(raw, fallback = 'company', maxLen = 100) {
  // eslint-disable-next-line no-control-regex
  let n = String(raw == null ? '' : raw).replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/^[. ]+/, '').replace(/[. ]+$/, '').trim();
  if (n.length > maxLen) n = n.slice(0, maxLen).replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(\.|$)/i.test(n)) n = `_${n}`;   // Windows device names
  return n || fallback;
}

/** `<dir>/<base>.tcdb`, or `<base> (2).tcdb`, `(3)`… — the first name that does not exist yet. An existing company file is never the answer. */
function uniqueTcdbPath(dir, base, exists = fs.existsSync, limit = 999) {
  const clean = safeFileBase(base);
  for (let i = 1; i <= limit; i++) {
    const name = i === 1 ? `${clean}.tcdb` : `${clean} (${i}).tcdb`;
    const full = path.join(dir, name);
    if (!exists(full)) return full;
  }
  throw Object.assign(new Error(`no free file name for "${clean}" in ${dir}`), { code: 'NO_FREE_NAME' });
}

/**
 * Placement of the company file for a Rashid file at `rsfPath`: beside it, named after it. `exists` is injectable for the tests.
 * @returns {{ dir:string, base:string, tcdbPath:string }}
 */
function rsfCompanyFilePlan(rsfPath, exists = fs.existsSync) {
  const dir = path.dirname(rsfPath);
  const base = safeFileBase(path.basename(rsfPath).replace(/\.rsf$/i, ''), 'company');
  return { dir, base, tcdbPath: uniqueTcdbPath(dir, base, exists) };
}

/** Can a new file be created in `dir` (created if missing)? Never throws; `reason` is a short code for the log / the reply. */
function folderIsWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e && e.code ? String(e.code) : 'EUNKNOWN' };
  }
}

/** yyyy-mm-dd in the LOCAL calendar (a stamp from toISOString() is the UTC day: wrong between midnight and the UTC offset). */
function localDateStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ─── why a write failed / where a folder really lives ────────────

/**
 * An fs error (or a failed pg_dump) → a stable reason the UI turns into a sentence:
 *   folder-missing | no-permission | disk-full | not-downloaded | dump-failed | unknown
 * `stage` = 'dump' when the failure happened while the database was being dumped (not while a file was written).
 */
function classifyFsError(err, stage = 'write') {
  const code = err && err.code ? String(err.code) : '';
  if (stage === 'dump') return { code: code || 'PG_DUMP_FAILED', reason: 'dump-failed' };
  if (code === 'FILE_NOT_LOCAL' || code === 'ETIMEDOUT' || code === 'ECANCELED') return { code, reason: 'not-downloaded' };
  if (code === 'ENOENT' || code === 'ENOTDIR') return { code, reason: 'folder-missing' };
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'FOLDER_PERMISSION') return { code, reason: 'no-permission' };
  if (code === 'ENOSPC' || code === 'EDQUOT') return { code, reason: 'disk-full' };
  return { code: code || 'EUNKNOWN', reason: 'unknown' };
}

/** `defaults read com.apple.finder <key>` === 1 - is "Desktop & Documents Folders" of iCloud Drive on? Cached for a minute. */
const _finderFlagCache = new Map();
function finderFlag(key) {
  const hit = _finderFlagCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.v;
  let v = false;
  try { v = require('child_process').execFileSync('/usr/bin/defaults', ['read', 'com.apple.finder', key], { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() === '1'; } catch { v = false; }
  _finderFlagCache.set(key, { v, at: Date.now() });
  return v;
}

/**
 * Is `dir` inside a folder a cloud service keeps in sync (so the file may be an online-only stub, or be uploaded while half written)?
 * iCloud Drive itself, a Desktop/Documents folder when iCloud's "Desktop & Documents Folders" is on, and the OneDrive / Dropbox / Google Drive
 * folders by name. Returns { provider } or null. `flag` / `platform` / `home` are injectable for the tests.
 */
function detectCloudFolder(dir, { platform = process.platform, home = os.homedir(), flag = finderFlag } = {}) {
  if (!dir) return null;
  const norm = (p) => path.resolve(String(p)).replace(/\\/g, '/');
  const d = norm(dir);
  const h = norm(home);
  const inside = (base) => d === base || d.startsWith(base.endsWith('/') ? base : `${base}/`);
  if (platform === 'darwin') {
    if (inside(`${h}/Library/Mobile Documents`)) return { provider: 'icloud' };
    if (inside(`${h}/Desktop`) && flag('FXICloudDriveDesktop')) return { provider: 'icloud' };
    if (inside(`${h}/Documents`) && flag('FXICloudDriveDocuments')) return { provider: 'icloud' };
    const cs = /\/Library\/CloudStorage\/([^/]+)/.exec(d);
    if (cs) return { provider: /^OneDrive/i.test(cs[1]) ? 'onedrive' : /^GoogleDrive/i.test(cs[1]) ? 'gdrive' : /^Dropbox/i.test(cs[1]) ? 'dropbox' : 'cloud' };
  }
  for (const seg of d.split('/')) {
    if (/^OneDrive(\b|\s|-|$)/i.test(seg)) return { provider: 'onedrive' };
    if (/^Dropbox(\b|\s|-|$)/i.test(seg)) return { provider: 'dropbox' };
    if (/^(Google ?Drive)(\b|\s|-|$)/i.test(seg)) return { provider: 'gdrive' };
  }
  return null;
}

/** The program's own copy of a company file: <app data>/backups/<same name>.tcdb (a free name - it never replaces another company's copy). */
function programCopyPath(dataDir, tcdbPath, exists = fs.existsSync) {
  const base = path.basename(tcdbPath).replace(/\.tcdb$/i, '');
  return uniqueTcdbPath(path.join(dataDir, 'backups'), base, exists);
}

// ─── picked files ────────────────────────────────────────────────

/**
 * What the native dialog returned, kept in memory under an unguessable reference (1 hour, at most `max` at a time). The page sends the
 * reference back to read the file or to place a company file beside it; it never has to send — or be trusted with — a path.
 */
function createPickRegistry({ ttlMs = 60 * 60 * 1000, max = 20, now = () => Date.now() } = {}) {
  const items = new Map();
  const sweep = () => {
    const t = now();
    for (const [k, v] of items) if (t - v.at > ttlMs) items.delete(k);
    while (items.size > max) items.delete(items.keys().next().value);
  };
  return {
    register(info) {
      sweep();
      const ref = crypto.randomBytes(16).toString('hex');
      items.set(ref, { ...info, at: now() });
      sweep();
      return ref;
    },
    get(ref) {
      sweep();
      return typeof ref === 'string' && /^[0-9a-f]{32}$/.test(ref) ? (items.get(ref) || null) : null;
    },
    drop(ref) { items.delete(ref); },
    get size() { sweep(); return items.size; },
  };
}

/**
 * Is this file probably an online-only cloud placeholder (an iCloud "optimized storage" file whose bytes are not on this Mac)?
 * Such a file reports its full size but occupies no disk blocks. (A tiny or empty file is never judged.)
 */
function looksLikeCloudPlaceholder(st, platform = process.platform) {
  return platform === 'darwin' && !!st && st.size > 64 * 1024 && st.blocks === 0;
}

/** Older macOS marks an evicted file by replacing it with a hidden "<.name>.icloud" stub — the original path then does not exist. */
function icloudStubFor(filePath, exists = fs.existsSync) {
  const stub = path.join(path.dirname(filePath), `.${path.basename(filePath)}.icloud`);
  return exists(stub) ? stub : null;
}

const FILE_NOT_LOCAL_TEXT = 'الملف غير محمَّل على هذا الجهاز (مخزَّن في iCloud أو سحابة أخرى). نزِّله أولاً من Finder/المستكشف ثم أعد المحاولة | '
  + 'The file is not downloaded on this computer (it is stored in iCloud or another cloud drive). Download it first in Finder/Explorer, then try again';

/**
 * Read a whole file, but give up when nothing arrives for `idleMs` (a placeholder that is not downloading). Rejects with a coded Error:
 *   FILE_NOT_FOUND | FILE_NOT_LOCAL | FILE_TOO_LARGE | FILE_READ_FAILED
 * `openStream` is injectable for the tests (a stream that stalls).
 */
function readFileIdle(filePath, { idleMs = 20000, maxBytes = 1024 * 1024 * 1024, openStream = (p) => fs.createReadStream(p, { highWaterMark: 4 * 1024 * 1024 }), exists = fs.existsSync, stat = fs.statSync } = {}) {
  return new Promise((resolve, reject) => {
    let st;
    try { st = stat(filePath); } catch (e) {
      const stub = icloudStubFor(filePath, exists);
      return reject(Object.assign(new Error(stub ? FILE_NOT_LOCAL_TEXT : `الملف غير موجود | File not found: ${filePath}`), { code: stub ? 'FILE_NOT_LOCAL' : 'FILE_NOT_FOUND' }));
    }
    if (!st.isFile()) return reject(Object.assign(new Error(`ليس ملفاً | Not a file: ${filePath}`), { code: 'FILE_NOT_FOUND' }));
    if (st.size > maxBytes) return reject(Object.assign(new Error(`الملف أكبر من الحد المسموح | The file is larger than the allowed size (${st.size} bytes)`), { code: 'FILE_TOO_LARGE' }));
    const chunks = [];
    let got = 0;
    let done = false;
    let timer = null;
    let stream = null;
    const finish = (err, buf) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) { try { stream && stream.destroy(); } catch { /* gone */ } reject(err); } else resolve(buf);
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(Object.assign(new Error(FILE_NOT_LOCAL_TEXT), { code: 'FILE_NOT_LOCAL', placeholder: looksLikeCloudPlaceholder(st) })), idleMs);
    };
    try {
      arm();   // the clock runs from the open: a placeholder can block the very first read
      stream = openStream(filePath);
      stream.on('data', (c) => {
        got += c.length;
        if (got > maxBytes) return finish(Object.assign(new Error('The file is larger than the allowed size'), { code: 'FILE_TOO_LARGE' }));
        chunks.push(c);
        arm();
      });
      stream.on('error', (e) => finish(Object.assign(new Error(`${e.message}`), { code: 'FILE_READ_FAILED', cause: e })));
      stream.on('end', () => finish(null, Buffer.concat(chunks, got)));
    } catch (e) {
      finish(Object.assign(new Error(e.message), { code: 'FILE_READ_FAILED', cause: e }));
    }
  });
}

module.exports = {
  defaultCompanyDir, safeFileBase, uniqueTcdbPath, rsfCompanyFilePlan, folderIsWritable, localDateStamp,
  createPickRegistry, looksLikeCloudPlaceholder, icloudStubFor, readFileIdle, FILE_NOT_LOCAL_TEXT,
  classifyFsError, detectCloudFolder, programCopyPath,
};
