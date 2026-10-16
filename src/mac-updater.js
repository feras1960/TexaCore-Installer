// ════════════════════════════════════════════════════════════════
// 🍎 TexaCore Mac Updater — self-managed OTA for ad-hoc-signed builds
// ════════════════════════════════════════════════════════════════
// Squirrel.Mac (electron-updater's mac backend) refuses to apply updates to
// apps that are not Developer-ID signed, so this module implements the whole
// flow ourselves:
//   1. Fetch latest-mac.yml from the GitHub "latest" release.
//   2. Semver-compare with the running version.
//   3. Silently download the asset (prefer .zip, else .dmg) — RESUMABLE (HTTP Range), self-retrying forever with backoff, pausable
//      (src/update-downloader.js: a drop at 275 of 305 MB is picked up where it stopped, also after a restart).
//   4. Verify sha512 (base64) — reject and delete on mismatch, then download again; a bad file is never staged.
//   5. Stage the new "TexaCore ERP.app" (ditto -xk for zip / hdiutil for dmg).
//   6. On quit, spawn a detached shell script that waits for our PID to exit,
//      replaces the current bundle, keeps its signature when it is a valid non-ad-hoc one (2.0.4) or signs it ad-hoc
//      (every older build), clears quarantine, and relaunches the app.
//      NOTE: the script is written by the app that is RUNNING at quit time, so an update from a version before 2.0.4 is always finished by the OLD
//      script (which signs ad-hoc whatever the new bundle carries); a stable signature takes effect from a fresh 2.0.4 install and for updates after it.
// Windows uses electron-updater (src/win-updater.js adds the same resumable download in front of it).

const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { spawn, execFile } = require('child_process');
const { UpdateDownloader, sha512OfFile, readSidecar } = require('./update-downloader');

const FEED_URL = 'https://github.com/feras1960/TexaCore-Installer/releases/latest/download/latest-mac.yml';
const ASSET_BASE = 'https://github.com/feras1960/TexaCore-Installer/releases/latest/download/';
const MAX_REDIRECTS = 6;
const CHECK_INITIAL_DELAY_MS = 15 * 1000;      // ~15s after launch
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;  // every 6 hours (mirror Windows) — discovering NEW versions only; download retries have their own backoff

// ─── Small helpers ───────────────────────────────────────────

/** Follow-redirect GET returning the final response stream (the small feed file; the big download is src/update-downloader.js). */
function httpsGet(url, redirects = 0, allowHttp = false) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) return reject(new Error('Too many redirects'));
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : (u.protocol === 'http:' && allowHttp ? http : null);
    if (!mod) return reject(new Error(`refusing a non-https feed URL (${u.protocol})`));
    const req = mod.get(url, {
      headers: { 'User-Agent': 'TexaCore-Updater', Accept: '*/*' },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(httpsGet(next, redirects + 1, allowHttp));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Request timeout')));
  });
}

async function fetchText(url, allowHttp = false) {
  const res = await httpsGet(url, 0, allowHttp);
  return new Promise((resolve, reject) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { data += c; });
    res.on('end', () => resolve(data));
    res.on('error', reject);
  });
}

/** Parse latest-mac.yml → { version, files: [{url, sha512, size}] }. */
function parseFeed(text) {
  try {
    // js-yaml ships with electron-updater and node_modules is packaged whole.
    const yaml = require('js-yaml');
    const doc = yaml.load(text);
    if (doc && doc.version && Array.isArray(doc.files)) return doc;
  } catch { /* fall through to the minimal parser */ }
  // Minimal fallback parser for the well-known electron-builder yml shape.
  const version = (text.match(/^version:\s*(\S+)/m) || [])[1];
  const files = [];
  const re = /-\s*url:\s*(\S+)[\s\S]*?sha512:\s*(\S+)[\s\S]*?size:\s*(\d+)/g;
  let m;
  while ((m = re.exec(text))) files.push({ url: m[1], sha512: m[2], size: Number(m[3]) });
  if (!version) throw new Error('Cannot parse latest-mac.yml');
  return { version, files };
}

/** Simple semver compare: 1 if a>b, -1 if a<b, 0 if equal. */
function cmpVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** Pick the asset to download: prefer .zip, else .dmg. */
function chooseAsset(files) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const pool = files.filter((f) => !/blockmap/i.test(f.url));
  const byExt = (ext) =>
    pool.find((f) => f.url.endsWith(ext) && f.url.includes(arch)) ||
    pool.find((f) => f.url.endsWith(ext));
  return byExt('.zip') || byExt('.dmg') || null;
}

