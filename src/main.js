// ════════════════════════════════════════════════════════════════
// 🖥️ TexaCore Installer — Electron Main Process (Embedded v5)
// ════════════════════════════════════════════════════════════════

const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const { exec, spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getVendorAccount } = require('./vendor-support');
const https = require('https');
const http = require('http');
const { autoUpdater } = require('electron-updater');
const { MacUpdater, applyUpdateEvent, createUpdateStatus } = require('./mac-updater');
const { WinUpdater } = require('./win-updater');
const ServiceManager = require('./service-manager');
const LicenseGuard = require('./license-guard');
const netGuard = require('./net-guard');
const cloudClient = require('./cloud-client');
const BackupManager = require('./backup-manager');
const companyFile = require('./company-file');
const livePolicy = require('./live-file-policy');   // 2.0.5: replace-all needs an explicit yes + a pre-open backup; the live file never changes owner by itself
const liveFileMove = require('./live-file-move');   // 2.0.5 RC2: «تغيير المكان» - the safe copy → verify → switch of the live company file
const locateFile = require('./locate-file');
const folderAccessMod = require('./folder-access');   // 2.0.4: macOS «Files and Folders» permission - probed in a child process, never in the main loop
const locateJobMod = require('./locate-job');
const cloudFiles = require('./cloud-files');
const { RsfReader, detectFileType } = require('./rsf-reader');
const { RsfExporter, RsfSyncManager } = require('./rsf-exporter');
const { PORTS, harnessAllowed } = require('./ports');
const provisioning = require('./provisioning');
const planSync = require('./plan-sync');

// ─── Test / launch-check harness switches (dev checkout, or a packaged app run with its OWN userData + port block) ───
// TEXACORE_USER_DATA  use this folder as the app's userData (so a test never touches the real one)
// TEXACORE_PORT_BASE  move every port into one block (see ports.js)
// TEXACORE_HEADLESS   no window, no tray, no auto-updater, no cloud presence/diagnostics
// TEXACORE_E2E_AUTOSTART=1  start the services at launch without a license check (the license is minted per TEXACORE_E2E_LICENSE)
const HARNESS_OK = harnessAllowed(app.isPackaged);   // dev checkout, or a packaged build isolated to its own userData + port block
const DEV_HARNESS = HARNESS_OK && process.env.TEXACORE_HEADLESS === '1';
if (HARNESS_OK && process.env.TEXACORE_USER_DATA) {
  app.setPath('userData', process.env.TEXACORE_USER_DATA);
}
// A release check can run the secrets-at-rest path against Chromium's in-memory MOCK keychain, so it never touches the real Keychain (isolated runs only).
if (HARNESS_OK && process.env.TEXACORE_SECRETS_AT_REST === 'mock') app.commandLine.appendSwitch('use-mock-keychain');

// ─── File Logger ─────────────────────────────────────────────
// Saves all console output to a log file for debugging
const LOG_DIR = path.join(app.getPath('userData'), 'logs');
try { if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
const LOG_FILE = path.join(LOG_DIR, 'heartbeat.log');
// Rotate log if > 1MB
try { if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1024 * 1024) fs.unlinkSync(LOG_FILE); } catch {}

function fileLog(...args) {
  const ts = new Date().toISOString();
  const msg = `[${ts}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`;
  try { fs.appendFileSync(LOG_FILE, msg + '\n'); } catch {}
  console.log(...args);
}
fileLog('═══ TexaCore started ═══ Log file:', LOG_FILE);

// ─── Global Error Handlers ──────────────────────────────────
// Suppress EPIPE and similar non-fatal errors that would show
// Electron's crash dialog when a child process pipe breaks.
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED') {
    console.warn('[TexaCore] Suppressed pipe error:', err.code);
    return; // Non-fatal — ignore
  }
  console.error('[TexaCore] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[TexaCore] Unhandled rejection:', reason);
});

// ─── Constants ───────────────────────────────────────────────
const LICENSING_URL = 'https://wzkklenfsaepegymfxfz.supabase.co/functions/v1';
const SUPABASE_URL = 'wzkklenfsaepegymfxfz.supabase.co';
// Where "the cloud" is for this process: production, a loopback MOCK (isolated harness runs only), or off (headless harness without a mock).
const CLOUD = cloudClient.resolveTarget({ harnessOk: HARNESS_OK, headless: process.env.TEXACORE_HEADLESS === '1', env: process.env, prod: { hostname: SUPABASE_URL } });
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6a2tsZW5mc2FlcGVneW1meGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NTIxNzcsImV4cCI6MjA4NDMyODE3N30.ATYSK_WvOfbqEaInbg5nKau-wgixF0lIGaue3m8AJtI';
const APP_PORT = PORTS.custom ? PORTS.ui : 8080;

// ─── Realtime Presence (instant online/offline like messaging apps) ──
class RealtimePresence {
  constructor() {
    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.ref = 0;
    this.channelJoined = false;
    this.licenseKey = null;
  }

  connect(licenseKey) {
    if (!licenseKey) { fileLog('[Presence] No license key — skipping'); return; }
    if (this.ws) return;
    this.licenseKey = licenseKey;

    // Supabase Realtime v2 WebSocket URL
    const wsUrl = `wss://${SUPABASE_URL}/realtime/v1/websocket?apikey=${SUPABASE_ANON_KEY}&vsn=1.0.0`;
    fileLog('[Presence] Connecting to:', wsUrl.substring(0, 80) + '...');

    try {
      const WebSocket = require('ws');
      this.ws = new WebSocket(wsUrl);
    } catch (e) {
      fileLog('[Presence] ws module error:', e.message);
      return;
    }

    this.ws.on('open', () => {
      fileLog('[Presence] ✅ WebSocket connected');

      // Phoenix heartbeat every 30s to keep connection alive
      this.heartbeatTimer = setInterval(() => {
        this._send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++this.ref) });
      }, 30000);

      // Join the presence channel
      this._joinChannel();
    });

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        // Channel join success
        if (msg.event === 'phx_reply' && msg.payload?.status === 'ok' && msg.topic === 'realtime:desktop-presence' && !this.channelJoined) {
          this.channelJoined = true;
          fileLog('[Presence] ✅ Channel joined — tracking presence');
          this._trackPresence();
        }

        // Log presence events for debugging
        if (msg.event === 'presence_state' || msg.event === 'presence_diff') {
          fileLog(`[Presence] Event: ${msg.event}`);
        }

        // Instant push: the admin changed this license (tier / expiry / status /
        // block) → sync NOW instead of waiting up to 3 min for the next beat.
        if (msg.event === 'broadcast' && msg.payload?.event === 'license-sync') {
          const key = msg.payload?.payload?.license_key;
          if (key && key === this.licenseKey && typeof heartbeatSender !== 'undefined') {
            fileLog('[Presence] ⚡ license-sync broadcast — syncing license state now');
            heartbeatSender._syncLicenseState(loadConfig()).catch(e => fileLog('[Presence] instant sync error:', e.message));
          }
        }
      } catch {}
    });

    this.ws.on('close', (code) => {
      fileLog(`[Presence] WebSocket closed (code: ${code}) — reconnecting in 5s...`);
      this._cleanup();
      this.reconnectTimer = setTimeout(() => this.connect(licenseKey), 5000);
    });

    this.ws.on('error', (err) => {
      fileLog('[Presence] WebSocket error:', err.message);
    });
  }

  _joinChannel() {
    this._send({
      topic: 'realtime:desktop-presence',
      event: 'phx_join',
      payload: {
        config: {
          presence: { key: this.licenseKey },
          broadcast: { self: true },
        }
      },
      ref: String(++this.ref),
    });
  }

  _trackPresence() {
    const os = require('os');
    const config = loadConfig();
    this._send({
      topic: 'realtime:desktop-presence',
      event: 'presence',
      payload: {
        type: 'presence',
        event: 'track',
        payload: {
          license_key: this.licenseKey,
          hostname: os.hostname(),
          app_version: app.getVersion(),
          online_since: new Date().toISOString(),
          subdomain: config.subdomain || null,
        }
      },
      ref: String(++this.ref),
    });
  }

  _send(msg) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  _cleanup() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.channelJoined = false;
    this.ws = null;
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) { this.ws.close(); this._cleanup(); }
    fileLog('[Presence] Disconnected');
  }
}

const realtimePresence = new RealtimePresence();

// ─── Data Directory ──────────────────────────────────────────
const DATA_DIR = path.join(app.getPath('userData'), 'texacore-data');
// Unified backup key: NEW .tcdb files are encrypted with this stable key so the
// work file opens on ANY install of the program and survives a license change
// (trial→paid). Restore still tries the license key on disk (dataDir), so older
// license-encrypted files keep opening too. Chosen by the user (portability over
// secrecy). See [[local-hybrid-schema-sync]] #4.
const UNIFIED_BACKUP_KEY = 'texacore-default-backup-key-2026';
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
// LICENSE_FILE removed — licensing now handled by LicenseGuard (encrypted)

let mainWindow = null;
let tray = null;
let svcManager = null; // Initialized in app.whenReady
let licenseGuard = null; // Initialized in app.whenReady
let backupManager = null; // Initialized after company creation

// ─── Ensure data directory exists ────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ─── Load/Save Config ────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return { licenseKey: '', dbPassword: '', port: APP_PORT };
}

function saveConfig(config) {
  ensureDataDir();
  // Merge with existing to preserve tunnelToken and cloud fields
  let existing = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      existing = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch {}
  const merged = { ...existing, ...config };
  // Never lose these critical fields
  if (existing.tunnelToken && !config.tunnelToken) merged.tunnelToken = existing.tunnelToken;
  if (existing.subdomain && !config.subdomain) merged.subdomain = existing.subdomain;
  if (existing.enableCloud && config.enableCloud === undefined) merged.enableCloud = existing.enableCloud;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), { mode: 0o600 });
}

// ─── Create Window ───────────────────────────────────────────
/** The window/title-bar icon. Packaged builds ship build/icon.ico (+ icon.png) under resources/build; the repo checkout has them next to src. */
function windowIconPath() {
  const dir = app.isPackaged ? path.join(process.resourcesPath, 'build') : path.join(__dirname, '..', 'build');
  const ico = path.join(dir, 'icon.ico');
  return process.platform === 'win32' && fs.existsSync(ico) ? ico : path.join(dir, 'icon.png');
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    // 2.0.5 RC2: the launcher is a no-scroll control panel designed for a 960 x 720 page; the content size is what is fixed (macOS adds a 28 px drag strip
    // for the traffic lights, Windows / Linux have their native title bar outside the content)
    useContentSize: true,
    width: 960,
    height: isMac ? 748 : 720,
    minWidth: 900,
    minHeight: isMac ? 708 : 680,
    resizable: true,
    // macOS: frameless + native traffic lights (positioned below).
    // Windows/Linux: native frame so minimize/maximize/close controls exist —
    // a frameless window there shipped with NO window controls at all.
    frame: !isMac,
    titleBarStyle: isMac ? 'hidden' : 'default',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    backgroundColor: '#0a1628',
    show: !(HARNESS_OK && process.env.TEXACORE_UI_SMOKE === '1'),     // a release-check run creates the installer window hidden
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: windowIconPath(),
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Hide to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      // On macOS, hide dock icon when window is hidden
      if (process.platform === 'darwin') {
        app.dock.hide();
      }
    }
  });

  mainWindow.on('show', () => {
    if (process.platform === 'darwin') {
      app.dock.show();
    }
  });
}

// ─── Command Helper (non-Docker) ─────────────────────────────
function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout.trim());
    });
  });
}

// ─── HTTP Request Helper ─────────────────────────────────────
function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    };

    const lib = urlObj.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(body); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(JSON.stringify(data));
    req.end();
  });
}

// POST to a cloud PostgREST RPC (adds the anon-key headers that httpPost omits).
// Used to tag/prune cloud backups per company after an upload.
function httpPostRpc(rpcName, data) {
  return cloudClient.request(CLOUD, {
    method: 'POST', path: `/rest/v1/rpc/${rpcName}`, timeout: 15000, body: data,
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  }).then((r) => r.text);
}

// Read real counts from the embedded local PG (companies / users / invoices /
// db size). Used for the heartbeat + cloud-backup metadata so the management
// dashboard shows true numbers instead of the old hard-coded zeros.
async function getLocalDbStats() {
  let client;
  try {
    const { Client } = require('pg');
    client = new Client({
      host: 'localhost',
      port: (typeof ServiceManager !== 'undefined' && ServiceManager.PG_PORT) || 54322,
      database: 'postgres',
      user: 'postgres',
      password: (svcManager && svcManager.dbPassword) || '',
    });
    await client.connect();
    const { rows } = await client.query(`
      SELECT
        (SELECT count(*) FROM public.companies)                                     AS companies,
        (SELECT count(*) FROM auth.users)                                           AS users,
        (COALESCE((SELECT count(*) FROM public.sales_invoices), 0)
         + COALESCE((SELECT count(*) FROM public.purchase_invoices), 0))            AS invoices,
        (pg_database_size('postgres') / 1024 / 1024)                                AS db_mb
    `);
    const r = rows[0] || {};
    return {
      companiesCount: +r.companies || 0,
      usersActive: +r.users || 0,
      invoicesCount: +r.invoices || 0,
      dbSizeMb: +r.db_mb || 0,
    };
  } catch (e) {
    return null;
  } finally {
    if (client) { try { await client.end(); } catch {} }
  }
}

// ─── HeartbeatSender ─────────────────────────────────────────
class HeartbeatSender {
  constructor() {
    this.interval = null;
    this.INTERVAL_MS = 3 * 60 * 1000; // 3 minutes for reliable connection status
    this.retryCount = 0;
    this.MAX_RETRIES = 3;
    this.lastSuccessAt = null;
    this._lastPayload = null;
  }

