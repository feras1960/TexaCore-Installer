// ════════════════════════════════════════════════════════════════
// 🍎 TexaCore Mac Updater — self-managed OTA for ad-hoc-signed builds
// ════════════════════════════════════════════════════════════════
// Squirrel.Mac (electron-updater's mac backend) refuses to apply updates to
// apps that are not Developer-ID signed, so this module implements the whole
// flow ourselves:
//   1. Fetch latest-mac.yml from the GitHub "latest" release.
//   2. Semver-compare with the running version.
//   3. Silently download the asset (prefer .zip, else .dmg) with progress.
//   4. Verify sha512 (base64) — reject and delete on mismatch.
//   5. Stage the new "TexaCore ERP.app" (ditto -xk for zip / hdiutil for dmg).
//   6. On quit, spawn a detached shell script that waits for our PID to exit,
//      replaces the current bundle, ad-hoc re-signs it, clears quarantine,
//      and relaunches the app.
// Windows keeps using electron-updater untouched.

const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const FEED_URL = 'https://github.com/feras1960/TexaCore-Installer/releases/latest/download/latest-mac.yml';
const ASSET_BASE = 'https://github.com/feras1960/TexaCore-Installer/releases/latest/download/';
const MAX_REDIRECTS = 6;
const CHECK_INITIAL_DELAY_MS = 15 * 1000;      // ~15s after launch
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;  // every 6 hours (mirror Windows)

// ─── Small helpers ───────────────────────────────────────────

