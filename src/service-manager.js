// ════════════════════════════════════════════════════════════════
// 🔧 TexaCore ServiceManager — Embedded Binary Lifecycle
// Replaces Docker with direct child_process management
// ════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const http = require('http');
const express = require('express');
const net = require('net');
const MigrationRunner = require('./migration-runner');
const { getOrCreateSecrets } = require('./secrets');
const { getVendorAccount } = require('./vendor-support');

// ─── Constants (defaults — actual ports may change at runtime) ───
const JWT_SECRET = 'texacore-jwt-secret-at-least-32-characters-long';
const PG_PORT = 54322;
const DEFAULT_POSTGREST_PORT = 3000;
const DEFAULT_GOTRUE_PORT = 9999;
const DEFAULT_API_PORT = 54321; // Unified API port (replaces Kong)

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1sb2NhbCIsInJlZiI6InRleGFjb3JlLWxvY2FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMzQ1MzUsImV4cCI6MjA5MjU5NDUzNX0.aEuY0oBAUi1C9XHpr_xFEtvPDVXYrIdnjJsZUgWJxSk';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1sb2NhbCIsInJlZiI6InRleGFjb3JlLWxvY2FsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzIzNDUzNSwiZXhwIjoyMDkyNTk0NTM1fQ.8iGFw0gctL08j8y64qadPceHOR2I0GSGCPg69UJ81gs';

class ServiceManager {
  constructor(appDataDir) {
    this.appDataDir = appDataDir;
    this.dataDir = path.join(appDataDir, 'texacore-data');
    this.pgDataDir = path.join(this.dataDir, 'pgdata');
    this.logDir = path.join(this.dataDir, 'logs');

    // Resolve bin directory (packaged vs dev)
    const isPackaged = require('electron').app.isPackaged;
    if (isPackaged) {
      this.binsDir = path.join(process.resourcesPath, 'bin');
    } else {
      // Dev mode: look for platform-specific binaries
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
      const platform = process.platform === 'darwin' ? 'macos' : 'win';
      this.binsDir = path.join(__dirname, '..', 'bin', `${platform}-${arch}`);
    }

    this.processes = {};
    this.status = 'stopped'; // stopped | starting | running | error
    this.dbPassword = 'texacore-local-super-secret';
    // Per-install secrets: unique JWT secret + anon/service keys per machine so
    // extracting them from one DMG can't forge tokens against another install.
    // Existing data dirs (already provisioned) keep the legacy values, so this
    // is a no-op for them; only fresh installs get unique secrets.
    const _secrets = getOrCreateSecrets(this.dataDir);
    this.jwtSecret = _secrets.jwtSecret;
    this.anonKey = _secrets.anonKey;
    this.serviceKey = _secrets.serviceKey;
    this.proxyServer = null;
    this.onMigrationProgress = null; // callback: (step, total, name) => void

    // Active ports (may differ from defaults if port was busy)
    this.activePostgrestPort = DEFAULT_POSTGREST_PORT;
    this.activeGotruePort = DEFAULT_GOTRUE_PORT;
    this.activeApiPort = DEFAULT_API_PORT;

    // Resolve migrations directory (packaged vs dev)
    if (isPackaged) {
      this.migrationsDir = path.join(process.resourcesPath, 'migrations');
    } else {
      this.migrationsDir = path.join(__dirname, '..', 'migrations');
    }

    // Ensure directories
    for (const dir of [this.dataDir, this.logDir]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    }
  }

  // ─── Binary Paths ────────────────────────────────────────────
  get isWindows() { return process.platform === 'win32'; }
  get pgBin() { return path.join(this.binsDir, 'pg', 'bin'); }
  get postgrestBin() {
    const name = this.isWindows ? 'postgrest.exe' : 'postgrest';
    return path.join(this.binsDir, 'postgrest', name);
  }
  get gotrueBin() {
    const name = this.isWindows ? 'auth.exe' : 'auth';
    return path.join(this.binsDir, 'gotrue', name);
  }

  // ─── Status Check ────────────────────────────────────────────
  isRunning() { return this.status === 'running'; }

  async getHealth() {
    const pg = !!this.processes.postgres;
    const rest = !!this.processes.postgrest;
    const auth = !!this.processes.gotrue;
    let pgReady = false;

    if (pg) {
      try {
        const pgIsReady = this.isWindows ? 'pg_isready.exe' : 'pg_isready';
        const envOpts = this.isWindows ? { timeout: 3000, env: { ...process.env, PATH: this.pgBin + ';' + (process.env.PATH || '') } } : { timeout: 3000 };
        execSync(`"${path.join(this.pgBin, pgIsReady)}" -p ${PG_PORT} -h localhost`, envOpts);
        pgReady = true;
      } catch { /* not ready */ }
    }

    return {
      running: pg && rest && auth && pgReady,
      health: pgReady && rest && auth ? 'healthy' : (pg ? 'starting' : 'stopped'),
      services: { postgres: pgReady, postgrest: rest, gotrue: auth }
    };
  }

