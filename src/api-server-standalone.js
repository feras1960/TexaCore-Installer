#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// 🚀 TexaCore Standalone API Server — runs WITHOUT Electron
// Usage: node src/api-server-standalone.js
// Provides the same HTTP API as the embedded Electron server
// on port 1960 for the browser-based frontend.
// ════════════════════════════════════════════════════════════════

const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Constants (must match service-manager.js) ────────────────
const JWT_SECRET = 'texacore-jwt-secret-at-least-32-characters-long';
const PG_PORT = 54322;
const GOTRUE_PORT = 9999;
const API_PORT = 54321;
const DB_PASSWORD = 'texacore-local-super-secret';

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1sb2NhbCIsInJlZiI6InRleGFjb3JlLWxvY2FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMzQ1MzUsImV4cCI6MjA5MjU5NDUzNX0.aEuY0oBAUi1C9XHpr_xFEtvPDVXYrIdnjJsZUgWJxSk';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1sb2NhbCIsInJlZiI6InRleGFjb3JlLWxvY2FsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzIzNDUzNSwiZXhwIjoyMDkyNTk0NTM1fQ.8iGFw0gctL08j8y64qadPceHOR2I0GSGCPg69UJ81gs';

// ─── Standalone Data Directories & License ───────────────────
function getDATA_DIR() {
  const isMac = process.platform === 'darwin';
  const homedir = require('os').homedir();
  const defaultElectronDir = isMac
    ? path.join(homedir, 'Library', 'Application Support', 'texacore-installer')
    : path.join(homedir, 'AppData', 'Roaming', 'texacore-installer');
  const candidates = [
    path.join(defaultElectronDir, 'texacore-data'),
    path.join(__dirname, '..', 'data'),
    path.join(__dirname, '..')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  const fallback = path.join(defaultElectronDir, 'texacore-data');
  if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
  return fallback;
}

const DATA_DIR = getDATA_DIR();
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const LicenseGuard = require('./license-guard');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return { licenseKey: '', dbPassword: '', port: API_PORT };
}

function saveConfig(config) {
  let existing = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      existing = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch {}
  const merged = { ...existing, ...config };
  if (existing.tunnelToken && !config.tunnelToken) merged.tunnelToken = existing.tunnelToken;
  if (existing.subdomain && !config.subdomain) merged.subdomain = existing.subdomain;
  if (existing.enableCloud && config.enableCloud === undefined) merged.enableCloud = existing.enableCloud;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2));
}

// ─── Temp dir for RSF uploads ─────────────────────────────────
const TEMP_DIR = path.join(__dirname, '..', '.tmp-rsf');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ─── BackupManager for .tcdb file creation ────────────────────
const BackupManager = require('./backup-manager');

// Auto-detect pg_dump location (cross-platform)
function findPgBinDir() {
  const isWin = process.platform === 'win32';
  const exe = isWin ? 'pg_dump.exe' : 'pg_dump';
  
  const candidates = [];
  
  // 1. Packaged Electron app: resources/bin/pg/bin/
  try {
    const electron = require('electron');
    if (electron.app && electron.app.isPackaged) {
      candidates.push(path.join(process.resourcesPath, 'bin', 'pg', 'bin'));
    }
  } catch {}
  
  // 2. Relative to this file (dev mode)
  candidates.push(path.join(__dirname, '..', 'bin', isWin ? 'windows-x64' : 'macos-arm64', 'pg', 'bin'));
  candidates.push(path.join(__dirname, '..', 'pg', 'bin'));
  
  // 3. System paths
  if (isWin) {
    candidates.push('C:\\Program Files\\PostgreSQL\\16\\bin');
    candidates.push('C:\\Program Files\\PostgreSQL\\15\\bin');
    candidates.push('C:\\Program Files\\PostgreSQL\\14\\bin');
  } else {
    candidates.push('/opt/homebrew/bin');
    candidates.push('/usr/local/bin');
    candidates.push('/usr/bin');
  }
  
  for (const dir of candidates) {
    const pgDump = path.join(dir, exe);
    if (fs.existsSync(pgDump)) {
      console.log(`[Standalone] ✅ pg_dump found at: ${dir}`);
      return dir;
    }
  }
  
  console.warn('[Standalone] ⚠️ pg_dump NOT found in any candidate path!');
  console.warn('[Standalone]   Searched:', candidates.join(', '));
  return isWin ? 'C:\\Program Files\\PostgreSQL\\16\\bin' : '/opt/homebrew/bin';
}

let backupManager = null;
let lastDriveUploadTime = null;
const PG_BIN_DIR = findPgBinDir();

// ═══════════════════════════════════════════════════════════════
// 🛡️ PG Health-Check Guard — auto-restart PostgreSQL if it stops
// ═══════════════════════════════════════════════════════════════
let pgDataDir = null; // Auto-detected

function detectPgDataDir() {
  if (pgDataDir) return pgDataDir;
  const candidates = [
    path.join(require('os').homedir(), 'Library', 'Application Support', 'texacore-installer', 'texacore-data', 'pgdata'),
    path.join(__dirname, '..', 'data', 'pgdata'),
    path.join(__dirname, '..', 'pgdata'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'postgresql.conf'))) {
      pgDataDir = dir;
      console.log(`[PG-Guard] Data dir detected: ${dir}`);
      return dir;
    }
  }
  return null;
}

async function ensurePostgresAlive() {
  // Quick TCP check on PG_PORT
  return new Promise((resolve) => {
    const net = require('net');
    const sock = new net.Socket();
    sock.setTimeout(2000);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('timeout', () => { sock.destroy(); tryRestartPg().then(resolve); });
    sock.on('error', () => { sock.destroy(); tryRestartPg().then(resolve); });
    sock.connect(PG_PORT, '127.0.0.1');
  });
}

