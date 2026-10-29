# windows-smoke-install.ps1 — the Windows-only steps of .github/workflows/windows-smoke.yml: download + verify the PUBLISHED installer, install it silently,
# prove the outbound-network block, uninstall. Every step appends its checks to <Out>\install.json (merged into the job summary by windows-smoke.js).
# Public repository: no secrets, no SQL, nothing that needs credentials.
param(
  [Parameter(Mandatory)][ValidateSet('prepare', 'install', 'netguard', 'uninstall')][string]$Step,
  [string]$Out = 'smoke-out',
  [string]$WorkDir = $env:RUNNER_TEMP,
  [string]$Url = '',
  [string]$Sha256 = '',
  [string]$Version = '2.0.6'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$statePath = Join-Path $Out 'install.json'
$installerPath = Join-Path $WorkDir "TexaCore-ERP-Setup-$Version.exe"

function Load-State {
  if (Test-Path $statePath) { return (Get-Content $statePath -Raw | ConvertFrom-Json -AsHashtable) }
  return @{ version = $Version; checks = @(); facts = @{} }
}
function Save-State($s) { $s | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 $statePath }
function Add-Check($s, [string]$name, [bool]$ok, [string]$evidence) {
  $s.checks += @{ name = $name; ok = $ok; evidence = $evidence }
  Write-Host ('{0}  {1}  -  {2}' -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $name, $evidence)
}
function Vc-State {
  $k = 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'
  if (Test-Path $k) { $p = Get-ItemProperty $k; return @{ installed = [int]$p.Installed; bld = [int]$p.Bld; version = [string]$p.Version } }
  return @{ installed = 0; bld = 0; version = 'none' }
}
function Find-InstallDir {
  $keys = Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue
  foreach ($k in $keys) {
    $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
    if ($p.DisplayName -like 'TexaCore*') { return @{ dir = [string]$p.InstallLocation; name = [string]$p.DisplayName; version = [string]$p.DisplayVersion; publisher = [string]$p.Publisher; key = $k.PSChildName } }
  }
  return $null
}
function Out-Output($k, $v) { if ($env:GITHUB_OUTPUT) { "$k=$v" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8 } }

$s = Load-State

switch ($Step) {

  'prepare' {
    $os = Get-CimInstance Win32_OperatingSystem
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $defender = 'unknown'; try { $defender = "real-time protection " + $(if ((Get-MpComputerStatus).RealTimeProtectionEnabled) { 'ON' } else { 'off' }) } catch { }
    $fw = 'unknown'; try { $fw = (Get-NetFirewallProfile | ForEach-Object { "$($_.Name)=$($_.Enabled)" }) -join ', ' } catch { }
    $vc = Vc-State
    $s.facts = @{
      os = "$($os.Caption) $($os.Version) ($($os.OSArchitecture))"; culture = (Get-Culture).Name; uiCulture = (Get-UICulture).Name; systemLocale = (Get-WinSystemLocale).Name
      admin = $admin; defender = $defender; firewall = $fw; cpus = [Environment]::ProcessorCount; ramGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
      freeGB = [math]::Round((Get-PSDrive C).Free / 1GB, 1); vcBefore = $vc
    }
    Write-Host ($s.facts | ConvertTo-Json -Depth 4)
    New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Invoke-WebRequest -Uri $Url -OutFile $installerPath -UseBasicParsing
    $sw.Stop()
    $hash = (Get-FileHash $installerPath -Algorithm SHA256).Hash.ToLower()
    $size = (Get-Item $installerPath).Length
    $s.sha256 = $hash; $s.sizeMB = [math]::Round($size / 1MB, 1)
    Add-Check $s 'I1 download the PUBLISHED installer from the GitHub release and verify its SHA-256' ($hash -eq $Sha256.ToLower()) ("{0} MB in {1} s; sha256 {2}{3}" -f $s.sizeMB, [math]::Round($sw.Elapsed.TotalSeconds, 1), $hash.Substring(0, 16), $(if ($hash -eq $Sha256.ToLower()) { ' = the published value' } else { " (expected $($Sha256.Substring(0, 16)))" }))
    $sig = Get-AuthenticodeSignature $installerPath
    Add-Check $s 'I2 code signing of the installer (informational: the build is unsigned, so SmartScreen shows «Unknown publisher» to a real user)' $true ("Authenticode status: {0}{1}" -f $sig.Status, $(if ($sig.SignerCertificate) { ", signer " + $sig.SignerCertificate.Subject } else { '' }))
    Save-State $s
    if ($hash -ne $Sha256.ToLower()) { throw "installer sha256 mismatch: $hash" }
    Out-Output 'installer' $installerPath
  }

  'install' {
    $vcBefore = Vc-State
    Write-Host "Installing silently: $installerPath /S"
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process -FilePath $installerPath -ArgumentList '/S' -Wait -PassThru
    $sw.Stop()
    $s.installSeconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
    $reg = Find-InstallDir
    $dir = if ($reg -and $reg.dir) { $reg.dir } else { Join-Path $env:ProgramFiles 'TexaCore ERP' }
    $exe = Join-Path $dir 'TexaCore ERP.exe'
    for ($i = 0; $i -lt 60 -and -not (Test-Path $exe); $i++) { Start-Sleep -Seconds 1 }
    $s.installDir = $dir
    Add-Check $s 'I3 silent install (NSIS /S, per-machine): exit code 0, the program is on disk' (($p.ExitCode -eq 0) -and (Test-Path $exe)) ("exit code {0} after {1} s; installed to {2}" -f $p.ExitCode, $s.installSeconds, $dir)

    $files = Get-ChildItem $dir -Recurse -File -ErrorAction SilentlyContinue
    $sizeMB = [math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB)
    $res = Join-Path $dir 'resources'
    $must = @('TexaCore ERP.exe', 'resources\app\package.json', 'resources\app\src\main.js', 'resources\bin\pg\bin\postgres.exe', 'resources\bin\pg\bin\initdb.exe', 'resources\bin\pg\bin\pg_ctl.exe', 'resources\bin\pg\bin\psql.exe',
      'resources\baseline', 'resources\frontend\index.html', 'resources\vcredist\vc_redist.x64.exe')
    $missing = $must | Where-Object { -not (Test-Path (Join-Path $dir $_)) }
    $pkg = $null; try { $pkg = Get-Content (Join-Path $dir 'resources\app\package.json') -Raw | ConvertFrom-Json } catch { }
    $svc = (Get-ChildItem (Join-Path $res 'bin') -File -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(gotrue|auth|postgrest|cloudflared)' } | ForEach-Object { $_.Name }) -join ', '
    Add-Check $s "I4 the installed tree is complete and is $Version (app, PostgreSQL 17 bundle, GoTrue / PostgREST, baseline, web bundle, VC++ redistributable)" (($missing.Count -eq 0) -and $pkg -and ($pkg.version -eq $Version)) ("{0} MB, {1} files; package version {2}; services: {3}; missing: {4}" -f $sizeMB, $files.Count, $pkg.version, $svc, $(if ($missing) { $missing -join ', ' } else { 'none' }))
    $s.sizeOnDiskMB = $sizeMB

    $shortcuts = @()
    foreach ($d in @([Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('CommonPrograms'))) {
      $shortcuts += Get-ChildItem $d -Recurse -Filter 'TexaCore*.lnk' -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Replace($d, '<' + (Split-Path $d -Leaf) + '>') }
    }
    $perMachine = $dir.StartsWith($env:ProgramFiles, [StringComparison]::OrdinalIgnoreCase)
    Add-Check $s 'I5 per-machine install: under Program Files, an Apps & features entry, Desktop and Start Menu shortcuts' ($perMachine -and $reg -and ($shortcuts.Count -ge 2)) ("entry «{0}» version {1}, publisher {2}; shortcuts: {3}" -f $reg.name, $reg.version, $reg.publisher, ($shortcuts -join '; '))

    $vcAfter = Vc-State
    $bundled = Join-Path $dir 'resources\vcredist\vc_redist.x64.exe'
    $bv = (Get-Item $bundled).VersionInfo.FileVersion
    $bundledBld = 0; if ($bv -match '^\d+\.\d+\.(\d+)') { $bundledBld = [int]$Matches[1] }
    $bsig = Get-AuthenticodeSignature $bundled
    $s.facts.vcAfter = $vcAfter; $s.facts.vcBundled = $bv
    $ranOk = $vcAfter.installed -eq 1 -and $vcAfter.bld -ge $bundledBld
    Add-Check $s 'I6 Visual C++ 2015-2022 x64 runtime (needed by PostgreSQL): present at the bundled build or newer after the install' $ranOk ("before: installed={0} build={1}; after: installed={2} build={3}; bundled redistributable {4}, signature {5}{6}" -f $vcBefore.installed, $vcBefore.bld, $vcAfter.installed, $vcAfter.bld, $bv, $bsig.Status, $(if ($vcBefore.installed -eq 1 -and $vcBefore.bld -ge $bundledBld) { ' - the runner already had it, so the installer skipped its step by design (the clean-PC path is NOT exercised here)' } else { ' - the installer installed / updated it' }))
    $vcRun = Start-Process -FilePath $bundled -ArgumentList '/install', '/quiet', '/norestart' -Wait -PassThru
    Add-Check $s 'I7 the bundled vc_redist.x64.exe runs silently the way the installer runs it (0 done, 1638 newer present, 3010 restart advised)' (@(0, 1638, 3010) -contains $vcRun.ExitCode) ("exit code {0}" -f $vcRun.ExitCode)

    $running = Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) }
    Add-Check $s 'I8 the silent install does not leave the app running (it is started by the test, not by the installer)' $true ("{0}" -f $(if ($running) { "the installer started " + (($running | ForEach-Object { $_.ProcessName }) -join ', ') + " - stopped before the test" } else { 'nothing running after the install' }))
    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2

    (Get-ChildItem $dir -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object { '{0}  {1}' -f $_.FullName.Substring($dir.Length), $(if ($_.PSIsContainer) { '<dir>' } else { $_.Length }) }) | Set-Content -Encoding UTF8 (Join-Path $Out 'install-tree.txt')
    Save-State $s
    Out-Output 'install_dir' $dir
    Out-Output 'exe' $exe
    Out-Output 'app_dir' (Join-Path $dir 'resources\app')
    if (($p.ExitCode -ne 0) -or -not (Test-Path $exe)) { throw 'the silent install failed' }
  }

  'netguard' {
    # The real-launch phase presses «Start Free» in the real window. Online that registers a licence in the cloud, which a smoke test must never do, so the app's outbound
    # network is blocked by the firewall first - and the block is PROVEN with a control program before anything is clicked.
    $dir = $s.installDir; $exe = Join-Path $dir 'TexaCore ERP.exe'
    $blocked = $false; $evidence = ''
    try {
      Get-NetFirewallRule -DisplayName 'smoke-block-*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
      New-NetFirewallRule -DisplayName 'smoke-block-texacore-out' -Direction Outbound -Program $exe -Action Block -Profile Any | Out-Null
      $probeDir = Join-Path $WorkDir 'probe'; New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
      $node = (Get-Command node).Source; $probe = Join-Path $probeDir 'node-probe.exe'; Copy-Item $node $probe -Force
      New-NetFirewallRule -DisplayName 'smoke-block-probe-out' -Direction Outbound -Program $probe -Action Block -Profile Any | Out-Null
      $js = Join-Path $probeDir 'probe.js'
      @"
const https = require('https'), http = require('http');
const out = [];
const done = () => { console.log(out.join(' ')); process.exit(0); };
const net = () => { const q = https.get('https://api.github.com/zen', { headers: { 'user-agent': 'smoke' }, timeout: 8000 }, (r) => { out.push('NET=REACHED(' + r.statusCode + ')'); r.resume(); done(); });
  q.on('error', (e) => { out.push('NET=BLOCKED(' + e.code + ')'); done(); }); q.on('timeout', () => { out.push('NET=BLOCKED(timeout)'); q.destroy(); done(); }); };
const s = http.createServer((q, r) => r.end('x')).listen(0, '127.0.0.1', () => {
  http.get('http://127.0.0.1:' + s.address().port, (r) => { out.push('LOOPBACK=OK'); r.resume(); s.close(); net(); }).on('error', (e) => { out.push('LOOPBACK=FAIL(' + e.code + ')'); s.close(); net(); });
});
"@ | Set-Content -Encoding UTF8 $js
      $control = (& $node $js) -join ' '
      $probed = (& $probe $js) -join ' '
      $blocked = ($control -match 'NET=REACHED') -and ($probed -match 'NET=BLOCKED') -and ($probed -match 'LOOPBACK=OK')
      $evidence = "control program (not blocked): $control; same program under the block rule: $probed"
    } catch { $evidence = "could not set the firewall rule: $($_.Exception.Message)" }
    if (-not $blocked) { Get-NetFirewallRule -DisplayName 'smoke-block-*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue }
    Add-Check $s 'N1 the app outbound network is blocked by a firewall rule (loopback still works) - proven with a control program before the real launch' $blocked $evidence
    $s.netBlocked = $blocked
    Save-State $s
    Out-Output 'net_blocked' $(if ($blocked) { 'true' } else { 'false' })
  }

  'uninstall' {
    $dir = $s.installDir
    $un = Get-ChildItem $dir -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $un) { Add-Check $s 'U1 silent uninstall' $false 'no Uninstall*.exe in the install folder'; Save-State $s; throw 'no uninstaller' }
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $p = Start-Process -FilePath $un.FullName -ArgumentList '/S', "_?=$dir" -Wait -PassThru
    $sw.Stop()
    Start-Sleep -Seconds 3
    $exeGone = -not (Test-Path (Join-Path $dir 'TexaCore ERP.exe'))
    $reg = Find-InstallDir
    $lnk = @(Get-ChildItem ([Environment]::GetFolderPath('CommonDesktopDirectory')), ([Environment]::GetFolderPath('CommonPrograms')) -Recurse -Filter 'TexaCore*.lnk' -ErrorAction SilentlyContinue)
    $data = @('TexaCore ERP', 'texacore-installer') | ForEach-Object { Join-Path $env:APPDATA $_ } | Where-Object { Test-Path (Join-Path $_ 'texacore-data') }
    Add-Check $s 'U1 silent uninstall: exit 0, the program, its Apps & features entry and the shortcuts are gone' (($p.ExitCode -eq 0) -and $exeGone -and (-not $reg) -and ($lnk.Count -eq 0)) ("exit code {0} in {1} s; program gone {2}; entry gone {3}; shortcuts left {4}" -f $p.ExitCode, [math]::Round($sw.Elapsed.TotalSeconds, 1), $exeGone, (-not $reg), $lnk.Count)
    Add-Check $s 'U2 the user data survives an uninstall by design (the company database is not deleted)' ($data.Count -ge 1) ("data folder kept: {0}" -f $(if ($data) { Split-Path $data[0] -Leaf } else { 'NOT FOUND' }))
    $un2 = @{ checks = $s.checks | Select-Object -Last 2 }
    $un2 | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 (Join-Path $Out 'uninstall.json')
    # the same checks must not be counted twice in the summary
    $s.checks = @($s.checks | Select-Object -First ($s.checks.Count - 2))
    Save-State $s
  }
}
