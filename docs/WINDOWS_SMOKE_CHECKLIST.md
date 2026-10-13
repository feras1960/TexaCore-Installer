# Windows smoke checklist — TexaCore ERP 2.0.0 (run on a REAL Windows 10/11 x64 PC)

The Windows installer was verified statically on a Mac (`scripts/verify-win-build.js`: contents, versions, PostgreSQL 17.6 DLL closure, security
code paths). Nothing could be RUN. This list is the first run. ~30 minutes. Stop at the first failure and send the log folder (below).

**Before you start**
- Windows 10/11, 64-bit. Use a PC (or a fresh VM) that has never had TexaCore.
- Unsigned installer: Windows SmartScreen says "Unknown publisher" -> *More info* -> *Run anyway*.
- The installer shows the licence agreement (English, then Arabic): read it, accept, continue. Installation needs administrator rights (the installer is per-machine).
- PostgreSQL needs the **Microsoft Visual C++ 2015-2022 x64 runtime** (VCRUNTIME140.dll). This build BUNDLES Microsoft's `vc_redist.x64.exe` (14.44.35211) and the installer runs it silently
  (`/install /quiet /norestart`) when the PC lacks the runtime or has an older build. Test BOTH situations (steps 0a and 0b below) — the whole point of bundling it is the clean PC.

**Step 0a - a CLEAN PC with no Visual C++ runtime** (a fresh Windows VM is ideal; check first: *Settings -> Apps* shows no "Microsoft Visual C++ 2015-2022 Redistributable (x64)", and
`reg query "HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64"` says the key is not found)
1. Run `TexaCore-ERP-Setup-2.0.0.exe`. During the install the progress text mentions "Installing the Microsoft Visual C++ runtime ..." (a short extra step; no windows pop up).
2. When it finishes, *Settings -> Apps* now lists "Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.44.35211" (or newer), and the registry key above shows `Installed 0x1` and `Bld` >= 35211.
3. A restart is NOT required. Continue with step 1 below: the first start (step 3) must reach "running" with no "VCRUNTIME140.dll was not found" and no database error.
   *If step 1 shows a message box "The Microsoft Visual C++ runtime could not be installed (code ...)", write the code down and send the install log.*

**Step 0b - a PC that already has the runtime** (any current Windows 10/11 that has run recent software; or after 0a)
1. Run the installer again (or on another PC). The install log line reads "Microsoft Visual C++ runtime already installed (build ...) - skipped" and no second runtime is installed.
2. On a PC with an OLDER runtime (build below 35211) the installer updates it silently: afterwards `Bld` is >= 35211. Existing programs keep working.

**Steps** (tick each; note what you see when it does not match)
1. Run `TexaCore-ERP-Setup-2.0.0.exe` (administrator prompt: yes). It installs without asking questions and starts TexaCore ERP.
2. The app window opens and shows 2.0.0 (footer). Choose **Start Free** (no internet needed).
3. Wait for the first start (1-3 minutes: database creation). The window must reach "running"; no error box. *This is the PostgreSQL + VC++ runtime test.*
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

**Where the install log is**: the installer's own detail text (click *Show details* on its progress page) lists the runtime step; send a screenshot of it if 0a/0b misbehave.

**Known untested-on-Windows assumptions** (the first things to look at if step 3 fails): `initdb --locale=C --locale-provider=icu --icu-locale=en-US`;
`pg_ctl start` (no unix socket on Windows); loopback-only `pg_hba.conf`; the ICU 67 that ships with the EDB build (production runs a newer ICU — irrelevant to a fresh local database).
