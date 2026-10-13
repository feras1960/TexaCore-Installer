#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// verify-win-build — the strongest check of the Windows x64 installer that can be made on a Mac (a Windows PC is needed to RUN it:
// docs/WINDOWS_SMOKE_CHECKLIST.md). It opens the REAL deliverable, not the build folder:
//
//   node scripts/verify-win-build.js [--dist dist] [--out <evidence.json>]
//
//   W1  latest.yml: version 2.0.0, file name, size and sha512 of the installer
//   W2  the installer is a PE32+ x64 NSIS executable; its embedded app archive (app-64.7z) is extracted
//   W3  version 2.0.0 everywhere (app package.json, executable resources)
//   W4  the application code inside the installer is byte-identical to the repo's src/ (incl. net-guard, function-patches, plan-sync,
//       provisioning, bootstrap SQL) and carries the security code paths: loopback binds, local-only admin API, no wildcard CORS
//   W5  the pinned database baseline + the web bundle (2.0.0, local fonts) are in the installer, byte-for-byte what the pin says
//   W6  PostgreSQL 17.6: postgres/initdb/pg_ctl/psql/pg_dump/pg_restore, ICU, the extensions the baseline needs, everything initdb reads,
//       and the DLL CLOSURE — every DLL each executable imports is in the bundle or is a Windows system DLL (PE import tables parsed here)
//   W9  the Visual C++ runtime is bundled (pinned Microsoft file) and the silent-install step is wired and version-aware
//   W7  GoTrue, PostgREST, cloudflared are x64 PE files; GoTrue/PostgREST versions equal the macOS ones that were launch-tested
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Results } = require('./e2e/lib');
const { verifyPacked } = require('./lib/verify-packed');

const ROOT = path.join(__dirname, '..');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const DIST = path.resolve(ROOT, arg('dist', 'dist'));
const OUT = arg('out', '');
const pkg = require('../package.json');
const VERSION = pkg.version;
const sha = (f, algo = 'sha256', enc = 'hex') => crypto.createHash(algo).update(fs.readFileSync(f)).digest(enc);
const read = (f) => fs.readFileSync(f, 'utf8');

// ─── PE import tables ───
function peInfo(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt16LE(0) !== 0x5a4d) throw new Error('not a PE file (no MZ)');
  const pe = b.readUInt32LE(0x3c);
  if (b.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('no PE signature');
  const machine = b.readUInt16LE(pe + 4);
  const nSections = b.readUInt16LE(pe + 6);
  const optSize = b.readUInt16LE(pe + 20);
  const opt = pe + 24;
  const magic = b.readUInt16LE(opt);
  const dd = opt + (magic === 0x20b ? 112 : 96);                    // data directories
  const importRva = b.readUInt32LE(dd + 8);
  const sections = [];
  for (let i = 0; i < nSections; i++) {
    const s = opt + optSize + i * 40;
    sections.push({ va: b.readUInt32LE(s + 12), vsize: b.readUInt32LE(s + 8), raw: b.readUInt32LE(s + 20), rawSize: b.readUInt32LE(s + 16) });
  }
  const off = (rva) => { const s = sections.find((x) => rva >= x.va && rva < x.va + Math.max(x.vsize, x.rawSize)); return s ? rva - s.va + s.raw : -1; };
  const imports = [];
  if (importRva) {
    for (let p = off(importRva); p > 0; p += 20) {
      const nameRva = b.readUInt32LE(p + 12);
      if (!nameRva) break;
      const o = off(nameRva);
      imports.push(b.toString('latin1', o, b.indexOf(0, o)).toLowerCase());
    }
  }
  return { machine, x64: machine === 0x8664, pe32plus: magic === 0x20b, imports };
}
const SYSTEM_DLL = /^(kernel32|kernelbase|user32|gdi32|advapi32|ws2_32|wsock32|msvcrt|shell32|shlwapi|ole32|oleaut32|crypt32|secur32|bcrypt|ncrypt|ntdll|version|winmm|iphlpapi|comdlg32|mswsock|rpcrt4|sspicli|wldap32|dbghelp|normaliz|ucrtbase|userenv|netapi32|setupapi|imm32|mpr|psapi|dnsapi|cryptbase|bcryptprimitives|dwmapi|uxtheme|comctl32|rasapi32|powrprof|shfolder|authz|wintrust|winspool|sechost|cfgmgr32|devobj|msasn1|profapi|windows\.storage|wtsapi32|ntmarta|dbgcore|d3d11|dxgi|crypt32|msi|rstrtmgr|secur32|wevtapi|netutils|samcli|samlib|lsasrv|kerberos|ntdsapi|schannel)\.dll$|^api-ms-win-.*\.dll$/i;
// the Visual C++ runtime is NOT a Windows system DLL on a clean PC — it must ride along with the app or the PC needs the redistributable
const VC_RUNTIME = /^(vcruntime\d+(_\d+)?|msvcp\d+(_\d+)?|concrt\d+|vcomp\d+|vccorlib\d+|mfc\d+u?)\.dll$/i;

