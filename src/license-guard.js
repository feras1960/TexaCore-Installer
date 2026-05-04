// ════════════════════════════════════════════════════════════════
// 🔐 TexaCore LicenseGuard — Encrypted License Validation
// Prevents tampering, copying, and unauthorized usage
// ════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ─── Obfuscated Constants ────────────────────────────────────
// These are derived at runtime — not stored as plain strings
const _k1 = Buffer.from('VGV4YUNvcmVFUlAtMjAyNi1MaWNlbnNlLUd1YXJk', 'base64').toString();
const _k2 = Buffer.from('c2VjdXJpdHktbGF5ZXItaG1hYy1zaWduYXR1cmU=', 'base64').toString();
const ENCRYPTION_ALGO = 'aes-256-gcm';
const HMAC_ALGO = 'sha256';

class LicenseGuard {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.licensePath = path.join(dataDir, 'license.dat'); // .dat not .json
    this.legacyPath = path.join(dataDir, 'license.json'); // for migration
    this._hwId = null;
    this._cachedLicense = null;
    this._lastCheck = 0;
  }

  // ─── Hardware Fingerprint ──────────────────────────────────
  getHardwareId() {
    if (this._hwId) return this._hwId;

    try {
      if (process.platform === 'darwin') {
        const serial = execSync(
          "system_profiler SPHardwareDataType | grep 'Serial Number' | awk '{print $NF}'",
          { timeout: 5000 }
        ).toString().trim();
        const uuid = execSync(
          "system_profiler SPHardwareDataType | grep 'Hardware UUID' | awk '{print $NF}'",
          { timeout: 5000 }
        ).toString().trim();
        this._hwId = `MAC-${serial}-${uuid}`;
      } else {
        const uuid = execSync(
          'wmic csproduct get uuid',
          { timeout: 5000 }
        ).toString().trim().split('\n').pop().trim();
        this._hwId = `WIN-${uuid}`;
      }
    } catch {
      // Fallback: use hostname + arch
      this._hwId = `FALLBACK-${require('os').hostname()}-${process.arch}`;
    }

    return this._hwId;
  }

  // ─── Derive encryption key from hardware ID ────────────────
  _deriveKey() {
    const hwId = this.getHardwareId();
    return crypto.pbkdf2Sync(hwId + _k1, _k2, 10000, 32, 'sha512');
  }

  // ─── HMAC signature ────────────────────────────────────────
  _sign(data) {
    const key = this._deriveKey();
    return crypto.createHmac(HMAC_ALGO, key).update(data).digest('hex');
  }

  // ─── Encrypt license data ─────────────────────────────────
  _encrypt(plainObj) {
    const key = this._deriveKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);

    const json = JSON.stringify(plainObj);
    let encrypted = cipher.update(json, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    const payload = {
      v: 2, // version
      iv: iv.toString('hex'),
      tag: authTag,
      data: encrypted,
      sig: this._sign(encrypted),
      hw: crypto.createHash('sha256').update(this.getHardwareId()).digest('hex').slice(0, 16),
      ts: Date.now(),
    };

    return JSON.stringify(payload);
  }

  // ─── Decrypt license data ─────────────────────────────────
  _decrypt(cipherText) {
    try {
      const payload = JSON.parse(cipherText);

      // Version check
      if (payload.v !== 2) throw new Error('Invalid license format');

      // Hardware binding check
      const expectedHw = crypto.createHash('sha256').update(this.getHardwareId()).digest('hex').slice(0, 16);
      if (payload.hw !== expectedHw) {
        throw new Error('License not valid for this device');
      }

      // Signature check (integrity)
      const expectedSig = this._sign(payload.data);
      if (payload.sig !== expectedSig) {
        throw new Error('License has been tampered with');
      }

      // Decrypt
      const key = this._deriveKey();
      const iv = Buffer.from(payload.iv, 'hex');
      const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, iv);
      decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));

      let decrypted = decipher.update(payload.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    } catch (err) {
      console.error('[LicenseGuard] Decryption failed:', err.message);
      return null;
    }
  }

  // ─── Save license (encrypted) ─────────────────────────────
  saveLicense(licenseObj) {
    const encrypted = this._encrypt({
      ...licenseObj,
      _savedAt: Date.now(),
      _hwId: this.getHardwareId(),
    });

    fs.writeFileSync(this.licensePath, encrypted, 'utf8');
    this._cachedLicense = licenseObj;
    this._lastCheck = Date.now();

    // Remove legacy plain JSON if exists
    if (fs.existsSync(this.legacyPath)) {
      try { fs.unlinkSync(this.legacyPath); } catch { /* ignore */ }
    }

    console.log('[LicenseGuard] License saved (encrypted + signed)');
    return true;
  }

  // ─── Load license ─────────────────────────────────────────
  loadLicense() {
    // Try encrypted format first
    if (fs.existsSync(this.licensePath)) {
      const raw = fs.readFileSync(this.licensePath, 'utf8');
      const license = this._decrypt(raw);
      if (license) {
        this._cachedLicense = license;
        this._lastCheck = Date.now();
        return license;
      }
      // Decryption failed — file is corrupted or from another device
      console.warn('[LicenseGuard] Encrypted license invalid — requires re-activation');
      return null;
    }

    // Migrate from legacy plain JSON
    if (fs.existsSync(this.legacyPath)) {
      try {
        const legacy = JSON.parse(fs.readFileSync(this.legacyPath, 'utf8'));
        console.log('[LicenseGuard] Migrating legacy license to encrypted format...');
        this.saveLicense(legacy);
        return legacy;
      } catch {
        return null;
      }
    }

    return null;
  }

  // ─── Validate license ─────────────────────────────────────
  validate() {
    const license = this.loadLicense();
    if (!license) {
      return { valid: false, reason: 'no_license' };
    }

    // Check expiration
    if (license.expires_at) {
      const expiresDate = new Date(license.expires_at);
      if (expiresDate < new Date()) {
        return { valid: false, reason: 'expired', license };
      }
    }

    // Check status
    if (license.status === 'revoked' || license.status === 'suspended') {
      return { valid: false, reason: license.status, license };
    }

    return { valid: true, license };
  }

  // ─── Quick check (cached, for frequent calls) ─────────────
  isValid() {
    // Re-validate every 5 minutes from cache, or on first call
    if (this._cachedLicense && (Date.now() - this._lastCheck) < 300000) {
      // Quick expiry check on cache
      if (this._cachedLicense.expires_at) {
        return new Date(this._cachedLicense.expires_at) > new Date();
      }
      return true;
    }

    const result = this.validate();
    return result.valid;
  }

  // ─── Has any license at all ────────────────────────────────
  hasLicense() {
    return fs.existsSync(this.licensePath) || fs.existsSync(this.legacyPath);
  }

  // ─── Get license info (safe for UI) ───────────────────────
  getInfo() {
    const license = this._cachedLicense || this.loadLicense();
    if (!license) return null;

    // Return safe subset (no internal fields)
    return {
      tier: license.tier,
      status: license.status,
      expires_at: license.expires_at,
      license_key: license.license_key,
      max_companies: license.max_companies,
      features: license.features,
    };
  }

  // ─── Remove license ───────────────────────────────────────
  removeLicense() {
    if (fs.existsSync(this.licensePath)) fs.unlinkSync(this.licensePath);
    if (fs.existsSync(this.legacyPath)) fs.unlinkSync(this.legacyPath);
    this._cachedLicense = null;
    this._lastCheck = 0;
  }
}

module.exports = LicenseGuard;
