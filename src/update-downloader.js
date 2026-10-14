// ════════════════════════════════════════════════════════════════
// UpdateDownloader — the DOWNLOAD half of the desktop self-updaters (macOS: src/mac-updater.js, Windows: src/win-updater.js).
//
// Why it exists: a 305 MB update over a bad connection (a VPN that drops) failed at 275 MB, left the half file behind, waited 6 hours for the next
// attempt and — after a restart — deleted the half file and began again from zero. This module makes the download itself robust:
//
//   * HTTP Range resume   the partial file is kept as <name>.part with a small sidecar (pending.json: version, url, expected size and sha512, bytes
//                         durably written, ETag / Last-Modified). A retry sends  Range: bytes=<have>-  + If-Range  to the (re-resolved) URL and follows
//                         GitHub's redirect chain again (the signed objects.githubusercontent.com URL expires, so it is never cached). 206 → append;
//                         200 (no Range support, or the file changed) → start over; 416 with the full size → straight to verification.
//   * survives restarts   cleanupIfStale() in the updaters keeps a pending download for a NEWER version; the engine restores it at start-up and
//                         resumes at once. After a restart only the bytes that were fsynced are trusted (a power cut can leave a file whose length is
//                         ahead of its contents).
//   * retries forever     stall detector (no byte for 45 s → drop the socket and resume), exponential backoff with jitter (15 s, 30 s, 1 m, 2 m, 5 m,
//                         then 10 m), an immediate retry when the network comes back (powerMonitor resume / online), "retry now" on demand. It stops only
//                         when the update is gone from the feed, or the user pauses.
//   * pause / resume      persisted in control.json, so a pause survives a restart. While paused nothing touches the network.
//   * integrity           the whole file's sha512 (base64, from the release feed) is checked before it is renamed to its final name and handed on. A
//                         mismatch deletes the file and starts from zero (3 in a row → "failed-verify", retried much later); a bad file is never staged.
//   * disk space          before starting: (still to download) + 2 × size (the staged .app is ~2× the zip, measured) + a margin. Short → a clear status,
//                         re-checked every minute.
//
// The state machine (phase): idle · checking · downloading · paused · waiting-retry · verifying · staging · ready · failed-verify
//   waiting-retry carries errorCode: network | stall | http | offline | no-space | stage | disk (+ nextRetryAt, lastError)
//
// Everything platform specific (what "ready" means) is the `onDownloaded(file, target)` hook of the caller. Node's http/https/fs only.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const MB = 1024 * 1024;
const REDIRECTS = [301, 302, 303, 307, 308];
const MAX_REDIRECTS = 6;

const DEFAULTS = Object.freeze({
  stallMs: 45 * 1000,                       // no byte for this long → drop the connection and resume
  connectTimeoutMs: 30 * 1000,              // per request hop, until the response headers arrive
  backoffMs: [15e3, 30e3, 60e3, 120e3, 300e3, 600e3],   // consecutive failures without progress; the last value is the cap
  jitter: 0.2,                              // ±20 % on every wait
  progressResetBytes: 64 * 1024,            // an attempt that moved at least this much starts the backoff over
  maxVerifyFailures: 3,                     // sha512 mismatches in a row before "failed-verify"
  failedVerifyRetryMs: 60 * 60 * 1000,
  noSpaceRecheckMs: 60 * 1000,
  stagingFactor: 2,                         // the staged .app is about 2× the archive (measured: 616 MB app / 305 MB zip)
  spaceMarginBytes: 64 * MB,
  syncEveryBytes: 4 * MB,                   // fsync + sidecar update
  progressEveryMs: 250,
  refreshEveryMs: 10 * 60 * 1000,           // while retrying, look at the feed again this often (the release may have been replaced)
  networkUpDebounceMs: 1500,
  userAgent: 'TexaCore-Updater',
});

// ─── errors ───
class AbortedError extends Error { constructor(why) { super(`aborted: ${why}`); this.name = 'AbortedError'; this.code = 'EUPDABORT'; this.why = why; } }
class StallError extends Error { constructor(ms) { super(`no data for ${Math.round(ms / 1000)} s`); this.name = 'StallError'; this.code = 'ESTALL'; } }
class HttpStatusError extends Error { constructor(status) { super(`HTTP ${status}`); this.name = 'HttpStatusError'; this.code = 'EHTTP'; this.status = status; } }
class NoSpaceError extends Error { constructor(need, free) { super('not enough free disk space'); this.name = 'NoSpaceError'; this.code = 'ENOSPACE'; this.need = need; this.free = free; } }
class VerifyError extends Error { constructor(actual, expected) { super(`sha512 mismatch (expected ${String(expected).slice(0, 12)}…, got ${String(actual).slice(0, 12)}…)`); this.name = 'VerifyError'; this.code = 'EVERIFY'; } }
class StageError extends Error { constructor(cause) { super(`staging failed: ${cause && cause.message}`); this.name = 'StageError'; this.code = 'ESTAGE'; this.cause = cause; } }
class RestartError extends Error { constructor(why) { super(why); this.name = 'RestartError'; this.code = 'ERESTART'; } }
class NetworkChangeError extends Error { constructor(why) { super(`network change (${why})`); this.name = 'NetworkChangeError'; this.code = 'ENETCHANGE'; } }

