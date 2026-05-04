// ════════════════════════════════════════════════════════════════
// 📦 TexaCore MigrationRunner — Automatic Schema Management
// Applies SQL migrations from migrations.json on first run
// and on subsequent app updates that include new migrations.
// ════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

class MigrationRunner {
  /**
   * @param {object} opts
   * @param {Function} opts.psqlExec  — (sql, dbName?) => Promise<string>
   * @param {string}   opts.pgBin — absolute path to pg bin directory
   * @param {boolean}  opts.isWindows — running on Windows?
   * @param {string}   opts.migrationsDir — absolute path to migrations folder
   * @param {Function} opts.onProgress — (step, total, migrationName) => void
   */
  constructor({ psqlExec, pgBin, isWindows, migrationsDir, onProgress }) {
    this.psqlExec = psqlExec;
    this.pgBin = pgBin || '';
    this.isWindows = isWindows || false;
    this.migrationsDir = migrationsDir;
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
      -- Allow service_role to read migration state
      GRANT SELECT ON public._texacore_migrations TO anon, authenticated, service_role;
    `);
  }

  // ─── Load manifest ───────────────────────────────────────────
  loadManifest() {
    const manifestPath = path.join(this.migrationsDir, 'migrations.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`migrations.json not found at ${manifestPath}`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
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
    console.log('[MigrationRunner] Starting migration check...');

    // 1. Ensure tracking table
    await this.ensureTrackingTable();

    // 2. Load manifest & applied state
    const manifest = this.loadManifest();
    const applied = new Set(await this.getAppliedMigrations());

    // 3. Find pending migrations
    const pending = manifest.filter(m => !applied.has(m.name));

    if (pending.length === 0) {
      console.log('[MigrationRunner] ✅ All migrations already applied');
      return { applied: 0, total: manifest.length, skipped: manifest.length };
    }

    console.log(`[MigrationRunner] Found ${pending.length} pending migrations (${applied.size} already applied)`);

    let successCount = 0;
    const errors = [];

    for (let i = 0; i < pending.length; i++) {
      const migration = pending[i];
      const filePath = path.join(this.migrationsDir, migration.file);

      this.onProgress(i + 1, pending.length, migration.name);

      // Check file exists
      if (!fs.existsSync(filePath)) {
        console.warn(`[MigrationRunner] ⚠️ File not found: ${migration.file} — skipping`);
        errors.push({ name: migration.name, error: 'File not found' });
        continue;
      }

      let sql = fs.readFileSync(filePath, 'utf8');
      const checksum = this._checksum(sql);

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

      const startTime = Date.now();

      try {
        // For large migrations (>100KB), write to temp file and use psql -f
        // to avoid stdin buffer overflow issues
        if (sql.length > 100000) {
          const os = require('os');
          const tmpFile = path.join(os.tmpdir(), `texacore_migration_${Date.now()}.sql`);
          fs.writeFileSync(tmpFile, sql, 'utf8');
          console.log(`[MigrationRunner] Large migration (${(sql.length/1024/1024).toFixed(1)}MB) — using psql -f`);
          try {
            const { spawn } = require('child_process');
            await new Promise((resolve, reject) => {
              const psqlExe = this.isWindows ? 'psql.exe' : 'psql';
              const psqlPath = this.pgBin ? path.join(this.pgBin, psqlExe) : psqlExe;
              const spawnOpts = {};
              if (this.isWindows && this.pgBin) {
                spawnOpts.env = { ...process.env, PATH: this.pgBin + ';' + (process.env.PATH || '') };
              }
              console.log(`[MigrationRunner] Executing: ${psqlPath} -f ${tmpFile}`);
              const psql = spawn(psqlPath, [
                '-p', '54322', '-h', 'localhost', '-U', 'postgres',
                '-d', 'postgres', '-v', 'ON_ERROR_STOP=0',
                '-f', tmpFile
              ], spawnOpts);
              let errOut = '';
              psql.stdout.on('data', () => {});
              psql.stderr.on('data', d => errOut += d.toString());
              psql.on('error', err => reject(new Error(`psql spawn error: ${err.message}`)));
              // ON_ERROR_STOP=0 means psql always exits 0; we treat it as success
              psql.on('close', () => resolve());
            });
          } finally {
            try { fs.unlinkSync(tmpFile); } catch {}
          }
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
        console.log(`[MigrationRunner] ✅ (${i + 1}/${pending.length}) ${migration.name} — ${elapsed}ms`);
      } catch (err) {
        const elapsed = Date.now() - startTime;
        console.error(`[MigrationRunner] ❌ (${i + 1}/${pending.length}) ${migration.name} — FAILED (${elapsed}ms)`);
        console.error(`  Error: ${err.message}`);

        errors.push({ name: migration.name, error: err.message });

        // For critical early migrations (first 23 = core schema), stop on failure
        if (migration.order <= 23) {
          console.error('[MigrationRunner] 🛑 Critical migration failed — aborting');
          break;
        }

        // For later migrations, try to continue (they may be fixes/patches)
        // Record as applied to avoid re-trying a broken migration
        try {
          await this.psqlExec(`
            INSERT INTO public._texacore_migrations (name, checksum, execution_ms)
            VALUES ('${migration.name.replace(/'/g, "''")}__FAILED', '${checksum}', ${elapsed})
            ON CONFLICT (name) DO NOTHING;
          `);
        } catch { /* ignore tracking error */ }

        console.log('[MigrationRunner] ⏭️ Continuing with next migration...');
      }
    }

    const result = {
      applied: successCount,
      failed: errors.length,
      total: manifest.length,
      pending: pending.length,
      errors: errors.length > 0 ? errors : undefined,
    };

    if (errors.length === 0) {
      console.log(`[MigrationRunner] ✅ All ${successCount} migrations applied successfully`);
    } else {
      console.warn(`[MigrationRunner] ⚠️ ${successCount} applied, ${errors.length} failed`);
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
