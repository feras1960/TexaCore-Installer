'use strict';
// 2.0.7 - two Windows findings of the smoke test of 2.0.6 (GitHub-hosted Windows Server 2025, run 40904528573), neither of which can run on a Mac, so the parts that decide
// something are tested with injected command runners:
//   1. initdb / pg_ctl read their command line in the ANSI code page: a data folder with an Arabic name arrived as «C:\?????? ???\…». ascii-path.js hands them the 8.3 name.
//   2. wmic is missing on Windows 11 24H2 / Server 2025: the heartbeat's disk % and Windows edition went out empty. win-info.js falls back to Get-CimInstance.
// The licence's hardware id (license-guard.js, wmic csproduct) is NOT changed - a test pins that.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { asciiSafePath, SCRIPT, powershellExe } = require('../src/ascii-path');
const winInfo = require('../src/win-info');

const ARABIC = 'C:\\بيانات فحص\\userdata\\texacore-data\\pgdata';
const SHORT = 'C:\\BF8F~1\\USERDA~1\\TEXACO~1\\pgdata';

test('asciiSafePath: an ASCII path, or any non-Windows platform, is returned untouched and nothing is run', () => {
  const run = () => { throw new Error('must not run'); };
  assert.equal(asciiSafePath('C:\\Users\\Ali\\AppData\\Roaming\\texacore-installer\\pgdata', { platform: 'win32', run }), 'C:\\Users\\Ali\\AppData\\Roaming\\texacore-installer\\pgdata');
  assert.equal(asciiSafePath('C:\\Program Files\\TexaCore ERP\\x', { platform: 'win32', run }), 'C:\\Program Files\\TexaCore ERP\\x');
  assert.equal(asciiSafePath(ARABIC, { platform: 'darwin', run }), ARABIC);
  assert.equal(asciiSafePath(ARABIC, { platform: 'linux', run }), ARABIC);
});

test('asciiSafePath on Windows: an Arabic folder gets its 8.3 name; the path travels in an environment variable (never in the script); the answer is cached', () => {
  const calls = [];
  const exists = (p) => p === ARABIC || p === SHORT;
  const run = (exe, args, opts) => { calls.push({ exe, args, opts }); return `${SHORT}\r\n`; };
  const got = asciiSafePath(ARABIC, { platform: 'win32', run, exists, warn: () => {}, env: { SystemRoot: 'C:\\Windows' } });
  assert.equal(got, SHORT);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].exe, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(calls[0].opts.env.TC_PATH, ARABIC, 'the path is handed over in TC_PATH (UTF-16 environment block: no code page, no quoting)');
  assert.ok(calls[0].args.includes('-NoProfile') && calls[0].args.includes('-NonInteractive'));
  const script = calls[0].args[calls[0].args.length - 1];
  assert.equal(script, SCRIPT);
  assert.doesNotMatch(script, /بيانات/, 'no part of the path is inside the script');
  assert.match(script, /\$env:TC_PATH/);
  assert.equal(asciiSafePath(ARABIC, { platform: 'win32', run, exists, warn: () => {} }), SHORT);
  assert.equal(calls.length, 1, 'second call: from the cache');
});

test('asciiSafePath: no short name (8.3 off), a non-ASCII answer, a failing lookup or a path that does not exist yet -> the path itself, with a warning, and nothing is remembered for a missing path', () => {
  const warns = [];
  const warn = (m) => warns.push(m);
  const P1 = 'C:\\ملف-١\\pgdata'; const P2 = 'C:\\ملف-٢\\pgdata'; const P3 = 'C:\\ملف-٣\\pgdata'; const P4 = 'C:\\ملف-٤\\pgdata';
  assert.equal(asciiSafePath(P1, { platform: 'win32', run: () => '\r\n', exists: () => true, warn }), P1);
  assert.equal(asciiSafePath(P2, { platform: 'win32', run: () => 'C:\\ملف~1\\pgdata', exists: () => true, warn }), P2, 'a short name that is not ASCII is useless');
  assert.equal(asciiSafePath(P3, { platform: 'win32', run: () => { throw new Error('powershell failed\nsecond line'); }, exists: () => true, warn }), P3);
  assert.equal(asciiSafePath(P4, { platform: 'win32', run: () => { throw new Error('must not run for a missing path'); }, exists: () => false, warn }), P4);
  assert.equal(warns.length, 4);
  assert.match(warns[2], /the lookup failed: powershell failed/);
  assert.match(warns[3], /does not exist yet/);
  // a path that did not exist is looked up again once it does
  assert.equal(asciiSafePath(P4, { platform: 'win32', run: () => 'C:\\PGDATA~1', exists: () => true, warn }), 'C:\\PGDATA~1');
});

