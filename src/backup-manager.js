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

// ─── Encryption Constants ────────────────────────────────────
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
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
    this.encryptionKey = opts.encryptionKey;
    this.intervalMs = opts.intervalMs || 5 * 60 * 1000; // 5 minutes default
    this.onProgress = opts.onProgress || (() => {});
    this.onError = opts.onError || ((e) => console.error('[BackupManager]', e));

    this._timer = null;
    this._running = false;
    this._lastBackupTime = null;
    this._backupCount = 0;
  }

  // ═══════════════════════════════════════════════════════════════
  // 🔑 Key Derivation
  // ═══════════════════════════════════════════════════════════════

  _deriveKey(salt) {
    return crypto.pbkdf2Sync(
      this.encryptionKey,
      salt,
      KEY_DERIVATION_ITERATIONS,
      32, // 256 bits
      'sha512'
    );
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

    this._running = true;
    const startTime = Date.now();

    try {
      this.onProgress('start', 'بدء النسخ الاحتياطي...');

      // Step 1: Run pg_dump to get SQL dump
      this.onProgress('dump', 'تصدير قاعدة البيانات...');
      const dumpData = await this._pgDump();

      // Step 2: Compress with gzip
      this.onProgress('compress', 'ضغط البيانات...');
      const compressed = await this._compress(dumpData);

      // Step 3: Encrypt
      this.onProgress('encrypt', 'تشفير البيانات...');
      const encrypted = this._encrypt(compressed);

      // Step 4: Build .tcdb file with header + encrypted payload
      this.onProgress('write', 'كتابة الملف...');
      const tcdbBuffer = this._buildTcdbFile(encrypted, dumpData.length, compressed.length);

      // Step 5: Atomic write (write to temp then rename)
      const tempPath = this.backupPath + '.tmp';
      fs.writeFileSync(tempPath, tcdbBuffer);
      fs.renameSync(tempPath, this.backupPath);

      const duration = Date.now() - startTime;
      this._lastBackupTime = new Date();
      this._backupCount++;

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

      return stats;
    } catch (error) {
      this.onProgress('error', `❌ فشل النسخ الاحتياطي: ${error.message}`);
      this.onError(error);
      return null;
    } finally {
      this._running = false;
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
        '--clean',
        '--if-exists',
        '--schema=public',
        '--schema=auth',
        // Include data + schema
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
  _encrypt(data) {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = this._deriveKey(salt);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return { salt, iv, authTag, ciphertext: encrypted };
  }

  /**
   * Decrypt data
   */
  _decrypt(salt, iv, authTag, ciphertext) {
    const key = this._deriveKey(salt);
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
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
  async restore(filePath) {
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

      // Step 2: Verify checksum
      this.onProgress('verify', 'التحقق من سلامة البيانات...');
      const actualChecksum = crypto.createHash('sha256').update(parsed.ciphertext).digest();
      if (!actualChecksum.equals(parsed.checksum)) {
        throw new Error('فشل التحقق — الملف تالف أو تم التلاعب به');
      }

      // Step 3: Decrypt
      this.onProgress('decrypt', 'فك تشفير البيانات...');
      const compressed = this._decrypt(parsed.salt, parsed.iv, parsed.authTag, parsed.ciphertext);

      // Step 4: Decompress
      this.onProgress('decompress', 'فك ضغط البيانات...');
      const sql = await this._decompress(compressed);

      // Step 5: Execute SQL via psql
      this.onProgress('restore', 'استعادة قاعدة البيانات...');
      await this._executeSql(sql);

      const duration = Date.now() - startTime;
      this.onProgress('done', `✅ تمت الاستعادة (${(sql.length / 1024 / 1024).toFixed(1)} MB) في ${(duration / 1000).toFixed(1)}s`);

      return { duration, sqlSize: sql.length };
    } catch (error) {
      this.onProgress('error', `❌ فشل الاستعادة: ${error.message}`);
      throw error;
    }
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
   * Execute SQL dump via psql
   */
  _executeSql(sqlBuffer) {
    return new Promise((resolve, reject) => {
      const tmpFile = this.backupPath + '.restore.sql';
      fs.writeFileSync(tmpFile, sqlBuffer);

      const env = {
        ...process.env,
        PGPASSWORD: this.dbPassword,
      };

      const args = [
        '-h', this.dbHost,
        '-p', String(this.dbPort),
        '-U', this.dbUser,
        '-d', this.dbName,
        '-f', tmpFile,
        '--single-transaction',
        '--set', 'ON_ERROR_STOP=off',
      ];

      execFile(this.psql, args, { env, windowsHide: true, maxBuffer: 100 * 1024 * 1024 }, (err, stdout, stderr) => {
        // Clean up temp file
        try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }

        if (err && stderr && stderr.includes('FATAL')) {
          reject(new Error(`Restore failed: ${stderr}`));
        } else {
          resolve();
        }
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
    return {
      syncing: !!this._timer,
      running: this._running,
      lastBackup: this._lastBackupTime,
      backupCount: this._backupCount,
      intervalMs: this.intervalMs,
      backupPath: this.backupPath,
    };
  }
}

module.exports = BackupManager;
