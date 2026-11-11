// ════════════════════════════════════════════════════════════════
// 🔐 TexaCore LicenseGuard — Encrypted License Validation
// Prevents tampering, copying, and unauthorized usage
// ════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

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
//
// 2.0.0 AUDIT (release engineering, 2026-10-13) — LEFT OFF, because no cloud path issues an Ed25519 `_sig`:
//   • license-activate (paid / key activation) signs an HMAC `signature` with LICENSE_SIGNING_SECRET — a different
//     algorithm, key and field; it never produces `_sig`.
//   • license-trial → RPC create_trial, and licensing_register_free / licensing_get_license_state (SQL) return no signature
//     at all; license-heartbeat / license-validate neither sign nor return `_sig`.
//   • the free licence is minted locally by the installer (start-free) and is unsigned by construction.
//   • applyCloudState() rewrites tier / expires_at / limits / modules on every heartbeat — fields the signature covers — so even a
//     signed licence would stop verifying after its first heartbeat unless the server re-delivers a fresh `_sig` each time.
// Turning enforcement on now would cap EVERY paid and trial licence (including TRL-2026-CGWGJ-W2FSX) to the free tier.
// The mechanism itself is tested with a generated key pair (test/license-signature.test.js, via the constructor options).
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
  // opts (tests only): { enforceSignature: boolean, publicKeyB64: SPKI-DER base64 } — production passes none.
  constructor(dataDir, opts = {}) {
    this.dataDir = dataDir;
    this._enforceSignature = (opts && typeof opts.enforceSignature === 'boolean') ? opts.enforceSignature : ENFORCE_SIGNATURE;
    this._pubKeyOverride = (opts && opts.publicKeyB64)
      ? crypto.createPublicKey({ key: Buffer.from(opts.publicKeyB64, 'base64'), format: 'der', type: 'spki' })
      : null;
    this.licensePath = path.join(dataDir, 'license.dat'); // .dat not .json
    this.legacyPath = path.join(dataDir, 'license.json'); // for migration
    this._hwId = null;
    // opts (tests only): platform / execSync / execFileSync / hostname / arch — the hardware-id probes are shell-outs; production passes none.
    this._platform = (opts && opts.platform) || process.platform;
    this._execSync = (opts && opts.execSync) || execSync;
    this._execFileSync = (opts && opts.execFileSync) || execFileSync;
    this._hostname = (opts && typeof opts.hostname === 'function') ? opts.hostname : () => require('os').hostname();
    this._arch = (opts && opts.arch) || process.arch;
    this._cachedLicense = null;
    this._lastCheck = 0;
  }

  // ─── Hardware Fingerprint ──────────────────────────────────
  // macOS: MAC-<serial>-<hardware uuid> (system_profiler). Linux: wmic (absent) → FALLBACK. Both unchanged.
  // Windows (2.0.8): see _windowsHardwareId — the SAME `WIN-<SMBIOS uuid>` with or without wmic, and an existing licence.dat keeps the id it is bound to.
  getHardwareId() {
    if (this._hwId) return this._hwId;

    if (this._platform === 'win32') {
      this._hwId = this._windowsHardwareId();
      return this._hwId;
    }

    try {
      if (this._platform === 'darwin') {
        const serial = this._execSync(
          "system_profiler SPHardwareDataType | grep 'Serial Number' | awk '{print $NF}'",
          { timeout: 5000 }
        ).toString().trim();
        const uuid = this._execSync(
          "system_profiler SPHardwareDataType | grep 'Hardware UUID' | awk '{print $NF}'",
          { timeout: 5000 }
        ).toString().trim();
        this._hwId = `MAC-${serial}-${uuid}`;
      } else {
        const uuid = this._execSync(
          'wmic csproduct get uuid',
          { timeout: 5000, windowsHide: true }
        ).toString().trim().split('\n').pop().trim();
        this._hwId = `WIN-${uuid}`;
      }
    } catch {
      // Fallback: use hostname + arch
      this._hwId = this._legacyFallbackId();
    }

    return this._hwId;
  }

  // The id every platform used when its probe failed — and what a Windows PC without wmic (11 24H2 / Server 2025) was bound to up to 2.0.7.
  _legacyFallbackId() { return `FALLBACK-${this._hostname()}-${this._arch}`; }

  // ─── Windows: the SMBIOS system UUID, with or without wmic ────
  // Up to 2.0.7 the id was `WIN-` + `wmic csproduct get uuid`, else FALLBACK-<hostname>-<arch>. wmic is gone from Windows 11 24H2 / Server 2025, so those
  // PCs got the host-name id and renaming the PC invalidated license.dat. Now:
  //   1. wmic csproduct get uuid                                       (unchanged: same command, same parsing → same id where wmic exists)
  //   2. PowerShell (Get-CimInstance Win32_ComputerSystemProduct).UUID  (the SAME WMI property wmic reads → the same WIN-<uuid> where wmic is missing)
  //   3. WINMG-<HKLM\SOFTWARE\Microsoft\Cryptography MachineGuid>       (stable per Windows install; only when neither query answers)
  //   4. FALLBACK-<hostname>-<arch>                                     (as before)
  // A licence.dat that ALREADY exists is bound (its `hw` field = sha256(id)[:16], and its AES key / HMAC derive from the id) to whatever id this PC had
  // when it was written — for a PC without wmic that is the FALLBACK id, which the server also holds as the licence's hardware_id. So when license.dat
  // exists and the first id of the chain is not the one it is bound to, the other ids this PC can produce are tried, and the one license.dat is bound
  // to is used — for decryption AND for what is sent to the server, so the binding on both sides stays exactly what it was (no rebind: a local rebind
  // alone would make the heartbeat send an id the server does not hold → HARDWARE_MISMATCH). A licence written from now on binds to WIN-<uuid>.
  // Only ids THIS PC computes are candidates (nothing is read from the file but the 16-hex hash), so a license.dat copied from another PC still fails.
  _windowsHardwareId() {
    const memo = {};
    const once = (k, fn) => { if (!(k in memo)) { try { memo[k] = fn(); } catch { memo[k] = null; } } return memo[k]; };
    const wmic = () => once('wmic', () => this._wmicUuid());          // string ('' possible, as before) or null when wmic is missing / failed
    const cim = () => once('cim', () => this._cimUuid());              // non-empty string, or null (PowerShell failed / the property is empty)
    const guid = () => once('guid', () => this._machineGuid());        // non-empty string or null
    const candidates = [
      () => (wmic() !== null ? `WIN-${wmic()}` : null),                 // exactly the 2.0.7 id when wmic answers
      () => (cim() ? `WIN-${cim()}` : null),                             // the same WMI property → the same id wmic gives
      () => (guid() ? `WINMG-${guid()}` : null),
      () => this._legacyFallbackId(),
    ];
    // the first id the chain produces (what a NEW licence binds to)
    let primary = null;
    for (const c of candidates) { primary = c(); if (primary) break; }
    const bound = this._boundHwHash();
    if (!bound || this._hwHash(primary) === bound) return primary;
    // license.dat is bound to another id: is it one this PC can still produce?
    for (const c of candidates) {
      const id = c();
      if (id && id !== primary && this._hwHash(id) === bound) {
        console.warn(`[LicenseGuard] license.dat is bound to this PC's ${id.startsWith('FALLBACK-') ? 'host-name' : id.startsWith('WINMG-') ? 'MachineGuid' : 'SMBIOS'} id — kept`);
        return id;
      }
    }
    return primary;   // bound to an id this PC cannot produce (another PC, or a renamed PC with a host-name licence): as before, it does not open
  }

  _wmicUuid() {
    return this._execSync('wmic csproduct get uuid', { timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().split('\n').pop().trim();
  }

  _cimUuid() {
    const root = (process.env.SystemRoot || process.env.windir || 'C:\\Windows');
    const ps = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const out = this._execFileSync(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      '(Get-CimInstance -ClassName Win32_ComputerSystemProduct).UUID'],
      { timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const v = lines.length ? lines[lines.length - 1] : '';
    return /^\S{1,200}$/.test(v) ? v : null;   // the property value as WMI holds it; empty → null (errors go to stderr, which is not read)
  }

  _machineGuid() {
    const out = this._execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const m = /MachineGuid\s+REG_SZ\s+([0-9A-Fa-f-]{32,40})/i.exec(out);
    return m ? m[1].toLowerCase() : null;
  }

  _hwHash(id) { return crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 16); }

  // The `hw` field of an existing license.dat (the 16-hex hash of the id it is bound to), or null (no file / unreadable / not v2).
  _boundHwHash() {
    try {
      if (!fs.existsSync(this.licensePath)) return null;
      const p = JSON.parse(fs.readFileSync(this.licensePath, 'utf8'));
      return p && p.v === 2 && typeof p.hw === 'string' && /^[0-9a-f]{16}$/.test(p.hw) ? p.hw : null;
    } catch { return null; }
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
        this._pubKeyOverride || _getLicensePubKey(),
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
    if (!this._enforceSignature) return lic.tier;
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
      // آخر حالة مطبّقة فعلياً على القاعدة المحلية (للعرض/التشخيص فقط — يكتبها
      // النبض في حقل منفصل كي لا تلوّث enabled_modules/منحة الأدمن).
      applied_modules: license.applied_modules,
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
      'cloud_backup', 'api_access', 'plan_code', 'custom_limits'];
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