/** Follow-redirect GET returning the final response stream. */
function httpsGet(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > MAX_REDIRECTS) return reject(new Error('Too many redirects'));
    const req = https.get(url, {
      headers: { 'User-Agent': 'TexaCore-Updater', Accept: '*/*' },
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        const next = new URL(res.headers.location, url).toString();
        return resolve(httpsGet(next, redirects + 1));
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

async function fetchText(url) {
  const res = await httpsGet(url);
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

/** sha512 (base64) of a file, streaming. */
function sha512OfFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('base64')))
      .on('error', reject);
  });
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
   * @param {(channel: string, payload?: any) => void} opts.emit  send to renderer
   * @param {(version: string) => void} opts.onStaged  called once an update is staged
   */
  constructor(opts) {
    this.opts = opts;
    this.updatesDir = path.join(opts.userDataPath, 'updates');
    this.pendingDir = path.join(this.updatesDir, 'pending');
    this.stagedDir = path.join(this.updatesDir, 'staged');
    this.stateFile = path.join(this.updatesDir, 'staged.json');
    this.installLog = path.join(opts.userDataPath, 'logs', 'mac-update-install.log');
    this._checking = false;
    this._downloading = false;
    this._pendingInfo = null;   // {version, asset} discovered by last check
    this._installerSpawned = false;
  }

  log(...a) { try { this.opts.log('[MacUpdater]', ...a); } catch { /* noop */ } }

  /** Boot: clean stale staging, then schedule periodic silent checks. */
  start() {
    try { this.cleanupIfStale(); } catch (e) { this.log('cleanup error:', e.message); }
    setTimeout(() => this.checkAndDownload(), CHECK_INITIAL_DELAY_MS);
    setInterval(() => this.checkAndDownload(), CHECK_INTERVAL_MS);
    this.log('scheduled: first check in 15s, then every 6h');
  }

  /** Remove staging if it is for the current (or older) version. */
  cleanupIfStale() {
    const st = this.readState();
    if (!st) {
      // No valid staged state → clear any half-finished downloads.
      if (fs.existsSync(this.updatesDir)) fs.rmSync(this.updatesDir, { recursive: true, force: true });
      return;
    }
    if (cmpVersions(st.version, this.opts.getVersion()) <= 0) {
      this.log(`staged ${st.version} <= current ${this.opts.getVersion()} — cleaning up`);
      fs.rmSync(this.updatesDir, { recursive: true, force: true });
    } else {
      this.log(`found staged update v${st.version} from a previous session`);
    }
  }

  readState() {
    try {
      const st = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      if (st && st.version && st.appPath && fs.existsSync(st.appPath)) return st;
    } catch { /* noop */ }
    return null;
  }

  hasStagedUpdate() { return !!this.readState(); }

  /** Manual + scheduled entry: check feed; returns {available, version}. */
  async checkForUpdates() {
    if (this._checking) return { available: !!this._pendingInfo, version: this._pendingInfo?.version };
    this._checking = true;
    try {
      const feed = parseFeed(await fetchText(FEED_URL));
      const current = this.opts.getVersion();
      if (cmpVersions(feed.version, current) <= 0) {
        this.log(`no update (feed ${feed.version}, current ${current})`);
        this.opts.emit('update-not-available');
        this._pendingInfo = null;
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
      this._pendingInfo = { version: feed.version, asset };
      this.log(`update available: v${feed.version} → ${asset.url} (${(asset.size / 1024 / 1024).toFixed(0)} MB)`);
      this.opts.emit('update-available', { version: feed.version, releaseNotes: '' });
      return { available: true, version: feed.version };
    } catch (e) {
      this.log('check failed:', e.message);
      return { available: false, error: e.message };
    } finally {
      this._checking = false;
    }
  }

  /** Scheduled flow: check then silently download+stage. */
  async checkAndDownload() {
    const r = await this.checkForUpdates();
    if (r.available && this._pendingInfo && !this.hasStagedUpdate()) {
      await this.downloadUpdate().catch(() => {});
    }
  }

  /** Download the pending asset, verify sha512, stage the .app. */
  async downloadUpdate() {
    if (this._downloading) return { success: false, error: 'already downloading' };
    if (!this._pendingInfo) {
      const r = await this.checkForUpdates();
      if (!r.available || !this._pendingInfo) return { success: false, error: 'no update available' };
    }
    this._downloading = true;
    const { version, asset } = this._pendingInfo;
    try {
      fs.mkdirSync(this.pendingDir, { recursive: true });
      const dest = path.join(this.pendingDir, path.basename(asset.url));
      const url = new URL(asset.url, ASSET_BASE).toString();
      this.log(`downloading ${url} → ${dest}`);
      await this._downloadWithProgress(url, dest, asset.size);

      // Verify sha512 before accepting.
      const actual = await sha512OfFile(dest);
      if (actual !== asset.sha512) {
        fs.rmSync(dest, { force: true });
        throw new Error(`sha512 mismatch (expected ${asset.sha512.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`);
      }
      this.log('sha512 verified ✅');

      const appPath = await this._stage(dest);
      fs.writeFileSync(this.stateFile, JSON.stringify({ version, appPath, stagedAt: new Date().toISOString() }));
      fs.rmSync(this.pendingDir, { recursive: true, force: true }); // free the archive space
      this.log(`staged v${version} at ${appPath}`);
      this.opts.emit('update-downloaded');
      try { this.opts.onStaged(version); } catch { /* noop */ }
      return { success: true, version };
    } catch (e) {
      this.log('download/stage failed:', e.message);
      return { success: false, error: e.message };
    } finally {
      this._downloading = false;
    }
  }

  _downloadWithProgress(url, dest, totalSize) {
    return httpsGet(url).then((res) => new Promise((resolve, reject) => {
      const total = Number(res.headers['content-length']) || totalSize || 0;
      let transferred = 0;
      let lastPct = -1;
      const out = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        transferred += chunk.length;
        const pct = total ? Math.round((transferred / total) * 100) : 0;
        if (pct !== lastPct) {
          lastPct = pct;
          this.opts.emit('update-progress', {
            percent: pct,
            transferred: (transferred / 1024 / 1024).toFixed(1),
            total: (total / 1024 / 1024).toFixed(0),
          });
        }
      });
      res.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      res.on('error', reject);
    }));
  }

  /** Extract the downloaded archive → staged .app path. */
  async _stage(archivePath) {
    fs.rmSync(this.stagedDir, { recursive: true, force: true });
    fs.mkdirSync(this.stagedDir, { recursive: true });
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
  }

  /**
   * Build the install script text. Exposed for testing.
   * The script: waits for `pid` to exit → replaces the bundle → ad-hoc signs →
   * clears quarantine → relaunches → removes the staging dir.
   */
  buildInstallScript(appPath, stagedApp) {
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
/usr/bin/codesign --force --deep --sign - ${shq(appPath)}
/usr/bin/xattr -cr ${shq(appPath)} 2>/dev/null
echo "[$(date '+%Y-%m-%d %H:%M:%S')] installed — relaunching"
/usr/bin/open ${shq(appPath)}
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

/**
 * Pure reducer that maps updater events (mac MacUpdater or Windows
 * electron-updater) onto the shared update-status object served by the
 * local API (GET /api/update/status) and shown in the ERP web UI widget.
 * Mutates and returns `status`.
 */
function applyUpdateEvent(status, channel, payload) {
  switch (channel) {
    case 'update-available':
      status.state = 'downloading'; // both platforms auto-download right after
      status.version = (payload && payload.version) || status.version || null;
      status.percent = 0;
      status.transferredMB = null;
      status.totalMB = null;
      break;
    case 'update-progress':
      status.state = 'downloading';
      if (payload) {
        status.percent = typeof payload.percent === 'number' ? payload.percent : status.percent;
        status.transferredMB = payload.transferred ?? status.transferredMB;
        status.totalMB = payload.total ?? status.totalMB;
      }
      break;
    case 'update-downloaded':
      status.state = 'ready';
      status.percent = 100;
      break;
    case 'update-not-available':
      status.state = 'idle';
      status.version = null;
      status.percent = null;
      status.transferredMB = null;
      status.totalMB = null;
      break;
    default:
      break;
  }
  return status;
}

module.exports = {
  MacUpdater,
  applyUpdateEvent,
  // exported for tests
  _internals: { parseFeed, cmpVersions, chooseAsset, sha512OfFile, currentAppBundlePath, fetchText, httpsGet, FEED_URL },
};
