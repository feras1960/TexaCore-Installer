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

const { SecretsUnavailableError } = require('./secrets-vault');

const shapeOk = (s) => !!(s && s.jwtSecret && s.dbPassword && s.anonKey && s.serviceKey && !isLegacySecrets(s));

/** Overwrite with zeros, then unlink (best effort on a journaling file system — it removes the casual copy, not a forensic one). */
function shred(file) {
  try { const n = fs.statSync(file).size; fs.writeFileSync(file, Buffer.alloc(n)); } catch { /* gone or read-only */ }
  try { fs.unlinkSync(file); } catch { /* gone */ }
}

function writeEncrypted(encPath, secrets, vault) {
  const blob = vault.encrypt(JSON.stringify(secrets));
  const tmp = `${encPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ v: 1, provider: 'safeStorage', data: Buffer.from(blob).toString('base64') }), { mode: 0o600 });
  fs.renameSync(tmp, encPath);
}

function readEncrypted(encPath, vault) {
  try {
    const f = JSON.parse(fs.readFileSync(encPath, 'utf8'));
    return JSON.parse(vault.decrypt(Buffer.from(f.data, 'base64')));
  } catch (e) {
    throw new SecretsUnavailableError(`The stored secrets of this install could not be unlocked (${e.message}). The OS keychain refused or the file is damaged — nothing was regenerated or deleted.`);
  }
}

// Load this install's secrets, or generate them. `created` tells the caller the DB roles must be (re)keyed.
//   vault (optional, secrets-vault.js): when it can write, secrets live in secrets.enc (OS keychain / DPAPI) and a plain secrets.json is migrated into it;
//   otherwise the 0600 secrets.json of 2.0 stays as it was. An existing secrets.enc is always opened (policy only governs writing).
function getOrCreateSecrets(dataDir, vault = null) {
  const secretsPath = path.join(dataDir, 'secrets.json');
  const encPath = path.join(dataDir, 'secrets.enc');
  const addAdminSecret = (s, persist) => {
    // secrets written by an earlier 2.0 build lack the admin-API secret and the separate database-role passwords: add them (everything else is untouched).
    // dbPassword is the password of the PostgreSQL superuser `postgres`; the two login roles the services use get their OWN passwords.
    let changed = false;
    if (!s.localApiSecret) { s.localApiSecret = crypto.randomBytes(32).toString('hex'); changed = true; }
    if (!s.authenticatorPassword) { s.authenticatorPassword = b64url(crypto.randomBytes(24)); changed = true; }
    if (!s.authAdminPassword) { s.authAdminPassword = b64url(crypto.randomBytes(24)); changed = true; }
    if (changed) { try { persist(s); } catch { /* in-memory only */ } }
    return s;
  };

  if (fs.existsSync(encPath)) {
    if (!vault || !vault.canRead()) throw new SecretsUnavailableError('This install keeps its secrets in the OS keychain (secrets.enc) but the keychain is not available now.');
    const s = readEncrypted(encPath, vault);
    if (!shapeOk(s)) throw new SecretsUnavailableError('secrets.enc opened but does not hold a valid set of secrets — nothing was regenerated.');
    addAdminSecret(s, (x) => writeEncrypted(encPath, x, vault));
    if (fs.existsSync(secretsPath)) shred(secretsPath);           // a leftover plain copy next to the encrypted one
    return { ...s, created: false, atRest: 'safeStorage' };
  }

  if (fs.existsSync(secretsPath)) {
    try {
      const s = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
      if (shapeOk(s)) {
        addAdminSecret(s, (x) => fs.writeFileSync(secretsPath, JSON.stringify(x, null, 2), { mode: 0o600 }));
        if (vault && vault.canWrite()) {
          // migration: encrypt, prove it opens to the same secrets, only then remove the plain file
          try {
            writeEncrypted(encPath, s, vault);
            const back = readEncrypted(encPath, vault);
            if (JSON.stringify(back) !== JSON.stringify(s)) throw new Error('round trip differs');
            shred(secretsPath);
            return { ...s, created: false, atRest: 'safeStorage', migrated: true };
          } catch { try { fs.unlinkSync(encPath); } catch { /* none */ } /* keep the plain file */ }
        }
        return { ...s, created: false, atRest: 'file' };
      }
    } catch { /* fall through to regenerate */ }
  }

  const jwtSecret = b64url(crypto.randomBytes(48));
  const keys = makeKeys(jwtSecret);
  const secrets = {
    jwtSecret,
    dbPassword: b64url(crypto.randomBytes(24)),            // the PostgreSQL superuser `postgres` (every connection authenticates with scram-sha-256)
    authenticatorPassword: b64url(crypto.randomBytes(24)), // PostgREST's login role
    authAdminPassword: b64url(crypto.randomBytes(24)),     // GoTrue's login role (supabase_auth_admin)
    anonKey: keys.anonKey,
    serviceKey: keys.serviceKey,
    // the secret the installer's local admin API (create/delete company, backups, …) requires in x-texacore-local-secret
    localApiSecret: crypto.randomBytes(32).toString('hex'),
    legacy: false,
  };
  let atRest = 'memory';
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (vault && vault.canWrite()) { writeEncrypted(encPath, secrets, vault); atRest = 'safeStorage'; }
    else { fs.writeFileSync(secretsPath, JSON.stringify(secrets, null, 2), { mode: 0o600 }); atRest = 'file'; }
  } catch { /* best effort; caller still gets in-memory secrets */ }
  return { ...secrets, created: true, atRest };
}

/** True when a secrets object is (or contains) one of the shared 1.x values. */
function isLegacySecrets(s) {
  return !!s && (s.legacy === true || s.jwtSecret === LEGACY.jwtSecret || s.dbPassword === LEGACY.dbPassword
    || s.anonKey === LEGACY.anonKey || s.serviceKey === LEGACY.serviceKey);
}

module.exports = { getOrCreateSecrets, signJwt, makeKeys, isLegacySecrets, LEGACY };
