# Windows smoke checklist — TexaCore ERP 2.0.0 (run on a REAL Windows 10/11 x64 PC)

The Windows installer was verified statically on a Mac (`scripts/verify-win-build.js`: contents, versions, PostgreSQL 17.6 DLL closure, security
code paths). Nothing could be RUN. This list is the first run. ~30 minutes. Stop at the first failure and send the log folder (below).

**Before you start**
- Windows 10/11, 64-bit. Use a PC (or a fresh VM) that has never had TexaCore.
- Unsigned installer: Windows SmartScreen says "Unknown publisher" → *More info* → *Run anyway*.
- PostgreSQL needs the **Microsoft Visual C++ 2015-2022 x64 runtime** (VCRUNTIME140.dll). The installer installs it silently if it was bundled
  (`build/vcredist/vc_redist.x64.exe`) and the PC lacks it. If this build was made without it, install it first (https://aka.ms/vs/17/release/vc_redist.x64.exe)
  — a clean PC without it fails at step 3 with "VCRUNTIME140.dll was not found".

**Steps** (tick each; note what you see when it does not match)
1. Run `TexaCore-ERP-Setup-2.0.0.exe` (administrator prompt: yes). It installs without asking questions and starts TexaCore ERP.
2. The app window opens and shows 2.0.0 (footer). Choose **Start Free** (no internet needed).
3. Wait for the first start (1–3 minutes: database creation). The window must reach "running"; no error box. *This is the PostgreSQL + VC++ runtime test.*
4. Create a company (name, your e-mail, a password of 6+ characters, currency). It must succeed; the ERP page opens in the browser at `http://localhost`.
5. Sign in on that page with the e-mail/password. The dashboard opens, fonts look right (Arabic, no boxes).
6. Open the ERP's subscription/plan screen: plan = Free, with the control panel's limits (1 user, 1 company, 1 branch, 1 warehouse, 200 customers, 200 invoices/month).
7. Windows Firewall: when asked, allow TexaCore ERP on **private** networks. From ANOTHER PC/phone on the same network open the **employee link** shown in the
   installer's *Employees* box (`http://<this PC's IP>/login?c=…`). The login page must load and the owner can sign in from there. Then open
   `http://<this PC's IP>/config.js` in that other PC's browser: it must NOT contain the word "localApiSecret".
8. *Employees* box → add an employee (e-mail, name, role). On the FREE plan this is refused ("users limit"): expected. (Switch to a Trial from the licence screen to test it.)
9. Import a Rashid file (company wizard → "Import from Rashid"): it must finish, with customers/warehouses/invoices above the free limits — an import is never refused. Afterwards
   creating one more customer beyond the limit must be refused with the plan-limit message.
10. Turn the network off (unplug / airplane mode) and restart the app: it must start and work fully offline. Turn it on: within ~15 minutes plan limits follow the control panel.
11. Backup: *Backup now* → a `.tcdb` file appears in `C:\TexaCore` (or the folder you chose). Restore it through the wizard.
12. Quit from the tray icon. Task Manager must show no `postgres.exe`, `postgrest.exe`, `auth.exe` left. Start again: it starts without rebuilding (seconds, not minutes).
13. Uninstall (Settings → Apps). The data folder is kept on purpose.

**Where the logs are** (send this folder if anything fails): `%APPDATA%\TexaCore ERP\` → `logs\heartbeat.log` and `texacore-data\logs\`
(`postgres.log`, `baseline-load.json`, `gotrue.log`, `postgrest.log`), plus `texacore-data\bootstrap.json`.

**Known untested-on-Windows assumptions** (the first things to look at if step 3 fails): `initdb --locale=C --locale-provider=icu --icu-locale=en-US`;
`pg_ctl start` (no unix socket on Windows); loopback-only `pg_hba.conf`; the ICU 67 that ships with the EDB build (production runs a newer ICU — irrelevant to a fresh local database).