  start() {
    if (this.interval) return;
    fileLog('[Heartbeat] ═══════════════════════════════════════');
    fileLog('[Heartbeat] Starting heartbeat system...');
    fileLog('[Heartbeat] Config file:', CONFIG_FILE);
    const cfg = loadConfig();
    fileLog('[Heartbeat] License key:', cfg.licenseKey ? `${cfg.licenseKey.substring(0, 10)}...` : '❌ EMPTY');
    fileLog('[Heartbeat] Interval: 3 min, First beat in 5s');
    fileLog('[Heartbeat] ═══════════════════════════════════════');
    
    // Send first heartbeat quickly (5 seconds — just let Electron app init)
    setTimeout(() => this._sendWithRetry(), 5000);
    this.interval = setInterval(() => this._sendWithRetry(), this.INTERVAL_MS);
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  // Retry wrapper: tries up to MAX_RETRIES with exponential backoff
  async _sendWithRetry() {
    fileLog('[Heartbeat] ─── Sending heartbeat... ───');
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        await this.send();
        this.retryCount = 0;
        this.lastSuccessAt = Date.now();
        fileLog('[Heartbeat] ✅ SUCCESS on attempt', attempt);
        return; // Success — exit
      } catch (err) {
        fileLog(`[Heartbeat] ❌ Attempt ${attempt}/${this.MAX_RETRIES} failed:`, err.message);
        if (attempt < this.MAX_RETRIES) {
          const backoff = Math.min(attempt * 5000, 15000); // 5s, 10s, 15s
          console.log(`[Heartbeat] Retrying in ${backoff/1000}s...`);
          await new Promise(r => setTimeout(r, backoff));
        }
      }
    }
    // All retries failed — try fallback method
    fileLog('[Heartbeat] Trying fallback (direct REST API)...');
    try {
      await this._sendFallback();
      fileLog('[Heartbeat] ✅ Fallback method succeeded');
      this.lastSuccessAt = Date.now();
    } catch (fbErr) {
      fileLog('[Heartbeat] ❌❌ ALL methods failed:', fbErr.message);
    }
  }

  async send() {
    let config = loadConfig();
    
    // ── Auto-recover license key if missing ──
    if (!config.licenseKey) {
      fileLog('[Heartbeat] License key missing — attempting recovery...');
      
      // Method 1: Check LicenseGuard stored license
      try {
        if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
        const storedLicense = licenseGuard.loadLicense();
        if (storedLicense && storedLicense.license_key) {
          config.licenseKey = storedLicense.license_key;
          saveConfig(config);
          fileLog('[Heartbeat] ✅ Recovered key from LicenseGuard:', config.licenseKey.substring(0, 15) + '...');
        }
      } catch (e) {
        fileLog('[Heartbeat] LicenseGuard recovery failed:', e.message);
      }
      
      // Method 2: Try cloud recovery by hardware_id
      if (!config.licenseKey) {
        try {
          if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
          const hwId = licenseGuard.getHardwareId();
          const os = require('os');
          fileLog('[Heartbeat] Trying cloud recovery with hardware_id:', hwId.substring(0, 10) + '...');
          const trialResult = await httpPost(`${LICENSING_URL}/license-trial`, {
            hardware_id: hwId,
            hostname: os.hostname(),
            os_info: `${process.platform} ${process.arch}`,
          });
          if (trialResult && trialResult.license && trialResult.license.license_key) {
            config.licenseKey = trialResult.license.license_key;
            saveConfig(config);
            licenseGuard.saveLicense(trialResult.license);
            fileLog('[Heartbeat] ✅ Recovered key from cloud:', config.licenseKey.substring(0, 15) + '...');
          } else if (trialResult && trialResult.error === 'trial_already_exists' && trialResult.license) {
            config.licenseKey = trialResult.license.license_key;
            saveConfig(config);
            licenseGuard.saveLicense(trialResult.license);
            fileLog('[Heartbeat] ✅ Synced existing key from cloud:', config.licenseKey.substring(0, 15) + '...');
          } else {
            fileLog('[Heartbeat] Cloud recovery response:', JSON.stringify(trialResult).substring(0, 200));
          }
        } catch (e) {
          fileLog('[Heartbeat] Cloud recovery failed:', e.message);
        }
      }
      
      if (!config.licenseKey) {
        throw new Error('No license key — all recovery methods failed');
      }
    }
    
    fileLog('[Heartbeat] Sending for key:', config.licenseKey.substring(0, 15) + '...');
    const os = require('os');
    if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
    const hardwareId = licenseGuard.getHardwareId();

    // Gather system metrics
    const cpuPercent = await this._getCpuPercent();
    const totalMem = os.totalmem() / (1024 * 1024 * 1024);
    const freeMem = os.freemem() / (1024 * 1024 * 1024);
    const ramUsed = +(totalMem - freeMem).toFixed(2);

    // Gather service statuses
    const servicesStatus = {};
    if (svcManager) {
      try {
        const statuses = await svcManager.getStatuses();
        if (statuses) Object.assign(servicesStatus, statuses);
      } catch {}
    }

    let dbSizeMb = 0, companiesCount = 0, invoicesCount = 0, usersActive = 0;
    // Real counts from the local PG (companies / users / invoices / db size).
    try {
      const stats = await getLocalDbStats();
      if (stats) {
        dbSizeMb = stats.dbSizeMb;
        companiesCount = stats.companiesCount;
        invoicesCount = stats.invoicesCount;
        usersActive = stats.usersActive;
      }
    } catch {}

    // Gather network info
    let localIps = [];
    try {
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
          if (!net.internal && net.family === 'IPv4') {
            localIps.push({ iface: name, ip: net.address, mac: net.mac });
          }
        }
      }
    } catch {}

    // Disk usage
    let diskUsedPercent = null;
    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        const out = execSync('wmic logicaldisk get size,freespace,caption /format:csv', { encoding: 'utf8', timeout: 5000 });
        const lines = out.trim().split('\n').filter(l => l.includes(','));
        if (lines.length > 1) {
          const parts = lines[1].split(',');
          if (parts.length >= 4) {
            const free = parseInt(parts[2]);
            const total = parseInt(parts[3]);
            if (total > 0) diskUsedPercent = +((1 - free / total) * 100).toFixed(1);
          }
        }
      }
    } catch {}

    // Load local license dates for cloud sync
    let licenseCreatedAt = null, licenseExpiresAt = null, licenseTier = null, licenseStatus = null, daysRemaining = null;
    try {
      const localLicense = licenseGuard.loadLicense();
      if (localLicense) {
        licenseCreatedAt = localLicense.created_at || localLicense.activated_at || null;
        licenseExpiresAt = localLicense.expires_at || null;
        licenseTier = localLicense.tier || 'trial';
        licenseStatus = localLicense.status || 'active';
        if (licenseExpiresAt) {
          daysRemaining = Math.ceil((new Date(licenseExpiresAt).getTime() - Date.now()) / 86400000);
        }
      }
    } catch {}

    // Resolve public IP and geolocation from client side
    let publicIp = null, geoCountry = null, geoCity = null, geoCountryCode = null;
    try {
      const https = require('https');
      const ipData = await new Promise((resolve) => {
        https.get('https://api.ipify.org?format=json', { timeout: 5000 }, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
        }).on('error', () => resolve(null));
      });
      if (ipData && ipData.ip) {
        publicIp = ipData.ip;
        const http = require('http');
        const geoData = await new Promise((resolve) => {
          http.get(`http://ip-api.com/json/${publicIp}?fields=country,city,countryCode`, { timeout: 5000 }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
          }).on('error', () => resolve(null));
        });
        if (geoData) {
          geoCountry = geoData.country || null;
          geoCity = geoData.city || null;
          geoCountryCode = geoData.countryCode || null;
        }
      }
    } catch {}

    // Detect actual Windows edition (Server 2016 vs Windows 10, etc.)
    let osEdition = `${process.platform} ${os.release()} ${process.arch}`;
    try {
      if (process.platform === 'win32') {
        const caption = execSync('wmic os get Caption /format:list', { encoding: 'utf8', timeout: 3000 });
        const match = caption.match(/Caption=(.+)/);
        if (match) osEdition = `${match[1].trim()} (${process.arch})`;
      }
    } catch {}

    // ── الحالة الحقيقية المطبّقة محلياً (الباقة + الموديولات النشطة) للسحابة ──
    // psqlExec يتطلب تشغيل الخدمات؛ نحرسه بـ isRunning ونلفّ كلاً على حدة بـ
    // try/catch كي لا يفشل النبض بسببها أبداً (null/[] عند التعذّر أو التوقّف).
    // ⚠️ \set QUIET on أولاً: بدونه يطبع psql صدى أوامر \pset في stdout
    // («Tuples only is on.» / «Output format is unaligned.») فكان أول سطر يُقرأ
    // كاسم الباقة، وJSON.parse للموديولات يفشل ⇒ reported_plan=نص الصدى
    // وreported_modules=[] على السحابة. نكتم الصدى + نحلّل دفاعياً.
    let currentPlan = null;
    let activeModules = [];
    if (svcManager && svcManager.isRunning()) {
      const PSQL_PREFIX = "\\set QUIET on\n\\pset tuples_only on\n\\pset format unaligned\n";
      try {
        const out = await psqlExec(
          PSQL_PREFIX +
          "SELECT sp.code FROM public.tenant_subscriptions ts JOIN public.subscription_plans sp ON sp.id=ts.plan_id WHERE ts.status IN ('active','trial','grace') ORDER BY ts.updated_at DESC NULLS LAST LIMIT 1;"
        );
        // خذ أول سطر يشبه كود باقة فقط (يتجاهل أي صدى/تحذير متبقٍّ؛ النقطة مسموحة)
        const line = String(out || '').split('\n').map(s => s.trim())
          .find(s => /^[a-z0-9._-]+$/i.test(s));
        if (line) currentPlan = line;
      } catch (e) { fileLog('[Heartbeat] current_plan query skipped:', e.message); }
      try {
        // ⚠️ LIMIT 1 يجب أن يختار «باقة واحدة» لا «عنصراً واحداً» — الصيغة القديمة
        // وضعته بعد jsonb_array_elements_text فقصّت الموديولات لعنصر واحد.
        const out = await psqlExec(PSQL_PREFIX + require('./heartbeat-queries').ACTIVE_MODULES_SQL);
        // خذ أول سطر يبدأ بـ[ (مصفوفة JSON) — مناعة ضد أسطر الصدى
        const line = String(out || '').split('\n').map(s => s.trim())
          .find(s => s.startsWith('['));
        if (line) { const parsed = JSON.parse(line); if (Array.isArray(parsed)) activeModules = parsed; }
      } catch (e) { fileLog('[Heartbeat] active_modules query skipped:', e.message); }
    }

    this._lastPayload = {
      license_key: config.licenseKey,
      hardware_id: hardwareId,
      app_version: app.getVersion(),
      subdomain: config.subdomain || null,
      hostname: os.hostname(),
      os_info: osEdition,
      os_type: osEdition,
      os_platform: process.platform,
      os_arch: process.arch,
      os_release: os.release(),
      local_ips: localIps,
      users_active: usersActive,
      companies_count: companiesCount,
      invoices_count: invoicesCount,
      db_size_mb: dbSizeMb,
      storage_used_mb: 0,
      cpu_percent: cpuPercent,
      cpu_model: os.cpus().length > 0 ? os.cpus()[0].model : 'unknown',
      cpu_cores: os.cpus().length,
      ram_used_gb: ramUsed,
      ram_total_gb: +totalMem.toFixed(2),
      disk_used_percent: diskUsedPercent,
      uptime_hours: +(os.uptime() / 3600).toFixed(1),
      services_status: servicesStatus,
      errors: [],
      license_created_at: licenseCreatedAt,
      license_expires_at: licenseExpiresAt,
      license_tier: licenseTier,
      license_status: licenseStatus,
      days_remaining: daysRemaining,
      public_ip: publicIp,
      geo_country: geoCountry,
      geo_city: geoCity,
      geo_country_code: geoCountryCode,
      current_plan: currentPlan,       // الباقة الفعلية المطبّقة محلياً (لا مجرد tier الرخصة)
      active_modules: activeModules,   // الموديولات الفعلية للباقة النشطة
    };

    // The license KEY is authoritative for free-vs-paid, NOT the mutable isFree
    // flag or the cached license.dat tier — a stale isFree=true (or tier='free')
    // left over from a free→paid transition used to pin the install to the free
    // package forever, so its real cloud tier (e.g. PRO) never synced. Free keys
    // are FREE-2026-* (or an unbound/empty key); anything else is a real license.
    const _lkey = String(config.licenseKey || '');
    const _looksFree = (!_lkey || _lkey.startsWith('FREE'));
    if (!_looksFree && config.isFree === true) {
      config.isFree = false;
      try { saveConfig(config); } catch (e) {}
      fileLog('[Heartbeat] 🔧 cleared stale isFree for real license key ' + _lkey);
    }

    // FREE installs: register/refresh the stable cloud number (binds the local
    // placeholder → FREE-2026 on the first online beat), track last-seen, honor a
    // remote revoke/suspend, sync the smart limits, and back up to our cloud.
    // ⚠️ يعمل مسار المجاني فقط عند اختيار المستخدم الصريح (config.isFree===true).
    // سابقاً كان يعمل أيضاً عند getInfo().tier==='free'، لكنه يقصُر الدائرة (return
    // بالأسفل قبل مزامنة السحابة) ⇒ قفل ميت: license.dat يبقى free فلا تصل مزامنة
    // trial أبداً ⇒ تذبذب/عدم رجوع للمدفوع إلا بـrestart. الآن: التجريبية/المدفوعة
    // (isFree=false) لا تُشغّل مسار المجاني ⇒ النبض يزامن tier الحقيقي من السحابة.
    if (config.isFree === true) {
      const reg = await registerFreeOnline();   // null when offline
      if (reg && reg.license_key) {
        if (reg.license_key !== config.licenseKey) {
          config.licenseKey = reg.license_key;
          saveConfig(config);
          try { const l = licenseGuard.loadLicense(); if (l) { l.license_key = reg.license_key; licenseGuard.saveLicense(l); } } catch (e) {}
          this._lastPayload.license_key = reg.license_key;
          fileLog('[Heartbeat] 🆓→🔗 Free bound to stable cloud number:', reg.license_key);
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('license-updated', { tier: 'free', license_key: reg.license_key, status: reg.status });
        }
        if (reg.status === 'revoked' || reg.status === 'suspended') {
          try { licenseGuard.setLocalStatus(reg.status); } catch (e) {}
          const msg = reg.status === 'suspended' ? 'تم إيقاف النسخة مؤقتاً — تواصل مع الدعم' : 'تم إلغاء النسخة — تواصل مع الدعم';
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('license-warning', msg);
          try { if (svcManager) await svcManager.stopAll(); } catch (e) {}
        } else if (reg.status === 'active') {
          try { const inf = licenseGuard.getInfo(); if (inf && (inf.status === 'revoked' || inf.status === 'suspended')) licenseGuard.setLocalStatus('active'); } catch (e) {}
        }
      }
      // Refresh the admin module grant + limits from the cloud FIRST (so an admin's
      // enable/DISABLE of a module for this license propagates on free too — the free
      // path used to skip this, so a removed module never disappeared). tier forced
      // to 'free' so a trial-keyed free install is never flipped. Then gate as free.
      try {
        const sRaw = await httpPostRpc('licensing_get_license_state', { p_license_key: config.licenseKey });
        const st = typeof sRaw === 'string' ? (sRaw ? JSON.parse(sRaw) : null) : sRaw;
        if (st) { st.tier = 'free'; licenseGuard.applyCloudState(st); }
      } catch (e) { fileLog('[Heartbeat] free grant refresh skipped:', e.message); }
      await syncActivePlan('free');
      if (String(config.licenseKey || '').startsWith('FREE-2026')) {
        this._uploadCloudBackup(config);
      }
      fileLog('[Heartbeat] 🆓 Free beat done (key=' + (config.licenseKey || '') + ').');
      return;
    }

    fileLog('[Heartbeat] Calling Edge Function: license-heartbeat...');
    const result = await httpPost(`${LICENSING_URL}/license-heartbeat`, this._lastPayload);
    fileLog('[Heartbeat] Edge Function response:', JSON.stringify(result).substring(0, 200));
    
    // Cloud REVOKED / SUSPENDED this license (manual action OR a blocked
    // device). Enforce it: persist the status locally so the guard blocks the
    // next start, stop the running services, and notify. Crucially we must NOT
    // fall through to the auto-re-register branch below (which would silently
    // hand out a fresh trial and undo the revoke — the old bug).
    if (result && (result.code === 'REVOKED' || result.code === 'SUSPENDED')) {
      const st = result.code === 'SUSPENDED' ? 'suspended' : 'revoked';
      console.warn(`[Heartbeat] License ${st} by server — locking this device.`);
      fileLog(`[Heartbeat] 🔒 License ${st} — locking.`);
      try { if (licenseGuard) licenseGuard.setLocalStatus(st); } catch (e) { console.warn('[Heartbeat] setLocalStatus:', e.message); }
      const msg = st === 'suspended'
        ? 'تم إيقاف الترخيص مؤقتاً — تواصل مع الدعم'
        : 'تم إلغاء الترخيص على هذا الجهاز — تواصل مع الدعم';
      if (mainWindow) mainWindow.webContents.send('license-warning', msg);
      try { if (svcManager) await svcManager.stopAll(); } catch (e) { console.warn('[Heartbeat] stopAll:', e.message); }
    }
    // If the license is not found in cloud:
    //  • TRIAL → land on Free (offline) instead of silently minting a fresh
    //    trial. This closes the old infinite-trial loophole (delete the cloud
    //    row and you'd get an endless new trial).
    //  • Paid/Free → leave untouched (never auto-downgrade; may be transient).
    else if (result && (result.code === 'NOT_FOUND' || result.accepted === false)) {
      const cfg = loadConfig();
      if (cfg.isTrial === true) {
        console.warn('[Heartbeat] Trial not in cloud — landing on Free (offline).');
        fileLog('[Heartbeat] Trial license missing from cloud → landing on Free.');
        landTrialToFree();
      } else {
        fileLog('[Heartbeat] License not in cloud — leaving license untouched.');
      }
    } else if (result && result.command === 'STOP') {
      console.warn('[Heartbeat] Server says STOP — license issue');
      if (mainWindow) mainWindow.webContents.send('license-warning', result.warning || 'License expired or revoked');
    } else if (result && result.warning) {
      if (mainWindow) mainWindow.webContents.send('license-warning', result.warning);
    } else if (result && result.accepted === true) {
      // Healthy/active again → clear any local lock left from a previous
      // revoke/suspend/block (recovery after the admin reactivates/unblocks).
      try {
        if (licenseGuard) {
          const inf = licenseGuard.getInfo();
          if (inf && (inf.status === 'revoked' || inf.status === 'suspended')) {
            licenseGuard.setLocalStatus('active');
            fileLog('[Heartbeat] 🔓 License reactivated by server — local lock cleared.');
          }
        }
      } catch (e) { console.warn('[Heartbeat] recovery:', e.message); }
    }
    fileLog('[Heartbeat] ✅ Sent OK —', result?.command || 'OK');

    // Pull the authoritative license state (tier / expiry / limits / modules)
    // and apply it locally — on this beat if online, else the next one.
    await this._syncLicenseState(config);

    // بعد نجاح syncActivePlan (داخل _syncLicenseState): اكتب الحالة الحقيقية في
    // حقل منفصل applied_modules — ⚠️ ليس enabled_modules! الكتابة في enabled_modules
    // كانت: (١) تلوّث منحة الأدمن حين modules_admin_set=true (تحقن core وتُبقي
    // موديولات سحبها الأدمن)، فأي syncActivePlan أوفلاين في تلك النافذة يعيد فتح
    // موديولات مسحوبة؛ (٢) تتصارع مع applyCloudState كل نبضة (core موجود محلياً
    // وغائب بمنحة السحابة) = churn حفظ+IPC دائم. applied_modules للعرض/التشخيص فقط
    // ولا يقرأه أي مسار تقييد.
    try {
      if (licenseGuard && Array.isArray(activeModules) && activeModules.length) {
        const lic = licenseGuard.loadLicense();
        if (lic && JSON.stringify(lic.applied_modules || null) !== JSON.stringify(activeModules)) {
          lic.applied_modules = activeModules;
          licenseGuard.saveLicense(lic);
          fileLog('[Heartbeat] 🔄 applied_modules synced to real applied state (' + activeModules.length + ' modules).');
        }
      }
    } catch (e) { fileLog('[Heartbeat] applied_modules local sync skipped:', e.message); }

    // Upload TCDB cloud backup (twice daily or when file changes)
    this._uploadCloudBackup(config);
  }

  // Pull the authoritative license state and apply it to the local license.
  // Shared by the periodic heartbeat AND the instant realtime push, so an
  // admin's tier change / extension / revoke / block reaches this device fast.
  async _syncLicenseState(config) {
    try {
      if (!config || !config.licenseKey || !licenseGuard) return false;
      const stateRaw = await httpPostRpc('licensing_get_license_state', { p_license_key: config.licenseKey });
      const state = typeof stateRaw === 'string' ? (stateRaw ? JSON.parse(stateRaw) : null) : stateRaw;
      if (!state || !state.tier) return false;

      // ⚠️ Respect the user's explicit FREE choice: the cloud tier for a trial key
      // is 'trial', but a free install must NOT be flipped back to trial/paid by a
      // sync. Force free here so applyCloudState + syncActivePlan stay on free. The
      // admin module grant + limits still apply (via enabled_modules/modules_admin_set).
      const cfg = loadConfig();
      const isFree = !!(cfg && cfg.isFree === true);
      if (isFree) state.tier = 'free';

      // tier / expiry / limits / modules → license.dat (does not touch status)
      const changed = licenseGuard.applyCloudState(state);
      if (changed) {
        fileLog(`[Heartbeat] 🔁 License synced from cloud → tier=${state.tier}${isFree ? ' (free-locked)' : ''}`);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('license-updated', state);
      }

      // Align modules + limits (tier→plan) + the admin per-license module grant.
      // Pass 'free' when the user chose free so the cloud trial tier can't override it.
      await syncActivePlan(isFree ? 'free' : undefined);

      // Enforce status pushed instantly (revoke / suspend / block lock the
      // device now; reactivation clears the local lock for recovery).
      if (state.status === 'revoked' || state.status === 'suspended') {
        licenseGuard.setLocalStatus(state.status);
        const msg = state.status === 'suspended'
          ? 'تم إيقاف الترخيص مؤقتاً — تواصل مع الدعم'
          : 'تم إلغاء الترخيص على هذا الجهاز — تواصل مع الدعم';
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('license-warning', msg);
        try { if (svcManager) await svcManager.stopAll(); } catch (e) { console.warn('[Heartbeat] stopAll:', e.message); }
      } else if (state.status === 'active') {
        const inf = licenseGuard.getInfo();
        if (inf && (inf.status === 'revoked' || inf.status === 'suspended')) {
          licenseGuard.setLocalStatus('active');
          fileLog('[Heartbeat] 🔓 License reactivated — local lock cleared.');
        }
      }
      return changed;
    } catch (e) { console.warn('[Heartbeat] license-state sync:', e.message); return false; }
  }

  // Fallback: Direct REST API update to Supabase (bypasses Edge Function)
  async _sendFallback() {
    const config = loadConfig();
    if (!config.licenseKey) throw new Error('No license key');

    const https = require('https');
    const os = require('os');
    
    // Minimal heartbeat via direct Supabase PostgREST
    const updateData = {
      last_heartbeat_at: new Date().toISOString(),
      app_version: app.getVersion(),
      hostname: os.hostname(),
      os_info: `${process.platform} ${os.release()} ${process.arch}`,
      cpu_model: os.cpus().length > 0 ? os.cpus()[0].model : 'unknown',
      ram_total_gb: +(os.totalmem() / (1024 * 1024 * 1024)).toFixed(2),
    };

    return new Promise((resolve, reject) => {
      const SUPABASE_URL = 'wzkklenfsaepegymfxfz.supabase.co';
      const SERVICE_KEY = SUPABASE_ANON_KEY;
      const postData = JSON.stringify(updateData);
      const encodedKey = encodeURIComponent(config.licenseKey);
      
      const req = https.request({
        hostname: SUPABASE_URL,
        port: 443,
        path: `/rest/v1/licenses?license_key=eq.${encodedKey}`,
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Prefer': 'return=minimal',
          'Accept-Profile': 'licensing',
          'Content-Profile': 'licensing',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: 10000,
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          if (res.statusCode < 300) resolve({ success: true });
          else reject(new Error(`Fallback HTTP ${res.statusCode}: ${body}`));
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Fallback timeout')); });
      req.write(postData);
      req.end();
    });
  }

  async _uploadCloudBackup(config) {
    try {
      if (!config.licenseKey) return;
      // (2.0.4) a company file in a folder macOS has not allowed (or is still asking about) is not touched: the stat/read below would wait for the prompt
      for (const c0 of [config.currentDbPath, ...((config.companies || []).map((co) => co && (co.tcdbPath || co.storagePath)))].filter((x) => typeof x === 'string' && path.isAbsolute(x))) {
        const g = await BackupManager.defaultAccessGuard(path.dirname(c0));
        if (g && g.ok === false) return;
      }
      
      // Find TCDB file to upload (+ track the active company's name)
      let tcdbPath = null;
      let companyName = (config.companies && config.companies[0] && config.companies[0].name) || null;
      if (config.currentDbPath && fs.existsSync(config.currentDbPath)) {
        tcdbPath = config.currentDbPath;
      } else if (config.companies && config.companies.length > 0) {
        // Check company TCDB paths
        for (const co of config.companies) {
          const p = co.tcdbPath || co.storagePath;
          if (p && fs.existsSync(p)) { tcdbPath = p; companyName = co.name || companyName; break; }
        }
      }
      if (!tcdbPath) {
        // Check default location
        const defaultPath = path.join(DATA_DIR, 'texacore-data.tcdb');
        if (fs.existsSync(defaultPath)) tcdbPath = defaultPath;
      }
      
      if (!tcdbPath) return; // No TCDB file to upload

      const stats = fs.statSync(tcdbPath);
      const fileSizeMb = +(stats.size / (1024 * 1024)).toFixed(2);
      
      // Skip if file too large (> 100MB)
      if (fileSizeMb > 100) return;
      
      // Upload twice daily (every 12 hours) OR immediately if file size changed
      const TWELVE_HOURS = 12 * 60 * 60 * 1000;
      const fileChanged = this._lastUploadSize !== stats.size;
      const timeElapsed = !this._lastUploadTime || (Date.now() - this._lastUploadTime >= TWELVE_HOURS);
      
      if (!fileChanged && !timeElapsed) {
        return; // File unchanged and not time for scheduled upload yet
      }

      // Real counts from the local PG (invoices/companies) for the metadata.
      const localStats = await getLocalDbStats();
      const invoicesCount = localStats ? localStats.invoicesCount : 0;
      const companiesCount = (localStats && localStats.companiesCount) || config.companies?.length || 1;

      // Upload file via Edge Function (it has service_role access)
      const fileBuffer = fs.readFileSync(tcdbPath);
      const fileBase64 = fileBuffer.toString('base64');

      const fileName = path.basename(tcdbPath);
      const result = await httpPost(`${LICENSING_URL}/license-cloud-backup`, {
        license_key: config.licenseKey,
        file_base64: fileBase64,
        file_size_mb: fileSizeMb,
        db_size_mb: fileSizeMb,
        companies_count: companiesCount,
        invoices_count: invoicesCount,
        backup_type: 'auto',
        company_name: companyName || 'الشركة',
        file_name: fileName,
      });

      if (result && result.success) {
        this._lastUploadSize = stats.size;
        this._lastUploadTime = Date.now();
        // The edge function stores only the FILE (no DB row). Record the
        // metadata row ourselves — with the company name + the storage path it
        // returned — so the cloud table shows it. The trigger prunes to 5/day.
        try {
          await httpPostRpc('licensing_record_cloud_backup', {
            p_license_key: config.licenseKey,
            p_company_name: companyName || 'الشركة',
            p_file_name: fileName,
            p_file_path: result.file_path || fileName,
            p_file_size_mb: fileSizeMb,
            p_db_size_mb: fileSizeMb,
            p_companies_count: companiesCount,
            p_invoices_count: invoicesCount,
            p_backup_type: 'auto',
          });
        } catch (e) { console.warn('[CloudBackup] record failed:', e.message); }
        console.log(`[CloudBackup] ✅ Uploaded + recorded ${fileName} (${fileSizeMb}MB) for ${companyName || '?'}`);
      } else {
        console.warn('[CloudBackup] Upload response:', JSON.stringify(result));
      }
    } catch (err) {
      console.warn('[CloudBackup] Upload failed:', err.message);
    }
  }

  // Upload the ORIGINAL .rsf source file to the cloud (one per company) and
  // keep a local per-company copy. The cloud record RPC replaces any previous
  // RSF for the same company, so re-opening the same file updates it in place
  // instead of duplicating. Called once per RSF import (not periodically).
  async _uploadRsfBackup(config, rsfSourcePath, companyName) {
    try {
      if (!config || !config.licenseKey) return;

      // 1) Persist a local per-company copy of the original .rsf.
      const rsfStoreDir = path.join(DATA_DIR, 'rsf');
      if (!fs.existsSync(rsfStoreDir)) fs.mkdirSync(rsfStoreDir, { recursive: true });
      const safeName = (companyName || 'company').replace(/[\\/:*?"<>|]/g, '_');
      const localRsf = path.join(rsfStoreDir, safeName + '.rsf');
      try {
        if (rsfSourcePath && fs.existsSync(rsfSourcePath) &&
            path.resolve(rsfSourcePath) !== path.resolve(localRsf)) {
          fs.copyFileSync(rsfSourcePath, localRsf);
        }
      } catch (cpErr) { console.warn('[CloudBackup] RSF local copy failed:', cpErr.message); }

      const uploadPath = fs.existsSync(localRsf) ? localRsf
        : (rsfSourcePath && fs.existsSync(rsfSourcePath) ? rsfSourcePath : null);
      if (!uploadPath) return;

      const fstats = fs.statSync(uploadPath);
      const fileSizeMb = +(fstats.size / (1024 * 1024)).toFixed(2);
      if (fileSizeMb > 100) { console.warn('[CloudBackup] RSF too large, skipping:', fileSizeMb, 'MB'); return; }

      // 2) Upload via the same edge function used for TCDB (service_role side).
      const fileName = safeName + '.rsf';
      const fileBase64 = fs.readFileSync(uploadPath).toString('base64');
      const localStats = await getLocalDbStats();
      const invoicesCount = localStats ? localStats.invoicesCount : 0;
      const companiesCount = (localStats && localStats.companiesCount) || config.companies?.length || 1;

      const result = await httpPost(`${LICENSING_URL}/license-cloud-backup`, {
        license_key: config.licenseKey,
        file_base64: fileBase64,
        file_size_mb: fileSizeMb,
        db_size_mb: fileSizeMb,
        companies_count: companiesCount,
        invoices_count: invoicesCount,
        backup_type: 'rsf',
        company_name: companyName || 'الشركة',
        file_name: fileName,
      });

      if (result && result.success) {
        // 3) Record the metadata row (RPC replaces any prior RSF for this company).
        try {
          await httpPostRpc('licensing_record_cloud_backup', {
            p_license_key: config.licenseKey,
            p_company_name: companyName || 'الشركة',
            p_file_name: fileName,
            p_file_path: result.file_path || fileName,
            p_file_size_mb: fileSizeMb,
            p_db_size_mb: fileSizeMb,
            p_companies_count: companiesCount,
            p_invoices_count: invoicesCount,
            p_backup_type: 'rsf',
          });
        } catch (e) { console.warn('[CloudBackup] RSF record failed:', e.message); }
        console.log(`[CloudBackup] ✅ RSF uploaded + recorded ${fileName} (${fileSizeMb}MB) for ${companyName || '?'}`);
      } else {
        console.warn('[CloudBackup] RSF upload response:', JSON.stringify(result));
      }
    } catch (err) {
      console.warn('[CloudBackup] RSF upload failed:', err.message);
    }
  }

  _getCpuPercent() {
    const os = require('os');
    return new Promise((resolve) => {
      const cpus1 = os.cpus();
      setTimeout(() => {
        const cpus2 = os.cpus();
        let totalIdle = 0, totalTick = 0;
        for (let i = 0; i < cpus2.length; i++) {
          const c1 = cpus1[i].times, c2 = cpus2[i].times;
          const idle = c2.idle - c1.idle;
          const total = (c2.user - c1.user) + (c2.nice - c1.nice) + (c2.sys - c1.sys) + (c2.irq - c1.irq) + idle;
          totalIdle += idle;
          totalTick += total;
        }
        resolve(totalTick > 0 ? +((1 - totalIdle / totalTick) * 100).toFixed(1) : 0);
      }, 1000);
    });
  }
}

const heartbeatSender = new HeartbeatSender();

// ─── IPC Handlers ────────────────────────────────────────────

// Get app version + build date
ipcMain.on('get-local-api-secret', (event) => { event.returnValue = (svcManager && svcManager.localApiSecret) || ''; });

ipcMain.handle('get-version', () => {
  const pkg = require('../package.json');
  return {
    version: app.getVersion(),
    buildDate: pkg.buildDate || 'unknown'
  };
});

// ─── 2.0.5 RC2 launcher: network address choice, recent backups, a backup now, opening a company file from another computer, the run log ───────────────────
// «تغيير» beside the network address: the owner picks which of THIS computer's addresses the office link carries (or goes back to the automatic pick).
ipcMain.handle('set-lan-address', async (_, address) => {
  try {
    const cfg = loadConfig();
    const a = typeof address === 'string' ? address.trim() : '';
    if (!a) delete cfg.lanAddress;                               // back to the automatic pick
    else {
      const known = require('./lan-address').listLanCandidates(require('os').networkInterfaces()).some((c) => c.address === a);
      if (!known) return { success: false, error: 'not an address of this computer' };
      cfg.lanAddress = a;
    }
    saveConfig(cfg);
    return { success: true, lan: lanAddressProvider.info() };
  } catch (e) { return { success: false, error: e.message }; }
});

// The newest backups this program keeps: the daily snapshots next to the live file, the copies taken before a company file replaced the companies, and the ones the owner took
// with «نسخة الآن». Metadata only (a path is data); the window never receives file contents.
function listRecentBackups(limit = 3) {
  const out = [];
  const live = liveCompanyFile();
  const liveBase = live ? path.basename(live).replace(/\.tcdb$/i, '') : '';
  const add = (dir, re, kind, prefix) => {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (!re.test(n) || (prefix && !n.startsWith(prefix))) continue;
      const p = path.join(dir, n);
      try { const st = fs.statSync(p); if (st.isFile()) out.push({ path: p, name: n, kind, mtimeMs: st.mtimeMs, size: st.size }); } catch { /* vanished */ }
    }
  };
  const snapDirs = new Set([path.join(DATA_DIR, 'backups', 'snapshots')]);
  if (backupManager && backupManager.snapshotDir) snapDirs.add(backupManager.snapshotDir);
  if (live) snapDirs.add(path.join(path.dirname(live), 'snapshots'));
  for (const d of snapDirs) add(d, /\.\d{4}-\d{2}-\d{2}\.tcdb$/, 'daily', liveBase ? liveBase + '.' : '');
  add(path.join(DATA_DIR, 'backups', 'pre-open'), /^before-open-.*\.tcdb$/, 'pre-open');
  add(path.join(DATA_DIR, 'backups', 'manual'), /^manual-.*\.tcdb$/, 'manual');
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { total: out.length, items: out.slice(0, limit) };
}
ipcMain.handle('list-backups', async (_, limit) => {
  try { return { success: true, ...listRecentBackups(Math.max(1, Math.min(10, Number(limit) || 3))) }; }
  catch (e) { return { success: false, items: [], total: 0, error: e.message }; }
});

// «نسخة الآن»: one complete .tcdb of every company into <app data>/backups/manual (the newest 10 are kept). The live file and its sync are not touched.
ipcMain.handle('create-backup', async () => {
  try {
    if (!svcManager || !svcManager.isRunning()) return { success: false, code: 'SERVICES_DOWN', error: 'الخدمات غير شغّالة — شغّل النظام أولاً' };
    const dir = path.join(DATA_DIR, 'backups', 'manual');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `manual-${livePolicy.localStamp(new Date())}.tcdb`);
    const r = await newBackupManager().exportTo(target);
    try {   // keep the newest 10 manual copies; only files named manual-*.tcdb are ever touched
      const names = fs.readdirSync(dir).filter((n) => /^manual-.*\.tcdb$/.test(n)).sort();
      while (names.length > 10) fs.unlinkSync(path.join(dir, names.shift()));
    } catch { /* pruning is best effort */ }
    fileLog('[Backup] a manual backup was written:', r.path, r.size);
    return { success: true, path: r.path, size: r.size };
  } catch (e) { return { success: false, code: e.code || null, error: e.message }; }
});

// «فتح ملف…» (red zone): the launcher picks a company file in the OS window, the MAIN process remembers which file it was, and opening it later never takes a
// path from the window. Opening replaces every company: the first call without `confirmReplaceAll` answers REPLACE_ALL_CONFIRM_REQUIRED (+ the list) when the
// database holds companies; the window asks, and only an explicit yes calls again - the pre-open backup is taken inside restoreTcdbFromPath.
let launcherPick = null;
ipcMain.handle('launcher-pick-company-file', async () => {
  try {
    const result = await showNativeDialog('open', { title: 'فتح ملف شركة — TexaCore', filters: [{ name: 'TexaCore Database', extensions: ['tcdb'] }], properties: ['openFile'] });
    if (result.canceled || !result.filePaths || !result.filePaths.length) return { success: false, canceled: true };
    const p = result.filePaths[0];
    if (!/\.tcdb$/i.test(p)) return { success: false, code: 'UNSUPPORTED', error: 'Unsupported file type' };
    launcherPick = { path: p };
    return { success: true, name: path.basename(p), dir: path.dirname(p) };
  } catch (e) { return { success: false, error: e.message, code: e.code || null }; }
});
ipcMain.handle('launcher-open-picked-file', async (_, opts) => {
  if (!launcherPick) return { success: false, code: 'NO_PICK', error: 'no file was picked' };
  try {
    const out = await restoreTcdbFromPath(launcherPick.path, { confirmReplaceAll: livePolicy.isConfirmed(opts && opts.confirmReplaceAll) });
    if (out && out.success) launcherPick = null;
    return out;
  } catch (e) {
    fileLog('[OpenTCDB] ❌ (launcher)', e.message);
    return { success: false, error: e.message, code: e.code || null, ...(e && e.replaceAll ? e.replaceAll : {}) };
  }
});

// «فتح سجل التشغيل»
ipcMain.handle('open-run-log', async () => {
  if (HARNESS_OK && process.env.TEXACORE_STUB_SHELL === '1') { fileLog('[Shell] would open the log:', LOG_FILE); return { success: true, stubbed: true, path: LOG_FILE }; }
  const err = await shell.openPath(LOG_FILE);
  return err ? { success: false, error: err } : { success: true, path: LOG_FILE };
});

// The address office PCs type to reach this computer. Picked by src/lan-address.js: the interface carrying the default route if it is a real
// adapter, else en* / eth* / Wi-Fi / Ethernet, else a private-range address - never a VPN tunnel (utun*, tun*, ...) or a link-local address.
// 2.0.5 RC2: config.lanAddress is the owner's choice from the launcher's «network address» picker (used only while that address still exists on this machine)
const lanAddressProvider = require('./lan-address').createLanAddressProvider({ networkInterfaces: () => require('os').networkInterfaces(), platform: process.platform,
  getOverride: () => { try { const a = loadConfig().lanAddress; return typeof a === 'string' && a ? a : null; } catch { return null; } } });
function getLocalIpAddress() {
  return lanAddressProvider.get();
}

// Get initial state
ipcMain.handle('get-state', async () => {
  const config = loadConfig();

  // Use LicenseGuard for encrypted license validation
  if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
  let licenseResult = licenseGuard.validate();
  // Expired trial → land on Free so the UI shows an active free plan (not "expired").
  if (!licenseResult.valid && licenseResult.reason === 'expired' && landTrialToFree()) {
    licenseResult = licenseGuard.validate();
  }
  const hasLicense = licenseResult.valid;
  const licenseInfo = licenseGuard.getInfo();

  const health = svcManager ? await svcManager.getHealth() : { running: false, health: 'stopped' };

  return {
    config,
    dockerInstalled: true,   // Always true — no Docker needed
    dockerRunning: true,     // Always true — no Docker needed
    containerRunning: health.running,
    containerHealth: health.health,
    hasLicense,
    licenseInfo,
    port: config.port || APP_PORT,
    localIp: getLocalIpAddress(),
    lan: lanAddressProvider.info(),                  // 2.0.5 RC2: { address, iface, auto, candidates[] } for the «network address» picker
    liveFile: liveCompanyFile(),
    osLocale: app.getLocale(),
    tunnel: svcManager ? svcManager.getTunnelStatus() : null,   // the real connector state (never inferred from "services running")
  };
});

// Persist the chosen UI language (so it sticks across restarts).
ipcMain.handle('set-ui-lang', async (_, lang) => {
  try {
    const cfg = loadConfig();
    cfg.uiLang = lang;
    saveConfig(cfg);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Activate license
ipcMain.handle('activate-license', async (_, licenseKey) => {
  try {
    if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);

    const hardwareId = licenseGuard.getHardwareId();

    const result = await httpPost(`${LICENSING_URL}/license-activate`, {
      license_key: licenseKey,
      hardware_id: hardwareId,
      os_info: `${process.platform} ${process.arch}`,
      hostname: require('os').hostname(),
    });

    if (result.success) {
      ensureDataDir();
      // Save encrypted license (hardware-bound)
      licenseGuard.saveLicense(result.license);
      const config = loadConfig();
      config.licenseKey = licenseKey;
      config.isFree = false;   // activating a real key clears the free flag
      config.isTrial = false;
      saveConfig(config);
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('license-updated', { tier: result.license?.tier, status: result.license?.status });
      // إعادة التشغيل تُنفّذها الواجهة (stopERP→startERP) بعد النجاح — التدفّق المُثبت.
      // Start heartbeat monitoring
      heartbeatSender.start();
      return { success: true, license: result.license };
    }

    return { success: false, error: result.error || 'Activation failed' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// «إصلاح الرابط»: the same repair the automatic once-per-start attempt and /api/tunnel-fix use (service-manager.repairTunnelLink). No admin secret crosses the renderer.
ipcMain.handle('repair-tunnel-link', async () => {
  if (!svcManager) return { success: false, outcome: 'network', code: null };
  try { return await svcManager.repairTunnelLink({ trigger: 'user' }); }
  catch (e) { return { success: false, outcome: 'network', code: null, error: e.message }; }
});

// Register Subdomain via Supabase Edge Function
ipcMain.handle('register-subdomain', async (_, subdomain) => {
  try {
    const config = loadConfig();
    const licenseKey = config.licenseKey || 'unknown_license';
    
    // Call the Edge Function
    const result = await httpPost(`${LICENSING_URL}/register-subdomain`, {
      licenseKey,
      subdomain,
      // register-subdomain refuses a licence bound to hardware unless machineId IS that hardware id (the hostname never matches)
      machineId: (() => { try { if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR); return licenseGuard.getHardwareId(); } catch { return require('os').hostname(); } })(),
      hostname: require('os').hostname(),
      companyName: 'TexaCore Local Setup' // Optional, could read from config if saved earlier
    });

    if (result.success) {
      config.subdomain = subdomain;
      config.enableCloud = true;
      config.tunnelToken = result.tunnel_token;
      saveConfig(config);
      // Bring the tunnel up with the freshly-minted token. Stop any running
      // cloudflared first (it may still hold the OLD/deleted token), then start
      // with the new one. skipVerify: the just-created DNS record may not have
      // propagated to public DNS yet, but cloudflared connects to the Cloudflare
      // edge via the token regardless — so the tunnel comes up right away.
      if (svcManager) {
        try { await svcManager.stopCloudflared(); } catch { /* wasn't running */ }
        svcManager.resetRouteState();      // a new name: forget the old verdict, any «name taken» and the repair history
        svcManager.startCloudflared({ skipReregister: true, skipVerify: true })
          .catch(e => console.warn('[register-subdomain] tunnel start failed:', e.message));
      }
      return { success: true, url: result.url };
    }

    return { success: false, error: result.error || 'Failed to register subdomain' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Verify the saved subdomain still exists in DNS. The user may have deleted it
// from Cloudflare / the cloud dashboard, leaving the installer holding a dead
// subdomain from a previous setup (it would just serve a blank/error page).
// Returns { valid, reason }. The renderer uses 'deleted' to prompt the user to
// create a new subdomain instead of showing a broken cloud URL.
ipcMain.handle('verify-subdomain', async () => {
  const config = loadConfig();
  if (!config.subdomain) return { valid: false, reason: 'none' };
  // isolated release checks (the same switch that skips the DNS lookup before starting the tunnel): the fake name of a check is not in the public DNS, and the window must stay on the active view
  if (process.env.TEXACORE_TUNNEL_SKIP_DNS === '1' && HARNESS_OK) return { valid: true, reason: 'harness', subdomain: config.subdomain };
  try {
    const ips = await require('dns').promises.resolve4(`${config.subdomain}.texacore.ai`);
    return { valid: Array.isArray(ips) && ips.length > 0, reason: 'resolved', subdomain: config.subdomain };
  } catch (e) {
    // ENOTFOUND / ENODATA = no such DNS record = the subdomain was deleted.
    // Any other error (network/timeout) → assume alive so we never falsely prompt.
    if (e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA')) {
      return { valid: false, reason: 'deleted', subdomain: config.subdomain };
    }
    return { valid: true, reason: 'dns_error', subdomain: config.subdomain };
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Run a psql command via embedded binary */
function psqlExec(sql) {
  if (!svcManager) return Promise.reject(new Error('Services not initialized'));
  return svcManager.psqlExec(sql);
}

// ── License → Plan sync ─────────────────────────────────────────────────────
// مصدر واحد للحقيقة: syncActivePlan (يقرأ tier من licenseGuard، cloud-aware عبر
// النبض، ويستخدم apply_tenant_plan النظيف). أُزيلت دالة syncTenantsToLicenseTier
// المكرّرة لأنها كانت تتصارع معه (تقرأ license.dat محلياً قد يكون قديماً=free بينما
// السحابة=trial) فتتناوب الباقة بين professional وfree. الآن الكل عبر syncActivePlan.

// ── إعادة تشغيل المحرّكات عند تغيير الرخصة ───────────────────────────────────
// أضمن من تحديث المتصفح المستمر، ويفيد التحصين: تحقّق رخصة جديد + إعادة اشتقاق
// الباقة من الرخصة على إقلاع نظيف بلا حالة قديمة في الذاكرة. يوقف كل الخدمات ثم
// يُقلعها ويطبّق الباقة. الواجهة تعيد الاتصال عند «Open in browser»/التحديث.
function _waitPortFree(port, timeoutMs) {
  return new Promise((resolve) => {
    const net = require('net');
    const deadline = Date.now() + (timeoutMs || 15000);
    const probe = () => {
      const s = net.connect({ host: '127.0.0.1', port }, () => { s.destroy(); // لا يزال مستمعاً
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(probe, 500);
      });
      s.on('error', () => { s.destroy(); resolve(true); }); // المنفذ حرّ
    };
    probe();
  });
}

async function restartEnginesForLicenseChange() {
  try {
    if (!svcManager) return;
    const cfg = loadConfig();
    const PGP = (typeof ServiceManager !== 'undefined' && ServiceManager.PG_PORT) ? ServiceManager.PG_PORT : 54322;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('system-restarting', {});
    fileLog('[Restart] 🔄 إعادة تشغيل المحرّكات بعد تغيير الرخصة…');
    try { await svcManager.stopAll(); } catch (e) { fileLog('[Restart] stopAll:', e.message); }
    // انتظر تحرّر منفذ PG فعلياً قبل الإقلاع (يمنع «PostgreSQL exited unexpectedly»)
    await _waitPortFree(PGP, 15000);
    await new Promise(r => setTimeout(r, 1500));
    const startOpts = {
      dbPassword: cfg.dbPassword || undefined,
      port: cfg.port || APP_PORT,
      onMigrationProgress: (step, total, name) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('migration-progress', { step, total, name });
      },
    };
    let result = await svcManager.startAll(startOpts);
    if (!result || !result.success) {   // محاولة ثانية بعد مهلة (تعافٍ من فشل عابر)
      fileLog('[Restart] startAll فشل، إعادة المحاولة:', result && result.error);
      try { await svcManager.stopAll(); } catch {}
      await _waitPortFree(PGP, 15000); await new Promise(r => setTimeout(r, 2500));
      result = await svcManager.startAll(startOpts);
    }
    if (!result || !result.success) { fileLog('[Restart] ❌ فشل الإقلاع بعد محاولتين:', result && result.error); return; }
    await syncActivePlan();  // تطبيق الباقة حسب مستوى الرخصة على الإقلاع النظيف
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('system-restarted', { port: cfg.port || APP_PORT });
    fileLog('[Restart] ✅ اكتملت إعادة التشغيل وتطبيق الباقة.');
  } catch (e) {
    fileLog('[Restart] خطأ:', e.message);
  }
}

/** Make an HTTP request to GoTrue via API proxy */
function gotrueRequest(method, reqPath, body, { serviceRoleKey, apiPort }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    // Connect directly to GoTrue (port 9999) instead of via API Proxy (54321)
    // because the proxy may not be running yet during RSF import
    const gotruePort = (svcManager && svcManager.activeGotruePort) || ServiceManager.GOTRUE_PORT;
    const options = {
      hostname: '127.0.0.1',
      port: gotruePort,
      path: reqPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Main Company Creation Logic ─────────────────────────────────────────────
// 2.0.0: tenant + owner + company are created by src/provisioning.js (owner_email / is_tenant_admin set on every path, the
// company created through the SERVER functions signed in as that admin, EMAIL_EXISTS refused before any write, no GoTrue
// lookup-by-email). This wrapper adds the installer-side bookkeeping: the .tcdb backup file and the vendor support account.

/** What provisioning.js needs: loopback service URLs + a DB connection + the plan sync for the new tenant. */
function provisioningDeps() {
  return svcManager.provisioningDeps({
    ensureSubscription: (tenantId) => syncActivePlan(undefined, { tenantId, throwOnError: true }),
  });
}

async function handleCreateLocalCompany(companyData) {
  try {
    fileLog('[TexaCore] Starting company creation:', companyData && companyData.companyName);

    // ── Guard: Services must be running ─────────────────────────
    if (!svcManager || !svcManager.isRunning()) {
      return { success: false, error: 'الخدمات غير شغّالة. يرجى تشغيل النظام أولاً.' };
    }

    // The backup file name is chosen by the caller: a plain "<name>" (we append .tcdb), never a path. (storagePath is the folder the
    // user picked for their backups and may be anywhere — it is the file name inside it that must not escape it.)
    if (companyData && companyData.dbFileName != null && companyData.dbFileName !== ''
        && !netGuard.safeUploadName(String(companyData.dbFileName) + '.tcdb', { ext: '.tcdb' })) {
      return { success: false, code: 'INVALID_FILE_NAME', error: 'Invalid backup file name' };
    }

    // ── 0. (2.0.4) macOS folder permission: ask about the folder the company file will live in BEFORE any database work. A folder macOS has not allowed
    //       (or is still asking about) answers FOLDER_PERMISSION and nothing is created; `fileFolderFallback: 'program'` (the user's choice on the permission
    //       step) keeps the company file in the program's own folder instead, which needs no permission. ──
    if (companyData && companyData.fileFolderFallback !== 'program') {
      const pre = companyData.rsfSourceRef ? pickedFiles.get(companyData.rsfSourceRef) : null;
      let need = null;
      if (pre && pre.type === 'rsf') need = path.dirname(pre.filePath);
      else if (companyData.storagePath) need = String(companyData.storagePath).startsWith('~') ? path.join(require('os').homedir(), String(companyData.storagePath).slice(1)) : String(companyData.storagePath);
      else if (pre || companyData.purpose === 'rsf_import') need = companyFile.defaultCompanyDir();
      if (need && path.isAbsolute(need)) {
        const v = await folderAccess.ensureUsable(need, { waitMs: 3000 });
        if (v.state !== 'allowed' && v.state !== 'missing' && v.state !== 'error') {
          fileLog('[TexaCore] Company creation held back: no permission for the', v.kind, 'folder (' + v.state + ')');
          return { success: false, code: 'FOLDER_PERMISSION', area: v.kind, state: v.state, error: folderPermissionError(v).message };
        }
      }
    }

    // ── 0b. (2.0.5) the companies already in this database and the file that holds them: a company created NEXT TO others must not take the live file away ──
    let companiesBefore = [];
    try { companiesBefore = await listLocalCompanies(); } catch (e) { fileLog('[TexaCore] could not list the existing companies before creating one:', e.message); }
    const liveBefore = liveCompanyFile();

    // ── 1. Create tenant, owner, company (server functions, as the admin) ──
    const result = await provisioning.createLocalCompany(provisioningDeps(), companyData);
    if (!result.success) {
      fileLog('[TexaCore] Company creation refused/failed:', result.code, result.error);
      return result;
    }
    const { tenantId, companyId, adminEmail, accessToken, refreshToken } = result;
    const anonKey = svcManager.anonKey;
    fileLog('[TexaCore] Tenant, admin and company created:', companyId);
    // 2.0.5: the live file belongs to the WHOLE database. Other companies exist and a file is already syncing them ⇒ it stays (see step 2).
    const filePlan = livePolicy.planNewCompanyFile({ existingCompanyCount: companiesBefore.length, liveFilePath: liveBefore });

    // ── 2. Where the .tcdb backup file lives + remember the company for backup auto-resume ──
    // 2.0.2: a company made from a Rashid file picked in the native dialog (rsfSourceRef) keeps its file BESIDE that Rashid file, named after it
    // (<folder of the .rsf>/<rsf name>.tcdb) - the way 1.x's import-rsf-path did and the way Rashid itself keeps its file. Any other new company
    // keeps the folder/name it asked for, and a rsf_import company with neither goes to the default TexaCore folder instead of having NO file.
    // In every case an existing .tcdb is never the target: the name gets " (2)", " (3)"... so a new company's first backup cannot replace another's file.
    let tcdbFilePath = null;
    let tcdbPlacement = null;       // 'beside-rsf' | 'chosen' | 'default' | 'fallback-default'
    let tcdbFallbackReason = null;
    const config = loadConfig();
    const pickedSource = companyData.rsfSourceRef ? pickedFiles.get(companyData.rsfSourceRef) : null;
    let storageDir = companyData.storagePath || null;
    try {
      let dir = null; let base = null;
      if (companyData.fileFolderFallback === 'program') {
        dir = path.join(DATA_DIR, 'company-files'); base = companyData.companyName || companyData.dbFileName || 'company'; tcdbPlacement = 'program-folder';
      }
      if (!dir && pickedSource && pickedSource.type === 'rsf') {
        const plan = companyFile.rsfCompanyFilePlan(pickedSource.filePath);
        const w = companyFile.folderIsWritable(plan.dir);
        if (w.ok) { dir = plan.dir; base = plan.base; tcdbPlacement = 'beside-rsf'; }
        else { tcdbFallbackReason = w.reason; fileLog('[TexaCore] The Rashid file folder is not writable (' + w.reason + ') - using the default folder'); }
      }
      if (!dir && companyData.storagePath) {
        let basePath = companyData.storagePath;
        if (basePath.startsWith('~')) basePath = path.join(require('os').homedir(), basePath.slice(1));
        dir = basePath; base = companyData.dbFileName || 'my_company'; tcdbPlacement = 'chosen';
      }
      if (!dir && (pickedSource || companyData.purpose === 'rsf_import')) {
        dir = companyFile.defaultCompanyDir(); base = companyData.companyName || 'company';
        tcdbPlacement = tcdbFallbackReason ? 'fallback-default' : 'default';
      }
      if (dir) {
        if (!fs.existsSync(dir) && !filePlan.keepLive) fs.mkdirSync(dir, { recursive: true });   // (a file that is only recorded does not need its folder created yet)
        // a name another company already planned counts as taken too (two recorded files must never be the same path)
        const takenByConfig = new Set([...(config.companies || []).map((co) => co && co.plannedTcdbPath), filePlan.keepLive ? filePlan.liveFilePath : null].filter(Boolean).map((x) => path.resolve(x)));
        tcdbFilePath = companyFile.uniqueTcdbPath(dir, base, (cand) => fs.existsSync(cand) || takenByConfig.has(path.resolve(cand)));
        storageDir = dir;
        fileLog('[TexaCore] Backup file path:', tcdbFilePath, '(' + tcdbPlacement + ')');
      }
    } catch (err) {
      console.warn('[TexaCore] Could not setup backup path:', err.message);
    }
    // A company made from a Rashid file keeps TWO copies in step: the one beside the Rashid file and one in the program's own backup folder
    // (<app data>/backups/<same name>) - the user's folder may be a USB stick, a cloud folder or deleted; the program's copy is always there.
    let tcdbCopyPath = null;
    if (tcdbFilePath && !filePlan.keepLive && (pickedSource || companyData.purpose === 'rsf_import')) {
      try { tcdbCopyPath = companyFile.programCopyPath(DATA_DIR, tcdbFilePath); } catch (err) { console.warn('[TexaCore] Could not choose the program copy path:', err.message); }
    }
    // 2.0.5: the live file stays ⇒ this company's chosen file is only RECORDED (a planned entry - the per-company mode of a later round) and the answer says where the data really is.
    if (filePlan.keepLive) {
      config.companies = livePolicy.recordPlannedCompany(config.companies, {
        name: companyData.companyName, companyId, tenantId,
        plannedTcdbPath: tcdbFilePath, plannedStoragePath: storageDir, placement: tcdbPlacement,
      }, filePlan.liveFilePath);
      saveConfig(config);
      tcdbCopyPath = null;   // the program's second copy belongs to the live file's own company
      fileLog('[TexaCore] The live company file stays', filePlan.liveFilePath, '- this company\'s chosen file is only recorded:', tcdbFilePath);
    } else {
      config.storagePath = storageDir;
      config.companies = [{ name: companyData.companyName, tcdbPath: tcdbFilePath, storagePath: storageDir, ...(tcdbCopyPath ? { copyPath: tcdbCopyPath } : {}) }];
      saveConfig(config);
    }
    if (companyData.rsfSourceRef) pickedFiles.drop(companyData.rsfSourceRef);

    // ── 3. Vendor support account (vendor's own machine only) ──
    try {
      const vendor = getVendorAccount(DATA_DIR);
      if (vendor) {
        await provisioning.ensureVendorSupport(provisioningDeps(), { vendor, tenantId, companyId });
        fileLog('[TexaCore] Support account provisioned');
      } else {
        fileLog('[TexaCore] No vendor-support account — skipping support super-admin (customer install).');
      }
    } catch (saErr) {
      console.warn('[TexaCore] Support account setup skipped:', saErr.message); // never blocks company creation
    }

    // ── 4. Real-time backup sync ── (2.0.5: only when this company's file IS the live file; otherwise the existing manager keeps syncing the whole database)
    if (tcdbFilePath && !filePlan.keepLive) {
      try {
        // 2.0.2: this company replaces the previous one in config.companies - its manager must stop writing to the previous company's files
        if (backupManager) { try { backupManager.stopSync(); } catch { /* already stopped */ } }
        backupManager = new BackupManager({
          pgBinDir: path.join(svcManager.binsDir, 'pg', 'bin'),
          dbHost: '127.0.0.1',
          dbPort: ServiceManager.PG_PORT,
          dbName: 'postgres',
          dbUser: 'postgres',
          dbPassword: svcManager.dbPassword,
          backupPath: tcdbFilePath,
          secondaryBackupPath: tcdbCopyPath,   // 2.0.2: the program's own copy (kept in step on every run; null for a company made by hand)
          encryptionKey: UNIFIED_BACKUP_KEY, // موحّد: يفتح على أي جهاز (#4)
          dataDir: DATA_DIR, // lets restore also try the license key (#4)
          intervalMs: 60 * 1000,
          onProgress: (phase, detail) => {
            console.log(`[Backup] ${phase}: ${detail}`);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('backup-progress', { phase, detail });
            }
          },
          onError: (err) => console.error('[Backup] Error:', err.message),
        });
        backupManager.startSync();
        fileLog('[TexaCore] Real-time backup started → ' + tcdbFilePath);

        const cfg = loadConfig();
        if (cfg.licenseKey) {
          backupManager.configureCloudSync({
            licensingUrl: LICENSING_URL,
            licenseKey: cfg.licenseKey,
            cloudIntervalMs: 6 * 60 * 60 * 1000, // every 6 hours
          });
          backupManager.startCloudSync();
          cfg.currentDbPath = tcdbFilePath;
          heartbeatSender._uploadCloudBackup(cfg).catch(e =>
            console.warn('[TexaCore] Initial cloud backup failed:', e.message)
          );
        }
      } catch (backupErr) {
        console.warn('[TexaCore] Backup init failed:', backupErr.message);
      }
    }

    return {
      success: true,
      companyId,
      tenantId,
      adminEmail,
      anonKey,
      // 2.0.5 RC2: a company added to a signed-in admin's own tenant (callerAccessToken) opens NO new session: the page keeps the one it has
      ...(result.attached ? { attached: true, adminUserId: result.adminUserId, localCurrency: result.localCurrency } : { accessToken, refreshToken }),
      provisioningKey: result.provisioningKey || undefined,
      createdSource: result.createdSource || undefined,
      // 2.0.2: where this company's .tcdb is (null = no file was set up) and why there
      // 2.0.5: when the live file stayed (sharedLiveFile) `tcdbPath` is the file the data REALLY goes to (the live one) and the file the company chose is `plannedTcdbPath`
      tcdbPath: filePlan.keepLive ? filePlan.liveFilePath : tcdbFilePath, tcdbPlacement, tcdbFallbackReason: tcdbFallbackReason || undefined,
      tcdbCopyPath: tcdbCopyPath || undefined,
      ...(filePlan.keepLive ? { sharedLiveFile: true, liveFilePath: filePlan.liveFilePath, plannedTcdbPath: tcdbFilePath || undefined, companiesInFile: companiesBefore.length + 1 } : {}),
      cloudFolder: ((filePlan.keepLive ? filePlan.liveFilePath : tcdbFilePath) && companyFile.detectCloudFolder(path.dirname(filePlan.keepLive ? filePlan.liveFilePath : tcdbFilePath))) || undefined,
      // The SPA talks to the unified API gateway (routes /auth + /rest + adds CORS), NOT GoTrue directly.
      supabaseUrl: `http://localhost:${svcManager.activeApiPort}`
    };

  } catch (err) {
    console.error('[TexaCore] Company creation error:', err.message);
    return { success: false, error: err.message };
  }
}

ipcMain.handle('create-local-company', async (_, companyData) => {
  return handleCreateLocalCompany(companyData);
});

// ─── Backup IPC Handlers ─────────────────────────────────────
ipcMain.handle('backup-now', async () => {
  if (!backupManager) return { success: false, error: 'Backup not initialized' };
  const result = await backupManager.backup();
  const st = backupManager.getStatus();
  return result ? { success: true, ...result, targets: st.targets } : { success: false, error: (st.lastError && st.lastError.message) || 'Backup failed', lastError: st.lastError, targets: st.targets };
});

// 2.0.2: the installer window's «show in Finder» for one backup target (only a file this manager keeps in step, or an existing .tcdb)
ipcMain.handle('reveal-backup', async (_, filePath) => {
  const p = typeof filePath === 'string' ? path.resolve(filePath) : '';
  let ok = false;
  try { ok = /\.tcdb$/i.test(p) && fs.statSync(p).isFile(); } catch { ok = false; }
  if (!ok) return { success: false, error: 'No such company file' };
  if (HARNESS_OK && process.env.TEXACORE_HEADLESS === '1') E2E_DIALOG.reveal.push(p); else shell.showItemInFolder(p);
  return { success: true };
});

ipcMain.handle('backup-status', async () => {
  // 2.0.5: + the live file (also when no manager is running yet) and how many companies recorded a file of their own, for the read-only «where is my data» line of the main screen
  let planned = 0;
  try { planned = (loadConfig().companies || []).filter((c) => c && c.planned === true).length; } catch { planned = 0; }
  const base = backupManager ? backupManager.getStatus() : { syncing: false, running: false, targets: [] };
  return { ...base, liveFile: liveCompanyFile(), plannedCompanies: planned };
});

// ─── 2.0.5 RC2: «تغيير المكان» - move the live company file to another folder ─────────────────────────────────────────────────────────────
// The safe sequence (permission → space → pause the sync → copy → verify bytes + container → switch → resume; the old file is KEPT) is
// live-file-move.js; this is only its wiring to the backup manager, the config, the native folder window and the macOS folder permission.
const liveFileMover = liveFileMove.createLiveFileMover({
  liveFile: () => liveCompanyFile(),
  // the native folder chooser (the E2E_DIALOG 'open' stub answers it in harness runs, like every other native dialog)
  pickFolder: async ({ defaultPath }) => {
    let start = null;
    try {
      if (defaultPath && path.isAbsolute(defaultPath)) { const v = await folderAccess.ensureUsable(defaultPath, { waitMs: 1500 }); if (v.state === 'allowed') start = defaultPath; }
    } catch { start = null; }
    const r = await showNativeDialog('open', {
      title: 'مكان ملف الشركة الجديد — TexaCore',
      ...(start ? { defaultPath: start } : {}),
      buttonLabel: 'نقل الملف إلى هنا',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return { canceled: true };
    return { dir: r.filePaths[0] };
  },
  requireFolderAccess: (dir) => requireFolderAccess(dir),
  // pause the one-minute sync: no run may be in the middle of replacing the file while it is copied; the newest data is flushed into the OLD file first
  quiesce: async () => {
    const bm = backupManager;
    if (!bm) return { ok: true, resume: () => {} };
    if (bm._restoring) return { ok: false };
    const wasSyncing = !!bm._timer;
    try { bm.stopSync(); } catch { /* not running */ }
    const idle = await bm.waitIdle();
    if (!idle || bm._restoring) { if (wasSyncing) bm.startSync(); return { ok: false }; }
    if (svcManager && svcManager.isRunning() && bm.backupPath) { try { await bm.backup(); } catch (e) { fileLog('[Move] the last flush into the old file failed:', e && e.message); } }
    bm.holdWrites = true;
    return { ok: true, resume: () => { bm.holdWrites = false; if (wasSyncing) bm.startSync(); } };
  },
  probe: (buf) => (backupManager || newBackupManager()).probeAccess(buf),
  // SWITCH: config first (a failed save changes nothing), then the running manager; a restore that re-pointed the manager meanwhile aborts the switch
  commit: ({ from, to, dir }) => {
    const bm = backupManager;
    if (bm && bm.backupPath && !sameFile(bm.backupPath, from)) throw new Error('the live company file changed while it was being moved');
    const cfg = loadConfig();
    cfg.companies = livePolicy.moveLiveEntry(cfg.companies, from, to);
    cfg.storagePath = dir;
    if (cfg.currentDbPath && sameFile(cfg.currentDbPath, from)) cfg.currentDbPath = to;
    saveConfig(cfg);
    if (bm && bm.backupPath) {
      bm.backupPath = to;
      bm.snapshotDir = companyFile.isCompanyFolder(dir) ? null : path.join(DATA_DIR, 'backups', 'snapshots');
    }
  },
  log: (...a) => fileLog(...a),
});
/** opts = { dir?: string } - without `dir` the native folder chooser opens. Never throws: { success:true, from, to, kept:true, bytes } or { success:false, code, error }. */
async function moveLiveFile(opts) {
  try {
    const r = await liveFileMover.move({ dir: opts && typeof opts.dir === 'string' ? opts.dir : undefined });
    return r && r.success ? { ...r, cloudFolder: companyFile.detectCloudFolder(path.dirname(r.to)) || undefined } : r;
  } catch (e) {
    fileLog('[Move] failed:', e && e.message);
    return { success: false, code: (e && e.code) || 'MOVE_FAILED', error: String((e && e.message) || e).slice(0, 300) };
  }
}
ipcMain.handle('move-live-file', async (_, opts) => moveLiveFile(opts));

ipcMain.handle('backup-restore', async (_, filePath, opts) => {
  if (!backupManager) return { success: false, error: 'Backup not initialized' };
  try {
    // 2.0.5: this replaces every company too - same gate and same backup-first rule as opening a company file
    const replaceSnapshot = await assertReplaceAllConfirmed({ confirmReplaceAll: opts && opts.confirmReplaceAll });
    await takePreOpenBackup(replaceSnapshot);
    const result = await backupManager.restore(filePath);
    // Inject the vendor support account (vendor machine only) into the restored DB.
    try { if (svcManager) await svcManager._ensureSuperAdmin(); } catch (e) { console.warn('[Restore IPC] vendor inject:', e.message); }
    // Re-apply the admin-portal password (the restore replaced the DB).
    try { if (svcManager) await svcManager.syncAdminPassword(); } catch (e) { console.warn('[Restore IPC] admin pw sync:', e.message); }
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.message, code: e.code || null, ...(e && e.replaceAll ? e.replaceAll : {}) };
  }
});

// ─── RSF Import (Al-Rasheed) ────────────────────────────────

ipcMain.handle('detect-file-type', async (_, filePath) => {
  try {
    return { success: true, type: detectFileType(filePath) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('rsf-summary', async (_, filePath) => {
  try {
    const reader = new RsfReader(filePath);
    await reader.open();
    const summary = reader.getSummary();
    reader.close();
    return { success: true, summary };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('import-rsf', async (_, filePath) => {
  return { success: false, error: 'The installer-side Rashid import was removed in 2.0.0 — use the import wizard inside the app.' };
});
ipcMain.handle('export-rsf', async (_, rsfPath) => {
  try {
    const { Client } = require('pg');
    const pgClient = new Client({
      host: '127.0.0.1', port: ServiceManager.PG_PORT,
      database: 'postgres', user: 'postgres',
      password: svcManager.dbPassword,
    });
    await pgClient.connect();

    const { rows: companies } = await pgClient.query("SELECT id, tenant_id FROM companies LIMIT 1");
    if (companies.length === 0) {
      pgClient.end();
      return { success: false, error: 'لا توجد شركة' };
    }

    const exporter = new RsfExporter({
      rsfPath,
      pgClient,
      companyId: companies[0].id,
      tenantId: companies[0].tenant_id,
      onProgress: (step, current, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('rsf-progress', { step, current, total });
        }
      },
    });

    const result = await exporter.exportAll();
    await pgClient.end();
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

let rsfSyncManager = null;

// ─── Auto-start backup on app launch (if company exists) ─────
function initBackupOnStartup() {
  try {
    const config = loadConfig();
    if (!config.companies || config.companies.length === 0) return;

    const company = livePolicy.liveEntryOf(config.companies);   // 2.0.5: the live entry, never a planned per-company one
    if (!company) return;
    const tcdbPath = company.tcdbPath || company.storagePath;
    if (!tcdbPath) return;

    let encKey = 'texacore-default-backup-key-2026';
    try {
      if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
      const lic = licenseGuard.loadLicense();
      if (lic && lic.license_key) encKey = lic.license_key;
    } catch (e) { /* use default */ }

    backupManager = new BackupManager({
      pgBinDir: path.join(svcManager.binsDir, 'pg', 'bin'),
      dbHost: 'localhost',
      dbPort: ServiceManager.PG_PORT,
      dbName: 'postgres',
      dbUser: 'postgres',
      dbPassword: svcManager.dbPassword,
      backupPath: tcdbPath,
      secondaryBackupPath: company.copyPath || null,   // 2.0.2: the program's own second copy of a Rashid-made company
      encryptionKey: UNIFIED_BACKUP_KEY, // موحّد: يفتح على أي جهاز (#4)
      dataDir: DATA_DIR, // restore still tries the license key for old files
      intervalMs: 60 * 1000,
      onProgress: (phase, detail) => {
        console.log(`[Backup] ${phase}: ${detail}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('backup-progress', { phase, detail });
        }
      },
      onError: (err) => console.error('[Backup] Error:', err.message),
    });

    backupManager.startSync();
    fileLog('[TexaCore] Auto-backup started on launch → ' + tcdbPath);
  } catch (e) {
    console.warn('[TexaCore] Auto-backup init skipped:', e.message);
  }
}


// ─── 2.0.2: company files — the native pick, a one-off export, "show in the folder" ───────────────────────────────────────────
// The ERP page runs in the user's browser and cannot know a file's folder; this app can. So the page asks THIS app (through the guarded admin
// API below: loopback + the per-install secret) to open the native dialog, and the app keeps what was picked under an opaque reference.
// 1.x did the same for a Rashid file (GET /api/open-tcdb → the path → POST /api/import-rsf-path, which wrote <folder of the .rsf>/<name>.tcdb);
// the dialog code is that route's, now shared (showNativeDialog), and so is the config.companies[].tcdbPath/storagePath bookkeeping.
const pickedFiles = companyFile.createPickRegistry();

// ─── 2.0.4: folder permission (macOS TCC) + the search job ────────────────────────────────────────────────────────────────────────────────────
// Every touch of Desktop / Documents / Downloads / iCloud Drive / a volume goes through `folderAccess` first (a child process asks; macOS' prompt
// blocks THAT child, never this event loop). The harness can pretend (HARNESS_OK only, via POST /api/e2e-folder-access): a fake verdict per area,
// scratch folders standing in for the areas, and files that behave like cloud placeholders - so the packaged app is driven through every path
// without touching the real privacy settings.
const E2E_FS = { sim: {}, kinds: {}, placeholders: new Map(), settingsOpened: [] };
const e2eKindOf = (p) => {
  if (!HARNESS_OK) return null;
  const r = path.resolve(String(p || ''));
  for (const [prefix, kind] of Object.entries(E2E_FS.kinds)) { const pr = path.resolve(prefix); if (r === pr || r.startsWith(pr + path.sep)) return kind; }
  return null;
};
const folderAccess = folderAccessMod.createFolderAccess({
  simulate: (kind) => (HARNESS_OK ? (E2E_FS.sim[kind] || null) : null),
  kindResolver: e2eKindOf,
});
/** The harness's pretend cloud files: a placeholder path → a download that takes `msPerChunk` per 1 MiB and then makes the file "local". */
const cloudDeps = {
  ...cloudFiles,
  cloudState: async (p, o) => ((HARNESS_OK && E2E_FS.placeholders.has(path.resolve(p))) ? 'placeholder' : cloudFiles.cloudState(p, o)),
  startMaterialize: (p, o) => {
    const key = path.resolve(p);
    const sim = HARNESS_OK ? E2E_FS.placeholders.get(key) : null;
    if (!sim) return cloudFiles.startMaterialize(p, o);
    let state = 'running'; let loaded = 0; let code = null; let timer = null; let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    const total = o.size;
    const finish = (s, c) => { if (state !== 'running') return; state = s; code = c || null; clearInterval(timer); if (s === 'done') { loaded = total; E2E_FS.placeholders.delete(key); } resolveDone({ state, loaded, total, ...(code ? { code } : {}) }); };
    const step = Math.max(1, Math.ceil(total / Math.max(1, sim.steps || 8)));
    timer = setInterval(() => { if (sim.fail) return finish('failed', sim.fail); if (sim.stall) return; loaded = Math.min(total, loaded + step); if (loaded >= total) finish('done'); }, sim.msPerStep || 150);
    return { snapshot: () => ({ state, loaded, total, ...(code ? { code } : {}) }), cancel: () => finish('cancelled'), done };
  },
};
const locateJobs = locateJobMod.createLocateJobs({ folderAccess, cloud: cloudDeps });
let locateJobsRunning = 0;

/** A coded error the page turns into the permission step: the area, and whether macOS is still asking (`pending`) or the answer was no (`denied`). */
function folderPermissionError(v, dir) {
  const err = Object.assign(new Error(v.state === 'pending'
    ? `macOS is asking for access to the ${v.kind} folder - answer its prompt | ينتظر macOS موافقتك على الوصول إلى مجلد ${v.kind}`
    : `TexaCore has no permission for the ${v.kind} folder | لا يملك TexaCore إذن الوصول إلى مجلد ${v.kind}`), { code: 'FOLDER_PERMISSION', area: v.kind, state: v.state, folderCode: v.code || null });
  if (dir) err.dirKind = v.kind;
  return err;
}
/** Resolve when `dir` may be used, or throw FOLDER_PERMISSION. 'missing' (no such area on this Mac) and 'error' (cannot tell) never block: the real operation reports them. */
async function requireFolderAccess(dir, { waitMs = 2500 } = {}) {
  const v = await folderAccess.ensureUsable(dir, { waitMs });
  if (v.state === 'allowed' || v.state === 'missing' || v.state === 'error') return v;
  throw folderPermissionError(v, dir);
}
// the live sync asks before it writes into a protected folder: a blocked write would freeze the whole program
BackupManager.defaultAccessGuard = async (dir) => {
  const v = await folderAccess.ensureUsable(dir, { waitMs: 800 });
  return (v.state === 'allowed' || v.state === 'missing' || v.state === 'error') ? { ok: true } : { ok: false, state: v.state, area: v.kind, code: 'FOLDER_PERMISSION' };
};
const E2E_DIALOG = { open: null, save: null, reveal: [] };   // isolated test runs only (HARNESS_OK): answers for the native dialogs, a log of "show in folder"
let exportInFlight = false;
const MIN_PASSPHRASE_LEN = 6;

/**
 * The native open/save dialog, IN FRONT of the browser that asked for it.
 * The request comes from a page in the user's browser, so the browser is the active app and this app is usually in the background with
 * its window closed to the tray (on macOS: no Dock icon). 2.0.2 attached the panel to a HIDDEN parent and never activated the app, so the
 * panel opened behind the browser and the page sat at «جار فتح الملف…» until the user found it (owner's report, 2026-10-15).
 * Now: (1) the app becomes the active app, (2) the panel hangs from a small transparent host window that sits above every other app's
 * windows, on the screen the pointer is on and on the current Space (a full-screen browser included) — so it is visible even if macOS
 * refuses the activation, (3) when the panel closes and this app had no window open, the app hides itself so the browser is active again.
 */
function dialogHostBounds(screenApi) {
  const W = 1, H = 1;
  try {
    const d = screenApi.getDisplayNearestPoint(screenApi.getCursorScreenPoint());
    const a = d.workArea;   // the panel hangs from the host's top edge: centre it horizontally, a little below the menu bar / top of the work area
    return { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + Math.min(120, a.height / 6)), width: W, height: H };
  } catch {
    return { width: W, height: H };
  }
}

let openNativeDialogs = 0;   // (review rv203 S4) the app hides itself only when the LAST open dialog closes
async function showNativeDialog(kind, options) {
  // A headless harness run NEVER opens a real window: the test answers it (POST /api/e2e-dialog); no answer = the user closed it.
  if (HARNESS_OK && process.env.TEXACORE_HEADLESS === '1') {
    const answer = E2E_DIALOG[kind];
    return kind === 'save' ? { canceled: !answer, filePath: answer || undefined, harness: true } : { canceled: !answer, filePaths: answer ? [answer] : [], harness: true };
  }
  const { dialog: dlg, BrowserWindow: BW, screen: screenApi } = require('electron');
  const isMac = process.platform === 'darwin';
  const appWindowOpen = !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized());
  const host = new BW({
    ...dialogHostBounds(screenApi),
    show: false, frame: false, transparent: true, hasShadow: false, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
    title: 'TexaCore', backgroundColor: '#00000000',
  });
  openNativeDialogs += 1;
  try {
    host.setAlwaysOnTop(true, 'screen-saver');
    if (isMac) {
      try { host.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* older macOS */ }
      try { app.focus({ steal: true }); } catch { /* activation refused: the host's level still keeps the panel above the browser */ }
      host.showInactive();
    } else {
      host.show();
    }
    try { host.focus(); } catch { /* best effort */ }
    return kind === 'save' ? await dlg.showSaveDialog(host, options) : await dlg.showOpenDialog(host, options);
  } finally {
    try { host.destroy(); } catch { /* already gone */ }
    // Give the screen back to the browser: with no TexaCore window open there is nothing of ours to look at.
    openNativeDialogs = Math.max(0, openNativeDialogs - 1);
    if (isMac && !appWindowOpen && openNativeDialogs === 0) { try { app.hide(); } catch { /* best effort */ } }
  }
}

/** A BackupManager on this install's database for one-off work (export / key probe) — it never starts a timer and never touches the live company file. */
function newBackupManager(extra = {}) {
  return new BackupManager({
    pgBinDir: svcManager ? path.join(svcManager.binsDir, 'pg', 'bin') : '',
    dbHost: '127.0.0.1', dbPort: ServiceManager.PG_PORT, dbName: 'postgres', dbUser: 'postgres',
    dbPassword: svcManager ? svcManager.dbPassword : '',
    encryptionKey: UNIFIED_BACKUP_KEY, dataDir: DATA_DIR,
    onProgress: (phase, detail) => {
      console.log(`[Export] ${phase}: ${detail}`);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('backup-progress', { phase, detail });
    },
    onError: (err) => console.error('[Export] Error:', err.message),
    ...extra,
  });
}

/** The folder of the live company file (the one the 60-second sync writes), or null when there is none yet. */
function liveCompanyFile() {
  try {
    if (backupManager && backupManager.backupPath) return backupManager.backupPath;
    const co = livePolicy.liveEntryOf(loadConfig().companies);   // (2.0.5) never a planned per-company entry
    const p = co && (co.tcdbPath || null);
    return p || null;
  } catch { return null; }
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('body too large'), { code: 'BODY_TOO_LARGE' })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(Object.assign(new Error('invalid JSON'), { code: 'BAD_JSON' })); } });
    req.on('error', reject);
  });
}
const sameFile = (a, b) => {
  if (!a || !b) return false;
  const na = path.resolve(a); const nb = path.resolve(b);
  return process.platform === 'linux' ? na === nb : na.toLowerCase() === nb.toLowerCase();
};

/** What a coded file/key error becomes on the wire: a status + the code the page translates (the text is bilingual for logs). */
function fileErrorStatus(code) {
  return ({ PICK_EXPIRED: 404, FILE_NOT_FOUND: 404, FILE_NOT_LOCAL: 504, FILE_TOO_LARGE: 413, EXPORT_EXISTS: 409, EXPORT_IS_LIVE_FILE: 409,
    EXPORT_BUSY: 409, TCDB_PASSPHRASE_REQUIRED: 422, TCDB_BAD_PASSPHRASE: 422, TCDB_CORRUPT: 422, LEGACY_TCDB: 422, PASSPHRASE_TOO_SHORT: 400, BAD_REQUEST: 400, SERVICES_DOWN: 503, EXPORT_EMPTY: 409, NO_PERMISSION: 403, LOCATE_BUSY: 429, BAD_JSON: 400, BODY_TOO_LARGE: 413, RESTORE_BUSY: 409,
    FOLDER_PERMISSION: 403, JOB_EXPIRED: 404, BAD_STATE: 409, NOT_LOCAL: 409, TCDB_UNSAFE_SQL: 422, TCDB_NO_DATA: 422, TCDB_NO_SCHEMA: 422,
    REPLACE_ALL_CONFIRM_REQUIRED: 409, PRE_OPEN_BACKUP_FAILED: 500 })[code] || 500;
}

/** The folders a search for a picked file looks in (harness runs may replace them with scratch folders so they never scan the real profile). */
function locateSearchRoots() {
  const override = (HARNESS_OK && process.env.TEXACORE_E2E_LOCATE_ROOTS)
    ? process.env.TEXACORE_E2E_LOCATE_ROOTS.split(path.delimiter).filter(Boolean) : null;
  let companyDirs = [];
  try {
    for (const co of (loadConfig().companies || [])) {
      if (co && co.tcdbPath) companyDirs.push(path.dirname(co.tcdbPath));
      if (co && co.storagePath) companyDirs.push(co.storagePath);
    }
  } catch { companyDirs = []; }
  const userDirs = [];
  for (const n of ['desktop', 'documents', 'downloads']) { try { userDirs.push(app.getPath(n)); } catch { /* not available on this platform */ } }
  // existsSync on a protected folder would wait for the prompt: the roots are listed from NAMES (the search job asks macOS first and skips what is missing)
  return locateFile.locateRoots({ override, companyDirs, defaultDir: companyFile.defaultCompanyDir(), extraRoots: userDirs, existsSync: (p) => (folderAccess.kindOf(p) ? true : fs.existsSync(p)) });
}

/** Keep a picked / located company file under an opaque reference and describe it to the page (the answer of POST /api/pick-company-file and /api/locate-picked-file). */
function registerPickedFile(filePath, ext) {
  let st = null;
  try { st = fs.statSync(filePath); } catch { /* an evicted iCloud file may have no stat - the read reports it */ }
  const ref = pickedFiles.register({ filePath, type: ext, name: path.basename(filePath), size: st ? st.size : 0 });
  // (filePath/dir are for DISPLAY — "the company file will be saved beside it"; the ref is what the page sends back)
  return {
    success: true, type: ext, ref, name: path.basename(filePath), filePath, dir: path.dirname(filePath), size: st ? st.size : 0,
    cloudOnly: !!(st && companyFile.looksLikeCloudPlaceholder(st)),
    cloudFolder: companyFile.detectCloudFolder(path.dirname(filePath)),   // iCloud / OneDrive / … folder: the page warns once
    companyFilePath: ext === 'rsf' ? companyFile.rsfCompanyFilePlan(filePath).tcdbPath : null,
  };
}
let locateInFlight = false;

/**
 * The company-file routes of the admin API. Called after the server's guards (loopback-only, cross-origin refusal for the destructive set,
 * the per-install secret) — a route here is reachable only by this machine's own programs that hold the secret.
 * @returns {Promise<boolean>} true when the request was one of ours (and was answered)
 */
async function handleCompanyFileRoutes(req, res) {
  const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
  const route = `${req.method} ${urlObj.pathname}`;
  try {
    switch (route) {
      // ── GET /api/backup-export-info: what the "pull a backup" dialog needs to offer "save to the company folder" ──
      case 'GET /api/backup-export-info': {
        const live = liveCompanyFile();
        sendJson(res, 200, {
          success: true, ready: !!(svcManager && svcManager.isRunning()),
          companyFile: live, companyDir: live ? path.dirname(live) : null, defaultDir: companyFile.defaultCompanyDir(),
          passphraseMinLength: MIN_PASSPHRASE_LEN, platform: process.platform,
        });
        return true;
      }

      // ── GET /api/live-file-info (2.0.5): the ONE file the whole database is saved to right now + the companies in it + the files companies chose for later ──
      //    The company wizard says «all companies are saved in one file: <path>» from this; mode tells a later page whether per-company files are on.
      case 'GET /api/live-file-info': {
        const live = liveCompanyFile();
        let companies = null;
        try { if (svcManager && svcManager.isRunning()) companies = await listLocalCompanies(); } catch { companies = null; }
        const planned = (loadConfig().companies || []).filter((c) => c && c.planned === true).map((c) => ({ name: c.name || '', companyId: c.companyId || null, plannedTcdbPath: c.plannedTcdbPath || null }));
        sendJson(res, 200, {
          success: true, mode: 'single-file', liveFile: live,
          companyCount: companies ? companies.length : null,
          companies: companies ? companies.map((c) => ({ id: c.id, name: c.name })) : null,
          planned,
        });
        return true;
      }

      // ── POST /api/export-backup {mode:'company-folder'|'choose', fileBase?, passphrase?} → a .tcdb of the whole company database ──
      case 'POST /api/export-backup': {
        const body = await readJsonBody(req);
        if (!svcManager || !svcManager.isRunning()) throw Object.assign(new Error('الخدمات غير شغّالة | The services are not running'), { code: 'SERVICES_DOWN' });
        const mode = body.mode === 'choose' ? 'choose' : (body.mode === 'company-folder' ? 'company-folder' : null);
        if (!mode) throw Object.assign(new Error('mode must be "company-folder" or "choose"'), { code: 'BAD_REQUEST' });
        const passphrase = typeof body.passphrase === 'string' ? body.passphrase : '';
        if (passphrase && (passphrase.length < MIN_PASSPHRASE_LEN || passphrase.length > 256)) {
          throw Object.assign(new Error(`The passphrase must be ${MIN_PASSPHRASE_LEN}-256 characters`), { code: 'PASSPHRASE_TOO_SHORT' });
        }
        if (exportInFlight) throw Object.assign(new Error('تصدير آخر قيد التنفيذ | Another export is running'), { code: 'EXPORT_BUSY' });
        const live = liveCompanyFile();
        const base = companyFile.safeFileBase(body.fileBase || `TexaCore-backup-${companyFile.localDateStamp()}`, 'TexaCore-backup');
        // (2.0.4) ask macOS before any synchronous touch of the folder (a folder it has not allowed would freeze the program until its prompt is answered)
        let liveDirOk = false;
        if (live) { await requireFolderAccess(path.dirname(live)); liveDirOk = companyFile.folderIsWritable(path.dirname(live)).ok; }
        const startDir = liveDirOk ? path.dirname(live) : companyFile.defaultCompanyDir();
        if (!liveDirOk) await requireFolderAccess(startDir);
        let target; let overwrite = false;
        if (mode === 'company-folder') {
          if (!companyFile.folderIsWritable(startDir).ok) throw Object.assign(new Error(`Cannot write to ${startDir}`), { code: 'FILE_NOT_FOUND' });
          target = companyFile.uniqueTcdbPath(startDir, base);
        } else {
          const r = await showNativeDialog('save', {
            title: 'سحب نسخة احتياطية — TexaCore',
            defaultPath: companyFile.uniqueTcdbPath(startDir, base),
            filters: [{ name: 'TexaCore Database', extensions: ['tcdb'] }],
            properties: ['createDirectory', 'showOverwriteConfirmation'],
          });
          if (r.canceled || !r.filePath) { sendJson(res, 200, { success: false, canceled: true }); return true; }
          target = /\.tcdb$/i.test(r.filePath) ? r.filePath : `${r.filePath}.tcdb`;
          await requireFolderAccess(path.dirname(target));
          // The OS save dialog asks "replace it?" itself — an answer of yes is the user's own explicit choice. A harness answer was never asked.
          overwrite = !r.harness && path.resolve(target) === path.resolve(r.filePath) && fs.existsSync(target);   // "report" confirmed != "report.tcdb" replaced
        }
        if (sameFile(target, live)) throw Object.assign(new Error('هذا هو ملف الشركة الحي — اختر اسماً آخر | That is the live company file - choose another name'), { code: 'EXPORT_IS_LIVE_FILE' });
        exportInFlight = true;
        let out;
        try { out = await newBackupManager({ backupPath: target }).exportTo(target, { passphrase, overwrite }); } finally { exportInFlight = false; }
        fileLog('[Export] backup written:', out.path, out.size, 'bytes', out.encrypted ? '(passphrase)' : '');
        sendJson(res, 200, { success: true, path: out.path, name: path.basename(out.path), dir: path.dirname(out.path), size: out.size, encrypted: out.encrypted, mode, durationMs: out.duration, cloudFolder: companyFile.detectCloudFolder(path.dirname(out.path)) });
        return true;
      }

      // ── POST /api/pick-save-location {suggestedName?, dir?}: where a NEW company's file will live - the OS save window, default
      //    <default TexaCore folder>/<name>.tcdb. Nothing is written; the page puts the answer in the company form (storagePath + dbFileName). ──
      case 'POST /api/pick-save-location': {
        const body = await readJsonBody(req);
        const base = companyFile.safeFileBase(body.suggestedName || 'my_company', 'my_company');
        let dir = typeof body.dir === 'string' && body.dir ? body.dir : companyFile.defaultCompanyDir();
        if (dir.startsWith('~')) dir = path.join(require('os').homedir(), dir.slice(1));
        // (2.0.4) existsSync on a protected folder waits for macOS' prompt: ask first (a folder that is not allowed is simply not the start folder)
        if (path.isAbsolute(dir)) { const v0 = await folderAccess.ensureUsable(dir, { waitMs: 1500 }); if (v0.state !== 'allowed' && v0.state !== 'missing' && v0.state !== 'error') dir = null; }
        if (!dir || !path.isAbsolute(dir) || !fs.existsSync(dir)) dir = companyFile.defaultCompanyDir();
        if (folderAccess.kindOf(dir)) { const v1 = await folderAccess.ensureUsable(dir, { waitMs: 1500 }); if (v1.state !== 'allowed' && v1.state !== 'missing' && v1.state !== 'error') dir = DATA_DIR; }
        const r = await showNativeDialog('save', {
          title: 'مكان ملف الشركة — TexaCore',
          defaultPath: path.join(dir, `${base}.tcdb`),
          filters: [{ name: 'TexaCore Database', extensions: ['tcdb'] }],
          properties: ['createDirectory'],
        });
        if (r.canceled || !r.filePath) { sendJson(res, 200, { success: false, canceled: true }); return true; }
        const chosen = path.resolve(/\.tcdb$/i.test(r.filePath) ? r.filePath : `${r.filePath}.tcdb`);
        const chosenDir = path.dirname(chosen);
        await requireFolderAccess(chosenDir);
        const w = companyFile.folderIsWritable(chosenDir);
        if (!w.ok) throw Object.assign(new Error(`Cannot write to ${chosenDir} (${w.reason})`), { code: w.reason === 'ENOENT' ? 'FILE_NOT_FOUND' : 'NO_PERMISSION' });
        const fileBase = path.basename(chosen).replace(/\.tcdb$/i, '');
        // an existing file is NEVER replaced by a new company: it gets " (2)" - the page shows the real name once the company is created
        const willBe = companyFile.uniqueTcdbPath(chosenDir, fileBase);
        sendJson(res, 200, {
          success: true, dir: chosenDir, fileBase, tcdbPath: willBe, renamed: willBe !== chosen,
          cloudFolder: companyFile.detectCloudFolder(chosenDir),
        });
        return true;
      }

      // ── POST /api/reveal-in-folder {path}: show a company file in Finder / Explorer ──
      case 'POST /api/reveal-in-folder': {
        const body = await readJsonBody(req);
        const p = typeof body.path === 'string' ? path.resolve(body.path) : '';
        let ok = false;
        try { ok = /\.tcdb$/i.test(p) && fs.statSync(p).isFile(); } catch { ok = false; }
        if (!ok) throw Object.assign(new Error('No such company file'), { code: 'FILE_NOT_FOUND' });
        if (HARNESS_OK && process.env.TEXACORE_HEADLESS === '1') E2E_DIALOG.reveal.push(p);   // a test run never opens a Finder window
        else shell.showItemInFolder(p);
        sendJson(res, 200, { success: true, path: p });
        return true;
      }

      // ── POST /api/pick-company-file: the native open dialog (the 1.x GET /api/open-tcdb dialog) → a reference to what was picked ──
      case 'POST /api/pick-company-file': {
        const r = await showNativeDialog('open', {
          title: 'فتح ملف شركة — TexaCore / الرشيد',
          filters: [
            { name: 'Al-Rasheed / TexaCore', extensions: ['rsf', 'tcdb'] },
            { name: 'Al-Rasheed', extensions: ['rsf'] },
            { name: 'TexaCore Database', extensions: ['tcdb'] },
          ],
          properties: ['openFile'],
        });
        if (r.canceled || !r.filePaths || !r.filePaths[0]) { sendJson(res, 200, { success: false, canceled: true }); return true; }
        const filePath = path.resolve(r.filePaths[0]);
        const ext = path.extname(filePath).toLowerCase().slice(1);
        if (ext !== 'rsf' && ext !== 'tcdb') { sendJson(res, 400, { success: false, code: 'BAD_REQUEST', error: 'Unsupported file type' }); return true; }
        fileLog('[Pick] picked', ext, filePath);
        sendJson(res, 200, registerPickedFile(filePath, ext));
        return true;
      }

      // ── POST /api/locate-picked-file {name, size, lastModified, sha256}: 2.0.3 — the page picked the file in the BROWSER's own chooser (always in front, any mode),
      //    so it holds the bytes but not the place. Find the real file on this computer by exact name + exact size + the SHA-256 of the whole content, register it exactly
      //    like a native pick (so «company file beside the Rashid file» and «open the .tcdb IN PLACE» keep working), or answer NOT_FOUND (HTTP 200) so the page falls back.
      //    A path is revealed ONLY for a file whose full content hashes equal to the caller's digest - the caller already has those bytes. ──
      case 'POST /api/locate-picked-file': {
        const q = locateFile.validateLocateBody(await readJsonBody(req));
        if (locateInFlight) throw Object.assign(new Error('A search for a picked file is already running'), { code: 'LOCATE_BUSY' });
        locateInFlight = true;
        try {
          // 2.0.3 protocol (kept for pages that still use it). 2.0.4: a protected folder whose permission is not granted yet is LEFT OUT - reading it
          // would wait for the macOS prompt - and the answer says so (the 2.0.4 page uses the job routes below, which wait for the user properly).
          const override = !!(HARNESS_OK && process.env.TEXACORE_E2E_LOCATE_ROOTS);
          const allRoots = locateSearchRoots();
          const roots = [];
          for (const r0 of allRoots) { const v = await folderAccess.ensureUsable(r0, { waitMs: 1500 }); if (v.state === 'allowed') roots.push(r0); }
          const r = await locateFile.locatePickedFile(q, { roots, useMdfind: !override });
          // (counts only - never the candidate list)
          fileLog('[Pick] locate', q.ext, `roots=${r.stats.roots} spotlight=${r.stats.spotlight} dirs=${r.stats.walkDirs}${r.stats.walkTimedOut ? ' (time budget)' : ''} candidates=${r.stats.candidates} hashed=${r.stats.hashed} matches=${r.stats.matches}`);
          if (!r.found) {
            sendJson(res, 200, r.reason === 'ambiguous' ? { success: false, code: 'NOT_FOUND', reason: 'ambiguous' } : { success: false, code: 'NOT_FOUND' });
            return true;
          }
          fileLog('[Pick] located', q.ext, r.filePath);
          sendJson(res, 200, registerPickedFile(r.filePath, q.ext));
          return true;
        } finally {
          locateInFlight = false;
        }
      }

      // ═══ 2.0.4: the search for the picked file as a JOB the page follows (see locate-job.js) ═══
      // POST /api/locate-start {name,size,lastModified}   → {job, phase, ...}: searches by METADATA in the background (a protected folder only after macOS said yes)
      // GET  /api/locate-status?job=…                     → phase (searching | waiting-permission | ready | not-found | permission-denied | cancelled), the areas
      //                                                     being asked about, the candidates (opaque ids + state - never a path), the download progress
      // POST /api/locate-materialize {job}                → download the iCloud / cloud placeholders (progress in status)
      // POST /api/locate-confirm {job, sha256}            → the page hashed the (now local) file: a path is answered ONLY for a file with that full content
      // POST /api/locate-cancel {job}
      case 'POST /api/locate-start': {
        const q = locateFile.validateLocateBody(await readJsonBody(req), { requireHash: false });
        const roots = locateSearchRoots();
        const id = locateJobs.start(q, { roots });
        fileLog('[Pick] locate-start', q.ext, `roots=${roots.length}`);
        sendJson(res, 200, locateJobs.status(id));
        return true;
      }
      case 'GET /api/locate-status': {
        sendJson(res, 200, locateJobs.status(urlObj.searchParams.get('job')));
        return true;
      }
      case 'POST /api/locate-materialize': {
        const body = await readJsonBody(req);
        fileLog('[Pick] locate-materialize');
        sendJson(res, 200, locateJobs.materialize(typeof body.job === 'string' ? body.job : ''));
        return true;
      }
      case 'POST /api/locate-cancel': {
        const body = await readJsonBody(req);
        sendJson(res, 200, locateJobs.cancel(typeof body.job === 'string' ? body.job : ''));
        return true;
      }
      case 'POST /api/locate-confirm': {
        const body = await readJsonBody(req);
        const r = await locateJobs.confirm(typeof body.job === 'string' ? body.job : '', body.sha256);
        // (counts only - never the candidate list)
        fileLog('[Pick] locate-confirm', `candidates=${r.stats.candidates} hashed=${r.stats.hashed} matches=${r.stats.matches}`);
        if (!r.found) { sendJson(res, 200, { success: false, code: 'NOT_FOUND', reason: r.reason }); return true; }
        const ext = path.extname(r.filePath).toLowerCase().slice(1);
        if (ext !== 'rsf' && ext !== 'tcdb') { sendJson(res, 400, { success: false, code: 'BAD_REQUEST', error: 'Unsupported file type' }); return true; }
        fileLog('[Pick] located', ext, r.filePath);
        sendJson(res, 200, registerPickedFile(r.filePath, ext));
        return true;
      }

      // ── GET /api/folder-access?kinds=desktop,documents&retry=1: the macOS «Files and Folders» verdict per area (waits ~1.2 s for a prompt, then says pending) ──
      case 'GET /api/folder-access': {
        const wanted = String(urlObj.searchParams.get('kinds') || 'desktop,documents,downloads').split(',').map((x) => x.trim()).filter((x) => folderAccessMod.KINDS.includes(x)).slice(0, 6);
        const retry = urlObj.searchParams.get('retry') === '1';
        const areas = {};
        await Promise.all(wanted.map(async (k) => {
          if (retry) folderAccess.forget(k);
          const v = await folderAccess.check(k, { waitMs: 1200 });
          areas[k] = { state: v.state, ...(v.code ? { code: v.code } : {}), ...(v.sinceMs != null ? { sinceMs: v.sinceMs } : {}) };
        }));
        sendJson(res, 200, { success: true, platform: process.platform, areas });
        return true;
      }

      // ── POST /api/open-privacy-settings: System Settings → Privacy & Security → Files and Folders (opened by THIS app - a web page cannot open that link) ──
      case 'POST /api/open-privacy-settings': {
        if (process.platform !== 'darwin' && !HARNESS_OK) { sendJson(res, 200, { success: false, code: 'UNSUPPORTED' }); return true; }
        if (HARNESS_OK && process.env.TEXACORE_HEADLESS === '1') { E2E_FS.settingsOpened.push(Date.now()); sendJson(res, 200, { success: true, stubbed: true }); return true; }
        let opened = false;
        for (const url of folderAccessMod.settingsUrls()) {
          try { await shell.openExternal(url); opened = true; break; } catch (e) { fileLog('[Privacy] could not open', url, e && e.message); }
        }
        sendJson(res, 200, { success: opened, ...(opened ? {} : { code: 'OPEN_FAILED' }) });
        return true;
      }

      // ── (harness only) POST /api/e2e-folder-access {sim?, kinds?, placeholders?, reset?, get?}: pretend permission verdicts / scratch folders as protected areas / cloud placeholders ──
      case 'POST /api/e2e-folder-access': {
        if (!HARNESS_OK) return false;
        const b = await readJsonBody(req);
        if (b.reset) { E2E_FS.sim = {}; E2E_FS.kinds = {}; E2E_FS.placeholders.clear(); E2E_FS.settingsOpened = []; for (const k of folderAccessMod.KINDS) folderAccess.forget(k); }
        if (b.sim && typeof b.sim === 'object') { E2E_FS.sim = { ...E2E_FS.sim, ...b.sim }; for (const k of folderAccessMod.KINDS) folderAccess.forget(k); }
        if (b.kinds && typeof b.kinds === 'object') E2E_FS.kinds = { ...E2E_FS.kinds, ...b.kinds };
        if (b.placeholders && typeof b.placeholders === 'object') for (const [fp, spec] of Object.entries(b.placeholders)) E2E_FS.placeholders.set(path.resolve(fp), spec && typeof spec === 'object' ? spec : {});
        sendJson(res, 200, { success: true, sim: E2E_FS.sim, kinds: E2E_FS.kinds, placeholders: [...E2E_FS.placeholders.keys()].length, settingsOpened: E2E_FS.settingsOpened.length });
        return true;
      }

      // ── POST /api/open-picked-tcdb {ref, passphrase?}: open the company file the user picked in the native window and keep working IN it ──
      //    2.0.3 (owner 15-10: «عند تحديد الملف تزامن معه»): the 2.0.2 page uploaded a COPY to /api/restore-tcdb, which made "<name> (2).tcdb" in
      //    <Documents>/TexaCore and synced there. This is the 1.x behaviour of GET /api/open-tcdb (restoreTcdbFromPath): restore, then the minute
      //    sync writes back to the SAME file; a protected export keeps its bytes (the company file gets a free name beside it).
      case 'POST /api/open-picked-tcdb': {
        const body = await readJsonBody(req);
        const item = pickedFiles.get(typeof body.ref === 'string' ? body.ref : '');
        if (!item) throw Object.assign(new Error('The picked file is no longer available - pick it again'), { code: 'PICK_EXPIRED' });
        if (item.type !== 'tcdb') throw Object.assign(new Error('Not a TexaCore company file'), { code: 'BAD_REQUEST' });
        if (!svcManager || !svcManager.isRunning()) throw Object.assign(new Error('The services are not running'), { code: 'SERVICES_DOWN' });
        // an evicted iCloud / OneDrive file must be local before the restore reads it synchronously (that read would block for good)
        const idleMs = (HARNESS_OK && Number(process.env.TEXACORE_E2E_READ_IDLE_MS)) || 20000;
        const buf = await companyFile.readFileIdle(item.filePath, { idleMs });
        if (!isTcdbContainer(buf)) throw Object.assign(new Error('Not a TexaCore backup file'), { code: 'BAD_REQUEST' });
        const passphrase = typeof body.passphrase === 'string' ? body.passphrase.slice(0, 256) : '';
        newBackupManager().probeAccess(buf, { passphrase });   // a protected file answers TCDB_PASSPHRASE_REQUIRED / TCDB_BAD_PASSPHRASE BEFORE anything changes
        const out = await restoreTcdbFromPath(item.filePath, { passphrase, confirmReplaceAll: livePolicy.isConfirmed(body.confirmReplaceAll) });   // 2.0.5: the explicit yes of replace-all (REPLACE_ALL_CONFIRM_REQUIRED without it)
        fileLog('[Pick] opened in place', item.filePath, '→ company file', out && out.tcdbPath);
        sendJson(res, 200, { ...out, openedFrom: item.filePath, inPlace: !!(out && out.tcdbPath && path.resolve(out.tcdbPath) === path.resolve(item.filePath)) });
        return true;
      }

      // ── GET /api/picked-file?ref=…: the bytes of what the user picked (the page needs them for the import wizard / the restore) ──
      case 'GET /api/picked-file': {
        const item = pickedFiles.get(urlObj.searchParams.get('ref'));
        if (!item) throw Object.assign(new Error('The picked file is no longer available - pick it again'), { code: 'PICK_EXPIRED' });
        const idleMs = (HARNESS_OK && Number(process.env.TEXACORE_E2E_READ_IDLE_MS)) || 20000;
        const buf = await companyFile.readFileIdle(item.filePath, { idleMs });
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream', 'Content-Length': buf.length,
          'X-Texacore-File-Name': encodeURIComponent(item.name), 'Cache-Control': 'no-store',
        });
        res.end(buf);
        return true;
      }
      default:
        return false;
    }
  } catch (err) {
    const code = err && err.code ? String(err.code) : 'ERROR';
    if (!res.headersSent) sendJson(res, fileErrorStatus(code), { success: false, code, error: err.message, ...(code === 'FOLDER_PERMISSION' ? { area: err.area || null, state: err.state || 'denied' } : {}), ...(err && err.replaceAll ? err.replaceAll : {}) });
    else res.end();
    if (fileErrorStatus(code) === 500) console.error(`[CompanyFile] ${route} failed:`, err.message);
    return true;
  }
}

// ─── Local API Server for Browser Access ───────────────────────
// Admin endpoints that change/destroy data — must never be triggered by a
// foreign website (CSRF) or remotely. Cross-checked: the cloud Express proxy
// also blocks these over the tunnel (see service-manager startFrontendServer).
const DESTRUCTIVE_API = new Set([
  '/api/delete-company', '/api/restore-tcdb', '/api/import-rsf', '/api/import-rsf-path',
  '/api/create-local-company', '/api/backup', '/api/open-tcdb', '/api/tunnel-fix', '/api/tunnel-restart',
  '/api/update/install', '/api/update/pause', '/api/update/resume', '/api/update/retry', '/api/invite-employee',
  // 2.0.2: write files / open native dialogs / read a file the user picked — the same same-machine-origin rule as the rest
  '/api/export-backup', '/api/reveal-in-folder', '/api/pick-company-file', '/api/pick-save-location', '/api/picked-file', '/api/e2e-dialog',
  '/api/open-picked-tcdb',   // 2.0.3: restores the picked company file and keeps syncing into it
  '/api/locate-picked-file', // 2.0.3: finds the file the page picked in the browser's own chooser (name + size + SHA-256) and registers it like a native pick
  // 2.0.4: the same search as a job (metadata first, permission-aware, placeholders downloaded with progress) + the folder-permission helpers
  '/api/locate-start', '/api/locate-status', '/api/locate-materialize', '/api/locate-cancel', '/api/locate-confirm',
  '/api/folder-access', '/api/open-privacy-settings', '/api/e2e-folder-access',
]);
// 2.0.0: every admin-API call except /api/ping must carry this install's secret (secrets.json → /config.js, same-origin only;
// the Electron window gets it over IPC). It keeps other local programs and foreign web pages — which CORS "*" and a loopback
// bind alone do not — from creating tenants, deleting companies or listing them.
const LOCAL_API_SECRET_HEADER = 'x-texacore-local-secret';
function adminApiAuthorized(req) {
  const urlObj = new URL(req.url || '/', 'http://127.0.0.1');
  if (urlObj.pathname === '/api/ping') return true;
  const secret = svcManager && svcManager.localApiSecret;
  if (!secret) return false;
  const given = String(req.headers[LOCAL_API_SECRET_HEADER] || urlObj.searchParams.get(LOCAL_API_SECRET_HEADER) || '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && require('crypto').timingSafeEqual(a, b);
}
// The company list of this install (id + name) — used by GET /api/companies and by the installer window over IPC.
async function listLocalCompanies() {
  const stdout = await psqlExec("SELECT id, name FROM public.companies ORDER BY created_at DESC;");
  const lines = stdout.split('\n').filter(line => line.trim() !== '' && !line.includes('---') && !line.includes('rows)') && !line.includes('row)'));
  return lines.map(line => {
    const parts = line.split('|');
    if (parts.length >= 2) {
      const id = parts[0].trim();
      const name = parts[1].trim();
      // Skip header row
      if (id === 'id' || !id.match(/^[0-9a-f]{8}-/)) return null;
      return { id, name, logo: name.charAt(0).toUpperCase(), lastAccessed: new Date().toISOString() };
    }
    return null;
  }).filter(c => c !== null);
}
// Local employee invites (provisioning.inviteLocalEmployee): the admin, on this machine, adds an employee; the one-time password is in the reply only.
async function handleInviteEmployee(data) {
  if (!svcManager || !svcManager.isRunning()) return { success: false, code: 'SERVICES_DOWN', error: 'الخدمات غير شغّالة. يرجى تشغيل النظام أولاً.' };
  return provisioning.inviteLocalEmployee(provisioningDeps(), data);
}
async function handleListEmployeeRoles(companyId) {
  if (!svcManager || !svcManager.isRunning()) return { success: false, code: 'SERVICES_DOWN', error: 'services are not running' };
  return provisioning.listGrantableRoles(provisioningDeps(), companyId);
}
ipcMain.handle('invite-employee', async (_, data) => handleInviteEmployee(data));
ipcMain.handle('list-employee-roles', async (_, companyId) => handleListEmployeeRoles(companyId));

// The installer window (file://) asks over IPC instead of fetch()ing the admin port: no CORS, no secret on the wire.
ipcMain.handle('list-local-companies', async () => {
  try { return { success: true, companies: await listLocalCompanies() }; }
  catch (e) { return { success: false, companies: [], error: e.message }; }
});

const WIDGET_PROBE = `(() => { const g = (id) => document.getElementById(id); const w = g('update-widget'); if (!w) return { present: false };
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  return { present: true, shown: vis(w), text: (g('update-text') || {}).textContent || '', mb: (g('update-mb') || {}).textContent || '', progressVisible: vis(g('update-progress-wrap')),
    progressWidth: (g('update-progress-bar') || { style: {} }).style.width || '', restartVisible: vis(g('update-restart-btn')), restartText: (g('update-restart-btn') || {}).textContent || '',
    laterText: (g('update-later-btn') || {}).textContent || '', lang: document.documentElement.lang, title: document.title }; })()`;
async function uiUpdate(url, method) {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no installer window' };
  const wc = mainWindow.webContents;
  if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r));
  if (method === 'POST' && url.pathname === '/api/ui-update-click') {
    await wc.executeJavaScript("document.getElementById('update-restart-btn').click()", true);
    return { ok: true, clicked: true };
  }
  const out = { ok: true, version: app.getVersion(), widget: await wc.executeJavaScript(WIDGET_PROBE, true), status: { ...updateStatus } };
  const shot = url.searchParams.get('shot');
  if (shot && process.env.TEXACORE_SHOT_DIR) {
    const f = path.join(process.env.TEXACORE_SHOT_DIR, path.basename(shot).replace(/[^A-Za-z0-9._-]/g, '_'));
    fs.writeFileSync(f, (await wc.capturePage()).toPNG());
    out.shot = f;
  }
  return out;
}

// Screenshot check of the installer window (isolated harness runs only — same gate as /api/ui-update): run a snippet in the real renderer, optionally
// resize the (hidden) window, and capture what the window shows. Nothing here is reachable in a normal run.
async function uiEval(opts) {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no installer window' };
  const wc = mainWindow.webContents;
  if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r));
  if (Array.isArray(opts.size) && opts.size.length === 2) mainWindow.setContentSize(Math.min(2000, opts.size[0] | 0), Math.min(2000, opts.size[1] | 0));
  const out = { ok: true };
  if (typeof opts.js === 'string' && opts.js.length < 20000) out.result = await wc.executeJavaScript(opts.js, true);
  await new Promise((r) => setTimeout(r, Math.max(0, Math.min(3000, opts.wait | 0))));
  if (opts.shot && process.env.TEXACORE_SHOT_DIR) {
    const f = path.join(process.env.TEXACORE_SHOT_DIR, path.basename(String(opts.shot)).replace(/[^A-Za-z0-9._-]/g, '_'));
    fs.writeFileSync(f, (await wc.capturePage()).toPNG());
    out.shot = f;
  }
  return out;
}

async function uiSmoke() {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no installer window (start with TEXACORE_UI_SMOKE=1)' };
  const wc = mainWindow.webContents;
  if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r));
  const js = (code) => wc.executeJavaScript(code, true);
  const out = { ok: true };
  out.bridgeKeys = await js('Object.keys(window.texacore || {}).length');
  out.version = await js('window.texacore.getVersion().then((v) => (typeof v === "string" ? v : v && v.version))');
  out.state = await js('window.texacore.getState().then((s) => ({ ok: !!s, hasConfig: !!s.config, localIp: s.localIp || null }))');
  out.secretLength = await js('String(window.texacore.getLocalApiSecret() || "").length');
  out.companies = await js('window.texacore.listLocalCompanies().then((r) => ({ success: r.success, n: (r.companies || []).length }))');
  await js('_empLast = 0; _empListed = false; _empCompanies = []; refreshEmployeesBox(currentState)');
  await new Promise((r) => setTimeout(r, 1500));
  // 2.0.5 RC2: the links come from the live company list (the hero's selector drives the office link); the employees form is gone from the launcher
  out.employeesBox = await js("({ display: document.getElementById('lan-link-row').style.display, link: document.getElementById('lan-employee-url').textContent, companies: document.getElementById('link-company').options.length, hero: document.getElementById('hero').dataset.mode, tabs: document.querySelectorAll('[role=tab]').length })");
  out.i18n = await js("document.querySelector('[data-i18n=\"ui.openProgram\"]').textContent");
  out.documentTitle = await js('document.title');
  return out;
}

// A TexaCore backup container starts with "TCDB" + a format-version byte (backup-manager.js writes/reads the same header).
function isTcdbContainer(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 153 && buf.subarray(0, 4).toString('latin1') === 'TCDB' && buf[4] >= 1 && buf[4] <= 2;
}
function adminRequestIsLocal(req) {
  if (!netGuard.isLoopbackAddress(req.socket && req.socket.remoteAddress)) return false;
  const fwdHost = req.headers['x-texacore-fwd-host'];
  const fwdPeer = req.headers['x-texacore-fwd-peer'];
  const fwdProxied = req.headers['x-texacore-fwd-proxied'];
  if (fwdHost === undefined && fwdPeer === undefined && fwdProxied === undefined) {
    return netGuard.isLoopbackHost(req.headers.host) && !netGuard.forwardedFromElsewhere(req.headers).forwarded;
  }
  // (the UI server computed "forwarded from elsewhere" with the same rule; its client may be this machine's own LAN address, not only loopback)
  // the UI proxy always sends Host: 127.0.0.1:<admin port>; a page that set x-texacore-fwd-* itself (DNS rebinding to this port) carries its own Host
  return netGuard.isLoopbackHost(req.headers.host) && netGuard.isLoopbackHost(fwdHost) && netGuard.isThisMachineAddress(fwdPeer) && fwdProxied === '0';
}
// ─── (2.0.5) Replacing the whole database needs an explicit yes, and a backup of what is replaced is taken first ───────────────────────────
// ONE database holds every company of this install, and opening a .tcdb truncates all of it (for every user) before loading the file. 2.0.4 did that without a
// word (owner, 21-10). Now: the database is read first (companies + connected sessions); when it holds companies the request must carry confirmReplaceAll:true
// (the page asks the user; an older page never sends it and gets REPLACE_ALL_CONFIRM_REQUIRED with the list, nothing changes), and a .tcdb of what is about to be
// replaced is written to <app data>/backups/pre-open/ BEFORE anything is touched - if it cannot be written, nothing is replaced.
/** What a replace-all would wipe: { companies:[{id,name}]|null, sessions, users, liveFile }. companies === null = the database could not be read (never treated as empty). */
async function replaceAllSnapshot() {
  const out = { companies: null, sessions: null, users: null, liveFile: null };
  try { out.liveFile = liveCompanyFile(); } catch { out.liveFile = null; }
  if (!svcManager) return out;
  const { Client } = require('pg');
  const client = new Client({ host: '127.0.0.1', port: ServiceManager.PG_PORT, database: 'postgres', user: 'postgres', password: svcManager.dbPassword || '', connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    try {
      const r = await client.query('SELECT id, name FROM public.companies ORDER BY created_at DESC LIMIT 500');
      out.companies = r.rows.map((x) => ({ id: String(x.id), name: x.name == null ? '' : String(x.name) }));
    } catch (e) {
      if (e && e.code === '42P01') out.companies = [];   // no companies table at all = an empty database (the restore then reports TCDB_NO_SCHEMA itself)
    }
    // "connected" = a session refreshed within the last hour (an access token lives an hour); the columns differ between GoTrue builds, so the richer query is tried first
    for (const sql of [
      "SELECT count(*)::int AS n, count(DISTINCT user_id)::int AS u FROM auth.sessions WHERE COALESCE(refreshed_at, updated_at, created_at) > now() - interval '1 hour' AND (not_after IS NULL OR not_after > now())",
      "SELECT count(*)::int AS n, count(DISTINCT user_id)::int AS u FROM auth.sessions WHERE COALESCE(updated_at, created_at) > now() - interval '1 hour'",
    ]) {
      try { const r = await client.query(sql); out.sessions = +r.rows[0].n; out.users = +r.rows[0].u; break; } catch { /* try the next shape */ }
    }
  } catch (e) {
    console.warn('[ReplaceAll] could not read the database:', e.message);
  } finally {
    try { await client.end(); } catch { /* not connected */ }
  }
  return out;
}
/** The gate: throws REPLACE_ALL_CONFIRM_REQUIRED (with the list) unless the database holds no companies or `confirmReplaceAll` is an explicit yes. Returns the snapshot. */
async function assertReplaceAllConfirmed({ confirmReplaceAll } = {}) {
  const snapshot = await replaceAllSnapshot();
  livePolicy.requireReplaceAllConfirmation({ confirmReplaceAll, snapshot });
  return snapshot;
}
/** A .tcdb of the database as it is NOW, in the program's own backups folder (the unified key: it opens on any TexaCore). Returns its path, or null when there was nothing to save. */
async function takePreOpenBackup(snapshot) {
  const holdsCompanies = !!(snapshot && Array.isArray(snapshot.companies) && snapshot.companies.length > 0);
  const unknown = !snapshot || snapshot.companies === null;
  if (!holdsCompanies && !unknown) return null;   // an empty database: nothing to lose
  const target = livePolicy.preOpenBackupPath(DATA_DIR);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const out = await newBackupManager({ backupPath: target }).exportTo(target, { overwrite: false });
    livePolicy.prunePreOpenBackups(path.dirname(target), 10);
    fileLog('[OpenTCDB] backup of the current companies before replacing them →', out.path, out.size, 'bytes');
    return out.path;
  } catch (e) {
    if (e && e.code === 'EXPORT_EMPTY') return null;   // the dump holds no company data
    if (holdsCompanies) { fileLog('[OpenTCDB] ❌ the pre-open backup failed:', e && e.message); throw livePolicy.preOpenBackupError(e); }
    console.warn('[OpenTCDB] pre-open backup skipped (the database could not be read):', e && e.message);
    return null;
  }
}

// ─── Open a .tcdb: restore it into the running database and keep syncing back to the SAME file ───────────────
// Shared by the file-dialog route (GET /api/open-tcdb).
// Returns the JSON the route sends; throws on failure.
// 2.0.3 (review): ONE company file is opened at a time. Two opens at once (a second click, two tabs) interleaved two truncates + loads into one database, the
// first to finish cleared the backup manager's «restoring» flag and its startSync() wrote the mixed database into the file the second open had re-pointed to.
let restoreInFlight = false;
async function restoreTcdbFromPath(selectedPath, opts = {}) {
  if (restoreInFlight) throw Object.assign(new Error('يُفتح ملف شركة آخر الآن | Another company file is being opened - wait for it to finish'), { code: 'RESTORE_BUSY' });
  restoreInFlight = true;
  try { return await openTcdbFromPathUnlocked(selectedPath, opts); } finally { restoreInFlight = false; }
}
async function openTcdbFromPathUnlocked(selectedPath, { passphrase = '', confirmReplaceAll = false } = {}) {
  const fileName = path.basename(selectedPath);
  const fileDir = path.dirname(selectedPath);
  if (!svcManager || !svcManager.isRunning()) throw new Error('الخدمات غير شغّالة — شغّل النظام أولاً ثم افتح الملف');
  // 2.0.5: replacing every company needs the user's explicit yes, and what is replaced is saved first (nothing below runs without both)
  const replaceSnapshot = await assertReplaceAllConfirmed({ confirmReplaceAll });
  const preOpenBackup = await takePreOpenBackup(replaceSnapshot);
  // ── Restore from TCDB and sync back to SAME file ──
  const os = require('os');
  const isWin = process.platform === 'win32';

  // what the backup manager was writing before this open: put back if the restore fails without touching the database (afterFailedRestore)
  const prevSync = { prevTarget: backupManager ? backupManager.backupPath : null, prevSecondary: backupManager ? backupManager.secondaryBackupPath : null, wasSyncing: !!(backupManager && backupManager._timer) };
  // Initialize backupManager pointing to the ORIGINAL file path
  if (!backupManager) {
    const pgBinDir = svcManager ? path.join(svcManager.binsDir, 'pg', 'bin') : (isWin ? 'C:\\Program Files\\PostgreSQL\\16\\bin' : '/opt/homebrew/bin');
    const dbPass = svcManager ? svcManager.dbPassword : '';
    backupManager = new BackupManager({
      pgBinDir, dbHost: 'localhost', dbPort: ServiceManager.PG_PORT || 54322,
      dbName: 'postgres', dbUser: 'postgres', dbPassword: dbPass,
      backupPath: selectedPath,
      encryptionKey: 'texacore-default-backup-key-2026',
      dataDir: DATA_DIR, // restore tries default + license key (#4)
      intervalMs: 60 * 1000,
      onProgress: (phase, detail) => {
        console.log(`[Backup] ${phase}: ${detail}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('backup-progress', { phase, detail });
        }
      },
      onError: (err) => console.error('[Backup] Error:', err.message),
    });
  }

  // A file written by a 1.x build is refused BEFORE the backup manager is pointed at it (it syncs back to whatever file it points at) and before anything is restored
  const writtenBy = await backupManager.peekDumpMajor(selectedPath, { passphrase });
  if (writtenBy !== null && writtenBy < 17) { fileLog('[OpenTCDB] refused a pre-2.0 file (PostgreSQL ' + writtenBy + '):', selectedPath); throw BackupManager.legacyFileError(writtenBy); }

  // 2.0.2: a file that opened only WITH a passphrase is an export meant to leave the computer. The live company file is written with the install's own
  // key every minute, so syncing back over it would silently strip its protection - the company file goes to its own new name instead, the export is untouched.
  const openedWithPassphrase = !!passphrase && backupManager.probeAccess(fs.readFileSync(selectedPath), { passphrase }).usedPassphrase;
  // 2.0.3: the work continues IN the opened file when it can be written; a protected export (or a file in a folder / on a medium this user cannot
  // write) keeps its bytes and the company file gets a free name BESIDE it - or in <Documents>/TexaCore when its folder is read-only.
  let fileWritable = false;
  try { fs.accessSync(selectedPath, fs.constants.W_OK); fileWritable = true; } catch { fileWritable = false; }
  await requireFolderAccess(fileDir);   // (2.0.4) the folder beside the opened file: macOS must have said yes before the synchronous checks below
  const besideOk = companyFile.folderIsWritable(fileDir).ok;
  if (!besideOk) await requireFolderAccess(companyFile.defaultCompanyDir());
  const liveTarget = (!openedWithPassphrase && fileWritable && besideOk)
    ? selectedPath
    : companyFile.uniqueTcdbPath(besideOk ? fileDir : companyFile.defaultCompanyDir(), fileName.replace(/\.tcdb$/i, ''));
  if (liveTarget !== selectedPath) fs.mkdirSync(path.dirname(liveTarget), { recursive: true });

  // (review rv203 S5) re-opening the file that is ALREADY the live company file: write the database into it first, so the restore below
  // brings back the current work and not the snapshot of up to a minute ago.
  if (backupManager.backupPath && path.resolve(backupManager.backupPath) === path.resolve(selectedPath)) {
    try { await backupManager.waitIdle(); await backupManager.backup(); } catch (e) { console.warn('[OpenTCDB] flush before re-open:', e.message); }
  }
  // Point backup to the ORIGINAL file (USB, Desktop, wherever)
  try { backupManager.stopSync(); } catch { /* not running */ }   // no tick of the previous timer may dump the old / half-restored DB into the opened file
  await backupManager.waitIdle();   // ... and a dump already running must finish BEFORE the target is re-pointed (it would write the old database into the opened file) and before the truncate
  backupManager.backupPath = liveTarget;
  backupManager.secondaryBackupPath = null;   // 2.0.2: the program's second copy belonged to the PREVIOUS company file - never write this company's data over it
  // (review rv203) the daily snapshots of a file opened in place in the user's own folder go to the program's backups folder, not into a
  // 'snapshots' folder created beside the user's file (Desktop, a USB stick, iCloud…); a file in the TexaCore folder keeps them beside it as before.
  // (2.0.5) the default folder moved to ~/TexaCore, but a file an install already keeps in the old ~/Documents/TexaCore stays a «TexaCore folder» too (isCompanyFolder knows both)
  backupManager.snapshotDir = companyFile.isCompanyFolder(path.dirname(liveTarget)) ? null : path.join(DATA_DIR, 'backups', 'snapshots');
  
  // Restore DB from the file (its error log goes to the program's logs folder, never beside the user's file)
  backupManager.restoreLogDir = LOG_DIR;
  const restoreResult = await backupManager.restore(selectedPath, { passphrase }).catch((e) => { backupManager.afterFailedRestore(prevSync); throw e; });   // (a failed open never leaves the manager writing into the picked file)

  // Inject the vendor support account (vendor machine only) so you can log
  // in to the restored backup with your own username + password.
  try { if (svcManager) await svcManager._ensureSuperAdmin(); } catch (e) { console.warn('[Open-TCDB] vendor inject:', e.message); }
  // Re-apply the admin-portal password (the restore replaced the DB).
  try { if (svcManager) await svcManager.syncAdminPassword(); } catch (e) { console.warn('[Open-TCDB] admin pw sync:', e.message); }

  // A one-off copy of the file as it was opened, in the program's own backups folder under a free name (1.x copied it over
  // <Documents>/TexaCore/<same name>, which could be ANOTHER company's file). Only when the work continues in the opened file itself.
  if (liveTarget === selectedPath) {
    try {
      // one per company file per day: <app data>/backups/<name>.opened-<yyyy-mm-dd>.tcdb (EXCL: an existing copy of today is kept, never replaced)
      const safetyCopy = path.join(DATA_DIR, 'backups', `${companyFile.safeFileBase(fileName.replace(/\.tcdb$/i, ''), 'company')}.opened-${companyFile.localDateStamp()}.tcdb`);
      fs.mkdirSync(path.dirname(safetyCopy), { recursive: true });
      fs.copyFileSync(selectedPath, safetyCopy, fs.constants.COPYFILE_EXCL);
      fileLog('[OpenTCDB] copy of the opened file as it was →', safetyCopy);
    } catch (e) { if (!e || e.code !== 'EEXIST') console.warn('[OpenTCDB] safety copy:', e && e.message); }
  }

  // Start periodic sync — writes back to ORIGINAL file
  backupManager.startSync();

  let companyName = fileName.replace('.tcdb', '');
  let restoreIntegrity = null;   // filled after the services restart (see below)
  // Query actual company info from restored DB
  let companyId = null;
  let tenantId = null;
  let users = [];
  try {
    const { Client } = require('pg');
    const pgClient = new Client({
      host: 'localhost', port: ServiceManager.PG_PORT,
      database: 'postgres', user: 'postgres',
      password: svcManager ? svcManager.dbPassword : '',
    });
    await pgClient.connect();
    
    const { rows: companies } = await pgClient.query("SELECT id, tenant_id, name FROM companies LIMIT 1");
    if (companies.length > 0) {
      companyId = companies[0].id;
      tenantId = companies[0].tenant_id;
      // Also get company name from DB if available
      if (companies[0].name) companyName = companies[0].name;
    }
    
    // Get auth users for login hints
    const { rows: authUsers } = await pgClient.query("SELECT email FROM auth.users ORDER BY created_at LIMIT 10");
    users = authUsers.map(u => u.email);
    
    // Notify PostgREST to reload schema after restore
    try { await pgClient.query("NOTIFY pgrst, 'reload schema'"); } catch {}
    
    await pgClient.end();
    console.log(`[OpenTCDB] DB info: company=${companyId}, tenant=${tenantId}, users=${users.join(', ')}`);
  } catch (dbErr) {
    console.warn('[OpenTCDB] Could not query restored DB:', dbErr.message);
  }

  // Restart GoTrue & PostgREST after pg_restore
  // GoTrue caches auth.users — it MUST be restarted after DB restore
  // PostgREST needs schema reload for new tables
  try {
    if (svcManager) {
      // Restart GoTrue
      if (svcManager.processes.gotrue) {
        console.log('[OpenTCDB] Restarting GoTrue...');
        try { svcManager.processes.gotrue.kill(); } catch {}
        svcManager.processes.gotrue = null;
        await new Promise(r => setTimeout(r, 1000));
      }
      await svcManager.startGoTrue();
      console.log('[OpenTCDB] ✅ GoTrue restarted');

      // Restart PostgREST  
      if (svcManager.processes.postgrest) {
        console.log('[OpenTCDB] Restarting PostgREST...');
        try { svcManager.processes.postgrest.kill(); } catch {}
        svcManager.processes.postgrest = null;
        await new Promise(r => setTimeout(r, 1000));
      }
      await svcManager.startPostgREST();
      console.log('[OpenTCDB] ✅ PostgREST restarted');

      // 2.0.0: NOTHING here widens access any more. 1.x disabled RLS on every table and granted ALL to anon after a restore — the
      // very hole 2.0 closes. A 2.0 backup carries production's grants and RLS flags (pg_dump keeps them); a pre-2.0 one does not,
      // and is reported instead of being made "work" by opening the database to anonymous callers.
      try {
        await svcManager.psqlExec(`NOTIFY pgrst, 'reload schema';`);
        restoreIntegrity = await svcManager.verifyBaselineInstall();
        if (!restoreIntegrity.ok) console.warn('[OpenTCDB] ⚠️ the restored database does not match the 2.0 baseline:', restoreIntegrity.problems.slice(0, 3).join(' | '));
        else console.log('[OpenTCDB] ✅ restored database matches the 2.0 baseline');
      } catch (integrityErr) {
        restoreIntegrity = { ok: false, problems: [integrityErr.message] };
        console.warn('[OpenTCDB] integrity check failed:', integrityErr.message);
      }

      // Fix auth schema ownership for GoTrue
      // pg_restore sets owner to 'postgres', but GoTrue needs supabase_auth_admin
      try {
        await svcManager.psqlExec(`
          ALTER SCHEMA auth OWNER TO supabase_auth_admin;
          DO $$ DECLARE r RECORD; BEGIN
            FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'auth' LOOP
              EXECUTE 'ALTER TABLE auth.' || quote_ident(r.tablename) || ' OWNER TO supabase_auth_admin';
            END LOOP;
          END $$;
          DO $$ DECLARE r RECORD; BEGIN
            FOR r IN SELECT sequencename FROM pg_sequences WHERE schemaname = 'auth' LOOP
              EXECUTE 'ALTER SEQUENCE auth.' || quote_ident(r.sequencename) || ' OWNER TO supabase_auth_admin';
            END LOOP;
          END $$;
          GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
          GRANT ALL ON ALL TABLES IN SCHEMA auth TO supabase_auth_admin;
          GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO supabase_auth_admin;
          GRANT USAGE ON SCHEMA auth TO authenticator, supabase_auth_admin;
        `);
        console.log('[OpenTCDB] ✅ Auth schema ownership fixed');
      } catch (authErr) {
        console.warn('[OpenTCDB] Auth ownership warning:', authErr.message);
      }
    } else {
      // Fallback: just NOTIFY if svcManager not available
      const { Client: PgClient2 } = require('pg');
      const pgC2 = new PgClient2({
        host: 'localhost', port: ServiceManager.PG_PORT,
        database: 'postgres', user: 'postgres',
        password: (svcManager && svcManager.dbPassword) || '',
      });
      await pgC2.connect();
      await pgC2.query("NOTIFY pgrst, 'reload schema'");
      await pgC2.end();
    }
  } catch (restartErr) {
    console.warn('[OpenTCDB] Service restart warning:', restartErr.message);
  }

  // Save config
  try {
    const config = loadConfig();
    config.companies = [{ name: companyName, tcdbPath: liveTarget, storagePath: path.dirname(liveTarget) }];
    saveConfig(config);
  } catch {}

  console.log(`[OpenTCDB] ✅ Restored & syncing to: ${liveTarget}`);
  return {
    success: true,
    type: 'tcdb',
    companyName,
    companyId,
    tenantId,
    users,
    tcdbPath: liveTarget,
    preOpenBackup: preOpenBackup || undefined,   // 2.0.5: the file the companies that were replaced were saved to first (null/absent = the database was empty)
    protectedSource: openedWithPassphrase ? selectedPath : undefined,
    integrity: restoreIntegrity ? { ok: restoreIntegrity.ok, problems: restoreIntegrity.problems.slice(0, 5) } : null,
    ...restoreResult
  };
}

const httpServer = http.createServer(async (req, res) => {
  // CORS: loopback origins only, never '*' (net-guard.js). The ERP page calls this API same-origin through its own /api proxy and the
  // installer window uses IPC, so no foreign origin has any reason to read a response from here.
  netGuard.applyCors(req, res, { methods: 'POST, GET, OPTIONS', allowHeaders: 'Content-Type, ' + LOCAL_API_SECRET_HEADER });

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Defence in depth behind the UI server's own /api guard: this surface serves THIS machine only. A call is accepted when
  //  - it came straight to this loopback-bound port (a program on this machine): loopback Host (a DNS-rebinding page sends its
  //    own name), no proxy/CDN header; or
  //  - it came through the UI server's /api proxy, which forwards the ORIGINAL Host and TCP peer as x-texacore-fwd-* (replacing
  //    anything the client sent): the original Host must be loopback and the original peer loopback and unproxied.
  // /api/ping alone answers everyone.
  if (!adminRequestIsLocal(req) && (req.url || '').split('?')[0] !== '/api/ping') {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'forbidden: the administrative API is local-only' }));
    return;
  }

  // CSRF / cross-origin guard: a destructive call is allowed only from a
  // same-machine browser (Origin localhost/127.0.0.1) or a non-browser caller
  // (no Origin — the Electron app / local tooling). Any foreign Origin (a
  // malicious site the user visited, or a spoofed remote) is rejected.
  {
    let urlPath;   // the same normalised pathname handleCompanyFileRoutes() routes on - dot segments must not skip this guard
    try { urlPath = new URL(req.url || '/', 'http://127.0.0.1').pathname; } catch { urlPath = (req.url || '').split('?')[0]; }
    if (DESTRUCTIVE_API.has(urlPath)) {
      const origin = req.headers['origin'] || '';
      const sameMachine = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
      if (!sameMachine) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'forbidden: cross-origin request to a local-only endpoint' }));
        return;
      }
    }
  }

  if (!adminApiAuthorized(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'unauthorized: missing or wrong x-texacore-local-secret' }));
    return;
  }

  // 2.0.0: Rashid (.rsf) import runs INSIDE the app (the ERP's import wizard, as the signed-in admin, through the same server
  // functions the cloud uses). The 1.x installer-side importer wrote straight into the old schema and bypassed every guard of
  // the production schema, so the endpoints are closed rather than left to corrupt a 2.0 database.
  if (req.method === 'POST' && (req.url === '/api/import-rsf' || req.url === '/api/import-rsf-path')) {
    req.resume();
    res.writeHead(410, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'The installer-side Rashid import was removed in 2.0.0 — use the import wizard inside the app.' }));
    return;
  }

  // 2.0.2: company-file routes (native pick / one-off export / reveal / picked bytes) — see handleCompanyFileRoutes above
  if (HARNESS_OK && req.method === 'POST' && req.url === '/api/e2e-dialog') {
    // isolated test runs only: answer the next native dialogs (open / save) without a window
    try {
      const b = await readJsonBody(req);
      if ('open' in b) E2E_DIALOG.open = b.open || null;
      if ('save' in b) E2E_DIALOG.save = b.save || null;
      sendJson(res, 200, { success: true, revealed: E2E_DIALOG.reveal.slice() });
    } catch (e) { sendJson(res, 400, { success: false, error: e.message }); }
    return;
  }
  if (await handleCompanyFileRoutes(req, res)) return;

  if (req.method === 'POST' && req.url === '/api/create-local-company') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const companyData = JSON.parse(body);
        const result = await handleCreateLocalCompany(companyData);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch(err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/api/companies') {
    (async () => {
      try {
        const companies = await listLocalCompanies();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, companies }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    })();
  } else if (req.method === 'POST' && req.url === '/api/delete-company') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const { companyId } = JSON.parse(body);
        if (!companyId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'companyId is required' }));
          return;
        }
        // companyId is interpolated into dynamic SQL (DO $$ … '${companyId}'::uuid)
        // below — reject anything that isn't a strict UUID to prevent SQL injection.
        if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(companyId)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'invalid companyId' }));
          return;
        }

        // Use pg client for reliable multi-statement execution
        const { Client } = require('pg');
        const pgClient = new Client({
          host: '127.0.0.1', port: ServiceManager.PG_PORT,
          database: 'postgres', user: 'postgres',
          password: svcManager.dbPassword,
        });
        await pgClient.connect();

        try {
          // Run the whole delete in ONE transaction. If anything fails, ROLLBACK
          // reverts the trigger-disable DDL too (it's transactional), so triggers
          // are never left globally disabled and no partial delete is committed.
          await pgClient.query('BEGIN');

          // 1. Get tenant_id before deleting
          const { rows: compRows } = await pgClient.query(
            'SELECT tenant_id FROM public.companies WHERE id = $1', [companyId]
          );
          const tenantId = compRows.length > 0 ? compRows[0].tenant_id : null;

          // 2. Disable all triggers on public tables to bypass FK constraints
          await pgClient.query(`
            DO $$ DECLARE r RECORD;
            BEGIN
              FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
                EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' DISABLE TRIGGER ALL';
              END LOOP;
            END $$;
          `);

          // 3. Delete from every public TABLE (not views) that has a company_id column
          await pgClient.query(`
            DO $$ DECLARE r RECORD; cnt INTEGER;
            BEGIN
              FOR r IN 
                SELECT c.table_name FROM information_schema.columns c
                JOIN information_schema.tables t 
                  ON c.table_schema = t.table_schema AND c.table_name = t.table_name
                WHERE c.table_schema = 'public' AND c.column_name = 'company_id'
                AND t.table_type = 'BASE TABLE'
                AND c.table_name != 'companies'
                ORDER BY c.table_name
              LOOP
                EXECUTE 'DELETE FROM public.' || quote_ident(r.table_name) 
                  || ' WHERE company_id = $1' USING '${companyId}'::uuid;
                GET DIAGNOSTICS cnt = ROW_COUNT;
                IF cnt > 0 THEN
                  RAISE NOTICE 'Deleted % rows from %', cnt, r.table_name;
                END IF;
              END LOOP;
            END $$;
          `);

          // 4. Delete tenant-scoped tables (tenant_id column) — only BASE TABLEs
          if (tenantId) {
            await pgClient.query(`
              DO $$ DECLARE r RECORD;
              BEGIN
                FOR r IN 
                  SELECT c.table_name FROM information_schema.columns c
                  JOIN information_schema.tables t 
                    ON c.table_schema = t.table_schema AND c.table_name = t.table_name
                  WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
                  AND t.table_type = 'BASE TABLE'
                  AND c.table_name NOT IN ('companies', 'tenants')
                  ORDER BY c.table_name
                LOOP
                  EXECUTE 'DELETE FROM public.' || quote_ident(r.table_name) 
                    || ' WHERE tenant_id = $1' USING '${tenantId}'::uuid;
                END LOOP;
              END $$;
            `);
          }

          // 5. Clean auth tables
          await pgClient.query(`
            DELETE FROM auth.identities WHERE user_id IN (
              SELECT id FROM auth.users WHERE raw_user_meta_data->>'company_id' = $1
            )
          `, [companyId]);
          await pgClient.query(`
            DELETE FROM auth.sessions WHERE user_id IN (
              SELECT id FROM auth.users WHERE raw_user_meta_data->>'company_id' = $1
            )
          `, [companyId]);
          await pgClient.query(`
            DELETE FROM auth.refresh_tokens WHERE user_id IN (
              SELECT id::varchar FROM auth.users WHERE raw_user_meta_data->>'company_id' = $1
            )
          `, [companyId]);
          await pgClient.query(
            `DELETE FROM auth.users WHERE raw_user_meta_data->>'company_id' = $1`,
            [companyId]
          );

          // 6. Delete company and tenant
          await pgClient.query('DELETE FROM public.companies WHERE id = $1', [companyId]);
          if (tenantId) {
            await pgClient.query('DELETE FROM public.tenants WHERE id = $1', [tenantId]);
          }

          // 7. Re-enable triggers
          await pgClient.query(`
            DO $$ DECLARE r RECORD;
            BEGIN
              FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
                EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' ENABLE TRIGGER ALL';
              END LOOP;
            END $$;
          `);

          // 8. Commit the whole delete, then reload PostgREST schema cache.
          await pgClient.query('COMMIT');
          await pgClient.query("NOTIFY pgrst, 'reload schema'");

          fileLog('[TexaCore] Company deleted successfully:', companyId);
        } catch (txErr) {
          try { await pgClient.query('ROLLBACK'); fileLog('[TexaCore] Delete rolled back — triggers restored'); } catch {}
          throw txErr;
        } finally {
          await pgClient.end();
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error('[TexaCore] Delete company error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'TexaCore Local API is running' }));

  // ─── POST /api/backup ────────────────────────────────────
  } else if (req.method === 'POST' && req.url === '/api/backup') {
    if (!backupManager) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Backup not initialized. Import an RSF file first.' }));
      return;
    }
    try {
      const result = await backupManager.backup();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // 2.0.2: backupPath (where the company file is) and skipped (the dump had no company data or a backup was already running - nothing was written)
      res.end(JSON.stringify({ success: true, backupPath: backupManager.backupPath, skipped: !result, ...(result || {}), ...(() => { const st = backupManager.getStatus(); return { state: st.state, lastError: st.lastError, targets: st.targets }; })() }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }

  // ─── GET /api/backup-status ──────────────────────────────
  } else if (req.method === 'GET' && req.url === '/api/backup-status') {
    if (!backupManager) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ initialized: false, targets: [] }));
      return;
    }
    const status = backupManager.getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ initialized: true, ...status }));

  // ─── GET /api/update/status ──────────────────────────────
  // Live OTA update status for the ERP web UI widget (DesktopUpdateWidget).
  } else if (req.method === 'GET' && req.url === '/api/update/status') {
    // `state` (idle | downloading | ready) + version/percent/transferredMB/totalMB are the original fields; `phase` and the rest describe the download in detail
    // (paused / waiting-retry with the countdown and the last error / verifying …) so the ERP page can show them.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...updateStatus, nextRetryInSec: updateStatus.nextRetryAt ? Math.max(0, Math.ceil((updateStatus.nextRetryAt - Date.now()) / 1000)) : null }));

  // ─── POST /api/update/pause | resume | retry ─────────────
  // The same controls the installer window has (Pause / Resume / Retry now). Local-only like /api/update/install (DESTRUCTIVE_API + the loopback check below).
  } else if (req.method === 'POST' && (req.url === '/api/update/pause' || req.url === '/api/update/resume' || req.url === '/api/update/retry')) {
    const remote = req.socket.remoteAddress || '';
    const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (!isLoopback) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'forbidden: update controls are local-only' }));
      return;
    }
    const action = req.url.split('/').pop();
    const ok = updateControl(action === 'retry' ? 'retry' : action);
    res.writeHead(ok ? 200 : 409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: !!ok, status: { ...updateStatus } }));

  // ─── POST /api/update/install ────────────────────────────
  // Restart-to-install, triggered from the ERP web UI. Same path as the
  // 'install-update' IPC: quit → quit hook installs the staged update
  // (mac: detached installer script / win: autoInstallOnAppQuit).
  // Local-only: in DESTRUCTIVE_API (CSRF) + ADMIN_LOCAL_ONLY (tunnel), and
  // double-checked here against non-loopback callers.
  } else if (req.method === 'POST' && req.url === '/api/update/install') {
    const remote = req.socket.remoteAddress || '';
    const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    if (!isLoopback) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'forbidden: update install is local-only' }));
      return;
    }
    if (updateStatus.state !== 'ready') {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: `no update ready (state: ${updateStatus.state})` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'restarting to install' }));
    fileLog('[Update] install requested via local API — quitting to install v' + updateStatus.version);
    setTimeout(() => {
      app.isQuitting = true;
      if (process.platform === 'darwin') {
        app.quit(); // quit hook spawns the detached installer script
      } else {
        autoUpdater.quitAndInstall(); // same as the 'install-update' IPC on Windows
      }
    }, 400); // let the response flush first

  // ─── GET /api/companies ──────────────────────────────────
  } else if (req.method === 'GET' && req.url === '/api/companies') {
    try {
      const { Client } = require('pg');
      const pgC = new Client({ host: 'localhost', port: ServiceManager.PG_PORT, database: 'postgres', user: 'postgres', password: (svcManager && svcManager.dbPassword) || '' });
      await pgC.connect();
      const { rows } = await pgC.query('SELECT id, name, tenant_id FROM public.companies LIMIT 10');
      await pgC.end();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, companies: rows }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }

  // ─── GET /api/tunnel-status ─────────────────────────────────
  } else if (req.method === 'GET' && req.url === '/api/tunnel-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    
    const config = loadConfig();
    const isRunning = svcManager && svcManager.processes && svcManager.processes.cloudflared && !svcManager.processes.cloudflared.killed;
    const logFile = svcManager ? path.join(svcManager.logDir, 'cloudflared.log') : null;
    let lastLogs = '';
    try {
      if (logFile && fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf8');
        lastLogs = content.split('\n').slice(-20).join('\n'); // last 20 lines
      }
    } catch {}
    
    res.end(JSON.stringify({
      success: true,
      enabled: !!config.enableCloud,
      subdomain: config.subdomain || null,
      hasTunnelToken: !!config.tunnelToken,
      tunnelTokenLength: config.tunnelToken ? config.tunnelToken.length : 0,
      processRunning: !!isRunning,
      processPid: isRunning ? svcManager.processes.cloudflared.pid : null,
      lastLogs,
    }));

  // ─── POST /api/tunnel-restart ───────────────────────────────
  } else if (req.method === 'POST' && req.url === '/api/tunnel-restart') {
    try {
      if (svcManager) {
        // Kill existing
        if (svcManager.processes.cloudflared) {
          svcManager.stopCloudflared();
          await new Promise(r => setTimeout(r, 1000));
        }
        // Restart — reuse the existing token (same tunnel id) for a fast,
        // stable reconnect. Use /api/tunnel-fix when a fresh token is needed.
        await svcManager.startCloudflared({ skipReregister: true });

        await new Promise(r => setTimeout(r, 2000)); // Wait for it to connect
        const tunnel = svcManager.getTunnelStatus();   // the real state: «running» used to mean only "a process object exists"
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, running: tunnel.connector === 'connected' || tunnel.state === 'starting', connected: tunnel.state === 'connected', tunnel }));
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Service manager not initialized' }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }

  // ─── GET /api/tunnel-fix ────────────────────────────────────
  // Re-registers subdomain to get a fresh tunnel token and starts cloudflared
  } else if (req.method === 'GET' && req.url === '/api/tunnel-fix') {
    // 2.0.2: the SAME repair as the launcher's «إصلاح الرابط» button and the automatic once-per-start attempt (service-manager.repairTunnelLink):
    // re-register with the real hardware id, save the token (0600), restart cloudflared with it, PROVE that the public link reaches this process.
    try {
      if (!svcManager) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: 'Service manager not initialized' })); return; }
      const r = await svcManager.repairTunnelLink({ trigger: 'api' });
      const tunnel = r.tunnel || svcManager.getTunnelStatus();
      const status = r.outcome === 'no_subdomain' ? 400 : (r.success ? 200 : (r.outcome === 'rate_limited' ? 429 : r.outcome === 'taken' ? 409 : 502));
      res.writeHead(status, { 'Content-Type': 'application/json', ...(r.retryAfterSec ? { 'Retry-After': String(r.retryAfterSec) } : {}) });
      res.end(JSON.stringify({ success: !!r.success, outcome: r.outcome, code: r.code || null, retryAfterSec: r.retryAfterSec, subdomain: r.subdomain,
        url: r.subdomain ? `https://${r.subdomain}.texacore.ai` : null, tunnelRunning: tunnel.connector === 'connected' || tunnel.state === 'starting', tunnelConnected: tunnel.state === 'connected', tunnel,
        error: r.success ? undefined : r.outcome }));
    } catch (err) {
      console.error('[TunnelFix] ❌ Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }

  // ─── GET /api/open-tcdb ─────────────────────────────────────
  // Opens native file dialog → gets full path (even USB) → restores → syncs to same file
  } else if (req.method === 'GET' && (req.url === '/api/open-tcdb' || (req.url || '').startsWith('/api/open-tcdb?'))) {
    try {
      const openQuery = new URL(req.url, 'http://127.0.0.1').searchParams;   // 2.0.5: ?confirmReplaceAll=true is the explicit yes of replace-all
      // (the dialog itself is the shared showNativeDialog() above: it activates the app and hangs from an always-on-top host window, so it opens IN FRONT of the browser without showing the main window)
      const result = await showNativeDialog('open', {
        title: 'فتح ملف بيانات TexaCore',
        filters: [
          { name: 'TexaCore Database', extensions: ['tcdb'] },
          { name: 'Al-Rasheed', extensions: ['rsf'] },
        ],
        properties: ['openFile'],
      });

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, canceled: true }));
        return;
      }

      const selectedPath = result.filePaths[0];
      const fileName = path.basename(selectedPath);
      const fileDir = path.dirname(selectedPath);
      const isRsf = fileName.endsWith('.rsf');
      const isTcdb = fileName.endsWith('.tcdb');

      console.log(`[OpenTCDB] User selected: ${selectedPath}`);

      if (isTcdb) {
        const out = await restoreTcdbFromPath(selectedPath, { confirmReplaceAll: livePolicy.isConfirmed(openQuery.get('confirmReplaceAll')) });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } else if (isRsf) {
        // Pass path back to frontend — it will trigger the RSF import flow
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, type: 'rsf', filePath: selectedPath }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Unsupported file type' }));
      }
    } catch (err) {
      console.error('[OpenTCDB] ❌ Error:', err.message);
      res.writeHead(err.code === 'LEGACY_TCDB' || /^TCDB_/.test(String(err.code)) ? 422 : fileErrorStatus(err.code), { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message, code: err.code || null, ...(err && err.replaceAll ? err.replaceAll : {}) }));
    }

  } else if (HARNESS_OK && req.method === 'GET' && req.url === '/api/ui-smoke') {
    // release-check only (isolated harness runs): drive the installer window — preload bridge, IPC handlers, renderer — against the live services
    uiSmoke().then((r) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r)); })
      .catch((e) => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); });

  } else if (HARNESS_OK && req.method === 'POST' && req.url === '/api/ui-update-emit') {
    // release-check only (isolated harness runs): push a synthetic updater event through the REAL path (shared status → IPC → the window), to photograph each state
    let body = '';
    req.on('data', (c) => { if (body.length < 20000) body += c.toString(); });
    req.on('end', () => {
      try { const o = JSON.parse(body || '{}'); emitUpdateEvent(String(o.channel || 'update-status'), o.payload); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, status: { ...updateStatus } })); }
      catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); }
    });

  } else if (HARNESS_OK && (req.url || '').startsWith('/api/ui-update')) {
    // release-check only (isolated harness runs): read the installer window's OTA widget (what the user is shown) and press its «restart now» button
    uiUpdate(new URL(req.url, 'http://127.0.0.1'), req.method).then((r) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r)); })
      .catch((e) => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); });

  } else if (HARNESS_OK && req.method === 'POST' && req.url === '/api/ui-eval') {
    // release-check only (isolated harness runs): run a snippet in the installer window and/or capture it (screenshots of the launcher in each language)
    let body = '';
    req.on('data', (c) => { if (body.length < 30000) body += c.toString(); });
    req.on('end', () => {
      let opts; try { opts = JSON.parse(body || '{}'); } catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"ok":false,"error":"bad json"}'); return; }
      uiEval(opts).then((r) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(r)); })
        .catch((e) => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: e.message })); });
    });

  } else if (req.method === 'GET' && (req.url || '').startsWith('/api/employee-roles')) {
    (async () => {
      const companyId = new URL(req.url, 'http://127.0.0.1').searchParams.get('companyId') || '';
      const r = await handleListEmployeeRoles(companyId);
      res.writeHead(r.success ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
    })().catch((e) => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: e.message })); });

  } else if (req.method === 'POST' && req.url === '/api/invite-employee') {
    let body = '';
    req.on('data', (c) => { if (body.length < 20000) body += c.toString(); });
    req.on('end', async () => {
      try {
        const r = await handleInviteEmployee(JSON.parse(body || '{}'));
        res.writeHead(r.success ? 200 : (r.code === 'PLAN_LIMIT_EXCEEDED' ? 402 : r.code === 'EMAIL_EXISTS' ? 409 : 400), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(r));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });

  } else if (req.method === 'POST' && req.url === '/api/restore-tcdb') {
    
    // Upload TCDB file via multipart, restore DB, and set backup path
    const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;   // a .tcdb is compressed + encrypted; nothing legitimate comes near 1 GiB
    const chunks = [];
    let received = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      received += chunk.length;
      if (received > MAX_UPLOAD_BYTES) { tooBig = true; chunks.length = 0; return; }
      if (!tooBig) chunks.push(chunk);
    });
    req.on('end', async () => {
      let heldRestore = false;
      try {
        if (tooBig) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'File too large' }));
          return;
        }
        if (restoreInFlight) throw Object.assign(new Error('يُفتح ملف شركة آخر الآن | Another company file is being opened - wait for it to finish'), { code: 'RESTORE_BUSY' });
        restoreInFlight = true; heldRestore = true;   // (before the upload is written: a refused second open leaves no file behind)
        const body = Buffer.concat(chunks);
        const boundary = req.headers['content-type']?.split('boundary=')[1];
        
        if (!boundary) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'No boundary in multipart' }));
          return;
        }
        
        // Extract file data from multipart
        const boundaryBuf = Buffer.from('--' + boundary);
        const parts = [];
        let start = body.indexOf(boundaryBuf);
        while (start !== -1) {
          const nextStart = body.indexOf(boundaryBuf, start + boundaryBuf.length);
          if (nextStart === -1) break;
          parts.push(body.subarray(start + boundaryBuf.length, nextStart));
          start = nextStart;
        }
        
        let fileData = null;
        let rawFileName = 'backup.tcdb';
        
        for (const part of parts) {
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;
          const header = part.subarray(0, headerEnd).toString();
          if (header.includes('filename=')) {
            const match = header.match(/filename="([^"]*)"/);
            if (match) rawFileName = match[1];
            fileData = part.subarray(headerEnd + 4, part.lastIndexOf('\r\n'));
            break;
          }
        }
        
        if (!fileData) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'No file in request' }));
          return;
        }

        // The multipart filename is chosen by the caller: it must be a plain "<name>.tcdb" — a separator, "..", a drive
        // letter or a control character is refused (NOT cleaned into something else), and the bytes must be a real TCDB
        // container BEFORE anything touches the disk.
        const fileName = netGuard.safeUploadName(rawFileName, { ext: '.tcdb' });
        if (!fileName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid file name' }));
          return;
        }
        if (!isTcdbContainer(fileData)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Not a TexaCore backup file' }));
          return;
        }
        // 2.0.2: a file exported with "protect with a passphrase" carries the phrase as a second multipart field. Checked BEFORE anything is written:
        // a protected file with no/wrong phrase answers with a code (the page then asks for it) and the disk and the database stay untouched.
        let passphrase = '';
        for (const part of parts) {
          const he = part.indexOf('\r\n\r\n');
          if (he === -1) continue;
          const hdr = part.subarray(0, he).toString();
          if (/name="passphrase"/.test(hdr) && !hdr.includes('filename=')) {
            passphrase = part.subarray(he + 4, part.lastIndexOf('\r\n')).toString('utf8').slice(0, 256);
            break;
          }
        }
        try {
          const pm = newBackupManager();
          pm.probeAccess(fileData, { passphrase });
          // 2.0.4: a 1.x file and a file that carries commands TexaCore never writes (S3) are refused BEFORE anything is written to the TexaCore folder
          const major = await pm.preflightBuffer(fileData, { passphrase });
          if (major !== null && major < 17) throw BackupManager.legacyFileError(major);
        } catch (probeErr) {
          if (probeErr && (/^TCDB_/.test(String(probeErr.code)) || probeErr.code === 'LEGACY_TCDB')) {
            res.writeHead(fileErrorStatus(probeErr.code), { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, code: probeErr.code, error: probeErr.message }));
            return;
          }
          throw probeErr;
        }
        
        // 2.0.5: replacing every company needs the explicit yes (a text field `confirmReplaceAll`), and what is replaced is saved first - both BEFORE the upload is written anywhere
        let confirmReplaceAllField = '';
        for (const part of parts) {
          const he = part.indexOf('\r\n\r\n');
          if (he === -1) continue;
          const hdr = part.subarray(0, he).toString();
          if (/name="confirmReplaceAll"/.test(hdr) && !hdr.includes('filename=')) { confirmReplaceAllField = part.subarray(he + 4, part.lastIndexOf('\r\n')).toString('utf8').slice(0, 16); break; }
        }
        const uploadReplaceSnapshot = await assertReplaceAllConfirmed({ confirmReplaceAll: confirmReplaceAllField });
        const uploadPreOpenBackup = await takePreOpenBackup(uploadReplaceSnapshot);

        // 2.0.4: the user's choice on the permission step - keep the company file in the program's own folder (no macOS permission needed)
        let folderChoice = '';
        for (const part of parts) {
          const he = part.indexOf('\r\n\r\n');
          if (he === -1) continue;
          const hdr = part.subarray(0, he).toString();
          if (/name="folder"/.test(hdr) && !hdr.includes('filename=')) { folderChoice = part.subarray(he + 4, part.lastIndexOf('\r\n')).toString('utf8').slice(0, 16); break; }
        }
        // Save to C:\TexaCore (Windows) or ~/TexaCore (Mac/Linux; 2.0.5 - it was ~/Documents/TexaCore). A NEW file only: files an install already has are not moved.
        const os = require('os');
        const isWin = process.platform === 'win32';
        // (isolated test runs — HARNESS_OK — may point this at a scratch folder so they never write into the real one)
        const tcdbDir = folderChoice === 'program'
          ? path.join(DATA_DIR, 'company-files')
          : ((HARNESS_OK && process.env.TEXACORE_TCDB_DIR)
            ? path.resolve(process.env.TEXACORE_TCDB_DIR)
            : companyFile.defaultCompanyDir());
        if (folderChoice !== 'program') await requireFolderAccess(tcdbDir);   // 2.0.4: macOS must have said yes before the synchronous folder calls below
        if (!fs.existsSync(tcdbDir)) fs.mkdirSync(tcdbDir, { recursive: true });
        // 2.0.2 (review): a FREE name - the picked file may itself live in this folder (a passphrase-protected export saved to the company folder):
        // the live sync below rewrites tcdbPath every minute with the install key, so tcdbPath must never be an existing file.
        const tcdbPath = companyFile.uniqueTcdbPath(tcdbDir, fileName.replace(/\.tcdb$/i, ''));
        // Belt and braces: whatever the name was, the final path must be a direct child of the TexaCore folder.
        if (path.dirname(path.resolve(tcdbPath)) !== path.resolve(tcdbDir)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid file name' }));
          return;
        }
        // Write to a temp name inside the same folder, then rename: a half-written upload never replaces a good backup.
        const tmpPath = path.join(tcdbDir, `.restore-${process.pid}-${Date.now()}.tmp`);
        try {
          fs.writeFileSync(tmpPath, fileData, { flag: 'wx', mode: 0o600 });
          try { fs.linkSync(tmpPath, tcdbPath); }   // fails with EEXIST instead of replacing a file that appeared meanwhile (EEXIST always throws)
          catch (le) {
            if (!le || !['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS'].includes(le.code)) throw le;
            // FAT/exFAT sticks and some shares have no hard links: copy with COPYFILE_EXCL (still never replaces an existing file)
            try { fs.copyFileSync(tmpPath, tcdbPath, fs.constants.COPYFILE_EXCL); }
            catch (ce) { if (ce && ce.code !== 'EEXIST') { try { fs.unlinkSync(tcdbPath); } catch { /* nothing was created */ } } throw ce; }
          }
          fs.unlinkSync(tmpPath);
        } catch (werr) {
          try { fs.unlinkSync(tmpPath); } catch { /* already gone */ }
          throw werr;
        }
        console.log(`[Restore] TCDB saved to: ${tcdbPath} (${(fileData.length / 1024).toFixed(0)} KB)`);
        
        const prevSync = { prevTarget: backupManager ? backupManager.backupPath : null, prevSecondary: backupManager ? backupManager.secondaryBackupPath : null, wasSyncing: !!(backupManager && backupManager._timer) };
        // Initialize backupManager if needed
        if (!backupManager) {
          const pgBinDir = svcManager ? path.join(svcManager.binsDir, 'pg', 'bin') : (isWin ? 'C:\\Program Files\\PostgreSQL\\16\\bin' : '/opt/homebrew/bin');
          const dbPass = svcManager ? svcManager.dbPassword : '';
          backupManager = new BackupManager({
            pgBinDir, dbHost: 'localhost', dbPort: ServiceManager.PG_PORT || 54322,
            dbName: 'postgres', dbUser: 'postgres', dbPassword: dbPass,
            backupPath: tcdbPath,
            encryptionKey: 'texacore-default-backup-key-2026',
            intervalMs: 60 * 1000,
            onProgress: (phase, detail) => console.log(`[Backup] ${phase}: ${detail}`),
            onError: (err) => console.error('[Backup] Error:', err.message),
          });
        }
        
        // Restore the database from TCDB
        try { backupManager.stopSync(); } catch { /* not running */ }   // the previous timer must not write into the new target mid-restore (startSync below re-arms it)
        await backupManager.waitIdle();   // a dump already running finishes first (see restoreTcdbFromPath)
        backupManager.backupPath = tcdbPath;
        backupManager.secondaryBackupPath = null;   // 2.0.2: see restoreTcdbFromPath - the second copy belongs to the previous company file
        backupManager.restoreLogDir = LOG_DIR;
        const restoreResult = await backupManager.restore(tcdbPath, { passphrase }).catch((e) => { backupManager.afterFailedRestore(prevSync); throw e; });

        // Inject the vendor support account into the just-restored DB — vendor
        // machine ONLY (gated by vendor-support.json) — so you can log in to a
        // customer's restored backup with your own username + password.
        try { if (svcManager) await svcManager._ensureSuperAdmin(); } catch (e) { console.warn('[Restore] vendor inject:', e.message); }

        // Start periodic sync to keep this file updated
        backupManager.startSync();
        
        // Save config
        try {
          const config = loadConfig();
          const companyName = fileName.replace('.tcdb', '');
          config.companies = [{ name: companyName, tcdbPath, storagePath: tcdbDir }];
          saveConfig(config);
        } catch {}
        
        console.log(`[Restore] ✅ DB restored from ${tcdbPath}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, tcdbPath, preOpenBackup: uploadPreOpenBackup || undefined, ...restoreResult }));
      } catch (err) {
        console.error('[Restore] ❌ Failed:', err.message);
        res.writeHead(/^TCDB_/.test(String(err.code)) ? 422 : (err.code === 'RESTORE_BUSY' || err.code === 'REPLACE_ALL_CONFIRM_REQUIRED' ? 409 : (err.code === 'FOLDER_PERMISSION' ? 403 : 500)), { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message, code: err.code || null, ...(err.code === 'FOLDER_PERMISSION' ? { area: err.area || null, state: err.state || 'denied' } : {}), ...(err && err.replaceAll ? err.replaceAll : {}) }));
      } finally {
        if (heldRestore) restoreInFlight = false;
      }
    });
    return;

  } else {
    res.writeHead(404);
    res.end();
  }
});

httpServer.listen(ServiceManager.ADMIN_PORT, '127.0.0.1', () => {
  console.log('Local API Server listening on port ' + ServiceManager.ADMIN_PORT);
});

// Start ERP
ipcMain.handle('start-erp', async (_, { licenseKey, dbPassword, port, enableCloud, subdomain }) => {
  try {
    // ── License validation before starting services ──
    if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
    let licCheck = licenseGuard.validate();
    // A TRIAL that just expired lands on Free (offline) instead of locking the
    // app — re-validate as free afterwards so startup proceeds.
    if (!licCheck.valid && licCheck.reason === 'expired' && landTrialToFree()) {
      licCheck = licenseGuard.validate();
    }
    if (!licCheck.valid) {
      const reasons = {
        no_license: 'لا يوجد ترخيص — يرجى تفعيل الترخيص أولاً',
        expired: 'انتهت صلاحية الترخيص — يرجى تجديده',
        revoked: 'تم إلغاء الترخيص — تواصل مع الدعم',
        suspended: 'الترخيص معلّق — تواصل مع الدعم',
        clock_tamper: 'اكتُشف تلاعب بساعة الجهاز — صحّح الوقت أو تواصل مع الدعم',
      };
      return { success: false, error: reasons[licCheck.reason] || 'ترخيص غير صالح' };
    }

    // Save config
    const currentConfig = loadConfig();
    saveConfig({ ...currentConfig, licenseKey, dbPassword, port: port || APP_PORT, enableCloud, subdomain });

    // Start all embedded services (with migration progress reporting)
    const result = await svcManager.startAll({
      dbPassword: dbPassword || undefined,
      port: port || APP_PORT,
      onMigrationProgress: (step, total, name) => {
        mainWindow?.webContents.send('migration-progress', { step, total, name });
      },
    });
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Force every tenant onto the plan matching the current license tier
    // (free→free, trial→professional, paid→its plan). This re-gates modules +
    // limits so flipping the license (or landing off an expired trial) takes
    // effect on the next launch. apply_tenant_plan rebuilds tenant_modules.
    await syncActivePlan();
    startPlanSyncLoop();

    return { success: true, ready: true, port: port || APP_PORT, migrations: result.migrations };
  } catch (err) {
    return { success: false, error: err.message };
  } finally {
    // Resume backup sync after services are running
    if (svcManager && !backupManager) {
      setTimeout(() => initBackupOnStartup(), 5000);
    }
  }
});

// Migration Status
ipcMain.handle('migration-status', async () => {
  try {
    if (!svcManager) return { total: 0, applied: 0, pending: 0 };
    return await svcManager.getMigrationStatus();
  } catch (err) {
    return { total: 0, applied: 0, pending: 0, error: err.message };
  }
});

// Stop ERP
ipcMain.handle('stop-erp', async () => {
  try {
    if (svcManager) await svcManager.stopAll();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Toggle cloud access: persist the flag AND actually start/stop the tunnel now,
// so turning it off immediately cuts off the public subdomain (not just hides UI).
ipcMain.handle('set-cloud-access', async (_, enabled) => {
  try {
    const config = loadConfig();
    config.enableCloud = !!enabled;
    saveConfig(config);
    if (svcManager) {
      if (enabled) {
        svcManager.resetRouteState();
        // Fast reconnect: reuse the existing tunnel token (same tunnel id) so it
        // comes back in seconds, not the ~30-60s a fresh tunnel needs to propagate.
        await svcManager.startCloudflared({ skipReregister: true });
      } else {
        svcManager.stopCloudflared();
      }
    }
    fileLog(`[TexaCore] Cloud access ${enabled ? 'ENABLED' : 'DISABLED'} by user`);
    return { success: true, enabled: !!enabled, tunnel: svcManager ? svcManager.getTunnelStatus() : null };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── Admin portal password (بوابة الإدارة) ──────────────────
// Change the password that gates the "view all companies" admin portal. No old
// password needed — controlling the installer is the authority. Stored hashed.
ipcMain.handle('set-admin-password', async (_, newPassword) => {
  try {
    if (!svcManager) return { success: false, error: 'النظام غير مهيّأ' };
    await svcManager.setAdminPassword(newPassword);
    fileLog('[TexaCore] Admin portal password changed by user');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message, code: err.code || null, minLength: require('./admin-password').MIN_LENGTH };
  }
});

// Whether the manager set a custom admin password, or it's still the default.
ipcMain.handle('get-admin-password-status', async () => {
  try {
    const cfg = loadConfig();
    const ap = require('./admin-password');
    // the window words its text from these (the policy has ONE source: admin-password.js)
    return { success: true, customized: !!cfg.adminPasswordHash, hasDefault: !!ap.defaultAdminPasswordFor(cfg.licenseKey), minLength: ap.MIN_LENGTH };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Start Trial
ipcMain.handle('start-trial', async () => {
  try {
    if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);

    const hardwareId = licenseGuard.getHardwareId();

    const result = await httpPost(`${LICENSING_URL}/license-trial`, {
      hardware_id: hardwareId,
      os_info: `${process.platform} ${process.arch}`,
      hostname: require('os').hostname(),
    });

    if (result.success) {
      ensureDataDir();
      // Save encrypted license (hardware-bound)
      licenseGuard.saveLicense(result.license);
      const config = loadConfig();
      config.licenseKey = result.license.license_key;
      config.isTrial = true;
      config.isFree = false;   // a trial is not free — clear the free flag
      saveConfig(config);
      return { success: true, license: result.license };
    }

    // If trial already exists, use existing
    if (result.error === 'trial_already_exists' && result.license) {
      ensureDataDir();
      licenseGuard.saveLicense(result.license);
      return { success: true, license: result.license, existing: true };
    }

    return { success: false, error: result.error || result.message || 'Trial failed' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Start Free — fully OFFLINE. No cloud licensing call: we mint a local,
// hardware-bound free license (no expires_at → never expires). The 200/200/1
// smart limits are enforced by local DB triggers reading subscription_plans(free),
// and refreshed from the cloud opportunistically on heartbeat when online.

// Register/refresh this device's FREE license in the cloud (anon RPC). Returns the
// license {license_key, status, ...} — a STABLE FREE-2026 number, 1 per device — or
// null when offline. Idempotent: re-calling for the same hardware returns the same
// number and updates last_heartbeat_at, so every free copy is tracked & controllable.
async function registerFreeOnline() {
  try {
    if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
    const raw = await httpPostRpc('licensing_register_free', {
      p_hardware_id: licenseGuard.getHardwareId(),
      p_hostname: require('os').hostname(),
      p_os_info: `${process.platform} ${process.arch}`,
      p_app_version: app.getVersion(),
    });
    const res = typeof raw === 'string' ? (raw ? JSON.parse(raw) : null) : raw;
    if (res && res.success && res.license && res.license.license_key) return res.license;
    return null;
  } catch (e) {
    fileLog('[Free] registerFreeOnline failed (offline?):', e.message);
    return null;
  }
}

// Start Free — registers a STABLE cloud number online (FREE-2026-XXXXX, 1/device), or
// falls back to a local placeholder offline that binds to the real number on the first
// online heartbeat. Limits are enforced by local DB triggers and refreshed each beat.
ipcMain.handle('start-free', async () => {
  try {
    if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
    ensureDataDir();

    const config = loadConfig();
    // Keep the previous (real) key so the user can restore it later — never wipe it.
    if (config.licenseKey && !String(config.licenseKey).startsWith('FREE')) {
      config.previousLicenseKey = config.licenseKey;
    }

    const cloud = await registerFreeOnline();            // null when offline
    const licenseKey = (cloud && cloud.license_key) ? cloud.license_key : 'FREE-LOCAL';

    const freeLicense = {
      tier: 'free',
      status: (cloud && cloud.status) || 'active',
      license_key: licenseKey,
      plan_type: 'free',
      max_users: 1,
      max_companies: 1,
      max_warehouses: 1,
      max_storage_gb: -1,           // unlimited disk locally
      enabled_modules: [],
      custom_branding: false,
      cloud_backup: true,           // free copies back up to our cloud (1 GB)
      api_access: false,
      features: {},
      // NB: no expires_at → validate() never marks it expired.
    };
    licenseGuard.saveLicense(freeLicense);

    config.licenseKey = licenseKey;
    config.isTrial = false;
    config.isFree = true;
    saveConfig(config);

    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('license-updated', { tier: 'free', status: freeLicense.status });
    // إعادة التشغيل تُنفّذها الواجهة (stopERP→startERP) بعد النجاح — التدفّق المُثبت.

    fileLog(`[TexaCore] 🆓 Free activated — ${cloud ? 'cloud #' + licenseKey : 'offline (local), will bind on first online beat'}`);
    return { success: true, license: freeLicense, online: !!cloud };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── Trial → Free landing ────────────────────────────────────
// When a TRIAL ends (expired locally, or its cloud license vanished), we do NOT
// lock the app — we land it on the Free plan (offline, forever) by rewriting the
// local license. Guarded by config.isTrial so a PAID license is never auto-
// downgraded (it keeps the lock/renew flow). Returns true if it landed.
function landTrialToFree() {
  try {
    if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
    const cfg = loadConfig();
    if (cfg.isTrial !== true) return false;          // only trials land — never downgrade paid
    const lic = licenseGuard.loadLicense();
    if (!lic || lic.tier === 'free') return false;   // nothing to do
    const freeLicense = {
      ...lic,
      tier: 'free',
      status: 'active',
      plan_type: 'free',
      max_users: 1,
      max_companies: 1,
      max_warehouses: 1,
      max_storage_gb: -1,
      enabled_modules: [],
      custom_branding: false,
      cloud_backup: false,
      api_access: false,
    };
    delete freeLicense.expires_at;                   // free never expires
    licenseGuard.saveLicense(freeLicense);
    cfg.isTrial = false;
    cfg.isFree = true;
    // ⚠️ امسح مفتاح TRL-* القديم: حارس _looksFree بالنبضة يعتبر أي مفتاح غير FREE
    // «رخصة حقيقية» فيمسح isFree كل نبضة ⇒ مسار المجاني (ربط FREE-2026 المستقر +
    // تحديث المنحة) لا يعمل أبداً، وقد يعيد سحب tier=trial من السحابة (تذبذب
    // free↔pro). بمسحه يمرّ _looksFree ويربط الرقم المستقر في أول نبضة أونلاين.
    cfg.licenseKey = '';
    saveConfig(cfg);
    fileLog('[TexaCore] 🆓 Trial ended → landed on Free plan (offline, forever).');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('license-updated', { tier: 'free', status: 'active' });
    }
    return true;
  } catch (e) {
    fileLog('[TexaCore] landTrialToFree error:', e.message);
    return false;
  }
}

// ─── Free plan limit sync (heartbeat, online) ────────────────
// ─── Active-plan sync (heartbeat + company creation + start) ──────────────────
// The plan for this install's license tier is INSERTed/UPDATEd from the license (cloud row when online — the heartbeat has
// just written it into the cached license — else the cached copy), every tenant's subscription is pointed at it, and the
// server's own trigger (tenant_subscriptions → tenant_modules) rebuilds the module gating. See src/plan-sync.js for why
// the 1.x version (UPDATE-only, apply_tenant_plan) never gated anything.

// H2: the tier used for PLAN RESOLUTION must be the ENFORCED-OR-NOT effective tier, not the raw license tier. While
// ENFORCE_SIGNATURE=false this equals license.tier; when flipped on, an unsigned/invalid license resolves to 'free'.
function currentEffectiveTier() {
  try { return licenseGuard.effectiveTier(licenseGuard.loadLicense()); }
  catch { return null; }
}

function planCodeForTier(tier) { return planSync.planCodeForTier(tier); }

// The control panel's plan catalogue (public subscription_plans, anon read): every active plan, plus the plan the licence points at by name
// when that one is not among them. null when the cloud cannot be reached (offline / blocked) — the caller then keeps the last synced rows.
async function fetchCloudPlans(licensePlanCode) {
  const get = async (query) => {
    const r = await cloudClient.request(CLOUD, { method: 'GET', path: `/rest/v1/subscription_plans?${query}`, timeout: 4000,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } });
    if (r.status !== 200) throw new Error(`catalogue HTTP ${r.status}`);
    const a = JSON.parse(r.text);
    if (!Array.isArray(a)) throw new Error('catalogue is not a list');
    return a;
  };
  try {
    const plans = await get('select=*&is_active=eq.true&limit=200');
    if (licensePlanCode && /^[A-Za-z0-9_-]{1,50}$/.test(licensePlanCode) && !plans.some((p) => p && p.code === licensePlanCode)) {
      try { plans.push(...await get(`select=*&code=eq.${encodeURIComponent(licensePlanCode)}&limit=1`)); } catch { /* the licence's plan stays unsynced */ }
    }
    return plans;
  } catch (e) {
    fileLog('[Plan] cloud catalogue unreachable (offline?) — last synced plan values stay in force:', e.message);
    return null;
  }
}

// Pull the licence state (plan_code, custom_limits, tier/expiry, module grant) from the cloud and cache it in the local licence. Best-effort.
async function refreshLicenseFromCloud() {
  try {
    const config = loadConfig();
    if (!config || !config.licenseKey || !licenseGuard) return false;
    const raw = await httpPostRpc('licensing_get_license_state', { p_license_key: config.licenseKey });
    const state = typeof raw === 'string' ? (raw ? JSON.parse(raw) : null) : raw;
    if (!state || !state.tier) return false;
    if (config.isFree === true) state.tier = 'free';      // the user's explicit Free choice is never flipped by a sync
    licenseGuard.applyCloudState(state);
    return true;
  } catch { return false; }
}

// Whenever the network is there, the plan catalogue and the licence's plan are pulled and applied; offline ticks change nothing.
let _planLoop = null;
function startPlanSyncLoop() {
  if (_planLoop || CLOUD.kind === 'off') return;
  const every = (HARNESS_OK && Number(process.env.TEXACORE_PLAN_SYNC_MS) > 0) ? Number(process.env.TEXACORE_PLAN_SYNC_MS) : 15 * 60 * 1000;
  const tick = async () => {
    try {
      if (!svcManager || !svcManager.isRunning()) return;
      await refreshLicenseFromCloud();
      await syncActivePlan();
    } catch (e) { fileLog('[Plan] sync tick:', e.message); }
  };
  _planLoop = setInterval(tick, every);
  if (_planLoop.unref) _planLoop.unref();
}

let _planSyncChain = Promise.resolve();
async function syncActivePlan(tierOverride, { tenantId = null, throwOnError = false } = {}) {
  // serialised: heartbeat, start-erp and company creation can all ask at once
  const run = async () => {
    if (!svcManager) return false;
    let tier = tierOverride || null;
    let license = null;
    try { license = licenseGuard ? licenseGuard.loadLicense() : null; } catch { /* no license yet */ }
    if (!tier) tier = (licenseGuard && licenseGuard.effectiveTier) ? currentEffectiveTier() : null;
    tier = tier || 'free';                       // unknown / no license → the free plan (restrictive, never fail open)

    const cloudPlans = CLOUD.kind === 'off' ? null : await fetchCloudPlans(tierOverride ? null : (license && license.plan_code));
    const res = await planSync.syncActivePlan(
      { pgQuery: (t, p) => svcManager.pgQuery(t, p), pgTx: (fn) => svcManager.pgTransaction(fn), log: fileLog },
      { tier, license, cloudPlans, tenantId, forceTier: !!tierOverride });
    try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('modules-updated'); } catch (e) {}
    fileLog(`[Plan] ✅ active plan synced: tier=${tier} → ${res.code}${res.online ? ' (cloud catalogue applied)' : ' (offline: last synced values)'}`);
    return true;
  };
  const p = _planSyncChain.then(run, run);
  _planSyncChain = p.catch(() => {});
  try { return await p; }
  catch (e) {
    fileLog('[Plan] sync failed:', e.message);
    if (throwOnError) throw e;
    return false;
  }
}

// Open browser
ipcMain.handle('open-browser', (_, portOrUrl) => {
  if (typeof portOrUrl === 'string' && portOrUrl.startsWith('http')) {
    shell.openExternal(portOrUrl);
  } else {
    shell.openExternal(`http://localhost:${portOrUrl || APP_PORT}`);
  }
});

