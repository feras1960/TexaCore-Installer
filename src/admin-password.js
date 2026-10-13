'use strict';
// ════════════════════════════════════════════════════════════════
// admin-password — the policy for the admin-portal ("view all companies") password.
//   * at least 8 characters
//   * not "admin" (any case) — the historical default that shipped inside every bundle
//   * not license-key-like — the DEFAULT password is the install's license key, so letting the manager "choose" a value of
//     that shape (or the key itself) would silently keep the default
// ════════════════════════════════════════════════════════════════
const MIN_LENGTH = 8;

// XXXX-XXXX-XXXX / FREE-2026-12345 / TRL-… : 3+ alphanumeric groups joined by dashes
const KEY_SHAPE = /^[A-Za-z0-9]{2,10}(?:-[A-Za-z0-9]{2,12}){2,}$/;
const KEY_PREFIX = /^(?:TRL|TRIAL|FREE|PRO|ENT|ENTERPRISE|BASIC|STARTER|TEXA|TX|LIC|LICENSE)[-_ ]?[A-Za-z0-9-]{4,}$/i;

const MESSAGES_AR = {
  admin: 'كلمة المرور «admin» غير مسموحة',
  short: `كلمة المرور قصيرة جداً (${MIN_LENGTH} أحرف على الأقل)`,
  is_key: 'لا يمكن أن تكون كلمة المرور هي مفتاح الترخيص',
  key_like: 'كلمة المرور تشبه مفتاح ترخيص — اختر كلمة مختلفة',
};

/** @returns {'admin'|'short'|'is_key'|'key_like'|null} the first rule the password breaks (the windows translate the code), or null when acceptable. */
function adminPasswordProblem(plain, { licenseKey = '' } = {}) {
  const p = String(plain ?? '');
  const norm = p.trim().toLowerCase();
  if (norm === 'admin') return 'admin';
  if (p.length < MIN_LENGTH) return 'short';
  if (licenseKey && norm === String(licenseKey).trim().toLowerCase()) return 'is_key';
  if (KEY_SHAPE.test(p.trim()) || KEY_PREFIX.test(p.trim())) return 'key_like';
  return null;
}

/** @returns {string|null} an Arabic error message, or null when the password is acceptable. */
function validateAdminPassword(plain, opts = {}) {
  const code = adminPasswordProblem(plain, opts);
  return code ? MESSAGES_AR[code] : null;
}

/**
 * The password the portal has when the manager never set one: the install's licence key — but ONLY when that key is a secret of this install.
 * A FREE key is not: the offline free licence is the literal "FREE-LOCAL" (the same on every offline install, written in the source) and the cloud-issued
 * FREE-2026-XXXXX numbers are short, sequential and printed in the launcher's «support code» box. A free install therefore has NO default password:
 * the portal stays locked until the manager chooses one (≥ MIN_LENGTH, from the launcher, no old password needed).
 * @returns {string|null}
 */
function defaultAdminPasswordFor(licenseKey) {
  const k = String(licenseKey ?? '').trim();
  if (!k || /^FREE(?![A-Za-z0-9])/i.test(k)) return null;
  return k;
}

module.exports = { validateAdminPassword, adminPasswordProblem, defaultAdminPasswordFor, MIN_LENGTH };
