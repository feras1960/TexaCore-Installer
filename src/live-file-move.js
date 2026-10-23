'use strict';
// ════════════════════════════════════════════════════════════════
// live-file-move — «تغيير المكان»: move the live company file to another folder, SAFELY.  (2.0.5 RC2, pure of Electron: every outside
// thing is injected, so the tests drive it on scratch folders with a fake backup manager.)
//
// The rule of the whole module: the OLD file is never deleted, renamed or truncated, and the program only points at the new file after
// the new file has been proven to hold exactly the bytes of the old one.
//
//   1. the target folder is asked about first (macOS privacy: FOLDER_PERMISSION, never a frozen program), must differ from the current
//      folder, must be writable, and must have room for the file;
//   2. the live sync is paused (a last run flushes the newest data into the OLD file, then no run may start) - serialised with the
//      one-minute sync, so the bytes copied are a complete file and not one in the middle of being replaced;
//   3. the file is read once (SHA-256 of those bytes), written under a temporary name in the new folder, read back and compared
//      (size + SHA-256) and opened as a container (the same decrypt probe a restore uses); only then is it given its final, FREE name
//      (never an existing file) and verified once more;
//   4. SWITCH: the backup manager, the config entry of the live file and the live-file-policy owner all point at the new file; the sync
//      resumes (its first run writes the newest data into the new file). The old file stays where it was.
// Any failure before step 4 changes nothing but removes the files THIS call created and resumes the sync on the old file.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const companyFile = require('./company-file');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const isAbs = (p) => typeof p === 'string' && p.length > 0 && path.isAbsolute(p);

function fail(code, error, extra) {
  return { success: false, code, error, ...(extra || {}) };
}

/** `~` → the home folder (the page may send what the user typed); anything else is returned as is. */
function expandHome(p, home = os.homedir()) {
  return typeof p === 'string' && (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) ? path.join(home, p.slice(1)) : p;
}

/** Are these the same folder? Case-insensitive off Linux (macOS / Windows volumes are by default), trailing separators ignored. */
function sameFolder(a, b, platform = process.platform) {
  if (!a || !b) return false;
  const n = (p) => { const r = path.resolve(String(p)); return platform === 'linux' ? r : r.toLowerCase(); };
  return n(a) === n(b);
}

