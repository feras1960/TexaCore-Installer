'use strict';
// The Ed25519 licence-signature mechanism (license-guard.js). Production keeps ENFORCE_SIGNATURE = false (no cloud path signs yet — see the
// comment in license-guard.js); these tests use the constructor options with a generated key pair to prove what flipping it will do,
// and that the owner's enterprise licence keeps working today.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const LicenseGuard = require('../src/license-guard');

const KEY = 'TRL-2026-CGWGJ-W2FSX';
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB_B64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

function guard(opts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-'));
  const lg = new LicenseGuard(dir, opts);
  lg._hwId = 'TEST-HW-ID';          // no system_profiler / wmic in tests
  return { lg, dir };
}
const enterprise = () => ({
  license_key: KEY, tier: 'enterprise', status: 'active', expires_at: new Date(Date.now() + 86400e3 * 300).toISOString(),
  activated_at: '2026-10-01T00:00:00.000Z', hardware_id: 'TEST-HW-ID', max_users: 50, max_companies: 20, enabled_modules: ['sales', 'accounting', 'inventory'],
});
function signed(lg, lic) {
  return { ...lic, _sig: crypto.sign(null, Buffer.from(lg._canonicalSignedString(lic), 'utf8'), privateKey).toString('base64') };
}

test('today (enforcement off, the shipped default): the owner enterprise licence is valid and keeps its tier, signed or not', () => {
  const { lg, dir } = guard();
  lg.saveLicense(enterprise());
  assert.equal(lg.validate().valid, true);
  assert.equal(lg.effectiveTier(lg.loadLicense()), 'enterprise');
  assert.equal(lg.getInfo().signed, false);
  assert.equal(lg.getInfo().effective_tier, 'enterprise');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('enforcement on: a validly signed licence keeps its tier; unsigned and tampered ones are capped to free', () => {
  const { lg, dir } = guard({ enforceSignature: true, publicKeyB64: PUB_B64 });
  const good = signed(lg, enterprise());
  assert.equal(lg.verifySignature(good), true);
  assert.equal(lg.effectiveTier(good), 'enterprise');

  const unsigned = enterprise();
  assert.equal(lg.verifySignature(unsigned), false);
  assert.equal(lg.effectiveTier(unsigned), 'free');

  for (const [field, value] of [['tier', 'enterprise2'], ['expires_at', '2099-01-01T00:00:00.000Z'], ['max_users', 5000], ['max_companies', 999],
    ['license_key', 'TRL-2026-OTHER-XXXXX'], ['status', 'trial'], ['enabled_modules', ['sales', 'accounting', 'inventory', 'hr']], ['hardware_id', 'OTHER-HW']]) {
    const t = { ...good, [field]: value };
    assert.equal(lg.verifySignature(t), false, field);
    assert.equal(lg.effectiveTier(t), 'free', field);
  }
  // module order does not matter (the canonical string sorts them)
  assert.equal(lg.effectiveTier({ ...good, enabled_modules: ['inventory', 'sales', 'accounting'] }), 'enterprise');
  // a signature made by another key, and garbage
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  const forged = { ...enterprise(), _sig: crypto.sign(null, Buffer.from(lg._canonicalSignedString(enterprise()), 'utf8'), other).toString('base64') };
  assert.equal(lg.effectiveTier(forged), 'free');
  assert.equal(lg.effectiveTier({ ...enterprise(), _sig: '!!!not base64!!!' }), 'free');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the shipped public key is a valid Ed25519 SPKI key and the default is NOT enforcing', () => {
  const { lg, dir } = guard();
  assert.equal(lg._enforceSignature, false);
  assert.equal(lg.verifySignature({ ...enterprise(), _sig: Buffer.alloc(64).toString('base64') }), false);   // loads the embedded key without throwing
  fs.rmSync(dir, { recursive: true, force: true });
});
