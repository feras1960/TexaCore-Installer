# Releasing TexaCore 2.0.0 (and every release after it)

Supersedes `LOCAL_RELEASE_RUNBOOK.md` (1.x: replayed ~1,300 migrations onto the local DB — that path is gone).

## What is committed here and what is not

| input | where it comes from | committed? |
|---|---|---|
| production schema baseline (`production_baseline.sql`, inventory, storage stubs) | ERP repo `supabase/baseline/` → `scripts/sync-baseline.js` | **only `baseline/BASELINE_PIN.json`** (sha256 + ERP commit). The SQL is private; never commit it. |
| web bundle (`frontend/`) | ERP `vite build --mode selfhosted` → `scripts/sync-frontend.js` | no (git-ignored) |
| PostgreSQL 17.6 (`bin/*/pg`) | mac: `scripts/prepare-pg-mac.sh` (universal EDB tree → arm64) · win: `scripts/prepare-pg-win.js <EDB zip>` | no (git-ignored) |
| GoTrue / PostgREST / cloudflared binaries | `bin/*/gotrue|postgrest|cloudflared` | yes (as in 1.x) |
| fonts | `@fontsource/*` devDependencies → `scripts/localize-fonts.js` | no |

## Build (macOS arm64 dmg + zip, unsigned)

```bash
ERP=/path/to/TexaCore2026            # checkout of the release commit
# 1. ERP: build the web bundle (version comes from the ERP's package.json — it must equal this package.json)
( cd $ERP && NODE_OPTIONS=--max-old-space-size=10240 npx vite build --mode selfhosted )
# 2. installer
npm ci --prefer-offline
node scripts/sync-baseline.js --erp $ERP          # copies + VERIFIES against baseline/BASELINE_PIN.json (fails on any difference)
REQUIRE_LOCAL_FONTS=1 node scripts/sync-frontend.js --erp $ERP   # copies dist, localises fonts, runs the ERP's check-dist-version.mjs
bash scripts/prepare-pg-mac.sh                    # PG 17.6 arm64, relocatable, ad-hoc signed
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac   # prebuild-checks → electron-builder → afterPack gate
```

`afterPack` (scripts/lib/verify-packed.js) FAILS the build if any pinned baseline file is missing from the app or differs from the pin, if the
packaged web bundle is not this version, if fonts/binaries/bootstrap SQL are missing, or if a 1.x migrations manifest rides along.

### Build notes learned on 2026-10-13
- **One baseline pack per release.** `npm run build:mac` and `npm run build:win` each run `pack-baseline` (fresh key + container). Build both platforms from the same pack — `npm run build:all` (or `publish`), or run the second build without
  `pack-baseline` — otherwise the repo's generated key no longer matches the first platform's package and `verify-mac-build` M5 / `verify-win-build` W4 report "built from different source".
- **Do not build inside an iCloud-synced folder.** File-provider attributes on directories make `codesign` refuse in place; `afterPack` then signs a clean copy in the temp folder and puts it back, and fails the build if the final bundle does not verify.
- **After the mac build run `node scripts/verify-mac-build.js`** (zip + dmg + latest-mac.yml, signature validity of the extracted zip and the mounted dmg). Earlier builds shipped an invalid signature and the launch checks did not notice, because they run the inner binary.
- Update check: `node scripts/e2e/ota-check.js` (hops a, tamper, tamper2, b; mock GitHub with the real redirect chain, outside the product) and `node scripts/e2e/ui-shots.js` (launcher window, Arabic RTL + English LTR).

## Re-cutting the baseline (the only thing that changes)

