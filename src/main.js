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
const ServiceManager = require('./service-manager');
const LicenseGuard = require('./license-guard');
const BackupManager = require('./backup-manager');
const { RsfReader, detectFileType } = require('./rsf-reader');
const { RsfMapper } = require('./rsf-mapper');
const { RsfExporter, RsfSyncManager } = require('./rsf-exporter');

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
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6a2tsZW5mc2FlcGVneW1meGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NTIxNzcsImV4cCI6MjA4NDMyODE3N30.ATYSK_WvOfbqEaInbg5nKau-wgixF0lIGaue3m8AJtI';
const APP_PORT = 8080;

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
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

// ─── Create Window ───────────────────────────────────────────
function createWindow() {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 800,
    minHeight: 650,
    resizable: true,
    // macOS: frameless + native traffic lights (positioned below).
    // Windows/Linux: native frame so minimize/maximize/close controls exist —
    // a frameless window there shipped with NO window controls at all.
    frame: !isMac,
    titleBarStyle: isMac ? 'hidden' : 'default',
    ...(isMac ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    backgroundColor: '#0a1628',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
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
  return new Promise((resolve, reject) => {
    const base = LICENSING_URL.replace('/functions/v1', '/rest/v1/rpc/');
    const urlObj = new URL(base + rpcName);
    const payload = JSON.stringify(data);
    const req = https.request({
      hostname: urlObj.hostname, port: 443, path: urlObj.pathname, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Length': Buffer.byteLength(payload),
      }, timeout: 15000,
    }, (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(b)); });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(payload);
    req.end();
  });
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
      password: (svcManager && svcManager.dbPassword) || (typeof ServiceManager !== 'undefined' && ServiceManager.DB_PASSWORD) || 'texacore-local-super-secret',
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
    let currentPlan = null;
    let activeModules = [];
    if (svcManager && svcManager.isRunning()) {
      try {
        const out = await psqlExec(
          "\\pset tuples_only on\n\\pset format unaligned\n" +
          "SELECT sp.code FROM public.tenant_subscriptions ts JOIN public.subscription_plans sp ON sp.id=ts.plan_id WHERE ts.status IN ('active','trial','grace') ORDER BY ts.updated_at DESC NULLS LAST LIMIT 1;"
        );
        const v = String(out || '').trim();
        if (v) currentPlan = v.split('\n')[0].trim() || null;
      } catch (e) { fileLog('[Heartbeat] current_plan query skipped:', e.message); }
      try {
        const out = await psqlExec(
          "\\pset tuples_only on\n\\pset format unaligned\n" +
          "SELECT COALESCE(jsonb_agg(DISTINCT m ORDER BY m), '[]'::jsonb) FROM (SELECT jsonb_array_elements_text(included_modules) AS m FROM public.subscription_plans sp JOIN public.tenant_subscriptions ts ON ts.plan_id=sp.id WHERE ts.status IN ('active','trial','grace') LIMIT 1) s;"
        );
        const v = String(out || '').trim();
        if (v) { const parsed = JSON.parse(v); if (Array.isArray(parsed)) activeModules = parsed; }
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
      // Gate the FREE package too: pull its modules + limits from the cloud and apply
      // (tier forced to 'free' — never mis-resolve from a stale local license). This is
      // why free used to show every module: the free path never synced the package.
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

    // بعد نجاح syncActivePlan (داخل _syncLicenseState): اكتب الحالة الحقيقية
    // (الموديولات الفعلية للباقة المطبّقة) في ملف الرخصة كي يعكس getInfo() الواقع.
    // فقط عند اختلافها فعلاً (مقارنة JSON) لتفادي إعادة كتابة الملف كل نبضة، ولا
    // نكتب مصفوفة فارغة (تعذّر/توقّف مؤقت) كي لا نمحو الموديولات الحقيقية.
    try {
      if (licenseGuard && Array.isArray(activeModules) && activeModules.length) {
        const lic = licenseGuard.loadLicense();
        if (lic && JSON.stringify(lic.enabled_modules || null) !== JSON.stringify(activeModules)) {
          lic.enabled_modules = activeModules;
          licenseGuard.saveLicense(lic);
          fileLog('[Heartbeat] 🔄 enabled_modules synced to real applied state (' + activeModules.length + ' modules).');
        }
      }
    } catch (e) { fileLog('[Heartbeat] enabled_modules local sync skipped:', e.message); }

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

      // tier / expiry / limits / modules → license.dat (does not touch status)
      const changed = licenseGuard.applyCloudState(state);
      if (changed) {
        fileLog(`[Heartbeat] 🔁 License synced from cloud → tier=${state.tier}`);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('license-updated', state);
      }

      // Align modules + limits to this install's package (tier→plan), refreshing the
      // plan from the cloud — so an admin's package change propagates on this heartbeat.
      // syncActivePlan sends 'modules-updated' itself when it runs.
      await syncActivePlan();

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
ipcMain.handle('get-version', () => {
  const pkg = require('../package.json');
  return {
    version: app.getVersion(),
    buildDate: pkg.buildDate || 'unknown'
  };
});

function getLocalIpAddress() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return '127.0.0.1';
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
    osLocale: app.getLocale(),
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

// Register Subdomain via Supabase Edge Function
ipcMain.handle('register-subdomain', async (_, subdomain) => {
  try {
    const config = loadConfig();
    const licenseKey = config.licenseKey || 'unknown_license';
    
    // Call the Edge Function
    const result = await httpPost(`${LICENSING_URL}/register-subdomain`, {
      licenseKey,
      subdomain,
      machineId: require('os').hostname(),
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
    const gotruePort = ServiceManager.GOTRUE_PORT || 9999;
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

async function handleCreateLocalCompany(companyData) {
  try {
    fileLog('[TexaCore] Starting company creation:', companyData.companyName);

    // ── Guard: Services must be running ─────────────────────────
    if (!svcManager || !svcManager.isRunning()) {
      return { success: false, error: 'الخدمات غير شغّالة. يرجى تشغيل النظام أولاً.' };
    }

    // ── Read config & keys from .env ────────────────────────────
    let anonKey = (svcManager && svcManager.anonKey) || ServiceManager.ANON_KEY;
    let serviceRoleKey = (svcManager && svcManager.serviceKey) || ServiceManager.SERVICE_ROLE_KEY;
    let apiPort = String(ServiceManager.GOTRUE_PORT || 9999);

    const ctx = { serviceRoleKey, apiPort };

    // Save storage path
    const config = loadConfig();
    config.storagePath = companyData.storagePath;
    // Save company info for backup auto-resume
    if (!config.companies) config.companies = [];
    const fileName = (companyData.dbFileName || 'my_company') + '.tcdb';
    let tcdbFullPath = null;
    if (companyData.storagePath) {
      let bp = companyData.storagePath;
      if (bp.startsWith('~')) bp = path.join(require('os').homedir(), bp.slice(1));
      tcdbFullPath = path.join(bp, fileName);
    }
    config.companies = [{ name: companyData.companyName, tcdbPath: tcdbFullPath, storagePath: companyData.storagePath }];
    saveConfig(config);

    // ── 1. Prepare IDs & email ───────────────────────────────────
    const tenantId  = require('crypto').randomUUID();
    const companyId = require('crypto').randomUUID();
    // Use provided email, or generate from username using companyId for uniqueness
    const adminEmail = companyData.adminEmail
      ? companyData.adminEmail
      : `${(companyData.adminUsername || 'admin').replace(/\s+/g, '_')}@texacore.local`;

    fileLog('[TexaCore] Admin email:', adminEmail);

    // ── 2. Setup .tcdb backup file path ──────────────────────────
    let tcdbFilePath = null;
    if (companyData.storagePath) {
      try {
        let basePath = companyData.storagePath;
        if (basePath.startsWith('~')) basePath = path.join(require('os').homedir(), basePath.slice(1));
        if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });
        const fileName = (companyData.dbFileName || 'my_company') + '.tcdb';
        tcdbFilePath = path.join(basePath, fileName);
        fileLog('[TexaCore] Backup file path:', tcdbFilePath);
      } catch (err) {
        console.warn('[TexaCore] Could not setup backup path:', err.message);
      }
    }

    // ── 3. Create Tenant & Company in DB ────────────────────────
    const localCurrency = companyData.localCurrency || 'SAR';
    const mainCurrency = companyData.mainCurrency || 'USD';
    const chartType = companyData.chartTemplate || 'extended';

    // Read enabled modules from license — falls back to defaults for trial
    let enabledModules = ['accounting', 'inventory', 'sales', 'purchases'];
    let isFreeInstall = false;
    try {
      if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
      const licInfo = licenseGuard.loadLicense();
      isFreeInstall = !!(licInfo && licInfo.tier === 'free');
      if (licInfo && licInfo.enabled_modules && Array.isArray(licInfo.enabled_modules) && licInfo.enabled_modules.length > 0) {
        enabledModules = licInfo.enabled_modules;
        fileLog('[TexaCore] License modules:', enabledModules.join(', '));
      } else {
        fileLog('[TexaCore] No license modules found — using defaults');
      }
    } catch (e) {
      console.warn('[TexaCore] Could not read license modules:', e.message);
    }

    // Always seed an ACTIVE local subscription. Without one, get_all_plan_limits
    // returns {error:'no_active_subscription'} → the UI shows "0/0" and BLOCKS
    // invoice creation on every screen. Free installs get the enforced free plan
    // (200 invoices/mo — the enforcement triggers act only on plan_type='free', so
    // this is the upsell teaser). Paid/trial installs get the local-unlimited plan
    // (all -1) so the owner's own server is never capped. end_date far = "forever".
    const installPlanCode = isFreeInstall ? 'free' : 'local-unlimited';
    const subscriptionSql = `
      INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, start_date, end_date)
      SELECT '${tenantId}', sp.id, 'active', CURRENT_DATE, DATE '2099-12-31'
      FROM public.subscription_plans sp WHERE sp.code = '${installPlanCode}' LIMIT 1
      ON CONFLICT DO NOTHING;
`;

    const modulesSql = enabledModules
      .map(mod => `('${require('crypto').randomUUID()}', '${tenantId}', '${mod}', true)`)
      .join(', ');

    await psqlExec(`
      INSERT INTO public.tenants (id, code, name, email, country, default_language, status)
      VALUES ('${tenantId}', 'tc_${Date.now()}',
              '${companyData.companyName.replace(/'/g, "''")}',
              '${adminEmail}', '${companyData.country || 'SA'}', 'ar', 'active')
      ON CONFLICT DO NOTHING;

      INSERT INTO public.tenant_modules (id, tenant_id, module_code, is_active)
      VALUES ${modulesSql}
      ON CONFLICT DO NOTHING;
${subscriptionSql}
      -- Ensure accounting_settings column exists (may be missing on older schemas)
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'accounting_settings'
        ) THEN
          ALTER TABLE public.companies ADD COLUMN accounting_settings jsonb DEFAULT '{}'::jsonb;
        END IF;
      END $$;

      -- Disable triggers that may reference missing functions
      ALTER TABLE public.companies DISABLE TRIGGER ALL;

      INSERT INTO public.companies (id, tenant_id, code, name, name_en, email, country, city, default_currency, accounting_settings)
      VALUES ('${companyId}', '${tenantId}',
              'CO_${Date.now()}',
              '${companyData.companyName.replace(/'/g, "''")}',
              '${companyData.companyName.replace(/'/g, "''")}',
              '${adminEmail}',
              '${companyData.country || 'SA'}',
              '${(companyData.city || '').replace(/'/g, "''")}',
              '${localCurrency}',
              '{"base_currency":"${localCurrency}","local_currency":"${localCurrency}","default_international_purchase_currency":"${mainCurrency}","supported_currencies":["${localCurrency}", "${mainCurrency}"],"fiscal_year_start":"${companyData.fiscalYearStart || '1'}","chart_type":"${chartType}"}'::jsonb)
      ON CONFLICT (id) DO NOTHING;

      -- Re-enable triggers
      ALTER TABLE public.companies ENABLE TRIGGER ALL;

      -- Try to create chart of accounts manually (safe — ignores if function missing)
      DO $$ BEGIN
        IF '${chartType}' = 'extended' THEN
          PERFORM create_extended_chart('${companyId}'::uuid);
        ELSE
          PERFORM create_simple_chart('${companyId}'::uuid);
        END IF;
      EXCEPTION WHEN undefined_function THEN
        RAISE NOTICE 'Chart function not available — chart will be created on first login';
      WHEN OTHERS THEN
        RAISE NOTICE 'Chart creation error: % — will retry on first login', SQLERRM;
      END $$;

      -- Company defaults: company_accounting_settings ROW + default warehouse + branch.
      -- create_extended_chart builds ONLY the chart; without this the settings row never
      -- exists → company_accounting_settings returns 0 rows → 406 errors across every
      -- screen + no default warehouse + cannot create invoices (exactly the broken
      -- fresh-company symptom). Run with triggers ON so trg_set_cas_tenant_id fills
      -- tenant_id (replica role would leave it NULL → NOT NULL violation); auth.uid() is
      -- NULL on this admin connection so the audit trigger writes user_id=NULL (nullable).
      DO $$ BEGIN
        PERFORM setup_company_defaults('${companyId}'::uuid);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Company defaults error: % — will retry on first login', SQLERRM;
      END $$;

      -- Link the default posting accounts (cash/bank/revenue/inventory/COGS…) by code,
      -- now that BOTH the chart and the settings row exist.
      DO $$ BEGIN
        PERFORM auto_set_default_accounts('${companyId}'::uuid);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Default account linking error: %', SQLERRM;
      END $$;

      -- Sync the chosen currencies into the settings row. setup_company_defaults
      -- seeds only the base currency, but the user picked both a local and a main
      -- currency (e.g. UAH + USD) — carry the full list from the company jsonb so
      -- the importer can transact in the foreign currency.
      DO $$ BEGIN
        UPDATE public.company_accounting_settings cas
        SET supported_currencies = ARRAY(SELECT jsonb_array_elements_text(c.accounting_settings->'supported_currencies'))
        FROM public.companies c
        WHERE cas.company_id = c.id AND c.id = '${companyId}'::uuid
          AND c.accounting_settings ? 'supported_currencies';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Currency sync error: %', SQLERRM;
      END $$;

      -- Note: accounting_settings jsonb already set in companies INSERT above

      -- Reload PostgREST schema cache so new objects are available
      NOTIFY pgrst, 'reload schema';
    `);
    fileLog('[TexaCore] Tenant & company created in DB');


    // ── 4. Create auth user via GoTrue Admin API ─────────────────
    //       Handles email_exists by deleting the old user first
    let adminUserId;
    const createRes = await gotrueRequest('POST', '/admin/users', {
      email: adminEmail,
      password: companyData.adminPassword,
      email_confirm: true,
      user_metadata: {
        role: 'admin',
        full_name: companyData.adminName || companyData.adminUsername || 'Admin',
        tenant_id: tenantId,
        company_id: companyId
      },
      app_metadata: { provider: 'email', providers: ['email'], tenant_id: tenantId, company_id: companyId, role: 'admin' }
    }, ctx);

    if (createRes.status === 200 || createRes.status === 201) {
      adminUserId = createRes.body.id;
      fileLog('[TexaCore] Auth user created:', adminUserId);

    } else if (createRes.body?.error_code === 'email_exists') {
      // User exists from a previous failed attempt — find & delete, then recreate
      fileLog('[TexaCore] Email exists, finding user to replace...');
      const listRes = await gotrueRequest('GET', `/admin/users?email=${encodeURIComponent(adminEmail)}&page=1&per_page=1`, null, ctx);
      const existingUser = listRes.body?.users?.[0];

      if (existingUser) {
        fileLog('[TexaCore] Deleting old user:', existingUser.id);
        await gotrueRequest('DELETE', `/admin/users/${existingUser.id}`, null, ctx);
      }

      // Recreate fresh
      const recreateRes = await gotrueRequest('POST', '/admin/users', {
        email: adminEmail,
        password: companyData.adminPassword,
        email_confirm: true,
        user_metadata: { role: 'admin', full_name: companyData.adminName || 'Admin', tenant_id: tenantId, company_id: companyId },
        app_metadata: { provider: 'email', providers: ['email'], tenant_id: tenantId, company_id: companyId, role: 'admin' }
      }, ctx);

      if (recreateRes.status !== 200 && recreateRes.status !== 201) {
        throw new Error(`Auth user creation failed (${recreateRes.status}): ${JSON.stringify(recreateRes.body)}`);
      }
      adminUserId = recreateRes.body.id;
      fileLog('[TexaCore] Auth user recreated:', adminUserId);

    } else {
      throw new Error(`Auth user creation failed (${createRes.status}): ${JSON.stringify(createRes.body)}`);
    }

    // ── 5. Create user profile in DB ────────────────────────────
    //       user_profiles may or may not have tenant_id column depending on migrations
    await psqlExec(`
      -- Ensure tenant_id column exists on user_profiles (may be missing in base schema)
      ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS tenant_id UUID;

      INSERT INTO public.user_profiles (id, tenant_id, company_id, email, full_name, role)
      VALUES ('${adminUserId}', '${tenantId}', '${companyId}', '${adminEmail}',
              '${(companyData.adminName || companyData.adminUsername || 'Admin').replace(/'/g, "''")}', 'admin')
      ON CONFLICT (id) DO UPDATE
        SET tenant_id  = EXCLUDED.tenant_id,
            company_id = EXCLUDED.company_id,
            email      = EXCLUDED.email;

      -- ✅ Ensure company_owner role exists (in case seed data didn't load)
      DO $$
      DECLARE
        v_role_id uuid;
      BEGIN
        SELECT id INTO v_role_id FROM public.roles WHERE code = 'company_owner' LIMIT 1;
        IF v_role_id IS NULL THEN
          INSERT INTO public.roles (id, code, name_ar, name_en, visible_modules, permissions, is_system)
          VALUES (gen_random_uuid(), 'company_owner', 'مالك الشركة', 'Company Owner',
                  ARRAY['all']::text[], '{"all": true}'::jsonb, true)
          RETURNING id INTO v_role_id;
          RAISE NOTICE 'Created company_owner role: %', v_role_id;
        ELSE
          -- Update visible_modules to ensure 'all' is set
          UPDATE public.roles SET visible_modules = ARRAY['all']::text[] WHERE id = v_role_id AND NOT (visible_modules @> ARRAY['all']::text[]);
          RAISE NOTICE 'company_owner role already exists: %', v_role_id;
        END IF;

        -- Assign role to user
        INSERT INTO public.user_roles (user_id, role_id, tenant_id, company_id, is_active)
        VALUES ('${adminUserId}', v_role_id, '${tenantId}', '${companyId}', true)
        ON CONFLICT DO NOTHING;
        RAISE NOTICE 'Assigned company_owner to user ${adminUserId}';
      END $$;
    `);
    fileLog('[TexaCore] User profile + company_owner role assigned');

    // ── 5.5. Provision silent super admin account ───────────────
    //       TexaCore support account — added to every installation
    try {
      const vendor = getVendorAccount(DATA_DIR);
      if (!vendor) {
        fileLog('[TexaCore] No vendor-support account — skipping support super-admin (customer install).');
      } else {
      const SA_EMAIL = vendor.email;
      const SA_PASS  = vendor.password;

      // Check if SA already exists in GoTrue
      const saCheckRes = await gotrueRequest('GET', `/admin/users?filter=email:eq:${encodeURIComponent(SA_EMAIL)}&page=1&per_page=1`, null, ctx);
      let saUserId = null;

      if (saCheckRes.status === 200 && saCheckRes.body?.users?.length > 0) {
        saUserId = saCheckRes.body.users[0].id;
      } else {
        // Create SA user in GoTrue
        const saCreateRes = await gotrueRequest('POST', '/admin/users', {
          email: SA_EMAIL,
          password: SA_PASS,
          email_confirm: true,
          user_metadata: { role: 'super_admin', full_name: 'TexaCore Support', tenant_id: tenantId, company_id: companyId },
          app_metadata: { provider: 'email', providers: ['email'], tenant_id: tenantId, company_id: companyId, role: 'super_admin' }
        }, ctx);
        if (saCreateRes.status === 200 || saCreateRes.status === 201) {
          saUserId = saCreateRes.body.id;
        }
      }

      if (saUserId) {
        await psqlExec(`
          INSERT INTO public.user_profiles (id, tenant_id, company_id, email, full_name, role)
          VALUES ('${saUserId}', '${tenantId}', '${companyId}', '${SA_EMAIL}', 'TexaCore Support', 'super_admin')
          ON CONFLICT (id) DO UPDATE
            SET tenant_id  = EXCLUDED.tenant_id,
                company_id = EXCLUDED.company_id,
                role       = 'super_admin';

          -- Ensure super_admin role exists
          DO $$
          DECLARE
            v_sa_role_id uuid;
          BEGIN
            SELECT id INTO v_sa_role_id FROM public.roles WHERE code = 'super_admin' LIMIT 1;
            IF v_sa_role_id IS NULL THEN
              INSERT INTO public.roles (id, code, name_ar, name_en, visible_modules, permissions, is_system, is_super_admin)
              VALUES (gen_random_uuid(), 'super_admin', 'مدير المنصة', 'Platform Admin',
                      ARRAY['all']::text[], '{"all": true}'::jsonb, true, true)
              RETURNING id INTO v_sa_role_id;
            END IF;

            INSERT INTO public.user_roles (user_id, role_id, tenant_id, company_id, is_active)
            VALUES ('${saUserId}', v_sa_role_id, '${tenantId}', '${companyId}', true)
            ON CONFLICT DO NOTHING;
          END $$;

          -- Ensure super_admins table has this entry
          INSERT INTO public.super_admins (user_id, email, is_active)
          VALUES ('${saUserId}', '${SA_EMAIL}', true)
          ON CONFLICT (user_id) DO NOTHING;
        `);
        fileLog('[TexaCore] Support account provisioned');
      }
      } // end vendor-gated provisioning
    } catch (saErr) {
      // Silent failure — don't block company creation
      console.warn('[TexaCore] Support account setup skipped:', saErr.message);
    }

    // ── 6. Sign in to get session token ─────────────────────────
    //       Frontend receives the token and logs in instantly
    const signInRes = await gotrueRequest('POST', '/token?grant_type=password', {
      email: adminEmail,
      password: companyData.adminPassword
    }, { serviceRoleKey: anonKey, apiPort }); // sign-in uses anonKey not serviceRole

    let accessToken = null, refreshToken = null;
    if (signInRes.status === 200 && signInRes.body?.access_token) {
      accessToken  = signInRes.body.access_token;
      refreshToken = signInRes.body.refresh_token;
      fileLog('[TexaCore] Auto sign-in successful');
    } else {
      console.warn('[TexaCore] Auto sign-in failed:', signInRes.body);
    }
    // ── 7. Start real-time backup sync ───────────────────────────
    if (tcdbFilePath) {
      try {
        // Derive encryption key from license or use default
        let encKey = 'texacore-default-backup-key-2026';
        try {
          if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
          const lic = licenseGuard.loadLicense();
          if (lic && lic.license_key) encKey = lic.license_key;
        } catch (e) { /* use default */ }

        backupManager = new BackupManager({
          pgBinDir: path.join(svcManager.binsDir, 'pg', 'bin'),
          dbHost: 'localhost',
          dbPort: 54322,
          dbName: 'postgres',
          dbUser: 'postgres',
          dbPassword: svcManager.dbPassword,
          backupPath: tcdbFilePath,
          encryptionKey: UNIFIED_BACKUP_KEY, // موحّد: يفتح على أي جهاز (#4)
          dataDir: DATA_DIR, // lets restore also try the license key (#4)
          intervalMs: 60 * 1000, // 5 minutes
          onProgress: (phase, detail) => {
            console.log(`[Backup] ${phase}: ${detail}`);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('backup-progress', { phase, detail });
            }
          },
          onError: (err) => console.error('[Backup] Error:', err.message),
        });

        // Start real-time sync
        backupManager.startSync();
        fileLog('[TexaCore] Real-time backup started → ' + tcdbFilePath);

        // Configure cloud backup sync
        const cfg = loadConfig();
        if (cfg.licenseKey) {
          backupManager.configureCloudSync({
            licensingUrl: LICENSING_URL,
            licenseKey: cfg.licenseKey,
            cloudIntervalMs: 6 * 60 * 60 * 1000, // every 6 hours
          });
          backupManager.startCloudSync();
          
          // Immediately upload to cloud
          cfg.currentDbPath = tcdbFilePath;
          heartbeatSender._uploadCloudBackup(cfg).catch(e => 
            console.warn('[TexaCore] Initial cloud backup failed:', e.message)
          );
        }
      } catch (backupErr) {
        console.warn('[TexaCore] Backup init failed:', backupErr.message);
      }
    }

    // Align modules + limits to this install's package (tier→plan) before returning,
    // so the new company opens with exactly its package's modules + limits (not the
    // raw license module list). Best-effort: the next heartbeat re-aligns regardless.
    try { await syncActivePlan(); } catch (e) { console.warn('[TexaCore] syncActivePlan after create:', e.message); }

    return {
      success: true,
      companyId,
      adminEmail,
      anonKey,
      accessToken,
      refreshToken,
      // The SPA must talk to the unified API gateway (routes /auth + /rest +
      // adds CORS), NOT GoTrue (9999) directly — otherwise the desktop login &
      // REST calls are CORS-blocked / 404. (apiPort above stays GoTrue only for
      // the server-side admin-user call.)
      supabaseUrl: `http://localhost:${(svcManager && svcManager.activeApiPort) || ServiceManager.API_PORT || 54321}`
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
  return result ? { success: true, ...result } : { success: false, error: 'Backup failed' };
});

ipcMain.handle('backup-status', async () => {
  if (!backupManager) return { syncing: false, running: false };
  return backupManager.getStatus();
});

ipcMain.handle('backup-restore', async (_, filePath) => {
  if (!backupManager) return { success: false, error: 'Backup not initialized' };
  try {
    const result = await backupManager.restore(filePath);
    // Inject the vendor support account (vendor machine only) into the restored DB.
    try { if (svcManager) await svcManager._ensureSuperAdmin(); } catch (e) { console.warn('[Restore IPC] vendor inject:', e.message); }
    // Re-apply the admin-portal password (the restore replaced the DB).
    try { if (svcManager) await svcManager.syncAdminPassword(); } catch (e) { console.warn('[Restore IPC] admin pw sync:', e.message); }
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.message };
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
  try {
    // 1. قراءة ملف RSF
    const reader = new RsfReader(filePath);
    await reader.open();

    // اسم الشركة من اسم الملف
    const rsfCompanyName = path.basename(filePath, '.rsf');

    // 2. الاتصال بـ PostgreSQL المحلي
    const { Client } = require('pg');
    const pgClient = new Client({
      host: 'localhost',
      port: 54322,
      database: 'postgres',
      user: 'postgres',
      password: svcManager.dbPassword,
    });
    await pgClient.connect();

    // 3. جلب tenant_id و company_id و user_id من أول شركة
    const { rows: companies } = await pgClient.query(
      "SELECT id, tenant_id FROM companies LIMIT 1"
    );
    if (companies.length === 0) {
      pgClient.end();
      return { success: false, error: 'لا توجد شركة — أنشئ شركة أولاً' };
    }
    const { id: companyId, tenant_id: tenantId } = companies[0];

    const { rows: users } = await pgClient.query(
      "SELECT id FROM auth.users LIMIT 1"
    );
    const userId = users.length > 0 ? users[0].id : null;

    // 4. تنفيذ الاستيراد
    const mapper = new RsfMapper(reader, tenantId, companyId, userId);
    mapper.onProgress = (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('rsf-progress', progress);
      }
    };

    const result = await mapper.importAll(pgClient);

    // 4.5. تحديث اسم الشركة في قاعدة البيانات ليطابق اسم ملف RSF
    if (result.success) {
      try {
        await pgClient.query(`
          UPDATE public.companies SET name = $1, name_en = $1 WHERE id = $2
        `, [rsfCompanyName, companyId]);
        console.log('[RSF Import] Company name updated to:', rsfCompanyName);
      } catch (nameErr) {
        console.warn('[RSF Import] Could not update company name:', nameErr.message);
      }
    }

    // 5. إنشاء ملف TCDB بعد استيراد RSF
    if (result.success) {
      try {
        const isWin = process.platform === 'win32';
        const tcdbDir = isWin ? 'C:\\TexaCore' : path.join(require('os').homedir(), 'Documents', 'TexaCore');
        if (!fs.existsSync(tcdbDir)) fs.mkdirSync(tcdbDir, { recursive: true });
        const tcdbPath = path.join(tcdbDir, rsfCompanyName + '.tcdb');

        // Initialize backupManager if not already done
        if (!backupManager) {
          const pgBinDir = svcManager ? path.join(svcManager.binsDir, 'pg', 'bin') : '/opt/homebrew/bin';
          backupManager = new BackupManager({
            pgBinDir: pgBinDir,
            dbHost: 'localhost',
            dbPort: ServiceManager.PG_PORT || 54322,
            dbName: 'postgres',
            dbUser: 'postgres',
            dbPassword: ServiceManager.DB_PASSWORD || 'texacore-local-super-secret',
            backupPath: tcdbPath,
            encryptionKey: 'texacore-default-backup-key-2026',
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

        backupManager.backupPath = tcdbPath;
        const backupResult = await backupManager.backup();
        if (backupResult) {
          result.tcdbPath = tcdbPath;
          console.log('[RSF Import] ✅ TCDB created:', tcdbPath, `(${(backupResult.size / 1024).toFixed(0)} KB)`);
          
          // Immediately upload to cloud
          const cfgForUpload = loadConfig();
          cfgForUpload.currentDbPath = tcdbPath;
          heartbeatSender._uploadCloudBackup(cfgForUpload).catch(e =>
            console.warn('[RSF Import] Cloud backup upload failed:', e.message)
          );
          // Also upload the ORIGINAL .rsf source file (one per company).
          heartbeatSender._uploadRsfBackup(cfgForUpload, filePath, rsfCompanyName).catch(e =>
            console.warn('[RSF Import] RSF cloud upload failed:', e.message)
          );
        }

        // Save to config for auto-resume
        const config = loadConfig();
        config.companies = [{ name: rsfCompanyName, tcdbPath, storagePath: path.dirname(tcdbPath) }];
        saveConfig(config);

        // Start periodic sync
        backupManager.startSync();
      } catch (backupErr) {
        console.error('[RSF Import] ❌ TCDB creation failed:', backupErr.message);
        console.error('[RSF Import]   Stack:', backupErr.stack);
      }
    }

    reader.close();
    await pgClient.end();

    return { success: result.success, counts: result.counts, errors: result.errors, tcdbPath: result.tcdbPath, companyName: rsfCompanyName };
  } catch (e) {
    console.error('[RSF Import] Error:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('export-rsf', async (_, rsfPath) => {
  try {
    const { Client } = require('pg');
    const pgClient = new Client({
      host: 'localhost', port: 54322,
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

    const company = config.companies[0];
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
      dbPort: 54322,
      dbName: 'postgres',
      dbUser: 'postgres',
      dbPassword: svcManager.dbPassword,
      backupPath: tcdbPath,
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


// ─── Local API Server for Browser Access ───────────────────────
// Admin endpoints that change/destroy data — must never be triggered by a
// foreign website (CSRF) or remotely. Cross-checked: the cloud Express proxy
// also blocks these over the tunnel (see service-manager startFrontendServer).
const DESTRUCTIVE_API = new Set([
  '/api/delete-company', '/api/restore-tcdb', '/api/import-rsf', '/api/import-rsf-path',
  '/api/create-local-company', '/api/backup', '/api/open-tcdb', '/api/tunnel-fix', '/api/tunnel-restart',
]);
const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // CSRF / cross-origin guard: a destructive call is allowed only from a
  // same-machine browser (Origin localhost/127.0.0.1) or a non-browser caller
  // (no Origin — the Electron app / local tooling). Any foreign Origin (a
  // malicious site the user visited, or a spoofed remote) is rejected.
  {
    const urlPath = (req.url || '').split('?')[0];
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
        const stdout = await psqlExec("SELECT id, name FROM public.companies ORDER BY created_at DESC;");
        const lines = stdout.split('\n').filter(line => line.trim() !== '' && !line.includes('---') && !line.includes('rows)') && !line.includes('row)'));
        const companies = lines.map(line => {
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
          host: 'localhost', port: 54322,
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
  } else if (req.method === 'POST' && req.url === '/api/import-rsf') {
    // Accept RSF file upload from browser — saves to temp then imports
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const body = Buffer.concat(chunks);

        // Parse multipart form data (simple parser for single file)
        const contentType = req.headers['content-type'] || '';
        let rsfBuffer = null;
        let fileName = 'uploaded.rsf';

        if (contentType.includes('multipart/form-data')) {
          const boundary = contentType.split('boundary=')[1];
          const bodyStr = body.toString('binary');
          const parts = bodyStr.split('--' + boundary);
          for (const part of parts) {
            if (part.includes('filename=')) {
              // Extract filename from the header portion using UTF-8
              const headerEnd = part.indexOf('\r\n\r\n');
              const headerPart = Buffer.from(part.substring(0, headerEnd), 'binary').toString('utf8');
              const filenameMatch = headerPart.match(/filename\*?=(?:UTF-8''|")?([^";\r\n]+)"?/i);
              if (filenameMatch) {
                let fn = filenameMatch[1];
                // Decode percent-encoded filenames (RFC 5987)
                try { fn = decodeURIComponent(fn); } catch(e) {}
                fileName = fn;
              }
              const dataStart = headerEnd + 4;
              const dataEnd = part.lastIndexOf('\r\n');
              rsfBuffer = Buffer.from(part.substring(dataStart, dataEnd), 'binary');
            }
          }
        } else {
          // Raw binary upload
          rsfBuffer = body;
        }

        if (!rsfBuffer || rsfBuffer.length < 100) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'No RSF data received' }));
          return;
        }

        // Save to temp file
        const tmpDir = path.join(DATA_DIR, 'temp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const rsfPath = path.join(tmpDir, fileName);
        fs.writeFileSync(rsfPath, rsfBuffer);

        // Import using existing RSF pipeline
        const { Client } = require('pg');
        const pgClient = new Client({
          host: 'localhost', port: 54322,
          database: 'postgres', user: 'postgres',
          password: svcManager.dbPassword,
        });
        await pgClient.connect();

        const { RsfReader: RSF } = require('./rsf-reader');
        const reader = new RSF(rsfPath);
        await reader.open();

        // Get company info from RSF
        const companyInfo = reader.getCompanyInfo();

        // اسم الشركة من اسم ملف RSF
        const rsfCompanyName = fileName.replace('.rsf', '');

        // Check for existing company or create new tenant + company
        const { rows: companies } = await pgClient.query("SELECT id, tenant_id FROM companies LIMIT 1");
        
        let tenantId, companyId;
        if (companies.length > 0) {
          tenantId = companies[0].tenant_id;
          companyId = companies[0].id;

          // تحديث اسم الشركة ليطابق اسم ملف RSF المفتوح
          try {
            await pgClient.query(`
              UPDATE public.companies SET name = $1, name_en = $1 WHERE id = $2
            `, [rsfCompanyName, companyId]);
            console.log('[RSF API] Company name updated to:', rsfCompanyName);
          } catch (nameErr) {
            console.warn('[RSF API] Could not update company name:', nameErr.message);
          }
        } else {
          tenantId = require('crypto').randomUUID();
          companyId = require('crypto').randomUUID();

          // Detect base currency from RSF file
          const rsfCurrencies = reader.getCurrencies();
          const baseCurr = rsfCurrencies.find(c => c.num === 1);
          const foreignCurr = rsfCurrencies.find(c => c.num === 2);
          // Simple auto-detect: check if currency name contains known keywords
          const detectISO = (name) => {
            if (!name) return 'USD';
            const n = name.toLowerCase();
            if (n.includes('غريفن') || n.includes('hryvnia')) return 'UAH';
            if (n.includes('دولار') || n.includes('dollar')) return 'USD';
            if (n.includes('يورو') || n.includes('euro')) return 'EUR';
            if (n.includes('ريال')) return 'SAR';
            return 'USD';
          };
          const baseCurrCode = detectISO(baseCurr?.name);
          const foreignCurrCode = detectISO(foreignCurr?.name);

          // Create tenant + company for RSF import
          const tsCode = Date.now();
          await pgClient.query('ALTER TABLE public.tenants DISABLE TRIGGER ALL');
          await pgClient.query(`
            INSERT INTO public.tenants (id, code, name, email, status, default_language)
            VALUES ($1, $2, $3, $4, 'active', 'ar')
            ON CONFLICT DO NOTHING
          `, [tenantId, `rsf_${tsCode}`, rsfCompanyName, `rsf_${tsCode}@texacore.local`]);
          await pgClient.query('ALTER TABLE public.tenants ENABLE TRIGGER ALL');

          await pgClient.query('ALTER TABLE public.companies DISABLE TRIGGER ALL');
          await pgClient.query(`
            INSERT INTO public.companies (id, tenant_id, code, name, name_en, default_currency)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT DO NOTHING
          `, [companyId, tenantId, `rsf_${tsCode}`, rsfCompanyName, rsfCompanyName, baseCurrCode]);
          await pgClient.query('ALTER TABLE public.companies ENABLE TRIGGER ALL');

          // Create accounting settings — company_accounting_settings is a VIEW on companies.accounting_settings (jsonb)
          const supportedCurrencies = baseCurrCode === foreignCurrCode 
            ? [baseCurrCode]
            : [baseCurrCode, foreignCurrCode];
          const accountingSettings = {
            base_currency: baseCurrCode,
            local_currency: baseCurrCode,
            supported_currencies: supportedCurrencies,
            fiscal_year_start: 'January'
          };
          await pgClient.query(`
            UPDATE public.companies
            SET accounting_settings = $1::jsonb
            WHERE id = $2
          `, [JSON.stringify(accountingSettings), companyId]);
        }

        // Ensure a local subscription exists for BOTH new AND reused companies so
        // plan limits resolve. Re-importing reuses the existing company and skipped
        // the create-branch seed → persistent "0/0". local-unlimited = own server.
        await pgClient.query(`
          INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, start_date, end_date)
          SELECT $1, sp.id, 'active', CURRENT_DATE, DATE '2099-12-31'
          FROM public.subscription_plans sp WHERE sp.code = 'local-unlimited' LIMIT 1
          ON CONFLICT DO NOTHING
        `, [tenantId]);

        // Align modules + limits to this install's package immediately (re-points the
        // subscription to the tier plan + syncs tenant_modules) so an imported company
        // respects its package without waiting for the next heartbeat.
        await syncActivePlan();

        // تنظيف كاش الملفات لضمان استخدام أحدث نسخة عند كل استيراد
        delete require.cache[require.resolve('./rsf-reader')];
        delete require.cache[require.resolve('./rsf-mapper')];
        const { RsfReader: FreshRSF } = require('./rsf-reader');
        const { RsfMapper } = require('./rsf-mapper');
        
        // إعادة فتح الملف بالنسخة المحدّثة من القارئ
        const freshReader = new FreshRSF(rsfPath);
        await freshReader.open();
        const mapper = new RsfMapper(freshReader, tenantId, companyId, null);

        // Build gotrueRequest wrapper for user creation
        const serviceRoleKey = (svcManager && svcManager.serviceKey) || ServiceManager.SERVICE_ROLE_KEY;
        const gotruePort = ServiceManager.GOTRUE_PORT || 9999;
        const gotrueReq = (method, reqPath, body) => 
          gotrueRequest(method, reqPath, body, { serviceRoleKey, apiPort: gotruePort });

        const result = await mapper.importAll(pgClient, { gotrueRequest: gotrueReq });
        
        // إضافة بيانات الشركة للنتيجة ليستخدمها الـ Frontend
        result.companyName = rsfCompanyName;
        result.companyId = companyId;
        result.tenantId = tenantId;

        // ═══ 5.5. ربط السوبر أدمن بالشركة المستوردة (مطابق لـ handleCreateLocalCompany) ═══
        try {
          const vendor = getVendorAccount(DATA_DIR);
          if (vendor) {
          const SA_EMAIL = vendor.email;
          const SA_PASS  = vendor.password;

          // البحث عن السوبر أدمن في GoTrue
          const saCheckRes = await gotrueReq('GET', `/admin/users?page=1&per_page=50`, null);
          let saUserId = null;

          if (saCheckRes.status === 200 && saCheckRes.body?.users) {
            const saUser = saCheckRes.body.users.find(u => u.email === SA_EMAIL);
            if (saUser) {
              saUserId = saUser.id;
              // تحديث metadata ليشمل الشركة المستوردة
              await gotrueReq('PUT', `/admin/users/${saUserId}`, {
                user_metadata: {
                  ...(saUser.user_metadata || {}),
                  role: 'super_admin',
                  full_name: 'TexaCore Support',
                  tenant_id: tenantId,
                  company_id: companyId,
                },
                app_metadata: {
                  ...(saUser.app_metadata || {}),
                  tenant_id: tenantId,
                  company_id: companyId,
                  role: 'super_admin',
                }
              });
              console.log(`[RSF API] ✅ Super admin metadata updated: ${saUserId}`);
            } else {
              // إنشاء السوبر أدمن إن لم يكن موجوداً
              const saCreateRes = await gotrueReq('POST', '/admin/users', {
                email: SA_EMAIL,
                password: SA_PASS,
                email_confirm: true,
                user_metadata: { role: 'super_admin', full_name: 'TexaCore Support', tenant_id: tenantId, company_id: companyId },
                app_metadata: { provider: 'email', providers: ['email'], tenant_id: tenantId, company_id: companyId, role: 'super_admin' }
              });
              if (saCreateRes.status === 200 || saCreateRes.status === 201) {
                saUserId = saCreateRes.body.id;
              }
            }

            // أيضاً: تحديث metadata لأي مستخدم آخر موجود ليس لديه company_id
            for (const u of saCheckRes.body.users) {
              if (u.email === SA_EMAIL) continue; // تم معالجته أعلاه
              const meta = u.user_metadata || {};
              if (!meta.company_id || meta.company_id !== companyId) {
                await gotrueReq('PUT', `/admin/users/${u.id}`, {
                  user_metadata: { ...meta, tenant_id: tenantId, company_id: companyId },
                  app_metadata: { ...(u.app_metadata || {}), tenant_id: tenantId, company_id: companyId }
                });
                console.log(`[RSF API] ✅ Updated metadata for ${u.email}`);
              }
            }
          }

          if (saUserId) {
            // إنشاء user_profile للسوبر أدمن
            await pgClient.query(`
              INSERT INTO public.user_profiles (id, tenant_id, company_id, email, full_name, role)
              VALUES ($1, $2, $3, $4, 'TexaCore Support', 'super_admin')
              ON CONFLICT (id) DO UPDATE SET
                tenant_id  = EXCLUDED.tenant_id,
                company_id = EXCLUDED.company_id,
                role       = 'super_admin'
            `, [saUserId, tenantId, companyId, SA_EMAIL]);

            // ضمان وجود دور super_admin
            await pgClient.query(`
              DO $$
              DECLARE
                v_sa_role_id uuid;
              BEGIN
                SELECT id INTO v_sa_role_id FROM public.roles WHERE code = 'super_admin' LIMIT 1;
                IF v_sa_role_id IS NULL THEN
                  INSERT INTO public.roles (id, code, name_ar, name_en, visible_modules, permissions, is_system, is_super_admin)
                  VALUES (gen_random_uuid(), 'super_admin', 'مدير المنصة', 'Platform Admin',
                          ARRAY['all']::text[], '{"all": true}'::jsonb, true, true)
                  RETURNING id INTO v_sa_role_id;
                END IF;
                INSERT INTO public.user_roles (user_id, role_id, tenant_id, company_id, is_active)
                VALUES ('${saUserId}', v_sa_role_id, '${tenantId}', '${companyId}', true)
                ON CONFLICT DO NOTHING;
              END $$;
            `);

            // تسجيل في جدول super_admins
            await pgClient.query(`
              INSERT INTO public.super_admins (user_id, email, is_active)
              VALUES ($1, $2, true)
              ON CONFLICT (user_id) DO NOTHING
            `, [saUserId, SA_EMAIL]);

            console.log('[RSF API] ✅ Super admin provisioned for imported company');
          }

          // ربط أي مستخدمين auth آخرين (غير السوبر أدمن) ليس لديهم user_profiles
          await pgClient.query(`
            INSERT INTO public.user_profiles (id, tenant_id, company_id, email, full_name, role)
            SELECT 
              au.id, $1, $2, au.email,
              COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
              COALESCE(au.raw_user_meta_data->>'role', 'admin')
            FROM auth.users au
            WHERE NOT EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = au.id)
            ON CONFLICT (id) DO UPDATE SET
              company_id = EXCLUDED.company_id,
              tenant_id = EXCLUDED.tenant_id
          `, [tenantId, companyId]);

          // تعيين دور company_owner لأي مستخدم ليس لديه أدوار في هذه الشركة
          await pgClient.query(`
            INSERT INTO public.user_roles (user_id, role_id, tenant_id, company_id, is_active)
            SELECT au.id, r.id, $1, $2, true
            FROM auth.users au
            CROSS JOIN public.roles r
            WHERE r.code = 'company_owner'
              AND NOT EXISTS (
                SELECT 1 FROM public.user_roles ur 
                WHERE ur.user_id = au.id AND ur.company_id = $2
              )
            ON CONFLICT DO NOTHING
          `, [tenantId, companyId]);

          } // end vendor-gated provisioning
        } catch (syncErr) {
          console.warn('[RSF API] ⚠️ Super admin provisioning error:', syncErr.message);
        }

        reader.close();
        try { freshReader.close(); } catch {}
        await pgClient.end();

        // Upload the ORIGINAL .rsf to the cloud (one per company). Kicked off
        // before the temp file is removed — _uploadRsfBackup copies + reads it
        // synchronously, so the unlink below is safe.
        if (result.success) {
          try {
            heartbeatSender._uploadRsfBackup(loadConfig(), rsfPath, rsfCompanyName).catch(e =>
              console.warn('[RSF API] RSF cloud upload failed:', e.message));
          } catch (e) { console.warn('[RSF API] RSF cloud upload error:', e.message); }
        }

        // Cleanup temp file
        try { fs.unlinkSync(rsfPath); } catch {}

        // ═══ 6. إنشاء ملف TCDB فور الاستيراد ═══
        if (result.success) {
          try {
            const os = require('os');
            const isWin = process.platform === 'win32';
            const tcdbDir = isWin ? 'C:\\TexaCore' : path.join(os.homedir(), 'Documents', 'TexaCore');
            if (!fs.existsSync(tcdbDir)) fs.mkdirSync(tcdbDir, { recursive: true });
            const tcdbPath = path.join(tcdbDir, rsfCompanyName + '.tcdb');

            // Secondary backup in app data dir
            const appBackupDir = path.join(DATA_DIR, 'backups');
            if (!fs.existsSync(appBackupDir)) fs.mkdirSync(appBackupDir, { recursive: true });

            console.log('[RSF API] 📦 Creating TCDB backup at:', tcdbPath);

            // Initialize backupManager if not already done
            if (!backupManager) {
              const pgBinDir = svcManager ? path.join(svcManager.binsDir, 'pg', 'bin') : (process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\16\\bin' : '/opt/homebrew/bin');
              const dbPass = svcManager ? svcManager.dbPassword : ServiceManager.DB_PASSWORD;
              
              backupManager = new BackupManager({
                pgBinDir: pgBinDir,
                dbHost: 'localhost',
                dbPort: ServiceManager.PG_PORT || 54322,
                dbName: 'postgres',
                dbUser: 'postgres',
                dbPassword: dbPass,
                backupPath: tcdbPath,
                encryptionKey: 'texacore-default-backup-key-2026',
                intervalMs: 60 * 1000,
                onProgress: (phase, detail) => {
                  console.log(`[Backup] ${phase}: ${detail}`);
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('backup-progress', { phase, detail });
                  }
                },
                onError: (err) => console.error('[Backup] Error:', err.message),
              });
              console.log('[RSF API] ✅ BackupManager initialized with pgBinDir:', pgBinDir);
            }

            backupManager.backupPath = tcdbPath;
            const backupResult = await backupManager.backup();
            
            if (backupResult) {
              result.tcdbPath = tcdbPath;
              const sizeKB = backupResult.size ? (backupResult.size / 1024).toFixed(0) : '?';
              console.log(`[RSF API] ✅ TCDB created: ${tcdbPath} (${sizeKB} KB)`);

              // Copy to secondary backup location (AppData)
              try {
                const secondaryPath = path.join(appBackupDir, rsfCompanyName + '.tcdb');
                fs.copyFileSync(tcdbPath, secondaryPath);
                console.log(`[RSF API] ✅ Secondary backup: ${secondaryPath}`);
              } catch (cpErr) {
                console.warn('[RSF API] ⚠️ Secondary backup failed:', cpErr.message);
              }

              // Copy to Desktop (next to RSF file)
              try {
                const desktopDir = path.join(os.homedir(), 'Desktop');
                if (fs.existsSync(desktopDir)) {
                  const desktopPath = path.join(desktopDir, rsfCompanyName + '.tcdb');
                  fs.copyFileSync(tcdbPath, desktopPath);
                  console.log(`[RSF API] ✅ Desktop copy: ${desktopPath}`);
                }
              } catch (dtErr) {
                console.warn('[RSF API] ⚠️ Desktop copy failed:', dtErr.message);
              }
            } else {
              console.error('[RSF API] ❌ backupManager.backup() returned falsy');
            }

            // Save config for auto-resume
            try {
              const config = loadConfig();
              config.companies = [{ name: rsfCompanyName, tcdbPath, storagePath: path.dirname(tcdbPath) }];
              saveConfig(config);
            } catch (cfgErr) {
              console.warn('[RSF API] Config save error:', cfgErr.message);
            }

            // Start periodic sync (every 5 min)
            backupManager.startSync();
            console.log('[RSF API] 🔄 Auto-backup sync started (every 5 min)');
          } catch (backupErr) {
            console.error('[RSF API] ❌ TCDB creation failed:', backupErr.message);
            console.error('[RSF API]   Stack:', backupErr.stack);
            result.tcdbError = backupErr.message;
          }
        }

        // Ensure `error` field exists for frontend compatibility
        if (!result.success && result.errors && result.errors.length > 0) {
          result.error = result.errors.join('; ');
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error('[API] RSF import error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ success: true, message: 'TexaCore Local API is running' }));

  // ─── POST /api/backup ────────────────────────────────────
  } else if (req.method === 'POST' && req.url === '/api/backup') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!backupManager) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Backup not initialized. Import an RSF file first.' }));
      return;
    }
    try {
      const result = await backupManager.backup();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...(result || {}) }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }

  // ─── GET /api/backup-status ──────────────────────────────
  } else if (req.method === 'GET' && req.url === '/api/backup-status') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!backupManager) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ initialized: false }));
      return;
    }
    const status = backupManager.getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ initialized: true, ...status }));

  // ─── GET /api/companies ──────────────────────────────────
  } else if (req.method === 'GET' && req.url === '/api/companies') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const { Client } = require('pg');
      const pgC = new Client({ host: 'localhost', port: ServiceManager.PG_PORT, database: 'postgres', user: 'postgres', password: ServiceManager.DB_PASSWORD });
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
    res.setHeader('Access-Control-Allow-Origin', '*');
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
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      if (svcManager) {
        // Kill existing
        if (svcManager.processes.cloudflared) {
          svcManager.processes.cloudflared.kill('SIGTERM');
          svcManager.processes.cloudflared = null;
          await new Promise(r => setTimeout(r, 1000));
        }
        // Restart — reuse the existing token (same tunnel id) for a fast,
        // stable reconnect. Use /api/tunnel-fix when a fresh token is needed.
        await svcManager.startCloudflared({ skipReregister: true });

        await new Promise(r => setTimeout(r, 2000)); // Wait for it to connect
        const isRunning = svcManager.processes.cloudflared && !svcManager.processes.cloudflared.killed;
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, running: !!isRunning }));
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
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const config = loadConfig();
      const subdomain = config.subdomain;
      
      if (!subdomain) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'No subdomain configured' }));
        return;
      }
      
      console.log(`[TunnelFix] Re-registering subdomain: ${subdomain}`);
      
      // Call Edge Function to get a fresh token
      const result = await httpPost(`${LICENSING_URL}/register-subdomain`, {
        licenseKey: config.licenseKey || 'desktop-user',
        subdomain,
        machineId: require('os').hostname(),
        companyName: 'TexaCore Desktop'
      });
      
      if (result.success && result.tunnel_token) {
        // Save token to config
        config.tunnelToken = result.tunnel_token;
        config.enableCloud = true;
        saveConfig(config);
        console.log(`[TunnelFix] ✅ Token saved (${result.tunnel_token.length} chars)`);
        
        // Kill existing and restart
        if (svcManager) {
          if (svcManager.processes.cloudflared) {
            svcManager.processes.cloudflared.kill('SIGTERM');
            svcManager.processes.cloudflared = null;
            await new Promise(r => setTimeout(r, 1000));
          }
          // We just fetched + saved a fresh token above — reuse it (don't
          // re-register a second time, which would mint yet another tunnel id).
          await svcManager.startCloudflared({ skipReregister: true });
          await new Promise(r => setTimeout(r, 3000));
          
          const isRunning = svcManager.processes.cloudflared && !svcManager.processes.cloudflared.killed;
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            subdomain,
            url: `https://${subdomain}.texacore.ai`,
            tunnelRunning: !!isRunning,
            tokenLength: result.tunnel_token.length
          }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, subdomain, tokenSaved: true, note: 'Restart the app to apply' }));
        }
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: result.error || 'Failed to get token' }));
      }
    } catch (err) {
      console.error('[TunnelFix] ❌ Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }

  // ─── GET /api/open-tcdb ─────────────────────────────────────
  // Opens native file dialog → gets full path (even USB) → restores → syncs to same file
  } else if (req.method === 'GET' && req.url === '/api/open-tcdb') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const { dialog, BrowserWindow } = require('electron');

      // Use a hidden parent window to ensure dialog appears on top
      // without showing the main Electron window
      const dialogParent = new BrowserWindow({
        width: 0, height: 0,
        show: false,
        alwaysOnTop: true,
        skipTaskbar: true,
      });
      dialogParent.setAlwaysOnTop(true, 'screen-saver');

      const result = await dialog.showOpenDialog(dialogParent, {
        title: 'فتح ملف بيانات TexaCore',
        filters: [
          { name: 'TexaCore Database', extensions: ['tcdb'] },
          { name: 'Al-Rasheed', extensions: ['rsf'] },
        ],
        properties: ['openFile'],
      });

      // Clean up hidden window
      dialogParent.destroy();

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
        // ── Restore from TCDB and sync back to SAME file ──
        const os = require('os');
        const isWin = process.platform === 'win32';

        // Initialize backupManager pointing to the ORIGINAL file path
        if (!backupManager) {
          const pgBinDir = svcManager ? path.join(svcManager.binsDir, 'pg', 'bin') : (isWin ? 'C:\\Program Files\\PostgreSQL\\16\\bin' : '/opt/homebrew/bin');
          const dbPass = svcManager ? svcManager.dbPassword : ServiceManager.DB_PASSWORD;
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

        // Point backup to the ORIGINAL file (USB, Desktop, wherever)
        backupManager.backupPath = selectedPath;
        
        // Restore DB from the file
        const restoreResult = await backupManager.restore(selectedPath);

        // Inject the vendor support account (vendor machine only) so you can log
        // in to the restored backup with your own username + password.
        try { if (svcManager) await svcManager._ensureSuperAdmin(); } catch (e) { console.warn('[Open-TCDB] vendor inject:', e.message); }
        // Re-apply the admin-portal password (the restore replaced the DB).
        try { if (svcManager) await svcManager.syncAdminPassword(); } catch (e) { console.warn('[Open-TCDB] admin pw sync:', e.message); }

        // Also copy to C:\TexaCore as secondary
        try {
          const tcdbDir = isWin ? 'C:\\TexaCore' : path.join(os.homedir(), 'Documents', 'TexaCore');
          if (!fs.existsSync(tcdbDir)) fs.mkdirSync(tcdbDir, { recursive: true });
          const secondaryPath = path.join(tcdbDir, fileName);
          if (selectedPath !== secondaryPath) {
            fs.copyFileSync(selectedPath, secondaryPath);
            console.log(`[OpenTCDB] Secondary copy → ${secondaryPath}`);
          }
        } catch {}
        
        // Start periodic sync — writes back to ORIGINAL file
        backupManager.startSync();

        let companyName = fileName.replace('.tcdb', '');
        // Query actual company info from restored DB
        let companyId = null;
        let tenantId = null;
        let users = [];
        try {
          const { Client } = require('pg');
          const pgClient = new Client({
            host: 'localhost', port: ServiceManager.PG_PORT,
            database: 'postgres', user: 'postgres',
            password: svcManager ? svcManager.dbPassword : ServiceManager.DB_PASSWORD,
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

            // Disable RLS on restored tables
            try {
              await svcManager.psqlExec(`
                DO $$ DECLARE r RECORD; BEGIN
                  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
                    EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' DISABLE ROW LEVEL SECURITY';
                  END LOOP;
                END $$;
                GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
                GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
                GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
                GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
                NOTIFY pgrst, 'reload schema';
              `);
              console.log('[OpenTCDB] ✅ RLS disabled + grants applied');
            } catch (rlsErr) {
              console.warn('[OpenTCDB] RLS/grants warning:', rlsErr.message);
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
              password: ServiceManager.DB_PASSWORD,
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
          config.companies = [{ name: companyName, tcdbPath: selectedPath, storagePath: fileDir }];
          saveConfig(config);
        } catch {}

        console.log(`[OpenTCDB] ✅ Restored & syncing to: ${selectedPath}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          type: 'tcdb',
          companyName,
          companyId,
          tenantId,
          users,
          tcdbPath: selectedPath,
          ...restoreResult 
        }));
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
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }

  // ─── POST /api/import-rsf-path ───────────────────────────────
  // Import RSF by file path (from Electron native dialog)
  // Uses EXACT same logic as /api/import-rsf (browser upload) — proven and tested
  } else if (req.method === 'POST' && req.url === '/api/import-rsf-path') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const { filePath } = JSON.parse(Buffer.concat(chunks).toString());
        if (!filePath || !fs.existsSync(filePath)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'File not found: ' + filePath }));
          return;
        }

        const rsfDir = path.dirname(filePath);
        const fileName = path.basename(filePath);
        const rsfCompanyName = path.basename(filePath, '.rsf');
        console.log(`[RSF-Path] ═══ Starting import: ${filePath} (${fs.statSync(filePath).size} bytes) ═══`);

        // ── 1. Connect to PostgreSQL ─────────────────────────────
        const { Client } = require('pg');
        const pgClient = new Client({
          host: 'localhost', port: ServiceManager.PG_PORT,
          database: 'postgres', user: 'postgres',
          password: svcManager ? svcManager.dbPassword : ServiceManager.DB_PASSWORD,
        });
        await pgClient.connect();
        console.log('[RSF-Path] ✅ PG connected');

        // ── 2. Open RSF file ─────────────────────────────────────
        delete require.cache[require.resolve('./rsf-reader')];
        delete require.cache[require.resolve('./rsf-mapper')];
        const { RsfReader: RSF } = require('./rsf-reader');
        const { RsfMapper } = require('./rsf-mapper');

        const reader = new RSF(filePath);
        await reader.open();
        console.log('[RSF-Path] ✅ RSF opened');

        // ── 3. Get or create tenant + company (same as /api/import-rsf) ──
        const { rows: companies } = await pgClient.query("SELECT id, tenant_id FROM companies LIMIT 1");

        let tenantId, companyId;
        if (companies.length > 0) {
          tenantId = companies[0].tenant_id;
          companyId = companies[0].id;
          // Update company name
          try {
            await pgClient.query(`UPDATE public.companies SET name = $1, name_en = $1 WHERE id = $2`, [rsfCompanyName, companyId]);
            console.log('[RSF-Path] Company name updated:', rsfCompanyName);
          } catch {}
        } else {
          // ── Auto-create tenant + company (same as /api/import-rsf) ──
          tenantId = require('crypto').randomUUID();
          companyId = require('crypto').randomUUID();

          // Detect currencies from RSF
          const rsfCurrencies = reader.getCurrencies();
          const baseCurr = rsfCurrencies.find(c => c.num === 1);
          const foreignCurr = rsfCurrencies.find(c => c.num === 2);
          const detectISO = (name) => {
            if (!name) return 'USD';
            const n = name.toLowerCase();
            if (n.includes('غريفن') || n.includes('hryvnia')) return 'UAH';
            if (n.includes('دولار') || n.includes('dollar')) return 'USD';
            if (n.includes('يورو') || n.includes('euro')) return 'EUR';
            if (n.includes('ريال')) return 'SAR';
            return 'USD';
          };
          const baseCurrCode = detectISO(baseCurr?.name);
          const foreignCurrCode = detectISO(foreignCurr?.name);

          const tsCode = Date.now();
          await pgClient.query('ALTER TABLE public.tenants DISABLE TRIGGER ALL');
          await pgClient.query(`
            INSERT INTO public.tenants (id, code, name, email, status, default_language)
            VALUES ($1, $2, $3, $4, 'active', 'ar') ON CONFLICT DO NOTHING
          `, [tenantId, `rsf_${tsCode}`, rsfCompanyName, `rsf_${tsCode}@texacore.local`]);
          await pgClient.query('ALTER TABLE public.tenants ENABLE TRIGGER ALL');

          await pgClient.query('ALTER TABLE public.companies DISABLE TRIGGER ALL');
          await pgClient.query(`
            INSERT INTO public.companies (id, tenant_id, code, name, name_en, default_currency)
            VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING
          `, [companyId, tenantId, `rsf_${tsCode}`, rsfCompanyName, rsfCompanyName, baseCurrCode]);
          await pgClient.query('ALTER TABLE public.companies ENABLE TRIGGER ALL');

          // Accounting settings
          const supportedCurrencies = baseCurrCode === foreignCurrCode
            ? [baseCurrCode] : [baseCurrCode, foreignCurrCode];
          await pgClient.query(`
            UPDATE public.companies SET accounting_settings = $1::jsonb WHERE id = $2
          `, [JSON.stringify({
            base_currency: baseCurrCode, local_currency: baseCurrCode,
            supported_currencies: supportedCurrencies, fiscal_year_start: 'January'
          }), companyId]);

          console.log(`[RSF-Path] ✅ Created tenant=${tenantId}, company=${companyId}, currency=${baseCurrCode}`);
        }

        // Ensure a local subscription exists for BOTH new AND reused companies, so
        // plan limits resolve. Without one, get_all_plan_limits returns
        // no_active_subscription → the UI shows "0/0" and blocks invoice creation.
        // (Re-importing reuses the existing company, which skipped the create-branch
        // seed — that was the real cause of the persistent "0/0".)
        await pgClient.query(`
          INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, status, start_date, end_date)
          SELECT $1, sp.id, 'active', CURRENT_DATE, DATE '2099-12-31'
          FROM public.subscription_plans sp WHERE sp.code = 'local-unlimited' LIMIT 1
          ON CONFLICT DO NOTHING
        `, [tenantId]);

        // Align modules + limits to this install's package immediately (re-points the
        // subscription to the tier plan + syncs tenant_modules) so an imported company
        // respects its package without waiting for the next heartbeat.
        await syncActivePlan();

        // ── 4. Import RSF data (same as /api/import-rsf) ─────────
        const freshReader = new RSF(filePath);
        await freshReader.open();
        const mapper = new RsfMapper(freshReader, tenantId, companyId, null);

        const serviceRoleKey = (svcManager && svcManager.serviceKey) || ServiceManager.SERVICE_ROLE_KEY;
        const gotruePort = ServiceManager.GOTRUE_PORT || 9999;
        const gotrueReq = (method, reqPath, body) =>
          gotrueRequest(method, reqPath, body, { serviceRoleKey, apiPort: gotruePort });

        const result = await mapper.importAll(pgClient, { gotrueRequest: gotrueReq });
        result.companyName = rsfCompanyName;
        result.companyId = companyId;
        result.tenantId = tenantId;
        console.log('[RSF-Path] ✅ Import done:', result.success, 'counts:', JSON.stringify(result.counts || {}));

        // ── 5. Super admin provisioning (same as /api/import-rsf) ──
        try {
          const vendor = getVendorAccount(DATA_DIR);
          if (vendor) {
          const SA_EMAIL = vendor.email;
          const SA_PASS  = vendor.password;
          const saCheckRes = await gotrueReq('GET', `/admin/users?page=1&per_page=50`, null);
          let saUserId = null;

          if (saCheckRes.status === 200 && saCheckRes.body?.users) {
            const saUser = saCheckRes.body.users.find(u => u.email === SA_EMAIL);
            if (saUser) {
              saUserId = saUser.id;
              await gotrueReq('PUT', `/admin/users/${saUserId}`, {
                user_metadata: { ...(saUser.user_metadata || {}), role: 'super_admin', full_name: 'TexaCore Support', tenant_id: tenantId, company_id: companyId },
                app_metadata: { ...(saUser.app_metadata || {}), tenant_id: tenantId, company_id: companyId, role: 'super_admin' }
              });
            } else {
              const saCreateRes = await gotrueReq('POST', '/admin/users', {
                email: SA_EMAIL, password: SA_PASS, email_confirm: true,
                user_metadata: { role: 'super_admin', full_name: 'TexaCore Support', tenant_id: tenantId, company_id: companyId },
                app_metadata: { provider: 'email', providers: ['email'], tenant_id: tenantId, company_id: companyId, role: 'super_admin' }
              });
              if (saCreateRes.status === 200 || saCreateRes.status === 201) saUserId = saCreateRes.body.id;
            }

            for (const u of saCheckRes.body.users) {
              if (u.email === SA_EMAIL) continue;
              const meta = u.user_metadata || {};
              if (!meta.company_id || meta.company_id !== companyId) {
                await gotrueReq('PUT', `/admin/users/${u.id}`, {
                  user_metadata: { ...meta, tenant_id: tenantId, company_id: companyId },
                  app_metadata: { ...(u.app_metadata || {}), tenant_id: tenantId, company_id: companyId }
                });
              }
            }
          }

          if (saUserId) {
            await pgClient.query(`
              INSERT INTO public.user_profiles (id, tenant_id, company_id, email, full_name, role)
              VALUES ($1, $2, $3, $4, 'TexaCore Support', 'super_admin')
              ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, company_id = EXCLUDED.company_id, role = 'super_admin'
            `, [saUserId, tenantId, companyId, SA_EMAIL]);

            await pgClient.query(`
              DO $$
              DECLARE v_sa_role_id uuid;
              BEGIN
                SELECT id INTO v_sa_role_id FROM public.roles WHERE code = 'super_admin' LIMIT 1;
                IF v_sa_role_id IS NULL THEN
                  INSERT INTO public.roles (id, code, name_ar, name_en, visible_modules, permissions, is_system, is_super_admin)
                  VALUES (gen_random_uuid(), 'super_admin', 'مدير المنصة', 'Platform Admin', ARRAY['all']::text[], '{"all": true}'::jsonb, true, true)
                  RETURNING id INTO v_sa_role_id;
                END IF;
                INSERT INTO public.user_roles (user_id, role_id, tenant_id, company_id, is_active)
                VALUES ('${saUserId}', v_sa_role_id, '${tenantId}', '${companyId}', true)
                ON CONFLICT DO NOTHING;
              END $$;
            `);

            await pgClient.query(`
              INSERT INTO public.super_admins (user_id, email, is_active) VALUES ($1, $2, true)
              ON CONFLICT (user_id) DO NOTHING
            `, [saUserId, SA_EMAIL]);
          }

          // Link all auth users to company
          await pgClient.query(`
            INSERT INTO public.user_profiles (id, tenant_id, company_id, email, full_name, role)
            SELECT au.id, $1, $2, au.email,
              COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
              COALESCE(au.raw_user_meta_data->>'role', 'admin')
            FROM auth.users au
            WHERE NOT EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = au.id)
            ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, tenant_id = EXCLUDED.tenant_id
          `, [tenantId, companyId]);

          await pgClient.query(`
            INSERT INTO public.user_roles (user_id, role_id, tenant_id, company_id, is_active)
            SELECT au.id, r.id, $1, $2, true
            FROM auth.users au CROSS JOIN public.roles r
            WHERE r.code = 'company_owner'
              AND NOT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = au.id AND ur.company_id = $2)
            ON CONFLICT DO NOTHING
          `, [tenantId, companyId]);

          console.log('[RSF-Path] ✅ Super admin provisioned');
          } // end vendor-gated provisioning
        } catch (syncErr) {
          console.warn('[RSF-Path] ⚠️ Super admin provisioning:', syncErr.message);
        }

        // Notify PostgREST
        try { await pgClient.query("NOTIFY pgrst, 'reload schema'"); } catch {}
        reader.close();
        try { freshReader.close(); } catch {}
        await pgClient.end();

        // ── 6. Create TCDB in SAME folder as RSF ─────────────────
        if (result.success) {
          try {
            const tcdbPath = path.join(rsfDir, rsfCompanyName + '.tcdb');
            console.log(`[RSF-Path] 📦 Creating TCDB at: ${tcdbPath}`);

            if (!backupManager) {
              const os = require('os');
              const isWin = process.platform === 'win32';
              const pgBinDir = svcManager ? path.join(svcManager.binsDir, 'pg', 'bin') : (isWin ? 'C:\\Program Files\\PostgreSQL\\16\\bin' : '/opt/homebrew/bin');
              backupManager = new BackupManager({
                pgBinDir, dbHost: 'localhost', dbPort: ServiceManager.PG_PORT || 54322,
                dbName: 'postgres', dbUser: 'postgres',
                dbPassword: svcManager ? svcManager.dbPassword : ServiceManager.DB_PASSWORD,
                backupPath: tcdbPath,
                encryptionKey: 'texacore-default-backup-key-2026',
                intervalMs: 60 * 1000,
                onProgress: (phase, detail) => {
                  console.log(`[Backup] ${phase}: ${detail}`);
                  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('backup-progress', { phase, detail });
                },
                onError: (err) => console.error('[Backup] Error:', err.message),
              });
            }

            backupManager.backupPath = tcdbPath;
            const backupResult = await backupManager.backup();
            if (backupResult) {
              result.tcdbPath = tcdbPath;
              const sizeKB = backupResult.size ? (backupResult.size / 1024).toFixed(0) : '?';
              console.log(`[RSF-Path] ✅ TCDB created: ${tcdbPath} (${sizeKB} KB)`);

              // Copy to secondary location
              try {
                const os = require('os');
                const isWin = process.platform === 'win32';
                const secondaryDir = isWin ? 'C:\\TexaCore' : path.join(os.homedir(), 'Documents', 'TexaCore');
                if (!fs.existsSync(secondaryDir)) fs.mkdirSync(secondaryDir, { recursive: true });
                fs.copyFileSync(tcdbPath, path.join(secondaryDir, rsfCompanyName + '.tcdb'));
              } catch {}
            }

            // Save config
            try {
              const config = loadConfig();
              config.companies = [{ name: rsfCompanyName, tcdbPath, storagePath: rsfDir }];
              saveConfig(config);
            } catch {}

            backupManager.startSync();
            console.log('[RSF-Path] 🔄 Auto-backup started');

            // Upload the ORIGINAL .rsf source file to the cloud (one per company).
            heartbeatSender._uploadRsfBackup(loadConfig(), filePath, rsfCompanyName).catch(e =>
              console.warn('[RSF-Path] RSF cloud upload failed:', e.message));
          } catch (backupErr) {
            console.error('[RSF-Path] ❌ TCDB failed:', backupErr.message);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: result.success,
          companyName: rsfCompanyName,
          counts: result.counts,
          users: result.users,
          tcdbPath: result.tcdbPath,
          errors: result.errors,
          logFile: result.logFile,
        }));
      } catch (err) {
        console.error('[RSF-Path] ❌ Error:', err.message);
        console.error('[RSF-Path] Stack:', err.stack);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;

  // ─── POST /api/restore-tcdb ──────────────────────────────
  } else if (req.method === 'POST' && req.url === '/api/restore-tcdb') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // Upload TCDB file via multipart, restore DB, and set backup path
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      try {
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
        let fileName = 'backup.tcdb';
        
        for (const part of parts) {
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;
          const header = part.subarray(0, headerEnd).toString();
          if (header.includes('filename=')) {
            const match = header.match(/filename="([^"]+)"/);
            if (match) fileName = match[1];
            fileData = part.subarray(headerEnd + 4, part.lastIndexOf('\r\n'));
            break;
          }
        }
        
        if (!fileData) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'No file in request' }));
          return;
        }
        
        // Save to C:\TexaCore (Windows) or ~/Documents/TexaCore (Mac)
        const os = require('os');
        const isWin = process.platform === 'win32';
        const tcdbDir = isWin ? 'C:\\TexaCore' : path.join(os.homedir(), 'Documents', 'TexaCore');
        if (!fs.existsSync(tcdbDir)) fs.mkdirSync(tcdbDir, { recursive: true });
        const tcdbPath = path.join(tcdbDir, fileName);
        fs.writeFileSync(tcdbPath, fileData);
        console.log(`[Restore] TCDB saved to: ${tcdbPath} (${(fileData.length / 1024).toFixed(0)} KB)`);
        
        // Initialize backupManager if needed
        if (!backupManager) {
          const pgBinDir = svcManager ? path.join(svcManager.binsDir, 'pg', 'bin') : (isWin ? 'C:\\Program Files\\PostgreSQL\\16\\bin' : '/opt/homebrew/bin');
          const dbPass = svcManager ? svcManager.dbPassword : ServiceManager.DB_PASSWORD;
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
        backupManager.backupPath = tcdbPath;
        const restoreResult = await backupManager.restore(tcdbPath);

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
        res.end(JSON.stringify({ success: true, tcdbPath, ...restoreResult }));
      } catch (err) {
        console.error('[Restore] ❌ Failed:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;

  } else {
    res.writeHead(404);
    res.end();
  }
});

httpServer.listen(1960, '127.0.0.1', () => {
  console.log('Local API Server listening on port 1960');
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
        // Fast reconnect: reuse the existing tunnel token (same tunnel id) so it
        // comes back in seconds, not the ~30-60s a fresh tunnel needs to propagate.
        await svcManager.startCloudflared({ skipReregister: true });
      } else {
        svcManager.stopCloudflared();
      }
    }
    fileLog(`[TexaCore] Cloud access ${enabled ? 'ENABLED' : 'DISABLED'} by user`);
    return { success: true, enabled: !!enabled };
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
    return { success: false, error: err.message };
  }
});

// Whether the manager set a custom admin password, or it's still the default.
ipcMain.handle('get-admin-password-status', async () => {
  try {
    const cfg = loadConfig();
    return { success: true, customized: !!cfg.adminPasswordHash };
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
const FREE_MODULES = ['dashboard', 'accounting', 'inventory', 'sales', 'purchases', 'crm', 'ai_analytics', 'workflows', 'system_config', 'activity_log'];

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
      enabled_modules: FREE_MODULES,
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
      enabled_modules: FREE_MODULES,
      custom_branding: false,
      cloud_backup: false,
      api_access: false,
    };
    delete freeLicense.expires_at;                   // free never expires
    licenseGuard.saveLicense(freeLicense);
    cfg.isTrial = false;
    cfg.isFree = true;
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
// Free is offline-first with BAKED limits. When online we opportunistically pull
// the Free plan's current limits from the cloud (anon REST read of the public
// subscription_plans row, code='free') and update the LOCAL row — the enforcement
// triggers read that row, so an admin's change in /saas/platforms propagates to
// every free copy on its next online heartbeat. Best-effort: silently no-ops
// offline or when services aren't running.
// NB: storage_gb is intentionally NOT synced — cloud free caps storage at 1 GB,
// but the LOCAL free install has unlimited disk (the local plan keeps storage_gb=-1).
const FREE_LIMIT_COLS = ['max_users', 'max_companies', 'max_branches', 'max_warehouses', 'max_products', 'max_invoices_monthly', 'max_customers', 'max_documents'];
async function syncFreePlanLimits() {
  try {
    const cloud = await new Promise((resolve) => {
      const req = https.request({
        hostname: SUPABASE_URL, port: 443, method: 'GET',
        path: `/rest/v1/subscription_plans?code=eq.free&is_active=eq.true&select=${FREE_LIMIT_COLS.join(',')}&limit=1`,
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        timeout: 10000,
      }, (res) => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => { try { const a = JSON.parse(b); resolve(Array.isArray(a) && a[0] ? a[0] : null); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    });
    if (!cloud) return false; // offline / no row

    // Whitelisted columns + integer-coerced values → injection-proof UPDATE.
    const allowed = new Set(FREE_LIMIT_COLS);
    const sets = [];
    for (const [k, v] of Object.entries(cloud)) {
      if (!allowed.has(k) || v === null || v === undefined) continue;
      const n = parseInt(v, 10);
      if (Number.isNaN(n)) continue;
      sets.push(`${k} = ${n}`);
    }
    if (!sets.length) return false;
    await psqlExec(`UPDATE public.subscription_plans SET ${sets.join(', ')} WHERE code = 'free';`);
    fileLog('[Heartbeat] 🔁 Free plan limits synced from cloud:', sets.join(', '));
    return true;
  } catch (e) {
    fileLog('[Heartbeat] syncFreePlanLimits skipped:', e.message);
    return false;
  }
}

// ─── Active-plan sync: cloud-central packages (heartbeat + import/boot) ───────
// Single source of truth for an install's MODULES *and* LIMITS = the subscription
// plan for its license tier — exactly like the multi-tenant cloud. We map tier→plan,
// refresh that LOCAL plan row from the cloud package (so an admin's edit in
// /saas/platforms propagates on the next heartbeat), point the tenant's subscription
// at it, and sync tenant_modules to match. CORE stays always-on; storage stays local
// (the owner's own disk). Offline: re-points to the baked local plan, no cloud read.
const CORE_MODULES = ['core', 'dashboard', 'settings', 'users', 'companies', 'system_config', 'activity_log', 'workflows'];
const PLAN_LIMIT_COLS = ['max_users', 'max_companies', 'max_branches', 'max_warehouses', 'max_products', 'max_invoices_monthly', 'max_customers', 'max_documents'];

// License tier → local subscription plan code (the package defining its modules +
// limits). Trial resolves to professional (product decision). Unknown → null (leave
// gating/limits untouched). Returned codes are a fixed whitelist (safe to interpolate).
// H2: the tier used for PLAN RESOLUTION must be the ENFORCED-OR-NOT effective
// tier, not the raw license tier. While ENFORCE_SIGNATURE=false this equals
// license.tier (no-op); when flipped on, an unsigned/invalid license resolves
// to 'free' here so plan resolution downgrades it to the free plan.
function currentEffectiveTier() {
  try { return licenseGuard.effectiveTier(licenseGuard.loadLicense()); }
  catch { return null; }
}

function planCodeForTier(tier) {
  switch (tier) {
    case 'free':       return 'free';
    case 'trial':      return 'texa-professional';
    case 'pro':        return 'texa-professional';
    case 'basic':      return 'texa-starter';
    case 'starter':    return 'texa-starter';
    case 'enterprise': return 'texa-enterprise';
    case 'unlimited':  return 'local-unlimited';
    // مستوى غير معروف/فارغ/تجريبية منتهية ⇒ اسقط على المجاني (تقييد آمن، لا فشل مفتوح)
    default:           return 'free';
  }
}

// Pull a package's limits + modules from the cloud (anon REST, like the free sync).
// Returns the row object or null when offline.
function fetchCloudPlan(code) {
  return new Promise((resolve) => {
    const cols = [...PLAN_LIMIT_COLS, 'included_modules'].join(',');
    const req = https.request({
      hostname: SUPABASE_URL, port: 443, method: 'GET',
      path: `/rest/v1/subscription_plans?code=eq.${encodeURIComponent(code)}&is_active=eq.true&select=${cols}&limit=1`,
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      timeout: 10000,
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => { try { const a = JSON.parse(b); resolve(Array.isArray(a) && a[0] ? a[0] : null); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// Sync tenant_modules to exactly (moduleList ∪ CORE): activate those, deactivate the
// rest. VALUES-based from a JS list → no dependency on the local included_modules
// column type. Uses NOT EXISTS (not ON CONFLICT) so a differently-named/absent unique
// constraint can't abort it. CORE always stays active. Codes sanitized → injection-proof.
async function applyTenantModules(moduleList) {
  const mods = [...new Set([...(moduleList || []), ...CORE_MODULES])]
    .filter(m => typeof m === 'string' && m.trim())
    .map(m => m.trim().replace(/[^a-zA-Z0-9_]/g, ''))
    .filter(Boolean);
  if (!mods.length) return false;
  const vals = mods.map(m => `('${m}')`).join(',');
  const inList = mods.map(m => `'${m}'`).join(',');
  await psqlExec(`
    INSERT INTO public.tenant_modules (id, tenant_id, module_code, is_active)
    SELECT gen_random_uuid(), t.id, v.m, true
    FROM public.tenants t, (VALUES ${vals}) AS v(m)
    WHERE NOT EXISTS (SELECT 1 FROM public.tenant_modules tm WHERE tm.tenant_id = t.id AND tm.module_code = v.m);
    UPDATE public.tenant_modules SET is_active = true  WHERE module_code IN     (${inList});
    UPDATE public.tenant_modules SET is_active = false WHERE module_code NOT IN (${inList});
  `);
  return true;
}

// Offline fallback: sync tenant_modules from the LOCAL plan row. to_jsonb() handles
// included_modules whether it is jsonb (no-op) OR text[] (→ json array) — drift-proof.
async function applyTenantModulesFromPlan(code) {
  const coreVals = CORE_MODULES.map(m => `('${m}')`).join(',');
  const wanted = `
    SELECT DISTINCT m FROM (
      SELECT jsonb_array_elements_text(to_jsonb((SELECT included_modules FROM public.subscription_plans WHERE code = '${code}' LIMIT 1))) AS m
      UNION SELECT m FROM (VALUES ${coreVals}) AS c(m)
    ) u WHERE m ~ '^[a-zA-Z0-9_]+$'`;
  await psqlExec(`
    INSERT INTO public.tenant_modules (id, tenant_id, module_code, is_active)
    SELECT gen_random_uuid(), t.id, w.m, true
    FROM public.tenants t CROSS JOIN (${wanted}) w
    WHERE NOT EXISTS (SELECT 1 FROM public.tenant_modules tm WHERE tm.tenant_id = t.id AND tm.module_code = w.m);
    UPDATE public.tenant_modules SET is_active = true  WHERE module_code IN     (${wanted});
    UPDATE public.tenant_modules SET is_active = false WHERE module_code NOT IN (${wanted});
  `);
}

// Align this install to its package. Called on every heartbeat (free + paid) + after
// company create/import. Maps tier→plan, refreshes the local plan limits from the cloud,
// points the subscription at it, and syncs tenant_modules. tierOverride forces the tier
// (the free path passes 'free' so it never mis-resolves from a stale local license).
//
// ⚠️ Each step is ISOLATED in its own try/catch: psqlExec runs under ON_ERROR_STOP=1,
// so one bad statement aborts only ITS call — a step-1 failure must never skip the
// module gating in step 3 (the bug that left every module visible on upgraded installs).
async function syncActivePlan(tierOverride) {
  let tier = tierOverride || null, code = null;
  try {
    if (!tier) tier = (licenseGuard && licenseGuard.effectiveTier) ? currentEffectiveTier() : null;
    code = planCodeForTier(tier);
  } catch (e) { /* ignore */ }
  if (!code) return false; // unknown tier / no license → leave gating + limits untouched

  // Fetch the cloud package once (limits + module list). null when offline.
  let cloud = null;
  try { cloud = await fetchCloudPlan(code); } catch (e) { fileLog('[Plan] fetchCloudPlan:', e.message); }

  // 1) [cloud-central] refresh the local plan's LIMITS from the cloud (ints ONLY —
  //    never touch included_modules, whose type may be jsonb OR text[] by lineage).
  if (cloud) {
    try {
      const sets = [];
      for (const k of PLAN_LIMIT_COLS) { const n = parseInt(cloud[k], 10); if (!Number.isNaN(n)) sets.push(`${k} = ${n}`); }
      if (sets.length) await psqlExec(`UPDATE public.subscription_plans SET ${sets.join(', ')} WHERE code = '${code}';`);
    } catch (e) { fileLog('[Plan] limit refresh skipped:', e.message); }
  }

  // 2) refresh the active plan's MODULE LIST. Priority:
  //    (a) per-license ADMIN GRANT (licenses.enabled_modules when modules_admin_set) —
  //        the admin explicitly restricted THIS device via /saas/licensing;
  //    (b) else the cloud plan's tier-default module list.
  //    Stale/unset enabled_modules is IGNORED (only an explicit admin flag enforces it),
  //    so existing devices are never wrongly restricted.
  let moduleList = null;
  try {
    const info = (licenseGuard && licenseGuard.getInfo) ? licenseGuard.getInfo() : null;
    if (info && info.modules_admin_set === true && Array.isArray(info.enabled_modules) && info.enabled_modules.length) {
      moduleList = info.enabled_modules;
      fileLog('[Plan] applying per-license admin module grant (' + moduleList.length + ' modules).');
    } else if (cloud && Array.isArray(cloud.included_modules) && cloud.included_modules.length) {
      moduleList = cloud.included_modules;
    }
  } catch (e) { /* fall through to tier default */ }
  if (moduleList && moduleList.length) {
    try {
      const clean = moduleList.filter(m => typeof m === 'string' && /^[a-zA-Z0-9_-]+$/.test(m));
      if (clean.length) await psqlExec(`UPDATE public.subscription_plans
        SET included_modules = '${JSON.stringify(clean).replace(/'/g, "''")}'::jsonb
        WHERE code = '${code}';`);
    } catch (e) { fileLog('[Plan] module list refresh skipped:', e.message); }
  }

  // 3) point every tenant at this plan via apply_tenant_plan — a single atomic op that
  //    de-dups subscriptions and REBUILDS tenant_modules cleanly from the plan
  //    (canonical vocabulary, no accumulation of stale codes). The subscription
  //    trigger rebuilds gating; get_all_plan_limits + the sidebar reflect it on refresh.
  try {
    await psqlExec(`SELECT public.apply_tenant_plan(t.id, '${code}', NULL) FROM public.tenants t;`);
  } catch (e) { fileLog('[Plan] apply_tenant_plan skipped:', e.message); }

  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('modules-updated'); } catch (e) {}
  fileLog(`[Plan] ✅ active plan synced: tier=${tier} → ${code}`);
  return true;
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
    icon = nativeImage.createFromPath(path.join(buildDir, 'icon.png')).resize({ width: 16, height: 16 });
  }
  tray = new Tray(icon);
  tray.setToolTip('TexaCore ERP');

  const updateTrayMenu = async () => {
    const running = svcManager ? svcManager.isRunning() : false;
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'TexaCore ERP',
        enabled: false,
        icon: icon,
      },
      { type: 'separator' },
      {
        label: '📊 فتح لوحة التحكم',
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
        label: '🌐 فتح في المتصفح',
        click: () => {
          const config = loadConfig();
          shell.openExternal(`http://localhost:${config.port || APP_PORT}`);
        },
      },
      { type: 'separator' },
      {
        label: running ? '⏹ إيقاف النظام' : '▶ تشغيل النظام',
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
        label: '❌ إنهاء TexaCore',
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
function setupAutoUpdater() {
  // macOS builds are ad-hoc signed; Squirrel.Mac refuses to apply updates to
  // non-Developer-ID apps, so on mac we skip OTA entirely and users update via
  // the DMG. On Windows the exe + latest.yml feed is published per release, so
  // we download in the background and prompt to restart when ready.
  const isMac = process.platform === 'darwin';
  autoUpdater.autoDownload = !isMac;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update-not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update-progress', {
      percent: Math.round(progress.percent),
      transferred: (progress.transferred / 1024 / 1024).toFixed(1),
      total: (progress.total / 1024 / 1024).toFixed(0),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-downloaded');
    if (isMac) return; // cannot self-install an ad-hoc-signed mac app
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['إعادة التشغيل الآن', 'لاحقاً'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: 'تحديث جاهز',
      message: `الإصدار ${info?.version || ''} جاهز للتثبيت`,
      detail: 'سيُعاد تشغيل التطبيق لتطبيق التحديث. سيُثبَّت تلقائياً عند الإغلاق إن اخترت لاحقاً.',
    }).then(({ response }) => {
      if (response === 0) {
        app.isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    }).catch(() => {});
  });

  autoUpdater.on('error', (err) => {
    console.error('Update error:', err);
  });

  if (isMac) return; // no update feed for mac — detection would only 404

  // Initial check shortly after launch, then poll every 6 hours.
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 5000);
  setInterval(check, 6 * 60 * 60 * 1000);
}

