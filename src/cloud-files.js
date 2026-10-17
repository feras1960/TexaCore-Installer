'use strict';
// ════════════════════════════════════════════════════════════════
// cloud-files — is a file really on this computer, and if it is only a cloud placeholder, make it local WITH progress.
//
// WHY (2.0.4, owner's live test 17-10): the file he chose lived on an iCloud Desktop ("Optimize Mac Storage": `stat -f %Sf` = `compressed,dataless`, the
// full size but no bytes on disk). The 2.0.3 page hashed it in the browser; that read made macOS start downloading it, gave no progress, and the page's
// fixed 10 s / 20 s caps gave up long before the download ended - "the file could not be read".
//
// Now the PROGRAM looks at the file first (metadata only, no read), and when it is a placeholder it asks the system to download it and reports how many
// bytes are there, so the page can show «جارٍ تنزيله (x من y م.ب)» + a cancel button. The only guard is "no progress": a download that keeps moving is never cut.
//   • cloudState(path)      → 'local' | 'placeholder' (macOS: `stat -f %Sf` says `dataless`, else st_blocks == 0 with a size; Windows: `attrib` shows the offline flag O)
//   • startMaterialize(...) → { snapshot(), cancel(), done } - macOS: `brctl download` for iCloud + a child `cat` that reads the file to /dev/null (reading is what
//                             makes ANY file-provider - iCloud, OneDrive, Google Drive, Dropbox - deliver the bytes) ; Windows: `copy /b file NUL`.
//     The read runs in a CHILD process: a read that blocks until the download ends never holds one of the program's few file-system threads, and it can be killed.
// Pure of Electron: spawn / exec / stat / clock are injectable.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const childProcess = require('child_process');
const companyFile = require('./company-file');

const STALL_MS = 60 * 1000;        // no byte for this long = the download is stuck
const POLL_MS = 500;
const STAT_TIMEOUT_MS = 3000;

/** `stat -f "%Sf %z %b" path` → { flags, size, blocks } or null. Argument array, no shell. */
function macStatFlags(filePath, { execFile = childProcess.execFile, timeoutMs = STAT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    try {
      execFile('/usr/bin/stat', ['-f', '%Sf|%z|%b', '--', filePath], { timeout: timeoutMs, windowsHide: true, env: { PATH: '/bin:/usr/bin', LC_ALL: 'C' } }, (err, stdout) => {
        if (err) return resolve(null);
        const [flags, size, blocks] = String(stdout || '').trim().split('|');
        resolve({ flags: flags || '', size: Number(size) || 0, blocks: Number(blocks) || 0 });
      });
    } catch { resolve(null); }
  });
}

/** `attrib "file"` prints the attribute letters (R, A, S, H, O offline, U unpinned, P pinned...) before the path. O = the data is not here. */
function windowsAttribOffline(output) {
  const line = String(output || '').split(/\r?\n/).find((l) => l.trim()) || '';
  const m = /^\s*([A-Z ]{1,14}?)\s{2,}[A-Za-z]:\\/.exec(line);
  if (!m) return false;
  return m[1].split(/\s+/).filter(Boolean).includes('O');
}

// 2.0.4 (review F3): attrib and cmd.exe have no `--` end-of-options marker. What stands in for it on Windows: only an absolute drive path (C:\…) or UNC path (\\server\…) is ever
// passed - it can never start with "/" or "-" and so can never be read as a switch.
const WIN_ABSOLUTE = /^(?:[A-Za-z]:\\|\\\\)/;

function winAttrib(filePath, { execFile = childProcess.execFile, timeoutMs = STAT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    if (!WIN_ABSOLUTE.test(String(filePath))) return resolve(null);
    try { execFile('attrib', [filePath], { timeout: timeoutMs, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout || ''))); } catch { resolve(null); }
  });
}

/**
 * Can this path be handed to `cmd.exe /c copy` as ONE argument? cmd.exe (unlike a program started directly) re-reads its command line: an "&" in a path that Node does not quote
 * (a path without a space) would start a second command. No whitespace = no quotes from Node, so "&", "^" and "%" are refused then; a path with whitespace is quoted by Node.
 */
