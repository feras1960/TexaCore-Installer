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

// ════════════════════════════════════════════════════════════════
// 🔏 Phase H2 — Asymmetric (Ed25519) license SIGNATURE verification
// ────────────────────────────────────────────────────────────────
// The licensing server holds the Ed25519 PRIVATE key (Supabase secret,
// NEVER shipped in this client) and signs the canonical payload of every
// license into `_sig`. The client embeds ONLY the PUBLIC key below and
// verifies that signature. Rule: a license whose signature is absent or
// invalid is capped to the FREE tier (never trial/paid).
//
// SPKI (base64 DER) Ed25519 public key — safe to embed (public half only):
const LICENSE_PUBKEY_B64 = 'MCowBQYDK2VwAyEAqUuyf9XwTQ4Q1x6eu7MwpjfWp15aWcZYp9fGRSg79nM=';

// ⛔ TRANSITION SAFETY FLAG — DO NOT flip to true until the licensing server
// issues `_sig` on ALL licenses AND the heartbeat has had time to backfill
// existing installs. While false, the signature is COMPUTED and exposed via
// getInfo().signed for observability, but the tier is NOT downgraded — so we
// never brick the current fleet of unsigned (legacy v2) licenses. Flip to
// true ONLY after backfill is confirmed via telemetry (getInfo().signed=true).
const ENFORCE_SIGNATURE = false;

