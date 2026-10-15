// ════════════════════════════════════════════════════════════════
// 📦 TexaCore MigrationRunner — Automatic Schema Management
// Applies the SQL migrations listed in migrations.json (in manifest order) after the baseline, on every start, skipping the names already
// recorded in public._texacore_migrations.
//
// 2.0.2 failure policy (the first incremental release):
//   * each file is executed with ON_ERROR_STOP=1 — over stdin, the big ones (> 100 KB) with a dedicated psql — and a non-zero psql exit is a FAILURE
//     (the 1.x big-file path ran with ON_ERROR_STOP switched off and counted every run as a success: a migration that rolled back would have been recorded as applied)
//   * every shipped file is its own BEGIN … COMMIT, so a failed file leaves nothing behind (the session ends, the transaction rolls back)
//   * the FIRST failure stops the chain (later files may depend on it), nothing is recorded for the failed file (the next start tries it again), and the
//     caller carries on starting the app on the schema as it is — the database is never left half-updated, the app is never left unusable
//   * a file whose sha256 differs from the manifest is refused (damaged or edited)
//
// Where the SQL comes from (2.0.2, final): a migrations STORE (src/migrations-store.js) — in a packaged app the encrypted container (migrations.bin, decrypted in memory),
// in development the git-ignored ./migrations folder. The SQL is handed to psql over stdin, big files included: it is never written to a temp file, never logged.
// ════════════════════════════════════════════════════════════════

const path = require('path');
const crypto = require('crypto');
const { dirStore } = require('./migrations-store');

class MigrationRunner {
  /**
   * @param {object} opts
   * @param {Function} opts.psqlExec  — (sql, dbName?) => Promise<string>
   * @param {string}   opts.pgBin — absolute path to pg bin directory
   * @param {boolean}  opts.isWindows — running on Windows?
   * @param {object}   [opts.store] — a migrations store ({ manifest(), read(file) → Buffer, release() }, src/migrations-store.js); the packaged app passes the encrypted one
   * @param {string}   [opts.migrationsDir] — a plain folder (migrations.json + .sql) used when no store is given (development, tests)
   * @param {Function} opts.onProgress — (step, total, migrationName) => void
   * @param {Function} [opts.log] — (level, message) => void  (default: console; the service manager also appends to logs/migrations.log)
   */
  constructor({ psqlExec, pgBin, pgEnv, isWindows, store, migrationsDir, onProgress, log }) {
    this.log = log || ((level, msg) => (level === 'error' ? console.error(msg) : level === 'warn' ? console.warn(msg) : console.log(msg)));
    this.psqlExec = psqlExec;
    this.pgEnv = pgEnv;
    this.pgBin = pgBin || '';
    this.isWindows = isWindows || false;
    this.store = store || dirStore(migrationsDir);
    this.onProgress = onProgress || (() => {});
  }

  // ─── Ensure tracking table exists ─────────────────────────────
  async ensureTrackingTable() {
    await this.psqlExec(`
      CREATE TABLE IF NOT EXISTS public._texacore_migrations (
        id            SERIAL PRIMARY KEY,
        name          TEXT NOT NULL UNIQUE,
        applied_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        checksum      TEXT,
        execution_ms  INTEGER
      );
      -- 2.0.0: the baseline's DEFAULT PRIVILEGES hand every new public table to anon/authenticated. This bookkeeping table must
      -- be reachable by nobody over the API: revoke, and turn RLS on with no policy (deny by default).
      ALTER TABLE public._texacore_migrations ENABLE ROW LEVEL SECURITY;
      REVOKE ALL ON public._texacore_migrations FROM PUBLIC, anon, authenticated;
      REVOKE ALL ON SEQUENCE public._texacore_migrations_id_seq FROM PUBLIC, anon, authenticated;
    `);
  }

  // ─── Load manifest ───────────────────────────────────────────
  loadManifest() {
    const manifest = this.store.manifest();
    if (!manifest) throw new Error('migrations.json not found');
    return manifest.migrations || [];
  }

