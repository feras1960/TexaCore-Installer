// ════════════════════════════════════════════════════════════════
// 🪟 TexaCore Windows Updater — electron-updater with a RESUMABLE download in front of it
// ════════════════════════════════════════════════════════════════
// What electron-updater (6.8) does on its own, read from its source:
//   * a full download streams into  <cache>/pending/temp-<name>.exe  and ANY failure runs removeFileIfAny() — the half file is deleted. There is no Range
//     resume and no automatic retry. (A cancelled or failed download starts from zero next time.)
//   * with the release's .exe.blockmap files it can download only the changed blocks ("differential"), but that needs the blockmap of the version
//     that is INSTALLED too (<old release>/…-<old>.exe.blockmap), and a failure still throws the partial work away.
//   * a finished file is kept in <cache>/pending with update-info.json {fileName, sha512, isAdminRightsRequired}; the next downloadUpdate() accepts it
//     after re-hashing it against the feed's sha512 (DownloadedUpdateHelper.getValidCachedUpdateFile) and does not touch the network.
//
// So the smallest safe way to get "continues across drops, pausable, automatic" on Windows is: fetch the installer ourselves with the same resumable
// engine the Mac uses (src/update-downloader.js: Range + If-Range, stall detector, backoff, pause), verify its sha512 against latest.yml, put it in
// electron-updater's own cache exactly where it would have put it, and call autoUpdater.downloadUpdate() — which then finds a valid cached file and
// emits 'update-downloaded' without a single network request. If anything in that hand-over fails, downloadUpdate() simply downloads the installer
// itself, the way it always did (not resumable, but never worse than before). Installing is unchanged: autoUpdater.quitAndInstall().
//
// Note (release strategy, unchanged): the Windows GitHub releases are published as PRE-releases, which electron-updater's default channel does not offer
// (allowPrerelease is false), so this path only runs once a Windows release is a normal release.
// ════════════════════════════════════════════════════════════════
const path = require('path');
const fs = require('fs');
const { UpdateDownloader, readSidecar } = require('./update-downloader');

const CHECK_INITIAL_DELAY_MS = 5 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const OWNER_REPO = 'feras1960/TexaCore-Installer';

const asArray = (x) => (Array.isArray(x) ? x : (x == null ? [] : [x]));

function cmpVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The installer entry of latest.yml, or null. */
function pickExe(info) {
  return asArray(info && info.files).find((f) => f && /\.exe$/i.test(String(f.url || '')) && f.sha512 && Number(f.size) > 0) || null;
}

class WinUpdater {
  /**
   * @param {object} opts
   * @param {object} opts.autoUpdater            electron-updater's autoUpdater (injected so tests can fake it)
   * @param {() => string} opts.getVersion
   * @param {string} opts.userDataPath
   * @param {(...a:any[]) => void} opts.log
   * @param {(channel:string, payload?:any) => void} opts.emit
   * @param {() => boolean} [opts.isOnline]
   * @param {object} [opts.engine]               overrides for the download engine
   */
  constructor(opts) {
    this.opts = opts;
    this.au = opts.autoUpdater;
    this.updatesDir = path.join(opts.userDataPath, 'updates');
    this.pendingDir = path.join(this.updatesDir, 'pending');
    this.controlFile = path.join(this.updatesDir, 'control.json');
    this._timers = [];
    this._checking = false;
    this._downloaded = null;       // version electron-updater reported as downloaded
    this.dl = new UpdateDownloader({
      dir: this.pendingDir,
      controlFile: this.controlFile,
      log: (...a) => this.log(...a),
      onStatus: (snap) => { try { this.opts.emit('update-status', snap); } catch { /* noop */ } },
      onDownloaded: (file, target) => this._handOver(file, target),
      refreshTarget: () => this._refreshTarget(),
      isOnline: opts.isOnline,
      freeBytes: opts.freeBytes,
      allowInsecureHttp: !!opts.allowInsecureHttp,      // tests only
      ...(opts.engine || {}),
    });
  }

  log(...a) { try { this.opts.log('[WinUpdater]', ...a); } catch { /* noop */ } }

