// ════════════════════════════════════════════════════════════════
// 🔐 Per-install secrets — unique JWT secret / keys / DB password for
// each installation, so extracting them from one DMG can't forge tokens
// against another install (the old model shared one static set everywhere).
//
// Safe migration: installs that ALREADY have a pgdata (created with the old
// shared secret) keep the legacy values, so their PG roles + existing
// sessions keep working. Only FRESH installs get unique random secrets.
// ════════════════════════════════════════════════════════════════
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Legacy shared values (pre-per-install). Kept ONLY for backward compat with
// already-provisioned data dirs — never used for fresh installs.
const LEGACY = {
  jwtSecret: 'texacore-jwt-secret-at-least-32-characters-long',
  dbPassword: 'texacore-local-super-secret',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1sb2NhbCIsInJlZiI6InRleGFjb3JlLWxvY2FsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMzQ1MzUsImV4cCI6MjA5MjU5NDUzNX0.aEuY0oBAUi1C9XHpr_xFEtvPDVXYrIdnjJsZUgWJxSk',
  serviceKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1sb2NhbCIsInJlZiI6InRleGFjb3JlLWxvY2FsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzIzNDUzNSwiZXhwIjoyMDkyNTk0NTM1fQ.8iGFw0gctL08j8y64qadPceHOR2I0GSGCPg69UJ81gs',
};

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// HS256 JWT — the format GoTrue/PostgREST expect.
function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = b64url(crypto.createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}

function makeKeys(jwtSecret) {
  // Long-lived service tokens (fixed iat/exp — these are infra keys, not
  // user sessions). iat 2023, exp ~2050.
  const iat = 1700000000, exp = 2540000000;
  return {
    anonKey: signJwt({ iss: 'supabase-local', ref: 'texacore-local', role: 'anon', iat, exp }, jwtSecret),
    serviceKey: signJwt({ iss: 'supabase-local', ref: 'texacore-local', role: 'service_role', iat, exp }, jwtSecret),
  };
}

// Load existing secrets, or create them. Legacy for already-provisioned dirs,
// unique random for fresh installs.
function getOrCreateSecrets(dataDir) {
  const secretsPath = path.join(dataDir, 'secrets.json');
  if (fs.existsSync(secretsPath)) {
    try {
      const s = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
      if (s && s.jwtSecret && s.dbPassword && s.anonKey && s.serviceKey) return s;
    } catch { /* fall through to regenerate */ }
  }

  const provisioned = fs.existsSync(path.join(dataDir, 'pgdata', 'PG_VERSION'));
  let secrets;
  if (provisioned) {
    // Existing install: its PG roles + sessions were made with legacy values.
    secrets = { ...LEGACY, legacy: true };
  } else {
    // Fresh install: unique per-install secrets.
    const jwtSecret = b64url(crypto.randomBytes(48));
    const keys = makeKeys(jwtSecret);
    secrets = {
      jwtSecret,
      dbPassword: b64url(crypto.randomBytes(24)),
      anonKey: keys.anonKey,
      serviceKey: keys.serviceKey,
      legacy: false,
    };
  }

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  } catch { /* best effort; caller still gets in-memory secrets */ }
  return secrets;
}

module.exports = { getOrCreateSecrets, signJwt, makeKeys, LEGACY };