  // ─── Port Check ──────────────────────────────────────────────
  _isPortFree(port) {
    return new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => { srv.close(); resolve(true); });
      srv.listen(port, '127.0.0.1');
    });
  }

  // ─── Find Available Port ─────────────────────────────────────
  // Tries the preferred port first, then increments up to maxAttempts
  async _findAvailablePort(preferredPort, maxAttempts = 20) {
    for (let offset = 0; offset < maxAttempts; offset++) {
      const port = preferredPort + offset;
      if (await this._isPortFree(port)) {
        if (offset > 0) {
          console.log(`[ServiceManager] Port ${preferredPort} busy → using ${port} instead`);
        }
        return port;
      }
    }
    // Last resort: try to kill whatever is on the preferred port
    console.warn(`[ServiceManager] No free port found near ${preferredPort}, attempting to free it...`);
    await this._killPortProcess(preferredPort);
    return preferredPort;
  }

  // ─── Kill Process on Port ────────────────────────────────────
  async _killPortProcess(port) {
    try {
      if (this.isWindows) {
        execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /F /PID %a`, { stdio: 'ignore', timeout: 5000 });
      } else {
        execSync(`lsof -ti :${port} -P | xargs kill -9 2>/dev/null`, { stdio: 'ignore', timeout: 5000 });
      }
      console.log(`[ServiceManager] Freed port ${port}`);
      // Wait a moment for OS to release the port
      await this._sleep(500);
    } catch {
      console.warn(`[ServiceManager] Could not free port ${port}`);
    }
  }

  // ─── Initialize Database (first run only) ────────────────────
  async initDatabase() {
    if (fs.existsSync(path.join(this.pgDataDir, 'PG_VERSION'))) {
      console.log('[ServiceManager] Database already initialized');
      // Auto-fix: remove 'local' lines from pg_hba.conf on Windows (they cause startup failure)
      if (this.isWindows) {
        const hbaPath = path.join(this.pgDataDir, 'pg_hba.conf');
        if (fs.existsSync(hbaPath)) {
          let hba = fs.readFileSync(hbaPath, 'utf8');
          if (hba.includes('local   all')) {
            console.log('[ServiceManager] Fixing pg_hba.conf for Windows (removing unix socket lines)...');
            hba = hba.split('\n').filter(l => !l.startsWith('local ')).join('\n');
            fs.writeFileSync(hbaPath, hba);
          }
        }
      }
      return;
    }
    // Auto-fix: if pgdata dir exists but has NO PG_VERSION, it's corrupted/leftover — clean it
    if (fs.existsSync(this.pgDataDir) && !fs.existsSync(path.join(this.pgDataDir, 'PG_VERSION'))) {
      console.log('[ServiceManager] pgdata exists but no PG_VERSION — cleaning for fresh init...');
      try {
        fs.rmSync(this.pgDataDir, { recursive: true, force: true });
        fs.mkdirSync(this.pgDataDir, { recursive: true });
      } catch (cleanErr) {
        console.warn('[ServiceManager] Could not clean pgdata:', cleanErr.message);
      }
    }

    console.log('[ServiceManager] Initializing database for first time...');
    const initdb = path.join(this.pgBin, this.isWindows ? 'initdb.exe' : 'initdb');

    return new Promise((resolve, reject) => {
      // On Windows, DLLs must be loadable — add pg/bin to PATH
      const spawnEnv = { ...process.env };
      if (this.isWindows) {
        spawnEnv.PATH = this.pgBin + ';' + (spawnEnv.PATH || '');
      }

      const proc = spawn(initdb, [
        '-D', this.pgDataDir,
        '-U', 'postgres',
        '--no-locale',
        '-E', 'UTF8'
      ], { env: spawnEnv });

      let errOut = '';
      let stdOut = '';
      proc.stdout.on('data', d => stdOut += d.toString());
      proc.stderr.on('data', d => errOut += d.toString());
      proc.on('close', code => {
        if (code === 0) {
          console.log('[ServiceManager] Database initialized successfully');
          // Configure pg_hba.conf for local trust auth
          const hbaPath = path.join(this.pgDataDir, 'pg_hba.conf');
          const hbaLines = [
            '# TYPE  DATABASE  USER  ADDRESS  METHOD',
            'host    all       all   127.0.0.1/32  trust',
            'host    all       all   ::1/128       trust',
          ];
          // Unix socket auth — not supported on Windows
          if (!this.isWindows) {
            hbaLines.splice(1, 0, 'local   all       all              trust');
          }
          fs.writeFileSync(hbaPath, hbaLines.join('\n') + '\n');
          resolve();
        } else {
          console.error('[ServiceManager] initdb stderr:', errOut);
          console.error('[ServiceManager] initdb stdout:', stdOut);
          reject(new Error(`initdb failed (${code}): ${errOut}`));
        }
      });
    });
  }

  // ─── Start PostgreSQL ────────────────────────────────────────
  async startPostgres() {
    if (this.processes.postgres) return;

    // Check port — auto-kill stale PostgreSQL if needed
    if (!await this._isPortFree(PG_PORT)) {
      console.warn(`[ServiceManager] Port ${PG_PORT} in use — attempting to stop stale PostgreSQL...`);
      
      // Try pg_ctl stop first (graceful)
      try {
        const pgCtl = path.join(this.pgBin, this.isWindows ? 'pg_ctl.exe' : 'pg_ctl');
        const stopEnv = { ...process.env };
        if (this.isWindows) {
          stopEnv.PATH = this.pgBin + ';' + (stopEnv.PATH || '');
        }
        execSync(`"${pgCtl}" stop -D "${this.pgDataDir}" -m fast -w -t 10`, { env: stopEnv, timeout: 15000, stdio: 'ignore' });
        console.log('[ServiceManager] Stale PostgreSQL stopped via pg_ctl');
        await this._sleep(1000);
      } catch {
        // pg_ctl failed — force kill by port
        console.warn('[ServiceManager] pg_ctl stop failed — force killing process on port', PG_PORT);
        try {
          if (this.isWindows) {
            // Find and kill process on port 54322
            const netstat = execSync(`netstat -ano | findstr :${PG_PORT}`, { timeout: 5000 }).toString();
            const lines = netstat.split('\n').filter(l => l.includes('LISTENING'));
            for (const line of lines) {
              const pid = line.trim().split(/\s+/).pop();
              if (pid && !isNaN(pid)) {
                try { execSync(`taskkill /F /PID ${pid}`, { timeout: 5000 }); } catch {}
              }
            }
          } else {
            execSync(`lsof -ti:${PG_PORT} | xargs kill -9 2>/dev/null || true`, { timeout: 5000 });
          }
          await this._sleep(2000);
        } catch { /* best effort */ }
      }
      
      // Re-check
      if (!await this._isPortFree(PG_PORT)) {
        throw new Error(`Port ${PG_PORT} is still in use after cleanup. Please manually close any PostgreSQL instance and try again.`);
      }
      console.log(`[ServiceManager] Port ${PG_PORT} is now free`);
    }

    console.log('[ServiceManager] Starting PostgreSQL on port', PG_PORT);
    const logFile = path.join(this.logDir, 'postgres.log');

    // Clear old log for clean diagnostics
    try { fs.writeFileSync(logFile, ''); } catch {}

    // Build environment
    const pgEnv = { ...process.env, PGDATA: this.pgDataDir };
    if (this.isWindows) {
      // Add pg/bin AND pg/lib to PATH for DLL loading
      const pgLib = path.join(this.binsDir, 'pg', 'lib');
      pgEnv.PATH = this.pgBin + ';' + pgLib + ';' + (pgEnv.PATH || '');
      // Help PostgreSQL find its share directory (timezone, config templates)
      pgEnv.PGSHAREDIR = path.join(this.binsDir, 'pg', 'share');
    } else {
      pgEnv.LC_ALL = 'en_US.UTF-8';
      pgEnv.LANG = 'en_US.UTF-8';
    }

    if (this.isWindows) {
      // Windows: Use pg_ctl to drop administrator privileges and start in background
      const pgCtl = path.join(this.pgBin, 'pg_ctl.exe');
      console.log('[ServiceManager] Using pg_ctl to start PostgreSQL on Windows');
      try {
        // -w waits for start. -t 30 sets timeout. -l sets log file. -o passes options to postgres.exe
        execSync(`"${pgCtl}" start -D "${this.pgDataDir}" -l "${logFile}" -w -t 30 -o "-p ${PG_PORT}"`, { env: pgEnv, stdio: 'ignore' });
        this.processes.postgres = { isPgCtl: true }; // dummy object to track status
        console.log('[ServiceManager] PostgreSQL is ready via pg_ctl');
        return;
      } catch (err) {
        let logContent = '';
        try { logContent = fs.readFileSync(logFile, 'utf8').slice(-2000); } catch {}
        console.error('[ServiceManager] PostgreSQL log:\n', logContent);
        throw new Error(`PostgreSQL failed to start via pg_ctl.\nLog: ${logContent}`);
      }
    }

    // Unix (macOS/Linux)
    const pgExe = 'postgres';
    const pgArgs = ['-D', this.pgDataDir, '-p', String(PG_PORT), '-k', '/tmp'];

    console.log('[ServiceManager] PostgreSQL binary:', path.join(this.pgBin, pgExe));
    console.log('[ServiceManager] pgDataDir:', this.pgDataDir);

    const pgProcess = spawn(path.join(this.pgBin, pgExe), pgArgs, {
      stdio: ['ignore', fs.openSync(logFile, 'a'), fs.openSync(logFile, 'a')],
      env: pgEnv
    });

    pgProcess.on('error', err => {
      console.error('[ServiceManager] PostgreSQL spawn error:', err.message);
      this.processes.postgres = null;
      this.status = 'error';
    });

    pgProcess.on('exit', (code) => {
      console.log('[ServiceManager] PostgreSQL exited with code', code);
      this.processes.postgres = null;
      if (this.status === 'running') this.status = 'error';
    });

    this.processes.postgres = pgProcess;

    // Wait for PostgreSQL to be ready
    for (let i = 0; i < 60; i++) {
      await this._sleep(500);

      // Check if process died
      if (!this.processes.postgres) {
        let logContent = '';
        try { logContent = fs.readFileSync(logFile, 'utf8').slice(-1000); } catch {}
        throw new Error(`PostgreSQL process exited unexpectedly.\nLog: ${logContent}`);
      }

      try {
        const pgIsReady = 'pg_isready';
        const readyEnv = { timeout: 3000 };
        execSync(`"${path.join(this.pgBin, pgIsReady)}" -p ${PG_PORT} -h localhost`, readyEnv);
        console.log('[ServiceManager] PostgreSQL is ready');
        return;
      } catch { /* retry */ }
    }

    // Timeout — read log for diagnostics
    let logContent = '';
    try { logContent = fs.readFileSync(logFile, 'utf8').slice(-2000); } catch {}
    console.error('[ServiceManager] PostgreSQL log:\n', logContent);
    throw new Error(`PostgreSQL failed to start within 30 seconds.\nLog: ${logContent}`);
  }

  // ─── Run SQL via psql ────────────────────────────────────────
  psqlExec(sql, dbName = 'postgres') {
    return new Promise((resolve, reject) => {
      const psqlExe = this.isWindows ? 'psql.exe' : 'psql';
      // On Windows, add pg/bin to PATH for DLL loading
      const spawnOpts = this.isWindows 
        ? { env: { ...process.env, PATH: this.pgBin + ';' + (process.env.PATH || '') } }
        : {};
      const psql = spawn(path.join(this.pgBin, psqlExe), [
        '-p', String(PG_PORT),
        '-h', 'localhost',
        '-U', 'postgres',
        '-d', dbName,
        '-v', 'ON_ERROR_STOP=1'
      ], spawnOpts);

      let errOut = '';
      let stdOut = '';
      psql.stdout.on('data', d => stdOut += d.toString());
      psql.stderr.on('data', d => errOut += d.toString());
      psql.on('error', err => reject(new Error(`psql spawn error: ${err.message}`)));
      psql.on('close', code => code === 0 ? resolve(stdOut) : reject(new Error(`psql(${code}): ${errOut}`)));
      psql.stdin.write(sql);
      psql.stdin.end();
    });
  }

  // ─── Setup Database Roles & Schema (first run) ───────────────
  async setupDatabaseRoles() {
    console.log('[ServiceManager] Setting up database roles...');

    // We no longer skip if authenticator exists because we want to ensure
    // that all schemas have the correct permissions (GRANTs are idempotent).
    try {
      await this.psqlExec("SELECT 1 FROM pg_roles WHERE rolname='authenticator'");
    } catch { /* ignore */ }

    const rolesSql = `
      -- Create essential roles for PostgREST and GoTrue
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_admin') THEN CREATE ROLE supabase_admin LOGIN SUPERUSER PASSWORD '${this.dbPassword}'; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN 
          CREATE ROLE authenticator LOGIN PASSWORD '${this.dbPassword}' NOINHERIT;
          GRANT anon TO authenticator;
          GRANT authenticated TO authenticator;
          GRANT service_role TO authenticator;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN 
          CREATE ROLE supabase_auth_admin LOGIN PASSWORD '${this.dbPassword}' NOINHERIT;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN 
          CREATE ROLE supabase_storage_admin LOGIN PASSWORD '${this.dbPassword}' NOINHERIT;
        END IF;
      END $$;

      -- Grant schema permissions
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      GRANT ALL ON SCHEMA public TO supabase_admin;
      GRANT ALL ON SCHEMA public TO supabase_auth_admin;
      ALTER ROLE supabase_auth_admin CREATEROLE CREATEDB;

      -- Create auth schema for GoTrue
      CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
      GRANT USAGE ON SCHEMA auth TO authenticator, supabase_auth_admin;

      -- Create extensions
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public;
      CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA public;
    `;

    await this.psqlExec(rolesSql);
    console.log('[ServiceManager] Database roles created');
  }

  // ─── Run GoTrue Migrations ───────────────────────────────────
  runGoTrueMigrations() {
    return new Promise((resolve, reject) => {
      console.log('[ServiceManager] Running GoTrue migrations...');
      const env = {
        ...process.env,
        API_EXTERNAL_URL: `http://localhost:${this.activeApiPort}`,
        GOTRUE_DB_DRIVER: 'postgres',
        DATABASE_URL: `postgres://supabase_auth_admin:${this.dbPassword}@localhost:${PG_PORT}/postgres?search_path=auth`,
        GOTRUE_JWT_SECRET: this.jwtSecret,
        GOTRUE_SITE_URL: `http://localhost:${this.activeApiPort}`
      };

      const proc = spawn(this.gotrueBin, ['migrate'], { env });
      
      let out = '';
      proc.stdout.on('data', d => out += d.toString());
      proc.stderr.on('data', d => out += d.toString());
      
      proc.on('close', code => {
        if (code === 0) {
          console.log('[ServiceManager] GoTrue migrations completed');
          resolve();
        } else {
          console.error('[ServiceManager] GoTrue migrate failed:', out);
          reject(new Error(`GoTrue migrate failed with code ${code}`));
        }
      });
    });
  }

  // ─── Start PostgREST ─────────────────────────────────────────
  async startPostgREST() {
    if (this.processes.postgrest) return;

    // Find an available port (auto-resolve conflicts)
    this.activePostgrestPort = await this._findAvailablePort(DEFAULT_POSTGREST_PORT);
    console.log('[ServiceManager] Starting PostgREST on port', this.activePostgrestPort);
    const logFile = path.join(this.logDir, 'postgrest.log');
    try { fs.writeFileSync(logFile, ''); } catch {}

    // Write PostgREST config file
    const configPath = path.join(this.dataDir, 'postgrest.conf');
    fs.writeFileSync(configPath, [
      `db-uri = "postgres://authenticator:${this.dbPassword}@127.0.0.1:${PG_PORT}/postgres"`,
      `db-schemas = "public"`,
      `db-anon-role = "anon"`,
      `jwt-secret = "${this.jwtSecret}"`,
      `server-port = ${this.activePostgrestPort}`,
      `server-host = "127.0.0.1"`,
      `db-use-legacy-gucs = false`,
      `app-settings.jwt_secret = "${this.jwtSecret}"`,
    ].join('\n') + '\n');

    // Build environment: add pg/lib and pg/bin to PATH for libpq.dll on Windows
    const env = { ...process.env };
    if (this.isWindows) {
      const pgLib = path.join(this.binsDir, 'pg', 'lib');
      env.PATH = this.pgBin + ';' + pgLib + ';' + (env.PATH || '');
    }

    const proc = spawn(this.postgrestBin, [configPath], { env });
    proc.stdout.on('data', d => { try { fs.appendFileSync(logFile, d); } catch {} });
    proc.stderr.on('data', d => { try { fs.appendFileSync(logFile, d); } catch {} });

    proc.on('error', err => {
      console.error('[ServiceManager] PostgREST spawn error:', err.message);
      this.processes.postgrest = null;
    });
    proc.on('exit', code => {
      console.log('[ServiceManager] PostgREST exited with code', code);
      this.processes.postgrest = null;
    });

    this.processes.postgrest = proc;

    // Wait for PostgREST
    for (let i = 0; i < 20; i++) {
      await this._sleep(500);
      
      if (!this.processes.postgrest) {
        let logContent = '';
        try { logContent = fs.readFileSync(logFile, 'utf8').slice(-1000); } catch {}
        throw new Error(`PostgREST process exited unexpectedly.\nLog: ${logContent}`);
      }

      if (await this._checkHttp(this.activePostgrestPort, '/')) {
        console.log('[ServiceManager] PostgREST is ready on port', this.activePostgrestPort);
        return;
      }
    }
    
    let logContent = '';
    try { logContent = fs.readFileSync(logFile, 'utf8').slice(-1000); } catch {}
    throw new Error(`PostgREST failed to start within 10 seconds.\nLog: ${logContent}`);
  }

  // ─── Start GoTrue ────────────────────────────────────────────
  async startGoTrue() {
    if (this.processes.gotrue) return;

    // Find an available port (auto-resolve conflicts)
    this.activeGotruePort = await this._findAvailablePort(DEFAULT_GOTRUE_PORT);
    console.log('[ServiceManager] Starting GoTrue on port', this.activeGotruePort);
    const logFile = path.join(this.logDir, 'gotrue.log');
    try { fs.writeFileSync(logFile, ''); } catch {}

    const env = {
      ...process.env,
      GOTRUE_API_HOST: '127.0.0.1',
      GOTRUE_API_PORT: String(this.activeGotruePort),
      API_EXTERNAL_URL: `http://localhost:${this.activeApiPort}`,
      GOTRUE_DB_DRIVER: 'postgres',
      GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${this.dbPassword}@127.0.0.1:${PG_PORT}/postgres?search_path=auth`,
      GOTRUE_SITE_URL: `http://localhost:${this.activeApiPort}`,
      GOTRUE_DISABLE_SIGNUP: 'false',
      GOTRUE_JWT_ADMIN_ROLES: 'service_role',
      GOTRUE_JWT_AUD: 'authenticated',
      GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_JWT_EXP: '3600',
      GOTRUE_JWT_SECRET: this.jwtSecret,
      GOTRUE_MAILER_AUTOCONFIRM: 'true',
      GOTRUE_SMS_AUTOCONFIRM: 'true',
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
      GOTRUE_EXTERNAL_PHONE_ENABLED: 'false',
      DATABASE_URL: `postgres://supabase_auth_admin:${this.dbPassword}@127.0.0.1:${PG_PORT}/postgres?search_path=auth`,
    };

    if (this.isWindows) {
      const pgLib = path.join(this.binsDir, 'pg', 'lib');
      env.PATH = this.pgBin + ';' + pgLib + ';' + (env.PATH || '');
    }

    const proc = spawn(this.gotrueBin, ['serve'], { env });
    proc.stdout.on('data', d => { try { fs.appendFileSync(logFile, d); } catch {} });
    proc.stderr.on('data', d => { try { fs.appendFileSync(logFile, d); } catch {} });

    proc.on('error', err => {
      console.error('[ServiceManager] GoTrue error:', err.message);
      this.processes.gotrue = null;
    });
    proc.on('exit', code => {
      console.log('[ServiceManager] GoTrue exited with code', code);
      this.processes.gotrue = null;
    });

    this.processes.gotrue = proc;

    // Wait for GoTrue
    for (let i = 0; i < 20; i++) {
      await this._sleep(500);
      if (await this._checkHttp(this.activeGotruePort, '/health')) {
        console.log('[ServiceManager] GoTrue is ready');
        return;
      }
    }
    throw new Error('GoTrue failed to start within 10 seconds');
  }

  // ─── API Proxy (replaces Kong) ───────────────────────────────
  startApiProxy() {
    if (this.proxyServer) return;

    // Find an available port (auto-resolve conflicts)
    // Note: API_PORT is resolved synchronously since _findAvailablePort is async
    // We'll set it before calling this method
    console.log('[ServiceManager] Starting API proxy on port', this.activeApiPort);

    this.proxyServer = http.createServer((req, res) => {
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
        targetPort = this.activeGotruePort;
        targetPath = req.url.replace('/auth/v1', '');
        if (!targetPath) targetPath = '/';
      } else if (req.url.startsWith('/rest/v1/')) {
        // REST routes → PostgREST
        targetPort = this.activePostgrestPort;
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

    this.proxyServer.listen(this.activeApiPort, '0.0.0.0', () => {
      console.log(`[ServiceManager] API proxy listening on port ${this.activeApiPort}`);
    });

    this.proxyServer.on('error', (err) => {
      console.error('[ServiceManager] Proxy error:', err.message);
    });
  }

  // ─── Run Migrations ──────────────────────────────────────────
  async runMigrations() {
    if (!fs.existsSync(path.join(this.migrationsDir, 'migrations.json'))) {
      console.log('[ServiceManager] No migrations.json found — skipping migrations');
      return { applied: 0, total: 0 };
    }

    const runner = new MigrationRunner({
      psqlExec: (sql, db) => this.psqlExec(sql, db),
      pgBin: this.pgBin,
      isWindows: this.isWindows,
      migrationsDir: this.migrationsDir,
      onProgress: (step, total, name) => {
        console.log(`[Migration] (${step}/${total}) ${name}`);
        if (this.onMigrationProgress) this.onMigrationProgress(step, total, name);
      },
    });

    return runner.runAll();
  }

  // ─── Get Migration Status ────────────────────────────────────
  async getMigrationStatus() {
    if (!fs.existsSync(path.join(this.migrationsDir, 'migrations.json'))) {
      return { total: 0, applied: 0, pending: 0 };
    }
    const runner = new MigrationRunner({
      psqlExec: (sql, db) => this.psqlExec(sql, db),
      migrationsDir: this.migrationsDir,
    });
    return runner.getStatus();
  }

  // ─── Start All Services ──────────────────────────────────────
  async startAll(options = {}) {
    if (this.status === 'running') return { success: true };
    // Guard against concurrent entry (e.g. auto-start-on-launch racing the user
    // clicking "Start"): both would otherwise spawn a second postgres on the
    // same data dir and run migrations twice. Return the one in-flight start.
    if (this._startInFlight) return this._startInFlight;
    this._startInFlight = this._startAllInner(options);
    try { return await this._startInFlight; } finally { this._startInFlight = null; }
  }

  async _startAllInner(options = {}) {
    if (this.status === 'running') return { success: true };
    this.status = 'starting';
    this.dbPassword = options.dbPassword || this.dbPassword;
    this.onMigrationProgress = options.onMigrationProgress || null;

    try {
      // 1. Initialize database if needed
      await this.initDatabase();

      // 2. Start PostgreSQL
      await this.startPostgres();

      // 3. Setup roles (first run)
      await this.setupDatabaseRoles();

      // 3.5. Run GoTrue migrations to create auth.users
      await this.runGoTrueMigrations();

      // 4. Apply pending migrations
      const migrationResult = await this.runMigrations();
      console.log(`[ServiceManager] Migrations: ${migrationResult.applied} applied, ${migrationResult.failed || 0} failed`);

      // 4.5. Ensure PostgREST roles have access to all migrated objects
      await this.psqlExec(`
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
        GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
      `);
      console.log('[ServiceManager] PostgREST role grants applied');

      // 4.6. Disable RLS on all public tables (self-hosted = trusted local environment)
      //      Production RLS policies use auth.uid() which doesn't work reliably with local GoTrue
      await this.psqlExec(`
        DO $$ 
        DECLARE r RECORD;
        BEGIN
          FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
            EXECUTE 'ALTER TABLE public.' || quote_ident(r.tablename) || ' DISABLE ROW LEVEL SECURITY';
          END LOOP;
          RAISE NOTICE 'RLS disabled on all public tables for self-hosted mode';
        END $$;
        -- Reload PostgREST schema cache
        NOTIFY pgrst, 'reload schema';
      `);
      console.log('[ServiceManager] RLS disabled for self-hosted mode + schema cache reloaded');

      // 5. Start PostgREST
      await this.startPostgREST();

      // 6. Start GoTrue
      await this.startGoTrue();

      // 7. Start API Proxy (replaces Kong) — resolve port first
      this.activeApiPort = await this._findAvailablePort(DEFAULT_API_PORT);
      this.startApiProxy();

      // 7.5. Ensure super admin user exists
      await this._ensureSuperAdmin();

      // 7.6. Sync the admin-portal password into the DB (default = license key,
      // or the manager's custom value). Idempotent; keeps the gate correct even
      // after a restore replaced the DB.
      await this.syncAdminPassword();

      // 8. Start Frontend Web Server
      const uiPort = options.port || 80;
      await this.startFrontendServer(uiPort);

      // 9. Start Cloudflare Tunnel (if configured)
      // Reuse the existing tunnel token (same tunnel id) so Stop→Start and
      // launch reconnect in ~1s instead of the variable 0-60s DNS propagation
      // (transient Error 1033) that a fresh re-registration causes each time.
      // First run (no token) still re-registers inside startCloudflared; the
      // explicit repair path (/api/tunnel-fix) fetches a fresh token on demand.
      await this.startCloudflared({ skipReregister: true });

      // 10. Install/Start TexaCore MDM (MeshAgent)
      await this.installMeshAgent();

      this.status = 'running';
      console.log('[ServiceManager] ✅ All services started successfully');
      return { success: true, migrations: migrationResult };
    } catch (err) {
      console.error('[ServiceManager] ❌ Failed to start:', err.message);
      this.status = 'error';
      await this.stopAll(); // Cleanup on failure
      return { success: false, error: err.message };
    }
  }

  // ─── Start Frontend Server ───────────────────────────────────
  startFrontendServer(port) {
    return new Promise((resolve) => {
      if (this.frontendServer) return resolve();

      const app = express();
      
      // Determine frontend path (packaged app or dev mode)
      const isPackaged = require('electron').app.isPackaged;
      const frontendPath = isPackaged 
        ? path.join(process.resourcesPath, 'frontend')
        : path.join(__dirname, '..', 'frontend');

      if (!fs.existsSync(frontendPath)) {
        console.warn('[ServiceManager] Frontend build not found at:', frontendPath);
        return resolve(); // Skip if not found, don't crash
      }

      console.log(`[ServiceManager] Serving frontend from: ${frontendPath} on port ${port}`);

      // Per-install anon key (served to the SPA at runtime — see /config.js).
      const anonKey = this.anonKey;

      // ─── Cloud-Aware config.js ─────────────────────────────
      // When accessed via subdomain (e.g. textile001.texacore.ai),
      // return relative URL so API calls go through THIS server's proxy
      // instead of localhost:54321 which only works on the same machine.
      app.get('/config.js', (req, res) => {
        const host = req.headers.host || '';
        const isCloudAccess = host.includes('.texacore.ai') || host.includes('.texacore.com');
        const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');

        let supabaseUrl;
        if (isCloudAccess) {
          // Cloud access: use the same origin so requests go through our proxy
          supabaseUrl = `${protocol}://${host}/_supabase`;
          console.log(`[config.js] Cloud access detected (${host}) → using proxy URL: ${supabaseUrl}`);
        } else {
          // Local access: connect directly to API proxy
          supabaseUrl = `http://localhost:${this.activeApiPort}`;
        }

        const configJs = `
// Auto-generated by TexaCore Service Manager
window.__TEXACORE_CONFIG__ = {
  supabaseUrl: "${supabaseUrl}",
  supabaseKey: "${anonKey}",
  mode: "selfhosted",
  VITE_SUPABASE_URL: "${supabaseUrl}",
  VITE_SUPABASE_ANON_KEY: "${anonKey}"
};
`;
        res.type('application/javascript');
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.send(configJs);
      });

      // ─── API Proxy for Cloud Access ────────────────────────
      // Routes ALL /_supabase/* → Supabase API Gateway (Kong)
      // Kong handles /rest/v1, /auth/v1, /realtime/v1 routing internally
      const proxyRequest = (req, res) => {
        // Strip /_supabase prefix, keep the rest (e.g. /rest/v1/exchange_rates)
        const targetPath = req.url.replace('/_supabase', '') || '/';
        const proxyOptions = {
          hostname: '127.0.0.1',
          port: this.activeApiPort,  // Kong gateway (54321)
          path: targetPath,
          method: req.method,
          headers: { ...req.headers, host: `127.0.0.1:${this.activeApiPort}` },
        };

        console.log(`[CloudProxy] ${req.method} ${targetPath} → localhost:${this.activeApiPort}`);

        const proxyReq = http.request(proxyOptions, (proxyRes) => {
          // Add CORS headers
          proxyRes.headers['access-control-allow-origin'] = '*';
          proxyRes.headers['access-control-allow-methods'] = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
          proxyRes.headers['access-control-allow-headers'] = 'Content-Type, Authorization, apikey, x-client-info, Accept, Range, X-Upsert, Prefer, x-supabase-api-version, accept-profile, content-profile';
          proxyRes.headers['access-control-expose-headers'] = 'Content-Range, X-Total-Count';
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          console.error(`[CloudProxy] Error proxying to port ${this.activeApiPort}:`, err.message);
          res.status(502).json({ error: 'Service unavailable', message: err.message });
        });

        req.pipe(proxyReq);
      };

      // CORS preflight for proxy routes
      app.options('/_supabase/*', (req, res) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, x-client-info, Accept, Range, X-Upsert, Prefer, x-supabase-api-version, accept-profile, content-profile');
        res.set('Access-Control-Expose-Headers', 'Content-Range, X-Total-Count');
        res.sendStatus(204);
      });

      // ALL Supabase API proxy (REST, Auth, Storage, etc.)
      app.all('/_supabase/*', (req, res) => {
        proxyRequest(req, res);
      });

      // Admin API proxy (/api/companies, /api/delete-company, etc.)
      // These are served by the Electron admin server on port 1960.
      // Destructive/admin operations must NOT be reachable over the public
      // tunnel (subdomain.texacore.ai) — only locally. The full set of
      // destructive paths is also CSRF-guarded inside the 1960 server.
      const ADMIN_LOCAL_ONLY = new Set([
        '/api/delete-company', '/api/restore-tcdb', '/api/import-rsf', '/api/import-rsf-path',
        '/api/create-local-company', '/api/backup', '/api/open-tcdb', '/api/tunnel-fix', '/api/tunnel-restart',
      ]);
      app.all('/api/*', (req, res) => {
        const host = req.headers.host || '';
        const isCloudAccess = host.includes('.texacore.ai') || host.includes('.texacore.com');
        const urlPath = (req.url || '').split('?')[0];
        if (isCloudAccess && ADMIN_LOCAL_ONLY.has(urlPath)) {
          res.status(403).json({ error: 'This administrative operation is local-only and cannot be performed remotely.' });
          return;
        }
        const proxyOptions = {
          hostname: '127.0.0.1',
          port: 1960,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: '127.0.0.1:1960' },
        };

        const proxyReq = http.request(proxyOptions, (proxyRes) => {
          proxyRes.headers['access-control-allow-origin'] = '*';
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          console.error('[AdminProxy] Error:', err.message);
          res.status(502).json({ error: 'Admin API unavailable' });
        });

        req.pipe(proxyReq);
      });

      // ⛔ Never cache the SPA shell + service worker. Content-hashed assets are
      // immutable, but index.html / sw.js MUST always be revalidated — otherwise a
      // subdomain origin (textile001.texacore.ai, served via Cloudflare which has its
      // own edge cache + a separate PWA cache from localhost) keeps serving a STALE
      // frontend after an update, so the same user sees a different (older) module
      // list than on localhost. no-store forces the fresh shell → SW updates → match.
      const NO_STORE = (req, res, next) => {
        const p = req.path;
        if (p === '/' || p === '/index.html' || p === '/sw.js' || p === '/registerSW.js'
            || p.endsWith('.webmanifest') || p === '/manifest.json' || p === '/workbox-config.js') {
          res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.set('Pragma', 'no-cache');
          res.set('Expires', '0');
        }
        next();
      };
      app.use(NO_STORE);

      // Serve static files
      app.use(express.static(frontendPath));

      // Handle SPA routing (fallback to index.html) — shell is never cached
      app.use((req, res) => {
        res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.sendFile(path.join(frontendPath, 'index.html'));
      });

      this.frontendServer = app.listen(port, '0.0.0.0', () => {
        console.log(`[ServiceManager] Frontend server listening on port ${port}`);
        resolve();
      }).on('error', (err) => {
        console.error(`[ServiceManager] Frontend server failed to bind to port ${port}:`, err.message);
        // If port 80 fails (EACCES on Mac), try 8080 automatically
        if (err.code === 'EACCES' && port === 80) {
          console.log('[ServiceManager] Retrying frontend on port 8080...');
          this.frontendServer = app.listen(8080, '0.0.0.0', () => {
             console.log('[ServiceManager] Frontend server listening on fallback port 8080');
             resolve();
          });
        } else {
          resolve(); // Don't crash the whole backend if UI server fails
        }
      });

      // ─── WebSocket Proxy for Realtime ──────────────────────
      // Handle WebSocket upgrade for /_supabase/realtime/v1/websocket
      this.frontendServer.on('upgrade', (req, socket, head) => {
        if (!req.url.startsWith('/_supabase/realtime/')) {
          socket.destroy();
          return;
        }

        const targetPath = req.url.replace('/_supabase/realtime/', '/realtime/');
        const wsReq = http.request({
          hostname: '127.0.0.1',
          port: this.activeApiPort,
          path: targetPath,
          method: 'GET',
          headers: {
            ...req.headers,
            host: `127.0.0.1:${this.activeApiPort}`,
          },
        });

        wsReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
          socket.write(
            'HTTP/1.1 101 Switching Protocols\r\n' +
            Object.entries(proxyRes.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
            '\r\n\r\n'
          );
          if (proxyHead.length > 0) socket.write(proxyHead);
          proxySocket.pipe(socket);
          socket.pipe(proxySocket);

          proxySocket.on('error', () => socket.destroy());
          socket.on('error', () => proxySocket.destroy());
        });

        wsReq.on('error', (err) => {
          console.error('[CloudProxy] WebSocket proxy error:', err.message);
          socket.destroy();
        });

        wsReq.end();
      });
    });
  }

  // ─── Start Cloudflare Tunnel ─────────────────────────────────
  async startCloudflared({ skipReregister = false, skipVerify = false } = {}) {
    if (this.processes.cloudflared) return;

    // Read config to check if cloud access is enabled
    const configPath = path.join(this.dataDir, 'config.json');
    let config = {};
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch { /* ignore */ }

    if (!config.enableCloud) {
      console.log('[ServiceManager] Cloud access not enabled — skipping cloudflared');
      return;
    }

    if (!config.subdomain) {
      console.log('[ServiceManager] No subdomain configured — skipping cloudflared');
      return;
    }

    // The user may have deleted this subdomain from Cloudflare. Reconnecting the
    // saved tunnel would just serve a dead/blank URL. Verify the DNS record still
    // exists first; if it's gone, skip the tunnel — the app prompts the user to
    // create a new subdomain. (Only a definitive NXDOMAIN counts as "deleted";
    // a transient network/DNS error falls through and still attempts the tunnel.)
    // skipVerify is passed right after a fresh registration: the record was just
    // created and may not have propagated to public DNS yet, but cloudflared
    // still connects to the edge via the token regardless.
    if (!skipVerify) {
      try {
        await require('dns').promises.resolve4(`${config.subdomain}.texacore.ai`);
      } catch (dnsErr) {
        if (dnsErr && (dnsErr.code === 'ENOTFOUND' || dnsErr.code === 'ENODATA')) {
          console.warn(`[ServiceManager] ⚠️ Subdomain "${config.subdomain}.texacore.ai" no longer resolves — it was deleted. Skipping tunnel; create a new subdomain from the app.`);
          return;
        }
      }
    }

    // Normal starts (launch, Stop→Start, toggle, restart) REUSE the existing
    // token — same tunnel id, so Cloudflare DNS never changes and it reconnects
    // in ~1s. Re-registering would mint a NEW tunnel id every time, forcing DNS
    // re-propagation (variable 0-60s, transient Error 1033). We re-register only
    // when there's no token yet (first run) or via the explicit /api/tunnel-fix
    // repair path. callers pass skipReregister:true; the no-token case still
    // falls through to re-registration below.
    if (skipReregister && config.tunnelToken) {
      console.log('[ServiceManager] ♻️ Reusing existing tunnel token (fast reconnect, same tunnel)');
    } else {
    console.log(`[ServiceManager] 🔄 Refreshing tunnel token for "${config.subdomain}"...`);
    try {
      const https = require('https');
      const autoFixResult = await new Promise((resolve, reject) => {
        const postData = JSON.stringify({
          licenseKey: config.licenseKey || 'desktop-user',
          subdomain: config.subdomain,
          machineId: require('os').hostname(),
          companyName: 'TexaCore Desktop'
        });
        const url = new URL('https://wzkklenfsaepegymfxfz.supabase.co/functions/v1/register-subdomain');
        const reqOpts = {
          hostname: url.hostname, port: 443, path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
        };
        const req = https.request(reqOpts, (res) => {
          let body = '';
          res.on('data', c => body += c);
          res.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid response')); } });
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
        req.write(postData);
        req.end();
      });

      if (autoFixResult.success && autoFixResult.tunnel_token) {
        config.tunnelToken = autoFixResult.tunnel_token;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(`[ServiceManager] ✅ Fresh tunnel token obtained (${config.tunnelToken.length} chars)`);
      } else {
        console.error('[ServiceManager] ❌ Token refresh failed:', autoFixResult.error || 'Unknown error');
        // If we have an old token, try it anyway
        if (!config.tunnelToken) return;
        console.log('[ServiceManager] Falling back to existing token...');
      }
    } catch (fixErr) {
      console.error('[ServiceManager] ❌ Token refresh network error:', fixErr.message);
      // If we have an old token, try it anyway
      if (!config.tunnelToken) return;
      console.log('[ServiceManager] Falling back to existing token...');
    }
    } // end token re-register (skipped on fast reconnect)

    // Find cloudflared binary (cross-platform)
    const isWin = process.platform === 'win32';
    const cfExe = isWin ? 'cloudflared.exe' : 'cloudflared';
    let cloudflaredBin = null;
    
    const possiblePaths = [];
    // 1. Bundled with app
    possiblePaths.push(path.join(this.binsDir, 'cloudflared', cfExe));
    // 2. System paths
    if (isWin) {
      possiblePaths.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'cloudflared', cfExe));
      possiblePaths.push(path.join(process.env.LOCALAPPDATA || '', 'cloudflared', cfExe));
      const userProfile = process.env.USERPROFILE || '';
      if (userProfile) possiblePaths.push(path.join(userProfile, '.cloudflared', cfExe));
    } else {
      possiblePaths.push('/opt/homebrew/bin/cloudflared');
      possiblePaths.push('/usr/local/bin/cloudflared');
      possiblePaths.push('/usr/bin/cloudflared');
    }
    
    for (const p of possiblePaths) {
      if (p && fs.existsSync(p)) { cloudflaredBin = p; break; }
    }

    if (!cloudflaredBin) {
      try {
        const findCmd = isWin ? 'where cloudflared' : 'which cloudflared';
        cloudflaredBin = execSync(findCmd, { timeout: 3000 }).toString().trim().split('\n')[0].trim();
        if (!fs.existsSync(cloudflaredBin)) cloudflaredBin = null;
      } catch {
        console.warn('[ServiceManager] cloudflared not found — cloud access unavailable');
        return;
      }
    }

    console.log(`[ServiceManager] Starting Cloudflare Tunnel (${config.subdomain}.texacore.ai)...`);
    console.log(`[ServiceManager] cloudflared binary: ${cloudflaredBin}`);
    const logFile = path.join(this.logDir, 'cloudflared.log');

    const frontendPort = (this.frontendServer && this.frontendServer.address()) 
      ? this.frontendServer.address().port 
      : 8080;
    console.log(`[ServiceManager] Tunnel will route to localhost:${frontendPort}`);

    const startTunnelProcess = () => {
      const proc = spawn(cloudflaredBin, [
        'tunnel', '--no-autoupdate', 'run',
        '--token', config.tunnelToken
      ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      const logStream = fs.createWriteStream(logFile, { flags: 'a' });
      proc.stdout.on('data', (data) => {
        const line = data.toString().trim();
        logStream.write(line + '\n');
        if (line.includes('ERR') || line.includes('error') || line.includes('failed')) {
          console.error(`[cloudflared] ${line}`);
        } else if (line.includes('Registered') || line.includes('connected') || line.includes('serving')) {
          console.log(`[cloudflared] ✅ ${line}`);
        }
      });
      proc.stderr.on('data', (data) => {
        const line = data.toString().trim();
        logStream.write(`[stderr] ${line}\n`);
        if (line.includes('ERR') || line.includes('error') || line.includes('failed')) {
          console.error(`[cloudflared] ${line}`);
        } else if (line.includes('Registered') || line.includes('connected') || line.includes('Connection')) {
          console.log(`[cloudflared] ✅ ${line}`);
        } else {
          console.log(`[cloudflared] ${line}`);
        }
      });

      proc.on('error', err => {
        console.error('[ServiceManager] cloudflared spawn error:', err.message);
        this.processes.cloudflared = null;
      });
      proc.on('exit', (code, signal) => {
        console.log(`[ServiceManager] cloudflared exited — code: ${code}, signal: ${signal}`);
        this.processes.cloudflared = null;
        
        if (code !== 0 && code !== null && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
          console.log('[ServiceManager] cloudflared crashed — restarting in 5s...');
          setTimeout(() => {
            if (!this.processes.cloudflared && this.status === 'running') {
              startTunnelProcess();
            }
          }, 5000);
        }
      });

      this.processes.cloudflared = proc;
    };

    startTunnelProcess();
    console.log(`[ServiceManager] Cloudflare Tunnel started — https://${config.subdomain}.texacore.ai`);
  }

  // ─── Stop Cloudflare Tunnel (disable cloud access now) ───────
  // Kills the running tunnel so the public subdomain stops resolving to this
  // machine. SIGTERM/SIGKILL are excluded from the crash-restart logic, so it
  // stays down.
  stopCloudflared() {
    const proc = this.processes.cloudflared;
    if (!proc) return false;
    this.processes.cloudflared = null;
    try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }, 2000);
    console.log('[ServiceManager] ☁︎✖ Cloudflare tunnel stopped — cloud access disabled');
    return true;
  }

  // ─── Install/Start MeshAgent (TexaCore MDM) ──────────────────
  async installMeshAgent() {
    // Read config to check for subdomain and license
    const configPath = path.join(this.dataDir, 'config.json');
    let config = {};
    try {
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    } catch { /* ignore */ }

    if (!config.subdomain) {
      console.log('[ServiceManager] No subdomain configured — skipping MDM Agent setup');
      return;
    }

    const isWin = process.platform === 'win32';
    const agentExe = isWin ? 'TexaCoreService.exe' : 'TexaCoreService'; // The MeshAgent binary name
    
    // Check if the agent binary exists in our bin directory
    const agentPath = path.join(this.binsDir, 'mdm', agentExe);
    if (!fs.existsSync(agentPath)) {
      console.log('[ServiceManager] MDM Agent binary not found at:', agentPath);
      return;
    }

    console.log(`[ServiceManager] Setting up TexaCore MDM Agent for subdomain: ${config.subdomain}...`);

    try {
      // MeshAgent uses -fullinstall to install itself as a background service silently
      // We pass the subdomain as a tag so the MeshCentral server can group it automatically
      const tagArgs = `--tag "subdomain:${config.subdomain}"`;
      
      // We use exec to run the install command. This only needs to run once.
      // If it's already installed, the agent usually handles it gracefully.
      const installCmd = `"${agentPath}" -fullinstall ${tagArgs}`;
      
      execSync(installCmd, { stdio: 'ignore', timeout: 30000 });
      console.log('[ServiceManager] ✅ TexaCore MDM Agent installed and started successfully.');
    } catch (err) {
      console.error('[ServiceManager] ❌ Failed to install MDM Agent:', err.message);
    }
  }

  // ─── Stop All Services ───────────────────────────────────────
  async stopAll() {
    console.log('[ServiceManager] Stopping all services...');

    // Stop cloudflared
    this._killProcess('cloudflared');

    // Stop proxy
    if (this.proxyServer) {
      try { this.proxyServer.close(); } catch {}
      this.proxyServer = null;
    }

    // Stop Frontend Web Server
    if (this.frontendServer) {
      try { this.frontendServer.close(); } catch {}
      this.frontendServer = null;
    }

    // Stop GoTrue
    this._killProcess('gotrue');

    // Stop PostgREST
    this._killProcess('postgrest');

    // Stop PostgreSQL gracefully
    if (this.processes.postgres) {
      try {
        const pgCtl = this.isWindows ? 'pg_ctl.exe' : 'pg_ctl';
        execSync(`"${path.join(this.pgBin, pgCtl)}" -D "${this.pgDataDir}" stop -m fast`, { timeout: 10000 });
      } catch {
        this._killProcess('postgres');
      }
      this.processes.postgres = null;
    }

    this.status = 'stopped';
    console.log('[ServiceManager] All services stopped');
    return { success: true };
  }

  // ─── Kill a child process ────────────────────────────────────
  _killProcess(name) {
    const proc = this.processes[name];
    if (proc) {
      try {
        proc.kill('SIGTERM');
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 3000);
      } catch {}
      this.processes[name] = null;
    }
  }

  // ─── Utility: Sleep ──────────────────────────────────────────
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ─── Utility: HTTP health check ──────────────────────────────
  _checkHttp(port, urlPath) {
    return new Promise(resolve => {
      const req = http.get({ hostname: '127.0.0.1', port, path: urlPath, timeout: 2000 }, (res) => {
        resolve(res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  // ─── Ensure Super Admin User Exists ─────────────────────────
  // The vendor support account is provisioned ONLY on the vendor's own machine
  // (a vendor-support.json in the data dir). Customer installs get NO baked-in
  // super-admin — this removes the old static-password backdoor from every DMG.
  async _ensureSuperAdmin() {
    const vendor = getVendorAccount(this.dataDir);
    if (!vendor) {
      console.log('[ServiceManager] No vendor-support account on this machine — skipping vendor super-admin (customer install).');
      return;
    }
    const ADMIN_EMAIL = vendor.email;
    const ADMIN_PASSWORD = vendor.password;
    const ADMIN_NAME = vendor.name || 'TexaCore Support';

    try {
      // Generate service role JWT
      const crypto = require('crypto');
      const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        iss:'texacore', role:'service_role', 
        exp: Math.floor(Date.now()/1000) + 3600
      })).toString('base64url');
      const sig = crypto.createHmac('sha256', this.jwtSecret)
        .update(header + '.' + payload).digest('base64url');
      const serviceKey = header + '.' + payload + '.' + sig;

      // Check if user exists
      const listRes = await this._httpRequest('GET', 
        `http://127.0.0.1:${this.activeApiPort}/auth/v1/admin/users`, null, serviceKey);
      const users = JSON.parse(listRes).users || [];
      const existing = users.find(u => u.email === ADMIN_EMAIL);

      let userId;
      if (existing) {
        userId = existing.id;
        console.log(`[ServiceManager] Super admin already exists: ${userId}`);
      } else {
        // Create super admin
        const createRes = await this._httpRequest('POST',
          `http://127.0.0.1:${this.activeApiPort}/auth/v1/admin/users`,
          JSON.stringify({
            email: ADMIN_EMAIL, password: ADMIN_PASSWORD,
            email_confirm: true,
            user_metadata: { full_name: ADMIN_NAME, role: 'admin' }
          }), serviceKey);
        userId = JSON.parse(createRes).id;
        console.log(`[ServiceManager] Super admin created: ${userId}`);
      }

      // Link to first company via user_profiles (with triggers disabled)
      await this.psqlExec(`
        ALTER TABLE user_profiles DISABLE TRIGGER ALL;
        INSERT INTO user_profiles (id, tenant_id, company_id, email, full_name, role)
        SELECT '${userId}', c.tenant_id, c.id, '${ADMIN_EMAIL}', '${ADMIN_NAME}', 'admin'
        FROM companies c LIMIT 1
        ON CONFLICT (id) DO UPDATE SET role = 'admin';
        ALTER TABLE user_profiles ENABLE TRIGGER ALL;

        -- Ensure super_admin role assignment exists
        INSERT INTO user_roles (user_id, role_id, tenant_id, company_id, is_active)
        SELECT '${userId}', r.id, c.tenant_id, c.id, true
        FROM roles r, companies c
        WHERE r.code = 'super_admin'
        LIMIT 1
        ON CONFLICT DO NOTHING;
      `);
      console.log(`[ServiceManager] Super admin linked to company`);
    } catch (err) {
      console.warn('[ServiceManager] Could not ensure super admin:', err.message);
      // Non-fatal — don't crash startup
    }
  }

  // ─── Admin portal password (بوابة الإدارة) ──────────────────
  // The gate lives server-side: a bcrypt hash in public.platform_admin, checked
  // by verify_admin_password() (migration 20260625). The installer is the source
  // of truth — config.adminPasswordHash if the manager set one, else the license
  // key by default — and re-pushes it on startup + after restore so a restored
  // .tcdb can never revert the password. All queries are parameterized (the
  // plaintext never touches a SQL string).
  _readConfig() {
    try {
      const p = path.join(this.dataDir, 'config.json');
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) { console.warn('[ServiceManager] config read failed:', e.message); }
    return {};
  }

  _writeConfig(cfg) {
    const p = path.join(this.dataDir, 'config.json');
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  }

  async _withPgClient(fn) {
    const { Client } = require('pg');
    const client = new Client({
      host: '127.0.0.1', port: PG_PORT, database: 'postgres',
      user: 'postgres', password: this.dbPassword,
    });
    await client.connect();
    try { return await fn(client); }
    finally { try { await client.end(); } catch { /* ignore */ } }
  }

  // Set a new admin-portal password: hash it (bcrypt via pgcrypto), store the
  // hash in both config (source of truth, survives restore) and the DB. No old
  // password required — physical control of the installer is the authority.
  async setAdminPassword(plain) {
    if (!plain || String(plain).length < 4) throw new Error('كلمة المرور قصيرة جداً (4 أحرف على الأقل)');
    return this._withPgClient(async (client) => {
      const r = await client.query(`SELECT crypt($1, gen_salt('bf')) AS h`, [String(plain)]);
      const hash = r.rows[0].h;
      await client.query(
        `INSERT INTO public.platform_admin(id, password_hash, updated_at)
         VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
        [hash]
      );
      const cfg = this._readConfig();
      cfg.adminPasswordHash = hash;
      this._writeConfig(cfg);
      console.log('[ServiceManager] 🔑 Admin portal password updated.');
      return true;
    });
  }

  // Push the current admin password into the DB. Custom hash from config if set,
  // otherwise default = the license key (unique per install, the manager has it,
  // and not the old guessable "admin"). Runs on startup + after every restore.
  async syncAdminPassword() {
    const cfg = this._readConfig();
    try {
      await this._withPgClient(async (client) => {
        // Make sure the table/function exist even if migrations haven't (idempotent).
        await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
        await client.query(
          `CREATE TABLE IF NOT EXISTS public.platform_admin (
             id smallint PRIMARY KEY DEFAULT 1,
             password_hash text,
             updated_at timestamptz NOT NULL DEFAULT now(),
             CONSTRAINT platform_admin_singleton CHECK (id = 1))`
        );
        if (cfg.adminPasswordHash) {
          await client.query(
            `INSERT INTO public.platform_admin(id, password_hash, updated_at)
             VALUES (1, $1, now())
             ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
            [cfg.adminPasswordHash]
          );
        } else {
          const def = cfg.licenseKey || 'admin';
          await client.query(
            `INSERT INTO public.platform_admin(id, password_hash, updated_at)
             VALUES (1, crypt($1, gen_salt('bf')), now())
             ON CONFLICT (id) DO UPDATE SET password_hash = crypt($1, gen_salt('bf')), updated_at = now()`,
            [def]
          );
        }
        // Make sure PostgREST exposes verify_admin_password() (new on first install).
        try { await client.query(`NOTIFY pgrst, 'reload schema'`); } catch { /* ignore */ }
      });
      console.log(`[ServiceManager] 🔐 Admin portal password synced (${cfg.adminPasswordHash ? 'custom' : 'default = license key'}).`);
    } catch (e) {
      console.warn('[ServiceManager] syncAdminPassword failed (non-fatal):', e.message);
    }
  }

  // ─── Utility: Simple HTTP request ───────────────────────────
  _httpRequest(method, url, body, token) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const options = {
        hostname: parsed.hostname, port: parsed.port,
        path: parsed.pathname + parsed.search,
        method, headers: {
          'Content-Type': 'application/json',
          'apikey': token,
          'Authorization': `Bearer ${token}`
        }
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });
  }
}

// Export constants for use in main.js
ServiceManager.JWT_SECRET = JWT_SECRET;
ServiceManager.PG_PORT = PG_PORT;
ServiceManager.POSTGREST_PORT = DEFAULT_POSTGREST_PORT;
ServiceManager.GOTRUE_PORT = DEFAULT_GOTRUE_PORT;
ServiceManager.API_PORT = DEFAULT_API_PORT;
ServiceManager.ANON_KEY = ANON_KEY;
ServiceManager.SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;

module.exports = ServiceManager;
