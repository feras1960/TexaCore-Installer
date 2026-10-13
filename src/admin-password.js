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

/** @returns {string|null} an Arabic error message, or null when the password is acceptable. */
function validateAdminPassword(plain, { licenseKey = '' } = {}) {
  const p = String(plain ?? '');
  const norm = p.trim().toLowerCase();
  if (norm === 'admin') return 'كلمة المرور «admin» غير مسموحة';
  if (p.length < MIN_LENGTH) return `كلمة المرور قصيرة جداً (${MIN_LENGTH} أحرف على الأقل)`;
  if (licenseKey && norm === String(licenseKey).trim().toLowerCase()) return 'لا يمكن أن تكون كلمة المرور هي مفتاح الترخيص';
  if (KEY_SHAPE.test(p.trim()) || KEY_PREFIX.test(p.trim())) return 'كلمة المرور تشبه مفتاح ترخيص — اختر كلمة مختلفة';
  return null;
}

module.exports = { validateAdminPassword, MIN_LENGTH };