function execFileP(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(`${cmd} failed: ${stderr || err.message}`)) : resolve(stdout));
  });
}

/** Walk up from process.execPath to the real .app bundle root. */
function currentAppBundlePath() {
  let p = process.execPath;
  while (p && p !== '/' && !p.endsWith('.app')) p = path.dirname(p);
  return p && p.endsWith('.app') ? p : null;
}

// ─── The updater ─────────────────────────────────────────────

class MacUpdater {
  /**
   * @param {object} opts
   * @param {() => string} opts.getVersion       app.getVersion
   * @param {string} opts.userDataPath           app.getPath('userData')
   * @param {boolean} opts.isPackaged            app.isPackaged
   * @param {(...a: any[]) => void} opts.log     fileLog
   * @param {(channel: string, payload?: any) => void} opts.emit  send to renderer ('update-status' carries the full download status)
   * @param {(version: string) => void} opts.onStaged  called once an update is staged
   * Optional (tests, harness): feedUrl, assetBase, allowInsecureHttp, isOnline, freeBytes, stage(archivePath) → .app path,
   *   engine (overrides for the download engine: stallMs, backoffMs, jitter …), checkInitialDelayMs, checkIntervalMs
   */
  constructor(opts) {
    this.opts = opts;
    this.feedUrl = opts.feedUrl || FEED_URL;
    this.assetBase = opts.assetBase || ASSET_BASE;
    this.allowHttp = !!opts.allowInsecureHttp;
    this.updatesDir = path.join(opts.userDataPath, 'updates');
    this.pendingDir = path.join(this.updatesDir, 'pending');
    this.stagedDir = path.join(this.updatesDir, 'staged');
    this.stateFile = path.join(this.updatesDir, 'staged.json');
    this.controlFile = path.join(this.updatesDir, 'control.json');     // the pause flag; survives cleanups and restarts
    this.installLog = path.join(opts.userDataPath, 'logs', 'mac-update-install.log');
    this._checking = false;
    this._pendingInfo = null;   // {version, asset} discovered by last check
    this._installerSpawned = false;
    this._timers = [];
    this.dl = new UpdateDownloader({
      dir: this.pendingDir,
      controlFile: this.controlFile,
      log: (...a) => this.log(...a),
      onStatus: (snap) => {
        // a staged ("ready") update is not the engine's business: its idle / checking snapshots must not hide the ready banner
        if ((snap.phase === 'idle' || snap.phase === 'checking') && this.hasStagedUpdate()) return;
        try { this.opts.emit('update-status', snap); } catch { /* the window may be gone */ }
      },
      onDownloaded: (file, target) => this._onDownloaded(file, target),
      refreshTarget: () => this._refreshTarget(),
      isOnline: opts.isOnline,
      freeBytes: opts.freeBytes,
      allowInsecureHttp: this.allowHttp,
      ...(opts.engine || {}),
    });
  }

  log(...a) { try { this.opts.log('[MacUpdater]', ...a); } catch { /* noop */ } }

  /** Boot: tidy the update folder (a partial download for a newer version is KEPT), resume it at once, then schedule the periodic silent checks. */
  start() {
    try { this.cleanupIfStale(); } catch (e) { this.log('cleanup error:', e.message); }
    try {
      const st = this.readState();
      if (st) this._announceStaged(st.version);
      else if (this.dl.restore({ kick: false })) this._resumeAtStart();
    } catch (e) { this.log('restore error:', e.message); }
    const first = this.opts.checkInitialDelayMs ?? CHECK_INITIAL_DELAY_MS;
    const every = this.opts.checkIntervalMs ?? CHECK_INTERVAL_MS;
    const t1 = setTimeout(() => this.checkAndDownload(), first);
    const t2 = setInterval(() => this.checkAndDownload(), every);
    for (const t of [t1, t2]) { if (t.unref) t.unref(); }
    this._timers.push(t1, t2);
    this.log(`scheduled: first check in ${Math.round(first / 1000)}s, then every ${Math.round(every / 3600000 * 10) / 10}h`);
  }

  /** App quitting: stop the timers and the download (what was written stays on disk and is resumed next time). */
  async stop() {
    for (const t of this._timers) { clearTimeout(t); clearInterval(t); }
    this._timers = [];
    await this.dl.stop();
  }