// Check for update (manual)
ipcMain.handle('check-for-update', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { available: !!result?.updateInfo, version: result?.updateInfo?.version };
  } catch {
    return { available: false };
  }
});

// Download update
ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Install update
ipcMain.handle('install-update', () => {
  app.isQuitting = true;
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

app.whenReady().then(() => {
  ensureDataDir();
  svcManager = new ServiceManager(app.getPath('userData'));
  createTray();
  createWindow();
  setupAutoUpdater();

  // Always start heartbeat — it will handle missing license gracefully
  const config = loadConfig();
  fileLog('[TexaCore] App ready — Config loaded');
  fileLog('[TexaCore] Config path:', CONFIG_FILE);
  fileLog('[TexaCore] License key:', config.licenseKey ? `${config.licenseKey.substring(0, 15)}... ✅` : '❌ NOT SET');
  fileLog('[TexaCore] Data dir:', DATA_DIR);
  fileLog('[TexaCore] Log file:', LOG_FILE);
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
        dbPassword: cfg.dbPassword || undefined,
        port: cfg.port || APP_PORT,
        onMigrationProgress: (step, total, name) => mainWindow?.webContents.send('migration-progress', { step, total, name }),
      });
      if (result && result.success) {
        fileLog('[AutoStart] ✅ Services started on launch');
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
        req.write(JSON.stringify({ license_key: config.licenseKey || 'TEST', hardware_id: 'DIAG_TEST' }));
        req.end();
      });
      fileLog('[Diag] ✅ Supabase reachable! Status:', testResult.status, 'Body:', testResult.body);
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
          if (primaryPath && fs.existsSync(primaryPath)) {
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
      app.exit(0);
    }
  })();
});
