// ═══════════════════════════════════════════════════════════════════════════
// pgdata-crypto.js — at-rest encryption for the embedded PostgreSQL data dir
// ───────────────────────────────────────────────────────────────────────────
// Holds `pgdata` (and the local .tcdb backups) inside an AES-256 encrypted APFS
// sparse image. The image passphrase is PBKDF2(keychainSecret | hardwareId):
//   • keychainSecret — high-entropy, random, stored in the macOS *login* Keychain
//     (OUTSIDE texacore-data) → copying the data folder to another machine yields
//     ciphertext with no way to derive the key (the secret never leaves here).
//   • hardwareId — binds to this Mac → even a leaked Keychain secret can't unlock
//     a copied image on a different machine.
// When the app is not running the image is detached → on disk it's opaque
// ciphertext, so `psql` against a copied folder (the pg_hba=trust bypass) fails.
//
// macOS-only (uses hdiutil + the `security` CLI). On other platforms the caller
// keeps the legacy plaintext pgdata path (isSupported() === false). See
// [[texacore-distribution-hardening]] item 2 / [[local-hybrid-schema-sync]].
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, execSync } = require('child_process');

const KEYCHAIN_SERVICE = 'com.texacore.pgdata';
const VOLNAME = 'TexaCoreData';
const MOUNTPOINT = '/Volumes/TexaCoreData';
const PBKDF2_SALT = 'texacore-pgdata-atrest-v1';
const IMAGE_MAX_MB = 32768; // sparse cap (32 GB) — only used space is consumed