  /**
   * A kept partial download resumes AT START, not 15 s or 6 h later — after one quick look at the feed (a few KB, 6 s at most): the release may have been
   * replaced while we were away, and resuming the old file would only download a file that no longer verifies. Paused → no network at all.
   */
  _resumeAtStart() {
    if (this.dl.isPaused()) return;
    let to = null;
    Promise.race([this.checkForUpdates(), new Promise((res) => { to = setTimeout(res, 6000); })])
      .catch(() => {})
      .then(() => { clearTimeout(to); this.dl.ensureRunning(); });
  }

  _announceStaged(version) {
    try {
      this.opts.emit('update-downloaded');
      this.opts.emit('update-status', { phase: 'ready', version, paused: false, bytesDone: null, bytesTotal: null, percent: 100, speedBps: 0, etaSec: null, nextRetryAt: null, lastError: null, errorCode: null });
    } catch { /* noop */ }
  }

  _rm(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } }

  /**
   * Boot cleanup.
   *   - a staged update that is not newer than the running version is wiped, with everything else;
   *   - a half-extracted staging folder (no staged.json) is removed;
   *   - a PENDING download is kept when its sidecar is valid and names a version newer than the running one — that is the resume;
   *     it is wiped when the version is <= the running one or the sidecar is missing/corrupt (the feed check later wipes it too if the feed's sha512 changed).
   */
  cleanupIfStale() {
    const current = this.opts.getVersion();
    const st = this.readState();
    if (st) {
      if (cmpVersions(st.version, current) <= 0) {
        this.log(`staged ${st.version} <= current ${current} — cleaning up`);
        this._wipeUpdates();
        this.dl.clearPause();
      } else {
        this.log(`found staged update v${st.version} from a previous session`);
        this._rm(this.pendingDir);                       // superseded by the staged one
      }
      return;
    }
    // nothing valid is staged: leftovers of an interrupted extraction go
    this._rm(this.stagedDir); this._rm(this.stateFile); this._rm(path.join(this.updatesDir, 'install-update.sh'));
    if (!fs.existsSync(this.pendingDir)) { this.dl.clearPause(); return; }
    const side = readSidecar(this.pendingDir);
    if (!side) {
      this.log('pending download has no valid sidecar — cleaning up');
      this._rm(this.pendingDir); this.dl.clearPause();
    } else if (cmpVersions(side.version, current) <= 0) {
      this.log(`pending v${side.version} <= current ${current} — cleaning up`);
      this._rm(this.pendingDir); this.dl.clearPause();
    } else {
      const have = this._sizeOf(path.join(this.pendingDir, `${side.fileName}.part`)) || this._sizeOf(path.join(this.pendingDir, side.fileName));
      this.log(`keeping the pending download of v${side.version}: ${(have / 1048576).toFixed(1)} of ${(side.expectedSize / 1048576).toFixed(0)} MB on disk`);
    }
  }

  _sizeOf(f) { try { return fs.statSync(f).size; } catch { return 0; } }

  _wipeUpdates() {
    this._rm(this.pendingDir); this._rm(this.stagedDir); this._rm(this.stateFile); this._rm(path.join(this.updatesDir, 'install-update.sh'));
  }

  readState() {
    try {
      const st = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      if (st && st.version && st.appPath && fs.existsSync(st.appPath)) return st;
    } catch { /* noop */ }
    return null;
  }

  hasStagedUpdate() { return !!this.readState(); }

  _targetOf(version, asset) {
    return { version, url: new URL(asset.url, this.assetBase).toString(), fileName: path.basename(asset.url), sha512: asset.sha512, size: Number(asset.size) };
  }

  /** The download engine asks the feed again while it retries: a target, null (no update any more) or undefined (the feed could not be read). */
  async _refreshTarget() {
    let feed;
    try { feed = parseFeed(await fetchText(this.feedUrl, this.allowHttp)); } catch { return undefined; }
    if (cmpVersions(feed.version, this.opts.getVersion()) <= 0) return null;
    if (this.hasStagedUpdate()) return undefined;
    const asset = chooseAsset(feed.files);
    if (!asset || !(Number(asset.size) > 0) || !asset.sha512) return undefined;
    this._pendingInfo = { version: feed.version, asset };
    return this._targetOf(feed.version, asset);
  }

  /** Manual + scheduled entry: check feed; returns {available, version}. A newer version starts (or keeps) the download. */
  async checkForUpdates() {
    if (this._checking) return { available: !!this._pendingInfo, version: this._pendingInfo?.version };
    this._checking = true;
    this.dl.markChecking(true);
    try {
      const feed = parseFeed(await fetchText(this.feedUrl, this.allowHttp));
      const current = this.opts.getVersion();
      if (cmpVersions(feed.version, current) <= 0) {
        this.log(`no update (feed ${feed.version}, current ${current})`);
        this.opts.emit('update-not-available');
        this._pendingInfo = null;
        if (!this.hasStagedUpdate()) this.dl.clearTarget();      // a partial of a release that is no longer the latest
        return { available: false };
      }
      const staged = this.readState();
      if (staged && cmpVersions(staged.version, feed.version) >= 0) {
        this.log(`v${feed.version} already staged`);
        this.opts.emit('update-downloaded');
        return { available: true, version: staged.version };
      }
      const asset = chooseAsset(feed.files);
      if (!asset) throw new Error('latest-mac.yml has no usable .zip/.dmg asset');
      if (!(Number(asset.size) > 0) || !asset.sha512) throw new Error('latest-mac.yml lists the asset without size or sha512');
      this._pendingInfo = { version: feed.version, asset };
      this.log(`update available: v${feed.version} → ${asset.url} (${(asset.size / 1024 / 1024).toFixed(0)} MB)`);
      if (staged) return { available: true, version: feed.version };     // an older staged update waits for the quit; the newer one is fetched after it is installed
      const target = this._targetOf(feed.version, asset);
      if (!this.dl.isTarget(target)) this.opts.emit('update-available', { version: feed.version, releaseNotes: '' });
      this.dl.setTarget(target);                                       // new target → the engine starts; the same target → nothing changes; paused → stays paused
      return { available: true, version: feed.version };
    } catch (e) {
      this.log('check failed:', e.message);
      return { available: false, error: e.message };
    } finally {
      this._checking = false;
      this.dl.markChecking(false);
    }
  }

  /** Scheduled flow: check then make sure the download is running. Paused → no network activity at all. */
  async checkAndDownload() {
    if (this.dl.isPaused()) { this.log('scheduled check skipped: the download is paused'); return; }
    const r = await this.checkForUpdates();
    if (r.available && this._pendingInfo && !this.hasStagedUpdate()) this.dl.ensureRunning();
  }

  /** Start (or keep) the download of the update the last check found. Returns at once: the engine runs in the background and retries by itself. */
  async downloadUpdate() {
    const staged = this.readState();
    if (staged) return { success: true, version: staged.version, alreadyStaged: true };
    if (!this._pendingInfo) {
      const r = await this.checkForUpdates();
      if (!r.available || !this._pendingInfo) return { success: false, error: 'no update available' };
    }
    if (this.dl.isPaused()) return { success: false, error: 'paused', version: this._pendingInfo.version };
    this.dl.ensureRunning();
    return { success: true, started: true, version: this._pendingInfo.version };
  }

  // ─── user / network controls (IPC + local API) ───
  getStatus() {
    const st = this.readState();
    if (st) return { phase: 'ready', version: st.version, paused: false, percent: 100 };
    return this.dl.getStatus();
  }
  pause() { return this.dl.pause(); }
  resume() {
    const r = this.dl.resume();
    this.checkForUpdates().catch(() => {});               // a newer release may have replaced the one that was paused: the engine switches if so
    return r;
  }
  retryNow() { return this.dl.retryNow(); }
  networkUp(reason) { this.dl.networkUp(reason); }

  /** Verified archive in hand: extract it and mark the update staged. Throws → the engine keeps the verified file and tries again later. */
  async _onDownloaded(file, target) {
    const appPath = await (this.opts.stage ? this.opts.stage(file, this.stagedDir) : this._stage(file));
    fs.writeFileSync(this.stateFile, JSON.stringify({ version: target.version, appPath, stagedAt: new Date().toISOString() }));
    this._rm(this.pendingDir);                              // free the archive space
    this._pendingInfo = { version: target.version, asset: this._pendingInfo?.asset };
    this.log(`staged v${target.version} at ${appPath}`);
    this.opts.emit('update-downloaded');
    try { this.opts.onStaged(target.version); } catch { /* noop */ }
  }

  /** Extract the downloaded archive → staged .app path. */
  async _stage(archivePath) {
    fs.rmSync(this.stagedDir, { recursive: true, force: true });
    fs.mkdirSync(this.stagedDir, { recursive: true });
    try {
      if (archivePath.endsWith('.zip')) {
        await execFileP('/usr/bin/ditto', ['-xk', archivePath, this.stagedDir]);
      } else if (archivePath.endsWith('.dmg')) {
        const mnt = fs.mkdtempSync(path.join(os.tmpdir(), 'texacore-upd-'));
        await execFileP('/usr/bin/hdiutil', ['attach', archivePath, '-nobrowse', '-readonly', '-mountpoint', mnt]);
        try {
          const appName = fs.readdirSync(mnt).find((n) => n.endsWith('.app'));
          if (!appName) throw new Error('No .app inside dmg');
          await execFileP('/usr/bin/ditto', [path.join(mnt, appName), path.join(this.stagedDir, appName)]);
        } finally {
          await execFileP('/usr/bin/hdiutil', ['detach', mnt, '-force']).catch(() => {});
          fs.rmSync(mnt, { recursive: true, force: true });
        }
      } else {
        throw new Error(`Unsupported update archive: ${archivePath}`);
      }
      const staged = fs.readdirSync(this.stagedDir).find((n) => n.endsWith('.app'));
      if (!staged) throw new Error('Extraction produced no .app bundle');
      return path.join(this.stagedDir, staged);
    } catch (e) {
      fs.rmSync(this.stagedDir, { recursive: true, force: true });     // never leave a half-extracted app behind
      throw e;
    }
  }

  /**
   * Build the install script text. Exposed for testing.
   * The script: waits for `pid` to exit → replaces the bundle → keeps a valid non-ad-hoc signature (2.0.4) or signs ad-hoc →
   * clears quarantine → relaunches → removes the staging dir.
   */
  buildInstallScript(appPath, stagedApp, { codesign = '/usr/bin/codesign', open = '/usr/bin/open' } = {}) {
    return `#!/bin/bash
# TexaCore mac self-update installer (generated)
PID="$1"
exec >> ${shq(this.installLog)} 2>&1
echo "[$(date '+%Y-%m-%d %H:%M:%S')] installer started (waiting for pid $PID)"
for i in $(seq 1 600); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.5
done
if [ ! -d ${shq(stagedApp)} ]; then
  echo "staged app missing — aborting"
  exit 1
fi
echo "replacing ${shq(appPath)}"
rm -rf ${shq(appPath)}
/usr/bin/ditto ${shq(stagedApp)} ${shq(appPath)}
# 2.0.4: a build signed with a real certificate keeps its signature - macOS ties the privacy permissions the user granted (Desktop / Documents /
# Downloads) and the Keychain access to it, and re-signing ad-hoc would throw them away at every update. Only a bundle whose signature is missing,
# broken or ad-hoc (every build before 2.0.4) is signed ad-hoc here, the way it always was, so it still opens on Apple Silicon.
SIGINFO="$(${shq(codesign)} -dv ${shq(appPath)} 2>&1)"
if ${shq(codesign)} --verify --deep --strict ${shq(appPath)} >/dev/null 2>&1 && ! printf '%s' "$SIGINFO" | grep -q 'Signature=adhoc' && ! printf '%s' "$SIGINFO" | grep -qi 'not signed'; then
  echo "signature kept (valid, not ad-hoc): $(printf '%s' "$SIGINFO" | grep '^Authority=' | head -1)"
else
  echo "no stable signature (missing, broken or ad-hoc) — signing ad-hoc"
  ${shq(codesign)} --force --deep --sign - ${shq(appPath)}
fi
/usr/bin/xattr -cr ${shq(appPath)} 2>/dev/null
echo "[$(date '+%Y-%m-%d %H:%M:%S')] installed — relaunching"
${shq(open)} ${shq(appPath)}
sleep 3
rm -rf ${shq(this.updatesDir)}
echo "[$(date '+%Y-%m-%d %H:%M:%S')] staging cleaned — done"
`;
  }

  /**
   * Called during quit finalization: if a verified staged update exists,
   * spawn the detached installer script (survives our exit).
   */
  spawnInstallerIfStaged() {
    if (this._installerSpawned) return false;
    const st = this.readState();
    if (!st) return false;
    if (cmpVersions(st.version, this.opts.getVersion()) <= 0) return false;
    if (!this.opts.isPackaged) { this.log('not packaged — skipping install'); return false; }
    const appPath = currentAppBundlePath();
    if (!appPath) { this.log('cannot locate current .app bundle — skipping install'); return false; }
    try {
      fs.mkdirSync(path.dirname(this.installLog), { recursive: true });
      const scriptPath = path.join(this.updatesDir, 'install-update.sh');
      fs.writeFileSync(scriptPath, this.buildInstallScript(appPath, st.appPath), { mode: 0o755 });
      const child = spawn('/bin/bash', [scriptPath, String(process.pid)], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      this._installerSpawned = true;
      this.log(`installer spawned (pid ${child.pid}) — v${st.version} will be installed after quit`);
      return true;
    } catch (e) {
      this.log('failed to spawn installer:', e.message);
      return false;
    }
  }
}