1. ERP: `scripts/schema/build-baseline.sh` (see `supabase/baseline/BASELINE.md`), copy the stub file as it says, commit.
   Optionally export the global reference catalogs from production into `supabase/baseline/reference_data.sql` (loaded before the installer's defaults).
2. Here: `node scripts/sync-baseline.js --erp $ERP --update-pin` → commit **only** `baseline/BASELINE_PIN.json`.
3. Rebuild (above) and run the launch check.

## Launch check (REQUIRED before publishing — 1.9.0 failed because the build was never launched)

```bash
node scripts/e2e/launch-check.js --workdir /tmp/lc --license free  --erp $ERP --rsf "<Rashid .rsf>"
node scripts/e2e/launch-check.js --workdir /tmp/lc2 --license trial --erp $ERP
```
Runs the real ServiceManager headless on ports 47391-47396 with its own userData (never the real app's), cloudflared/MeshAgent stubbed — in Electron
dev mode, or with `--app "dist/mac-arm64/TexaCore ERP.app"` against the PACKAGED build (the harness switches are honoured in a packaged app only when
`TEXACORE_USER_DATA` and `TEXACORE_PORT_BASE` are both set): first run → baseline → services; admin + company; browser login; anon refused; tenant
isolation; admin-API secret; tunnel default-deny; GoTrue signup/admin; plan sync; Rashid import. Exit 0 = all passed; evidence in `<workdir>/results.json`.

```bash
node scripts/e2e/states-check.js    --workdir /tmp/st --app "dist/mac-arm64/TexaCore ERP.app"   # interrupted first run / 1.x data dir / restart
node scripts/e2e/backup-roundtrip.js --workdir /tmp/lc --app "dist/mac-arm64/TexaCore ERP.app"  # .tcdb backup → restore on an existing launch-check install
npm test                                                                                        # unit tests (60)
node scripts/check-rpc-coverage.js --erp $ERP                                                   # does the baseline contain every RPC the ERP calls?
```

### Hardening of the shipped package (what an analyst finds)
* **Baseline + installer SQL** are ONE AES-256-GCM container (`resources/baseline/baseline.bin`, gzip first) made by `scripts/pack-baseline.js` before every build; the key is a
  per-build module (`src/baseline-key.generated.js`, random fragments, git-ignored) that afterPack obfuscates with the rest. At first run the container is decrypted in memory and
  fed to psql over stdin — never written to disk, never logged. The afterPack gate opens the container with the PACKAGED key module, checks every pinned file, and scans the whole
  package for plaintext DDL (`CREATE FUNCTION public.` …; PostgreSQL's own share files excepted).
* **Main-process / preload / service code** is obfuscated in the package only (`scripts/lib/obfuscate-app.js`, javascript-obfuscator: mangling incl. module-level names, RC4 string array,
  light dead code; no control-flow flattening / self-defending / property renaming). The renderer files (inline-handler globals) are left alone. A manifest of the ORIGINAL sources'
  sha256 is packaged so a verifier can prove which sources the build came from. `TEXACORE_NO_OBFUSCATE=1` exists for debugging a build, never for release.
* **Database access is password-only.** initdb runs with `--auth=scram-sha-256` and a one-shot 0600 `--pwfile`; pg_hba.conf (rewritten at every start) holds scram-sha-256 rules for loopback only — no `trust`.
  Three distinct per-install passwords: the superuser `postgres` (`dbPassword`), PostgREST's `authenticator` and GoTrue's `supabase_auth_admin`. The installer's psql / pg clients get theirs through
  `PGPASSWORD` in the child environment (never argv); services get theirs through their environment. An install from an earlier test build (trust) is migrated on its next start; an install whose
  secrets were lost is re-keyed through a one-off loopback rule that is gone before the services start (`scripts/e2e/auth-migration-check.js` proves both).
* **The server log never carries SQL**: `log_min_error_statement = panic`, `log_statement = none`, logs 0600 in a 0700 directory, truncated after the bootstrap. The baseline is loaded in ONE pass; only
  statements psql reports as failed are retried (`bootstrap.loadBaseline`) instead of replaying the whole file (which produced ~12,000 "already exists" errors).
* **The tunnel token** reaches cloudflared as `TUNNEL_TOKEN` in its environment, not `--token` on the command line; `config.json` is 0600.
* **Web bundle** (ERP repo, `vite.config.ts`, mode `selfhosted` only): no source maps, esbuild minification, `console`/`debugger` dropped, no legal banners, bare-hash chunk and asset names.
* **Secrets at rest**: `secrets.enc` via Electron safeStorage where the policy allows (macOS only with a stable signature; Windows off until run on a PC), migration from the 0600 file, and PostgREST
  now takes its secrets from its environment (no `postgrest.conf` on disk). See `src/secrets-vault.js`.
* **EULA** on the dmg (English + Arabic screens) and the NSIS installer (now the assisted kind, so the licence page is shown): sources in `build/eula/`, generated by `scripts/make-eula.js`.
* Measure it: `node scripts/e2e/analyst-view.js --app <.app> --userdata <install dir> --timing --erp <ERP>`; the launch check includes an installer-window check (3.1b) that drives the real
  preload bridge + IPC + renderer of the obfuscated build.
* Next release (not in 2.0.0): bytenode bytecode per platform (build on each OS), the cloud-signed licence with enforcement, and moving the import converters server-side where possible.

### Plan limits, offline-first sync, import exemption, employee invites
* **Plan limits are never in the program.** The bundled plan rows (`src/bootstrap/reference_seed.sql`) are the production `subscription_plans` as of the release; the app runs
  fully offline on them. Whenever the cloud answers, the control panel's catalogue (+ the licence's `plan_code` / `custom_limits` / module grant) is applied (`src/plan-sync.js`,
  every 15 min and on each heartbeat); offline nothing is written, so the last synced values stay (also across restarts). Lowering a limit passes production's plan guard because the
  write carries the confirmation the guard asks for (bound to that plan id).
* **An import is never refused by a plan limit** — production carries the rule itself (migration 20270210h: `enforce_plan_limit()` with the import exemption, `fn_import_write_gate`, `fn_import_insert_rows`),
  so the pinned baseline already holds it and the installer patches nothing (the local patch of the first 2.0.0 builds was retired; install verification compares every function body with the baseline).
* **Local employee invites** (`provisioning.inviteLocalEmployee`, the *Employees* box in the installer): same server functions as the cloud's invite path, one-time password shown once.
* `node scripts/e2e/plan-sync-check.js --workdir <dir> --app <.app> --erp <ERP> --rsf <file.rsf>` proves: network blocked first run → network returns with changed limits → offline again
  (and after a restart) → import over the limits → a licence pointing at a new plan. 
* Windows: `node scripts/prepare-pg-win.js <zip>` (pinned by sha256), optional `node scripts/prepare-vcredist.js <vc_redist.x64.exe>`, `npm run build:win`, then
  `node scripts/verify-win-build.js` (static) and `docs/WINDOWS_SMOKE_CHECKLIST.md` (a real PC).

### What the launch check proves about the network (4.9–4.11)
The UI server listens on 0.0.0.0 on purpose (office PCs open the ERP from it). Everything administrative is therefore decided by
`src/net-guard.js` — loopback Host + loopback TCP peer + no proxy/CDN header — never by "not a *.texacore.ai host". The check runs
against the machine's real LAN address (and forged-Host / tunnel-header shapes): `/config.js` never carries the admin secret, every
`/api/*` call except `/api/ping` is 403 even WITH the right secret, the raw API/admin/PostgREST/GoTrue/PostgreSQL ports refuse
connections on the LAN address, the same LAN client still logs in and reads only its own tenant through `/_supabase`, no server
answers a foreign Origin with Access-Control-Allow-Origin, and hostile `restore-tcdb` uploads (`../`, absolute, drive letter, NUL,
bad magic) are refused before anything is written. `TEXACORE_TCDB_DIR` (isolated harness runs only) points the restore folder at the scratch dir.

## Licence signature (ENFORCE_SIGNATURE) — left OFF in 2.0.0
No cloud path issues the Ed25519 `_sig` the client verifies (license-activate signs an HMAC `signature`; create_trial, licensing_register_free,
licensing_get_license_state, license-heartbeat and license-validate sign nothing; the free licence is minted locally), and heartbeat rewrites signed
fields. Enforcing now would cap every paid/trial licence to free. See the comment above the flag in `src/license-guard.js`; the mechanism is tested
in `test/license-signature.test.js`. Flip the flag only after the cloud signs every licence AND re-signs after each heartbeat change.

## Publish

`npm run publish` (never upload a hand-renamed exe: names with spaces 404). Windows installer name is `TexaCore-ERP-Setup-<version>.exe`.
`latest.yml` / `latest-mac.yml` carry the version from package.json. After the files are live, insert the `licensing.app_versions` row for 2.0.0
(not before — clients would be told to fetch a file that does not exist).
