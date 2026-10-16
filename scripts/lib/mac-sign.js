'use strict';
// ════════════════════════════════════════════════════════════════
// mac-sign — how the macOS app is signed, in one place (afterPack.cjs and the release checks use it).
//
// WHY (2.0.4): an AD-HOC signature has no certificate, so the app's "designated requirement" is its own code hash (`cdhash H"…"`) - different in every build.
// macOS ties its privacy permissions (Files and Folders: Desktop / Documents / Downloads, ...) and Keychain access to that requirement, so with an ad-hoc app
// every update asks again ("Failed to match existing code requirement" in the system log). A STABLE identity - a certificate - gives a requirement that
// does not change between versions, so the permissions survive updates.
//
// The identity is the owner's decision (an Apple Developer ID, or a self-signed code-signing certificate he creates once in Keychain Access); this repo
// never creates a certificate and never touches a keychain. It is chosen at build time:
//   TEXACORE_MAC_SIGN_IDENTITY="Developer ID Application: Name (TEAMID)"   or   "TexaCore Local Signing"   (CSC_NAME is read as a fallback)
//   TEXACORE_MAC_SIGN_KEYCHAIN=/path/to/build.keychain-db                  optional: look the identity up in this keychain only
//   TEXACORE_MAC_SIGN_HARDENED=1                                           optional: hardened runtime (always on for a "Developer ID Application" identity)
//   unset, empty or "-"                                                    ad-hoc (the 2.0.0-2.0.3 behaviour)
// ════════════════════════════════════════════════════════════════
const path = require('path');

/** { mode: 'adhoc' | 'identity', identity, hardened, keychain } from the environment. */
function resolveSigning(env = process.env) {
  const raw = String(env.TEXACORE_MAC_SIGN_IDENTITY || env.CSC_NAME || '').trim();
  if (!raw || raw === '-') return { mode: 'adhoc', identity: '-', hardened: false, keychain: null };
  const developerId = /^Developer ID Application:/i.test(raw);
  const keychain = String(env.TEXACORE_MAC_SIGN_KEYCHAIN || '').trim() || null;
  return { mode: 'identity', identity: raw, developerId, hardened: developerId || env.TEXACORE_MAC_SIGN_HARDENED === '1', keychain };
}

/** The codesign arguments for a bundle. `entitlements` (a plist path) is passed only with the hardened runtime, which Electron needs it for. */
function codesignArgs(sign, bundle, { entitlements = null } = {}) {
  const a = ['--force', '--deep', '--sign', sign.identity];
  if (sign.keychain) a.push('--keychain', sign.keychain);
  if (sign.mode === 'identity' && sign.hardened) {
    a.push('--options', 'runtime');
    if (sign.developerId) a.push('--timestamp');
    if (entitlements) a.push('--entitlements', entitlements);
  }
  a.push(bundle);
  return a;
}

/** What `codesign -dvv <app>` printed (stderr) → { signed, adhoc, authority, teamId, identifier }. */
function parseSignatureInfo(text) {
  const t = String(text || '');
  if (/code object is not signed at all/i.test(t)) return { signed: false, adhoc: false, authority: null, teamId: null, identifier: null };
  const adhoc = /Signature=adhoc/i.test(t);
  const authority = (/^Authority=(.+)$/m.exec(t) || [])[1] || null;
  const team = (/^TeamIdentifier=(.+)$/m.exec(t) || [])[1] || null;
  const identifier = (/^Identifier=(.+)$/m.exec(t) || [])[1] || null;
  return { signed: true, adhoc, authority, teamId: team && team !== 'not set' ? team : null, identifier };
}

/** Does a designated requirement (the line `codesign -d -r- <app>` prints) survive a rebuild? A bare code hash does not. */
function requirementIsStable(requirement) {
  const r = String(requirement || '');
  if (!/designated\s*=>/.test(r)) return false;
  return !/cdhash\s+H"/.test(r);
}

/** The bundle's identity after signing must be the one that was asked for: an ad-hoc result for an identity request is a failed signature. */
function signatureMatches(sign, info) {
  if (!info.signed) return false;
  if (sign.mode === 'adhoc') return info.adhoc;
  if (info.adhoc) return false;
  const want = sign.identity.replace(/^Developer ID Application:\s*/i, '');
  return !!info.authority && (info.authority.includes(sign.identity) || info.authority.includes(want));
}

module.exports = { resolveSigning, codesignArgs, parseSignatureInfo, requirementIsStable, signatureMatches, defaultEntitlements: () => path.join(__dirname, '..', '..', 'build', 'entitlements.mac.plist') };