/** Shell-quote a path (single quotes). */
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/** The shared update-status object (GET /api/update/status, the ERP page's pill). `state` + version/percent/transferredMB/totalMB are the original
 *  fields and keep their meaning (idle | downloading | ready) for older ERP pages; `phase` and the rest are the detailed download status. */
function createUpdateStatus() {
  return {
    state: 'idle', version: null, percent: null, transferredMB: null, totalMB: null,
    phase: 'idle', paused: false, bytesDone: null, bytesTotal: null, speedBps: null, etaSec: null, nextRetryAt: null, lastError: null, errorCode: null, needBytes: null, freeBytes: null,
  };
}

/**
 * Pure reducer that maps updater events (mac MacUpdater or Windows
 * electron-updater) onto the shared update-status object served by the
 * local API (GET /api/update/status) and shown in the ERP web UI widget.
 * Mutates and returns `status`.
 */
function applyUpdateEvent(status, channel, payload) {
  const resetDetail = () => {
    status.phase = 'idle'; status.paused = false; status.bytesDone = null; status.bytesTotal = null; status.speedBps = null; status.etaSec = null;
    status.nextRetryAt = null; status.lastError = null; status.errorCode = null; status.needBytes = null; status.freeBytes = null;
  };
  switch (channel) {
    case 'update-available':
      status.state = 'downloading'; // both platforms auto-download right after
      status.version = (payload && payload.version) || status.version || null;
      status.percent = 0;
      status.transferredMB = null;
      status.totalMB = null;
      status.phase = 'downloading';
      break;
    case 'update-progress':
      status.state = 'downloading';
      status.phase = 'downloading';
      if (payload) {
        status.percent = typeof payload.percent === 'number' ? payload.percent : status.percent;
        status.transferredMB = payload.transferred ?? status.transferredMB;
        status.totalMB = payload.total ?? status.totalMB;
      }
      break;
    case 'update-status': {
      const p = payload || {};
      if (p.phase === 'checking') { if (status.state === 'idle') status.phase = 'checking'; break; }   // a look at the feed: nothing visible, the original fields stay
      status.phase = p.phase || 'idle';
      status.paused = !!p.paused;
      status.bytesDone = p.bytesDone ?? null; status.bytesTotal = p.bytesTotal ?? null;
      status.speedBps = p.speedBps ?? null; status.etaSec = p.etaSec ?? null;
      status.nextRetryAt = p.nextRetryAt ?? null; status.lastError = p.lastError ?? null; status.errorCode = p.errorCode ?? null;
      status.needBytes = p.needBytes ?? null; status.freeBytes = p.freeBytes ?? null;
      if (p.version) status.version = p.version;
      if (p.phase === 'idle' || !p.version) {
        // no download is known: the original idle shape (the ERP pill hides itself)
        if (p.phase === 'idle') { status.state = 'idle'; status.version = null; status.percent = null; status.transferredMB = null; status.totalMB = null; }
        break;
      }
      if (p.phase === 'ready') { status.state = 'ready'; status.percent = 100; break; }
      status.state = 'downloading';                                    // paused / waiting-retry / verifying / staging / failed-verify are all "an update is on its way" to an older ERP page
      status.percent = typeof p.percent === 'number' ? p.percent : status.percent;
      if (typeof p.bytesDone === 'number' && typeof p.bytesTotal === 'number' && p.bytesTotal > 0) {
        status.transferredMB = (p.bytesDone / 1024 / 1024).toFixed(1);
        status.totalMB = (p.bytesTotal / 1024 / 1024).toFixed(0);
      }
      break;
    }
    case 'update-downloaded':
      status.state = 'ready';
      status.percent = 100;
      status.phase = 'ready';
      status.paused = false;
      break;
    case 'update-not-available':
      status.state = 'idle';
      status.version = null;
      status.percent = null;
      status.transferredMB = null;
      status.totalMB = null;
      resetDetail();
      break;
    default:
      break;
  }
  return status;
}

module.exports = {
  MacUpdater,
  applyUpdateEvent,
  createUpdateStatus,
  // exported for tests
  _internals: { parseFeed, cmpVersions, chooseAsset, sha512OfFile, currentAppBundlePath, fetchText, httpsGet, FEED_URL, ASSET_BASE },
};