// Window controls
ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-close', () => mainWindow?.close());

// Legacy Docker handlers — kept as no-ops for frontend compatibility
ipcMain.handle('download-docker', async () => ({ success: true, message: 'Docker not required' }));
ipcMain.handle('show-in-folder', async (_, filePath) => { shell.showItemInFolder(filePath); });
ipcMain.handle('install-docker', () => ({ success: true, message: 'Docker not required' }));

// ─── System Tray ─────────────────────────────────────────────
// Windows / Linux: the tray draws a 16 px (100 % scaling) or 32 px (200 %) image. build/icon.ico carries real 16/24/32/48/64/128/256 entries, so Windows
// picks the hand-sized one instead of a 256 px PNG squeezed down by `resize()` (which looked smeared). Falls back to the PNG only if the .ico is missing.
function trayIconNonMac(buildDir) {
  const ico = nativeImage.createFromPath(path.join(buildDir, 'icon.ico'));
  if (!ico.isEmpty()) return ico;
  return nativeImage.createFromPath(path.join(buildDir, 'icon.png')).resize({ width: 16, height: 16 });
}

function createTray() {
  // macOS: template icon (pure black + alpha — the PNGs were regenerated with a
  // real transparent background; an opaque white bg made the menu bar draw a
  // solid square). Windows: template black-on-transparent would vanish on a dark
  // taskbar, so use the colored logo resized for the tray instead.
  const buildDir = app.isPackaged
    ? path.join(process.resourcesPath, 'build')
    : path.join(__dirname, '..', 'build');
  let icon;
  if (process.platform === 'darwin') {
    icon = nativeImage.createFromPath(path.join(buildDir, 'trayTemplate.png'));
    icon.setTemplateImage(true);
  } else {
    icon = trayIconNonMac(buildDir);
  }
  tray = new Tray(icon);
  tray.setToolTip('TexaCore ERP');

  const updateTrayMenu = async () => {
    const running = svcManager ? svcManager.isRunning() : false;
    const contextMenu = Menu.buildFromTemplate([
      {
        // the title row is a status line (greyed out on purpose): the version and whether the system is running; rebuilt every 10 s and after start/stop
        label: `TexaCore ERP ${app.getVersion()} — ${running ? 'يعمل' : 'متوقف'}`,
        enabled: false,
        icon: icon,
      },
      { type: 'separator' },
      {
        label: 'فتح لوحة التحكم',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        },
      },
      {
        label: 'فتح في المتصفح',
        click: () => {
          const config = loadConfig();
          shell.openExternal(`http://localhost:${config.port || APP_PORT}`);
        },
      },
      { type: 'separator' },
      {
        label: running ? 'إيقاف النظام' : 'تشغيل النظام',
        click: async () => {
          if (running) {
            if (svcManager) await svcManager.stopAll();
          } else {
            if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
            else createWindow();
          }
          updateTrayMenu();
        },
      },
      { type: 'separator' },
      {
        label: 'إنهاء TexaCore',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  };

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  updateTrayMenu();
  // Refresh tray menu every 10 seconds
  setInterval(updateTrayMenu, 10000);
}

// ─── Auto-Update System ──────────────────────────────────────
// macOS builds are ad-hoc signed; Squirrel.Mac refuses to apply updates to
// non-Developer-ID apps, so on mac we use our own updater (src/mac-updater.js):
// silent background download from the latest GitHub release, sha512-verified,
// staged, then installed by a detached script on quit/restart — same UX as
// Windows. Windows keeps using electron-updater untouched.
let macUpdater = null;

// Shared update status served by the local API (GET /api/update/status) so the
// ERP web UI (localhost:8080) can show a live update widget. Fed by BOTH the
// mac MacUpdater flow and the Windows electron-updater flow through
// emitUpdateEvent(), which also forwards the event to the installer renderer.
const updateStatus = createUpdateStatus();
function emitUpdateEvent(channel, payload) {
  applyUpdateEvent(updateStatus, channel, payload);
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload); } catch { /* the window is closing */ }
}
let winUpdater = null;
const activeUpdater = () => macUpdater || winUpdater;
// The installer window's Pause / Resume / Retry-now buttons, the ERP page and the tray all land here. Returns whether the action applied.
function updateControl(action) {
  const u = activeUpdater();
  if (!u) return false;
  if (action === 'pause') return !!u.pause();
  if (action === 'resume') return !!u.resume();
  if (action === 'retry') return !!u.retryNow();
  return false;
}
// "The network is back" → retry the download at once instead of waiting out the backoff: Electron's online state flipping to online, and the machine
// waking from sleep (a connection that was open before the sleep is dead; the updater drops it and resumes). Both are cheap and run for the app's lifetime.
function watchNetworkForUpdates() {
  try {
    const { net, powerMonitor } = require('electron');
    let online = net.isOnline();
    const t = setInterval(() => {
      let now = online; try { now = net.isOnline(); } catch { /* not ready */ }
      if (now && !online) { fileLog('[Update] network is back'); activeUpdater()?.networkUp('online'); if (svcManager) svcManager.reprobeRoute('network-resume'); }
      online = now;
    }, 5000);
    if (t.unref) t.unref();
    powerMonitor.on('resume', () => setTimeout(() => { fileLog('[Update] woke from sleep'); activeUpdater()?.networkUp('resume'); if (svcManager) svcManager.reprobeRoute('network-resume'); }, 3000));
    powerMonitor.on('unlock-screen', () => { activeUpdater()?.networkUp('unlock'); if (svcManager) svcManager.reprobeRoute('network-resume'); });
  } catch (e) { fileLog('[Update] network watch not available:', e.message); }
}
// isolated harness runs only: tuning of the download engine (stall / backoff times) so a test does not wait 45 s and 15 s
function updaterTuning() {
  if (!HARNESS_OK || !process.env.TEXACORE_UPDATE_TUNING) return {};
  try { return JSON.parse(process.env.TEXACORE_UPDATE_TUNING); } catch { return {}; }
}

