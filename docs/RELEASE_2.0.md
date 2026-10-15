# Releasing TexaCore 2.0.0 (and every release after it)

Supersedes `LOCAL_RELEASE_RUNBOOK.md` (1.x: replayed ~1,300 migrations onto the local DB — that path is gone).

## What is committed here and what is not

| input | where it comes from | committed? |
|---|---|---|
| production schema baseline (`production_baseline.sql`, inventory, storage stubs) | ERP repo `supabase/baseline/` → `scripts/sync-baseline.js` | **only `baseline/BASELINE_PIN.json`** (sha256 + ERP commit). The SQL is private; never commit it. |
| web bundle (`frontend/`) | ERP `vite build --mode selfhosted` → `scripts/sync-frontend.js` | no (git-ignored) |
| incremental migrations (2.0.2+: what production received after the baseline cut) | ERP `supabase/migrations/` at `origin/main` → `scripts/sync-migrations.js` → `./migrations/` (build output) → `scripts/pack-baseline.js` → `baseline/migrations.bin` | **only `baseline/MIGRATIONS_PIN.json`** (names, order, sha256, sizes — no SQL). `migrations/` is git-ignored; the SQL and the manifest are never committed to this PUBLIC repo. |
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
node scripts/sync-migrations.js --erp $ERP        # 2.0.2+: fetches the pinned incremental migrations from ERP origin/main into ./migrations (git-ignored), every sha256 must equal baseline/MIGRATIONS_PIN.json
REQUIRE_LOCAL_FONTS=1 node scripts/sync-frontend.js --erp $ERP   # copies dist, localises fonts, runs the ERP's check-dist-version.mjs
bash scripts/prepare-pg-mac.sh                    # PG 17.6 arm64, relocatable, ad-hoc signed
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:mac   # prebuild-checks → electron-builder → afterPack gate
```

`afterPack` (scripts/lib/verify-packed.js) FAILS the build if any pinned baseline file is missing from the app or differs from the pin, if the
packaged web bundle is not this version, if fonts/binaries/bootstrap SQL are missing, if the migrations container is not exactly `baseline/MIGRATIONS_PIN.json`, or if ANY plaintext SQL rides along (a `resources/migrations` folder, a `.sql` file, DDL text in any file — there is no exception list).

### Build notes learned on 2026-10-13
- **One baseline pack per release.** `npm run build:mac` and `npm run build:win` each run `pack-baseline` (fresh key + container). Build both platforms from the same pack — `npm run build:all` (or `publish`), or run the second build without
  `pack-baseline` — otherwise the repo's generated key no longer matches the first platform's package and `verify-mac-build` M5 / `verify-win-build` W4 report "built from different source".
- **Do not build inside an iCloud-synced folder.** File-provider attributes on directories make `codesign` refuse in place; `afterPack` then signs a clean copy in the temp folder and puts it back, and fails the build if the final bundle does not verify.
- **Build into a folder that is NOT managed by a file-provider (iCloud / Desktop sync).** 2.0.2's first build left `dist/mac-arm64` from the previous build in place; its directories carried `com.apple.FinderInfo` / `fileprovider` attributes, in-place signing failed ("detritus not allowed"), the clean-copy fallback signed fine (the zip verified) but the put-back was re-tagged before the dmg was made, so `verify-mac-build` M4 reported an INVALID SIGNATURE in the dmg. Fix used: `dist` is a symlink to a folder under `/private/tmp` (`ln -s /private/tmp/<work>/dist_build dist`, a fresh empty target per build); then afterPack signed in place and M4 passed.
- **After the mac build run `node scripts/verify-mac-build.js`** (zip + dmg + latest-mac.yml, signature validity of the extracted zip and the mounted dmg). Earlier builds shipped an invalid signature and the launch checks did not notice, because they run the inner binary.
- Update check: `node scripts/e2e/ota-check.js` (hops a, tamper, tamper2, b; mock GitHub with the real redirect chain, outside the product) and `node scripts/e2e/ui-shots.js` (launcher window, Arabic RTL + English LTR; U12 = the update progress widget, every state).
  Hops tamper / tamper2 / b drive the CLIENT you give them (`--old180`, `--client200`): they test that client's updater, so they only exercise the resumable download once the client is a 2.0.2+ build.
- Resumable download (2.0.2+): `npm test` (test/update-resume.test.js — drops at 40 % and 80 %, stall, restart, no-Range server, corrupt bytes, pause, disk space, network-up) and, on the real app, `node scripts/e2e/ota-resume-check.js --workdir <dir>`
  (isolated userData, ports 47391+, mock GitHub; kills the app mid-download and checks that the restart resumes).
- Before uploading: `node scripts/release-assets.js` (uploads nothing; verifies dist/ and prints the `gh release upload` commands — binaries + blockmaps first, feeds last).

## Opening a 1.x company file (.tcdb) in 2.0 — measured 2026-10-13, and what 2.0 does about it
**Result: it cannot work, so 2.0 refuses it before touching anything.** A real 1.8.0 file (PostgreSQL 15, plain `pg_dump` of the 1.x local schema, written by the 1.8.0 build `c05be42` in a lab run with 4 companies / 6 entries / 6 customers)
was opened in the packaged 2.0 through the launcher's «فتح» button with the old flow unguarded:
- the flow reported success, but 621 statements failed: every table whose columns differ between the 1.x local schema and the production-derived 2.0 schema failed **as a whole** (90 "column … does not exist", 26 foreign-key column mismatches,
  `journal_entry_lines.is_fund_line` NULL against a NOT NULL, array literals) — companies 4→0, tenants 4→0, customers 6→0, journal lines 12→0, user_profiles, branches, warehouses, roles, plans, modules… came back empty; only some entries and the login survived;
- the "replace" step had already truncated the 2.0 tables, the dump's CREATE statements added ~38 tables / ~60 functions to the 2.0 database (integrity: 796 tables vs 758 expected; **38 of them anon-readable without row security**), and the sync would then have overwritten the 1.x file;
- the signed-in 1.x admin saw no company.
So `BackupManager.peekDumpMajor()` reads the dump header ("-- Dumped from database version N") and a file written by PostgreSQL < 17 is refused with `LEGACY_TCDB` before the backup manager is pointed at it and before any statement runs
(`scripts/e2e/legacy-tcdb-check.js`: file byte-identical after a minute, database unchanged, hardening intact). The old data stays safe: the whole 1.x data folder is kept (`texacore-data.v18-backup-<time>`), and so is every .tcdb.
The launcher's upgrade notice says so (and tells the user to create the company again or import from the Rashid file). A real migration of 1.x data needs a purpose-built converter (restore the dump into a scratch database and copy the common columns into the 2.0 schema,
company data only) — not in 2.0.0.

How the 1.x file was produced (lab only, never the product tree): a worktree of `c05be42`; its bundled PostgreSQL 15.17 restored from git; `scripts/e2e/lab-180-migrations.js` restores the 195 migration files the repo does not track (`migrations/` is ignored) from the ERP git history
(3 installer-only `20260713L/M/N_local_*` files do not exist anywhere readable, so 299 of 333 migrations applied); every hard-coded service port in that copy moved into the 47391–47399 block — **including the literal `54322` in `main.js`, `migration-runner.js` and `backup-manager.js`, which
would otherwise have talked to an installed app's database** — and the run was wrapped in `sandbox-exec` denying outbound 80/443/8080/8443 and the installed app's ports. Then: create a company through the admin API, add rows with SQL, `POST /api/backup`.

### 2.0.1 field fixes — what to know
- **Cloud Access on macOS** needs the pinned cloudflared: `node scripts/prepare-cloudflared-mac.js <official 2026.10.0 darwin-arm64 binary>` (checks sha256, size, Cloudflare's Developer ID signature, that it runs) → `bin/macos-arm64/cloudflared/cloudflared` (committed; Apache-2.0).
  `prebuild-checks`, the afterPack gate and `verify-mac-build` M6 refuse a mac build without it. `scripts/e2e/tunnel-check.js` runs the REAL binary with fake tokens (malformed, well-formed-but-refused, not runnable).
- **The launcher's connection status** is `ServiceManager.getTunnelStatus()` (src/tunnel-monitor.js): connected only after cloudflared logged a registered connection.
- **`/config.js` and the service worker.** The ERP's service worker precaches `/config.js` with a constant revision → the first copy it ever saw stays for good. The installer serves a versioned shell (`/config.js?v=<version>-<boot id>`),
  `sw.js` without the config.js entry, `/config.js` with `no-store, max-age=0`. `scripts/e2e/rsf-wizard-ui-check.js` reproduces the stale-precache profile and drives the Rashid wizard in a real Chrome.
  The request that makes a page "local" is decided in src/net-guard.js (`classifyRequest`): loopback Host + a peer that is this machine (loopback in any spelling, or one of its own addresses) + not forwarded from elsewhere
  (Cloudflare headers, or a forwarding header naming a foreign / unreadable address, or a foreign X-Forwarded-Host). A raw TCP forwarder (ssh -R, ngrok tcp) that adds no header at all cannot be told from a local program — as before.
- **Third-party files are not in the repo**: `Sample.rsf`, `*.tcdb`, `.tmp-rsf/`, `data/backups/` are ignored (and untracked in 2.0.1; the git history still holds the old copies). A check that needs a Rashid file reads it from OUTSIDE the repo (`--rsf <path>`).
- **No emoji as icons**: the launcher window draws every icon as an inline SVG (`src/icons.js`, Lucide shapes, ISC — `THIRD_PARTY_NOTICES.md`), so Windows renders them like macOS does; translated strings carry no symbols; the Windows tray uses the real 16/32 px entries of `build/icon.ico` and a plain-text menu. `test/launcher-icons.test.js` fails if an emoji comes back into the window sources, the translations or the tray menu. Log lines in the main process keep theirs (not the interface).

## Re-cutting the baseline (the only thing that changes)

1. ERP: `scripts/schema/build-baseline.sh` (see `supabase/baseline/BASELINE.md`), copy the stub file as it says, commit.
   Optionally export the global reference catalogs from production into `supabase/baseline/reference_data.sql` (loaded before the installer's defaults).
2. Here: `node scripts/sync-baseline.js --erp $ERP --update-pin` → commit **only** `baseline/BASELINE_PIN.json`. Then re-pin the incremental migrations: `node scripts/sync-migrations.js --erp $ERP --update-pin --names ""` (the re-cut folded them in) or with the names of the ones production applied after the new cut, in production's order; measure their inventory delta (`scripts/e2e/migrations-check.js --write-inventory <file>`) and install it with `node scripts/sync-migrations.js --inventory <file>` (private, git-ignored) → commit **only** `baseline/MIGRATIONS_PIN.json`.
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
* **The incremental migrations (2.0.2+)** are a SECOND container of the same format, sealed with the same per-build key (`resources/baseline/migrations.bin` + `MIGRATIONS_PACKED.json`: `migrations.json` + every `.sql`); `src/migrations-store.js` decrypts them in memory on start, the runner feeds psql over stdin (big files included: no temp file) and the package has no plaintext migration of any kind.
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
`latest.yml` / `latest-mac.yml` carry the version from package.json.
**Always upload the `.blockmap` files** (`TexaCore-ERP-Setup-<v>.exe.blockmap`, `TexaCore-ERP-<v>-arm64.zip.blockmap`): electron-updater's differential download on Windows needs the blockmap of the NEW version and of the INSTALLED one;
2.0.0 and 2.0.1 shipped without them. `node scripts/release-assets.js` lists and verifies the complete set (and `--blockmaps-only` adds just the blockmaps to a release that is already live, after proving the published binary is the one in dist/).
GitHub layout today: macOS is the **Latest** release `v<version>` (`latest-mac.yml`, zip, dmg — the Mac self-updater reads `releases/latest/download/latest-mac.yml`); Windows is a separate **pre-release** `v<version>-windows-test` that holds only the exe
(no `latest.yml`, so electron-updater finds nothing to update to). That strategy is unchanged here. After the files are live, insert the `licensing.app_versions` row for 2.0.0
(not before — clients would be told to fetch a file that does not exist).
