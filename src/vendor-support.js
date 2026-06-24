// ════════════════════════════════════════════════════════════════
// 🛟 Vendor support account — present ONLY on the vendor's own machine
// (a file in the data dir, never shipped in the DMG). Lets the vendor open a
// customer's backup locally WITHOUT baking a static super-admin password into
// every customer install (the old backdoor). Protected by TOTP (Google
// Authenticator) at injection time.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = 'vendor-support.json';

// Returns { email, password, name?, totpSecret? } if this machine is a vendor
// support machine, else null (a normal customer install → no vendor account).
function getVendorAccount(dataDir) {
  try {
    const p = path.join(dataDir, FILE);
    if (!fs.existsSync(p)) return null;
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (v && v.email && v.password) return v;
  } catch { /* ignore */ }
  return null;
}

function saveVendorAccount(dataDir, account) {
  const p = path.join(dataDir, FILE);
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(account, null, 2), { mode: 0o600 });
  return p;
}

// ─── TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30s) — Google Authenticator compatible ───
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, val = 0; const out = [];
  for (const c of clean) {
    val = (val << 5) | B32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpAt(secretB32, counter) {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const bin = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3];
  return String(bin % 1000000).padStart(6, '0');
}
function verifyTotp(secretB32, code, window = 1) {
  const want = String(code || '').trim();
  if (!secretB32 || !/^\d{6}$/.test(want)) return false;
  const c = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    if (totpAt(secretB32, c + i) === want) return true;
  }
  return false;
}
function generateTotpSecret() { return base32Encode(crypto.randomBytes(20)); }
function otpauthUrl(email, secretB32, issuer = 'TexaCore') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}` +
         `?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = {
  getVendorAccount, saveVendorAccount,
  verifyTotp, generateTotpSecret, otpauthUrl, base32Encode, totpAt,
};