// Lazily-built public KeyObject (built once, cached on first verify).
let _licensePubKey = null;
function _getLicensePubKey() {
  if (_licensePubKey) return _licensePubKey;
  _licensePubKey = crypto.createPublicKey({
    key: Buffer.from(LICENSE_PUBKEY_B64, 'base64'),
    format: 'der',
    type: 'spki',
  });
  return _licensePubKey;
}

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
    // علامة مائية زمنية أحادية الاتجاه (high-water mark) لكشف إرجاع ساعة الجهاز.
    // تُخزَّن داخل الحمولة المشفّرة وتنجو من دورات الحفظ/التحميل (المفقودة = 0).
    licenseObj._maxSeenTs = Math.max(licenseObj._maxSeenTs || 0, Date.now());

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

    // ── حارس إرجاع الساعة (clock-rollback guard) ──────────────
    // إن رجعت ساعة الجهاز أكثر من ٢٤ ساعة خلف العلامة المائية الأعلى المُسجّلة،
    // فهذا تلاعب مقصود (محاولة تمديد تجربة/تجاوز انتهاء). المجاني لا حافز لديه
    // للتلاعب (لا ينتهي) فنكتفي بتحذير. ثم نحدّث العلامة ونعيد الحفظ فقط إن تقدّمت
    // أكثر من ٦ ساعات — تفادياً لإعادة كتابة الملف كل فحص مُخبّأ (كل ٥ دقائق).
    const SIX_HOURS = 6 * 3600 * 1000;
    const ROLLBACK_LIMIT = 24 * 3600 * 1000;
    const prevMax = license._maxSeenTs || 0;
    const now = Date.now();
    if (prevMax > 0 && now < (prevMax - ROLLBACK_LIMIT)) {
      if (license.tier === 'free') {
        console.warn('[LicenseGuard] ⚠️ Clock rollback detected on FREE tier — ignoring (never expires).');
      } else {
        console.warn('[LicenseGuard] 🚨 Clock tampering detected — device clock is >24h behind high-water mark.');
        return { valid: false, reason: 'clock_tamper', license };
      }
    }
    // تقدّم العلامة المائية (لا تتراجع أبداً)؛ أعِد الحفظ فقط عند تقدّم > ٦ ساعات.
    const newMax = Math.max(prevMax, now);
    license._maxSeenTs = newMax;
    if (newMax - prevMax > SIX_HOURS) {
      try { this.saveLicense(license); } catch (e) { console.warn('[LicenseGuard] high-water save:', e.message); }
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

  // ─── Canonical signed payload (client ⇄ server MUST agree byte-for-byte) ──
  // Deterministic JSON over ONLY the authoritative fields, in a FIXED key
  // order. The server builds the IDENTICAL string and signs it with the
  // Ed25519 private key; we rebuild it here and verify against `_sig`.
  //
  // Field order is FIXED (do not reorder — it changes the bytes → breaks sig):
  //   license_key, tier, status, expires_at, activated_at, hardware_id,
  //   max_users, max_companies, enabled_modules
  //
  // • Missing/undefined field → null (via `?? null`) so shape is stable.
  // • enabled_modules is SORTED (copy) before stringifying, so a differing
  //   array order (cloud sync, module reshuffle) never invalidates the sig.
  // • hardware_id: use the license's BOUND value (lic.hardware_id) when
  //   present — that is exactly what the server had when it signed. Only fall
  //   back to the live getHardwareId() for a license that predates hw binding.
  //   The server MUST sign the same bound hardware_id it stored on the row.
  _canonicalSignedString(lic) {
    const mods = Array.isArray(lic.enabled_modules)
      ? [...lic.enabled_modules].sort()
      : (lic.enabled_modules ?? null);
    const hw = (lic.hardware_id != null) ? lic.hardware_id : this.getHardwareId();
    const ordered = [
      ['license_key', lic.license_key ?? null],
      ['tier', lic.tier ?? null],
      ['status', lic.status ?? null],
      ['expires_at', lic.expires_at ?? null],
      ['activated_at', lic.activated_at ?? null],
      ['hardware_id', hw ?? null],
      ['max_users', lic.max_users ?? null],
      ['max_companies', lic.max_companies ?? null],
      ['enabled_modules', mods],
    ];
    return JSON.stringify(ordered);
  }

  // ─── Verify Ed25519 signature on the license ───────────────
  // Returns false when there is no license or no `_sig`. Otherwise verifies
  // the base64 signature over the canonical string with the embedded public
  // key. Any throw (malformed sig/key) → false (fail-closed).
  verifySignature(lic) {
    if (!lic || !lic._sig) return false;
    try {
      return crypto.verify(
        null,
        Buffer.from(this._canonicalSignedString(lic), 'utf8'),
        _getLicensePubKey(),
        Buffer.from(lic._sig, 'base64')
      );
    } catch {
      return false;
    }
  }

  // ─── Effective tier — the SINGLE downgrade point ───────────
  // When ENFORCE_SIGNATURE is true: a valid signature keeps lic.tier; an
  // absent/invalid signature is capped to 'free'. When false (transition
  // window): tier is returned unchanged (signature computed for observability
  // only, never enforced) so legacy unsigned licenses are not bricked.
  effectiveTier(lic) {
    if (!lic || !lic.tier) return 'free';
    if (!ENFORCE_SIGNATURE) return lic.tier;
    return this.verifySignature(lic) ? lic.tier : 'free';
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
      // Per-license admin module grant (from /saas/licensing). When
      // modules_admin_set is true the device applies enabled_modules instead of
      // the tier-default plan modules (see syncActivePlan). Stale/unset ⇒ ignored.
      enabled_modules: license.enabled_modules,
      modules_admin_set: license.modules_admin_set === true,
      // H2 observability: signature validity + enforced-or-not effective tier.
      signed: this.verifySignature(license),
      effective_tier: this.effectiveTier(license),
    };
  }

  // ─── Update cached status (cloud → local sync) ────────────
  // Called when a heartbeat reports the cloud revoked/suspended/reactivated
  // this license, so validate() (which gates service startup) reflects it.
  setLocalStatus(status) {
    const license = this.loadLicense();
    if (!license) return false;
    if (license.status === status) return true; // no change
    license.status = status;
    this.saveLicense(license);
    console.log(`[LicenseGuard] Local status updated → ${status}`);
    return true;
  }

  // ─── Apply authoritative cloud state (tier/expiry/limits/modules) ──
  // Called each heartbeat so an admin's tier change / extension propagates to
  // this device. Does NOT touch `status` — the lock/recovery logic owns that.
  // Returns true if anything changed.
  applyCloudState(state) {
    if (!state || typeof state !== 'object') return false;
    const license = this.loadLicense();
    if (!license) return false;
    const fields = ['tier', 'expires_at', 'activated_at', 'max_users', 'max_companies',
      'max_warehouses', 'max_storage_gb', 'enabled_modules', 'modules_admin_set', 'custom_branding',
      'cloud_backup', 'api_access'];
    let changed = false;
    for (const f of fields) {
      if (state[f] === undefined || state[f] === null) continue;
      if (JSON.stringify(license[f]) !== JSON.stringify(state[f])) {
        license[f] = state[f];
        changed = true;
      }
    }
    if (changed) {
      this.saveLicense(license);
      console.log(`[LicenseGuard] Cloud state synced → tier=${license.tier}, expires=${license.expires_at}`);
    }
    return changed;
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
