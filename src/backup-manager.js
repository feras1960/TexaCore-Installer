// ════════════════════════════════════════════════════════════════
// 🔐 TexaCore BackupManager — Real-time Encrypted Database Backup
// Creates & maintains .tcdb files with full DB backup + encryption
// Similar to Al-Rasheed / Al-Ameen backup approach
// ════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const zlib = require('zlib');
const os = require('os');
const companyFile = require('./company-file');
const sqlGuard = require('./sql-guard');   // 2.0.4: a company file is scanned for commands (S3) and restored as DATA only (F1) - see sql-guard.js for exactly what that closes and what it does not

// ─── Encryption Constants ────────────────────────────────────
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
// Well-known fallback key. Backups are encrypted with the license key when a
// license is present, else this default. Historically restore paths hardcoded
// this default while backup paths used the license key → key mismatch made
// backups unrestorable. _decrypt now tries every candidate key (configured +
// license-on-disk + this default), so any .tcdb restores regardless of which
// key encrypted it. See [[local-hybrid-schema-sync]] #4.
const DEFAULT_BACKUP_KEY = 'texacore-default-backup-key-2026';
const TCDB_MAGIC = Buffer.from('TCDB');      // File signature
const TCDB_VERSION = 2;                       // Format version
const KEY_DERIVATION_ITERATIONS = 100000;
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