function setupAutoUpdater() {
  const isMac = process.platform === 'darwin';

  if (isMac) {
    const tuning = updaterTuning();
    macUpdater = new MacUpdater({
      getVersion: () => app.getVersion(),
      userDataPath: app.getPath('userData'),
      isPackaged: app.isPackaged,
      log: fileLog,
      emit: emitUpdateEvent,
      isOnline: () => { try { return require('electron').net.isOnline(); } catch { return true; } },
      engine: tuning.engine,
      checkInitialDelayMs: tuning.checkInitialDelayMs,
      checkIntervalMs: tuning.checkIntervalMs,
      // No native modal on "ready": the subtle in-app update widget (fed by the
      // 'update-downloaded' event above) is the only surface. The staged update
      // installs on the next quit/relaunch via the quit-hook installer, or
      // immediately when the user clicks the widget's restart action.
      onStaged: (version) => fileLog('[MacUpdater] update staged & ready (widget-only, no modal):', version),
    });
    macUpdater.start();
    watchNetworkForUpdates();
    return;
  }

  // Windows: electron-updater installs; src/win-updater.js puts the resumable download (Range resume, stall detector, backoff, pause) in front of its
  // download step and hands the verified installer over through electron-updater's own cache. A failed hand-over falls back to its stock download.
  const tuning = updaterTuning();
  winUpdater = new WinUpdater({
    autoUpdater,
    getVersion: () => app.getVersion(),
    userDataPath: app.getPath('userData'),
    log: fileLog,
    emit: (channel, payload) => {
      if (channel === 'update-downloaded' && autoUpdater.updateInfoAndProvider?.info?.version) updateStatus.version = autoUpdater.updateInfoAndProvider.info.version;
      emitUpdateEvent(channel, payload);
    },
    isOnline: () => { try { return require('electron').net.isOnline(); } catch { return true; } },
    engine: tuning.engine,
    checkInitialDelayMs: tuning.checkInitialDelayMs,
    checkIntervalMs: tuning.checkIntervalMs,
  });
  winUpdater.start();
  watchNetworkForUpdates();
}

