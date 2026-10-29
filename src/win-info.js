'use strict';
// ════════════════════════════════════════════════════════════════
// win-info (2.0.7) - the two Windows facts the heartbeat reports (disk used %, the Windows edition) WITHOUT depending on wmic.
//
// wmic.exe is gone from Windows 11 24H2 / Windows Server 2025 (the GitHub-hosted Windows runner of the smoke test of 2.0.6 has none): both calls threw, the surrounding
// try/catch swallowed it and the fields went out empty. wmic stays the FIRST choice (older Windows, unchanged answers); PowerShell's Get-CimInstance is the fallback.
// TELEMETRY ONLY. The licence's hardware id (license-guard.js getHardwareId) is deliberately not touched: changing what it reads would change the id and
// invalidate every issued licence (its own fallback, the host name, is what a machine without wmic uses today).
// ════════════════════════════════════════════════════════════════
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const powershellExe = (env = process.env) => path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const ps = (script, run, env) => String(run(powershellExe(env), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }));

/** `wmic logicaldisk get size,freespace,caption /format:csv` -> used percent of the first drive row, or null. */
function usedPercentFromWmicCsv(out) {
  const lines = String(out).trim().split('\n').filter((l) => l.includes(','));
  if (lines.length < 2) return null;
  const parts = lines[1].split(',');
  if (parts.length < 4) return null;
  const free = parseInt(parts[2], 10); const total = parseInt(parts[3], 10);
  return total > 0 ? +((1 - free / total) * 100).toFixed(1) : null;
}

/** "<free>,<total>" (bytes) -> used percent, or null. */
function usedPercentFromPair(text) {
  const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/m.exec(String(text));
  if (!m) return null;
  const free = Number(m[1]); const total = Number(m[2]);
  return total > 0 ? +((1 - free / total) * 100).toFixed(1) : null;
}

/** The system drive's used percent. wmic first, then Get-CimInstance. null when neither answers. */
function diskUsedPercent({ run = execFileSync, runShell = execSync, env = process.env } = {}) {
  try {
    const v = usedPercentFromWmicCsv(runShell('wmic logicaldisk get size,freespace,caption /format:csv', { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }));
    if (v !== null) return v;
  } catch { /* no wmic on this Windows */ }
  try {
    const out = ps("$d = Get-CimInstance -ClassName Win32_LogicalDisk -Filter (\"DeviceID='\" + $env:SystemDrive + \"'\"); if ($d) { '{0},{1}' -f $d.FreeSpace, $d.Size }", run, env);
    return usedPercentFromPair(out);
  } catch { return null; }
}

/** «Microsoft Windows 11 Pro» etc., or null. wmic first, then Get-CimInstance. */
function osCaption({ run = execFileSync, runShell = execSync, env = process.env } = {}) {
  try {
    const m = /Caption=(.+)/.exec(String(runShell('wmic os get Caption /format:list', { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] })));
    if (m && m[1].trim()) return m[1].trim();
  } catch { /* no wmic on this Windows */ }
  try {
    const out = ps('(Get-CimInstance -ClassName Win32_OperatingSystem).Caption', run, env).trim();
    return out || null;
  } catch { return null; }
}

module.exports = { diskUsedPercent, osCaption, usedPercentFromWmicCsv, usedPercentFromPair, powershellExe };