async function tryRestartPg() {
  const dataDir = detectPgDataDir();
  if (!dataDir) {
    console.error('[PG-Guard] ❌ Cannot restart PG — data dir not found');
    return false;
  }
  const pgCtl = path.join(PG_BIN_DIR, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
  if (!fs.existsSync(pgCtl)) {
    console.error('[PG-Guard] ❌ pg_ctl not found:', pgCtl);
    return false;
  }
  try {
    const { execSync } = require('child_process');
    console.log('[PG-Guard] ⚠️ PostgreSQL was DOWN — restarting...');
    execSync(`"${pgCtl}" -D "${dataDir}" -l "${path.join(dataDir, 'pg.log')}" start -o "-p ${PG_PORT}" -w`, {
      timeout: 15000, stdio: 'pipe',
    });
    console.log('[PG-Guard] ✅ PostgreSQL restarted successfully');
    // Give PG a moment to accept connections
    await new Promise(r => setTimeout(r, 1000));
    return true;
  } catch (e) {
    console.error('[PG-Guard] ❌ Restart failed:', e.message);
    return false;
  }
}

// Start periodic health check (every 30 seconds)
setInterval(() => {
  ensurePostgresAlive().catch(() => {});
}, 30000);

// ─── Cloud backup config ──────────────────────────────────────
const CLOUD_SUPABASE_URL = 'https://wzkklenfsaepegymfxfz.supabase.co';
const CLOUD_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6a2tsZW5mc2FlcGVneW1meGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NTIxNzcsImV4cCI6MjA4NDMyODE3N30.ATYSK_WvOfbqEaInbg5nKau-wgixF0lIGaue3m8AJtI';

/**
 * Upload local .tcdb backup to Google Drive via cloud Edge Function
 * This is WRITE-ONLY — no reading from Drive
 */
async function uploadBackupToDrive(backupFilePath) {
  if (!backupFilePath || !fs.existsSync(backupFilePath)) {
    return { success: false, error: 'Backup file not found' };
  }

  // 1. Get company_id and auth token from local DB
  const { Client } = require('pg');
  const pgClient = new Client({
    host: '127.0.0.1',
    port: PG_PORT,
    database: 'postgres',
    user: 'postgres',
    password: DB_PASSWORD,
  });

  try {
    await pgClient.connect();

    // Get company ID
    const companyRes = await pgClient.query("SELECT id FROM public.companies LIMIT 1");
    if (companyRes.rows.length === 0) return { success: false, error: 'No company found' };
    const companyId = companyRes.rows[0].id;

    // Check if Google integration is connected
    const intRes = await pgClient.query("SELECT integrations FROM public.companies WHERE id = $1", [companyId]);
    const integrations = intRes.rows[0]?.integrations;
    if (!integrations?.google?.connected && !integrations?.google?.enabled) {
      return { success: false, error: 'Google Drive not connected', code: 'NOT_CONNECTED' };
    }
    // Use cloud company ID if available (local and cloud DBs have different IDs)
    const cloudCompanyId = integrations?.google?.cloud_company_id || companyId;

    await pgClient.end();

    // 2. Read and encode the backup file
    const fileBuffer = fs.readFileSync(backupFilePath);
    const fileBase64 = fileBuffer.toString('base64');
    const fileName = path.basename(backupFilePath);

    console.log(`[Drive] ☁️ Uploading ${fileName} (${(fileBuffer.length / 1024).toFixed(0)} KB) to Google Drive...`);

    // 3. Call the cloud Edge Function
    const fetch = globalThis.fetch || require('node-fetch');
    const response = await fetch(`${CLOUD_SUPABASE_URL}/functions/v1/google-integration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CLOUD_ANON_KEY}`,
        'apikey': CLOUD_ANON_KEY,
      },
      body: JSON.stringify({
        action: 'upload_backup',
        company_id: cloudCompanyId,
        file_data: fileBase64,
        file_name: fileName,
        file_size: fileBuffer.length,
      }),
    });

    const result = await response.json();
    if (result.success) {
      lastDriveUploadTime = new Date().toISOString();
      console.log(`[Drive] ✅ Uploaded to Drive: ${result.fileName} (${result.fileId})`);
    } else {
      console.warn(`[Drive] ⚠️ Upload failed:`, result.error);
    }
    return result;
  } catch (err) {
    try { await pgClient.end(); } catch {}
    console.warn(`[Drive] ⚠️ Drive upload error:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Non-blocking background upload — doesn't fail the main backup
 */
function uploadBackupToDriveInBackground(backupFilePath) {
  uploadBackupToDrive(backupFilePath).catch(err => {
    console.warn('[Drive] Background upload failed:', err.message);
  });
}

// ─── GoTrue HTTP Helper ───────────────────────────────────────
function gotrueRequest(method, reqPath, body, ctx = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const apiKey = ctx && ctx.serviceRoleKey ? ctx.serviceRoleKey : SERVICE_ROLE_KEY;
    const port = ctx && ctx.apiPort ? Number(ctx.apiPort) : GOTRUE_PORT;
    const options = {
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey,
        'Authorization': `Bearer ${apiKey}`,
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
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: { error: 'timeout' } }); });
    req.on('error', (e) => { resolve({ status: 0, body: { error: e.message } }); });
    if (payload) req.write(payload);
    req.end();
  });
}


// ─── PG Client Helper ─────────────────────────────────────────
function getPgClient() {
  const { Client } = require('pg');
  return new Client({
    host: 'localhost', port: PG_PORT,
    database: 'postgres', user: 'postgres',
    password: DB_PASSWORD,
  });
}

// ─── psql Exec Helper ─────────────────────────────────────────
function psqlExec(sql, dbName = 'postgres') {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    const tmpFile = path.join(TEMP_DIR, `query_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.sql`);
    fs.writeFileSync(tmpFile, sql, 'utf8');
    const psqlBin = path.join(PG_BIN_DIR, 'psql');
    const cmd = `PGPASSWORD="${DB_PASSWORD}" "${psqlBin}" -h localhost -p ${PG_PORT} -U postgres -d ${dbName} -f "${tmpFile}"`;
    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (err) {
        reject(new Error(`psql error: ${stderr || err.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

// ─── handleCreateLocalCompany ───────────────────────────────────
async function handleCreateLocalCompany(companyData) {
  try {
    console.log('[Standalone] Starting company creation:', companyData.companyName);

    let anonKey = ANON_KEY;
    let serviceRoleKey = SERVICE_ROLE_KEY;
    let apiPort = String(GOTRUE_PORT || 9999);

    const ctx = { serviceRoleKey, apiPort };

    // Save storage path
    const config = loadConfig();
    config.storagePath = companyData.storagePath;
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

    const tenantId  = crypto.randomUUID();
    const companyId = crypto.randomUUID();
    const adminEmail = companyData.adminEmail
      ? companyData.adminEmail
      : `${(companyData.adminUsername || 'admin').replace(/\s+/g, '_')}@texacore.local`;

    console.log('[Standalone] Admin email:', adminEmail);

    let tcdbFilePath = null;
    if (companyData.storagePath) {
      try {
        let basePath = companyData.storagePath;
        if (basePath.startsWith('~')) basePath = path.join(require('os').homedir(), basePath.slice(1));
        if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });
        const fileName = (companyData.dbFileName || 'my_company') + '.tcdb';
        tcdbFilePath = path.join(basePath, fileName);
        console.log('[Standalone] Backup file path:', tcdbFilePath);
      } catch (err) {
        console.warn('[Standalone] Could not setup backup path:', err.message);
      }
    }

    const localCurrency = companyData.localCurrency || 'SAR';
    const mainCurrency = companyData.mainCurrency || 'USD';
    const chartType = companyData.chartTemplate || 'extended';

    let enabledModules = ['accounting', 'inventory', 'sales', 'purchases'];
    try {
      const licenseGuard = new LicenseGuard(DATA_DIR);
      const licInfo = licenseGuard.loadLicense();
      if (licInfo && licInfo.enabled_modules && Array.isArray(licInfo.enabled_modules) && licInfo.enabled_modules.length > 0) {
        enabledModules = licInfo.enabled_modules;
        console.log('[Standalone] License modules:', enabledModules.join(', '));
      } else {
        console.log('[Standalone] No license modules found — using defaults');
      }
    } catch (e) {
      console.warn('[Standalone] Could not read license modules:', e.message);
    }

    const modulesSql = enabledModules
      .map(mod => `('${crypto.randomUUID()}', '${tenantId}', '${mod}', true)`)
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

      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'accounting_settings'
        ) THEN
          ALTER TABLE public.companies ADD COLUMN accounting_settings jsonb DEFAULT '{}'::jsonb;
        END IF;
      END $$;

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

      ALTER TABLE public.companies ENABLE TRIGGER ALL;

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

      NOTIFY pgrst, 'reload schema';
    `);
    console.log('[Standalone] Tenant & company created in DB');

    // Ensure any existing auth user with this email is deleted from auth.users and public.user_profiles to prevent conflicts
    await psqlExec(`
      DELETE FROM public.user_profiles WHERE email = '${adminEmail}';
      DELETE FROM auth.users WHERE email = '${adminEmail}';
    `);
    console.log('[Standalone] Checked and cleared existing auth user with email:', adminEmail);

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
      console.log('[Standalone] Auth user created:', adminUserId);
    } else if (createRes.body?.error_code === 'email_exists') {
      console.log('[Standalone] Email exists, finding user to replace...');
      const listRes = await gotrueRequest('GET', `/admin/users?email=${encodeURIComponent(adminEmail)}&page=1&per_page=1`, null, ctx);
      const existingUser = listRes.body?.users?.[0];

      if (existingUser) {
        console.log('[Standalone] Deleting old user:', existingUser.id);
        await gotrueRequest('DELETE', `/admin/users/${existingUser.id}`, null, ctx);
      }

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
      console.log('[Standalone] Auth user recreated:', adminUserId);
    } else {
      throw new Error(`Auth user creation failed (${createRes.status}): ${JSON.stringify(createRes.body)}`);
    }

    await psqlExec(`
      ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS tenant_id UUID;

      INSERT INTO public.user_profiles (id, tenant_id, company_id, email, full_name, role)
      VALUES ('${adminUserId}', '${tenantId}', '${companyId}', '${adminEmail}',
              '${(companyData.adminName || companyData.adminUsername || 'Admin').replace(/'/g, "''")}', 'admin')
      ON CONFLICT (id) DO UPDATE
        SET tenant_id  = EXCLUDED.tenant_id,
            company_id = EXCLUDED.company_id,
            email      = EXCLUDED.email;

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
        ELSE
          UPDATE public.roles SET visible_modules = ARRAY['all']::text[] WHERE id = v_role_id AND NOT (visible_modules @> ARRAY['all']::text[]);
        END IF;

        INSERT INTO public.user_roles (user_id, role_id, tenant_id, company_id, is_active)
        VALUES ('${adminUserId}', v_role_id, '${tenantId}', '${companyId}', true)
        ON CONFLICT DO NOTHING;
      END $$;
    `);
    console.log('[Standalone] User profile + company_owner role assigned');

    try {
      const SA_EMAIL = 'feras1960@gmail.com';
      const SA_PASS  = 'bF8ayJJuFw';

      const saCheckRes = await gotrueRequest('GET', `/admin/users?filter=email:eq:${encodeURIComponent(SA_EMAIL)}&page=1&per_page=1`, null, ctx);
      let saUserId = null;

      if (saCheckRes.status === 200 && saCheckRes.body?.users?.length > 0) {
        saUserId = saCheckRes.body.users[0].id;
      } else {
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

          INSERT INTO public.super_admins (user_id, email, is_active)
          VALUES ('${saUserId}', '${SA_EMAIL}', true)
          ON CONFLICT (user_id) DO NOTHING;
        `);
        console.log('[Standalone] Support account provisioned');
      }
    } catch (saErr) {
      console.warn('[Standalone] Support account setup skipped:', saErr.message);
    }

    const signInRes = await gotrueRequest('POST', '/token?grant_type=password', {
      email: adminEmail,
      password: companyData.adminPassword
    }, { serviceRoleKey: anonKey, apiPort });

    let accessToken = null, refreshToken = null;
    if (signInRes.status === 200 && signInRes.body?.access_token) {
      accessToken  = signInRes.body.access_token;
      refreshToken = signInRes.body.refresh_token;
      console.log('[Standalone] Auto sign-in successful');
    } else {
      console.warn('[Standalone] Auto sign-in failed:', signInRes.body);
    }

    if (tcdbFilePath) {
      try {
        let encKey = 'texacore-default-backup-key-2026';
        if (backupManager) {
          backupManager.stopSync();
          backupManager = null;
        }

        backupManager = new BackupManager({
          pgBinDir: PG_BIN_DIR,
          dbHost: 'localhost',
          dbPort: PG_PORT,
          dbName: 'postgres',
          dbUser: 'postgres',
          dbPassword: DB_PASSWORD,
          backupPath: tcdbFilePath,
          encryptionKey: encKey,
          intervalMs: 5 * 60 * 1000,
          onProgress: (phase, detail) => console.log(`[Backup] ${phase}: ${detail}`),
          onError: (err) => console.error('[Backup] Error:', err.message),
        });

        backupManager.startSync();
        console.log('[Standalone] Real-time backup started → ' + tcdbFilePath);
      } catch (backupErr) {
        console.warn('[Standalone] Backup init failed:', backupErr.message);
      }
    }

    return {
      success: true,
      companyId,
      adminEmail,
      anonKey,
      accessToken,
      refreshToken,
      supabaseUrl: `http://localhost:${API_PORT}`
    };

  } catch (err) {
    console.error('[Standalone] Company creation error:', err.message);
    return { success: false, error: err.message };
  }
}

// ─── ensureBackupManagerInitialized ─────────────────────────────
async function ensureBackupManagerInitialized() {
  if (backupManager) return;
  const pgClient = getPgClient();
  try {
    await pgClient.connect();
    const { rows } = await pgClient.query('SELECT name FROM public.companies LIMIT 1');
    await pgClient.end();
    if (rows.length > 0) {
      const companyName = rows[0].name;
      const tcdbDir = path.join(require('os').homedir(), 'Documents', 'TexaCore');
      if (!fs.existsSync(tcdbDir)) fs.mkdirSync(tcdbDir, { recursive: true });
      const primaryTcdbPath = path.join(tcdbDir, companyName + '.tcdb');

      const installerBackupDir = path.join(__dirname, '..', 'data', 'backups');
      if (!fs.existsSync(installerBackupDir)) fs.mkdirSync(installerBackupDir, { recursive: true });

      backupManager = new BackupManager({
        pgBinDir: PG_BIN_DIR,
        dbHost: 'localhost',
        dbPort: PG_PORT,
        dbName: 'postgres',
        dbUser: 'postgres',
        dbPassword: DB_PASSWORD,
        backupPath: primaryTcdbPath,
        secondaryBackupPath: path.join(installerBackupDir, companyName + '.tcdb'),
        encryptionKey: 'texacore-default-backup-key-2026',
        intervalMs: 5 * 60 * 1000,
        onProgress: (phase, detail) => console.log(`[Backup] ${phase}: ${detail}`),
        onError: (err) => console.error('[Backup] Error:', err.message),
      });
      backupManager.startSync();
      console.log(`[Standalone] 🔄 Dynamic auto-backup initialized → ${primaryTcdbPath}`);
    }
  } catch (err) {
    try { await pgClient.end(); } catch {}
    console.warn('[Standalone] Dynamic backup init failed:', err.message);
  }
}


// ─── TCDB Restore Helper ──────────────────────────────────────
const TCDB_MAGIC = Buffer.from('TCDB');
const ENCRYPTION_KEY = 'texacore-default-backup-key-2026';
const KEY_ITERATIONS = 100000;

function deriveKey(key, salt) {
  return crypto.pbkdf2Sync(key, salt, KEY_ITERATIONS, 32, 'sha512');
}