// Check for update (manual)
ipcMain.handle('check-for-update', async () => {
  if (process.platform === 'darwin') {
    const r = await (macUpdater?.checkForUpdates() ?? { available: false });
    return { available: !!r.available, version: r.version };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    return { available: !!result?.updateInfo, version: result?.updateInfo?.version };
  } catch {
    return { available: false };
  }
});

// Download update
ipcMain.handle('download-update', async () => {
  if (process.platform === 'darwin') {
    return await (macUpdater?.downloadUpdate() ?? { success: false, error: 'updater not ready' });
  }
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// The current download status (the window asks when it opens or reloads: a paused or waiting download sends no events for minutes)
ipcMain.handle('get-update-status', () => ({ ...updateStatus }));
// Pause / Resume / Retry now — one entry for the three buttons of the installer window
ipcMain.handle('update-control', (_, action) => ({ ok: updateControl(String(action)), status: { ...updateStatus } }));

// Install update
ipcMain.handle('install-update', () => {
  app.isQuitting = true;
  if (process.platform === 'darwin') {
    // The staged update is installed by the detached script spawned on quit.
    app.quit();
    return;
  }
  autoUpdater.quitAndInstall();
});

// Check Docker image update — no-op in embedded mode
ipcMain.handle('check-docker-update', async () => ({ available: false }));

// ─── App Lifecycle ───────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Mint a local license for the launch check (DEV_HARNESS only). Offline, hardware-bound like a real one.
function mintHarnessLicense(kind) {
  if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
  const day = 24 * 3600 * 1000;
  const lic = kind === 'trial'
    ? { tier: 'trial', status: 'active', license_key: 'TRL-E2E-0000', plan_type: 'trial', max_users: 10, max_companies: 3, max_warehouses: 10, max_storage_gb: -1,
        enabled_modules: [], activated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 14 * day).toISOString() }
    : { tier: 'free', status: 'active', license_key: 'FREE-LOCAL', plan_type: 'free', max_users: 1, max_companies: 1, max_warehouses: 1, max_storage_gb: -1,
        enabled_modules: [], custom_branding: false, cloud_backup: false, api_access: false, features: {} };
  licenseGuard.saveLicense(lic);
  const cfg = loadConfig();
  cfg.licenseKey = lic.license_key; cfg.isTrial = kind === 'trial'; cfg.isFree = kind !== 'trial';
  saveConfig(cfg);
  return lic;
}

app.whenReady().then(() => {
  ensureDataDir();
  // Secrets at rest (OS keychain / DPAPI via safeStorage) — policy in secrets-vault.js; an existing secrets.enc is always opened.
  try {
    const sv = require('./secrets-vault');
    const policy = sv.secretsAtRestPolicy({ platform: process.platform, env: process.env, config: ((require('../package.json').texacore || {}).secretsAtRest) || {}, harnessOk: HARNESS_OK, execPath: process.execPath });
    sv.setVault(sv.createVault({ safeStorage: require('electron').safeStorage, policy }));
    fileLog(`[TexaCore] secrets at rest: ${policy.write ? 'OS keychain (safeStorage)' : '0600 file'} — ${policy.reason}`);
  } catch (e) { fileLog('[TexaCore] secrets vault not initialised:', e.message); }
  try {
    svcManager = new ServiceManager(app.getPath('userData'));   // classifies the data dir first (a 1.x dir is moved aside)
    svcManager.setLogger(fileLog);                                // tunnel events (start / exit code / last lines, redacted) go to heartbeat.log too
    svcManager.getProvisioningDeps = () => provisioningDeps();   // 2.0.5 RC2: the local invite route (/local-api/invite-user) gets the same deps as the IPC flows
    svcManager.setHardwareIdProvider(() => { if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR); return licenseGuard.getHardwareId(); });
  } catch (e) {
    if (e && e.code === 'SECRETS_UNAVAILABLE') {
      fileLog('[TexaCore] ❌', e.message);
      if (DEV_HARNESS) { fileLog('E2E_READY', JSON.stringify({ ok: false, error: e.message })); return; }
      dialog.showErrorBox('TexaCore ERP', `${e.message}\n\nNothing was changed. Unlock the keychain / allow TexaCore ERP access and start the program again.`);
      app.quit();
      return;
    }
    throw e;
  }
  if (svcManager.bootMovedTo) fileLog('[TexaCore] previous data dir set aside →', svcManager.bootMovedTo);
  if (!DEV_HARNESS) { createTray(); createWindow(); setupAutoUpdater(); }
  else if (process.platform === 'darwin' && app.dock) { try { app.dock.hide(); } catch { /* headless */ } }

  // Always start heartbeat — it will handle missing license gracefully
  const config = loadConfig();
  fileLog('[TexaCore] App ready — Config loaded');
  fileLog('[TexaCore] Version:', app.getVersion(), '| ports:', JSON.stringify(PORTS));
  fileLog('[TexaCore] Config path:', CONFIG_FILE);
  fileLog('[TexaCore] License key:', config.licenseKey ? `${config.licenseKey.substring(0, 15)}... ✅` : '❌ NOT SET');
  fileLog('[TexaCore] Data dir:', DATA_DIR);
  fileLog('[TexaCore] Log file:', LOG_FILE);

  if (DEV_HARNESS) {
    // Launch check: no cloud presence / heartbeat / diagnostics. Optionally auto-start the services.
    if (process.env.TEXACORE_UI_SMOKE === '1') createWindow();      // hidden (see createWindow): the check drives the real preload bridge + renderer through /api/ui-smoke
    // OTA release check (isolated runs only): the installer window and the REAL updater, still with no cloud presence / heartbeat. The feed is never overridden in
    // the product: the check redirects github.com at the network layer from OUTSIDE the app (scripts/e2e/net-redirect-preload.js).
    if (process.env.TEXACORE_UPDATE_TEST === '1') { if (process.env.TEXACORE_UI_SMOKE !== '1') createWindow(); setupAutoUpdater(); }
    if (process.env.TEXACORE_E2E_AUTOSTART === '1') {
      (async () => {
        try {
          const kind = process.env.TEXACORE_E2E_LICENSE || 'free';
          mintHarnessLicense(kind);
          fileLog(`[E2E] license minted (${kind}); starting services…`);
          const result = await svcManager.startAll({ port: PORTS.ui, onMigrationProgress: (step, total, name) => fileLog(`[E2E] boot ${step}/${total} ${name}`) });
          fileLog('[E2E] startAll →', JSON.stringify({ success: result.success, error: result.error, firstRun: result.firstRun }));
          if (result.success) { await syncActivePlan(); startPlanSyncLoop(); }
          fileLog('E2E_READY', JSON.stringify({ ok: !!result.success, error: result.error || null, ports: PORTS, userData: app.getPath('userData') }));
          // optional: exercise the stop → start path in-process (what a license change does via restartEnginesForLicenseChange)
          const cycles = parseInt(process.env.TEXACORE_E2E_RESTART_CYCLES || '0', 10);
          for (let i = 1; i <= cycles && result.success; i++) {
            await svcManager.stopAll();
            await new Promise((r) => setTimeout(r, 1500));
            const again = await svcManager.startAll({ port: PORTS.ui });
            if (again.success) await syncActivePlan();
            fileLog('E2E_RESTART', JSON.stringify({ cycle: i, ok: !!again.success, error: again.error || null, firstRun: !!again.firstRun, health: await svcManager.getHealth() }));
          }
        } catch (e) { fileLog('E2E_READY', JSON.stringify({ ok: false, error: e.message })); }
      })();
    }
    return;
  }

  heartbeatSender.start();

  // Start Realtime Presence for instant online/offline status
  if (config.licenseKey) {
    realtimePresence.connect(config.licenseKey);
  }
  // Also connect presence after license recovery (give heartbeat time to recover key)
  setTimeout(() => {
    const cfg = loadConfig();
    if (cfg.licenseKey && !realtimePresence.ws) {
      realtimePresence.connect(cfg.licenseKey);
    }
  }, 15000);

  // ── Auto-start the embedded services on launch ──
  // The user asked not to have to click "Start" every time. We still expose the
  // Stop button, and we skip auto-start if there's no valid license (or it's
  // revoked/suspended/expired) or the services are already running.
  setTimeout(async () => {
    try {
      const cfg = loadConfig();
      if (!cfg.licenseKey) return;
      if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
      const lic = licenseGuard.validate();
      if (!lic.valid) { fileLog('[AutoStart] Skipped — license not valid:', lic.reason); return; }
      const health = svcManager ? await svcManager.getHealth() : { running: false };
      if (health.running) { fileLog('[AutoStart] Services already running — skip'); return; }
      fileLog('[AutoStart] 🚀 Starting embedded services automatically...');
      const result = await svcManager.startAll({
        port: cfg.port || APP_PORT,
        onMigrationProgress: (step, total, name) => mainWindow?.webContents.send('migration-progress', { step, total, name }),
      });
      if (result && result.success) {
        fileLog('[AutoStart] ✅ Services started on launch');
        await syncActivePlan();
        if (!backupManager) setTimeout(() => initBackupOnStartup(), 5000);
      } else {
        fileLog('[AutoStart] ❌ Failed:', result && result.error);
      }
    } catch (e) { fileLog('[AutoStart] error:', e.message); }
  }, 2000);

  // Quick connectivity test (2s after start)
  setTimeout(async () => {
    fileLog('[Diag] Running connectivity diagnostic...');
    try {
      const testResult = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'wzkklenfsaepegymfxfz.supabase.co',
          port: 443,
          path: '/functions/v1/license-heartbeat',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000,
        }, (res) => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => resolve({ status: res.statusCode, body: body.substring(0, 500) }));
        });
        req.on('error', e => reject(e));
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        // A reachability probe ONLY. It must carry NO real licence key: license-heartbeat BINDS an unbound licence to whatever hardware_id it receives
        // (UPDATE licensing.licenses SET hardware_id = p_hardware_id), so the old probe (the real key + 'DIAG_TEST', 2 s after launch, before the real
        // first heartbeat at 5 s) could bind a licence to a dummy device and make the real machine fail with HARDWARE_MISMATCH. NOT_FOUND is the expected answer.
        req.write(JSON.stringify({ license_key: 'DIAG-PROBE-NOT-A-LICENSE', hardware_id: 'DIAG-PROBE' }));
        req.end();
      });
      fileLog('[Diag] ✅ Supabase reachable (probe without a licence key; a 4xx answer is expected). Status:', testResult.status);
    } catch (err) {
      fileLog('[Diag] ❌ Cannot reach Supabase:', err.message);
    }
  }, 2000);

  // Set dock icon (macOS)
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
  }
});

