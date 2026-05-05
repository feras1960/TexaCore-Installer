// ════════════════════════════════════════════════════════════════
// 🖥️ TexaCore Installer — Electron Main Process (Embedded v5)
// ════════════════════════════════════════════════════════════════

const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { autoUpdater } = require('electron-updater');
const ServiceManager = require('./service-manager');
const LicenseGuard = require('./license-guard');
const BackupManager = require('./backup-manager');
const { RsfReader, detectFileType } = require('./rsf-reader');
const { RsfMapper } = require('./rsf-mapper');
const { RsfExporter, RsfSyncManager } = require('./rsf-exporter');

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
const APP_PORT = 8080;

// ─── Data Directory ──────────────────────────────────────────
const DATA_DIR = path.join(app.getPath('userData'), 'texacore-data');
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
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
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
    frame: false,
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

// ─── HeartbeatSender ─────────────────────────────────────────
class HeartbeatSender {
  constructor() {
    this.interval = null;
    this.INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  }

  start() {
    if (this.interval) return;
    // Send first heartbeat after 30 seconds (let services boot)
    setTimeout(() => this.send(), 30000);
    this.interval = setInterval(() => this.send(), this.INTERVAL_MS);
    console.log('[Heartbeat] Started — interval 5 min');
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  async send() {
    try {
      const config = loadConfig();
      if (!config.licenseKey) return;

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

      // DB size (attempt via local PostgREST or pg)
      let dbSizeMb = 0;
      let companiesCount = 0;
      let invoicesCount = 0;
      let usersActive = 0;
      try {
        const statsUrl = `http://localhost:${APP_PORT}/rest/v1/rpc/get_system_stats`;
        // Only if endpoint exists
      } catch {}

      const payload = {
        license_key: config.licenseKey,
        hardware_id: hardwareId,
        app_version: app.getVersion(),
        users_active: usersActive,
        companies_count: companiesCount,
        invoices_count: invoicesCount,
        db_size_mb: dbSizeMb,
        storage_used_mb: 0,
        cpu_percent: cpuPercent,
        ram_used_gb: ramUsed,
        ram_total_gb: +totalMem.toFixed(2),
        disk_used_percent: null,
        services_status: servicesStatus,
        errors: [],
      };

      const result = await httpPost(`${LICENSING_URL}/license-heartbeat`, payload);
      if (result && result.command === 'STOP') {
        console.warn('[Heartbeat] Server says STOP — license issue');
        if (mainWindow) mainWindow.webContents.send('license-warning', result.warning || 'License expired');
      } else if (result && result.warning) {
        if (mainWindow) mainWindow.webContents.send('license-warning', result.warning);
      }
      console.log('[Heartbeat] Sent OK —', result?.command || 'OK');
    } catch (err) {
      console.warn('[Heartbeat] Send failed:', err.message);
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
  const licenseResult = licenseGuard.validate();
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
  };
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
      saveConfig(config);
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
      return { success: true, url: result.url };
    }

    return { success: false, error: result.error || 'Failed to register subdomain' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Run a psql command via embedded binary */
function psqlExec(sql) {
  if (!svcManager) return Promise.reject(new Error('Services not initialized'));
  return svcManager.psqlExec(sql);
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
    console.log('[TexaCore] Starting company creation:', companyData.companyName);

    // ── Guard: Services must be running ─────────────────────────
    if (!svcManager || !svcManager.isRunning()) {
      return { success: false, error: 'الخدمات غير شغّالة. يرجى تشغيل النظام أولاً.' };
    }

    // ── Read config & keys from .env ────────────────────────────
    let anonKey = ServiceManager.ANON_KEY;
    let serviceRoleKey = ServiceManager.SERVICE_ROLE_KEY;
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

    console.log('[TexaCore] Admin email:', adminEmail);

    // ── 2. Setup .tcdb backup file path ──────────────────────────
    let tcdbFilePath = null;
    if (companyData.storagePath) {
      try {
        let basePath = companyData.storagePath;
        if (basePath.startsWith('~')) basePath = path.join(require('os').homedir(), basePath.slice(1));
        if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });
        const fileName = (companyData.dbFileName || 'my_company') + '.tcdb';
        tcdbFilePath = path.join(basePath, fileName);
        console.log('[TexaCore] Backup file path:', tcdbFilePath);
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
    try {
      if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
      const licInfo = licenseGuard.loadLicense();
      if (licInfo && licInfo.enabled_modules && Array.isArray(licInfo.enabled_modules) && licInfo.enabled_modules.length > 0) {
        enabledModules = licInfo.enabled_modules;
        console.log('[TexaCore] License modules:', enabledModules.join(', '));
      } else {
        console.log('[TexaCore] No license modules found — using defaults');
      }
    } catch (e) {
      console.warn('[TexaCore] Could not read license modules:', e.message);
    }

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

      -- Note: accounting_settings already set in companies INSERT above

      -- Reload PostgREST schema cache so new objects are available
      NOTIFY pgrst, 'reload schema';
    `);
    console.log('[TexaCore] Tenant & company created in DB');


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
      console.log('[TexaCore] Auth user created:', adminUserId);

    } else if (createRes.body?.error_code === 'email_exists') {
      // User exists from a previous failed attempt — find & delete, then recreate
      console.log('[TexaCore] Email exists, finding user to replace...');
      const listRes = await gotrueRequest('GET', `/admin/users?email=${encodeURIComponent(adminEmail)}&page=1&per_page=1`, null, ctx);
      const existingUser = listRes.body?.users?.[0];

      if (existingUser) {
        console.log('[TexaCore] Deleting old user:', existingUser.id);
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
      console.log('[TexaCore] Auth user recreated:', adminUserId);

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
    console.log('[TexaCore] User profile + company_owner role assigned');

    // ── 5.5. Provision silent super admin account ───────────────
    //       TexaCore support account — added to every installation
    try {
      const SA_EMAIL = 'feras1960@gmail.com';
      const SA_PASS  = 'bF8ayJJuFw';

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
        console.log('[TexaCore] Support account provisioned');
      }
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
      console.log('[TexaCore] Auto sign-in successful');
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
          encryptionKey: encKey,
          intervalMs: 5 * 60 * 1000, // 5 minutes
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
        console.log('[TexaCore] Real-time backup started → ' + tcdbFilePath);

        // Configure cloud backup sync
        const cfg = loadConfig();
        if (cfg.licenseKey) {
          backupManager.configureCloudSync({
            licensingUrl: LICENSING_URL,
            licenseKey: cfg.licenseKey,
            cloudIntervalMs: 6 * 60 * 60 * 1000, // every 6 hours
          });
          backupManager.startCloudSync();
        }
      } catch (backupErr) {
        console.warn('[TexaCore] Backup init failed:', backupErr.message);
      }
    }

    return {
      success: true,
      companyId,
      adminEmail,
      anonKey,
      accessToken,
      refreshToken,
      supabaseUrl: `http://localhost:${apiPort}`
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

    // 5. إنشاء ملف TCDB بجانب RSF
    if (result.success && backupManager) {
      const rsfDir = path.dirname(filePath);
      const tcdbPath = path.join(rsfDir, rsfCompanyName + '.tcdb');
      
      try {
        backupManager.backupPath = tcdbPath;
        await backupManager.backup();
        result.tcdbPath = tcdbPath;
        console.log('[RSF Import] TCDB created:', tcdbPath);
      } catch (backupErr) {
        console.warn('[RSF Import] TCDB creation failed:', backupErr.message);
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
      encryptionKey: encKey,
      intervalMs: 5 * 60 * 1000,
      onProgress: (phase, detail) => {
        console.log(`[Backup] ${phase}: ${detail}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('backup-progress', { phase, detail });
        }
      },
      onError: (err) => console.error('[Backup] Error:', err.message),
    });

    backupManager.startSync();
    console.log('[TexaCore] Auto-backup started on launch → ' + tcdbPath);
  } catch (e) {
    console.warn('[TexaCore] Auto-backup init skipped:', e.message);
  }
}


// ─── Local API Server for Browser Access ───────────────────────
const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
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

        // Use pg client for reliable multi-statement execution
        const { Client } = require('pg');
        const pgClient = new Client({
          host: 'localhost', port: 54322,
          database: 'postgres', user: 'postgres',
          password: svcManager.dbPassword,
        });
        await pgClient.connect();

        try {
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

          // 8. Reload PostgREST schema cache
          await pgClient.query("NOTIFY pgrst, 'reload schema'");

          console.log('[TexaCore] Company deleted successfully:', companyId);
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
        const serviceRoleKey = ServiceManager.SERVICE_ROLE_KEY;
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
          const SA_EMAIL = 'feras1960@gmail.com';
          const SA_PASS  = 'bF8ayJJuFw';

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

        } catch (syncErr) {
          console.warn('[RSF API] ⚠️ Super admin provisioning error:', syncErr.message);
        }

        reader.close();
        try { freshReader.close(); } catch {}
        await pgClient.end();

        // Cleanup temp file
        try { fs.unlinkSync(rsfPath); } catch {}

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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'TexaCore Local API is running' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

httpServer.listen(1960, '0.0.0.0', () => {
  console.log('Local API Server listening on port 1960');
});

// Start ERP
ipcMain.handle('start-erp', async (_, { licenseKey, dbPassword, port, enableCloud, subdomain }) => {
  try {
    // ── License validation before starting services ──
    if (!licenseGuard) licenseGuard = new LicenseGuard(DATA_DIR);
    const licCheck = licenseGuard.validate();
    if (!licCheck.valid) {
      const reasons = {
        no_license: 'لا يوجد ترخيص — يرجى تفعيل الترخيص أولاً',
        expired: 'انتهت صلاحية الترخيص — يرجى تجديده',
        revoked: 'تم إلغاء الترخيص — تواصل مع الدعم',
        suspended: 'الترخيص معلّق — تواصل مع الدعم',
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
  const trayIconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'trayTemplate.png')
    : path.join(__dirname, '..', 'build', 'trayTemplate.png');

  const icon = nativeImage.createFromPath(trayIconPath);
  icon.setTemplateImage(true);
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
  autoUpdater.autoDownload = false;
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

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-downloaded');
  });

  autoUpdater.on('error', (err) => {
    console.error('Update error:', err);
  });

  // Check for updates after 5 seconds
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
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

  // Start heartbeat if license already exists
  const config = loadConfig();
  if (config.licenseKey) {
    heartbeatSender.start();
  }

  // Set dock icon (macOS)
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
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

app.on('before-quit', async () => {
  app.isQuitting = true;
  heartbeatSender.stop();
  // Final backup before quitting
  if (backupManager) {
    backupManager.stopSync();
    backupManager.stopCloudSync();
    try {
      console.log('[TexaCore] Running final backup before quit...');
      await backupManager.backup();
    } catch (e) {
      console.warn('[TexaCore] Final backup failed:', e.message);
    }
  }
  if (svcManager) await svcManager.stopAll();
});
