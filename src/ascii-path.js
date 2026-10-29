'use strict';
// ════════════════════════════════════════════════════════════════
// ascii-path (2.0.7) - an ASCII-only name for a path, for the programs that read their command line in the ANSI code page.
//
// initdb.exe, pg_ctl.exe and postgres.exe are ANSI programs: on a Windows whose code page is not the one of the folder name (an Arabic folder on an English Windows, an
// Arabic user name) every character outside the code page arrives as «?» and `initdb -D C:\بيانات\pgdata` / `--pwfile=...` stops with «could not ... C:\?????\...»
// (found by the Windows smoke test of 2.0.6, run 40904528573, the Arabic-folder phase). Windows keeps an 8.3 short name for most folders: the SAME file under an ASCII
// name. This asks for it (the Scripting.FileSystemObject of PowerShell 5.1 - present on every supported Windows - with the path handed over in an environment variable,
// so no quoting and no code page is involved), and the caller passes THAT to the ANSI program. Nothing is moved or copied: existing data stays where it is.
//
// An ASCII path, any non-Windows platform, or a volume without 8.3 names (the short name cannot be had) gives the path back unchanged - exactly the behaviour before.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ASCII = /^[\x20-\x7e]*$/;
const cache = new Map();

// The path is NOT in the script (an environment variable carries it): nothing of it can be read as code. Folder or file, whichever it is.
const SCRIPT = "$ErrorActionPreference = 'Stop'; $p = $env:TC_PATH; $fso = New-Object -ComObject Scripting.FileSystemObject; "
  + "if (Test-Path -LiteralPath $p -PathType Container) { $fso.GetFolder($p).ShortPath } else { $fso.GetFile($p).ShortPath }";

function powershellExe(env = process.env) {
  return path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/**
 * @param {string} p an existing file or folder
 * @param {object} [o] test hooks: platform, run (execFileSync), exists, warn
 * @returns {string} an ASCII-only path of the same file when one exists, else `p` itself
 */
function asciiSafePath(p, { platform = process.platform, run = execFileSync, exists = fs.existsSync, warn = console.warn, env = process.env } = {}) {
  if (platform !== 'win32' || typeof p !== 'string' || ASCII.test(p)) return p;
  if (cache.has(p)) return cache.get(p);
  let result = p; let why = '';
  try {
    if (!exists(p)) why = 'the path does not exist yet';
    else {
      const out = String(run(powershellExe(env), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
        { env: { ...env, TC_PATH: p }, encoding: 'utf8', timeout: 20000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })).trim();
      if (out && ASCII.test(out) && exists(out)) result = out;
      else why = out ? 'the short name is not ASCII or not there' : 'no short name (8.3 names are off on this volume?)';
    }
  } catch (e) { why = `the lookup failed: ${e && e.message ? String(e.message).split('\n')[0] : e}`; }
  if (result === p) { try { warn(`[ascii-path] ${why}: the ANSI programs (initdb / pg_ctl) will get the path as it is and may not read it`); } catch { /* ignore */ } }
  else if (why === '') { try { console.log(`[ascii-path] the folder name is not ASCII: the ANSI programs get its 8.3 name (${result})`); } catch { /* ignore */ } }
  // only a FOUND short name is remembered: a path that does not exist yet may exist the next time
  if (result !== p) cache.set(p, result);
  return result;
}

module.exports = { asciiSafePath, powershellExe, SCRIPT, ASCII };