  start() {
    const au = this.au;
    au.autoDownload = false;            // the resumable engine downloads; downloadUpdate() is only the hand-over
    au.autoInstallOnAppQuit = true;
    au.on('update-available', (info) => { this._onAvailable(info).catch((e) => this.log('update-available handler:', e && e.message)); });
    au.on('update-not-available', () => this._onNone());
    au.on('download-progress', (p) => {            // only when electron-updater itself downloads (the fallback)
      this.opts.emit('update-progress', { percent: Math.round(p.percent), transferred: (p.transferred / 1024 / 1024).toFixed(1), total: (p.total / 1024 / 1024).toFixed(0) });
    });
    au.on('update-downloaded', (info) => {
      this._downloaded = info && info.version;
      this.opts.emit('update-downloaded');
    });
    au.on('error', (err) => { this.log('electron-updater error:', err && err.message); });

    try { this._cleanup(); } catch (e) { this.log('cleanup error:', e.message); }
    try {
      if (this.dl.restore({ kick: false }) && !this.dl.isPaused()) {     // resume at start, after one quick look at the feed (the release may have been replaced)
        let to = null;
        Promise.race([this.checkForUpdates(), new Promise((res) => { to = setTimeout(res, 6000); })]).catch(() => {}).then(() => { clearTimeout(to); this.dl.ensureRunning(); });
      }
    } catch (e) { this.log('restore error:', e.message); }
    const t1 = setTimeout(() => this.checkAndDownload(), this.opts.checkInitialDelayMs ?? CHECK_INITIAL_DELAY_MS);
    const t2 = setInterval(() => this.checkAndDownload(), this.opts.checkIntervalMs ?? CHECK_INTERVAL_MS);
    for (const t of [t1, t2]) { if (t.unref) t.unref(); }
    this._timers.push(t1, t2);
  }

  async stop() {
    for (const t of this._timers) { clearTimeout(t); clearInterval(t); }
    this._timers = [];
    await this.dl.stop();
  }

  /** A pending download is kept when its sidecar is valid and names a newer version; otherwise it goes. */
  _cleanup() {
    const current = this.opts.getVersion();
    if (!fs.existsSync(this.pendingDir)) { this.dl.clearPause(); return; }
    const side = readSidecar(this.pendingDir);
    if (!side || cmpVersions(side.version, current) <= 0) {
      this.log('pending download is stale or unreadable — cleaning up');
      try { fs.rmSync(this.pendingDir, { recursive: true, force: true }); } catch { /* best effort */ }
      this.dl.clearPause();
    } else {
      this.log(`keeping the pending download of v${side.version}`);
    }
  }

  async checkAndDownload() {
    if (this.dl.isPaused()) { this.log('scheduled check skipped: the download is paused'); return; }
    await this.checkForUpdates();
    this.dl.ensureRunning();
  }

  async checkForUpdates() {
    if (this._checking) return { available: false };
    this._checking = true;
    this.dl.markChecking(true);
    try {
      const r = await this.au.checkForUpdates();          // fires 'update-available' / 'update-not-available' → the handlers below
      return { available: !!(r && r.updateInfo && cmpVersions(r.updateInfo.version, this.opts.getVersion()) > 0), version: r && r.updateInfo && r.updateInfo.version };
    } catch (e) {
      this.log('check failed:', e && e.message);
      return { available: false, error: e && e.message };
    } finally {
      this._checking = false;
      this.dl.markChecking(false);
    }
  }

  /** The URL electron-updater itself would download from (its GitHub provider resolves the release tag), else the tagged release URL. */
  _urlFor(info, exe) {
    try {
      const prov = this.au.updateInfoAndProvider && this.au.updateInfoAndProvider.provider;
      if (prov && typeof prov.resolveFiles === 'function') {
        const hit = prov.resolveFiles(info).find((f) => f.info && f.info.url === exe.url);
        if (hit && hit.url) return hit.url.toString();
      }
    } catch { /* fall through */ }
    return `https://github.com/${OWNER_REPO}/releases/download/v${info.version}/${encodeURIComponent(exe.url)}`;
  }

  _targetOf(info) {
    const exe = pickExe(info);
    if (!exe) return null;
    return { version: String(info.version), url: this._urlFor(info, exe), fileName: path.basename(decodeURIComponent(exe.url)), sha512: exe.sha512, size: Number(exe.size) };
  }