// ─── small helpers ───
function sizeOf(file) { try { return fs.statSync(file).size; } catch { return 0; } }
function safeUnlink(file) { try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } }
function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }

/** sha512 (base64) of a file, streaming. */
function sha512OfFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(file, { highWaterMark: 1024 * 1024 })
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('base64')))
      .on('error', reject);
  });
}

/** Free bytes on the volume holding `dir` (nearest existing ancestor); null when it can not be told. */
function freeBytesFor(dir) {
  let d = dir;
  for (let i = 0; i < 12 && d && !fs.existsSync(d); i++) d = path.dirname(d);
  try { const s = fs.statfsSync(d); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

/** The sidecar (pending.json) if it is well-formed, else null. fileName must be a plain name: nothing in it may point outside the folder. */
function readSidecar(dir) {
  const s = readJson(path.join(dir, 'pending.json'));
  if (!s || s.schema !== 1) return null;
  const ok = typeof s.version === 'string' && s.version
    && typeof s.fileName === 'string' && s.fileName && path.basename(s.fileName) === s.fileName && !/[\\/\0]/.test(s.fileName) && s.fileName !== '.' && s.fileName !== '..'
    && typeof s.url === 'string' && s.url
    && Number.isFinite(s.expectedSize) && s.expectedSize > 0
    && typeof s.expectedSha512 === 'string' && s.expectedSha512
    && Number.isFinite(s.bytes) && s.bytes >= 0;
  return ok ? s : null;
}

/**
 * GET with redirects, returning the final response (any status: the caller decides). Headers (Range, If-Range) are re-sent on every hop.
 * Aborts through `signal`; the headers must arrive within connectTimeoutMs per hop. https only (http is for a local test server).
 */
function fetchResponse(startUrl, { headers, signal, connectTimeoutMs = DEFAULTS.connectTimeoutMs, allowInsecureHttp = false }) {
  return new Promise((resolve, reject) => {
    const chain = [startUrl];
    let hops = 0; let req = null; let timer = null; let settled = false;
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); };
    const fail = (e) => { if (settled) return; settled = true; cleanup(); try { if (req) req.destroy(); } catch { /* gone */ } reject(e); };
    const onAbort = () => fail(signal.reason instanceof Error ? signal.reason : new AbortedError('signal'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    const go = (u) => {
      let url;
      try { url = new URL(u); } catch (e) { return fail(e); }
      const mod = url.protocol === 'https:' ? https : (url.protocol === 'http:' && allowInsecureHttp ? http : null);
      if (!mod) return fail(new Error(`refusing a non-https update URL (${url.protocol})`));
      clearTimeout(timer);
      timer = setTimeout(() => fail(new Error(`no response from ${url.hostname} within ${Math.round(connectTimeoutMs / 1000)} s`)), connectTimeoutMs);
      req = mod.request(url, { method: 'GET', headers, agent: false }, (res) => {
        clearTimeout(timer);
        if (REDIRECTS.includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (++hops > MAX_REDIRECTS) return fail(new Error('Too many redirects'));
          let next; try { next = new URL(res.headers.location, url).toString(); } catch (e) { return fail(e); }
          chain.push(next);
          return go(next);
        }
        if (settled) { res.destroy(); return; }
        settled = true; signal.removeEventListener('abort', onAbort);
        res.on('error', () => {});   // the stream's consumer sees the error; this only keeps one that arrives before it starts reading from being thrown
        resolve({ res, chain, finalUrl: url.toString() });
      });
      req.on('error', fail);
      req.end();
    };
    go(startUrl);
  });
}

const sameTarget = (a, b) => !!a && !!b && a.version === b.version && a.sha512 === b.sha512 && a.size === b.size && a.fileName === b.fileName;

/** Turn a failure into what the user is told and how long to wait. */
function classify(err, online) {
  const code = err && err.code;
  if (code === 'ENOSPACE') return { errorCode: 'no-space', kind: 'space' };
  if (code === 'EVERIFY') return { errorCode: 'verify', kind: 'verify' };
  if (code === 'ESTAGE') return { errorCode: 'stage', kind: 'backoff' };
  if (code === 'ENETCHANGE') return { errorCode: 'network', kind: 'immediate' };
  if (code === 'ERESTART') return { errorCode: 'network', kind: 'immediate' };
  if (code === 'ESTALL') return { errorCode: 'stall', kind: 'backoff' };
  if (code === 'EHTTP') return { errorCode: 'http', kind: 'backoff' };
  if (code === 'ENOSPC') return { errorCode: 'no-space', kind: 'space' };
  if (['EACCES', 'EPERM', 'EROFS', 'EISDIR', 'EMFILE', 'EIO'].includes(code)) return { errorCode: 'disk', kind: 'backoff' };
  return { errorCode: online === false ? 'offline' : 'network', kind: 'backoff' };
}

class UpdateDownloader {
  /**
   * @param {object} opts
   * @param {string} opts.dir                  the pending folder (partial file + pending.json)
   * @param {string} [opts.controlFile]        where the pause flag lives (default: <dir>/../control.json)
   * @param {(...a:any[])=>void} [opts.log]
   * @param {(snapshot:object)=>void} [opts.onStatus]
   * @param {(file:string, target:object)=>Promise<void>} opts.onDownloaded   called with the verified file; throw to retry later
   * @param {()=>Promise<object|null|undefined>} [opts.refreshTarget]   re-read the feed: a target, null (no update any more) or undefined (could not tell)
   * @param {()=>boolean} [opts.isOnline]
   * @param {(dir:string)=>number|null} [opts.freeBytes]
   * @param {boolean} [opts.allowInsecureHttp]  tests only
   * …plus any key of DEFAULTS
   */
  constructor(opts) {
    if (!opts || !opts.dir) throw new Error('UpdateDownloader: dir is required');
    this.o = { ...DEFAULTS, log: () => {}, onStatus: () => {}, onDownloaded: async () => {}, refreshTarget: null, isOnline: () => true, freeBytes: freeBytesFor,
      allowInsecureHttp: false, random: Math.random, ...opts };
    this.dir = opts.dir;
    this.sidecarFile = path.join(this.dir, 'pending.json');
    this.controlFile = opts.controlFile || path.join(path.dirname(this.dir), 'control.json');
    this._target = null;
    this._side = null;
    this._phase = 'idle';
    this._paused = !!(readJson(this.controlFile) || {}).paused;
    this._gen = 0;
    this._loopActive = false;
    this._loopPromise = null;
    this._abort = null;
    this._wake = null;
    this._timer = null;
    this._nextRetryAt = null;
    this._retryIdx = 0;
    this._immediateRun = 0;
    this._verifyFailures = 0;
    this._cold = true;                // the first request after construction (= process start) trusts only fsynced bytes
    this._stopped = false;
    this._bytesDone = 0;
    this._samples = [];
    this._attemptBytes = 0;
    this._attemptNo = 0;
    this._resumedFrom = 0;
    this._lastError = null;
    this._errorCode = null;
    this._need = null; this._free = null;
    this._lastEmit = 0;
    this._lastNetUp = 0;
    this._lastRefresh = Date.now();
  }

  log(...a) { try { this.o.log(...a); } catch { /* noop */ } }

  // ─── status ───
  getTarget() { return this._target ? { ...this._target } : null; }
  /** Is `t` the target already set? (same version, size, sha512, file) */
  isTarget(t) { return sameTarget(this._target, { ...t, fileName: path.basename(t.fileName || decodeURIComponent(new URL(t.url).pathname)) }); }
  isPaused() { return this._paused; }
  phase() { return this._phase; }

  getStatus() {
    const t = this._target; const now = Date.now();
    const total = t ? t.size : 0;
    const done = Math.min(this._bytesDone, total || this._bytesDone);
    const speed = this._speed();
    return {
      phase: this._phase,
      version: t ? t.version : null,
      paused: this._paused,
      bytesDone: done,
      bytesTotal: total,
      percent: total ? Math.max(0, Math.min(100, Math.floor((done / total) * 100))) : 0,
      speedBps: Math.round(speed),
      etaSec: speed > 1 && total ? Math.max(0, Math.round((total - done) / speed)) : null,
      attempt: this._attemptNo,
      resumedFrom: this._resumedFrom,
      nextRetryAt: this._nextRetryAt,
      nextRetryInSec: this._nextRetryAt ? Math.max(0, Math.ceil((this._nextRetryAt - now) / 1000)) : null,
      lastError: this._lastError,
      errorCode: this._errorCode,
      needBytes: this._need,
      freeBytes: this._free,
      verifyFailures: this._verifyFailures,
      online: this._online(),
    };
  }

  _online() { try { return this.o.isOnline() !== false; } catch { return true; } }

  _emit(force = false) {
    const now = Date.now();
    if (!force && now - this._lastEmit < this.o.progressEveryMs) return;
    this._lastEmit = now;
    try { this.o.onStatus(this.getStatus()); } catch (e) { this.log('onStatus handler threw:', e && e.message); }
  }

  _setPhase(p, force = true) { if (this._phase !== p) { this._phase = p; } this._emit(force); }

  _sample(pos) {
    const now = Date.now();
    this._samples.push([now, pos]);
    while (this._samples.length > 2 && now - this._samples[0][0] > 8000) this._samples.shift();
  }
  _speed() {
    if (this._phase !== 'downloading' || this._samples.length < 2) return 0;
    const a = this._samples[0]; const b = this._samples[this._samples.length - 1];
    const dt = (b[0] - a[0]) / 1000;
    return dt > 0.2 ? (b[1] - a[1]) / dt : 0;
  }

  // ─── control ───
  /** The wanted download: { version, url, fileName, sha512, size }. A different target replaces the current one (its partial is dropped on the next cycle). */
  setTarget(t) {
    if (!t || !t.version || !t.url || !t.sha512 || !(t.size > 0)) throw new Error('UpdateDownloader.setTarget: version, url, sha512 and size are required');
    const target = { version: String(t.version), url: String(t.url), sha512: String(t.sha512), size: Number(t.size), fileName: path.basename(t.fileName || decodeURIComponent(new URL(t.url).pathname)) };
    if (sameTarget(this._target, target)) { this._target.url = target.url; return { changed: false }; }
    this.log(`target: v${target.version} ${target.fileName} (${(target.size / MB).toFixed(0)} MB)`);
    this._invalidate('new target');
    this._target = target;
    this._side = null;
    this._verifyFailures = 0; this._retryIdx = 0; this._bytesDone = 0; this._samples = [];
    this._lastError = null; this._errorCode = null; this._need = this._free = null; this._nextRetryAt = null;
    this._setPhase(this._paused ? 'paused' : 'downloading');
    this.kick();
    return { changed: true };
  }

  /** No update any more (the feed moved on): stop and drop the partial. */
  clearTarget() {
    if (!this._target && this._phase === 'idle') return;
    this._invalidate('target cleared');
    this._target = null; this._side = null;
    this._bytesDone = 0; this._samples = []; this._nextRetryAt = null; this._lastError = null; this._errorCode = null;
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch { /* best effort */ }
    this._setPhase(this._paused ? 'paused' : 'idle');
  }

  /** Restore a download left by a previous run (the sidecar names the target); resumes at once unless paused (or {kick:false}: the caller starts it after
   *  checking the feed, which may have moved on). Returns the target or null. */
  restore(opts = {}) {
    const side = readSidecar(this.dir);
    if (!side) return null;
    this._side = side;
    this._verifyFailures = side.verifyFailures || 0;
    this._bytesDone = Math.min(sizeOf(path.join(this.dir, `${side.fileName}.part`)), side.bytes);
    this._target = { version: side.version, url: side.url, sha512: side.expectedSha512, size: side.expectedSize, fileName: side.fileName };
    this.log(`restored a pending download: v${side.version}, ${(this._bytesDone / MB).toFixed(1)} of ${(side.expectedSize / MB).toFixed(0)} MB on disk`);
    this._setPhase(this._paused ? 'paused' : 'downloading');
    if (opts.kick !== false) this.kick();
    return this.getTarget();
  }

  markChecking(on) {
    if (on && this._phase === 'idle') this._setPhase('checking');
    else if (!on && this._phase === 'checking') this._setPhase('idle');
  }

  pause() {
    if (this._paused) return false;
    this._paused = true;
    try { writeJsonAtomic(this.controlFile, { paused: true, at: new Date().toISOString() }); } catch (e) { this.log('could not persist the pause:', e.message); }
    this.log('paused by the user');
    this._invalidate('paused');
    if (this._target && !readSidecar(this.dir)) { try { this._prepare(this._target); } catch { /* the sidecar is written by the next cycle */ } }   // a pause must survive a restart
    this._nextRetryAt = null;
    this._setPhase('paused');
    return true;
  }

  resume() {
    if (!this._paused) return false;
    this._paused = false;
    safeUnlink(this.controlFile);
    this.log('resumed by the user');
    this._retryIdx = 0;
    this._lastError = null; this._errorCode = null;
    if (this._target) { this._setPhase('downloading'); this.kick(); } else this._setPhase('idle');
    return true;
  }

  /** Forget a stale pause flag (the download it was about). */
  clearPause() { if (this._paused) { this._paused = false; safeUnlink(this.controlFile); if (this._phase === 'paused') this._setPhase(this._target ? 'downloading' : 'idle'); } }

  /** «Retry now»: skip the wait, forget the backoff (and a verify-failure lockout). */
  retryNow() {
    if (!this._target) return false;
    if (this._paused) return this.resume();
    this.log('retry requested by the user');
    this._retryIdx = 0; this._verifyFailures = 0;
    if (this._loopActive) this._wakeNow(); else this.kick();
    return true;
  }

  /** The network is back (online event, wake from sleep): retry at once. `resume` also drops a possibly dead connection of a running download. */
  networkUp(reason = 'online') {
    const now = Date.now();
    if (now - this._lastNetUp < this.o.networkUpDebounceMs) return;
    this._lastNetUp = now;
    if (!this._target || this._paused) return;
    if (this._phase === 'waiting-retry' && ['network', 'stall', 'http', 'offline', 'disk'].includes(this._errorCode)) {
      this.log(`network up (${reason}) — retrying now`);
      this._retryIdx = 0; this._wakeNow();
    } else if (this._phase === 'downloading' && reason === 'resume' && this._abort) {
      this.log('woke from sleep — dropping the old connection and resuming');
      try { this._abort.abort(new NetworkChangeError(reason)); } catch { /* gone */ }
    } else if (!this._loopActive && this._phase !== 'ready' && this._phase !== 'failed-verify' && this._phase !== 'staging') {
      this.kick();
    }
  }

  /** App quitting: abort, flush what was written, keep every file. */
  async stop() {
    this._stopped = true;
    this._invalidate('stopped');
    // wait for the flush of what was written — but never hold the quit for long (a staging in progress is left; the next start cleans a half-extracted folder)
    let to = null;
    try { if (this._loopPromise) await Promise.race([this._loopPromise, new Promise((r) => { to = setTimeout(r, 3000); })]); } catch { /* already reported */ } finally { clearTimeout(to); }
  }

  // ─── the loop ───
  kick() {
    if (this._stopped || this._paused || !this._target || this._phase === 'ready') return;
    if (this._loopActive) { this._wakeNow(); return; }
    const gen = ++this._gen;
    const prev = this._loopPromise;
    this._loopActive = true;
    this._loopPromise = (async () => {
      try {
        if (prev) { try { await prev; } catch { /* reported there */ } }
        if (gen === this._gen) await this._loop(gen);
      } catch (e) {
        this.log('update loop crashed:', e && e.stack || e);
      } finally {
        if (gen === this._gen) this._loopActive = false;
      }
    })();
  }

  /** Start the loop if it is not running (does NOT cut a wait short: the scheduled feed check uses this). */
  ensureRunning() { if (!this._loopActive) this.kick(); }

  _invalidate(why) {
    this._gen++;
    this._loopActive = false;
    if (this._abort) { try { this._abort.abort(new AbortedError(why)); } catch { /* gone */ } }
    this._wakeNow();
  }

  _wakeNow() { if (this._wake) this._wake(); }

  _sleep(ms) {
    return new Promise((resolve) => {
      this._nextRetryAt = Date.now() + ms;
      const done = () => { clearTimeout(this._timer); this._timer = null; this._wake = null; this._nextRetryAt = null; resolve(); };
      this._timer = setTimeout(done, ms);
      this._wake = done;
    });
  }

  _jitter(ms) { const j = this.o.jitter; return Math.max(0, Math.round(ms * (1 - j + 2 * j * this.o.random()))); }

  _nextBackoff(madeProgress) {
    if (madeProgress) this._retryIdx = 0;
    const table = this.o.backoffMs;
    const ms = table[Math.min(this._retryIdx, table.length - 1)];
    this._retryIdx++;
    return this._jitter(ms);
  }

  async _loop(gen) {
    const alive = () => gen === this._gen && !this._paused && !!this._target && !this._stopped;
    let forceRefresh = false;
    while (alive()) {
      try {
        await this._cycle(gen);
        return;                                           // ready
      } catch (err) {
        if (!alive()) return;                              // paused / superseded / quitting: leave quietly
        if (err && err.refresh) forceRefresh = true;
        const info = classify(err, this._online());
        const madeProgress = this._attemptBytes >= this.o.progressResetBytes;
        this._lastError = err && err.message ? String(err.message) : String(err);
        this._errorCode = info.errorCode;
        this._need = this._free = null;
        let wait; let phase = 'waiting-retry';
        if (info.kind === 'space') { this._need = err.need || null; this._free = err.free || null; wait = this.o.noSpaceRecheckMs; }
        else if (info.kind === 'verify') {
          forceRefresh = true;                             // a replaced release explains a mismatch: look at the feed before trying again
          if (this._verifyFailures >= this.o.maxVerifyFailures) { phase = 'failed-verify'; wait = this.o.failedVerifyRetryMs; }
          else wait = this._nextBackoff(false);
        } else if (info.kind === 'immediate') { wait = ++this._immediateRun <= 3 ? 500 : this._nextBackoff(false); }   // a server that keeps answering "start over" gets the normal backoff
        else wait = this._nextBackoff(madeProgress);
        if (info.kind !== 'immediate') this._immediateRun = 0;
        this.log(`attempt ${this._attemptNo} failed: ${this._lastError} [${info.errorCode}] — ${phase === 'failed-verify' ? 'giving the file up for now; ' : ''}next try in ${(wait / 1000).toFixed(wait < 10000 ? 1 : 0)} s`);
        this._phase = phase;
        // the wait itself publishes nextRetryAt through the snapshot
        const sleeping = this._sleep(wait);
        this._emit(true);
        await sleeping;
        if (!alive()) return;
        if (phase === 'failed-verify') { this._verifyFailures = 0; }
        this._setPhase('downloading');                     // the wait is over: "connecting" while the feed is looked at and the request goes out
        await this._maybeRefresh(forceRefresh); forceRefresh = false;
        if (!alive()) return;
      }
    }
  }

  async _maybeRefresh(force) {
    if (!this.o.refreshTarget) return;
    const now = Date.now();
    if (!force && now - this._lastRefresh < this.o.refreshEveryMs) return;
    this._lastRefresh = now;
    let r;
    let to = null;
    try { r = await Promise.race([this.o.refreshTarget(), new Promise((res) => { to = setTimeout(() => res(undefined), 20000); })]); } catch { r = undefined; } finally { clearTimeout(to); }
    if (r === undefined) return;                           // the feed could not be read: keep going with what we know
    if (r === null) { this.log('the feed has no newer update any more — dropping the download'); this.clearTarget(); return; }
    if (!sameTarget(this._target, { ...r, fileName: path.basename(r.fileName || decodeURIComponent(new URL(r.url).pathname)) })) this.setTarget(r);
  }

  /** Is there enough room? (still to download) + stagingFactor × size + margin. */
  _ensureSpace(t, have) {
    const need = Math.max(0, t.size - have) + this.o.stagingFactor * t.size + this.o.spaceMarginBytes;
    let free = null;
    try { free = this.o.freeBytes(this.dir); } catch { free = null; }
    if (free != null && free < need) throw new NoSpaceError(need, free);
  }

  _prepare(t) {
    fs.mkdirSync(this.dir, { recursive: true });
    let side = readSidecar(this.dir);
    const fresh = !side || side.version !== t.version || side.fileName !== t.fileName || side.expectedSha512 !== t.sha512 || side.expectedSize !== t.size;
    if (fresh) {
      if (side) this.log(`pending download is for another file (v${side.version}) — dropping it`);
      try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch { /* best effort */ }
      fs.mkdirSync(this.dir, { recursive: true });
      side = { schema: 1, version: t.version, fileName: t.fileName, url: t.url, pinnedUrl: null, expectedSize: t.size, expectedSha512: t.sha512,
        etag: null, lastModified: null, bytes: 0, verifyFailures: this._verifyFailures, startedAt: new Date().toISOString() };
      this._cold = false;
    }
    side.url = t.url;
    side.verifyFailures = this._verifyFailures;
    this._side = side;
    this._saveSide(side);
    return side;
  }

  /** Write pending.json for `side`; a side that has been superseded by a newer target (or dropped) never overwrites the current one. */
  _saveSide(side) {
    if (!side || side !== this._side) return;
    side.updatedAt = new Date().toISOString();
    try { writeJsonAtomic(this.sidecarFile, side); } catch (e) { this.log('could not write pending.json:', e.message); }
  }

  /** One pass: make sure the whole file is on disk, verify it, hand it on. Throws on any failure (the loop decides what to do). */
  async _cycle(gen) {
    const t = this._target;
    const side = this._prepare(t);
    const finalPath = path.join(this.dir, t.fileName);
    const partPath = `${finalPath}.part`;
    this._attemptNo++;
    this._attemptBytes = 0;
    this._lastError = null; this._errorCode = null; this._need = this._free = null;
    const stillThere = () => { if (gen !== this._gen || this._paused || this._stopped) throw new AbortedError('superseded'); };

    let file = null;
    const finalSize = sizeOf(finalPath);
    if (finalSize === t.size) { file = finalPath; this._bytesDone = t.size; }
    else if (finalSize) safeUnlink(finalPath);
    if (!file) {
      const have = Math.min(sizeOf(partPath), t.size);
      this._ensureSpace(t, have);
      await this._download(gen, t, side, partPath);
      file = partPath;
    } else {
      this._ensureSpace(t, t.size);
    }
    stillThere();

    this._setPhase('verifying');
    const actual = await sha512OfFile(file);
    stillThere();
    if (actual !== t.sha512) {
      safeUnlink(partPath); safeUnlink(finalPath);
      this._verifyFailures++;
      side.bytes = 0; side.etag = null; side.lastModified = null; side.pinnedUrl = null; side.verifyFailures = this._verifyFailures;
      this._bytesDone = 0;
      this._saveSide(side);
      throw new VerifyError(actual, t.sha512);
    }
    this.log('sha512 verified');
    if (file === partPath) { fs.renameSync(partPath, finalPath); file = finalPath; }
    this._verifyFailures = 0; side.verifyFailures = 0; this._saveSide(side);

    this._setPhase('staging');
    try { await this.o.onDownloaded(file, { ...t }); } catch (e) { stillThere(); throw new StageError(e); }
    stillThere();
    this._retryIdx = 0; this._immediateRun = 0; this._lastError = null; this._errorCode = null;
    this._setPhase('ready');
  }

  /** Fetch the rest of the file into `partPath` (Range resume). Returns when `t.size` bytes are on disk. */
  async _download(gen, t, side, partPath) {
    let have = Math.min(sizeOf(partPath), Number.MAX_SAFE_INTEGER);
    if (have > t.size) { safeUnlink(partPath); have = 0; }
    if (this._cold) {                                     // after a restart: only what was fsynced counts
      this._cold = false;
      if (have > side.bytes) { this.log(`restart: trusting ${side.bytes} of the ${have} bytes on disk (the rest was never synced)`); fs.truncateSync(partPath, side.bytes); have = side.bytes; }
    }
    if (have === t.size) { this._bytesDone = have; return; }

    const headers = { 'User-Agent': this.o.userAgent, Accept: '*/*', 'Accept-Encoding': 'identity' };
    if (have > 0) {
      headers.Range = `bytes=${have}-`;
      const validator = (side.etag && !/^W\//.test(side.etag) && side.etag) || side.lastModified;
      if (validator) headers['If-Range'] = validator;
    }
    const ac = new AbortController();
    this._abort = ac;
    this._bytesDone = have; this._resumedFrom = have;
    this._samples = []; this._sample(have);
    this._setPhase('downloading');
    this.log(`${have > 0 ? `resuming at ${have} (${(have / MB).toFixed(1)} MB)` : 'starting'}: ${side.pinnedUrl || side.url}`);

    let got;
    try {
      try {
        got = await fetchResponse(side.pinnedUrl || side.url, { headers, signal: ac.signal, connectTimeoutMs: this.o.connectTimeoutMs, allowInsecureHttp: this.o.allowInsecureHttp });
      } catch (e) {
        if (side.pinnedUrl && e && e.code !== 'EUPDABORT') { side.pinnedUrl = null; this._saveSide(side); }   // the tagged URL may be gone: fall back to the feed URL next time
        throw e;
      }
      const { res, chain } = got;
      const status = res.statusCode;
      let startAt = have;
      if (status === 206) {
        const m = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(String(res.headers['content-range'] || ''));
        const etag = res.headers.etag;
        if (!m || Number(m[1]) !== have || (m[3] !== '*' && Number(m[3]) !== t.size) || (side.etag && etag && etag !== side.etag)) {
          res.destroy(); safeUnlink(partPath); side.bytes = 0; side.etag = null; side.lastModified = null; this._saveSide(side); this._bytesDone = 0;
          throw new RestartError(`the server's range answer does not match (${res.headers['content-range'] || 'no Content-Range'}) — starting over`);
        }
      } else if (status === 200) {
        const len = Number(res.headers['content-length']) || 0;
        if (len && len !== t.size) { res.destroy(); throw new RestartError(`the server's file is ${len} bytes but the feed says ${t.size}`); }
        if (have > 0 && side.etag && res.headers.etag && res.headers.etag !== side.etag) {
          res.destroy(); safeUnlink(partPath); side.bytes = 0; side.etag = null; side.lastModified = null; side.pinnedUrl = null; this._saveSide(side); this._bytesDone = 0;
          const err = new RestartError('the file on the server is not the one we were downloading (its ETag changed) — asking the feed again');
          err.refresh = true;
          throw err;
        }
        if (have > 0) { this.log('the server sent the whole file (no Range support, or the file changed) — starting over'); }
        startAt = 0; this._bytesDone = 0; this._resumedFrom = 0;
        safeUnlink(partPath); side.bytes = 0;
      } else if (status === 416) {
        res.resume();
        const m = /\/(\d+)$/.exec(String(res.headers['content-range'] || ''));
        if (have === t.size && (!m || Number(m[1]) === t.size)) { this.log('416: the file is already complete'); return; }
        safeUnlink(partPath); side.bytes = 0; side.etag = null; side.lastModified = null; this._saveSide(side); this._bytesDone = 0;
        throw new RestartError('416 Range Not Satisfiable — starting over');
      } else {
        res.resume();
        throw new HttpStatusError(status);
      }
      if (res.headers['content-encoding'] && !/^identity$/i.test(res.headers['content-encoding'])) { res.destroy(); throw new Error(`unexpected Content-Encoding: ${res.headers['content-encoding']}`); }

      // remember what identifies this file, and the tagged GitHub URL (a later "latest" release must not change what a resume continues)
      if (res.headers.etag) side.etag = res.headers.etag;
      if (res.headers['last-modified']) side.lastModified = res.headers['last-modified'];
      if (!side.pinnedUrl && chain.length > 1) {
        const orig = new URL(chain[0]);
        const tagged = chain.slice(1).find((u) => { try { const x = new URL(u); return x.hostname === orig.hostname && /\/releases\/download\//.test(x.pathname); } catch { return false; } });
        if (tagged) side.pinnedUrl = tagged;
      }
      this._saveSide(side);

      // stream into the file
      const flags = startAt > 0 ? 'r+' : 'w';
      let fh;
      try { fh = await fs.promises.open(partPath, flags); } catch (e) { res.destroy(); throw e; }
      let pos = startAt; let sinceSync = 0; let stall = null;
      const arm = () => { clearTimeout(stall); stall = setTimeout(() => { try { res.destroy(new StallError(this.o.stallMs)); } catch { /* gone */ } }, this.o.stallMs); };
      const onAbort = () => { try { res.destroy(ac.signal.reason instanceof Error ? ac.signal.reason : new AbortedError('signal')); } catch { /* gone */ } };
      ac.signal.addEventListener('abort', onAbort, { once: true });
      if (ac.signal.aborted) onAbort();
      arm();
      try {
        for await (const chunk of res) {
          let off = 0;
          while (off < chunk.length) { const { bytesWritten } = await fh.write(chunk, off, chunk.length - off, pos + off); off += bytesWritten; }
          pos += chunk.length; sinceSync += chunk.length;
          this._bytesDone = pos; this._attemptBytes = pos - startAt;
          this._sample(pos);
          arm();
          if (sinceSync >= this.o.syncEveryBytes) { await fh.sync(); side.bytes = pos; this._saveSide(side); sinceSync = 0; }
          this._emit(false);
        }
      } finally {
        clearTimeout(stall);
        ac.signal.removeEventListener('abort', onAbort);
        try { await fh.sync(); } catch { /* best effort */ }
        try { await fh.close(); } catch { /* best effort */ }
        side.bytes = pos; this._saveSide(side);
        if (side === this._side) this._bytesDone = pos;
      }
      if (pos < t.size) throw new Error(`connection closed early at ${pos} of ${t.size} bytes`);
      if (pos > t.size) { safeUnlink(partPath); side.bytes = 0; this._saveSide(side); this._bytesDone = 0; throw new RestartError(`received ${pos} bytes but the feed says ${t.size}`); }
      this._emit(true);
    } finally {
      if (this._abort === ac) this._abort = null;
    }
  }
}

module.exports = {
  UpdateDownloader,
  DEFAULTS,
  sha512OfFile,
  freeBytesFor,
  readSidecar,
  fetchResponse,
  classify,
  errors: { AbortedError, StallError, HttpStatusError, NoSpaceError, VerifyError, StageError, RestartError, NetworkChangeError },
};
