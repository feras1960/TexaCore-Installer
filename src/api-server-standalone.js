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
function gotrueRequest(method, reqPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const options = {
      hostname: '127.0.0.1',
      port: GOTRUE_PORT,
      path: reqPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
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

// ─── PG Client Helper ─────────────────────────────────────────
function getPgClient() {
  const { Client } = require('pg');
  return new Client({
    host: 'localhost', port: PG_PORT,
    database: 'postgres', user: 'postgres',
    password: DB_PASSWORD,
  });
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
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
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

          const saCheckRes = await gotrueReq('GET', `/admin/users?page=1&per_page=50`, null);
          let saUserId = null;

          if (saCheckRes.status === 200 && saCheckRes.body?.users) {
            const saUser = saCheckRes.body.users.find(u => u.email === SA_EMAIL);
            if (saUser) {
              saUserId = saUser.id;
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
              const saCreateRes = await gotrueReq('POST', '/admin/users', {
                email: SA_EMAIL, password: SA_PASS, email_confirm: true,
                user_metadata: { role: 'super_admin', full_name: 'TexaCore Support', tenant_id: tenantId, company_id: companyId },
                app_metadata: { provider: 'email', providers: ['email'], tenant_id: tenantId, company_id: companyId, role: 'super_admin' }
              });
              if (saCreateRes.status === 200 || saCreateRes.status === 201) {
                saUserId = saCreateRes.body.id;
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
              INSERT INTO public.user_profiles (id, tenant_id, company_id, email, full_name, role)
              VALUES ($1, $2, $3, $4, 'TexaCore Support', 'super_admin')
              ON CONFLICT (id) DO UPDATE SET
                tenant_id  = EXCLUDED.tenant_id,
                company_id = EXCLUDED.company_id,
                role       = 'super_admin'
            `, [saUserId, tenantId, companyId, SA_EMAIL]);

            await pgClient.query(`
              DO $$
              DECLARE v_sa_role_id uuid;
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

            await pgClient.query(`
              INSERT INTO public.super_admins (user_id, email, is_active)
              VALUES ($1, $2, true)
              ON CONFLICT (user_id) DO NOTHING
            `, [saUserId, SA_EMAIL]);
          }

          // Link orphan auth users
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
          console.warn('[API] ⚠️ Super admin provisioning error:', syncErr.message);
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
            const documentsDir = path.join(require('os').homedir(), 'Documents', 'TexaCore');
            if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true });
            const tcdbPath = path.join(documentsDir, rsfCompanyName + '.tcdb');
            
            console.log('[API] 🔧 Creating TCDB backup...');
            console.log('[API]   pg_dump path:', PG_BIN_DIR);
            console.log('[API]   target:', tcdbPath);
            
            backupManager = new BackupManager({
              pgBinDir: PG_BIN_DIR,
              dbHost: 'localhost',
              dbPort: PG_PORT,
              dbName: 'postgres',
              dbUser: 'postgres',
              dbPassword: DB_PASSWORD,
              backupPath: tcdbPath,
              encryptionKey: 'texacore-default-backup-key-2026',
              intervalMs: 5 * 60 * 1000,
              onProgress: (phase, detail) => console.log(`[Backup] ${phase}: ${detail}`),
              onError: (err) => console.error('[Backup] Error:', err.message),
            });

            const backupResult = await backupManager.backup();
            if (backupResult) {
              result.tcdbPath = tcdbPath;
              console.log('[API] ✅ TCDB backup created:', tcdbPath, `(${(backupResult.size / 1024).toFixed(0)} KB)`);
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

  // 404
  res.writeHead(404);
  res.end();
});

// ─── Start Server ─────────────────────────────────────────────
const PORT = 1960;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ✅ TexaCore Standalone API Server listening on port ${PORT}`);
  console.log(`  📡 Endpoints:`);
  console.log(`     GET  /api/ping`);
  console.log(`     GET  /api/companies`);
  console.log(`     POST /api/import-rsf`);
  console.log(`     POST /api/delete-company\n`);
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
        const tcdbDir = path.join(require('os').homedir(), 'Documents', 'TexaCore');
        if (!fs.existsSync(tcdbDir)) fs.mkdirSync(tcdbDir, { recursive: true });
        const tcdbPath = path.join(tcdbDir, companyName + '.tcdb');
        
        backupManager = new BackupManager({
          pgBinDir: PG_BIN_DIR,
          dbHost: 'localhost',
          dbPort: PG_PORT,
          dbName: 'postgres',
          dbUser: 'postgres',
          dbPassword: DB_PASSWORD,
          backupPath: tcdbPath,
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
