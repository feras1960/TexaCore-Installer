# Phase H2 — Asymmetric License Signing: Rollout Runbook

**Goal:** the client VERIFIES an Ed25519 signature (`_sig`) on every license.
A license whose signature is **absent or invalid is capped to the FREE tier**
(never trial/paid). The private key lives ONLY on the licensing server; the
client embeds only the public key.

**Golden rule:** ⛔ Do **NOT** flip `ENFORCE_SIGNATURE = true` until every
active license carries a valid `_sig` **and** the fleet has had time to backfill
via heartbeat. Flipping early bricks every unsigned (legacy v2) license by
downgrading it to free.

---

## Ordered steps

### 1. Add the `_sig` column
```sql
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS _sig text;
```
No client change required; the client already reads `_sig` when present and
tolerates its absence (`verifySignature` returns false → observability only
while `ENFORCE_SIGNATURE=false`).

### 2. Deploy the signer (server side)
- Store the private key as a Supabase secret (generated locally by the operator,
  never committed):
  ```
  supabase secrets set LICENSE_SIGNING_PRIVATE_PEM="$(cat ed25519_private.pem)"
  ```
- Deploy the edge function using `docs/edge/license-sign.reference.ts` as the
  canonical reference. It MUST build the identical canonical string to the
  client's `_canonicalSignedString` (same field list, fixed order,
  `enabled_modules` sorted, missing → null, bound `hardware_id`).
- From this point on, every **new** license issuance / state change writes a
  fresh `_sig`.

### 3. Backfill-sign existing licenses
- Run a one-off job that loads each existing license row, rebuilds the canonical
  string from the SAME authoritative fields, signs it, and writes `_sig`.
- The signed `hardware_id` must be the **bound** value stored on each row — the
  same value the client holds locally — or verification will fail there.
- Verify the backfill covers 100% of active rows before proceeding.

### 4. Verify clients report `signed=true` (telemetry)
- The client exposes `getInfo().signed` (and `getInfo().effective_tier`).
- Confirm via heartbeat/telemetry that the overwhelming majority of active
  installs now report `signed=true`. This proves the canonical string agrees
  byte-for-byte and that backfill reached the fleet.
- Do not proceed while a meaningful share still reports `signed=false` (those
  installs would be downgraded to free the moment enforcement turns on).

### 5. Flip `ENFORCE_SIGNATURE = true`
- In `src/license-guard.js`, change `const ENFORCE_SIGNATURE = false;` to `true`.
- From now on `effectiveTier()` returns `'free'` for any unsigned/invalid
  license. Plan resolution (`syncActivePlan` → `currentEffectiveTier()`) then
  downgrades such installs to the free plan automatically.

### 6. Rebuild / release
- Rebuild the Electron installer and publish the new version.
- Monitor telemetry for an unexpected spike in `effective_tier='free'`, which
  would indicate a backfill gap or a canonical-string mismatch — roll back the
  flag (step 5) if so and re-audit step 3.

---

## Why the transition flag exists
`ENFORCE_SIGNATURE=false` decouples **deployment** of verification from
**enforcement**. During the window the signature is computed and surfaced
(`getInfo().signed`) for observability, but tiers are untouched, so the working
free/trial/paid switching is a strict no-op (`effectiveTier === tier`). Only
after backfill + telemetry confirmation does enforcement (and any downgrade)
begin.
