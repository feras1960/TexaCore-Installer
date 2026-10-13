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