  // ─── Get already-applied migrations ──────────────────────────
  async getAppliedMigrations() {
    try {
      const result = await this.psqlExec(
        `SELECT name FROM public._texacore_migrations ORDER BY id;`
      );
      // Parse psql output — each line is a migration name
      return result
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('-') && !l.startsWith('name') && !l.includes('rows)') && !l.startsWith('('));
    } catch {
      // Table doesn't exist yet → no migrations applied
      return [];
    }
  }

  // ─── Simple checksum (first 100 chars hash) ──────────────────
  _checksum(content) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(content).digest('hex').slice(0, 12);
  }

  // ─── Run all pending migrations ──────────────────────────────
  async runAll() {
    try { return await this._runAll(); }
    finally { if (this.store.release) this.store.release(); }     // the decrypted copies leave memory
  }

  async _runAll() {
    this.log('info', '[MigrationRunner] Starting migration check...');

    // 1. Ensure tracking table
    await this.ensureTrackingTable();

    // 2. Load manifest & applied state
    const manifest = this.loadManifest();
    const applied = new Set(await this.getAppliedMigrations());

    // 3. Find pending migrations
    const pending = manifest.filter(m => !applied.has(m.name));

    if (pending.length === 0) {
      this.log('info', '[MigrationRunner] ✅ All migrations already applied');
      return { applied: 0, total: manifest.length, skipped: manifest.length };
    }

    this.log('info', `[MigrationRunner] Found ${pending.length} pending migrations (${applied.size} already applied)`);

    let successCount = 0;
    const errors = [];
    let stoppedAt = null;

    for (let i = 0; i < pending.length; i++) {
      const migration = pending[i];

      this.onProgress(i + 1, pending.length, migration.name);

      const startTime = Date.now();
      let checksum = null;
      try {
        const raw = this.store.read(migration.file);                    // a Buffer (throws "File not found" / an integrity error of the container)
        if (migration.sha256 && crypto.createHash('sha256').update(raw).digest('hex') !== migration.sha256) {
          throw new Error(`${migration.file} differs from the manifest's sha256 (damaged or edited) — not executed`);
        }
        let sql = raw.toString('utf8');
        checksum = this._checksum(sql);

        // ── Sanitize SQL for local PostgreSQL compatibility ──
        // Remove psql meta-commands that don't work via piped stdin
        sql = sql.replace(/^\\restrict\s+.*$/gm, '-- [auto-removed] \\restrict');
        sql = sql.replace(/^\\unrestrict\s+.*$/gm, '-- [auto-removed] \\unrestrict');
        // Remove SET transaction_timeout (PG17-specific, not all versions)
        sql = sql.replace(/^SET transaction_timeout\s*=\s*\d+;$/gm, '-- [auto-removed] SET transaction_timeout');
        // Prevent DROP SCHEMA public (destroys roles/grants set by ServiceManager)
        sql = sql.replace(/^DROP SCHEMA IF EXISTS public;$/gm, '-- [auto-removed] DROP SCHEMA public');
        // Convert CREATE SCHEMA public → IF NOT EXISTS
        sql = sql.replace(/^CREATE SCHEMA public;$/gm, 'CREATE SCHEMA IF NOT EXISTS public;');
        // Replace Supabase extensions.uuid_generate_v4() with built-in gen_random_uuid()
        sql = sql.replace(/extensions\.uuid_generate_v4\(\)/g, 'gen_random_uuid()');

        // Large migrations (>100KB): a dedicated psql with ON_ERROR_STOP=1 and the exit code checked, the SQL fed over stdin (`-f -`) — never a temp file, so the decrypted
        // text never touches the disk
        if (sql.length > 100000) {
          this.log('info', `[MigrationRunner] Large migration ${migration.name} (${(sql.length / 1024).toFixed(0)} KB) — psql over stdin`);
          const { spawn } = require('child_process');
          await new Promise((resolve, reject) => {
            const psqlExe = this.isWindows ? 'psql.exe' : 'psql';
            const psqlPath = this.pgBin ? path.join(this.pgBin, psqlExe) : psqlExe;
            const spawnOpts = { env: this.pgEnv ? this.pgEnv() : { ...process.env } };      // PGPASSWORD for the superuser comes from here, never from argv
            if (this.isWindows && this.pgBin) {
              spawnOpts.env = { ...spawnOpts.env, PATH: this.pgBin + ';' + (spawnOpts.env.PATH || process.env.PATH || '') };
            }
            const psql = spawn(psqlPath, [
              '-X', '-w', '-p', String(require('./ports').PORTS.pg), '-h', '127.0.0.1', '-U', 'postgres',
              '-d', 'postgres', '-v', 'ON_ERROR_STOP=1',
              '-f', '-'
            ], spawnOpts);
            let errOut = '';
            psql.stdout.on('data', () => {});
            psql.stderr.on('data', d => { errOut += d.toString(); });
            psql.stdin.on('error', () => { /* psql stopped reading (ON_ERROR_STOP): its exit code tells */ });
            psql.on('error', err => reject(new Error(`psql spawn error: ${err.message}`)));
            psql.on('close', (code) => {
              if (code === 0) return resolve();
              const lines = errOut.split('\n').map(l => l.trim()).filter(l => /ERROR|FATAL/.test(l)).slice(0, 3);
              reject(new Error(`psql(${code}): ${(lines.join(' | ') || errOut.slice(-400)).replace(/\s+/g, ' ')}`));
            });
            psql.stdin.end(Buffer.from(sql, 'utf8'));
          });
        } else {
          await this.psqlExec(sql);
        }
        const elapsed = Date.now() - startTime;

        // Record in tracking table
        await this.psqlExec(`
          INSERT INTO public._texacore_migrations (name, checksum, execution_ms)
          VALUES ('${migration.name.replace(/'/g, "''")}', '${checksum}', ${elapsed})
          ON CONFLICT (name) DO NOTHING;
        `);

        successCount++;
        this.log('info', `[MigrationRunner] ✅ (${i + 1}/${pending.length}) ${migration.name} — ${elapsed}ms`);
      } catch (err) {
        const elapsed = Date.now() - startTime;
        // psql's own error LINES only (its output also quotes the failing statement: the SQL is never logged)
        const rawMsg = String(err && err.message || err);
        const code = /^psql\((\d+)\):/.exec(rawMsg);
        const errLines = rawMsg.split('\n').map(l => l.trim().replace(/^psql\(\d+\):\s*/, '')).filter(l => /ERROR|FATAL/.test(l)).slice(0, 3);
        const msg = (code && errLines.length ? `psql(${code[1]}): ${errLines.join(' | ')}` : rawMsg).replace(/\s+/g, ' ').slice(0, 600);
        this.log('error', `[MigrationRunner] ❌ (${i + 1}/${pending.length}) ${migration.name} — FAILED (${elapsed}ms): ${msg}`);
        errors.push({ name: migration.name, error: msg });
        stoppedAt = migration.name;
        // Stop the chain: later files may depend on this one. Nothing is recorded, so the next start tries it again; the file was one transaction, so nothing of it is left.
        this.log('error', `[MigrationRunner] 🛑 stopped at ${migration.name}; ${pending.length - i - 1} later migration(s) were not run. The app starts on the schema as it is.`);
        break;
      }
    }

    const result = {
      applied: successCount,
      failed: errors.length,
      total: manifest.length,
      pending: pending.length,
      stoppedAt: stoppedAt || undefined,
      errors: errors.length > 0 ? errors : undefined,
    };

    if (errors.length === 0) {
      this.log('info', `[MigrationRunner] ✅ All ${successCount} migrations applied successfully`);
    } else {
      this.log('warn', `[MigrationRunner] ⚠️ ${successCount} applied, stopped at ${stoppedAt}`);
    }

    return result;
  }

  // ─── Get migration status (for UI) ──────────────────────────
  async getStatus() {
    const manifest = this.loadManifest();
    const applied = await this.getAppliedMigrations();
    return {
      total: manifest.length,
      applied: applied.length,
      pending: manifest.length - applied.length,
      lastApplied: applied[applied.length - 1] || null,
    };
  }
}

module.exports = MigrationRunner;