  async _onAvailable(info) {
    if (!info || cmpVersions(info.version, this.opts.getVersion()) <= 0) return;
    const target = this._targetOf(info);
    if (!target) {                                         // a feed we can not drive (no sha512/size): leave it to electron-updater as before
      this.log('latest.yml has no usable installer entry — letting electron-updater download it');
      this.opts.emit('update-available', { version: info.version, releaseNotes: info.releaseNotes });
      this.au.autoDownload = true;
      await this.au.downloadUpdate().catch((e) => this.log('stock download failed:', e && e.message));
      return;
    }
    if (this.dl.isTarget(target) && (this.dl.phase() === 'ready' || this._downloaded === target.version)) return;     // already fetched: nothing to announce
    if (!this.dl.isTarget(target) && await this._cachedAlready(target)) {          // a previous run already left this installer in electron-updater's cache: nothing to download
      this.opts.emit('update-available', { version: info.version, releaseNotes: info.releaseNotes });
      try { await this.au.downloadUpdate(); return; } catch (e) { this.log('cached installer not accepted — downloading it:', e && e.message); }
    }
    if (!this.dl.isTarget(target)) this.opts.emit('update-available', { version: info.version, releaseNotes: info.releaseNotes });
    this.dl.setTarget(target);
  }

  /** Does electron-updater's own cache already hold this exact installer (update-info.json + the file)? Its downloadUpdate() then finishes without the network. */
  async _cachedAlready(target) {
    try {
      const helper = await this.au.getOrCreateDownloadHelper();
      const dir = helper.cacheDirForPendingUpdate;
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'update-info.json'), 'utf8'));
      return meta && meta.sha512 === target.sha512 && fs.existsSync(path.join(dir, meta.fileName)) && fs.statSync(path.join(dir, meta.fileName)).size === target.size;
    } catch { return false; }
  }

  _onNone() {
    this.opts.emit('update-not-available');
    if (this.dl.phase() !== 'ready') this.dl.clearTarget();
  }

  async _refreshTarget() {
    try {
      const r = await this.au.checkForUpdates();          // may re-fire the events above; the engine only needs the verdict
      const info = r && r.updateInfo;
      if (!info || cmpVersions(info.version, this.opts.getVersion()) <= 0) return null;
      return this._targetOf(info) || undefined;
    } catch { return undefined; }
  }

  /** The verified installer is ours; give it to electron-updater the way its own download would have left it. */
  async _handOver(file, target) {
    const au = this.au;
    if (!au.updateInfoAndProvider) await au.checkForUpdates();
    const helper = await au.getOrCreateDownloadHelper();
    const dir = helper.cacheDirForPendingUpdate;
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) { if (f !== target.fileName) { try { fs.rmSync(path.join(dir, f), { recursive: true, force: true }); } catch { /* best effort */ } } }
    const dest = path.join(dir, target.fileName);
    try { fs.renameSync(file, dest); } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      fs.copyFileSync(file, dest); fs.rmSync(file, { force: true });
    }
    const entry = asArray(au.updateInfoAndProvider && au.updateInfoAndProvider.info && au.updateInfoAndProvider.info.files).find((f) => f && f.url && path.basename(decodeURIComponent(f.url)) === target.fileName);
    fs.writeFileSync(path.join(dir, 'update-info.json'), JSON.stringify({ fileName: target.fileName, sha512: target.sha512, isAdminRightsRequired: !!(entry && entry.isAdminRightsRequired === true) }));
    this.log(`handed v${target.version} over to electron-updater (${dest})`);
    try {
      await au.downloadUpdate();                            // finds the valid cached file → 'update-downloaded', no network
    } catch (e) {
      if (fs.existsSync(dest) && !fs.existsSync(file)) { try { fs.renameSync(dest, file); } catch { /* the engine downloads it again */ } }   // keep the verified file for the retry
      throw e;
    }
    try { fs.rmSync(this.pendingDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  // ─── user / network controls ───
  getStatus() { return this.dl.getStatus(); }
  pause() { return this.dl.pause(); }
  resume() { const r = this.dl.resume(); this.checkForUpdates().catch(() => {}); return r; }
  retryNow() { return this.dl.retryNow(); }
  networkUp(reason) { this.dl.networkUp(reason); }
}

module.exports = { WinUpdater, _internals: { pickExe, cmpVersions } };
