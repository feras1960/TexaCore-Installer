'use strict';
// ════════════════════════════════════════════════════════════════
// secrets-vault — the per-install secrets file (JWT secret, DB password, service key, admin-API secret) encrypted AT REST with Electron's
// safeStorage (macOS Keychain / Windows DPAPI) where that is available and sensible. The file format and the migration live in secrets.js;
// this module decides WHETHER to write the encrypted form and wraps safeStorage.
//
// Policy (package.json → "texacore": { "secretsAtRest": { "darwin": "auto", "win32": "off" } }; "on" | "off" | "auto"):
//   * "auto" (macOS) = on only when the app has a STABLE code signature (Developer ID / team identifier). An ad-hoc signed build — which is what an unsigned
//     release is — gets a different signature on every build, and the Keychain then asks the user for permission after each new build (a synchronous
//     dialog during start-up); until the release is Developer-ID signed that would be a regression, so it stays off.
//   * Windows is "off" until the Windows build has been run on a real PC (DPAPI itself needs no prompt).
//   * Reading is independent of the policy: an install that already has secrets.enc always opens it when safeStorage can.
//   * Never fail destructive: an encrypted file that cannot be opened is an error, never a reason to generate new secrets.
// Harness overrides (isolated runs only): TEXACORE_SECRETS_AT_REST = mock (Chromium's in-memory mock keychain — nothing touches the real Keychain) | 1 | 0.
// ════════════════════════════════════════════════════════════════
const { spawnSync } = require('child_process');
const path = require('path');

class SecretsUnavailableError extends Error {
  constructor(message) { super(message); this.name = 'SecretsUnavailableError'; this.code = 'SECRETS_UNAVAILABLE'; }
}

/** The .app bundle that contains this executable, or ''. */
function appBundleOf(execPath) {
  const m = /^(.*?\.app)(?:\/|$)/.exec(String(execPath || '').split(path.sep).join('/'));
  return m ? m[1] : '';
}

/** macOS: does the bundle carry a stable signing identity (not ad-hoc, not unsigned)? run is injectable for tests. */
function macSignatureIsStable(execPath, run = (args) => spawnSync('codesign', args, { encoding: 'utf8', timeout: 8000 })) {
  const bundle = appBundleOf(execPath);
  if (!bundle) return false;
  try {
    const r = run(['-dv', '--verbose=2', bundle]);
    const text = `${r.stderr || ''}\n${r.stdout || ''}`;
    if (r.status !== 0 || /Signature=adhoc/i.test(text) || /code object is not signed/i.test(text)) return false;
    return /TeamIdentifier=(?!not set)\S+/.test(text) || /Authority=Developer ID Application/.test(text);
  } catch { return false; }
}

function secretsAtRestPolicy({ platform, env = {}, config = {}, harnessOk = false, execPath = '', macStable = null }) {
  const forced = String(env.TEXACORE_SECRETS_AT_REST || '');
  if (harnessOk && forced === 'mock') return { write: true, mock: true, reason: 'forced: mock keychain (isolated harness run)' };
  if (harnessOk && forced === '1') return { write: true, reason: 'forced on (isolated harness run)' };
  if (harnessOk && forced === '0') return { write: false, reason: 'forced off (isolated harness run)' };
  const setting = String((config && config[platform]) || 'off');
  if (setting === 'on') return { write: true, reason: 'package.json: on' };
  if (setting === 'auto' && platform === 'darwin') {
    const stable = macStable === null ? macSignatureIsStable(execPath) : !!macStable;
    return stable ? { write: true, reason: 'stable code signature' }
      : { write: false, reason: 'ad-hoc / unsigned build — the Keychain would ask permission after every new build; stays on the 0600 file' };
  }
  return { write: false, reason: `package.json: ${setting}` };
}

/** Wrap Electron's safeStorage (or a fake in tests). */
function createVault({ safeStorage, policy }) {
  const available = () => { try { return !!safeStorage && safeStorage.isEncryptionAvailable() === true; } catch { return false; } };
  return {
    policy,
    canRead: available,
    canWrite: () => !!(policy && policy.write) && available(),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (buf) => safeStorage.decryptString(buf),
  };
}

let current = null;
module.exports = {
  SecretsUnavailableError, appBundleOf, macSignatureIsStable, secretsAtRestPolicy, createVault,
  setVault(v) { current = v; },
  getVault() { return current; },
};