// IPC: Read heartbeat log file
ipcMain.handle('get-heartbeat-log', async () => {
  try {
    if (fs.existsSync(LOG_FILE)) {
      const content = fs.readFileSync(LOG_FILE, 'utf8');
      // Return last 5000 chars
      return content.length > 5000 ? content.substring(content.length - 5000) : content;
    }
    return 'No log file found at: ' + LOG_FILE;
  } catch (e) {
    return 'Error reading log: ' + e.message;
  }
});

app.on('window-all-closed', () => {
  // Don't quit — keep running in tray
  if (process.platform !== 'darwin') {
    // On Windows/Linux, keep in tray
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Electron does NOT await an async before-quit handler — it quits immediately,
// cutting off the final backup (data loss every quit). So we preventDefault,
// finish the backup + clean shutdown, then app.exit() to actually quit.
let _finalizingQuit = false;
app.on('before-quit', (event) => {
  if (_finalizingQuit) return; // second pass — allow the real quit
  event.preventDefault();
  _finalizingQuit = true;
  app.isQuitting = true;
  (async () => {
    try {
      heartbeatSender.stop();
      if (backupManager) {
        backupManager.stopSync();
        backupManager.stopCloudSync();
        try {
          fileLog('[TexaCore] Running final backup before quit...');
          await backupManager.backup();
          const primaryPath = backupManager.backupPath;
          if (primaryPath && !backupManager._lastAccessBlock && fs.existsSync(primaryPath)) {
            const appBackupDir = path.join(DATA_DIR, 'backups');
            if (!fs.existsSync(appBackupDir)) fs.mkdirSync(appBackupDir, { recursive: true });
            fs.copyFileSync(primaryPath, path.join(appBackupDir, path.basename(primaryPath)));
            try { backupManager._rotateDailySnapshot(5, 0); } catch (e) { /* ignore */ }
            fileLog('[TexaCore] ✅ Secondary backup + daily snapshot saved to:', appBackupDir);
          }
        } catch (e) {
          console.warn('[TexaCore] Final backup failed:', e.message);
        }
      }
      if (svcManager) await svcManager.stopAll();
    } catch (e) {
      fileLog('[TexaCore] Quit finalize error:', e.message);
    } finally {
      // If a verified mac update is staged, launch the detached installer
      // script now — it waits for our PID to exit, swaps the bundle,
      // re-signs it ad-hoc, and relaunches the app.
      try { await activeUpdater()?.stop(); } catch { /* noop */ }           // flush the partial download (it is resumed next start)
      try { macUpdater?.spawnInstallerIfStaged(); } catch { /* noop */ }
      app.exit(0);
    }
  })();
});