function windowsCopyPathOk(filePath) {
  const p = String(filePath);
  if (!WIN_ABSOLUTE.test(p)) return false;
  if (/[\x00-\x1f"<>|]/.test(p)) return false;
  return /\s/.test(p) || !/[&^%]/.test(p);
}

/**
 * 'local' or 'placeholder' for a regular file. `st` (an fs.Stats) is optional. Never throws; a platform/answer it cannot judge is 'local'
 * (a wrong "local" costs one read that may wait; a wrong "placeholder" would start a download nobody needs).
 */
async function cloudState(filePath, { platform = process.platform, st = null, execFile = childProcess.execFile } = {}) {
  try {
    if (platform === 'darwin') {
      const f = await macStatFlags(filePath, { execFile });
      if (f) return /\bdataless\b/.test(f.flags) || (f.size > 64 * 1024 && f.blocks === 0) ? 'placeholder' : 'local';
      return st && companyFile.looksLikeCloudPlaceholder(st, platform) ? 'placeholder' : 'local';
    }
    if (platform === 'win32') {
      const out = await winAttrib(filePath, { execFile });
      return out && windowsAttribOffline(out) ? 'placeholder' : 'local';
    }
  } catch { /* judged local */ }
  return 'local';
}

/** Which command makes the system deliver the bytes of a placeholder, as { cmd, args } lists. */
function materializeCommands(filePath, { platform = process.platform, icloud = false } = {}) {
  // `--` ends the options (2.0.4, review F3): cat and brctl both honour it (tested on macOS), so a path can never be read as a flag. A Windows path that cmd.exe could not take as one argument gets no command (the caller reports UNSAFE_NAME).
  if (platform === 'darwin') {
    const reader = { cmd: '/bin/cat', args: ['--', filePath], role: 'read' };
    return icloud ? [{ cmd: '/usr/bin/brctl', args: ['download', '--', filePath], role: 'request' }, reader] : [reader];
  }
  if (platform === 'win32') return windowsCopyPathOk(filePath) ? [{ cmd: 'cmd.exe', args: ['/d', '/c', 'copy', '/b', filePath, 'NUL'], role: 'read' }] : [];
  return [{ cmd: '/bin/cat', args: ['--', filePath], role: 'read' }];
}

/**
 * Make `filePath` (a placeholder of `size` bytes) local. Returns { snapshot, cancel, done }:
 *   snapshot() → { state: 'running'|'done'|'failed'|'cancelled', loaded, total, code? }
 *   done       → resolves once with the final snapshot (never rejects)
 * Progress = the larger of the bytes the reading child has passed on and the bytes the file system reports on disk (st_blocks * 512), so a download that
 * fills the file in place and a read that streams both show movement. `stallMs` without any progress ends it with code DOWNLOAD_STALLED.
 */
function startMaterialize(filePath, {
  size, platform = process.platform, icloud = false, spawn = childProcess.spawn, statBlocks = null, stallMs = STALL_MS, pollMs = POLL_MS, now = Date.now,
} = {}) {
  const total = Number(size) || 0;
  let state = 'running';
  let code = null;
  let bytesRead = 0;
  let onDisk = 0;
  let lastLoaded = 0;
  let lastMoveAt = now();
  const kids = [];
  let poll = null;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const loaded = () => Math.min(total || Infinity, Math.max(bytesRead, onDisk));
  const snapshot = () => ({ state, loaded: loaded() === Infinity ? 0 : loaded(), total, ...(code ? { code } : {}) });
  const finish = (s, c = null) => {
    if (state !== 'running') return;
    state = s; code = c;
    if (s === 'done') bytesRead = Math.max(bytesRead, total);
    clearInterval(poll);
    for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* gone */ } }
    resolveDone(snapshot());
  };

  const cmds = materializeCommands(filePath, { platform, icloud });
  if (!cmds.length) { finish('failed', 'UNSAFE_NAME'); return { snapshot, cancel: () => {}, done }; }
  let readers = 0;
  let readerDone = 0;
  for (const c of cmds) {
    let child;
    try { child = spawn(c.cmd, c.args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { PATH: '/bin:/usr/bin:/System/Library/CoreServices', LC_ALL: 'C', ...(platform === 'win32' ? process.env : {}) } }); } catch { if (c.role === 'read') finish('failed', 'SPAWN'); continue; }
    kids.push(child);
    let err = '';
    if (child.stderr) child.stderr.on('data', (d) => { if (err.length < 2048) err += String(d); });
    if (c.role === 'read') {
      readers += 1;
      if (child.stdout) child.stdout.on('data', (d) => { bytesRead += d.length; });
      child.on('error', () => finish('failed', 'SPAWN'));
      child.on('close', (exitCode, signal) => {
        readerDone += 1;
        if (state !== 'running') return;
        if (exitCode === 0) return finish('done');
        if (signal) return finish('failed', String(signal));
        finish('failed', /operation not permitted/i.test(err) ? 'EPERM' : /permission denied/i.test(err) ? 'EACCES' : /no such file/i.test(err) ? 'ENOENT' : 'EIO');
      });
    } else {
      // the request half (brctl): it may exit at once or keep going; either way the reader decides. Never wait for it for long.
      child.on('error', () => { /* no brctl: the reader still works */ });
      const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 20000);
      if (t.unref) t.unref();
      child.on('close', () => clearTimeout(t));
    }
  }
  if (readers === 0 && state === 'running') finish('failed', 'SPAWN');

  poll = setInterval(async () => {
    if (state !== 'running') return;
    if (statBlocks) { try { const b = await statBlocks(); if (Number.isFinite(b)) onDisk = Math.max(onDisk, b * 512); } catch { /* keep the last */ } }
    const l = loaded();
    if (l > lastLoaded) { lastLoaded = l; lastMoveAt = now(); }
    else if (now() - lastMoveAt > stallMs) finish('failed', 'DOWNLOAD_STALLED');
  }, pollMs);

  return { snapshot, cancel: () => finish('cancelled'), done };
}

/** A statBlocks() for a real file (blocks * 512 = bytes the file system holds). */
function blocksReader(filePath, fsp = fs.promises) {
  return async () => (await fsp.stat(filePath)).blocks;
}

module.exports = { STALL_MS, cloudState, macStatFlags, windowsAttribOffline, materializeCommands, startMaterialize, blocksReader };
