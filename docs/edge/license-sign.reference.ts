// ════════════════════════════════════════════════════════════════
// 🔏 Phase H2 — Licensing server: Ed25519 license SIGNER (REFERENCE)
// ────────────────────────────────────────────────────────────────
// This is a DOCUMENTED REFERENCE snippet for the licensing edge function.
// It is NOT deployed from the installer repo, and it carries NO key material.
//
// WHAT IT DOES
//   Given a license row, it builds the EXACT SAME canonical string the client
//   verifies (see installer/src/license-guard.js → _canonicalSignedString),
//   signs it with the Ed25519 PRIVATE key, and returns the base64 signature to
//   store in the license row's `_sig` column. The client embeds only the
//   PUBLIC half and rejects (caps to FREE) any license whose `_sig` is absent
//   or does not verify.
//
// KEY MANAGEMENT (critical)
//   • The Ed25519 keypair was generated LOCALLY by the operator, e.g.:
//         openssl genpkey -algorithm ed25519 -out ed25519_private.pem
//         openssl pkey -in ed25519_private.pem -pubout -out ed25519_public.pem
//   • The PRIVATE PEM lives ONLY as a Supabase secret:
//         supabase secrets set LICENSE_SIGNING_PRIVATE_PEM="$(cat ed25519_private.pem)"
//     It must NEVER be committed, shipped in the client, or logged.
//   • The PUBLIC key (SPKI base64 DER) is the only half embedded in the client:
//         MCowBQYDK2VwAyEAqUuyf9XwTQ4Q1x6eu7MwpjfWp15aWcZYp9fGRSg79nM=
//
// DATABASE
//   The license row gains a signature column:
//         ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS _sig text;
//   Store the base64 signature returned by signLicense() into that column. The
//   client reads it back as `_sig` on the decrypted license object.
//
// ⚠️ BYTE-FOR-BYTE AGREEMENT
//   The canonical string below MUST match the client's _canonicalSignedString
//   EXACTLY: same field list, same fixed order, enabled_modules sorted, missing
//   fields → null, and hardware_id = the BOUND hardware value stored on the row
//   (the same value the client has locally). Any divergence → the client sees an
//   invalid signature and caps the license to FREE.
// ════════════════════════════════════════════════════════════════

// ─── Authoritative license shape (only these fields are signed) ──
interface SignedLicenseFields {
  license_key: string | null;
  tier: string | null;
  status: string | null;
  expires_at: string | null;
  activated_at: string | null;
  hardware_id: string | null;      // the BOUND hardware value on the row
  max_users: number | null;
  max_companies: number | null;
  enabled_modules: string[] | null;
}

/**
 * Build the canonical signed string — MUST stay byte-for-byte identical to the
 * client's LicenseGuard._canonicalSignedString().
 *
 * Contract:
 *   - Fixed field ORDER (do not reorder).
 *   - Missing / undefined → null.
 *   - enabled_modules is SORTED (copy) before stringifying.
 *   - Output is JSON.stringify of an ordered array of [key, value] pairs.
 */
export function canonicalSignedString(lic: Partial<SignedLicenseFields>): string {
  const mods = Array.isArray(lic.enabled_modules)
    ? [...lic.enabled_modules].sort()
    : (lic.enabled_modules ?? null);
  const ordered: Array<[string, unknown]> = [
    ["license_key", lic.license_key ?? null],
    ["tier", lic.tier ?? null],
    ["status", lic.status ?? null],
    ["expires_at", lic.expires_at ?? null],
    ["activated_at", lic.activated_at ?? null],
    ["hardware_id", lic.hardware_id ?? null],
    ["max_users", lic.max_users ?? null],
    ["max_companies", lic.max_companies ?? null],
    ["enabled_modules", mods],
  ];
  return JSON.stringify(ordered);
}

// ─────────────────────────────────────────────────────────────────
// OPTION A — Node-style crypto (works on Deno via `node:crypto`).
// Simplest path; mirrors the client's crypto.verify(null, ...).
// ─────────────────────────────────────────────────────────────────
import { createPrivateKey, sign as nodeSign } from "node:crypto";

export function signLicenseNode(lic: Partial<SignedLicenseFields>): string {
  const pem = Deno.env.get("LICENSE_SIGNING_PRIVATE_PEM");
  if (!pem) throw new Error("LICENSE_SIGNING_PRIVATE_PEM not set");
  const privKey = createPrivateKey({ key: pem, format: "pem", type: "pkcs8" });
  const data = Buffer.from(canonicalSignedString(lic), "utf8");
  // Ed25519: algorithm arg MUST be null (the curve is implied by the key).
  const sig = nodeSign(null, data, privKey);
  return sig.toString("base64");
}

// ─────────────────────────────────────────────────────────────────
// OPTION B — WebCrypto (crypto.subtle). Same output; no Node shim.
// Requires the private key as PKCS#8 DER (strip PEM header/footer + base64).
// ─────────────────────────────────────────────────────────────────
function pemToPkcs8Der(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function signLicenseWebCrypto(lic: Partial<SignedLicenseFields>): Promise<string> {
  const pem = Deno.env.get("LICENSE_SIGNING_PRIVATE_PEM");
  if (!pem) throw new Error("LICENSE_SIGNING_PRIVATE_PEM not set");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8Der(pem),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const data = new TextEncoder().encode(canonicalSignedString(lic));
  const sigBuf = await crypto.subtle.sign({ name: "Ed25519" }, key, data);
  // base64 encode
  let bin = "";
  const bytes = new Uint8Array(sigBuf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ─── Usage: sign then persist to the license row's `_sig` column ──
//   const _sig = signLicenseNode(licenseRow);          // or await signLicenseWebCrypto(...)
//   await supabase.from("licenses").update({ _sig }).eq("license_key", licenseRow.license_key);
//
// The client's LicenseGuard.verifySignature() will then return true, getInfo()
// will report signed=true, and once ENFORCE_SIGNATURE is flipped on, only
// signed licenses keep their paid/trial tier.