/** Free bytes for an unprivileged user on the volume of `dir`, or null when the platform cannot tell. */
function freeBytesOf(dir, statfs = fs.statfsSync) {
  try {
    const s = statfs(dir);
    const v = Number(s.bavail) * Number(s.bsize);
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

/** The room a copy of `size` bytes needs: the file itself plus a margin (1 MiB or 5%, whichever is larger) for the temporary name and the file system. */
function spaceNeeded(size) {
  return size + Math.max(1024 * 1024, Math.ceil(size * 0.05));
}

/** An fs error while writing the copy → the code of the answer. */
function writeFailureCode(err) {
  const c = companyFile.classifyFsError(err, 'write');
  if (c.reason === 'disk-full') return 'NO_SPACE';
  if (c.reason === 'macos-permission') return 'FOLDER_PERMISSION';
  if (c.reason === 'not-downloaded') return 'FILE_NOT_LOCAL';
  if (c.reason === 'no-permission' || c.reason === 'folder-missing') return 'NOT_WRITABLE';
  return 'MOVE_FAILED';
}

const TEXT = {
  NO_LIVE_FILE: 'لا يوجد ملف شركة حيّ لنقله بعد | There is no live company file to move yet',
  CANCELED: 'أُلغي اختيار المجلد | The folder choice was canceled',
  SAME_FOLDER: 'هذا هو المجلد الحالي للملف | This is the folder the file is already in',
  NOT_WRITABLE: 'لا يمكن الكتابة في هذا المجلد | TexaCore cannot write to this folder',
  NO_SPACE: 'لا توجد مساحة كافية في هذا المجلد | There is not enough free space in this folder',
  VERIFY_FAILED: 'تعذّر التحقق من النسخة الجديدة، فبقي الملف في مكانه ولم يتغيّر شيء | The new copy could not be verified, so the file stayed where it was and nothing changed',
  BUSY: 'عملية نقل أو استعادة قيد التنفيذ، أعد المحاولة بعد قليل | A move or a restore is already running, try again in a moment',
  BAD_REQUEST: 'مسار المجلد غير صالح | The folder path is not valid',
  MOVE_FAILED: 'تعذّر نقل الملف، فبقي في مكانه | The file could not be moved, so it stayed where it was',
};

/** Write `buf` to a NEW file (fails when the name exists), all bytes, then fsync. */
function writeNewFile(fsx, file, buf) {
  const fd = fsx.openSync(file, 'wx', 0o600);
  try {
    let off = 0;
    while (off < buf.length) off += fsx.writeSync(fd, buf, off, buf.length - off, off);
    try { fsx.fsyncSync(fd); } catch { /* some file systems cannot fsync: the read-back is the proof */ }
  } finally { fsx.closeSync(fd); }
}

/**
 * @param {object} deps
 *   liveFile()                       → the live company file path (or null)
 *   pickFolder({defaultPath})        → Promise<{canceled?:boolean, dir?:string}>      (the native folder chooser; harness runs answer it)
 *   requireFolderAccess(dir)         → Promise<void>; throws an Error with code 'FOLDER_PERMISSION' (+ area/state) when macOS has not allowed it
 *   quiesce()                        → Promise<{ ok:boolean, resume:(switched:boolean)=>void }>   pause the minute sync, flush the newest data into the OLD file, hold writes
 *   probe(buffer)                    → throws when the bytes are not a container this install can open
 *   commit({from, to, dir})          → switch the backup manager + config; throws on failure (it must leave the old pointers in place when it throws)
 *   readSource(path)                 → Promise<Buffer>      (default: companyFile.readFileIdle - gives up on an iCloud placeholder)
 *   freeBytes(dir), uniqueTcdbPath(dir, base), folderIsWritable(dir), fs, log   (defaults: the real ones)
 */
function createLiveFileMover(deps) {
  const d = {
    fs, freeBytes: freeBytesOf, uniqueTcdbPath: companyFile.uniqueTcdbPath, folderIsWritable: companyFile.folderIsWritable,
    readSource: (p) => companyFile.readFileIdle(p), log: () => {}, home: os.homedir(), platform: process.platform, ...deps,
  };
  let inFlight = false;

  async function move(opts) {
    if (inFlight) return fail('BUSY', TEXT.BUSY);
    inFlight = true;
    try { return await run(opts); } finally { inFlight = false; }
  }

  async function run(opts) {
    const o = opts && typeof opts === 'object' ? opts : {};
    const fsx = d.fs;
    const from = d.liveFile();
    let st = null;
    try { st = isAbs(from) ? fsx.statSync(from) : null; } catch { st = null; }
    if (!st || !st.isFile()) return fail('NO_LIVE_FILE', TEXT.NO_LIVE_FILE);

    // ── the target folder: given, or chosen in the native window ──
    let dir = null;
    if (o.dir != null && o.dir !== '') {
      if (typeof o.dir !== 'string') return fail('BAD_REQUEST', TEXT.BAD_REQUEST);
      dir = expandHome(o.dir.trim(), d.home);
    } else {
      const picked = await d.pickFolder({ defaultPath: path.dirname(from) });
      if (!picked || picked.canceled || !picked.dir) return fail('CANCELED', TEXT.CANCELED, { canceled: true });
      dir = picked.dir;
    }
    if (!isAbs(dir) || dir.includes('\0')) return fail('BAD_REQUEST', TEXT.BAD_REQUEST);
    dir = path.resolve(dir);
    if (sameFolder(path.dirname(from), dir, d.platform)) return fail('SAME_FOLDER', TEXT.SAME_FOLDER, { from });

    // ── permission first (a protected folder macOS has not allowed would freeze the program on the first touch), then the checks ──
    for (const [which, p] of [['target', dir], ['source', path.dirname(from)]]) {
      try { await d.requireFolderAccess(p); } catch (e) {
        if (e && e.code === 'FOLDER_PERMISSION') return fail('FOLDER_PERMISSION', String(e.message || e), { area: e.area || null, state: e.state || null, which });
        throw e;
      }
    }
    let sameReal = false;
    try { sameReal = sameFolder(fsx.realpathSync(path.dirname(from)), fsx.realpathSync(dir), d.platform); } catch { sameReal = false; }   // a symlink / alias to the same folder
    if (sameReal) return fail('SAME_FOLDER', TEXT.SAME_FOLDER, { from });
    const w = d.folderIsWritable(dir);
    if (!w.ok) return fail('NOT_WRITABLE', `${TEXT.NOT_WRITABLE} (${w.reason})`, { reason: w.reason });
    const free = d.freeBytes(dir);
    const need = spaceNeeded(st.size);
    if (free != null && free < need) return fail('NO_SPACE', TEXT.NO_SPACE, { needed: need, free });

    // ── pause the sync, then copy → verify → place → verify ──
    const q = await d.quiesce();
    if (!q || q.ok === false) return fail('BUSY', TEXT.BUSY);
    let tmp = null;          // the temporary name THIS call created (removed at the end)
    let finalPath = null;    // the final name, once THIS call created it (removed again unless the switch happened)
    let switched = false;
    try {
      let buf;
      try { buf = await d.readSource(from); } catch (e) {
        if (e && e.code === 'FILE_NOT_LOCAL') return fail('FILE_NOT_LOCAL', String(e.message || e));
        if (e && e.code === 'FILE_NOT_FOUND') return fail('NO_LIVE_FILE', TEXT.NO_LIVE_FILE);
        return fail('MOVE_FAILED', `${TEXT.MOVE_FAILED} (${String((e && e.message) || e).slice(0, 160)})`);
      }
      const srcSum = sha256(buf);
      const base = path.basename(from).replace(/\.tcdb$/i, '');
      let wanted = d.uniqueTcdbPath(dir, base);
      const tmpPath = path.join(dir, `.${path.basename(wanted)}.${process.pid}.moving.tmp`);
      try {
        writeNewFile(fsx, tmpPath, buf);
        tmp = tmpPath;
      } catch (e) {
        if (e && e.code !== 'EEXIST') { try { fsx.unlinkSync(tmpPath); } catch { /* not created */ } }
        const code = writeFailureCode(e);
        d.log('[Move] write failed', e && e.code);
        return fail(code, `${TEXT[code] || TEXT.MOVE_FAILED} (${(e && e.code) || 'error'})`);
      }
      const verifyBytes = (p) => {
        const back = fsx.readFileSync(p);
        if (back.length !== buf.length || sha256(back) !== srcSum) return false;
        d.probe(back);   // throws when the container cannot be opened with this install's key
        return true;
      };
      let okTmp = false;
      try { okTmp = verifyBytes(tmp); } catch (e) { d.log('[Move] verify (temp) failed', e && e.code); okTmp = false; }
      if (!okTmp) return fail('VERIFY_FAILED', TEXT.VERIFY_FAILED);

      // the final name is a FREE one: link / exclusive copy fail with EEXIST instead of replacing a file that appeared meanwhile
      for (let attempt = 0; ; attempt++) {
        try {
          try { fsx.linkSync(tmp, wanted); } catch (le) {
            if (!le || !['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS', 'EOPNOTSUPP'].includes(le.code)) throw le;
            fsx.copyFileSync(tmp, wanted, fs.constants.COPYFILE_EXCL);   // FAT/exFAT sticks and some shares have no hard links
          }
          finalPath = wanted;
          break;
        } catch (e) {
          if (e && e.code === 'EEXIST' && attempt < 5) { wanted = d.uniqueTcdbPath(dir, base); continue; }
          throw e;
        }
      }
      try { fsx.unlinkSync(tmp); tmp = null; } catch { /* leftover temp name: removed in finally */ }
      let okFinal = false;
      try { okFinal = verifyBytes(finalPath); } catch (e) { d.log('[Move] verify (final) failed', e && e.code); okFinal = false; }
      if (!okFinal) return fail('VERIFY_FAILED', TEXT.VERIFY_FAILED);

      // ── switch ──
      try { d.commit({ from, to: finalPath, dir }); } catch (e) {
        d.log('[Move] switch failed', e && e.message);
        return fail('MOVE_FAILED', `${TEXT.MOVE_FAILED} (${String((e && e.message) || e).slice(0, 160)})`);
      }
      switched = true;
      d.log('[Move] the live company file moved', from, '→', finalPath, `(${buf.length} bytes; the old file is kept)`);
      return { success: true, from, to: finalPath, kept: true, bytes: buf.length, sha256: srcSum };
    } catch (e) {
      d.log('[Move] unexpected failure', e && e.message);
      const code = writeFailureCode(e);
      return fail(code, `${TEXT[code] || TEXT.MOVE_FAILED} (${String((e && e.message) || e).slice(0, 160)})`);
    } finally {
      // what THIS call created and did not switch to is removed; the old file is never touched
      if (tmp) { try { fsx.unlinkSync(tmp); } catch { /* gone */ } }
      if (!switched && finalPath) { try { fsx.unlinkSync(finalPath); } catch { /* gone */ } }
      try { q.resume(switched); } catch (e) { d.log('[Move] resume failed', e && e.message); }
    }
  }

  return { move };
}

module.exports = { createLiveFileMover, sameFolder, freeBytesOf, spaceNeeded, expandHome, writeFailureCode, sha256 };
