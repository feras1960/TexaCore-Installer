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
const { PORTS, harnessAllowed } = require('./ports');
const bootstrap = require('./bootstrap');
const { validateAdminPassword } = require('./admin-password');
const netGuard = require('./net-guard');
const functionPatches = require('./function-patches');
const { openBaselineStore } = require('./baseline-store');

// ─── Ports (defaults — TEXACORE_PORT_BASE moves the whole block; see ports.js) ───
const PG_PORT = PORTS.pg;
const DEFAULT_POSTGREST_PORT = PORTS.postgrest;
const DEFAULT_GOTRUE_PORT = PORTS.gotrue;
const DEFAULT_API_PORT = PORTS.api; // Unified API port (replaces Kong)
const ADMIN_PORT = PORTS.admin;     // the installer's local admin API (main.js)

// 2.0.0: there are NO fixed JWT secret / anon / service keys any more — every install generates its own (secrets.js).

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

    // 2.0.0: classify the data dir BEFORE anything reads it. A pre-2.0 (PostgreSQL 15/16) data dir is moved aside whole —
    // never reused, never deleted; an interrupted first run's half-built cluster is moved aside too (see bootstrap.js).
    const prepared = bootstrap.prepareDataDir(this.dataDir, (m) => console.log(m));
    this.bootState = prepared.state;            // fresh | interrupted_first_run | ready | legacy_v18  (as found)
    this.bootMovedTo = prepared.movedTo || null;
    // from here on a dir that was fresh/interrupted/legacy is a fresh install
    this.isFreshInstall = prepared.state !== 'ready';

    // Per-install secrets: unique JWT secret, anon/service keys and DB password per machine (no legacy path in 2.0).
    const _secrets = getOrCreateSecrets(this.dataDir, require('./secrets-vault').getVault());
    this.secretsCreated = _secrets.created;     // true → the DB roles must be (re)keyed with this password
    this.jwtSecret = _secrets.jwtSecret;
    this.anonKey = _secrets.anonKey;
    this.serviceKey = _secrets.serviceKey;
    this.dbPassword = _secrets.dbPassword;                     // the PostgreSQL superuser `postgres`: EVERY connection authenticates (scram-sha-256)
    this.authenticatorPassword = _secrets.authenticatorPassword; // PostgREST's login role
    this.authAdminPassword = _secrets.authAdminPassword;         // GoTrue's login role (supabase_auth_admin)
    this.localApiSecret = _secrets.localApiSecret;   // required by the admin API (main.js) — see /config.js
    this.proxyServer = null;
    this.onMigrationProgress = null; // callback: (step, total, name) => void

    // Active ports (may differ from defaults if port was busy)
    this.activePostgrestPort = DEFAULT_POSTGREST_PORT;
    this.activeGotruePort = DEFAULT_GOTRUE_PORT;
    this.activeApiPort = DEFAULT_API_PORT;

    // Resolve migrations directory (packaged vs dev). 2.0.0 ships NO migrations: the database is built from the baseline.
    // The runner stays for future incremental migrations (applied after the baseline, tracked in _texacore_migrations).
    if (isPackaged) {
      this.migrationsDir = path.join(process.resourcesPath, 'migrations');
    } else {
      this.migrationsDir = path.join(__dirname, '..', 'migrations');
    }
    // The pinned production baseline (scripts/sync-baseline.js) and the installer-owned SQL beside this file.
    this.baselineDir = isPackaged ? path.join(process.resourcesPath, 'baseline') : path.join(__dirname, '..', 'baseline');
    this.bootstrapSqlDir = path.join(__dirname, 'bootstrap');
    // The packaged app carries the baseline + installer SQL as ONE encrypted container (baseline-store.js); development reads the plain files.
    this.baselineStore = openBaselineStore({ baselineDir: this.baselineDir, bootstrapDir: this.bootstrapSqlDir });

    // Ensure directories (the logs may carry business data: private to the owner of the account)
    for (const dir of [this.dataDir, this.logDir]) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    if (process.platform !== 'win32') { try { fs.chmodSync(this.logDir, 0o700); } catch { /* not ours to change */ } }
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
    const pgReady = pg ? await this._pgAccepting() : false;

    return {
      running: pg && rest && auth && pgReady,
      health: pgReady && rest && auth ? 'healthy' : (pg ? 'starting' : 'stopped'),
      services: { postgres: pgReady, postgrest: rest, gotrue: auth }
    };
  }

  /** node-postgres options for a connection as the superuser (scram-sha-256: the password is mandatory). */
  pgClientOptions(extra = {}) {
    return { host: '127.0.0.1', port: PG_PORT, database: 'postgres', user: 'postgres', password: this.dbPassword, ...extra };
  }

  // PostgreSQL 17's bundle has no pg_isready: ask the server itself (a real connection + SELECT 1).
  async _pgAccepting(timeoutMs = 2500) {
    const { Client } = require('pg');
    const client = new Client(this.pgClientOptions({ connectionTimeoutMillis: timeoutMs }));
    client.on('error', () => { /* swallowed: reported through the catch below */ });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return true;
    } catch { return false; }
    finally { try { await client.end(); } catch { /* ignore */ } }
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
  // Tries the preferred port first, then increments up to maxAttempts. With TEXACORE_PORT_BASE (test mode) the block is
  // fixed: a busy port is an error, never a shift outside the block. A foreign process on the port is NEVER killed.
  async _findAvailablePort(preferredPort, maxAttempts = 20) {
    if (PORTS.custom) {
      if (await this._isPortFree(preferredPort)) return preferredPort;
      throw new Error(`Port ${preferredPort} (TEXACORE_PORT_BASE block) is in use`);
    }
    for (let offset = 0; offset < maxAttempts; offset++) {
      const port = preferredPort + offset;
      if (await this._isPortFree(port)) {
        if (offset > 0) {
          console.log(`[ServiceManager] Port ${preferredPort} busy → using ${port} instead`);
        }
        return port;
      }
    }
    throw new Error(`No free port found near ${preferredPort}`);
  }

  // ─── Initialize Database (first run only) ────────────────────
  // PostgreSQL 17.6 like production: ICU collation (en-US), UTF8, UTC. The cluster is "trust" on loopback only
  // (127.0.0.1 / ::1 — listen_addresses is pinned to 127.0.0.1 below); the roles that PostgREST/GoTrue use still carry the
  // per-install password.
  _pgEnv() {
    const env = { ...process.env };
    // psql / pg_dump / pg_restore authenticate through the environment, never through argv (a command line is visible to every process on the machine)
    if (this.dbPassword) env.PGPASSWORD = this.dbPassword;
    if (this.isWindows) {
      env.PATH = this.pgBin + ';' + path.join(this.binsDir, 'pg', 'lib') + ';' + (env.PATH || '');
      env.PGSHAREDIR = path.join(this.binsDir, 'pg', 'share');
    }
    return env;
  }

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
    // bootstrap.prepareDataDir() already moved any half-built cluster aside, so what is here is absent or empty.
    fs.mkdirSync(this.pgDataDir, { recursive: true });
    bootstrap.writeMarker(this.dataDir, {
      status: 'initdb', pgMajor: bootstrap.EXPECTED_PG_MAJOR,
      appVersion: this._appVersion(), startedAt: new Date().toISOString(), readyAt: null,
    });

    console.log('[ServiceManager] Initializing database for first time (PostgreSQL 17, ICU en-US, UTC)...');
    const initdb = path.join(this.pgBin, this.isWindows ? 'initdb.exe' : 'initdb');

    // The superuser's password reaches initdb through a 0600 file in a private directory that is deleted right after — never on the command line.
    const pwDir = fs.mkdtempSync(path.join(this.dataDir, '.pw-'));
    const pwFile = path.join(pwDir, 'pw');
    fs.writeFileSync(pwFile, `${this.dbPassword}\n`, { mode: 0o600 });
    const dropPwFile = () => { try { fs.writeFileSync(pwFile, ''); } catch { /* gone */ } try { fs.rmSync(pwDir, { recursive: true, force: true }); } catch { /* gone */ } };

    return new Promise((resolve, reject) => {
      const proc = spawn(initdb, [
        '-D', this.pgDataDir,
        '-U', 'postgres',
        '-E', 'UTF8',
        '--locale-provider=icu',
        '--icu-locale=en-US',
        // libc side of the locale. With the ICU provider the default collation, upper()/lower() and regex classes come from ICU;
        // the libc locale only backs the odd libc call. macOS knows en_US.UTF-8 (= production's datcollate/datctype). On Windows
        // there is no such libc name, and an invalid one would stop initdb — "C" is the one value that is always valid there.
        `--locale=${this.isWindows ? 'C' : 'en_US.UTF-8'}`,
        '--auth=scram-sha-256',          // NO trust, not even while bootstrapping: every client (ours included) presents a password
        `--pwfile=${pwFile}`,
      ], { env: this._pgEnv() });

      let errOut = '';
      let stdOut = '';
      proc.stdout.on('data', d => stdOut += d.toString());
      proc.stderr.on('data', d => errOut += d.toString());
      proc.on('error', err => { dropPwFile(); reject(new Error(`initdb spawn error: ${err.message}`)); });
      proc.on('close', code => {
        dropPwFile();
        if (code === 0) {
          console.log('[ServiceManager] Database initialized successfully');
          // pg_hba.conf: loopback only, scram-sha-256 for everything (the app's own processes authenticate with their per-install passwords).
          this._writeHba();
          // postgresql.conf: production time zone, loopback listener, no unix socket (no path-length / collision trouble), and a log that never echoes SQL.
          fs.appendFileSync(path.join(this.pgDataDir, 'postgresql.conf'), [
            '', '# ── TexaCore 2.0 ──',
            "timezone = 'UTC'",
            "log_timezone = 'UTC'",
            "listen_addresses = '127.0.0.1'",
            // (Windows has no /tmp socket directory to collide with; the setting is left at the server's own default there)
            ...(this.isWindows ? [] : ["unix_socket_directories = ''"]),
            "password_encryption = 'scram-sha-256'",
            // the server log is for diagnosing the server, not for keeping business data or the schema: no statement text is ever written with an error
            "log_min_error_statement = panic",
            "log_statement = 'none'",
            "log_min_duration_statement = -1",
            '',
          ].join('\n'));
          resolve();
        } else {
          console.error('[ServiceManager] initdb stderr:', errOut);
          console.error('[ServiceManager] initdb stdout:', stdOut);
          reject(new Error(`initdb failed (${code}): ${errOut}`));
        }
      });
    });
  }

  /** An empty log file that only the account that runs the program can read (logs may contain data; the file is recreated empty at every start). */
  _privateLog(file) {
    try { fs.writeFileSync(file, '', { mode: 0o600 }); } catch { /* ignore */ }
    if (process.platform !== 'win32') { try { fs.chmodSync(file, 0o600); } catch { /* ignore */ } }
  }

  /** Empty the server log in place (the server keeps appending to the same file). Used right after the bootstrap. */
  _resetPostgresLog() {
    const f = path.join(this.logDir, 'postgres.log');
    try { fs.truncateSync(f, 0); } catch { /* not there */ }
    if (process.platform !== 'win32') { try { fs.chmodSync(f, 0o600); } catch { /* ignore */ } }
  }

  /** (Re)write pg_hba.conf atomically. mode 'trust' exists for ONE purpose: recovery after the secrets file was lost (see startPostgres). */
  _writeHba({ trust = false } = {}) {
    const hbaPath = path.join(this.pgDataDir, 'pg_hba.conf');
    let text = bootstrap.hbaText({ windows: this.isWindows });
    if (trust) text = text.replace(/scram-sha-256/g, 'trust');
    const tmp = `${hbaPath}.tmp`;
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, hbaPath);
  }

  /**
   * Called once PostgreSQL accepts connections. Makes sure the cluster authenticates EVERYONE with a password:
   *  - the superuser and the two service roles get their per-install passwords (a cluster built by an earlier 2.0 test build had `trust` and no passwords),
   *  - pg_hba.conf becomes scram-sha-256 only, the server is told to reload it,
   *  - the server never writes statement text into its log.
   * Idempotent; a cluster that already is in that state costs one comparison of the file.
   */
  async _hardenAuth() {
    const hbaPath = path.join(this.pgDataDir, 'pg_hba.conf');
    let have = '';
    try { have = fs.readFileSync(hbaPath, 'utf8'); } catch { /* none */ }
    const want = bootstrap.hbaText({ windows: this.isWindows });
    if (have === want && !this._recoveryTrust) return false;
    console.log(`[ServiceManager] hardening database authentication (${this._recoveryTrust ? 'secrets were regenerated: roles re-keyed' : 'pg_hba.conf of an earlier build had ' + (bootstrap.hbaHasTrust(have) ? 'trust' : 'other rules')})`);
    await this._withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(bootstrap.passwordSql({ dbPassword: this.dbPassword, authenticatorPassword: this.authenticatorPassword, authAdminPassword: this.authAdminPassword }));
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      await client.query("ALTER SYSTEM SET log_min_error_statement = 'panic'");
      await client.query("ALTER SYSTEM SET log_statement = 'none'");
    });
    this._writeHba();                                   // passwords first, THEN the file: a crash in between leaves the old (open) rules and the work is repeated
    await this._withPgClient(async (client) => { await client.query('SELECT pg_reload_conf()'); });
    this._recoveryTrust = false;
    // prove it: the next connection without a password must be refused
    await this._sleep(300);
    const { Client } = require('pg');
    const probe = new Client(this.pgClientOptions({ password: undefined, connectionTimeoutMillis: 3000 }));
    probe.on('error', () => {});
    let open = false;
    try { await probe.connect(); await probe.query('SELECT 1'); open = true; } catch { /* refused — as intended */ } finally { try { await probe.end(); } catch { /* ignore */ } }
    if (open) throw new Error('PostgreSQL still accepts a passwordless connection after the hardening step');
    return true;
  }

  _appVersion() {
    try { return require('electron').app.getVersion(); } catch { return ''; }
  }

  // ─── Start PostgreSQL ────────────────────────────────────────
  async startPostgres() {
    if (this.processes.postgres) return;

    // Port busy: only OUR OWN leftover server (the one named by postmaster.pid in our data dir) is stopped, gracefully.
    // Whatever else holds the port is not ours to kill — fail with a clear message instead.
    if (!await this._isPortFree(PG_PORT)) {
      console.warn(`[ServiceManager] Port ${PG_PORT} in use — checking for a leftover TexaCore PostgreSQL...`);
      const pidFile = path.join(this.pgDataDir, 'postmaster.pid');
      if (fs.existsSync(pidFile)) {
        try {
          const pgCtl = path.join(this.pgBin, this.isWindows ? 'pg_ctl.exe' : 'pg_ctl');
          execSync(`"${pgCtl}" stop -D "${this.pgDataDir}" -m fast -w -t 15`, { env: this._pgEnv(), timeout: 20000, stdio: 'ignore' });
          console.log('[ServiceManager] Leftover PostgreSQL stopped via pg_ctl');
          await this._sleep(1000);
        } catch { /* fall through to the re-check */ }
      }
      if (!await this._isPortFree(PG_PORT)) {
        throw new Error(`Port ${PG_PORT} is in use by another program. Close it (or the other PostgreSQL instance) and try again.`);
      }
      console.log(`[ServiceManager] Port ${PG_PORT} is now free`);
    }

    console.log('[ServiceManager] Starting PostgreSQL on port', PG_PORT);
    const logFile = path.join(this.logDir, 'postgres.log');
    this._privateLog(logFile);

    // Recovery: this is an EXISTING cluster whose per-install secrets were lost and regenerated — nobody knows the old superuser password, so the
    // cluster is started once with a loopback-only trust rule, the passwords are set to the new ones, and _hardenAuth() puts scram back before anything else runs.
    this._recoveryTrust = false;
    if (this.secretsCreated && !this.isFreshInstall && fs.existsSync(path.join(this.pgDataDir, 'PG_VERSION'))) {
      console.warn('[ServiceManager] secrets were regenerated for an existing database → temporary loopback recovery rule');
      this._writeHba({ trust: true });
      this._recoveryTrust = true;
    }

    const pgEnv = this._pgEnv();
    pgEnv.PGDATA = this.pgDataDir;
    if (!this.isWindows) {
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
        await this._hardenAuth();
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
    const pgArgs = ['-D', this.pgDataDir, '-p', String(PG_PORT)];

    console.log('[ServiceManager] PostgreSQL binary:', path.join(this.pgBin, pgExe));
    console.log('[ServiceManager] pgDataDir:', this.pgDataDir);

    const logFd = fs.openSync(logFile, 'a');
    const pgProcess = spawn(path.join(this.pgBin, pgExe), pgArgs, {
      stdio: ['ignore', logFd, logFd],
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
    for (let i = 0; i < 120; i++) {
      await this._sleep(500);

      // Check if process died
      if (!this.processes.postgres) {
        let logContent = '';
        try { logContent = fs.readFileSync(logFile, 'utf8').slice(-1000); } catch {}
        throw new Error(`PostgreSQL process exited unexpectedly.\nLog: ${logContent}`);
      }

      if (await this._pgAccepting()) {
        console.log('[ServiceManager] PostgreSQL is ready');
        await this._hardenAuth();
        return;
      }
    }

    // Timeout — read log for diagnostics
    let logContent = '';
    try { logContent = fs.readFileSync(logFile, 'utf8').slice(-2000); } catch {}
    console.error('[ServiceManager] PostgreSQL log:\n', logContent);
    throw new Error(`PostgreSQL failed to start within 60 seconds.\nLog: ${logContent}`);
  }

  // ─── Run SQL via psql ────────────────────────────────────────
  psqlExec(sql, dbName = 'postgres') {
    return new Promise((resolve, reject) => {
      const psqlExe = this.isWindows ? 'psql.exe' : 'psql';
      const psql = spawn(path.join(this.pgBin, psqlExe), [
        '-X', '-w',
        '-p', String(PG_PORT),
        '-h', '127.0.0.1',
        '-U', 'postgres',
        '-d', dbName,
        '-v', 'ON_ERROR_STOP=1'
      ], { env: this._pgEnv() });

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

  /**
   * Run SQL held in memory (a Buffer) with psql, fed over stdin — the decrypted baseline never touches the disk. stopOnError=false is for the
   * baseline's two passes (errors are collected, not fatal). The SQL text is never logged; only psql's error LINES are returned.
   */
  runPsqlSql(sqlBuf, { stopOnError = true, dbName = 'postgres' } = {}) {
    return new Promise((resolve, reject) => {
      const psqlExe = this.isWindows ? 'psql.exe' : 'psql';
      const psql = spawn(path.join(this.pgBin, psqlExe), [
        '-X', '-w', '-q',
        '-p', String(PG_PORT), '-h', '127.0.0.1', '-U', 'postgres', '-d', dbName,
        '-v', `ON_ERROR_STOP=${stopOnError ? 1 : 0}`,
        '-f', '-',
      ], { env: this._pgEnv() });
      let errOut = '';
      let stdOut = '';
      psql.stdout.on('data', d => { stdOut += d.toString(); });
      psql.stderr.on('data', d => { errOut += d.toString(); });
      psql.stdin.on('error', () => { /* psql stopped reading (ON_ERROR_STOP): its exit code tells */ });
      psql.on('error', err => reject(new Error(`psql spawn error: ${err.message}`)));
      psql.on('close', code => resolve({ code, stdout: stdOut, stderr: errOut }));
      psql.stdin.end(sqlBuf);
    });
  }

  /** Run a .sql file with psql. stopOnError=false is for the baseline's two passes (errors are collected, not fatal). */
  runPsqlFile(file, { stopOnError = true, dbName = 'postgres' } = {}) {
    return new Promise((resolve, reject) => {
      const psqlExe = this.isWindows ? 'psql.exe' : 'psql';
      const psql = spawn(path.join(this.pgBin, psqlExe), [
        '-X', '-w', '-q',
        '-p', String(PG_PORT), '-h', '127.0.0.1', '-U', 'postgres', '-d', dbName,
        '-v', `ON_ERROR_STOP=${stopOnError ? 1 : 0}`,
        '-f', file,
      ], { env: this._pgEnv() });
      let errOut = '';
      let stdOut = '';
      psql.stdout.on('data', d => { stdOut += d.toString(); });
      psql.stderr.on('data', d => { errOut += d.toString(); });
      psql.on('error', err => reject(new Error(`psql spawn error: ${err.message}`)));
      psql.on('close', code => resolve({ code, stdout: stdOut, stderr: errOut }));
    });
  }

  /** A query through the node client (rows as objects) — for verification and the provisioning code. */
  async pgQuery(text, params = []) {
    const { Client } = require('pg');
    const client = new Client(this.pgClientOptions());
    await client.connect();
    try { return await client.query(text, params); }
    finally { try { await client.end(); } catch { /* ignore */ } }
  }

  /** fn(query) inside ONE transaction on one connection (BEGIN … COMMIT, ROLLBACK on error). */
  async pgTransaction(fn) {
    const { Client } = require('pg');
    const client = new Client(this.pgClientOptions());
    await client.connect();
    try {
      await client.query('BEGIN');
      try {
        const out = await fn((text, params = []) => client.query(text, params));
        await client.query('COMMIT');
        return out;
      } catch (e) { try { await client.query('ROLLBACK'); } catch { /* connection gone */ } throw e; }
    } finally { try { await client.end(); } catch { /* ignore */ } }
  }

  // ─── Build the database (first run) ──────────────────────────
  // roles → GoTrue migrate (owns `auth`) → storage stubs → production baseline (2 passes) → installer extras →
  // reference data → verification → marker "ready". Grants and RLS stay exactly as the baseline creates them.
  async buildDatabase(progress = () => {}) {
    const total = 8;
    let n = 0;
    const step = (name) => { n += 1; console.log(`[Bootstrap] (${n}/${total}) ${name}`); progress(n, total, name); };

    const pin = bootstrap.loadPin(this.baselineDir);
    const fileProblems = this.baselineStore.verify(pin);
    if (fileProblems.length) {
      throw new Error(`The database baseline is missing or damaged in this build (${fileProblems.join('; ')}). Reinstall TexaCore.`);
    }
    bootstrap.writeMarker(this.dataDir, { status: 'schema_loading', baselineSha256: pin.files['production_baseline.sql'].sha256, baselineCut: pin.cutTimestamp });

    step('Creating database roles');
    await this.psqlExec(bootstrap.rolesSql({ authenticatorPassword: this.authenticatorPassword, authAdminPassword: this.authAdminPassword }));

    step('Creating the authentication schema');
    await this.runGoTrueMigrations();

    step('Creating the storage schema');
    const storage = this.baselineStore.read('storage_stubs.sql');
    for (let pass = 1; pass <= 2; pass++) await this.runPsqlSql(storage, { stopOnError: false });

    step('Loading the production schema');
    const baselineSql = this.baselineStore.read('production_baseline.sql');     // decrypted in memory, fed to psql over stdin, never written down
    // One full pass; then ONLY the statements psql reported as failed (see bootstrap.loadBaseline) — not the whole file again.
    const loaded = await bootstrap.loadBaseline(baselineSql, (buf) => this.runPsqlSql(buf, { stopOnError: false }), { log: (m) => console.log(m) });
    const summary = loaded.summary;
    if (loaded.unexpected.length) console.warn(`[Bootstrap] baseline: ${loaded.unexpected.length} unexpected error(s) remain, first: ${loaded.unexpected[0].message}`);
    fs.writeFileSync(path.join(this.logDir, 'baseline-load.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });

    step('Installing local extras');
    await this.runPsqlSql(this.baselineStore.read('local_extras.sql'), { stopOnError: true })
      .then((r) => { if (r.code !== 0) throw new Error(`local_extras.sql failed: ${r.stderr.slice(-300)}`); });

    step('Loading reference data');
    // production's own export first (optional — written at the baseline re-cut), then the installer's defaults fill any gap
    // (both are ON CONFLICT DO NOTHING / NOT EXISTS, so the first writer of a row wins).
    const seeds = [];
    if (this.baselineStore.has('reference_data.sql')) seeds.push('reference_data.sql');
    seeds.push('reference_seed.sql');
    for (const name of seeds) {
      const r = await this.runPsqlSql(this.baselineStore.read(name), { stopOnError: true });
      if (r.code !== 0) throw new Error(`${name} failed: ${r.stderr.slice(-300)}`);
    }
    await this.psqlExec(bootstrap.postBaselineSql());

    // The import exemption (owner decision 2026-10-13) — the one sanctioned difference from the baseline's function bodies (see function-patches.js).
    step('Applying the import exemption');
    // (a negative-control run of the release check may switch the patch off — an isolated harness run only; never in a normal install)
    const skipPatches = process.env.TEXACORE_SKIP_FUNCTION_PATCHES === '1' && harnessAllowed(require('electron').app.isPackaged);
    const patches = skipPatches ? { applied: {}, already: [], skipped: [{ signature: '*', why: 'switched off for a control run' }] }
      : await functionPatches.applyFunctionPatches((t, p) => this.pgQuery(t, p), (m) => console.log(m));
    bootstrap.writeMarker(this.dataDir, { patchedFunctions: patches.applied, patchesSkipped: patches.skipped });

    step('Verifying the database');
    const v = await this.verifyBaselineInstall();
    if (!v.ok) {
      bootstrap.writeMarker(this.dataDir, { status: 'verify_failed', verifyProblems: v.problems.slice(0, 20) });
      throw new Error(`The database did not verify against the baseline: ${v.problems.slice(0, 5).join('; ')}`);
    }

    step('Database ready');
    this._resetPostgresLog();                                                  // the bootstrap's error lines are not kept
    this.baselineStore.release();                                              // the decrypted baseline leaves memory
    bootstrap.writeMarker(this.dataDir, { status: 'ready', readyAt: new Date().toISOString(), verified: v.stats });
    return { baseline: summary, verified: v.stats };
  }

  /** Counts + every function body against the inventory that ships with the baseline. */
  async verifyBaselineInstall() {
    const inv = JSON.parse(this.baselineStore.read('production_baseline.inventory.json').toString('utf8'));
    const problems = [];
    const schemas = inv.app_schemas || ['public', 'licensing', 'newpost', 'tomgenerators'];
    const q = await this.pgQuery(`
      SELECT
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname = ANY($1) AND c.relkind IN ('r','p')) AS tables,
        (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname = ANY($1)
            AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')) AS functions,
        (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname = ANY($1) AND NOT t.tgisinternal) AS triggers,
        (SELECT count(*) FROM pg_policy pl JOIN pg_class c ON c.oid=pl.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname = ANY($1)) AS policies,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname = ANY($1) AND c.relkind IN ('i','I')) AS indexes,
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname = ANY($1) AND c.relkind IN ('v','m')) AS views`, [schemas]);
    const measured = Object.fromEntries(Object.entries(q.rows[0]).map(([k, v]) => [k, Number(v)]));
    // inventory counts policies of the stub schemas too in some fields; catalog_totals is app-schema only (matches the CI fingerprint)
    problems.push(...bootstrap.compareTotals(inv.catalog_totals || {}, measured));

    const fn = await this.pgQuery(`
      SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS sig, md5(p.prosrc) AS md5
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname = ANY($1) AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e')`, [schemas]);
    const patched = (bootstrap.readMarker(this.dataDir) || {}).patchedFunctions || {};
    const cmp = bootstrap.compareFunctionInventory(inv.functions_md5, fn.rows, patched);
    if (!cmp.ok) {
      problems.push(`functions: ${cmp.missing.length} missing, ${cmp.extra.length} extra, ${cmp.mismatched.length} differ (e.g. ${[...cmp.missing, ...cmp.extra, ...cmp.mismatched][0]})`);
    }
    const rls = await this.pgQuery(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                                     WHERE n.nspname = ANY($1) AND c.relkind IN ('r','p') AND c.relrowsecurity`, [schemas]);
    if (inv.main && inv.main.rls_enabled && Number(inv.main.rls_enabled) + bootstrap.LOCAL_EXTRAS.rlsTables !== rls.rows[0].n) {
      problems.push(`row level security: expected ${Number(inv.main.rls_enabled) + bootstrap.LOCAL_EXTRAS.rlsTables} protected tables, installed ${rls.rows[0].n}`);
    }
    // extensions production has and the app calls as extensions.*: they must be real, not swallowed-away
    const ext = await this.pgQuery(`SELECT (SELECT count(*) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE n.nspname='extensions' AND e.extname IN ('uuid-ossp','pgcrypto'))::int AS n,
                                           (extensions.uuid_generate_v4() IS NOT NULL) AS uuid_ok,
                                           (length(extensions.gen_salt('bf')) > 0) AS crypt_ok`);
    if (ext.rows[0].n !== 2 || !ext.rows[0].uuid_ok || !ext.rows[0].crypt_ok) problems.push('extensions.uuid_generate_v4 / extensions.crypt are not usable (uuid-ossp and pgcrypto must live in schema "extensions")');
    // the one rule that must never regress: PUBLIC/anon get nothing the baseline did not give, and RLS is on.
    const anonAll = await this.pgQuery(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity AND has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')`);
    return {
      ok: problems.length === 0, problems,
      stats: { ...measured, rlsTables: rls.rows[0].n, anonAccessibleWithoutRls: anonAll.rows[0].n, functionsVerified: cmp.installed - cmp.mismatched.length },
    };
  }

  // ─── Run GoTrue Migrations ───────────────────────────────────
  runGoTrueMigrations() {
    return new Promise((resolve, reject) => {
      console.log('[ServiceManager] Running GoTrue migrations...');
      const env = {
        ...process.env,
        API_EXTERNAL_URL: `http://localhost:${this.activeApiPort}`,
        GOTRUE_DB_DRIVER: 'postgres',
        DATABASE_URL: `postgres://supabase_auth_admin:${encodeURIComponent(this.authAdminPassword)}@127.0.0.1:${PG_PORT}/postgres?search_path=auth`,
        GOTRUE_JWT_SECRET: this.jwtSecret,
        GOTRUE_SITE_URL: `http://localhost:${this.activeApiPort}`
      };

      const proc = spawn(this.gotrueBin, ['migrate'], { env });

      let out = '';
      proc.stdout.on('data', d => out += d.toString());
      proc.stderr.on('data', d => out += d.toString());
      proc.on('error', err => reject(new Error(`GoTrue migrate spawn error: ${err.message}`)));

      proc.on('close', code => {
        if (code === 0) {
          console.log('[ServiceManager] GoTrue migrations completed');
          resolve();
        } else {
          console.error('[ServiceManager] GoTrue migrate failed:', out.slice(-1500));
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
    this._privateLog(logFile);

    // PostgREST is configured through its environment (PGRST_*), NOT a config file: the JWT secret and the DB password never touch the disk here
    // (a postgrest.conf next to an encrypted secrets file would make the encryption pointless). anon is the unauthenticated role; whatever it may do is
    // decided by the baseline's grants and RLS policies — exactly as on production. max-rows matches Supabase's 1000.
    try { const old = path.join(this.dataDir, 'postgrest.conf'); if (fs.existsSync(old)) { fs.writeFileSync(old, Buffer.alloc(fs.statSync(old).size)); fs.unlinkSync(old); } } catch { /* a config file left by an earlier build */ }

    // Build environment: add pg/lib and pg/bin to PATH for libpq.dll on Windows
    const env = {
      ...process.env,
      PGRST_DB_URI: `postgres://authenticator:${encodeURIComponent(this.authenticatorPassword)}@127.0.0.1:${PG_PORT}/postgres`,
      PGRST_DB_SCHEMAS: 'public',
      PGRST_DB_EXTRA_SEARCH_PATH: 'public, extensions',
      PGRST_DB_ANON_ROLE: 'anon',
      PGRST_JWT_SECRET: this.jwtSecret,
      PGRST_SERVER_PORT: String(this.activePostgrestPort),
      PGRST_SERVER_HOST: '127.0.0.1',
      PGRST_DB_USE_LEGACY_GUCS: 'false',
      PGRST_DB_MAX_ROWS: '1000',
      PGRST_APP_SETTINGS_JWT_SECRET: this.jwtSecret,
    };
    if (this.isWindows) {
      const pgLib = path.join(this.binsDir, 'pg', 'lib');
      env.PATH = this.pgBin + ';' + pgLib + ';' + (env.PATH || '');
    }

    const proc = spawn(this.postgrestBin, [], { env });
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
    this._privateLog(logFile);

    const env = {
      ...process.env,
      GOTRUE_API_HOST: '127.0.0.1',
      GOTRUE_API_PORT: String(this.activeGotruePort),
      API_EXTERNAL_URL: `http://localhost:${this.activeApiPort}`,
      GOTRUE_DB_DRIVER: 'postgres',
      GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${encodeURIComponent(this.authAdminPassword)}@127.0.0.1:${PG_PORT}/postgres?search_path=auth`,
      GOTRUE_SITE_URL: `http://localhost:${this.activeApiPort}`,
      // 2.0.0: nobody can self-register on a local server — accounts are created by the installer (provisioning.js) and the
      // ERP's own admin flows. (Open signup + a tunnel to the internet = strangers getting accounts.)
      GOTRUE_DISABLE_SIGNUP: 'true',
      GOTRUE_JWT_ADMIN_ROLES: 'service_role',
      GOTRUE_JWT_AUD: 'authenticated',
      GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
      GOTRUE_JWT_EXP: '3600',
      GOTRUE_JWT_SECRET: this.jwtSecret,
      GOTRUE_MAILER_AUTOCONFIRM: 'true',
      GOTRUE_SMS_AUTOCONFIRM: 'true',
      GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
      GOTRUE_EXTERNAL_PHONE_ENABLED: 'false',
      DATABASE_URL: `postgres://supabase_auth_admin:${encodeURIComponent(this.authAdminPassword)}@127.0.0.1:${PG_PORT}/postgres?search_path=auth`,
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
      // CORS: loopback origins only, never '*' (see net-guard.js). Other PCs reach the API through the page's own
      // /_supabase proxy (same origin — no CORS involved), not through this port, so it is bound to loopback too.
      netGuard.applyCors(req, res);

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
        // The upstream's own CORS headers are dropped — ours were set above.
        res.writeHead(proxyRes.statusCode, netGuard.stripCorsHeaders(proxyRes.headers));
        proxyRes.pipe(res);
      });

      proxyReq.on('error', (err) => {
        console.error('[Proxy] Error:', err.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Service unavailable', message: err.message }));
      });

      req.pipe(proxyReq);
    });

    this.proxyServer.listen(this.activeApiPort, '127.0.0.1', () => {
      console.log(`[ServiceManager] API proxy listening on port ${this.activeApiPort}`);
    });

    this.proxyServer.on('error', (err) => {
      console.error('[ServiceManager] Proxy error:', err.message);
    });
  }

  // ─── Run Migrations ──────────────────────────────────────────
  // 2.0.0 builds its database from the baseline; incremental migrations are for FUTURE releases and must be written for
  // that exact baseline: the manifest has to say so ("baselineSha256"). A manifest without it — in particular the 1.x
  // one, whose ~1,300 files re-define functions the baseline already carries at newer versions — is REFUSED, never
  // replayed (that replay is how a first 2.0 trial ended up with 118 production functions rolled back to old bodies).
  async runMigrations() {
    const manifestPath = path.join(this.migrationsDir, 'migrations.json');
    if (!fs.existsSync(manifestPath)) {
      console.log('[ServiceManager] No migrations.json found — skipping migrations');
      return { applied: 0, total: 0 };
    }
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* handled below */ }
    const marker = bootstrap.readMarker(this.dataDir) || {};
    if (!manifest || !manifest.baselineSha256 || manifest.baselineSha256 !== marker.baselineSha256) {
      console.warn('[ServiceManager] migrations.json is not for this baseline (missing/different baselineSha256) — NOT applying it');
      return { applied: 0, total: 0, skipped: 'manifest-not-for-this-baseline' };
    }

    const runner = new MigrationRunner({
      psqlExec: (sql, db) => this.psqlExec(sql, db),
      pgEnv: () => this._pgEnv(),
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
      pgEnv: () => this._pgEnv(),
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
    // NB: options.dbPassword (a 1.x leftover in config.json) is deliberately ignored — the DB password is the per-install
    // one in secrets.json; overriding it would lock PostgREST/GoTrue out of their own roles.
    this.onMigrationProgress = options.onMigrationProgress || null;

    try {
      const fresh = this.isFreshInstall;
      // 1. Initialize the cluster if this is a first run
      await this.initDatabase();

      // 2. Start PostgreSQL
      await this.startPostgres();

      let buildResult = null;
      if (fresh) {
        // 3. First run: roles → auth → storage → production baseline → reference data → verified → marker ready.
        buildResult = await this.buildDatabase((step, total, name) => {
          if (this.onMigrationProgress) this.onMigrationProgress(step, total, name);
        });
        this.isFreshInstall = false;
      } else {
        // 3'. Existing 2.0 install. If its secrets file was lost the roles are re-keyed with the regenerated password
        //     (loopback trust lets postgres do that); sessions signed with the old JWT secret simply stop being valid.
        if (this.secretsCreated) {
          this.secretsCreated = false;           // the roles were re-keyed with the regenerated passwords while PostgreSQL started (_hardenAuth)
          console.log('[ServiceManager] secrets regenerated → database roles re-keyed');
        }
        await this.runGoTrueMigrations();
      }

      // 4. Incremental migrations after the baseline (none ship in 2.0.0 — the runner skips when there is no manifest)
      const migrationResult = await this.runMigrations();
      console.log(`[ServiceManager] Migrations: ${migrationResult.applied} applied, ${migrationResult.failed || 0} failed`);

      // 5. Start PostgREST — grants and RLS are production's, untouched (no GRANT ... TO anon, no DISABLE ROW LEVEL SECURITY)
      await this.startPostgREST();

      // 6. Start GoTrue
      await this.startGoTrue();

      // 7. Start API Proxy (replaces Kong) — resolve port first
      this.activeApiPort = await this._findAvailablePort(DEFAULT_API_PORT);
      this.startApiProxy();

      // 7.5. Ensure super admin user exists (vendor machines only)
      await this._ensureSuperAdmin();

      // 7.6. Sync the admin-portal password into the DB. Idempotent; keeps the gate correct even after a restore.
      await this.syncAdminPassword();

      // 7.7. Heal tenant ownership: every tenant keeps an owner_email and its first user a tenant-admin flag.
      try {
        const healed = await require('./provisioning').healTenantOwners({ pgQuery: (t, p) => this.pgQuery(t, p), log: (m) => console.log(m) });
        if (healed.tenants || healed.profiles) console.log(`[ServiceManager] healTenantOwners: ${healed.tenants} tenant(s), ${healed.profiles} profile(s) repaired`);
      } catch (e) { console.warn('[ServiceManager] healTenantOwners failed (non-fatal):', e.message); }

      // 8. Start Frontend Web Server
      const uiPort = options.port || PORTS.ui;
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
      return { success: true, migrations: migrationResult, bootstrap: buildResult, firstRun: !!buildResult };
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
        const protocol = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
        // THIS machine, browsing by loopback name, with no proxy/CDN header (net-guard.js). Everything else — the public
        // tunnel, a PC on the LAN, a forged Host — is "remote": it gets the page's own /_supabase proxy and NO admin bits.
        const isLocal = netGuard.isLocalRequest(req);

        let supabaseUrl;
        if (isLocal) {
          // Local access: connect directly to the API proxy (loopback-only listener; the page's origin is a loopback origin,
          // which the proxy's CORS allows).
          supabaseUrl = `http://localhost:${this.activeApiPort}`;
        } else {
          // Tunnel / LAN access: same origin, so requests go through THIS server's /_supabase proxy
          // (localhost on the client's machine is not this machine).
          supabaseUrl = `${protocol}://${host}/_supabase`;
        }

        // Shell version — the number WE ship and the number the subscriber
        // quotes ("I'm on 1.8.0"). The web bundle only knows its own
        // package.json version, baked at build time, so without this an error
        // report cannot say which released build broke. Read from Electron so
        // it can never drift from what electron-updater installed.
        let shellVersion = '';
        try { shellVersion = require('electron').app.getVersion() || ''; } catch { /* dev */ }

        // The admin-API secret is handed ONLY to a LOCAL, same-origin page load (a browser says so in Sec-Fetch-Site).
        // <script src="http://localhost:8080/config.js"> on any other website is "cross-site" and must never receive it (the
        // anon key is public by design; this one is not). A remote caller — the tunnel, a LAN PC (curl sends no Origin and no
        // Sec-Fetch-Site, so "no header" alone proves nothing), a forged Host — never receives it: isLocal above is decided
        // by Host + TCP peer + the absence of proxy headers, not by "not a .texacore.ai host".
        const site = String(req.headers['sec-fetch-site'] || '');
        const origin = String(req.headers['origin'] || '');
        const sameOrigin = site === 'same-origin' || site === 'none' || (!site && !origin);
        const adminBits = (isLocal && sameOrigin)
          ? `
  localApiBase: "",
  localApiSecret: "${this.localApiSecret}",`
          : '';

        const configJs = `
// Auto-generated by TexaCore Service Manager
window.__TEXACORE_CONFIG__ = {
  supabaseUrl: "${supabaseUrl}",
  supabaseKey: "${anonKey}",
  mode: "selfhosted",
  appVersion: "${shellVersion}",${adminBits}
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
          // Same-origin for every real caller (the page loaded from this server). CORS only for loopback origins; the
          // upstream's own CORS headers are dropped, never turned into '*'.
          const h = netGuard.stripCorsHeaders(proxyRes.headers);
          Object.assign(h, netGuard.corsHeadersFor(req));
          res.writeHead(proxyRes.statusCode, h);
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
        netGuard.applyCors(req, res);
        res.sendStatus(204);
      });

      // ALL Supabase API proxy (REST, Auth, Storage, etc.)
      app.all('/_supabase/*', (req, res) => {
        proxyRequest(req, res);
      });

      // Admin API proxy (/api/companies, /api/delete-company, etc.)
      // These are served by the Electron admin server (main.js, PORTS.admin). The installer's admin API is a LOCAL
      // control surface (create/delete companies, backups, restores, tunnel control). This front-end server listens on
      // 0.0.0.0 (the office PCs open the ERP from it), so "not the cloud" is NOT "local": a LAN PC or a forged Host would
      // otherwise reach it. Default-deny: only a request from THIS machine (net-guard.isLocalRequest: loopback Host + loopback
      // TCP peer + no proxy/CDN header) gets through; everyone else — the tunnel, a LAN client — gets /api/ping and nothing
      // else. The admin server re-checks the same facts (the proxy forwards them as x-texacore-fwd-*), and every call but
      // /api/ping also needs the per-install secret.
      const REMOTE_API_ALLOW = new Set(['/api/ping']);
      app.all('/api/*', (req, res) => {
        const urlPath = (req.url || '').split('?')[0];
        if (!netGuard.isLocalRequest(req) && !REMOTE_API_ALLOW.has(urlPath)) {
          res.status(403).json({ error: 'This administrative operation is local-only and cannot be performed remotely.' });
          return;
        }
        const proxyOptions = {
          hostname: '127.0.0.1',
          port: ADMIN_PORT,
          path: req.url,
          method: req.method,
          // x-texacore-fwd-* are OURS: whatever the client sent under those names is replaced, never trusted.
          headers: {
            ...req.headers,
            host: `127.0.0.1:${ADMIN_PORT}`,
            'x-texacore-fwd-host': String(req.headers.host || ''),
            'x-texacore-fwd-peer': String((req.socket && req.socket.remoteAddress) || ''),
            'x-texacore-fwd-proxied': netGuard.hasProxyHeaders(req.headers) ? '1' : '0',
          },
        };

        const proxyReq = http.request(proxyOptions, (proxyRes) => {
          const h = netGuard.stripCorsHeaders(proxyRes.headers);
          Object.assign(h, netGuard.corsHeadersFor(req));
          res.writeHead(proxyRes.statusCode, h);
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
    // Test/launch-check stub: never open a tunnel (and never call the cloud) from a harness run.
    if (process.env.TEXACORE_STUB_TUNNEL === '1' && harnessAllowed(require('electron').app.isPackaged)) {
      console.log('[ServiceManager] TEXACORE_STUB_TUNNEL=1 — cloudflared stubbed (launch check)');
      return;
    }

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
    if (process.env.TEXACORE_CLOUDFLARED_BIN && harnessAllowed(require('electron').app.isPackaged)) skipVerify = true;   // release check: no lookups of the real domain
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
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
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
    
    // (isolated release-check runs only: a stand-in executable, so the way the tunnel process is started can be inspected without a real tunnel)
    if (process.env.TEXACORE_CLOUDFLARED_BIN && harnessAllowed(require('electron').app.isPackaged) && fs.existsSync(process.env.TEXACORE_CLOUDFLARED_BIN)) {
      cloudflaredBin = process.env.TEXACORE_CLOUDFLARED_BIN;
    }
    for (const p of possiblePaths) {
      if (cloudflaredBin) break;
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
      // The tunnel token is a credential: it goes to cloudflared through its environment (TUNNEL_TOKEN), NOT as `--token <value>` — a command line is
      // visible to every process on the machine (ps), the environment of a process is not.
      const proc = spawn(cloudflaredBin, ['tunnel', '--no-autoupdate', 'run'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, TUNNEL_TOKEN: config.tunnelToken },
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
    if (process.env.TEXACORE_STUB_MDM === '1' && harnessAllowed(require('electron').app.isPackaged)) {
      console.log('[ServiceManager] TEXACORE_STUB_MDM=1 — MeshAgent stubbed (launch check)');
      return;
    }
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
    try {
      const { ensureVendorSupport } = require('./provisioning');
      const first = await this.pgQuery('SELECT tenant_id, id FROM public.companies ORDER BY created_at LIMIT 1');
      const row = first.rows[0] || {};
      const userId = await ensureVendorSupport(this.provisioningDeps(), { vendor, tenantId: row.tenant_id || null, companyId: row.id || null });
      console.log(`[ServiceManager] Vendor support account ensured: ${userId}`);
    } catch (err) {
      console.warn('[ServiceManager] Could not ensure vendor support account:', err.message);
      // Non-fatal — don't crash startup
    }
  }

  /** What provisioning.js needs from this manager (loopback URLs of the running services + a superuser DB connection). */
  provisioningDeps(extra = {}) {
    const { Client } = require('pg');
    return {
      connect: async () => { const c = new Client(this.pgClientOptions()); await c.connect(); return c; },
      gotrueUrl: `http://127.0.0.1:${this.activeGotruePort}`,
      restUrl: `http://127.0.0.1:${this.activePostgrestPort}`,
      anonKey: this.anonKey,
      serviceKey: this.serviceKey,
      log: (m) => console.log(m),
      ...extra,
    };
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
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2), { mode: 0o600 });
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
    const bad = validateAdminPassword(plain, { licenseKey: this._readConfig().licenseKey });
    if (bad) throw new Error(bad);
    return this._withPgClient(async (client) => {
      const r = await client.query(`SELECT extensions.crypt($1, extensions.gen_salt('bf')) AS h`, [String(plain)]);
      const hash = r.rows[0].h;
      await client.query(
        `INSERT INTO public.platform_admin(id, password_hash, updated_at)
         VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now(), failed_attempts = 0, locked_until = NULL`,
        [hash]
      );
      const cfg = this._readConfig();
      cfg.adminPasswordHash = hash;
      this._writeConfig(cfg);
      console.log('[ServiceManager] 🔑 Admin portal password updated.');
      return true;
    });
  }

  // Push the current admin password into the DB. Custom hash from config if set, otherwise default = the license key
  // (unique per install, the manager has it). With NEITHER there is no password at all and the portal stays locked —
  // the old "admin" fallback is gone. The table and verify_admin_password() come from src/bootstrap/local_extras.sql.
  // Runs on startup + after every restore.
  async syncAdminPassword() {
    const cfg = this._readConfig();
    try {
      await this._withPgClient(async (client) => {
        if (cfg.adminPasswordHash) {
          await client.query(
            `INSERT INTO public.platform_admin(id, password_hash, updated_at)
             VALUES (1, $1, now())
             ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, updated_at = now()`,
            [cfg.adminPasswordHash]
          );
        } else if (cfg.licenseKey) {
          await client.query(
            `INSERT INTO public.platform_admin(id, password_hash, updated_at)
             VALUES (1, extensions.crypt($1, extensions.gen_salt('bf')), now())
             ON CONFLICT (id) DO UPDATE SET password_hash = extensions.crypt($1, extensions.gen_salt('bf')), updated_at = now()`,
            [String(cfg.licenseKey)]
          );
        } else {
          await client.query(
            `INSERT INTO public.platform_admin(id, password_hash, updated_at) VALUES (1, NULL, now())
             ON CONFLICT (id) DO UPDATE SET password_hash = NULL, updated_at = now()`
          );
        }
        try { await client.query(`NOTIFY pgrst, 'reload schema'`); } catch { /* ignore */ }
      });
      console.log(`[ServiceManager] 🔐 Admin portal password synced (${cfg.adminPasswordHash ? 'custom' : cfg.licenseKey ? 'default = license key' : 'none — portal locked'}).`);
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

// Export constants for use in main.js (ports only — 2.0.0 has no fixed keys or secrets to export)
ServiceManager.PG_PORT = PG_PORT;
ServiceManager.POSTGREST_PORT = DEFAULT_POSTGREST_PORT;
ServiceManager.GOTRUE_PORT = DEFAULT_GOTRUE_PORT;
ServiceManager.API_PORT = DEFAULT_API_PORT;
ServiceManager.ADMIN_PORT = ADMIN_PORT;
ServiceManager.PORTS = PORTS;

module.exports = ServiceManager;