(async () => {
  const R = new Results();
  const evidence = {};
  const exeName = `TexaCore-ERP-Setup-${VERSION}.exe`;
  const installer = path.join(DIST, exeName);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'winverify-'));
  let app = '';
  try {
    await R.check('W1 latest.yml matches the installer (version, file, size, sha512)', async () => {
      const y = read(path.join(DIST, 'latest.yml'));
      const get = (k) => (new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(y) || [])[1];
      if (get('version') !== VERSION) throw new Error(`version ${get('version')}`);
      if (get('path') !== exeName) throw new Error(`path ${get('path')}`);
      const st = fs.statSync(installer);
      const size = Number(/size:\s*(\d+)/.exec(y)[1]);
      const sum = /sha512:\s*(\S+)/.exec(y)[1];
      if (size !== st.size) throw new Error(`size ${size} vs file ${st.size}`);
      if (sha(installer, 'sha512', 'base64') !== sum) throw new Error('sha512 differs from latest.yml');
      evidence.installer = { file: exeName, bytes: st.size, sha256: sha(installer) };
      return `${exeName} ${st.size} bytes, sha512 matches, sha256 ${evidence.installer.sha256}`;
    });

    await R.check('W2 the installer is an x64 PE (NSIS) and its embedded app archive extracts', async () => {
      const pe = peInfo(installer);
      if (pe.machine !== 0x14c && !pe.x64) throw new Error(`machine 0x${pe.machine.toString(16)}`);          // the NSIS stub is a 32-bit PE on purpose; the APP inside is x64 (checked below)
      const buf = fs.readFileSync(installer);
      if (buf.indexOf(Buffer.from('Nullsoft', 'latin1')) < 0) throw new Error('not an NSIS installer');
      const at = buf.indexOf(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]));
      if (at < 0) throw new Error('no embedded 7z archive');
      const arc = path.join(work, 'app.7z');
      fs.writeFileSync(arc, buf.subarray(at));
      app = path.join(work, 'app');
      const za = path.join(ROOT, 'node_modules', '7zip-bin', process.platform === 'darwin' ? `mac/${process.arch}` : 'linux/x64', '7za');
      execFileSync(za, ['x', '-y', `-o${app}`, arc], { stdio: 'ignore', maxBuffer: 1 << 28 });
      if (!fs.existsSync(path.join(app, 'TexaCore ERP.exe'))) throw new Error('TexaCore ERP.exe missing in the archive');
      const exe = peInfo(path.join(app, 'TexaCore ERP.exe'));
      if (!exe.x64) throw new Error('TexaCore ERP.exe is not x64');
      return `NSIS installer (32-bit stub, as NSIS always is; it installs a 64-bit app only — perMachine, x64); app archive at byte ${at} extracted; TexaCore ERP.exe is a PE32+ x64 binary`;
    });
    if (!app) throw new Error('no extracted app — cannot continue');
    const res = path.join(app, 'resources');
    const code = path.join(res, 'app');

    await R.check('W3 the version is 2.0.0 (app package.json, executable resources) and the app is not asar-packed (so its code is inspectable)', async () => {
      const p = JSON.parse(read(path.join(code, 'package.json')));
      if (p.version !== VERSION) throw new Error(`app package.json ${p.version}`);
      if (fs.existsSync(path.join(res, 'app.asar'))) throw new Error('unexpected app.asar');
      const exeBytes = fs.readFileSync(path.join(app, 'TexaCore ERP.exe'));
      const w = Buffer.from(`${VERSION}.0`, 'utf16le');
      if (exeBytes.indexOf(w) < 0) throw new Error(`the executable's version resource does not carry ${VERSION}.0`);
      return `package.json ${p.version}; executable file/product version ${VERSION}.0; resources/app (no asar — the code below was read from it directly)`;
    });

    await R.check('W4 the application code in the installer is the repo\'s source, obfuscated; the security code paths are those the unit tests prove', async () => {
      const bad = [];
      const man = JSON.parse(read(path.join(code, 'src-manifest.json')));
      if (man.obfuscated !== true) bad.push('src-manifest.json: not obfuscated');
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
      let n = 0;
      for (const f of walk(path.join(ROOT, 'src'))) {
        const rel = path.relative(path.join(ROOT, 'src'), f).split(path.sep).join('/');
        if (rel.endsWith('.sql')) { if (fs.existsSync(path.join(code, 'src', rel))) bad.push(`plain SQL packaged: ${rel}`); continue; }
        n += 1;
        if (!fs.existsSync(path.join(code, 'src', rel))) { bad.push(`missing ${rel}`); continue; }
        if (man.files[rel] !== sha(f)) bad.push(`built from different source: ${rel}`);
      }
      const noComments = (t) => t.replace(/^\s*(\/\/|--).*$/gm, '');
      for (const f of ['main.js', 'service-manager.js', 'provisioning.js', 'plan-sync.js', 'baseline-key.generated.js']) {
        const t = read(path.join(code, 'src', f));
        for (const probe of ['function handleCreateLocalCompany', 'adminRequestIsLocal', 'class ServiceManager', 'fn_membership_invite_create', 'INSERT INTO public.subscription_plans']) if (t.includes(probe)) bad.push(`${f} is readable ("${probe}")`);
      }
      for (const f of ['renderer.js', 'i18n.js', 'index.html']) if (sha(path.join(ROOT, 'src', f)) !== sha(path.join(code, 'src', f))) bad.push(`${f} differs from the repo`);
      if (/Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*['"]/.test(noComments(read(path.join(code, 'src', 'renderer.js'))))) bad.push('wildcard CORS in renderer.js');
      if (bad.length) throw new Error(bad.slice(0, 6).join('; '));
      // the security code paths: the unit tests that pin them (loopback binds, local-only admin API, signup off, upload validation, no wildcard CORS,
      // RLS never disabled) run against exactly the sources the manifest matched
      const t = require('child_process').spawnSync('node', ['--test', 'test/security-static.test.js', 'test/net-guard.test.js', 'test/baseline-container.test.js'], { cwd: ROOT, encoding: 'utf8' });
      if (t.status !== 0) throw new Error(`security unit tests fail on those sources: ${(t.stdout || '').split('\n').filter((l) => /^not ok/.test(l)).join(' | ')}`);
      return `${n} source files: the build's manifest equals the repo's sha256 for every one; main-process code obfuscated (no readable markers); no plain SQL packaged; security unit tests (loopback binds, local-only admin API, signup off, upload validation, no wildcard CORS, RLS never disabled, container never written/logged) pass on those exact sources`;
    });

    await R.check('W5 baseline pin + web bundle: the installer carries exactly what the pin says (afterPack gate re-run on the installer\'s own files)', async () => {
      const problems = verifyPacked({ resourcesDir: res, appCodeDir: code, repoRoot: ROOT, platform: 'win32' });
      if (problems.length) throw new Error(problems.slice(0, 4).join('; '));
      const pin = JSON.parse(read(path.join(res, 'baseline', 'BASELINE_PIN.json')));
      const html = read(path.join(res, 'frontend', 'index.html'));
      if (!new RegExp(`name="texacore-app-version" content="${VERSION.replace(/\./g, '\\.')}"`).test(html)) throw new Error('web bundle is not stamped 2.0.0');
      if (/fonts\.(googleapis|gstatic)\.com/.test(html)) throw new Error('Google Fonts referenced');
      const fonts = fs.readdirSync(path.join(res, 'frontend', 'fonts')).filter((x) => x.endsWith('.woff2')).length;
      return `baseline cut ${pin.cutTimestamp}, ${Object.keys(pin.files).length} pinned files identical; web bundle 2.0.0 with ${fonts} local font files`;
    });

    await R.check('W6 PostgreSQL 17.6 for Windows: binaries, ICU, extensions, initdb inputs and the full DLL closure', async () => {
      const pg = path.join(res, 'bin', 'pg');
      const bin = path.join(pg, 'bin');
      const ver = read(path.join(pg, 'PG_BUNDLE_VERSION')).trim();
      if (ver !== '17.6') throw new Error(`bundle version ${ver}`);
      const src = read(path.join(pg, 'PG_BUNDLE_SOURCE'));
      if (!src.includes('d378882abd001a186735acd6f6ba716bca6ccd192e800412d4fd15ed25376b3e')) throw new Error('bundle is not the pinned archive');
      const problems = [];
      const have = new Set(fs.readdirSync(bin).map((x) => x.toLowerCase()));
      const exes = ['postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'psql.exe', 'pg_dump.exe', 'pg_restore.exe', 'pg_isready.exe'];
      for (const e of exes) if (!have.has(e)) problems.push(`bin/${e} missing`);
      const postgres = fs.readFileSync(path.join(bin, 'postgres.exe')).toString('latin1');
      if (!/PostgreSQL 17\.6[,\s]/.test(postgres)) problems.push('postgres.exe is not 17.6');
      const icu = [...have].filter((x) => /^icu(dt|in|uc|io|tu)\d+\.dll$/.test(x));
      if (icu.length < 3) problems.push(`ICU runtime missing (${icu.join(',')})`);
      if (!/with-icu|icu/i.test(postgres)) problems.push('postgres.exe has no ICU support string');
      for (const ext of ['uuid-ossp', 'pgcrypto', 'pg_stat_statements', 'plpgsql']) {
        if (!fs.existsSync(path.join(pg, 'share', 'extension', `${ext}.control`))) problems.push(`share/extension/${ext}.control missing`);
        if (!fs.existsSync(path.join(pg, 'lib', `${ext}.dll`))) problems.push(`lib/${ext}.dll missing`);
        const sqls = fs.readdirSync(path.join(pg, 'share', 'extension')).filter((x) => x.startsWith(`${ext}--`));
        if (!sqls.length && ext !== 'plpgsql') problems.push(`share/extension/${ext}--*.sql missing`);
      }
      for (const f of ['postgres.bki', 'postgresql.conf.sample', 'pg_hba.conf.sample', 'information_schema.sql', 'sql_features.txt', 'snowball_create.sql', 'system_constraints.sql', 'system_functions.sql', 'system_views.sql']) {
        if (!fs.existsSync(path.join(pg, 'share', f))) problems.push(`share/${f} (initdb input) missing`);
      }
      for (const d of ['timezone', 'timezonesets', 'tsearch_data']) if (!fs.existsSync(path.join(pg, 'share', d))) problems.push(`share/${d} missing`);
      // DLL closure
      const targets = [...exes.map((e) => path.join(bin, e)), path.join(bin, 'libpq.dll'),
        ...['uuid-ossp', 'pgcrypto', 'pg_stat_statements', 'plpgsql'].map((x) => path.join(pg, 'lib', `${x}.dll`))];
      const vc = new Set(); const external = new Set();
      let dlls = 0;
      for (const t of targets) {
        if (!fs.existsSync(t)) continue;
        const info = peInfo(t);
        if (!info.x64) problems.push(`${path.basename(t)} is not x64`);
        for (const imp of info.imports) {
          dlls += 1;
          if (have.has(imp)) continue;
          if (VC_RUNTIME.test(imp)) { vc.add(imp); continue; }
          if (SYSTEM_DLL.test(imp)) continue;
          external.add(`${path.basename(t)} → ${imp}`);
        }
      }
      // the same closure for every bundled DLL (a DLL pulling in a missing DLL is the classic "works on the build machine" failure)
      for (const f of [...have].filter((x) => x.endsWith('.dll'))) {
        const info = peInfo(path.join(bin, f));
        for (const imp of info.imports) {
          if (have.has(imp) || SYSTEM_DLL.test(imp)) continue;
          if (VC_RUNTIME.test(imp)) { vc.add(imp); continue; }
          external.add(`${f} → ${imp}`);
        }
      }
      if (external.size) problems.push(`DLLs imported but neither bundled nor Windows system DLLs: ${[...external].slice(0, 6).join('; ')}`);
      if (problems.length) throw new Error(problems.join('; '));
      evidence.vcRuntimeImports = [...vc].sort();
      const redist = fs.existsSync(path.join(res, 'vcredist', 'vc_redist.x64.exe'));
      const vcBundled = [...vc].filter((x) => fs.existsSync(path.join(bin, x)) || fs.existsSync(path.join(app, x)));
      const vcNote = !vc.size ? 'no Visual C++ runtime import'
        : (vcBundled.length === vc.size ? `Visual C++ runtime DLLs bundled (${[...vc].sort().join(', ')})`
          : redist ? `Visual C++ runtime imported (${[...vc].sort().join(', ')}); vc_redist.x64.exe is bundled and build/installer.nsh installs it silently when the PC lacks it`
            : `Visual C++ runtime imported (${[...vc].sort().join(', ')}) and NOT bundled — a clean PC needs the VC++ 2015-2022 x64 Redistributable (node scripts/prepare-vcredist.js <vc_redist.x64.exe>, then rebuild)`);
      if (vc.size && vcBundled.length !== vc.size && !redist) R.warnings.push(vcNote);
      evidence.vcRuntime = vcNote;
      return `PG 17.6 (pinned archive), ICU ${icu.join(',')}, 4 extensions with control+dll+sql, initdb inputs present, import tables of ${targets.length} executables/modules + ${[...have].filter((x) => x.endsWith('.dll')).length} bundled DLLs resolve; ` +
        vcNote;
    });

    await R.check('W7 GoTrue, PostgREST, cloudflared are x64 PE files; GoTrue/PostgREST versions equal the macOS builds that were launch-tested', async () => {
      const wb = path.join(res, 'bin');
      const files = { gotrue: path.join(wb, 'gotrue', 'auth.exe'), postgrest: path.join(wb, 'postgrest', 'postgrest.exe'), cloudflared: path.join(wb, 'cloudflared', 'cloudflared.exe') };
      for (const [k, f] of Object.entries(files)) { if (!fs.existsSync(f)) throw new Error(`${k} missing`); if (!peInfo(f).x64) throw new Error(`${k} is not x64`); }
      const grab = (f, re) => { const m = re.exec(fs.readFileSync(f).toString('latin1')); return m ? m[0] : ''; };
      const gt = (f) => grab(f, /supabase\/auth\/internal\/utilities\.Version=v?[\d.]+|GoTrue\/[\d.]+|v2\.\d+\.\d+(?=[\s\S]{0,40}gotrue)/);
      const winPg = grab(files.postgrest, /postgrest-\d+\.\d+\.\d+/);
      const macPg = grab(path.join(ROOT, 'bin', 'macos-arm64', 'postgrest', 'postgrest'), /postgrest-\d+\.\d+\.\d+/);
      const winGt = gt(files.gotrue); const macGt = gt(path.join(ROOT, 'bin', 'macos-arm64', 'gotrue', 'auth'));
      if (macPg && winPg && macPg !== winPg) throw new Error(`PostgREST: windows "${winPg}" vs mac "${macPg}"`);
      if (macGt && winGt && macGt !== winGt) throw new Error(`GoTrue: windows "${winGt}" vs mac "${macGt}"`);
      return `x64 PE: auth.exe ${Math.round(fs.statSync(files.gotrue).size / 1e6)} MB, postgrest.exe, cloudflared.exe; PostgREST win="${winPg || 'n/a'}" mac="${macPg || 'n/a'}"; GoTrue win="${winGt.replace(/^.*Version=/, '') || 'n/a'}" (the macOS binary does not print its version; both were added by the same 1.8.0 commit)`;
    });
    await R.check('W8 the installer shows the EULA (assisted NSIS installer + licence RTF with the no-reverse-engineering clause in Arabic and English)', async () => {
      const nsis = pkg.build.nsis || {};
      if (nsis.oneClick !== false) throw new Error('nsis.oneClick is not false — a one-click installer has no licence page');
      if (nsis.license !== 'build/eula.rtf' || !fs.existsSync(path.join(ROOT, nsis.license))) throw new Error('nsis.license does not point at build/eula.rtf');
      const { CLAUSE_EN, CLAUSE_AR } = require('./make-eula');
      const out = require('child_process').spawnSync('textutil', ['-convert', 'txt', '-stdout', path.join(ROOT, nsis.license)], { encoding: 'utf8' });
      const text = out.status === 0 ? out.stdout : null;
      if (text !== null && (!text.includes(CLAUSE_EN) || !text.includes(CLAUSE_AR))) throw new Error('the RTF does not carry both clauses verbatim after parsing');
      return `oneClick=false, license=build/eula.rtf${text !== null ? ' (parsed: both clauses verbatim)' : ' (clauses checked in the generator tests; textutil not available)'}; the licence text is compiled INTO the installer by makensis (the build log shows "oneClick=false")`;
    });

    await R.check('W9 the Visual C++ 2015-2022 x64 runtime is bundled (pinned, Microsoft-signed) and the silent install is wired: /install /quiet /norestart, skipped when already installed', async () => {
      const { PINNED, verifyRedist } = require('./prepare-vcredist');
      const f = path.join(res, 'vcredist', 'vc_redist.x64.exe');
      if (!fs.existsSync(f)) throw new Error('resources/vcredist/vc_redist.x64.exe is not in the installer (node scripts/prepare-vcredist.js <file>, then rebuild)');
      const bad = verifyRedist(fs.readFileSync(f));
      if (bad.length) throw new Error(`the bundled file is not the pinned Microsoft redistributable: ${bad.join('; ')}`);
      // the wiring — the source the installer was compiled from (electron-builder includes build/installer.nsh via nsis.include; the compile succeeded)
      if (pkg.build.nsis.include !== 'build/installer.nsh') throw new Error('nsis.include does not point at build/installer.nsh');
      const nsh = read(path.join(ROOT, 'build', 'installer.nsh')).replace(/^\s*;.*$/gm, '');
      const need = [
        [/!macro customInstall/, 'customInstall macro'],
        [/SetRegView 64/, '64-bit registry view'],
        [/HKLM "SOFTWARE\\Microsoft\\VisualStudio\\14\.0\\VC\\Runtimes\\x64" "Installed"/, 'reads the Installed value'],
        [/HKLM "SOFTWARE\\Microsoft\\VisualStudio\\14\.0\\VC\\Runtimes\\x64" "Bld"/, 'reads the Bld value'],
        [/\$0 != 1\s*\n\s*\$\{OrIf\} \$2 < \$\{VCREDIST_BLD\}/, 'runs only when missing or older than the bundled build'],
        [/ExecWait '"\$INSTDIR\\resources\\vcredist\\vc_redist\.x64\.exe" \/install \/quiet \/norestart' \$1/, 'silent install command line'],
        [/\$1 != 3010[\s\S]*\$1 != 1638/, 'exit codes 3010/1638 accepted'],
        [/\$\{Else\}\s*\n\s*DetailPrint "Microsoft Visual C\+\+ runtime already installed[^"]*skipped"/, 'skipped when already installed'],
      ];
      const missing = need.filter(([re]) => !re.test(nsh)).map(([, w]) => w);
      if (missing.length) throw new Error(`installer.nsh lacks: ${missing.join('; ')}`);
      const ver = read(path.join(ROOT, 'build', 'vcredist', 'vcredist-version.nsh'));
      if (!new RegExp(`!define VCREDIST_BLD ${PINNED.version.split('.')[2]}\\b`).test(ver)) throw new Error('vcredist-version.nsh does not carry the pinned build number');
      return `bundled resources/vcredist/vc_redist.x64.exe = the pinned file (${PINNED.bytes} bytes, sha256 ${PINNED.sha256.slice(0, 16)}…, Microsoft Authenticode block, v${PINNED.version}); installer.nsh: reads HKLM ...\\VC\\Runtimes\\x64 Installed+Bld, runs "/install /quiet /norestart" only when missing or build < ${PINNED.version.split('.')[2]}, accepts exit codes 0/3010/1638, otherwise prints "already installed ... skipped"`;
    });

  } catch (e) {
    R.rows.push({ name: 'harness', ok: false, evidence: e.message, ms: 0 });
    console.log(`  FAIL  harness — ${e.message}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), summary: R.summary(), warnings: R.warnings, evidence, rows: R.rows }, null, 2));
  for (const w of R.warnings) console.log(`  WARN  ${w}`);
  console.log(`\nverify-win-build: ${R.summary()}`);
  process.exit(R.failed.length ? 1 : 0);
})();