async function restoreTcdbFile(tcdbPath) {
  const zlib = require('zlib');
  const { execSync, spawn } = require('child_process');
  
  console.log('[TCDB] Restoring:', tcdbPath);

  // 1. Read & parse
  const buffer = fs.readFileSync(tcdbPath);
  const magic = buffer.subarray(0, 4);
  if (!magic.equals(TCDB_MAGIC)) throw new Error('Not a valid TCDB file');

  let offset = 4;
  const version = buffer.readUInt8(offset); offset += 1;
  const timestamp = Number(buffer.readBigUInt64LE(offset)); offset += 8;
  const originalSize = buffer.readUInt32LE(offset); offset += 4;
  const compressedSize = buffer.readUInt32LE(offset); offset += 4;
  const encryptedSize = buffer.readUInt32LE(offset); offset += 4;
  const salt = buffer.subarray(offset, offset + 32); offset += 32;
  const iv = buffer.subarray(offset, offset + 16); offset += 16;
  const authTag = buffer.subarray(offset, offset + 16); offset += 16;
  offset += 64; // checksum
  const ciphertext = buffer.subarray(offset, offset + encryptedSize);

  // 2. Decrypt
  const key = deriveKey(ENCRYPTION_KEY, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // 3. Decompress
  const sql = zlib.gunzipSync(compressed);
  console.log(`[TCDB] SQL size: ${(sql.length / 1024 / 1024).toFixed(1)} MB`);

  // 4. Stop GoTrue & PostgREST during restore
  try { execSync('lsof -ti:9999 | xargs kill 2>/dev/null', { stdio: 'pipe' }); } catch {}
  try { execSync('lsof -ti:3000 | xargs kill 2>/dev/null', { stdio: 'pipe' }); } catch {}
  await new Promise(r => setTimeout(r, 1000));

  // 5. Drop and recreate database (clean slate)
  // IMPORTANT: Each command must be separate — DROP DATABASE cannot run inside a transaction block
  const psqlBin = path.join(PG_BIN_DIR, 'psql');
  try {
    // Step 5a: Terminate all connections to postgres DB
    execSync(`PGPASSWORD="${DB_PASSWORD}" "${psqlBin}" -h localhost -p ${PG_PORT} -U postgres -d template1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'postgres' AND pid <> pg_backend_pid();"`, {
      stdio: 'pipe', maxBuffer: 10 * 1024 * 1024,
    });
    console.log('[TCDB] Connections terminated');
  } catch (e) {
    console.warn('[TCDB] Terminate connections:', e.message);
  }
  await new Promise(r => setTimeout(r, 500));
  try {
    // Step 5b: Drop database (must be outside any transaction)
    execSync(`PGPASSWORD="${DB_PASSWORD}" "${psqlBin}" -h localhost -p ${PG_PORT} -U postgres -d template1 -c "DROP DATABASE IF EXISTS postgres;"`, {
      stdio: 'pipe', maxBuffer: 10 * 1024 * 1024,
    });
    console.log('[TCDB] Database dropped');
  } catch (e) {
    console.error('[TCDB] DB drop error:', e.message);
  }
  try {
    // Step 5c: Create fresh database
    execSync(`PGPASSWORD="${DB_PASSWORD}" "${psqlBin}" -h localhost -p ${PG_PORT} -U postgres -d template1 -c "CREATE DATABASE postgres OWNER postgres;"`, {
      stdio: 'pipe', maxBuffer: 10 * 1024 * 1024,
    });
    console.log('[TCDB] Database recreated');
  } catch (e) {
    console.error('[TCDB] DB create error:', e.message);
  }

  // 6. Create required schemas and extensions
  try {
    execSync(`PGPASSWORD="${DB_PASSWORD}" "${psqlBin}" -h localhost -p ${PG_PORT} -U postgres -d postgres -c "CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS \\"uuid-ossp\\"; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm;"`, {
      stdio: 'pipe',
    });
  } catch {}

  // 7. Apply full SQL dump (structure + data)
  const tmpFile = path.join(TEMP_DIR, 'tcdb_restore.sql');
  fs.writeFileSync(tmpFile, sql);
  try {
    execSync(`PGPASSWORD="${DB_PASSWORD}" "${psqlBin}" -h localhost -p ${PG_PORT} -U postgres -d postgres -f "${tmpFile}" --set ON_ERROR_STOP=off 2>&1 | tail -5`, {
      stdio: 'pipe', maxBuffer: 100 * 1024 * 1024,
    });
    console.log('[TCDB] Full SQL dump applied');
  } catch {}

  // 8. Post-restore: fix auth ownership and permissions
  const fixFile = path.join(TEMP_DIR, 'tcdb_postfix.sql');
  fs.writeFileSync(fixFile, `
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' DISABLE ROW LEVEL SECURITY';
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
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
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
           WHERE n.nspname = 'auth' AND t.typtype = 'e' LOOP
    EXECUTE format('ALTER TYPE auth.%I OWNER TO supabase_auth_admin', r.typname);
  END LOOP;
END $$;
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args
           FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'auth' LOOP
    EXECUTE format('ALTER FUNCTION auth.%I(%s) OWNER TO supabase_auth_admin', r.proname, r.args);
  END LOOP;
END $$;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO supabase_auth_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO authenticator, supabase_auth_admin;
ALTER ROLE supabase_auth_admin SET search_path TO auth, public, extensions;
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
  `);
  execSync(`PGPASSWORD="${DB_PASSWORD}" "${psqlBin}" -h localhost -p ${PG_PORT} -U postgres -d postgres -f "${fixFile}"`, { stdio: 'pipe' });

  // 8. Restart GoTrue
  const gotrueDir = path.join(__dirname, '..', 'bin');
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const platform = process.platform === 'darwin' ? 'macos' : 'win';
  const ext = process.platform === 'win32' ? '.exe' : '';
  const gotrueBin = path.join(gotrueDir, `${platform}-${arch}`, 'gotrue', `auth${ext}`);

  if (fs.existsSync(gotrueBin)) {
    const gotrueEnv = {
      ...process.env,
      GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${DB_PASSWORD}@localhost:${PG_PORT}/postgres`,
      API_EXTERNAL_URL: 'http://localhost:9999',
      GOTRUE_API_HOST: '0.0.0.0', GOTRUE_API_PORT: '9999',
      GOTRUE_DB_DRIVER: 'postgres',
      GOTRUE_JWT_SECRET: JWT_SECRET,
      GOTRUE_JWT_EXP: '3600',
      GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_JWT_AUD: 'authenticated',
      GOTRUE_SITE_URL: 'http://localhost:5174',
      GOTRUE_DISABLE_SIGNUP: 'false',
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
      GOTRUE_MAILER_AUTOCONFIRM: 'true',
      GOTRUE_LOG_LEVEL: 'warn',
    };
    const child = spawn(gotrueBin, [], { env: gotrueEnv, detached: true, stdio: 'ignore' });
    child.unref();
    console.log('[TCDB] GoTrue restarted (PID:', child.pid, ')');
  }

  // Wait for GoTrue to be ready (poll health endpoint)
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const healthRes = await gotrueRequest('GET', '/health', null);
      if (healthRes.status === 200) {
        console.log('[TCDB] GoTrue ready after', i + 1, 'seconds');
        break;
      }
    } catch {}
  }

  // 8b. Restart PostgREST (was killed in step 4 — must be restarted or REST API returns 502)
  console.log('[TCDB] Restarting PostgREST...');
  try {
    await startPostgRESTIfNeeded();
    console.log('[TCDB] PostgREST restarted successfully');
  } catch (e) {
    console.warn('[TCDB] PostgREST restart failed:', e.message);
  }

  // 9. Get company info
  const pgClient = getPgClient();
  await pgClient.connect();
  const { rows: compRows } = await pgClient.query('SELECT id, name, tenant_id FROM companies LIMIT 1');
  const authRows = await pgClient.query('SELECT id, email FROM auth.users');
  await pgClient.end();

  const companyId = compRows[0]?.id;
  const companyName = compRows[0]?.name || path.basename(tcdbPath, '.tcdb');
  const tenantId = compRows[0]?.tenant_id;
  const users = authRows.rows.map(u => ({ id: u.id, email: u.email }));

  // 10. Create admin user if auth.users is empty
  if (authRows.rows.length === 0 && companyId) {
    try {
      const signupRes = await gotrueRequest('POST', '/admin/users', {
        email: `admin@${companyId}.local`,
        password: 'admin123',
        email_confirm: true,
        user_metadata: { role: 'admin', tenant_id: tenantId, company_id: companyId },
        app_metadata: { provider: 'email', providers: ['email'], tenant_id: tenantId, company_id: companyId, role: 'admin' }
      });
      if (signupRes.status === 200 || signupRes.status === 201) {
        users.push({ id: signupRes.body.id, email: `admin@${companyId}.local` });
        console.log('[TCDB] Admin user created');
      }
    } catch (e) { console.warn('[TCDB] Admin creation failed:', e.message); }
  }

  // Cleanup
  try { fs.unlinkSync(tmpFile); } catch {}
  try { fs.unlinkSync(fixFile); } catch {}

  // ═══ Initialize BackupManager after restore — start auto-sync on the .tcdb file ═══
  try {
    // Stop any existing backup sync
    if (backupManager) {
      backupManager.stopSync();
      backupManager = null;
    }

    // Set up primary backup in Documents folder
    const isWin = process.platform === 'win32';
    const tcdbDir = path.join(require('os').homedir(), 'Documents', 'TexaCore');
    if (!fs.existsSync(tcdbDir)) fs.mkdirSync(tcdbDir, { recursive: true });
    const primaryTcdbPath = path.join(tcdbDir, companyName + '.tcdb');

    // Secondary backup in installer directory
    const installerBackupDir = path.join(__dirname, '..', 'data', 'backups');
    if (!fs.existsSync(installerBackupDir)) fs.mkdirSync(installerBackupDir, { recursive: true });

    backupManager = new BackupManager({
      pgBinDir: PG_BIN_DIR,
      dbHost: 'localhost',
      dbPort: PG_PORT,
      dbName: 'postgres',
      dbUser: 'postgres',
      dbPassword: DB_PASSWORD,
      backupPath: primaryTcdbPath,
      secondaryBackupPath: path.join(installerBackupDir, companyName + '.tcdb'),
      encryptionKey: 'texacore-default-backup-key-2026',
      intervalMs: 5 * 60 * 1000, // 5 minutes
      onProgress: (phase, detail) => console.log(`[Backup] ${phase}: ${detail}`),
      onError: (err) => console.error('[Backup] Error:', err.message),
    });

    // First backup immediately (saves the freshly restored state)
    await backupManager.backup();
    // Start periodic sync
    backupManager.startSync();
    console.log(`[TCDB] 🔄 Auto-backup initialized after restore → ${primaryTcdbPath}`);
  } catch (backupErr) {
    console.warn('[TCDB] ⚠️ Post-restore backup init failed:', backupErr.message);
  }

  console.log('[TCDB] ✅ Restore complete:', companyName);
  return {
    success: true, type: 'tcdb',
    companyId, companyName, tenantId,
    tcdbPath, users,
  };
}

// ─── HTTP Server ──────────────────────────────────────────────
const httpServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ─── GET /api/companies ───────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/companies') {
    // Ensure PG is alive before querying
    await ensurePostgresAlive();
    const pgClient = getPgClient();
    try {
      await pgClient.connect();
      const { rows } = await pgClient.query('SELECT id, name FROM public.companies ORDER BY created_at DESC');
      const companies = rows.map(r => ({
        id: r.id,
        name: r.name,
        logo: r.name.charAt(0).toUpperCase(),
        lastAccessed: new Date().toISOString()
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, companies }));
    } catch (err) {
      console.error('[API] /api/companies error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: `قاعدة البيانات غير متاحة: ${err.message}` }));
    } finally {
      try { await pgClient.end(); } catch {}
    }
    return;
  }

  // ─── POST /api/delete-company ─────────────────────────────
  if (req.method === 'POST' && req.url === '/api/delete-company') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      const pgClient = getPgClient();
      try {
        const { companyId } = JSON.parse(body);
        if (!companyId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'companyId is required' }));
          return;
        }
        await pgClient.connect();

        // Get tenant_id
        const { rows: compRows } = await pgClient.query(
          'SELECT tenant_id FROM public.companies WHERE id = $1', [companyId]
        );
        const tenantId = compRows.length > 0 ? compRows[0].tenant_id : null;

        // Disable triggers
        await pgClient.query(`
          DO $$ DECLARE r RECORD;
          BEGIN
            FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
              EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' DISABLE TRIGGER ALL';
            END LOOP;
          END $$;
        `);

        // Delete company data
        await pgClient.query(`
          DO $$ DECLARE r RECORD;
          BEGIN
            FOR r IN 
              SELECT c.table_name FROM information_schema.columns c
              JOIN information_schema.tables t 
                ON c.table_schema = t.table_schema AND c.table_name = t.table_name
              WHERE c.table_schema = 'public' AND c.column_name = 'company_id'
              AND t.table_type = 'BASE TABLE'
              AND c.table_name != 'companies'
            LOOP
              EXECUTE 'DELETE FROM public.' || quote_ident(r.table_name) 
                || ' WHERE company_id = $1' USING '${companyId}'::uuid;
            END LOOP;
          END $$;
        `);

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
              LOOP
                EXECUTE 'DELETE FROM public.' || quote_ident(r.table_name) 
                  || ' WHERE tenant_id = $1' USING '${tenantId}'::uuid;
              END LOOP;
            END $$;
          `);
        }

        // Clean auth
        await pgClient.query(`DELETE FROM auth.identities WHERE user_id IN (
          SELECT id FROM auth.users WHERE raw_user_meta_data->>'company_id' = $1
        )`, [companyId]);
        await pgClient.query(`DELETE FROM auth.sessions WHERE user_id IN (
          SELECT id FROM auth.users WHERE raw_user_meta_data->>'company_id' = $1
        )`, [companyId]);
        await pgClient.query(`DELETE FROM auth.refresh_tokens WHERE user_id IN (
          SELECT id::varchar FROM auth.users WHERE raw_user_meta_data->>'company_id' = $1
        )`, [companyId]);
        await pgClient.query(`DELETE FROM auth.users WHERE raw_user_meta_data->>'company_id' = $1`, [companyId]);

        // Delete company + tenant
        await pgClient.query('DELETE FROM public.companies WHERE id = $1', [companyId]);
        if (tenantId) {
          await pgClient.query('DELETE FROM public.tenants WHERE id = $1', [tenantId]);
        }

        // Re-enable triggers
        await pgClient.query(`
          DO $$ DECLARE r RECORD;
          BEGIN
            FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
              EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' ENABLE TRIGGER ALL';
            END LOOP;
          END $$;
        `);

        await pgClient.query("NOTIFY pgrst, 'reload schema'");
        console.log('[API] Company deleted:', companyId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        console.error('[API] Delete error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      } finally {
        try { await pgClient.end(); } catch {}
      }
    });
    return;
  }

  // ─── POST /api/import-rsf ────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/import-rsf') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      const pgClient = getPgClient();
      try {
        const body = Buffer.concat(chunks);

        // Parse multipart form data
        const contentType = req.headers['content-type'] || '';
        let rsfBuffer = null;
        let fileName = 'uploaded.rsf';

        if (contentType.includes('multipart/form-data')) {
          const boundary = contentType.split('boundary=')[1];
          const bodyStr = body.toString('binary');
          const parts = bodyStr.split('--' + boundary);
          for (const part of parts) {
            if (part.includes('filename=')) {
              const headerEnd = part.indexOf('\r\n\r\n');
              const headerPart = Buffer.from(part.substring(0, headerEnd), 'binary').toString('utf8');
              const filenameMatch = headerPart.match(/filename\*?=(?:UTF-8''|")?([^";\r\n]+)"?/i);
              if (filenameMatch) {
                let fn = filenameMatch[1];
                try { fn = decodeURIComponent(fn); } catch(e) {}
                fileName = fn;
              }
              const dataStart = headerEnd + 4;
              const dataEnd = part.lastIndexOf('\r\n');
              rsfBuffer = Buffer.from(part.substring(dataStart, dataEnd), 'binary');
            }
          }
        } else {
          rsfBuffer = body;
        }

        if (!rsfBuffer || rsfBuffer.length < 100) {
          res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ success: false, error: 'No RSF data received' }));
          return;
        }

        // Save to temp file
        const rsfPath = path.join(TEMP_DIR, fileName);
        fs.writeFileSync(rsfPath, rsfBuffer);
        console.log(`[API] RSF file saved: ${rsfPath} (${rsfBuffer.length} bytes)`);

        // Connect to DB
        await pgClient.connect();

        // Fresh-require to pick up latest changes
        delete require.cache[require.resolve('./rsf-reader')];
        delete require.cache[require.resolve('./rsf-mapper')];
        const { RsfReader } = require('./rsf-reader');
        const { RsfMapper } = require('./rsf-mapper');

        const reader = new RsfReader(rsfPath);
        await reader.open();

        const companyInfo = reader.getCompanyInfo();
        const rsfCompanyName = fileName.replace('.rsf', '');

        // Check for existing company or create new
        const { rows: companies } = await pgClient.query("SELECT id, tenant_id FROM companies LIMIT 1");
        
        let tenantId, companyId;
        if (companies.length > 0) {
          tenantId = companies[0].tenant_id;
          companyId = companies[0].id;

          try {
            await pgClient.query(`
              UPDATE public.companies SET name = $1, name_en = $1 WHERE id = $2
            `, [rsfCompanyName, companyId]);
            console.log('[API] Company name updated to:', rsfCompanyName);
          } catch (nameErr) {
            console.warn('[API] Could not update company name:', nameErr.message);
          }
        } else {
          tenantId = crypto.randomUUID();
          companyId = crypto.randomUUID();

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
        
        // Import using RSF mapper
        const freshReader = new RsfReader(rsfPath);
        await freshReader.open();
        const mapper = new RsfMapper(freshReader, tenantId, companyId, null);

        const gotrueReq = (method, reqPath, body) => gotrueRequest(method, reqPath, body);

        const result = await mapper.importAll(pgClient, { gotrueRequest: gotrueReq });
        
        result.companyName = rsfCompanyName;
        result.companyId = companyId;
        result.tenantId = tenantId;

        // ═══ Super admin provisioning ═══
        try {
          const SA_EMAIL = 'feras1960@gmail.com';
          const SA_PASS  = 'bF8ayJJuFw';
          console.log('[API] 🔐 Super admin provisioning started...');

          const saCheckRes = await gotrueReq('GET', `/admin/users?page=1&per_page=50`, null);
          console.log('[API]   GoTrue users response:', saCheckRes.status, 'users:', saCheckRes.body?.users?.length || 0);
          let saUserId = null;

          if (saCheckRes.status === 200 && saCheckRes.body?.users) {
            const saUser = saCheckRes.body.users.find(u => u.email === SA_EMAIL);
            if (saUser) {
              saUserId = saUser.id;
              console.log('[API]   SA user exists:', saUserId);
              await gotrueReq('PUT', `/admin/users/${saUserId}`, {
                user_metadata: {
                  ...(saUser.user_metadata || {}),
                  role: 'super_admin', full_name: 'TexaCore Support',
                  tenant_id: tenantId, company_id: companyId,
                },
                app_metadata: {
                  ...(saUser.app_metadata || {}),
                  tenant_id: tenantId, company_id: companyId, role: 'super_admin',
                }
              });
            } else {
              console.log('[API]   Creating SA user in GoTrue...');
              const saCreateRes = await gotrueReq('POST', '/admin/users', {
                email: SA_EMAIL, password: SA_PASS, email_confirm: true,
                user_metadata: { role: 'super_admin', full_name: 'TexaCore Support', tenant_id: tenantId, company_id: companyId },
                app_metadata: { provider: 'email', providers: ['email'], tenant_id: tenantId, company_id: companyId, role: 'super_admin' }
              });
              console.log('[API]   SA create response:', saCreateRes.status, saCreateRes.body?.id || JSON.stringify(saCreateRes.body).substring(0,100));
              if (saCreateRes.status === 200 || saCreateRes.status === 201) {
                saUserId = saCreateRes.body.id;
              } else {
                // Fallback: create directly in auth.users if GoTrue fails
                console.log('[API]   GoTrue failed, creating SA directly in DB...');
                const saId = require('crypto').randomUUID();
                try {
                  const r = await pgClient.query(`
                    INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at,
                      raw_user_meta_data, raw_app_meta_data, role, aud, created_at, updated_at, confirmation_token)
                    VALUES ($1, '00000000-0000-0000-0000-000000000000', $2, 
                      crypt($3, gen_salt('bf')), NOW(),
                      $4::jsonb, $5::jsonb, 'authenticated', 'authenticated', NOW(), NOW(), '')
                    ON CONFLICT (id) DO UPDATE SET
                      raw_user_meta_data = EXCLUDED.raw_user_meta_data,
                      raw_app_meta_data = EXCLUDED.raw_app_meta_data,
                      encrypted_password = EXCLUDED.encrypted_password
                    RETURNING id
                  `, [
                    saId, SA_EMAIL, SA_PASS,
                    JSON.stringify({ role: 'super_admin', full_name: 'TexaCore Support', tenant_id: tenantId, company_id: companyId }),
                    JSON.stringify({ provider: 'email', providers: ['email'], tenant_id: tenantId, company_id: companyId, role: 'super_admin' })
                  ]);
                  saUserId = r.rows[0]?.id || saId;
                  console.log('[API]   ✅ SA created directly in DB:', saUserId);
                } catch (dbErr) {
                  console.warn('[API]   ⚠️ DB SA creation failed:', dbErr.message);
                }
              }
            }

            // Update all existing users metadata
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
              INSERT INTO public.user_profiles (id, tenant_id, company_id, email, full_name, role, is_support_account)
              VALUES ($1, $2, $3, $4, 'TexaCore Support', 'super_admin', true)
              ON CONFLICT (id) DO UPDATE SET
                tenant_id  = EXCLUDED.tenant_id,
                company_id = EXCLUDED.company_id,
                role       = 'super_admin',
                is_support_account = true
            `, [saUserId, tenantId, companyId, SA_EMAIL]);

            await pgClient.query(`
              DO $$
              DECLARE v_sa_role_id uuid;
              BEGIN
                SELECT id INTO v_sa_role_id FROM public.roles WHERE code = 'super_admin' LIMIT 1;
                IF v_sa_role_id IS NULL THEN
                  INSERT INTO public.roles (id, tenant_id, company_id, code, name_ar, name_en, visible_modules, permissions, is_system)
                  VALUES (gen_random_uuid(), '${tenantId}', '${companyId}', 'super_admin', 'مدير المنصة', 'Platform Admin',
                          ARRAY['all']::text[], '{"all": true}'::jsonb, true)
                  RETURNING id INTO v_sa_role_id;
                END IF;
                INSERT INTO public.user_roles (user_id, role_id, tenant_id, company_id, is_active)
                VALUES ('${saUserId}', v_sa_role_id, '${tenantId}', '${companyId}', true)
                ON CONFLICT DO NOTHING;
              END $$;
            `);

            await pgClient.query(`
              INSERT INTO public.super_admins (user_id, email, is_active)
              VALUES ($1, $2, true)
              ON CONFLICT (user_id) DO NOTHING
            `, [saUserId, SA_EMAIL]);
          }

          // ═══ Create essential roles if they don't exist ═══
          await pgClient.query(`
            INSERT INTO public.roles (id, tenant_id, company_id, code, name_ar, name_en, level, visible_modules, permissions, is_system)
            VALUES
              (gen_random_uuid(), $1, $2, 'company_owner',     'مالك الشركة',    'Company Owner',     'company',    ARRAY['all']::text[],                                '{"all": true}'::jsonb,        true),
              (gen_random_uuid(), $1, $2, 'company_admin',     'مدير الشركة',    'Company Admin',     'company',    ARRAY['all']::text[],                                '{"all": true}'::jsonb,        true),
              (gen_random_uuid(), $1, $2, 'tenant_owner',      'مالك المنشأة',   'Tenant Owner',      'tenant',     ARRAY['all']::text[],                                '{"all": true}'::jsonb,        true),
              (gen_random_uuid(), $1, $2, 'accountant',        'محاسب',          'Accountant',        'operations', ARRAY['accounting','purchases','sales']::text[],     '{"accounting": true}'::jsonb, true),
              (gen_random_uuid(), $1, $2, 'warehouse_manager', 'مدير المخازن',   'Warehouse Manager', 'operations', ARRAY['inventory','warehouse']::text[],               '{"inventory": true}'::jsonb,  true),
              (gen_random_uuid(), $1, $2, 'sales_manager',     'مدير المبيعات',  'Sales Manager',     'operations', ARRAY['sales']::text[],                               '{"sales": true}'::jsonb,      true),
              (gen_random_uuid(), $1, $2, 'purchase_manager',  'مدير المشتريات', 'Purchase Manager',  'operations', ARRAY['purchases']::text[],                           '{"purchases": true}'::jsonb,  true),
              (gen_random_uuid(), $1, $2, 'viewer',            'مشاهد فقط',      'Viewer',            'custom',     ARRAY['all']::text[],                                '{"read_only": true}'::jsonb,  true)
            ON CONFLICT DO NOTHING
          `, [tenantId, companyId]);

          // Link orphan auth users (excluding support account)
          await pgClient.query(`
            INSERT INTO public.user_profiles (id, tenant_id, company_id, email, full_name, role)
            SELECT 
              au.id, $1, $2, au.email,
              COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)),
              COALESCE(au.raw_user_meta_data->>'role', 'admin')
            FROM auth.users au
            WHERE NOT EXISTS (SELECT 1 FROM public.user_profiles up WHERE up.id = au.id)
              AND au.email != '${SA_EMAIL}'
            ON CONFLICT (id) DO UPDATE SET
              company_id = EXCLUDED.company_id,
              tenant_id = EXCLUDED.tenant_id
          `, [tenantId, companyId]);

          // Assign company_owner role to all non-support auth users who don't have any role
          await pgClient.query(`
            INSERT INTO public.user_roles (user_id, role_id, tenant_id, company_id, is_active)
            SELECT au.id, r.id, $1, $2, true
            FROM auth.users au
            CROSS JOIN public.roles r
            WHERE r.code = 'company_owner'
              AND au.email != '${SA_EMAIL}'
              AND NOT EXISTS (
                SELECT 1 FROM public.user_roles ur 
                WHERE ur.user_id = au.id AND ur.company_id = $2
              )
            ON CONFLICT DO NOTHING
          `, [tenantId, companyId]);

        } catch (syncErr) {
          console.warn('[API] ⚠️ Super admin provisioning error:', syncErr.message);
        }

        // ═══ CRITICAL: Fix auth.users role/aud after all user provisioning ═══
        // GoTrue may create users with empty role/aud if GOTRUE_JWT_DEFAULT_GROUP_NAME
        // was not set when the service started. This causes PostgREST "role "" does not exist".
        try {
          const fixResult = await pgClient.query(`
            UPDATE auth.users 
            SET role = 'authenticated', aud = 'authenticated'
            WHERE role IS NULL OR role = '' OR aud IS NULL OR aud = ''
          `);
          if (fixResult.rowCount > 0) {
            console.log(`[API] 🔧 Fixed ${fixResult.rowCount} auth.users with missing role/aud`);
          }

          // Ensure DB roles exist and have proper grants
          await pgClient.query(`
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                CREATE ROLE anon NOLOGIN;
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                CREATE ROLE authenticated NOLOGIN;
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
                CREATE ROLE service_role NOLOGIN;
              END IF;
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
                CREATE ROLE authenticator NOINHERIT LOGIN PASSWORD 'texacore-local-super-secret';
              END IF;
              GRANT anon, authenticated, service_role TO authenticator;
              GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
              GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
              GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
              GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
              GRANT USAGE ON SCHEMA auth TO authenticator, service_role;
              GRANT ALL ON ALL TABLES IN SCHEMA auth TO authenticator, service_role;
            END $$;
          `);
          console.log('[API] 🔧 DB roles and grants verified');

          // ═══ Schema alignment: add ALL columns/tables the frontend expects ═══
          // Comprehensive list derived from migration drift analysis + import testing
          await pgClient.query(`
            -- chart_of_accounts
            ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS current_balance_fc numeric DEFAULT 0;
            -- journal_entry_lines
            ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS is_fund_line boolean DEFAULT false;
            -- journal_entries
            ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS description_ar text;
            ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS description_en text;
            ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS fund_account_id uuid;
            -- fabric_materials: multilingual + inventory
            ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
            ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS name_ru text;
            ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS name_uk text;
            ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS name_tr text;
            ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}';
            ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
            ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS default_warehouse_id uuid;
            ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS current_stock numeric DEFAULT 0;
            ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS purchase_price numeric DEFAULT 0;
            -- fabric_colors: multilingual
            ALTER TABLE fabric_colors ADD COLUMN IF NOT EXISTS name_ru text;
            ALTER TABLE fabric_colors ADD COLUMN IF NOT EXISTS name_uk text;
            ALTER TABLE fabric_colors ADD COLUMN IF NOT EXISTS name_tr text;
            ALTER TABLE fabric_colors ADD COLUMN IF NOT EXISTS color_code text;
            ALTER TABLE fabric_colors ADD COLUMN IF NOT EXISTS company_id uuid;
            ALTER TABLE fabric_colors ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
            -- fabric_groups
            ALTER TABLE fabric_groups ADD COLUMN IF NOT EXISTS company_id uuid;
            ALTER TABLE fabric_groups ADD COLUMN IF NOT EXISTS name_ru text;
            ALTER TABLE fabric_groups ADD COLUMN IF NOT EXISTS name_uk text;
            ALTER TABLE fabric_groups ADD COLUMN IF NOT EXISTS name_tr text;
            -- fabric_rolls
            ALTER TABLE fabric_rolls ADD COLUMN IF NOT EXISTS container_id uuid;
            -- inventory_stock: columns needed by RSF mapper
            ALTER TABLE inventory_stock ADD COLUMN IF NOT EXISTS initial_quantity numeric DEFAULT 0;
            ALTER TABLE inventory_stock ADD COLUMN IF NOT EXISTS initial_value numeric DEFAULT 0;
            ALTER TABLE inventory_stock ADD COLUMN IF NOT EXISTS current_quantity numeric DEFAULT 0;
            ALTER TABLE inventory_stock ADD COLUMN IF NOT EXISTS batch_number text;
            -- purchase_invoices
            ALTER TABLE purchase_invoices ALTER COLUMN supplier_id DROP NOT NULL;
            ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS receipt_mode text DEFAULT 'direct';
            ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS receipt_status text DEFAULT 'pending';
            ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS document_stage text DEFAULT 'invoice';
            ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS container_id uuid;
            ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS warehouse_id uuid;
            ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS shipment_id uuid;
            ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS branch_id uuid;
            ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS confirmation_status text DEFAULT 'pending';
            ALTER TABLE purchase_invoices ADD COLUMN IF NOT EXISTS expenses_total numeric DEFAULT 0;
            -- purchase_invoice_items
            ALTER TABLE purchase_invoice_items ADD COLUMN IF NOT EXISTS discount_percentage numeric DEFAULT 0;
            ALTER TABLE purchase_invoice_items ADD COLUMN IF NOT EXISTS unit_cost numeric DEFAULT 0;
            ALTER TABLE purchase_invoice_items ADD COLUMN IF NOT EXISTS color_id uuid;
            ALTER TABLE purchase_invoice_items ADD COLUMN IF NOT EXISTS color_name text;
            -- sales_invoice_items
            ALTER TABLE sales_invoice_items ADD COLUMN IF NOT EXISTS discount_percent numeric DEFAULT 0;
            -- purchase_orders
            ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS confirmation_status text DEFAULT 'pending';
            -- purchase_transactions
            ALTER TABLE purchase_transactions ADD COLUMN IF NOT EXISTS container_id uuid;
            -- inventory_movements: created_by must be nullable for RSF import
            ALTER TABLE inventory_movements ALTER COLUMN created_by DROP NOT NULL;
            -- warehouses multilingual
            ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS name_ru text;
            ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS name_uk text;
            ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS name_tr text;
            -- suppliers/customers FK columns
            ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payable_account_id uuid;
            ALTER TABLE customers ADD COLUMN IF NOT EXISTS receivable_account_id uuid;
            -- equity_partners FK columns
            ALTER TABLE equity_partners ADD COLUMN IF NOT EXISTS capital_account_id uuid;
            ALTER TABLE equity_partners ADD COLUMN IF NOT EXISTS current_account_id uuid;
            -- company_accounting_settings
            ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS supported_currencies text[] DEFAULT ARRAY['UAH','USD','EUR'];
            ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS base_currency text DEFAULT 'UAH';
            ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS decimal_places int DEFAULT 2;
            ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS date_format text DEFAULT 'DD/MM/YYYY';
            ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS number_format text DEFAULT 'en-US';
            ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS auto_post_entries boolean DEFAULT false;
            ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS require_approval boolean DEFAULT true;
            ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS journal_entry_prefix text DEFAULT 'JE';
            ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS reset_numbering_yearly boolean DEFAULT true;
            ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS current_entry_number int DEFAULT 1;
            ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS default_sales_currency text;
            ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS default_purchase_currency text;
            ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS default_international_purchase_currency text;
            ALTER TABLE company_accounting_settings ADD COLUMN IF NOT EXISTS default_transit_purchase_account_id uuid;
            -- chart_of_accounts
            ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS is_party_account boolean DEFAULT false;
            -- user_profiles: support account flag
            ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS is_support_account boolean DEFAULT false;
            -- mfa_user_settings
            ALTER TABLE mfa_user_settings ADD COLUMN IF NOT EXISTS totp_verified boolean DEFAULT false;
            ALTER TABLE mfa_user_settings ADD COLUMN IF NOT EXISTS preferred_method text DEFAULT 'totp';
            -- document_activity: entity_type/entity_id aliases
            ALTER TABLE document_activity ADD COLUMN IF NOT EXISTS entity_type text GENERATED ALWAYS AS (document_type) STORED;
            ALTER TABLE document_activity ADD COLUMN IF NOT EXISTS entity_id uuid GENERATED ALWAYS AS (document_id) STORED;
            -- sales_invoices: delivery status for RSF imports
            ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS delivery_status text DEFAULT 'pending';
          `);
          // Ensure UNIQUE constraint for ON CONFLICT
          await pgClient.query(`
            DO $$ BEGIN
              BEGIN ALTER TABLE company_accounting_settings ADD CONSTRAINT company_accounting_settings_company_id_key UNIQUE (company_id);
              EXCEPTION WHEN duplicate_object THEN NULL; END;
            END $$;
          `);

          // Backfill fabric_groups.company_id from tenant
          await pgClient.query(`
            UPDATE fabric_groups SET company_id = (
              SELECT c.id FROM companies c WHERE c.tenant_id = fabric_groups.tenant_id LIMIT 1
            ) WHERE company_id IS NULL;
          `);

          // Create missing tables
          await pgClient.query(`
            CREATE TABLE IF NOT EXISTS crm_tasks (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL, company_id uuid NOT NULL REFERENCES companies(id),
              title text NOT NULL, description text, status text DEFAULT 'pending',
              priority text DEFAULT 'medium', due_date timestamptz,
              assigned_to uuid, created_by uuid, related_type text, related_id uuid,
              created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS bin_locations (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              tenant_id uuid NOT NULL, company_id uuid NOT NULL REFERENCES companies(id),
              warehouse_id uuid NOT NULL REFERENCES warehouses(id),
              code text, name text, zone text, is_active boolean DEFAULT true,
              created_at timestamptz DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS budget_alerts (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, company_id uuid,
              budget_id uuid, alert_type text, message text, is_active boolean DEFAULT true,
              triggered_at timestamptz DEFAULT now(), created_at timestamptz DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS budgets (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, company_id uuid,
              name text, period_start date, period_end date, total_amount numeric DEFAULT 0,
              status text DEFAULT 'active', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS purchase_receipts (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
              receipt_number text, receipt_date date DEFAULT CURRENT_DATE, status text DEFAULT 'draft',
              invoice_id uuid, container_id uuid, order_id uuid, warehouse_id uuid, notes text,
              created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS purchase_returns (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
              return_number text, return_date date DEFAULT CURRENT_DATE, status text DEFAULT 'draft',
              supplier_id uuid, invoice_id uuid, total_amount numeric DEFAULT 0, currency text DEFAULT 'UAH',
              notes text, created_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS stock_transfers (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
              transfer_number text, from_warehouse_id uuid, to_warehouse_id uuid, status text DEFAULT 'draft',
              transfer_date date DEFAULT CURRENT_DATE, notes text, created_by uuid,
              created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS batches (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, company_id uuid NOT NULL,
              batch_number text, container_id uuid, status text DEFAULT 'active', created_at timestamptz DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS recurring_entries (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
              name text, description text, template_entry jsonb DEFAULT '{}', frequency text DEFAULT 'monthly',
              start_date date, end_date date, next_run_date date, last_run_date timestamptz,
              is_active boolean DEFAULT true, auto_post boolean DEFAULT false, created_by uuid,
              created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS contacts (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
              name text, email text, phone text, company_name text, job_title text,
              lifecycle_stage text DEFAULT 'lead', status text DEFAULT 'active', source text,
              assigned_user_id uuid, tags text[] DEFAULT '{}', notes text, custom_fields jsonb DEFAULT '{}',
              created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS container_items (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
              container_id uuid, purchase_invoice_id uuid, purchase_order_id uuid,
              description text, quantity numeric DEFAULT 0, weight numeric DEFAULT 0, notes text,
              created_at timestamptz DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS sales_deliveries (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
              delivery_number text, sales_invoice_id uuid, customer_id uuid, delivery_date timestamptz DEFAULT now(),
              status text DEFAULT 'pending', driver_id uuid, notes text,
              created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS ecommerce_store_config (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
              store_name text, store_url text, is_active boolean DEFAULT false, config jsonb DEFAULT '{}',
              created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS chat_messages (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
              user_id uuid, message text, role text DEFAULT 'user', metadata jsonb DEFAULT '{}',
              created_at timestamptz DEFAULT now()
            );
          `);

          // Additional missing columns for UI
          await pgClient.query(`
            ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS season text;
            ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS width numeric;
            ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS pattern text;
            ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS texture text;
            ALTER TABLE fabric_materials ADD COLUMN IF NOT EXISTS care_instructions text;
            ALTER TABLE fabric_colors ADD COLUMN IF NOT EXISTS hex_code text;
            ALTER TABLE fabric_rolls ADD COLUMN IF NOT EXISTS original_length numeric DEFAULT 0;
            ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS party_type text;
            ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS party_id uuid;
            ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS purchase_invoice_id uuid;
            ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS sales_invoice_id uuid;
            ALTER TABLE payment_vouchers ADD COLUMN IF NOT EXISTS container_id uuid;
          `);

          // Create profiles view
          await pgClient.query(`
            CREATE OR REPLACE VIEW profiles AS SELECT id, full_name, email, avatar_url, role FROM user_profiles;
            GRANT ALL ON profiles TO anon, authenticated, service_role;
          `);

          // Clean orphan FK references before adding constraints
          await pgClient.query(`
            UPDATE suppliers SET payable_account_id = NULL
            WHERE payable_account_id IS NOT NULL AND payable_account_id NOT IN (SELECT id FROM chart_of_accounts);
            UPDATE customers SET receivable_account_id = NULL
            WHERE receivable_account_id IS NOT NULL AND receivable_account_id NOT IN (SELECT id FROM chart_of_accounts);
            UPDATE equity_partners SET capital_account_id = NULL
            WHERE capital_account_id IS NOT NULL AND capital_account_id NOT IN (SELECT id FROM chart_of_accounts);
            UPDATE equity_partners SET current_account_id = NULL
            WHERE current_account_id IS NOT NULL AND current_account_id NOT IN (SELECT id FROM chart_of_accounts);
          `);

          // Ensure FK constraints for PostgREST embedding
          await pgClient.query(`
            DO $$ BEGIN
              BEGIN ALTER TABLE suppliers ADD CONSTRAINT suppliers_payable_account_id_fkey
                FOREIGN KEY (payable_account_id) REFERENCES chart_of_accounts(id);
              EXCEPTION WHEN duplicate_object THEN NULL; END;
              BEGIN ALTER TABLE customers ADD CONSTRAINT customers_receivable_account_id_fkey
                FOREIGN KEY (receivable_account_id) REFERENCES chart_of_accounts(id);
              EXCEPTION WHEN duplicate_object THEN NULL; END;
              BEGIN ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_fund_account_id_fkey
                FOREIGN KEY (fund_account_id) REFERENCES chart_of_accounts(id);
              EXCEPTION WHEN duplicate_object THEN NULL; END;
              BEGIN ALTER TABLE equity_partners ADD CONSTRAINT equity_partners_capital_account_id_fkey
                FOREIGN KEY (capital_account_id) REFERENCES chart_of_accounts(id);
              EXCEPTION WHEN duplicate_object THEN NULL; END;
              BEGIN ALTER TABLE equity_partners ADD CONSTRAINT equity_partners_current_account_id_fkey
                FOREIGN KEY (current_account_id) REFERENCES chart_of_accounts(id);
              EXCEPTION WHEN duplicate_object THEN NULL; END;
            END $$;
          `);

          // Ensure RPCs exist
          await pgClient.query(`
            CREATE OR REPLACE FUNCTION get_user_companies(p_user_id uuid DEFAULT NULL)
            RETURNS SETOF companies LANGUAGE sql SECURITY DEFINER STABLE AS $fn$
              SELECT c.* FROM companies c
              JOIN user_profiles up ON up.company_id = c.id
              WHERE up.id = COALESCE(p_user_id, auth.uid())
              UNION
              SELECT c.* FROM companies c
              JOIN super_admins sa ON sa.user_id = COALESCE(p_user_id, auth.uid()) AND sa.is_active = true;
            $fn$;
            CREATE OR REPLACE FUNCTION refresh_company_insights(p_company_id uuid DEFAULT NULL)
            RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN NULL; END; $fn$;
          `);

          // Ensure account_types seed data exists (required by RSF import)
          await pgClient.query(`
            INSERT INTO account_types (code, name_ar, name_en, classification, normal_balance, display_order) VALUES
            ('ASSET', 'الأصول', 'Assets', 'assets', 'debit', 1),
            ('CURRENT_ASSET', 'الأصول المتداولة', 'Current Assets', 'assets', 'debit', 2),
            ('FIXED_ASSET', 'الأصول الثابتة', 'Fixed Assets', 'assets', 'debit', 3),
            ('LIABILITY', 'الالتزامات', 'Liabilities', 'liabilities', 'credit', 10),
            ('CURRENT_LIABILITY', 'الالتزامات المتداولة', 'Current Liabilities', 'liabilities', 'credit', 11),
            ('LONG_TERM_LIABILITY', 'الالتزامات طويلة الأجل', 'Long-term Liabilities', 'liabilities', 'credit', 12),
            ('EQUITY', 'حقوق الملكية', 'Equity', 'equity', 'credit', 20),
            ('REVENUE', 'الإيرادات', 'Revenue', 'income', 'credit', 30),
            ('EXPENSE', 'المصروفات', 'Expenses', 'expenses', 'debit', 40),
            ('COGS', 'تكلفة البضاعة المباعة', 'Cost of Goods Sold', 'expenses', 'debit', 41),
            ('OTHER_INCOME', 'إيرادات أخرى', 'Other Income', 'income', 'credit', 50),
            ('OTHER_EXPENSE', 'مصروفات أخرى', 'Other Expenses', 'expenses', 'debit', 51)
            ON CONFLICT DO NOTHING;
          `);

          // Ensure company_accounting_settings row exists
          await pgClient.query(`
            INSERT INTO company_accounting_settings (tenant_id, company_id, base_currency, supported_currencies)
            SELECT t.id, c.id, 'UAH', ARRAY['UAH','USD','EUR']
            FROM companies c JOIN tenants t ON t.id = c.tenant_id
            WHERE NOT EXISTS (SELECT 1 FROM company_accounting_settings cas WHERE cas.company_id = c.id)
            ON CONFLICT DO NOTHING;
          `);

          // Backfill fabric_groups/colors company_id and materials warehouse
          await pgClient.query(`
            UPDATE fabric_groups SET company_id = (
              SELECT c.id FROM companies c WHERE c.tenant_id = fabric_groups.tenant_id LIMIT 1
            ) WHERE company_id IS NULL;
            UPDATE fabric_colors SET company_id = (
              SELECT c.id FROM companies c WHERE c.tenant_id = fabric_colors.tenant_id LIMIT 1
            ) WHERE company_id IS NULL;
            UPDATE fabric_materials SET default_warehouse_id = (
              SELECT w.id FROM warehouses w WHERE w.company_id = fabric_materials.company_id LIMIT 1
            ) WHERE default_warehouse_id IS NULL AND company_id IS NOT NULL;
          `);

          // Grants for new tables + functions
          await pgClient.query(`
            GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
            GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
            GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
          `);

          // Disable RLS on all tables for local dev
          const { rows: allTbls } = await pgClient.query(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
          );
          for (const t of allTbls) {
            try { await pgClient.query(`ALTER TABLE public.${t.tablename} DISABLE ROW LEVEL SECURITY`); } catch {}
          }

          console.log('[API] 🔧 Schema alignment completed');

          // Notify PostgREST to reload schema cache
          await pgClient.query("NOTIFY pgrst, 'reload schema'");
        } catch (fixErr) {
          console.warn('[API] ⚠️ Post-import fix error:', fixErr.message);
        }

        reader.close();
        try { freshReader.close(); } catch {}

        // Cleanup temp file
        try { fs.unlinkSync(rsfPath); } catch {}

        if (!result.success && result.errors && result.errors.length > 0) {
          result.error = result.errors.join('; ');
        }

        // ═══ Create .tcdb backup file after successful RSF import ═══
        if (result.success) {
          try {
            // Save TCDB in user's Documents folder (cross-platform)
            const isWin = process.platform === 'win32';
            const documentsDir = path.join(require('os').homedir(), 'Documents', 'TexaCore');
            if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true });
            const tcdbPath = path.join(documentsDir, rsfCompanyName + '.tcdb');
            
            console.log('[API] 🔧 Creating TCDB backup...');
            console.log('[API]   pg_dump path:', PG_BIN_DIR);
            console.log('[API]   target:', tcdbPath);
            
            // Secondary backup in installer data directory
            const installerBackupDir = path.join(__dirname, '..', 'data', 'backups');
            if (!fs.existsSync(installerBackupDir)) fs.mkdirSync(installerBackupDir, { recursive: true });

            backupManager = new BackupManager({
              pgBinDir: PG_BIN_DIR,
              dbHost: 'localhost',
              dbPort: PG_PORT,
              dbName: 'postgres',
              dbUser: 'postgres',
              dbPassword: DB_PASSWORD,
              backupPath: tcdbPath,
              secondaryBackupPath: path.join(installerBackupDir, rsfCompanyName + '.tcdb'),
              encryptionKey: 'texacore-default-backup-key-2026',
              intervalMs: 5 * 60 * 1000,
              onProgress: (phase, detail) => console.log(`[Backup] ${phase}: ${detail}`),
              onError: (err) => console.error('[Backup] Error:', err.message),
            });

            const backupResult = await backupManager.backup();
            if (backupResult) {
              result.tcdbPath = tcdbPath;
              console.log('[API] ✅ TCDB backup created:', tcdbPath, `(${(backupResult.size / 1024).toFixed(0)} KB)`);

              // ═══ Copy TCDB to secondary locations ═══
              
              // 1. Copy next to original RSF file (if originalRsfDir was provided by frontend/Electron)
              const originalRsfDir = result.originalRsfDir || null;
              if (originalRsfDir && fs.existsSync(originalRsfDir)) {
                try {
                  const rsfSidePath = path.join(originalRsfDir, rsfCompanyName + '.tcdb');
                  fs.copyFileSync(tcdbPath, rsfSidePath);
                  result.tcdbPathRsfSide = rsfSidePath;
                  console.log('[API] 📋 TCDB copy next to RSF:', rsfSidePath);
                } catch (e) {
                  console.warn('[API] ⚠️ Copy next to RSF failed:', e.message);
                }
              } else {
                // Fallback: copy to Desktop when no original RSF path (dev mode / browser upload)
                try {
                  const desktopDir = path.join(require('os').homedir(), 'Desktop');
                  if (fs.existsSync(desktopDir)) {
                    const desktopPath = path.join(desktopDir, rsfCompanyName + '.tcdb');
                    fs.copyFileSync(tcdbPath, desktopPath);
                    result.tcdbPathDesktop = desktopPath;
                    console.log('[API] 📋 TCDB Desktop copy:', desktopPath);
                  }
                } catch (e) {
                  console.warn('[API] ⚠️ Desktop copy failed:', e.message);
                }
              }

              // 2. Copy in installer's data directory (redundant backup)
              try {
                const instDir = path.join(__dirname, '..', 'data', 'backups');
                if (!fs.existsSync(instDir)) fs.mkdirSync(instDir, { recursive: true });
                const installerCopyPath = path.join(instDir, rsfCompanyName + '.tcdb');
                fs.copyFileSync(tcdbPath, installerCopyPath);
                result.tcdbPathInstaller = installerCopyPath;
                console.log('[API] 📋 TCDB installer backup:', installerCopyPath);
              } catch (e) {
                console.warn('[API] ⚠️ Installer backup copy failed:', e.message);
              }

            } else {
              console.warn('[API] ⚠️ TCDB backup returned null (may be running already)');
            }

            // Start periodic sync
            backupManager.startSync();
            console.log('[API] 🔄 Real-time backup sync started');
          } catch (backupErr) {
            console.error('[API] ❌ TCDB creation failed:', backupErr.message);
            console.error('[API]   Stack:', backupErr.stack);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error('[API] RSF import error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      } finally {
        try { await pgClient.end(); } catch {}
      }
    });
    return;
  }

  // ─── POST /api/backup ────────────────────────────────────
  if (req.method === 'POST' && req.url === '/api/backup') {
    if (!backupManager) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Backup not initialized. Import an RSF file first.' }));
      return;
    }
    try {
      const result = await backupManager.backup();
      // Auto-upload to Google Drive in background (non-blocking)
      uploadBackupToDriveInBackground(backupManager.backupPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // ─── GET /api/backup-status ──────────────────────────────
  if (req.method === 'GET' && req.url === '/api/backup-status') {
    if (!backupManager) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ initialized: false }));
      return;
    }
    const status = backupManager.getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ initialized: true, ...status, lastDriveUpload: lastDriveUploadTime }));
    return;
  }

  // ─── POST /api/backup-to-drive — Manual upload to Google Drive ───
  if (req.method === 'POST' && req.url === '/api/backup-to-drive') {
    if (!backupManager) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Backup not initialized' }));
      return;
    }
    try {
      const driveResult = await uploadBackupToDrive(backupManager.backupPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(driveResult));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // ─── GET /api/ping ────────────────────────────────────────
  if (req.method === 'GET' && req.url === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'TexaCore Standalone API is running' }));
    return;
  }

  // ─── POST /api/create-local-company ──────────────────────
  if (req.method === 'POST' && req.url === '/api/create-local-company') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const companyData = JSON.parse(body);
        const result = await handleCreateLocalCompany(companyData);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error('[API] create-local-company error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return;
  }

  // ─── GET /api/admin/verify — SSE test run ──────────────────
  if (req.method === 'GET' && req.url === '/api/admin/verify') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const sendSSE = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendSSE('log', { text: '🔄 بدء عملية الفحص والتحقق الكامل للنظام...', type: 'info' });

    const { spawn } = require('child_process');
    const rootDir = path.resolve(__dirname, '..', '..');
    
    sendSSE('log', { text: `📂 مجلد العمل: ${rootDir}`, type: 'info' });
    sendSSE('log', { text: '🚀 تشغيل اختبارات Playwright التلقائية...', type: 'info' });

    // Spawn playwright run
    const playwrightProcess = spawn('npx', ['playwright', 'test'], {
      cwd: rootDir,
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    playwrightProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          sendSSE('log', { text: line, type: 'stdout' });
        }
      }
    });

    playwrightProcess.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          sendSSE('log', { text: line, type: 'stderr' });
        }
      }
    });

    playwrightProcess.on('close', (code) => {
      if (code === 0) {
        sendSSE('log', { text: '✅ تم اجتياز جميع الفحوصات بنجاح 100%!', type: 'success' });
        sendSSE('done', { success: true, code });
      } else {
        sendSSE('log', { text: `❌ فشل بعض الفحوصات. رمز الخروج: ${code}`, type: 'error' });
        sendSSE('done', { success: false, code });
      }
      res.end();
    });

    req.on('close', () => {
      console.log('[SSE] client disconnected from /api/admin/verify');
      try {
        playwrightProcess.kill();
      } catch {}
    });

    return;
  }

  // ─── GET /api/open-tcdb — Native file dialog (or file list fallback) ──
  if (req.method === 'GET' && req.url === '/api/open-tcdb') {
    try {
      const homeDir = require('os').homedir();
      const desktopDir = path.join(homeDir, 'Desktop');
      const documentsDir = path.join(homeDir, 'Documents', 'TexaCore');
      
      const scanDir = (dir) => {
        try {
          return fs.readdirSync(dir)
            .filter(f => f.endsWith('.tcdb') || f.endsWith('.rsf'))
            .map(f => {
              const filePath = path.join(dir, f);
              const stats = fs.statSync(filePath);
              return { name: f, path: filePath, type: f.endsWith('.tcdb') ? 'tcdb' : 'rsf', mtime: stats.mtimeMs };
            });
        } catch { return []; }
      };
      
      // Search Desktop first, then Documents/TexaCore
      const files = [...scanDir(desktopDir), ...scanDir(documentsDir)];
      
      if (files.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ canceled: true, message: 'No .tcdb/.rsf files found' }));
        return;
      }

      // Validate TCDB files (check magic header)
      const validFiles = files.filter(f => {
        if (f.type === 'rsf') return true;
        try {
          const head = Buffer.alloc(4);
          const fd = fs.openSync(f.path, 'r');
          fs.readSync(fd, head, 0, 4, 0);
          fs.closeSync(fd);
          return head.equals(TCDB_MAGIC);
        } catch { return false; }
      });

      if (validFiles.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ canceled: true, message: 'No valid .tcdb/.rsf files found' }));
        return;
      }

      // Sort by modification time (newest first) and pick most recent
      validFiles.sort((a, b) => b.mtime - a.mtime);
      const selected = validFiles[0];

      if (selected.type === 'rsf') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, type: 'rsf', filePath: selected.path }));
        return;
      }

      const restoreResult = await restoreTcdbFile(selected.path);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(restoreResult));
    } catch (err) {
      console.error('[API] open-tcdb error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  // ─── POST /api/restore-tcdb — Restore uploaded .tcdb file ────────
  if (req.method === 'POST' && req.url === '/api/restore-tcdb') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      try {
        // ── Ensure PG is alive before restore ──
        const pgAlive = await ensurePostgresAlive();
        if (!pgAlive) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'قاعدة البيانات المحلية غير متاحة — لم نتمكن من إعادة تشغيلها. تحقق من التثبيت.' }));
          return;
        }

        const body = Buffer.concat(chunks);
        const contentType = req.headers['content-type'] || '';
        let tcdbBuffer = null;
        let fileName = 'uploaded.tcdb';

        if (contentType.includes('multipart/form-data')) {
          const boundary = contentType.split('boundary=')[1];
          const bodyStr = body.toString('binary');
          const parts = bodyStr.split('--' + boundary);
          for (const part of parts) {
            if (part.includes('filename=')) {
              const headerEnd = part.indexOf('\r\n\r\n');
              const headerPart = Buffer.from(part.substring(0, headerEnd), 'binary').toString('utf8');
              const filenameMatch = headerPart.match(/filename\*?=(?:UTF-8''|")?([^";\r\n]+)"?/i);
              if (filenameMatch) {
                try { fileName = decodeURIComponent(filenameMatch[1]); } catch { fileName = filenameMatch[1]; }
              }
              const dataStart = headerEnd + 4;
              const dataEnd = part.lastIndexOf('\r\n');
              tcdbBuffer = Buffer.from(part.substring(dataStart, dataEnd), 'binary');
            }
          }
        } else {
          tcdbBuffer = body;
        }

        if (!tcdbBuffer || tcdbBuffer.length < 100) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'لم يتم استلام بيانات TCDB صالحة — الملف فارغ أو تالف' }));
          return;
        }

        // Validate TCDB magic header
        if (!tcdbBuffer.subarray(0, 4).equals(TCDB_MAGIC)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'الملف ليس ملف TexaCore صالح (.tcdb) — توقيع الملف غير صحيح' }));
          return;
        }

        // Save to temp then restore
        const tmpPath = path.join(TEMP_DIR, fileName);
        fs.writeFileSync(tmpPath, tcdbBuffer);
        console.log(`[API] TCDB file saved: ${tmpPath} (${tcdbBuffer.length} bytes)`);

        const result = await restoreTcdbFile(tmpPath);
        try { fs.unlinkSync(tmpPath); } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error('[API] restore-tcdb error:', err.message, err.stack);
        const errorMsg = err.message.includes('Not a valid')
          ? 'الملف ليس ملف TexaCore صالح'
          : err.message.includes('Unsupported')
          ? 'إصدار الملف غير مدعوم — حدّث البرنامج'
          : err.message.includes('ENOENT')
          ? 'الملف غير موجود أو لا يمكن الوصول إليه'
          : `فشل الاستعادة: ${err.message}`;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: errorMsg }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end();
});

// ─── Start Server ─────────────────────────────────────────────
const PORT = 1960;
httpServer.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n  ✅ TexaCore Standalone API Server listening on port ${PORT}`);
  console.log(`  📡 Endpoints:`);
  console.log(`     GET  /api/ping`);
  console.log(`     GET  /api/companies`);
  console.log(`     POST /api/import-rsf`);
  console.log(`     POST /api/delete-company\n`);

  // ═══ Auto-apply pending migrations on startup ═══
  try {
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    const manifestPath = path.join(migrationsDir, 'migrations.json');
    if (fs.existsSync(manifestPath)) {
      const MigrationRunner = require('./migration-runner');
      const { execSync } = require('child_process');
      const runner = new MigrationRunner({
        psqlExec: (sql, db) => {
          const pgBin = findPgBinDir();
          const psqlPath = path.join(pgBin, 'psql');
          // Avoid shell parameter/PID substitution of $$ by writing query to a temp file
          const tmpFile = path.join(TEMP_DIR, `migration_exec_${Date.now()}_${require('crypto').randomBytes(4).toString('hex')}.sql`);
          fs.writeFileSync(tmpFile, sql, 'utf8');
          try {
            const cmd = `PGPASSWORD="${DB_PASSWORD}" "${psqlPath}" -h 127.0.0.1 -p ${PG_PORT} -U postgres -d ${db || 'postgres'} -f "${tmpFile}"`;
            const result = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
            return result;
          } finally {
            try { fs.unlinkSync(tmpFile); } catch {}
          }
        },
        pgBin: findPgBinDir(),
        isWindows: process.platform === 'win32',
        migrationsDir,
        onProgress: (step, total, name) => {
          console.log(`  [Migration] (${step}/${total}) ${name}`);
        },
      });
      const result = await runner.runAll();
      console.log(`  ✅ Migrations: ${result.applied} applied, ${result.skipped || 0} skipped`);

      // Apply grants + disable RLS after migrations
      const { Client } = require('pg');
      const pgClient = new Client({ host: 'localhost', port: PG_PORT, database: 'postgres', user: 'postgres', password: DB_PASSWORD });
      await pgClient.connect();
      await pgClient.query(`
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
        GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
        DO $$ DECLARE r RECORD; BEGIN
          FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
            EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' DISABLE ROW LEVEL SECURITY';
          END LOOP;
        END $$;
        NOTIFY pgrst, 'reload schema';
      `);
      await pgClient.end();
      console.log('  ✅ Grants applied + RLS disabled + schema cache reloaded');
    }
  } catch (migErr) {
    console.warn('  ⚠️ Auto-migration error:', migErr.message);
  }
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} already in use. Kill the process first.`);
  } else {
    console.error('❌ Server error:', err.message);
  }
  process.exit(1);
});

// ═══════════════════════════════════════════════════════════════
// 🔀 API Proxy Server on port 54321
// Routes /auth/v1/* → GoTrue (9999) and /rest/v1/* → PostgREST (3000)
// This replaces the proxy that was embedded in ServiceManager (Electron)
// ═══════════════════════════════════════════════════════════════
const POSTGREST_PORT = 3000;

// ─── Auto-start PostgREST if not running ────────────────────
const { spawn: spawnChild } = require('child_process');
let postgrestProcess = null;

function startPostgRESTIfNeeded() {
  return new Promise((resolve) => {
    // Check if already running
    const testReq = http.get(`http://127.0.0.1:${POSTGREST_PORT}/`, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        console.log('[PostgREST] Already running on port', POSTGREST_PORT);
        resolve(true);
      });
    });
    testReq.on('error', () => {
      // Not running — start it
      console.log('[PostgREST] Not running — starting...');
      const isWin = process.platform === 'win32';
      const postgrestBin = path.join(__dirname, '..', 'bin', isWin ? 'windows-x64' : 'macos-arm64', 'postgrest', isWin ? 'postgrest.exe' : 'postgrest');
      
      if (!fs.existsSync(postgrestBin)) {
        console.warn('[PostgREST] Binary not found:', postgrestBin);
        resolve(false);
        return;
      }

      // Write config
      const confPath = path.join(__dirname, '..', '.tmp-rsf', 'postgrest.conf');
      fs.writeFileSync(confPath, [
        `db-uri = "postgres://authenticator:${DB_PASSWORD}@127.0.0.1:${PG_PORT}/postgres"`,
        `db-schemas = "public"`,
        `db-anon-role = "anon"`,
        `jwt-secret = "${JWT_SECRET}"`,
        `server-port = ${POSTGREST_PORT}`,
        `server-host = "127.0.0.1"`,
        `db-use-legacy-gucs = false`,
        `app-settings.jwt_secret = "${JWT_SECRET}"`,
      ].join('\n') + '\n');

      postgrestProcess = spawnChild(postgrestBin, [confPath], { stdio: 'ignore' });
      postgrestProcess.on('exit', (code) => {
        console.log('[PostgREST] Exited with code', code);
        postgrestProcess = null;
      });

      // Wait for it to start
      let attempts = 0;
      const check = () => {
        const req2 = http.get(`http://127.0.0.1:${POSTGREST_PORT}/`, (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => {
            console.log('[PostgREST] ✅ Started on port', POSTGREST_PORT);
            resolve(true);
          });
        });
        req2.on('error', () => {
          if (++attempts < 20) setTimeout(check, 500);
          else { console.warn('[PostgREST] ⚠️ Failed to start'); resolve(false); }
        });
        req2.setTimeout(1000, () => { req2.destroy(); });
      };
      setTimeout(check, 1000);
    });
    testReq.setTimeout(1000, () => { testReq.destroy(); });
  });
}

// Auto-start PostgREST on server boot
startPostgRESTIfNeeded();

const proxyServer = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, x-client-info, Accept, Range, X-Upsert, Prefer, x-supabase-api-version, accept-profile, content-profile');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Total-Count');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let targetPort, targetPath;

  if (req.url.startsWith('/auth/v1/')) {
    // Auth routes → GoTrue
    targetPort = GOTRUE_PORT;
    targetPath = req.url.replace('/auth/v1', '');
    if (!targetPath) targetPath = '/';
  } else if (req.url.startsWith('/rest/v1/')) {
    // REST routes → PostgREST
    targetPort = POSTGREST_PORT;
    targetPath = req.url.replace('/rest/v1', '');
    if (!targetPath) targetPath = '/';
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', hint: 'Use /auth/v1/ or /rest/v1/' }));
    return;
  }

  // Proxy the request
  const proxyOptions = {
    hostname: '127.0.0.1',
    port: targetPort,
    path: targetPath,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${targetPort}` },
  };

  const proxyReq = http.request(proxyOptions, (proxyRes) => {
    // Copy CORS headers onto proxied response
    proxyRes.headers['access-control-allow-origin'] = '*';
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('[Proxy] Error:', err.message);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Service unavailable', message: err.message }));
  });

  req.pipe(proxyReq);
});

proxyServer.listen(API_PORT, '0.0.0.0', () => {
  console.log(`  ✅ API Proxy listening on port ${API_PORT}`);
  console.log(`     /auth/v1/* → GoTrue (${GOTRUE_PORT})`);
  console.log(`     /rest/v1/* → PostgREST (${POSTGREST_PORT})\n`);

  // ═══ Auto-init BackupManager if company already exists ═══
  (async () => {
    try {
      const pgClient = getPgClient();
      await pgClient.connect();
      const { rows } = await pgClient.query('SELECT name FROM public.companies LIMIT 1');
      await pgClient.end();
      
      if (rows.length > 0 && !backupManager) {
        const companyName = rows[0].name || 'TexaCore';
        const isWin = process.platform === 'win32';
        const tcdbDir = path.join(require('os').homedir(), 'Documents', 'TexaCore');
        if (!fs.existsSync(tcdbDir)) fs.mkdirSync(tcdbDir, { recursive: true });
        const tcdbPath = path.join(tcdbDir, companyName + '.tcdb');
        
        // Secondary backup in installer data directory
        const installerBackupDir = path.join(__dirname, '..', 'data', 'backups');
        if (!fs.existsSync(installerBackupDir)) fs.mkdirSync(installerBackupDir, { recursive: true });

        backupManager = new BackupManager({
          pgBinDir: PG_BIN_DIR,
          dbHost: 'localhost',
          dbPort: PG_PORT,
          dbName: 'postgres',
          dbUser: 'postgres',
          dbPassword: DB_PASSWORD,
          backupPath: tcdbPath,
          secondaryBackupPath: path.join(installerBackupDir, companyName + '.tcdb'),
          encryptionKey: 'texacore-default-backup-key-2026',
          intervalMs: 5 * 60 * 1000,
          onProgress: (phase, detail) => console.log(`[Backup] ${phase}: ${detail}`),
          onError: (err) => console.error('[Backup] Error:', err.message),
        });
        
        backupManager.startSync();
        console.log(`  🔄 Auto-backup initialized → ${tcdbPath}`);
      }
    } catch (e) {
      console.warn('[Backup] Auto-init skipped:', e.message);
    }
  })();
});

proxyServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`⚠️  Port ${API_PORT} already in use — proxy skipped`);
  } else {
    console.error('⚠️  Proxy error:', err.message);
  }
});

// ═══ Graceful Shutdown: backup before exit ═══
async function gracefulShutdown(signal) {
  console.log(`\n[TexaCore] ${signal} received — shutting down...`);
  if (backupManager) {
    try {
      console.log('[TexaCore] Running final backup before exit...');
      backupManager.stopSync();
      await backupManager.backup();
      console.log('[TexaCore] ✅ Final backup complete');
    } catch (e) {
      console.warn('[TexaCore] ⚠️ Final backup failed:', e.message);
    }
  }
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