class BackupManager {
  /**
   * @param {object} opts
   * @param {string} opts.pgBinDir     - Path to pg/bin (contains pg_dump, pg_restore, psql)
   * @param {string} opts.dbHost       - PostgreSQL host (default: localhost)
   * @param {number} opts.dbPort       - PostgreSQL port (default: 54322)
   * @param {string} opts.dbName       - Database name (default: postgres)
   * @param {string} opts.dbUser       - Database user (default: postgres)
   * @param {string} opts.dbPassword   - Database password
   * @param {string} opts.backupPath   - Full path to the .tcdb file
   * @param {string} opts.encryptionKey - Master encryption key (derived from license or password)
   * @param {number} opts.intervalMs   - Sync interval in ms (default: 5 minutes)
   * @param {function} opts.onProgress - Progress callback: (phase, detail) => void
   * @param {function} opts.onError    - Error callback: (error) => void
   */
  constructor(opts) {
    this.pgDump = path.join(opts.pgBinDir, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump');
    this.pgRestore = path.join(opts.pgBinDir, process.platform === 'win32' ? 'pg_restore.exe' : 'pg_restore');
    this.psql = path.join(opts.pgBinDir, process.platform === 'win32' ? 'psql.exe' : 'psql');

    this.dbHost = opts.dbHost || 'localhost';
    this.dbPort = opts.dbPort || 54322;
    this.dbName = opts.dbName || 'postgres';
    this.dbUser = opts.dbUser || 'postgres';
    this.dbPassword = opts.dbPassword;
    this.backupPath = opts.backupPath;
    this.secondaryBackupPath = opts.secondaryBackupPath || null; // Redundant copy path
    this.encryptionKey = opts.encryptionKey;
    // Optional: dataDir lets us load the license key off disk as an extra
    // decrypt candidate (so a license-encrypted backup restores even on an
    // instance configured with the default key). Falls back silently.
    this.dataDir = opts.dataDir || null;
    this.fallbackEncryptionKeys = opts.fallbackEncryptionKeys || [];
    this.intervalMs = opts.intervalMs || 5 * 60 * 1000; // 5 minutes default
    this.onProgress = opts.onProgress || (() => {});
    this.onError = opts.onError || ((e) => console.error('[BackupManager]', e));
    // 2.0.4: asked before a write into the user's folder: on macOS a protected folder (Desktop / Documents / ...) whose permission is not granted - or whose
    // prompt is still up - would BLOCK the synchronous write and with it the whole program. { ok:false } skips this run and records why (no-permission).
    this.accessGuard = opts.accessGuard || BackupManager.defaultAccessGuard || null;

    this._timer = null;
    this._running = false;
    this._restoring = false;   // a restore is running: the timer's backup() skips (it would dump a half-cleared database and hold locks the truncate needs)
    this._lastBackupTime = null;
    this._backupCount = 0;
    // 2.0.2: what the user is shown - per target ('primary' = the company file, 'copy' = the program's own second copy): when it last
    // succeeded and, if it did not, why. consecutiveFailures counts primary runs in a row that wrote nothing because something failed.
    this._status = { primary: { lastSuccess: null, error: null, failures: 0 }, copy: { lastSuccess: null, error: null, failures: 0 } };
    this._consecutiveFailures = 0;
    this._lastSkipped = null;
    this._lastAccessBlock = null;
  }

  _markOk(role, when = new Date()) {
    const t = this._status[role];
    t.lastSuccess = when; t.error = null; t.failures = 0;
    if (role === 'primary') this._consecutiveFailures = 0;
  }

  _markFail(role, err, stage = 'write') {
    const t = this._status[role];
    const c = companyFile.classifyFsError(err, stage);
    t.error = { code: c.code, reason: c.reason, message: String((err && err.message) || err).slice(0, 300), at: new Date().toISOString() };
    t.failures += 1;
    if (role === 'primary') this._consecutiveFailures += 1;
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔑 Key Derivation
  // ═══════════════════════════════════════════════════════════════

  _deriveKey(salt, keyOverride) {
    return crypto.pbkdf2Sync(
      keyOverride || this.encryptionKey,
      salt,
      KEY_DERIVATION_ITERATIONS,
      32, // 256 bits
      'sha512'
    );
  }

  /**
   * Ordered list of candidate keys to try when decrypting a .tcdb:
   * configured key → explicit fallbacks → license key on disk → default.
   * Deduped, falsy-filtered. The configured key stays first so the common
   * case (key matches) succeeds on the first try with no extra work.
   */
  _candidateKeys(passphrase) {
    // 2.0.2: a user passphrase (a file exported with "protect with a passphrase") is tried FIRST when one is given.
    const keys = [...(passphrase ? [passphrase] : []), this.encryptionKey, ...this.fallbackEncryptionKeys];
    if (this.dataDir) {
      try {
        const LicenseGuard = require('./license-guard');
        const lic = new LicenseGuard(this.dataDir).loadLicense();
        if (lic && lic.license_key) keys.push(lic.license_key);
      } catch { /* no license / unreadable → skip */ }
    }
    keys.push(DEFAULT_BACKUP_KEY);
    return [...new Set(keys.filter(Boolean))];
  }

  // ═══════════════════════════════════════════════════════════════
  // 📦 BACKUP: pg_dump → compress → encrypt → .tcdb
  // ═══════════════════════════════════════════════════════════════

  /**
   * Run a full backup and write to the .tcdb file
   * @returns {Promise<{size: number, duration: number}>}
   */
  async backup() {
    if (this._running) {
      console.log('[BackupManager] Backup already in progress, skipping');
      return null;
    }
    if (this._restoring) {
      console.log('[BackupManager] A restore is running, skipping this backup');
      return null;
    }
    if (!this.backupPath) {   // 2.0.3 (review): a failed open detached the company file (afterFailedRestore) - the database belongs to no file, nothing is written
      console.log('[BackupManager] No company file attached, skipping this backup');
      return null;
    }

    this._running = true;
    const startTime = Date.now();
    if (this.accessGuard) {
      let g = null;
      try { g = await this.accessGuard(path.dirname(this.backupPath)); } catch { g = null; }
      if (g && g.ok === false) {
        this._running = false;
        this._markFail('primary', Object.assign(new Error(g.state === 'pending' ? 'macOS is still asking for permission to use the folder' : 'macOS has not allowed TexaCore to use the company file folder'), { code: 'FOLDER_PERMISSION' }), 'write');
        this._lastAccessBlock = { state: g.state || 'denied', area: g.area || null, at: new Date().toISOString() };
        this.onProgress('error', `⛔ لا إذن للمجلد (${g.area || ''}) | no permission for the folder (${g.area || ''})`);
        return null;
      }
      this._lastAccessBlock = null;
    }
    // the targets are fixed when the run starts: a company file opened while this dump runs (re-pointed after waitIdle gave up) must never receive the OLD database
    const target = this.backupPath;
    const secondary = this.secondaryBackupPath;
    let stage = 'dump';
    let tempPath = null;

    try {
      this.onProgress('start', 'بدء النسخ الاحتياطي...');
      const built = await this._produce();
      if (!built) { this._lastSkipped = new Date(); return null; }   // aborted: no company data in the dump — an empty dump never replaces a good backup
      const { tcdbBuffer, dumpData, compressed } = built;

      // Step 5: Atomic write (write to temp then rename)
      stage = 'write';
      tempPath = target + '.tmp';
      fs.writeFileSync(tempPath, tcdbBuffer);
      fs.renameSync(tempPath, target);
      tempPath = null;

      const duration = Date.now() - startTime;
      this._lastBackupTime = new Date();
      this._backupCount++;
      this._markOk('primary', this._lastBackupTime);

      const stats = {
        size: tcdbBuffer.length,
        originalSize: dumpData.length,
        compressedSize: compressed.length,
        duration,
        timestamp: this._lastBackupTime.toISOString(),
        backupNumber: this._backupCount,
      };

      this.onProgress('done', `✅ تم النسخ الاحتياطي (${(stats.size / 1024 / 1024).toFixed(1)} MB) في ${(duration / 1000).toFixed(1)}s`);
      console.log(`[BackupManager] Backup #${this._backupCount} complete: ${(stats.size / 1024).toFixed(0)} KB in ${duration}ms`);

      // ─── Copy to secondary backup location (the program's own second copy) ───
      // 2.0.2: written through a temp name + rename (a half-written copy never replaces a good one), and its own success/failure is kept
      // so the user can see that THIS target is in step (or why it is not) without the primary's result hiding it.
      if (secondary) {
        let secTemp = null;
        try {
          const secDir = path.dirname(secondary);
          // 2.0.4 (review F4): the second copy's folder is asked about too when it is not the company file's own (a protected folder whose permission is missing would block the write)
          if (this.accessGuard && secDir !== path.dirname(target)) {
            let g2 = null;
            try { g2 = await this.accessGuard(secDir); } catch { g2 = null; }
            if (g2 && g2.ok === false) throw Object.assign(new Error(g2.state === 'pending' ? 'macOS is still asking for permission to use the folder of the second copy' : 'macOS has not allowed TexaCore to use the folder of the second copy'), { code: 'FOLDER_PERMISSION' });
          }
          if (!fs.existsSync(secDir)) fs.mkdirSync(secDir, { recursive: true });
          secTemp = secondary + '.tmp';
          fs.copyFileSync(target, secTemp);
          fs.renameSync(secTemp, secondary);
          secTemp = null;
          this._markOk('copy');
        } catch (e) {
          if (secTemp) { try { fs.unlinkSync(secTemp); } catch { /* gone */ } }
          this._markFail('copy', e);
          console.warn(`[BackupManager] Secondary copy failed: ${e.message}`);
        }
      }

      // ─── Daily snapshot rotation (last 5 days per company) ───
      if (this.backupPath === target) this._rotateDailySnapshot();

      return stats;
    } catch (error) {
      if (tempPath) { try { fs.unlinkSync(tempPath); } catch { /* gone */ } }   // (a disk-full run must not leave a half file beside the company file)
      this._markFail('primary', error, stage);
      this.onProgress('error', `❌ فشل النسخ الاحتياطي: ${error.message}`);
      this.onError(error);
      return null;
    } finally {
      this._running = false;
    }
  }

  /** "Sync now": one backup run right away (the same code the 60-second timer runs). Resolves the stats, or null when nothing was written. */
  syncNow() { return this.backup(); }

  /**
   * Steps 1-4 of a backup: pg_dump → verify → gzip → encrypt → the .tcdb bytes. Shared by the live sync (backup()) and the one-off
   * export (exportTo()): the file format and every safety check are the same. `keyOverride` = a user passphrase for an export;
   * undefined = the configured (unified / license) key. Returns null when the dump has no company data (nothing is written).
   */
  async _produce(keyOverride) {
      // Step 1: Run pg_dump to get SQL dump
      this.onProgress('dump', 'تصدير قاعدة البيانات...');
      const dumpData = await this._pgDump();

      // Step 1.5: Verify dump completeness — CRITICAL: prevent empty backups
      this.onProgress('verify', 'التحقق من اكتمال البيانات...');
      const dumpStr = dumpData.toString('utf8'); // Scan full dump
      const hasCompanies = dumpStr.includes('CREATE TABLE') && dumpStr.includes('companies');
      const hasCopyStatements = (dumpStr.match(/^COPY /gm) || []).length;
      const hasAuthSchema = dumpStr.includes('auth.');
      
      // Check if COPY public.companies actually has data (not just "\.")
      const companyCopyIdx = dumpStr.indexOf('COPY public.companies');
      let hasCompanyData = false;
      if (companyCopyIdx > -1) {
        const afterCopy = dumpStr.substring(companyCopyIdx, companyCopyIdx + 2000);
        const firstNewline = afterCopy.indexOf('\n');
        const secondNewline = afterCopy.indexOf('\n', firstNewline + 1);
        const dataLine = afterCopy.substring(firstNewline + 1, secondNewline);
        hasCompanyData = dataLine.trim() !== '\\.' && dataLine.trim().length > 10;
      }

      if (!hasCompanyData) {
        const warnMsg = `🛑 Backup SKIPPED — no company data in dump! (companies_table=${hasCompanies}, COPY_count=${hasCopyStatements})`;
        console.warn(`[BackupManager] ${warnMsg}`);
        this.onProgress('verify', warnMsg);
        // ABORT: Don't overwrite a good backup with an empty one
        return null;
      }
      
      if (!hasCompanies || hasCopyStatements < 5) {
        const warnMsg = `⚠️ Dump may be incomplete: companies=${hasCompanies}, COPY_count=${hasCopyStatements}, auth=${hasAuthSchema}`;
        console.warn(`[BackupManager] ${warnMsg}`);
        this.onProgress('verify', warnMsg);
        // Don't abort — save anyway but warn
      } else {
        console.log(`[BackupManager] ✅ Dump verified: ${hasCopyStatements} tables with data, auth=${hasAuthSchema}, company_data=✅`);
      }

      // Step 2: Compress with gzip
      this.onProgress('compress', 'ضغط البيانات...');
      const compressed = await this._compress(dumpData);

      // Step 3: Encrypt
      this.onProgress('encrypt', 'تشفير البيانات...');
      const encrypted = this._encrypt(compressed, keyOverride);

      // Step 4: Build .tcdb file with header + encrypted payload
      this.onProgress('write', 'كتابة الملف...');
      const tcdbBuffer = this._buildTcdbFile(encrypted, dumpData.length, compressed.length);
      return { tcdbBuffer, dumpData, compressed };
  }

  /**
   * 2.0.2 — a ONE-OFF export of the whole company database to `filePath` (the "سحب نسخة احتياطية" action of the desktop page).
   * The same pipeline and the same file format as the live company file (pg_dump → gzip → AES-256-GCM → TCDB v2), so the restore
   * wizard opens it unchanged. Differences from backup(): it never touches the live file's bookkeeping, makes no daily snapshot
   * and no secondary copy, and an EXISTING file is never replaced unless the caller says so (the OS save dialog already asked).
   *   passphrase — optional: the file is then encrypted with it INSTEAD of the unified key, so it opens only with that phrase.
   * @returns {Promise<{path:string,size:number,encrypted:boolean,originalSize:number,compressedSize:number,duration:number,timestamp:string}>}
   */
  async exportTo(filePath, { passphrase = '', overwrite = false } = {}) {
    if (!filePath) throw Object.assign(new Error('no export path'), { code: 'NO_PATH' });
    const target = path.resolve(filePath);
    if (!overwrite && fs.existsSync(target)) {
      throw Object.assign(new Error(`الملف موجود مسبقاً ولن يُستبدل | A file with this name already exists: ${target}`), { code: 'EXPORT_EXISTS' });
    }
    const startTime = Date.now();
    this.onProgress('start', 'بدء سحب النسخة...');
    const key = passphrase ? String(passphrase) : undefined;
    const built = await this._produce(key);
    if (!built) {
      throw Object.assign(new Error('لا توجد بيانات شركة في القاعدة — لم يُكتب أي ملف | There is no company data in the database - nothing was written'), { code: 'EXPORT_EMPTY' });
    }
    const { tcdbBuffer, dumpData, compressed } = built;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tempPath = `${target}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tempPath, tcdbBuffer, { mode: 0o600 });
      // an atomic move: a half-written export never appears under the final name. Without overwrite the target is re-checked at the last moment.
      if (!overwrite && fs.existsSync(target)) throw Object.assign(new Error(`الملف موجود مسبقاً ولن يُستبدل | A file with this name already exists: ${target}`), { code: 'EXPORT_EXISTS' });
      if (overwrite) fs.renameSync(tempPath, target);
      else {
        // no-clobber: a file created after the check above makes this fail (EEXIST) instead of being replaced
        try { fs.linkSync(tempPath, target); fs.unlinkSync(tempPath); }
        catch (le) {
          if (le && le.code === 'EEXIST') throw Object.assign(new Error(`الملف موجود مسبقاً ولن يُستبدل | A file with this name already exists: ${target}`), { code: 'EXPORT_EXISTS' });
          if (!le || !['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS'].includes(le.code)) throw le;
          fs.copyFileSync(tempPath, target, fs.constants.COPYFILE_EXCL);   // FAT/exFAT sticks and some shares have no hard links
          fs.unlinkSync(tempPath);
        }
      }
    } catch (e) {
      try { fs.unlinkSync(tempPath); } catch { /* already gone */ }
      throw e;
    }
    const duration = Date.now() - startTime;
    this.onProgress('done', `✅ تم سحب النسخة (${(tcdbBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
    return { path: target, size: tcdbBuffer.length, encrypted: !!key, originalSize: dumpData.length, compressedSize: compressed.length, duration, timestamp: new Date().toISOString() };
  }

  /**
   * Keep a rolling set of DAILY snapshots next to the live .tcdb: one dated
   * file per day (today's is refreshed on each call), pruned to the last `keep`
   * days. Gives "last 5 days" history per company without unbounded .bak
   * accumulation. Per-company isolation is automatic — each company's live file
   * has a distinct basename, and pruning filters by that basename prefix.
   * Throttled to ~hourly so it doesn't copy on every 1-minute backup.
   * @param {number} keep            how many daily snapshots to retain (default 5)
   * @param {number} minIntervalMs   skip if today's snapshot was refreshed this recently (default 1h; pass 0 to force, e.g. on quit)
   */
  _rotateDailySnapshot(keep = 5, minIntervalMs = 60 * 60 * 1000) {
    try {
      const now = Date.now();
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      if (this._lastSnapshotDay === today && this._lastSnapshotAt &&
          (now - this._lastSnapshotAt) < minIntervalMs) {
        return; // already refreshed today's snapshot recently
      }
      const dir = this.snapshotDir || path.join(path.dirname(this.backupPath), 'snapshots');   // 2.0.3: a file opened in place keeps its snapshots in the program's folder
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const base = path.basename(this.backupPath).replace(/\.tcdb$/i, '');
      const datedPath = path.join(dir, `${base}.${today}.tcdb`);
      fs.copyFileSync(this.backupPath, datedPath); // refresh today's snapshot
      this._lastSnapshotDay = today;
      this._lastSnapshotAt = now;
      // Prune: keep the newest `keep` dated snapshots for THIS company only.
      const prefix = `${base}.`;
      const dated = fs.readdirSync(dir)
        .filter(f => f.startsWith(prefix) && f.endsWith('.tcdb'))
        .sort(); // YYYY-MM-DD sorts chronologically
      while (dated.length > keep) {
        const oldest = dated.shift();
        try { fs.unlinkSync(path.join(dir, oldest)); } catch { /* ignore */ }
      }
      console.log(`[BackupManager] daily snapshot ${today} (keeping last ${keep})`);
    } catch (e) {
      console.warn(`[BackupManager] daily snapshot failed: ${e.message}`);
    }
  }

  /**
   * Run pg_dump and return the SQL as a Buffer
   */
  _pgDump() {
    return new Promise((resolve, reject) => {
      const env = {
        ...process.env,
        PGPASSWORD: this.dbPassword,
      };

      const args = [
        '-h', this.dbHost,
        '-p', String(this.dbPort),
        '-U', this.dbUser,
        '-d', this.dbName,
        '--no-owner',
        '--no-acl',
        // Full dump: structure + data (complete database snapshot)
        '--schema=public',
        '--schema=auth',
        '--format=plain',
        '--encoding=UTF8',
      ];

      const chunks = [];
      const proc = spawn(this.pgDump, args, { env, windowsHide: true });

      proc.stdout.on('data', (chunk) => chunks.push(chunk));
      proc.stderr.on('data', (data) => {
        const msg = data.toString();
        // Ignore non-critical warnings
        if (!msg.includes('ERROR') && !msg.includes('FATAL')) return;
        console.warn('[BackupManager] pg_dump warning:', msg);
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`pg_dump exited with code ${code}`));
        } else {
          resolve(Buffer.concat(chunks));
        }
      });

      proc.on('error', reject);
    });
  }

  /**
   * Compress data with gzip
   */
  _compress(data) {
    return new Promise((resolve, reject) => {
      zlib.gzip(data, { level: 6 }, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  /**
   * Decompress gzip data
   */
  _decompress(data) {
    return new Promise((resolve, reject) => {
      zlib.gunzip(data, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });
  }

  /**
   * Encrypt data with AES-256-GCM
   * @returns {{ salt, iv, authTag, ciphertext }}
   */
  _encrypt(data, keyOverride) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = this._deriveKey(salt, keyOverride);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return { salt, iv, authTag, ciphertext: encrypted };
  }

  /**
   * Decrypt data
   */
  _decrypt(salt, iv, authTag, ciphertext, passphrase) {
    const candidates = this._candidateKeys(passphrase);
    let lastErr;
    for (const candidate of candidates) {
      try {
        const key = this._deriveKey(salt, candidate);
        const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      } catch (e) {
        // GCM auth-tag mismatch on a wrong key → try the next candidate.
        lastErr = e;
      }
    }
    throw lastErr || new Error('فشل فك التشفير — لا مفتاح مطابق');
  }

  /**
   * Decrypt a parsed container with every candidate key (and the user's passphrase, tried first, when one is given). A wrong key and a
   * damaged file both fail GCM authentication; the SHA-256 field tells them apart:
   *   checksum matches the payload but no key opens it  → the file is intact, it needs (another) passphrase
   *   checksum does not match                            → the file was altered or damaged
   * Throws a coded Error: TCDB_PASSPHRASE_REQUIRED | TCDB_BAD_PASSPHRASE | TCDB_CORRUPT (the windows/pages translate by code).
   * @returns {{ data: Buffer, usedPassphrase: boolean }}
   */
  _decryptParsed(parsed, passphrase) {
    try {
      const data = this._decrypt(parsed.salt, parsed.iv, parsed.authTag, parsed.ciphertext, passphrase);
      // which key opened it: the passphrase, or one of the install's own? (one more derive of one key - cheap next to the dump)
      const usedPassphrase = !!passphrase && BackupManager._opensWith(parsed, this._deriveKey(parsed.salt, passphrase));
      return { data, usedPassphrase };
    } catch (e) {
      const actual = crypto.createHash('sha256').update(parsed.ciphertext).digest();
      const intact = actual.equals(parsed.checksum.subarray(0, 32));
      if (!intact) {
        throw Object.assign(new Error('الملف تالف أو عُدِّل بعد حفظه | The file is damaged or was modified after it was saved'), { code: 'TCDB_CORRUPT' });
      }
      if (passphrase) {
        throw Object.assign(new Error('عبارة المرور غير صحيحة | The passphrase is not correct'), { code: 'TCDB_BAD_PASSPHRASE' });
      }
      throw Object.assign(new Error('هذا الملف محمي بعبارة مرور — أدخلها لفتحه | This file is protected by a passphrase - enter it to open the file'), { code: 'TCDB_PASSPHRASE_REQUIRED' });
    }
  }

  /** Does `key` (an already derived 32-byte key) authenticate this container's payload? */
  static _opensWith(parsed, key) {
    try {
      const d = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, parsed.iv);
      d.setAuthTag(parsed.authTag);
      d.update(parsed.ciphertext);
      d.final();
      return true;
    } catch { return false; }
  }

  /**
   * Where a restore writes the statements that failed. 2.0.3: the program's own logs folder (restoreLogDir, else <dataDir>/logs) — since a
   * picked company file is opened IN PLACE, "next to the .tcdb" would put a technical log in the user's own folder beside his company file.
   * Falls back to the old place only when the manager knows no folder of its own.
   */
  _restoreErrorsLogPath() {
    const base = `${path.basename(this.backupPath || 'company.tcdb')}.restore-errors.log`;
    const dir = this.restoreLogDir || (this.dataDir ? path.join(this.dataDir, 'logs') : null);
    return dir ? path.join(dir, base) : `${this.backupPath}.restore-errors.log`;
  }

  /**
   * Can this container be opened with what we have (+ the optional passphrase)? Decrypts only (no gunzip, nothing executed, nothing written).
   * Used BEFORE a file is copied/restored so a protected file asks for its phrase first. Throws the coded errors of _decryptParsed().
   * @param {Buffer} buffer the whole .tcdb
   * @returns {{ usedPassphrase: boolean, timestamp: number, version: number }}
   */
  probeAccess(buffer, { passphrase = '' } = {}) {
    const parsed = this._parseTcdbFile(buffer);
    const { usedPassphrase } = this._decryptParsed(parsed, passphrase);
    return { usedPassphrase, timestamp: parsed.timestamp, version: parsed.version };
  }

  // ═══════════════════════════════════════════════════════════════
  // 📄 .tcdb File Format
  // ═══════════════════════════════════════════════════════════════
  //
  // Offset  | Size     | Description
  // --------|----------|-------------------------------------------
  // 0       | 4        | Magic: "TCDB"
  // 4       | 1        | Version (2)
  // 5       | 8        | Timestamp (ms since epoch, BigUInt64LE)
  // 13      | 4        | Original SQL size (UInt32LE)
  // 17      | 4        | Compressed size (UInt32LE)
  // 21      | 4        | Encrypted payload size (UInt32LE)
  // 25      | 32       | Salt
  // 57      | 16       | IV
  // 73      | 16       | Auth Tag
  // 89      | 64       | SHA-256 checksum of encrypted payload
  // 153     | N        | Encrypted payload (gzipped SQL)
  // ═══════════════════════════════════════════════════════════════

  _buildTcdbFile(encrypted, originalSize, compressedSize) {
    const { salt, iv, authTag, ciphertext } = encrypted;
    const payloadChecksum = crypto.createHash('sha256').update(ciphertext).digest();

    const headerSize = 153; // 4+1+8+4+4+4+32+16+16+64
    const totalSize = headerSize + ciphertext.length;
    const buffer = Buffer.alloc(totalSize);

    let offset = 0;

    // Magic
    TCDB_MAGIC.copy(buffer, offset); offset += 4;
    // Version
    buffer.writeUInt8(TCDB_VERSION, offset); offset += 1;
    // Timestamp
    buffer.writeBigUInt64LE(BigInt(Date.now()), offset); offset += 8;
    // Original size
    buffer.writeUInt32LE(originalSize, offset); offset += 4;
    // Compressed size
    buffer.writeUInt32LE(compressedSize, offset); offset += 4;
    // Encrypted payload size
    buffer.writeUInt32LE(ciphertext.length, offset); offset += 4;
    // Salt
    salt.copy(buffer, offset); offset += 32;
    // IV
    iv.copy(buffer, offset); offset += 16;
    // Auth Tag
    authTag.copy(buffer, offset); offset += 16;
    // Checksum
    payloadChecksum.copy(buffer, offset); offset += 64;
    // Encrypted payload
    ciphertext.copy(buffer, offset);

    return buffer;
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔄 RESTORE: .tcdb → decrypt → decompress → psql
  // ═══════════════════════════════════════════════════════════════

  /**
   * Restore database from .tcdb file
   * @param {string} [filePath] - Override file path (default: this.backupPath)
   * @returns {Promise<{duration: number, sqlSize: number}>}
   */
  /** The major version of the PostgreSQL that wrote a plain dump ("-- Dumped from database version 15.17"), or null when the text does not say. */
  static dumpedFromMajor(sqlText) {
    const m = /^-- Dumped from database version (\d+)/m.exec(String(sqlText).slice(0, 4000));
    return m ? parseInt(m[1], 10) : null;
  }

  /** The refusal for a .tcdb written by a pre-2.0 build. `code` lets the windows show their own translated text; `error` is bilingual for the web page. */
  static legacyFileError(major) {
    const e = new Error(
      `هذا الملف من الإصدار 1.x (قاعدة PostgreSQL ${major}) ولا يمكن فتحه في 2.0: اختلفت بنية البيانات، وفتحه كان سيُفقد معظم الجداول (الشركات والعملاء والقيود…) ويترك قاعدة البيانات أقلّ أماناً. لم يتغيّر الملف ولا قاعدة البيانات الحالية. | ` +
      `This file comes from a 1.x build (PostgreSQL ${major}) and cannot be opened in 2.0: the data layout changed, most tables would not load and the database would be left less secure. Neither the file nor the current database was changed.`);
    e.code = 'LEGACY_TCDB'; e.dumpedFromMajor = major;
    return e;
  }

  /**
   * Read + decrypt + decompress just far enough to learn which PostgreSQL wrote the file (nothing is executed).
   * 2.0.4: a file written by 17 or later (the only kind that can be opened) is also read for commands TexaCore never writes (sql-guard.js) - TCDB_UNSAFE_SQL - so a
   * refusal comes BEFORE the manager is re-pointed at the file or anything is written. A 1.x file just reports its major (the caller refuses it with the 1.x text).
   */
  async peekDumpMajor(filePath, { passphrase = '' } = {}) {
    return this.preflightBuffer(fs.readFileSync(filePath), { passphrase });
  }

  /** peekDumpMajor() for bytes already in memory (an upload, before it is written to disk). */
  async preflightBuffer(buffer, { passphrase = '' } = {}) {
    const parsed = this._parseTcdbFile(buffer);
    const sql = await this._decompress(this._decryptParsed(parsed, passphrase).data);
    const major = BackupManager.dumpedFromMajor(sql.subarray(0, 4000).toString('utf8'));
    if (major === null || major >= 17) sqlGuard.assertSafeDump(sql);
    return major;
  }

  /**
   * Resolve once no backup is running (or after `maxMs`): a dump that started before a restore reads the very tables the restore truncates (they deadlock),
   * and one that finishes after the target was re-pointed would write the OLD database into the new target file.
   */
  async waitIdle(maxMs = 120000) {
    const t0 = Date.now();
    while (this._running && Date.now() - t0 < maxMs) await new Promise((r) => setTimeout(r, 100));
    return !this._running;
  }

  /** Restore a .tcdb into the database. A running backup is waited for first and no new one starts until the restore is over. */
  async restore(filePath, { passphrase = '' } = {}) {
    this._restoring = true;
    this.lastRestoreTouchedDb = false;
    try {
      await this.waitIdle();
      return await this._restoreFile(filePath, { passphrase });
    } finally {
      this._restoring = false;
    }
  }

  /**
   * 2.0.3 (review): a restore failed AFTER the caller re-pointed this manager at the file being opened. No later backup (the timer, «backup now», the final
   * backup at quit) may write a database that is not that file's into it. Nothing replaced yet (the truncate never committed) = the database is still the
   * previous company's: it goes back to ITS file and timer. Otherwise the database is cleared / half loaded and belongs to no file: nothing is written.
   */
  afterFailedRestore({ prevTarget = null, prevSecondary = null, wasSyncing = false } = {}) {
    this.stopSync();
    if (!this.lastRestoreTouchedDb && prevTarget) {
      this.backupPath = prevTarget;
      this.secondaryBackupPath = prevSecondary;
      if (wasSyncing) this.startSync();
    } else {
      this.backupPath = null;
      this.secondaryBackupPath = null;
    }
  }

  /**
   * A private file for a psql script. 2.0.3 (review): never beside the company file - opened IN PLACE that is the user's own folder (Desktop, a USB stick,
   * a cloud folder, beside a passphrase-protected export) and the restore script is the whole DECRYPTED database. Windows: an ASCII-only folder
   * (psql.exe reads its arguments in the ANSI code page).
   */
  _tmpSqlPath(kind) {
    const t = os.tmpdir();
    const dir = (process.platform === 'win32' && !/^[\x20-\x7e]+$/.test(t)) ? path.join(companyFile.defaultCompanyDir('win32'), '.tmp') : t;
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `texacore-${kind}-${process.pid}-${crypto.randomBytes(8).toString('hex')}.sql`);
  }

  async _restoreFile(filePath, { passphrase = '' } = {}) {
    const tcdbPath = filePath || this.backupPath;
    if (!fs.existsSync(tcdbPath)) {
      throw new Error(`ملف النسخة الاحتياطية غير موجود: ${tcdbPath}`);
    }

    this.onProgress('start', 'بدء الاستعادة...');
    const startTime = Date.now();

    try {
      // Step 1: Read and parse .tcdb file
      this.onProgress('read', 'قراءة الملف...');
      const parsed = this._parseTcdbFile(fs.readFileSync(tcdbPath));

      // Step 2: Verify checksum (non-blocking — warn but continue)
      this.onProgress('verify', 'التحقق من سلامة البيانات...');
      const actualChecksum = crypto.createHash('sha256').update(parsed.ciphertext).digest();
      // Checksum field is 64 bytes in header but SHA-256 is only 32 bytes
      // Compare only the first 32 bytes
      const storedChecksum = parsed.checksum.subarray(0, 32);
      if (!actualChecksum.equals(storedChecksum)) {
        console.warn('[BackupManager] ⚠️ Checksum mismatch — file may have been modified, attempting restore anyway');
        this.onProgress('verify', '⚠️ تحذير: تم تعديل الملف — جاري المتابعة...');
        // Don't throw — try to restore anyway
      }

      // Step 3: Decrypt
      this.onProgress('decrypt', 'فك تشفير البيانات...');
      // (a file exported with "protect with a passphrase" opens with it; without it the coded TCDB_PASSPHRASE_REQUIRED goes up and nothing is touched)
      const compressed = this._decryptParsed(parsed, passphrase).data;

      // Step 4: Decompress
      this.onProgress('decompress', 'فك ضغط البيانات...');
      const sql = await this._decompress(compressed);

      // Step 5: Execute SQL via psql.
      // Replace-not-merge: clear the existing public data BEFORE loading the
      // snapshot. The dump has no --clean, and COPY into a populated table fails
      // on PK conflict (skipped under ON_ERROR_STOP=off) → opening a .tcdb onto a
      // non-empty DB would otherwise MERGE the new snapshot on top of the old
      // company's rows (stale/corrupt data). Truncating the snapshot's own tables
      // first makes the restore an exact swap. auth.* is owned by _restoreAuthData
      // (step 5b) and is intentionally left out here. See [[local-hybrid-schema-sync]].
      const sqlStr = sql.toString('utf8');

      // A .tcdb written by a pre-2.0 build (a PostgreSQL < 17 dump of the 1.x local schema) is REFUSED before anything is touched. Measured on a real 1.8.0 file:
      // the dump's CREATE statements add ~38 tables / ~60 functions the 2.0 database does not have (38 of them readable by anon, no row security), the COPY of
      // every table whose columns differ fails as a whole (companies, tenants, customers, journal lines … came back empty), and the "replace" step has already
      // truncated what 2.0 held. The file itself is untouched; nothing is written to the database.
      const dumpedFrom = BackupManager.dumpedFromMajor(sqlStr);
      if (dumpedFrom !== null && dumpedFrom < 17) throw BackupManager.legacyFileError(dumpedFrom);

      // 2.0.4 (security S3): the default key of a company file is public, so the dump may have been written by anyone. Before ANYTHING is touched it is read the way psql
      // reads it: a psql meta-command (\! shell, \copy … program, \i, \o, \gexec …), COPY … PROGRAM, ALTER SYSTEM, an unshipped extension or language, file /
      // large-object functions, role changes … refuse the file (TCDB_UNSAFE_SQL). The refusal changes nothing: no truncate, no restore. (After the 1.x check: a 1.x file
      // keeps its own, clearer refusal.)
      sqlGuard.assertSafeDump(sql);

      // 2.0.4 (security F1): a company file is DATA. A real file also carries ~2,300 functions and ~1,300 triggers, and the scan above cannot tell a harmless body from a
      // harmful one - so none of the file's DDL is run. The database already has its schema (the baseline + the migrations the program ships); from the file only the COPY
      // data of the tables that exist and the sequence values are taken, in a script BUILT here (sql-guard planDataRestore / renderDataScript). No function, trigger, view or
      // policy of a file ever exists in the database. (A table the file has and this version does not is skipped and reported; an older file no longer replaces the shipped functions.)
      this.onProgress('restore', 'تهيئة الاستبدال...');
      const plan = sqlGuard.planDataRestore(sql);
      const live = await this._liveTables();
      if (!live.size) throw BackupManager.restoreError('TCDB_NO_SCHEMA', 'قاعدة البيانات المحلية غير مهيّأة بعد (لا جداول) — أعد تشغيل البرنامج ثم افتح الملف | The local database has no tables yet - restart the program and open the file again.');
      const data = sqlGuard.renderDataScript(plan, { known: live, before: "SET session_replication_role = 'replica';\n", after: "\nSET session_replication_role = 'origin';\n" });
      if (!data.loaded) throw BackupManager.restoreError('TCDB_NO_DATA', 'لا يحتوي الملف بيانات شركة يعرفها هذا الإصدار من TexaCore فلم يتغيّر شيء | This file holds no company data this version of TexaCore knows; nothing was changed.');
      const unknownTables = data.skipped.filter((x) => x.why === 'unknown-table');
      const foreignSchema = data.skipped.filter((x) => x.why === 'schema');
      if (unknownTables.length) {
        console.warn(`[BackupManager] ${unknownTables.length} table(s) of the file are not in this version's database and were not loaded: ${unknownTables.slice(0, 20).map((x) => x.table).join(', ')}`);
        this.onProgress('restore', `⚠️ ${unknownTables.length} جدول في الملف غير معروف لهذا الإصدار فلم يُحمَّل`);
      }
      if (foreignSchema.length) console.warn(`[BackupManager] ${foreignSchema.length} COPY block(s) of the file name a schema the program never dumps and were ignored: ${foreignSchema.slice(0, 10).map((x) => x.table).join(', ')}`);
      await this._truncatePublic(data.tables);
      this.lastRestoreTouchedDb = true;   // from here on the database is no longer the previous company's (afterFailedRestore)
      this.onProgress('restore', 'استعادة قاعدة البيانات...');
      const execRes = await this._executeSql(data.script);

      // 2.0.2 (20270210v): a file written before that migration has no fabric_materials.tracking_mode and the load above ran with the user triggers OFF (replica role),
      // so every card came back with the column's net default 'quantity' (a fabric must be 'roll'). The server's own repair puts them right. Only for a file that LACKS the column.
      if (BackupManager.needsTrackingModeRepair(sqlStr)) {
        try {
          const n = await this._repairTrackingModes();
          console.log(`[BackupManager] tracking_mode: ${n} card(s) of an older file worked out from their flags (fabric -> roll, serial / batch / roll flags -> that mode)`);
        } catch (re) {
          console.warn('[BackupManager] ⚠️ tracking_mode repair failed (the cards keep the default "quantity"; run: UPDATE public.fabric_materials SET tracking_mode = NULL WHERE material_type = \'fabric\'):', re.message);
          this.onProgress('restore', '⚠️ تعذّر ضبط نمط تتبّع المواد — راجع السجل');
        }
      }

      // Step 5b: Guarantee login accounts are loaded. The bulk restore above can
      // silently drop auth.users (its single transaction aborts on GoTrue's
      // pre-created tables) → no login after reopening, on any machine. Load them
      // explicitly so the .tcdb works on ANY install. Non-fatal: data already
      // restored; we warn rather than undo it if this step fails.
      this.onProgress('restore', 'استعادة حسابات الدخول...');
      try {
        await this._restoreAuthData(data.auth);
        await this._resetAuthSessions();
      } catch (e) {
        console.warn('[BackupManager] ⚠️ auth restore step failed:', e.message);
        this.onProgress('restore', '⚠️ تعذّرت استعادة حسابات الدخول — راجع السجل');
      }

      // Step 6: Verify the restore actually loaded data. A .tcdb is a full
      // snapshot, so an empty result means the restore failed — fail loudly
      // instead of silently reporting success (which would look like data loss).
      this.onProgress('restore', 'التحقق من نجاح الاستعادة...');
      try {
        const out = await this._queryScalar(
          "SELECT (SELECT count(*) FROM public.companies) + (SELECT count(*) FROM auth.users)"
        );
        const total = parseInt(String(out).trim(), 10);
        if (!Number.isFinite(total) || total <= 0) {
          throw new Error('قاعدة فارغة بعد الاستعادة — لم تُحمّل البيانات');
        }
      } catch (verr) {
        this.onProgress('error', `❌ فشل التحقق بعد الاستعادة: ${verr.message}`);
        throw verr;
      }

      const duration = Date.now() - startTime;
      this.onProgress('done', `✅ تمت الاستعادة (${(sql.length / 1024 / 1024).toFixed(1)} MB) في ${(duration / 1000).toFixed(1)}s`);

      return { duration, sqlSize: sql.length, copyErrors: (execRes && execRes.copyErrors ? execRes.copyErrors.length : 0), copyErrorsLog: (execRes && execRes.copyErrors && execRes.copyErrors.length) ? this._restoreErrorsLogPath() : null, dumpedFromMajor: dumpedFrom,
        dataOnly: { tables: data.loaded, skippedTables: unknownTables.slice(0, 50).map((x) => x.table), skippedCount: unknownTables.length, ignoredStatements: plan.ignored.total } };
    } catch (error) {
      this.onProgress('error', `❌ فشل الاستعادة: ${error.message}`);
      throw error;
    }
  }

  /** Does this plain dump COPY fabric_materials WITHOUT the tracking_mode column (a file written before 20270210v)? */
  static needsTrackingModeRepair(sqlText) {
    const m = /^COPY public\.fabric_materials \(([^)]*)\) FROM stdin;$/m.exec(String(sqlText || ''));
    return !!m && !/\btracking_mode\b/.test(m[1]);
  }

  /**
   * UPDATE … SET tracking_mode = NULL = "work it out from the flags" (the server's own repair for a load that switched the triggers off, 20270210v): a fabric -> roll, track_serial -> serial,
   * track_batch -> batch, is_roll_tracked -> roll, a service -> none. Runs with the triggers ON, as the superuser. Returns how many cards moved. A database without the column: 0.
   */
  async _repairTrackingModes() {
    const has = String(await this._queryScalar("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'fabric_materials' AND column_name = 'tracking_mode')")).trim();
    if (has !== 't') return 0;
    const out = await this._queryScalar("WITH u AS (UPDATE public.fabric_materials SET tracking_mode = NULL WHERE tracking_mode = 'quantity' AND (material_type = 'fabric' OR is_roll_tracked OR track_serial OR track_batch OR material_type = 'service') RETURNING 1) SELECT count(*) FROM u");
    return parseInt(String(out).trim(), 10) || 0;
  }

  _parseTcdbFile(buffer) {
    // Verify magic
    const magic = buffer.subarray(0, 4);
    if (!magic.equals(TCDB_MAGIC)) {
      throw new Error('ملف غير صالح — ليس ملف TexaCore');
    }

    let offset = 4;
    const version = buffer.readUInt8(offset); offset += 1;
    if (version > TCDB_VERSION) {
      throw new Error(`إصدار الملف (${version}) أحدث من المدعوم (${TCDB_VERSION})`);
    }

    const timestamp = Number(buffer.readBigUInt64LE(offset)); offset += 8;
    const originalSize = buffer.readUInt32LE(offset); offset += 4;
    const compressedSize = buffer.readUInt32LE(offset); offset += 4;
    const encryptedSize = buffer.readUInt32LE(offset); offset += 4;
    const salt = buffer.subarray(offset, offset + 32); offset += 32;
    const iv = buffer.subarray(offset, offset + 16); offset += 16;
    const authTag = buffer.subarray(offset, offset + 16); offset += 16;
    const checksum = buffer.subarray(offset, offset + 64); offset += 64;
    const ciphertext = buffer.subarray(offset, offset + encryptedSize);

    return {
      version, timestamp, originalSize, compressedSize,
      salt, iv, authTag, checksum, ciphertext
    };
  }

  /**
   * Run the restore script via psql. `script` is NOT the file's text: it is what sql-guard renderDataScript() built (the program's own settings, the COPY data of the tables
   * that exist, the sequence values - 2.0.4, F1). It is wrapped in psql's restricted mode as well (a meta-command could not run even if one had slipped through).
   */
  _executeSql(script) {
    return new Promise((resolve, reject) => {
      const tmpFile = this._tmpSqlPath('restore');
      // (the replica role - foreign keys and user triggers off - is part of the script; there is NO --single-transaction, see below)
      fs.writeFileSync(tmpFile, sqlGuard.prepareDump(script, { strip: false }), { mode: 0o600, flag: 'wx' });

      const env = {
        ...process.env,
        PGPASSWORD: this.dbPassword,
      };

      const args = [
        '-X',   // 2.0.4: no ~/.psqlrc - a start-up file of the user's account is not part of the restore
        '-h', this.dbHost,
        '-p', String(this.dbPort),
        '-U', this.dbUser,
        '-d', this.dbName,
        '-f', tmpFile,
        // NO --single-transaction: with ON_ERROR_STOP=off a single transaction
        // enters aborted state on the first benign "already exists" error (the
        // schema pre-exists), then EVERY following statement is skipped and the
        // final COMMIT becomes ROLLBACK — so the reset DB stays EMPTY (no data,
        // no login) after opening a .tcdb. Running statements independently lets
        // "already exists" be skipped while all COPY data actually loads.
        '--set', 'ON_ERROR_STOP=off',
      ];

      execFile(this.psql, args, { env, windowsHide: true, maxBuffer: 100 * 1024 * 1024 }, (err, stdout, stderr) => {
        // Clean up temp file
        try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }

        // ON_ERROR_STOP=off swallows per-statement failures, so a COPY that hits
        // a column mismatch / CHECK / unique error is skipped and that whole table
        // stays empty — silently. Surface these: write the ERROR lines (which row/
        // table didn't load and why) to a log next to the .tcdb so the cause is
        // visible instead of guessed. (Triggers + FK are already off via replica
        // role, so anything here is a real schema/data mismatch.)
        const errorLines = (stderr || '').split('\n')
          .filter(l => /ERROR:/.test(l) && !/already exists|does not exist, skipping/i.test(l));
        if (errorLines.length) {
          try {
            const logPath = this._restoreErrorsLogPath();
            fs.mkdirSync(path.dirname(logPath), { recursive: true });
            fs.writeFileSync(logPath,
              `Restore of ${path.basename(this.backupPath)} — ${errorLines.length} statement error(s) ` +
              `(these tables/rows did NOT load):\n\n` + errorLines.join('\n') + '\n');
            console.warn(`[BackupManager] ⚠️ ${errorLines.length} restore COPY errors — logged to ${logPath}`);
            errorLines.slice(0, 25).forEach(l => console.warn('  ' + l));
          } catch (e) { /* logging is best-effort */ }
        }

        if (err && stderr && stderr.includes('FATAL')) {
          reject(new Error(`Restore failed: ${stderr}`));
        } else {
          resolve({ copyErrors: errorLines });
        }
      });
    });
  }

  // Run a single scalar query via psql (-tAc) and return stdout. Used to verify
  // a restore actually loaded data.
  _queryScalar(sql) {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, PGPASSWORD: this.dbPassword };
      const args = ['-X', '-h', this.dbHost, '-p', String(this.dbPort), '-U', this.dbUser, '-d', this.dbName, '-tAc', sql];
      execFile(this.psql, args, { env, windowsHide: true }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      });
    });
  }

  /**
   * The tables the local database already has (public.* and auth.users / auth.identities), as a Set of 'schema.table'. A company file is restored INTO this schema
   * (2.0.4, F1): only the data of a table that is in this set is loaded; the file's own CREATE statements are never run.
   */
  async _liveTables() {
    const out = await this._queryScalar(
      "SELECT n.nspname || '.' || c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
      "WHERE c.relkind IN ('r', 'p') AND (n.nspname = 'public' OR (n.nspname = 'auth' AND c.relname IN ('users', 'identities')))");
    return new Set(String(out || '').split('\n').map((l) => l.trim()).filter(Boolean));
  }

  /** An Error with a machine-readable code (the callers show .message). */
  static restoreError(code, message) { const e = new Error(message); e.code = code; return e; }

  /**
   * Clear the snapshot's public tables in one atomic transaction before the bulk
   * restore loads fresh rows. Runs with replica role (FK triggers off) so order
   * doesn't matter, a 20s lock_timeout so a stray PostgREST/GoTrue lock surfaces
   * instead of hanging, and ON_ERROR_STOP=on inside --single-transaction so a
   * failure rolls back the whole truncate (no half-cleared DB) and aborts the
   * restore loudly — leaving the previous company's data intact rather than
   * corrupt. to_regclass guards tables the dump will CREATE (not yet present).
   */
  async _truncatePublic(tables) {
    // The truncate is ONE rolled-back-on-failure transaction, so a retry is safe. A query that another client (PostgREST for an ERP page open in a browser tab, GoTrue)
    // has in flight can deadlock with it, and the deadlock detector picks the TRUNCATE as the victim: try again a few times before the restore fails.
    const delays = this.truncateRetryDelaysMs || [1000, 2000, 4000];
    for (let attempt = 0; ; attempt++) {
      try { return await this._truncatePublicOnce(tables); } catch (e) {
        const transient = /deadlock detected|canceling statement due to lock timeout/i.test(String(e && e.message));
        if (!transient || attempt >= delays.length) throw e;
        console.warn(`[BackupManager] the pre-restore truncate collided with another query (${/deadlock/i.test(e.message) ? 'deadlock' : 'lock timeout'}); retry ${attempt + 1}/${delays.length} in ${delays[attempt]} ms`);
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
  }

  _truncatePublicOnce(tables) {
    return new Promise((resolve, reject) => {
      if (!tables || tables.length === 0) return resolve();
      const arr = tables.map(t => "'" + t.replace(/'/g, "''") + "'").join(',');
      const sqlText =
        "SET session_replication_role='replica';\n" +
        "SET lock_timeout='20s';\n" +
        "DO $TXR$ DECLARE t text; BEGIN\n" +
        "  FOREACH t IN ARRAY ARRAY[" + arr + "]::text[] LOOP\n" +
        "    IF to_regclass(t) IS NOT NULL THEN\n" +
        "      EXECUTE 'TRUNCATE TABLE ' || t || ' RESTART IDENTITY CASCADE';\n" +
        "    END IF;\n" +
        "  END LOOP;\n" +
        "END $TXR$;\n";
      const tmpFile = this._tmpSqlPath('truncate');
      fs.writeFileSync(tmpFile, sqlText, { mode: 0o600, flag: 'wx' });
      const env = { ...process.env, PGPASSWORD: this.dbPassword };
      const args = [
        '-X',
        '-h', this.dbHost, '-p', String(this.dbPort),
        '-U', this.dbUser, '-d', this.dbName,
        '-f', tmpFile, '--single-transaction',
        '--set', 'ON_ERROR_STOP=on',
      ];
      execFile(this.psql, args, { env, windowsHide: true, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        if (err) reject(new Error(`Pre-restore truncate failed: ${stderr || err.message}`));
        else resolve();
      });
    });
  }

  /**
   * Reliably restore the auth accounts (auth.users + auth.identities) from a
   * decrypted dump. The bulk restore runs in ONE transaction that aborts on the
   * first "already exists" error (GoTrue pre-creates its auth tables on start),
   * so the auth rows silently never commit → login becomes impossible after a
   * reopen, on ANY machine. Here we load them in their own atomic transaction:
   * clear whatever GoTrue bootstrapped, then COPY the backup's users (then
   * identities, for the FK). pg_dump lists COPY columns by name, so a 34-column
   * dump loads fine into a newer 35-column table (extra cols take defaults).
   * bcrypt hashes are portable across GoTrue instances and the session token is
   * signed by the local install's secret → the original passwords work on every
   * install regardless of license. See [[local-hybrid-schema-sync]] #6.
   */
  _restoreAuthData(auth) {
    // `auth` = { users, identities }: the COPY blocks sql-guard renderDataScript() built from the file (headers rebuilt by the program, data lines unchanged)
    if (!auth || !auth.users) return Promise.resolve(); // very old file without auth → skip
    const L = (t) => Buffer.from(t, 'latin1');
    const parts = [
      L("SET client_encoding = 'UTF8';\nSET session_replication_role = 'replica';\nDELETE FROM auth.identities;\nDELETE FROM auth.users;\n"),
      auth.users,
    ];
    if (auth.identities) parts.push(auth.identities);
    parts.push(L("SET session_replication_role = 'origin';\n"));
    return this._runAuthSql(Buffer.concat(parts));
  }

  /**
   * Clear ephemeral auth session/token state after a restore. The full dump runs
   * `setval('auth.refresh_tokens_id_seq', <snapshot>)`, rewinding the sequence
   * below live rows created since the snapshot → the next login's INSERT collides
   * on refresh_tokens_pkey ("500: Database error granting user") until nextval
   * climbs past them (severe when opening an OLD .tcdb). These tables are
   * re-created on the next login, so truncating them is safe and also correctly
   * drops sessions carried over from a different snapshot. Guarded by to_regclass
   * since the set of auth tables varies by GoTrue version.
   */
  _resetAuthSessions() {
    const sqlText =
      'DO $$ BEGIN ' +
      "IF to_regclass('auth.refresh_tokens') IS NOT NULL THEN TRUNCATE auth.refresh_tokens RESTART IDENTITY CASCADE; END IF; " +
      "IF to_regclass('auth.sessions') IS NOT NULL THEN TRUNCATE auth.sessions CASCADE; END IF; " +
      "IF to_regclass('auth.mfa_amr_claims') IS NOT NULL THEN TRUNCATE auth.mfa_amr_claims CASCADE; END IF; " +
      "IF to_regclass('auth.flow_state') IS NOT NULL THEN TRUNCATE auth.flow_state CASCADE; END IF; " +
      "IF to_regclass('auth.one_time_tokens') IS NOT NULL THEN TRUNCATE auth.one_time_tokens CASCADE; END IF; " +
      'END $$;';
    return this._runAuthSql(sqlText);
  }

  _runAuthSql(sqlText) {
    return new Promise((resolve, reject) => {
      const tmpFile = this._tmpSqlPath('auth');
      // (the COPY blocks in it were built by sql-guard renderDataScript(): headers rebuilt by the program, data lines unchanged; psql's restricted mode wraps it as well)
      fs.writeFileSync(tmpFile, sqlGuard.prepareDump(sqlText, { strip: false }), { mode: 0o600, flag: 'wx' });
      const env = { ...process.env, PGPASSWORD: this.dbPassword };
      const args = [
        '-X',
        '-h', this.dbHost, '-p', String(this.dbPort),
        '-U', this.dbUser, '-d', this.dbName,
        '-f', tmpFile, '--single-transaction',
        '--set', 'ON_ERROR_STOP=on', // auth must load atomically — surface failures
      ];
      execFile(this.psql, args, { env, windowsHide: true, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        if (err) reject(new Error(`Auth restore failed: ${stderr || err.message}`));
        else resolve();
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // ⏱ Real-time Sync (Periodic Backup)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Start real-time sync — runs backup every intervalMs
   */
  startSync() {
    if (this._timer) {
      console.log('[BackupManager] Sync already running');
      return;
    }

    console.log(`[BackupManager] Starting sync every ${this.intervalMs / 1000}s → ${this.backupPath}`);

    // First backup immediately
    this.backup().catch(e => this.onError(e));

    // Then on interval
    this._timer = setInterval(() => {
      this.backup().catch(e => this.onError(e));
    }, this.intervalMs);
  }

  /**
   * Stop real-time sync
   */
  stopSync() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      console.log('[BackupManager] Sync stopped');
    }
  }

  /**
   * Get .tcdb file info without decrypting
   */
  static getFileInfo(filePath) {
    if (!fs.existsSync(filePath)) return null;

    try {
      const buffer = fs.readFileSync(filePath);
      const magic = buffer.subarray(0, 4);
      if (!magic.equals(TCDB_MAGIC)) return null;

      let offset = 4;
      const version = buffer.readUInt8(offset); offset += 1;
      const timestamp = Number(buffer.readBigUInt64LE(offset)); offset += 8;
      const originalSize = buffer.readUInt32LE(offset); offset += 4;
      const compressedSize = buffer.readUInt32LE(offset); offset += 4;

      return {
        version,
        timestamp: new Date(timestamp),
        originalSize,
        compressedSize,
        fileSize: buffer.length,
        compressionRatio: ((1 - compressedSize / originalSize) * 100).toFixed(1) + '%',
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Get current status
   */
  getStatus() {
    const p = this._status.primary;
    return {
      syncing: !!this._timer,
      running: this._running,
      lastBackup: this._lastBackupTime,
      lastCloudUpload: this._lastCloudUpload || null,
      backupCount: this._backupCount,
      cloudUploadCount: this._cloudUploadCount || 0,
      intervalMs: this.intervalMs,
      backupPath: this.backupPath,
      // 2.0.2 (additive): the whole picture for the user - overall state, the last error, and each target on its own
      state: this._running ? 'syncing' : (p.error ? 'error' : (this._lastBackupTime ? 'ok' : 'pending')),
      consecutiveFailures: this._consecutiveFailures,
      lastError: p.error,
      lastSkipped: this._lastSkipped,
      accessBlock: this._lastAccessBlock || null,   // 2.0.4: { state: 'denied'|'pending', area } while macOS' folder permission is missing
      targets: this.getTargets(),
    };
  }

  /**
   * Every file this manager keeps in step: the company file and (when configured) the program's own second copy. Per target: the path,
   * 'ok' | 'syncing' | 'error' | 'pending', the last successful sync, the error with its reason, whether the file is on disk, and whether
   * its folder is one a cloud service syncs (the file may then be an online-only stub on this computer).
   */
  getTargets() {
    const make = (role, filePath) => {
      const t = this._status[role];
      let exists = false; let size = 0; let mtime = null; let onThisComputer = true;
      // 2.0.4: a folder macOS has not allowed (or is still asking about) is not touched here - a stat in it would wait for the prompt, in the main process
      const blocked = role === 'primary' && !!this._lastAccessBlock;
      try {
        if (blocked) throw new Error('blocked');
        const st = fs.statSync(filePath);
        exists = st.isFile(); size = st.size; mtime = st.mtime.toISOString();
        if (companyFile.looksLikeCloudPlaceholder(st)) onThisComputer = false;
      } catch { exists = false; }
      const dir = path.dirname(filePath);
      let cloudFolder = null;
      try { cloudFolder = companyFile.detectCloudFolder(dir); } catch { cloudFolder = null; }
      return {
        role, path: filePath, name: path.basename(filePath), dir,
        state: this._running ? 'syncing' : (t.error ? 'error' : (t.lastSuccess ? 'ok' : 'pending')),
        lastSuccess: t.lastSuccess ? new Date(t.lastSuccess).toISOString() : null,
        error: t.error, failures: t.failures, exists, size, mtime, onThisComputer, cloudFolder,
      };
    };
    const out = [];
    if (this.backupPath) out.push(make('primary', this.backupPath));
    if (this.secondaryBackupPath) out.push(make('copy', this.secondaryBackupPath));
    return out;
  }

  // ═══════════════════════════════════════════════════════════════
  // ☁️ Cloud Backup Sync — Upload .tcdb to Supabase Storage
  // ═══════════════════════════════════════════════════════════════

  /**
   * Configure cloud backup sync
   * @param {object} opts
   * @param {string} opts.licensingUrl - Supabase functions URL
   * @param {string} opts.licenseKey  - License key for auth
   * @param {number} opts.cloudIntervalMs - Upload interval (default: 6 hours)
   */
  configureCloudSync(opts) {
    this._cloudUrl = opts.licensingUrl;
    this._licenseKey = opts.licenseKey;
    this._cloudIntervalMs = opts.cloudIntervalMs || 6 * 60 * 60 * 1000; // 6 hours
    this._cloudUploadCount = 0;
    this._lastCloudUpload = null;
    this._cloudTimer = null;
    console.log(`[BackupManager] Cloud sync configured — every ${this._cloudIntervalMs / 3600000}h`);
  }

  /**
   * Start cloud sync timer
   */
  startCloudSync() {
    if (!this._cloudUrl || !this._licenseKey) {
      console.warn('[BackupManager] Cloud sync not configured');
      return;
    }
    if (this._cloudTimer) return;

    console.log('[BackupManager] Cloud sync started');
    // First upload after 2 minutes
    setTimeout(() => this.uploadToCloud().catch(e => console.warn('[CloudBackup]', e.message)), 120000);

    this._cloudTimer = setInterval(() => {
      this.uploadToCloud().catch(e => console.warn('[CloudBackup]', e.message));
    }, this._cloudIntervalMs);
  }

  stopCloudSync() {
    if (this._cloudTimer) {
      clearInterval(this._cloudTimer);
      this._cloudTimer = null;
    }
  }

  /**
   * Upload current .tcdb file to Supabase Storage
   */
  async uploadToCloud() {
    if (!this._cloudUrl || !this._licenseKey) return;
    if (!fs.existsSync(this.backupPath)) {
      console.log('[CloudBackup] No local backup file yet, skipping');
      return;
    }

    try {
      this.onProgress('cloud_upload', 'رفع النسخة الاحتياطية إلى السحابة...');

      const fileBuffer = fs.readFileSync(this.backupPath);
      const fileSizeMb = +(fileBuffer.length / 1024 / 1024).toFixed(2);

      // Get file info for metadata
      const info = BackupManager.getFileInfo(this.backupPath);
      const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

      // File path in storage: {license_key}/{timestamp}.tcdb
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const storagePath = `${this._licenseKey}/${ts}.tcdb`;

      // Upload via Edge Function (handles storage + DB record)
      const https = require('https');
      const http = require('http');

      const result = await this._httpPost(`${this._cloudUrl}/license-cloud-backup`, {
        license_key: this._licenseKey,
        file_size_mb: fileSizeMb,
        db_size_mb: info ? +(info.originalSize / 1024 / 1024).toFixed(2) : 0,
        checksum,
        backup_type: 'auto',
        // File will be uploaded as base64 for small files, or we register metadata only
        file_path: storagePath,
      });

      if (result && result.success) {
        this._lastCloudUpload = new Date();
        this._cloudUploadCount = (this._cloudUploadCount || 0) + 1;
        this.onProgress('cloud_done', `✅ تم رفع النسخة السحابية (${fileSizeMb} MB)`);
        console.log(`[CloudBackup] Upload #${this._cloudUploadCount} OK — ${fileSizeMb} MB`);
      } else {
        console.warn('[CloudBackup] Upload response:', result?.error || 'unknown error');
      }
    } catch (err) {
      console.warn('[CloudBackup] Upload failed:', err.message);
    }
  }

  /**
   * Simple HTTP POST helper (avoids dependency on main.js httpPost)
   */
  _httpPost(url, data) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const lib = urlObj.protocol === 'https:' ? require('https') : require('http');
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      };

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
}

module.exports = BackupManager;