class PgdataCrypto {
  /**
   * @param {string} dataDir  texacore-data dir (holds the image + legacy pgdata)
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.imagePath = path.join(dataDir, 'pgdata.sparseimage');
    this.mountpoint = MOUNTPOINT;
    // Per-install Keychain account so multiple installs/users don't clash.
    this.account = 'pgdata-' + crypto.createHash('sha256').update(dataDir).digest('hex').slice(0, 16);
  }

  static isSupported() { return process.platform === 'darwin'; }

  // ── Hardware id (mirrors license-guard.getHardwareId) ──────────────────────
  _hardwareId() {
    try {
      const serial = execSync("system_profiler SPHardwareDataType | grep 'Serial Number' | awk '{print $NF}'", { timeout: 5000 }).toString().trim();
      const uuid = execSync("system_profiler SPHardwareDataType | grep 'Hardware UUID' | awk '{print $NF}'", { timeout: 5000 }).toString().trim();
      if (serial || uuid) return `MAC-${serial}-${uuid}`;
    } catch { /* fall through */ }
    return `FALLBACK-${require('os').hostname()}-${process.arch}`;
  }

  // ── Keychain secret (login keychain, random, created once) ─────────────────
  // -A allows the app to read it without a per-launch prompt. Safe for the
  // "folder copied to another machine" threat: the secret lives in the login
  // keychain, never inside texacore-data, so it isn't copied with the folder.
  _getOrCreateKeychainSecret() {
    try {
      const out = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', this.account, '-w'], { encoding: 'utf8', timeout: 5000 });
      const v = out.replace(/\n$/, '');
      if (v) return v;
    } catch { /* not found → create below */ }
    const secret = crypto.randomBytes(32).toString('base64');
    execFileSync('security', ['add-generic-password', '-U', '-A', '-s', KEYCHAIN_SERVICE, '-a', this.account, '-w', secret], { timeout: 5000 });
    return secret;
  }

  // ── Image passphrase = PBKDF2(keychainSecret | hardwareId) ─────────────────
  // Overridable in tests to avoid touching the real Keychain.
  _passphrase() {
    const secret = this._getOrCreateKeychainSecret();
    const hwId = this._hardwareId();
    return crypto.pbkdf2Sync(`${secret}|${hwId}`, PBKDF2_SALT, 100000, 32, 'sha256').toString('base64');
  }

  // ── State ──────────────────────────────────────────────────────────────────
  imageExists() { return fs.existsSync(this.imagePath); }

  isMounted() {
    try { return execSync('/sbin/mount', { timeout: 5000 }).toString().includes(this.mountpoint); }
    catch { return false; }
  }

  get mountedPgData() { return path.join(this.mountpoint, 'pgdata'); }
  get mountedBackups() { return path.join(this.mountpoint, 'backups'); }

  // ── Create the encrypted sparse image (no-op if it already exists) ─────────
  createImage(maxMb = IMAGE_MAX_MB) {
    if (this.imageExists()) return;
    const base = this.imagePath.replace(/\.sparseimage$/, '');
    execFileSync('hdiutil', [
      'create', '-encryption', 'AES-256', '-stdinpass',
      '-type', 'SPARSE', '-fs', 'APFS', '-volname', VOLNAME,
      '-size', `${maxMb}m`, base,
    ], { input: this._passphrase(), timeout: 60000 });
    if (!this.imageExists()) throw new Error('image creation reported success but file is missing');
  }

  // ── Mount (idempotent). Returns the mounted pgdata path. ───────────────────
  mount() {
    if (this.isMounted()) return this.mountedPgData;
    if (!this.imageExists()) throw new Error('encrypted image does not exist — run migrate()/createImage() first');
    execFileSync('hdiutil', ['attach', '-stdinpass', '-mountpoint', this.mountpoint, this.imagePath],
      { input: this._passphrase(), timeout: 30000 });
    if (!this.isMounted()) throw new Error('mount reported success but volume is not present');
    return this.mountedPgData;
  }

  // ── Unmount (idempotent). Caller must stop PG first (else resource busy). ───
  unmount() {
    if (!this.isMounted()) return;
    try { execFileSync('hdiutil', ['detach', this.mountpoint], { timeout: 20000 }); return; }
    catch { /* retry forced */ }
    try { execFileSync('hdiutil', ['detach', this.mountpoint, '-force'], { timeout: 20000 }); }
    catch (e) { throw new Error(`failed to detach encrypted volume: ${e.message}`); }
  }

  _dirSizeMb(dir) {
    try { return Math.ceil(parseInt(execSync(`/usr/bin/du -sk "${dir}"`, { timeout: 30000 }).toString().split('\t')[0], 10) / 1024); }
    catch { return 0; }
  }

  /**
   * One-time migration of an existing UNENCRYPTED pgdata (+ local backups) into
   * the encrypted image. The caller MUST have stopped PostgreSQL first so the
   * copy is consistent. Non-destructive: the original pgdata is renamed to
   * `<pgDataDir>.pre-encryption.bak` and kept until the caller confirms a clean
   * launch from the encrypted copy (then it can be removed).
   *
   * @returns {string} the mounted pgdata path PG should now use.
   */
  migrate({ pgDataDir, backupsDir } = {}) {
    if (!pgDataDir) throw new Error('migrate: pgDataDir required');
    if (this.imageExists()) throw new Error('migrate: image already exists (already migrated?)');
    if (!fs.existsSync(path.join(pgDataDir, 'PG_VERSION'))) throw new Error('migrate: source pgdata missing/invalid (no PG_VERSION)');

    this.createImage();
    this.mount();
    try {
      // ditto preserves permissions, ownership, ACLs, xattrs — required for PG.
      execFileSync('ditto', [pgDataDir, this.mountedPgData], { timeout: 600000 });
      if (!fs.existsSync(path.join(this.mountedPgData, 'PG_VERSION'))) {
        throw new Error('verify failed: PG_VERSION missing in encrypted copy');
      }
      if (backupsDir && fs.existsSync(backupsDir)) {
        execFileSync('ditto', [backupsDir, this.mountedBackups], { timeout: 600000 });
      }
    } catch (e) {
      // Roll back: tear down the half-built image so the legacy path stays intact.
      try { this.unmount(); } catch { /* ignore */ }
      try { fs.rmSync(this.imagePath, { force: true }); } catch { /* ignore */ }
      throw new Error(`migrate copy failed (legacy pgdata untouched): ${e.message}`);
    }

    // Keep the original as a safety copy — caller deletes after a verified launch.
    const bak = pgDataDir + '.pre-encryption.bak';
    try { fs.rmSync(bak, { recursive: true, force: true }); } catch { /* ignore stale */ }
    fs.renameSync(pgDataDir, bak);
    return this.mountedPgData;
  }
}

module.exports = PgdataCrypto;
