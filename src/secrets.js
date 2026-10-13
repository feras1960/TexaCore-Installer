// ════════════════════════════════════════════════════════════════
// 🔐 Per-install secrets — a unique JWT secret, anon/service keys and DB password for each installation, so extracting
// them from one DMG can't forge tokens against another install.
//
// 2.0.0: there is NO legacy path any more. 1.x gave an already-provisioned data dir the shared, public values below so its
// roles kept working; a 1.x data dir is now moved aside at startup (bootstrap.prepareDataDir) and never reused, so a
// secrets file is either found (this install's own) or generated fresh. The LEGACY values stay exported ONLY so the
// release checks can prove no install ever runs with them.
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

// Load this install's secrets, or generate them. `created` tells the caller the DB roles must be (re)keyed.
function getOrCreateSecrets(dataDir) {
  const secretsPath = path.join(dataDir, 'secrets.json');
  if (fs.existsSync(secretsPath)) {
    try {
      const s = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
      if (s && s.jwtSecret && s.dbPassword && s.anonKey && s.serviceKey && !isLegacySecrets(s)) {
        // secrets.json written by an earlier 2.0 build has no admin-API secret yet: add one (everything else is untouched)
        if (!s.localApiSecret) {
          s.localApiSecret = crypto.randomBytes(32).toString('hex');
          try { fs.writeFileSync(secretsPath, JSON.stringify(s, null, 2), { mode: 0o600 }); } catch { /* in-memory only */ }
        }
        return { ...s, created: false };
      }
    } catch { /* fall through to regenerate */ }
  }

  const jwtSecret = b64url(crypto.randomBytes(48));
  const keys = makeKeys(jwtSecret);
  const secrets = {
    jwtSecret,
    dbPassword: b64url(crypto.randomBytes(24)),
    anonKey: keys.anonKey,
    serviceKey: keys.serviceKey,
    // the secret the installer's local admin API (create/delete company, backups, …) requires in x-texacore-local-secret
    localApiSecret: crypto.randomBytes(32).toString('hex'),
    legacy: false,
  };
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2), { mode: 0o600 });
  } catch { /* best effort; caller still gets in-memory secrets */ }
  return { ...secrets, created: true };
}

/** True when a secrets object is (or contains) one of the shared 1.x values. */
function isLegacySecrets(s) {
  return !!s && (s.legacy === true || s.jwtSecret === LEGACY.jwtSecret || s.dbPassword === LEGACY.dbPassword
    || s.anonKey === LEGACY.anonKey || s.serviceKey === LEGACY.serviceKey);
}

module.exports = { getOrCreateSecrets, signJwt, makeKeys, isLegacySecrets, LEGACY };