test('service-manager hands the ANSI programs the ASCII-safe path: initdb -D and --pwfile, pg_ctl start / stop -D and -l, PGDATA', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'service-manager.js'), 'utf8');
  assert.match(src, /'-D', asciiSafePath\(this\.pgDataDir\),\n\s+'-U', 'postgres'/);
  assert.match(src, /`--pwfile=\$\{asciiSafePath\(pwFile\)\}`/);
  assert.match(src, /start -D "\$\{asciiSafePath\(this\.pgDataDir\)\}" -l "\$\{asciiSafePath\(logFile\)\}"/);
  assert.equal((src.match(/stop -D "\$\{asciiSafePath\(this\.pgDataDir\)\}"/g) || []).length + (src.match(/-D "\$\{asciiSafePath\(this\.pgDataDir\)\}" stop/g) || []).length, 2);
  assert.match(src, /pgEnv\.PGDATA = asciiSafePath\(this\.pgDataDir\);/);
  assert.doesNotMatch(src, /-D "\$\{this\.pgDataDir\}"/, 'no pg_ctl call left with the raw path');
  assert.equal(powershellExe({ SystemRoot: 'D:\\Win' }), 'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
});

test('win-info: wmic answers -> its values, PowerShell is not started', () => {
  const runShell = (cmd) => {
    if (/logicaldisk/.test(cmd)) return 'Node,Caption,FreeSpace,Size\r\nHOST,C:,25000000000,100000000000\r\nHOST,D:,1,2\r\n';
    return 'Caption=Microsoft Windows 10 Pro\r\n\r\n';
  };
  const run = () => { throw new Error('PowerShell must not be asked'); };
  assert.equal(winInfo.diskUsedPercent({ runShell, run }), 75);
  assert.equal(winInfo.osCaption({ runShell, run }), 'Microsoft Windows 10 Pro');
});

test('win-info: wmic missing (Windows 11 24H2 / Server 2025) -> Get-CimInstance gives the same two facts', () => {
  const runShell = () => { throw new Error("'wmic' is not recognized as an internal or external command"); };
  const asked = [];
  const run = (exe, args) => {
    const script = args[args.length - 1]; asked.push(script);
    if (/Win32_LogicalDisk/.test(script)) return '30000000000,120000000000\r\n';
    if (/Win32_OperatingSystem/.test(script)) return 'Microsoft Windows Server 2025 Datacenter\r\n';
    throw new Error('unexpected');
  };
  assert.equal(winInfo.diskUsedPercent({ runShell, run }), 75);
  assert.equal(winInfo.osCaption({ runShell, run }), 'Microsoft Windows Server 2025 Datacenter');
  assert.equal(asked.length, 2);
  assert.match(asked[0], /SystemDrive/, 'the system drive');
});

test('win-info: neither wmic nor PowerShell, or an unreadable answer -> null (the heartbeat just leaves the field empty); never throws', () => {
  const boom = () => { throw new Error('nothing here'); };
  assert.equal(winInfo.diskUsedPercent({ runShell: boom, run: boom }), null);
  assert.equal(winInfo.osCaption({ runShell: boom, run: boom }), null);
  assert.equal(winInfo.diskUsedPercent({ runShell: boom, run: () => 'garbage' }), null);
  assert.equal(winInfo.diskUsedPercent({ runShell: boom, run: () => '5,0' }), null, 'a zero size is not a percentage');
  assert.equal(winInfo.osCaption({ runShell: boom, run: () => '   \r\n' }), null);
  assert.equal(winInfo.usedPercentFromWmicCsv('Node,Caption,FreeSpace,Size\r\n'), null);
  assert.equal(winInfo.usedPercentFromPair('30000000000,120000000000'), 75);
});

test('the heartbeat uses win-info (no direct wmic left in main.js), and the licence hardware id is exactly what it was: wmic csproduct, then the host-name fallback', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.doesNotMatch(main, /exec(Sync)?\(['"]wmic/, 'no wmic call is left in main.js');
  assert.match(main, /require\('\.\/win-info'\)\.diskUsedPercent\(\)/);
  assert.match(main, /require\('\.\/win-info'\)\.osCaption\(\)/);
  const lg = fs.readFileSync(path.join(__dirname, '..', 'src', 'license-guard.js'), 'utf8');
  assert.match(lg, /'wmic csproduct get uuid'/, 'the licence id still reads wmic csproduct');
  assert.match(lg, /this\._hwId = `WIN-\$\{uuid\}`;/);
  assert.match(lg, /this\._hwId = `FALLBACK-\$\{require\('os'\)\.hostname\(\)\}-\$\{process\.arch\}`;/, 'and falls back to the host name where wmic is missing');
  assert.equal((lg.match(/wmic/g) || []).length, 1, 'license-guard.js has not been touched');
});
