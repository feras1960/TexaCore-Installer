; TexaCore ERP — extra NSIS steps (electron-builder: nsis.include)
;
; PostgreSQL for Windows (EnterpriseDB build) imports VCRUNTIME140.dll / MSVCP140.dll. A clean Windows PC may not have the
; "Visual C++ 2015-2022 x64 Redistributable"; without it postgres.exe cannot start.
; If the redistributable is bundled ($INSTDIR\resources\vcredist\vc_redist.x64.exe, put there by scripts/prepare-vcredist.js) it is installed
; silently (/install /quiet /norestart) — but ONLY when the runtime is missing or older than the bundled one (registry: HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64,
; values Installed and Bld). When it is already installed (same or newer build) nothing is run. Exit codes 0 (done), 3010 (done, restart advised)
; and 1638 (a newer one is already present) are all fine; anything else is reported in the install log and, outside silent mode, in a message box.
!include /NONFATAL "${BUILD_RESOURCES_DIR}\vcredist\vcredist-version.nsh"
!ifndef VCREDIST_BLD
  !define VCREDIST_BLD 0
!endif

!macro customInstall
  SetRegView 64
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ReadRegDWORD $2 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Bld"
  ${If} $0 != 1
  ${OrIf} $2 < ${VCREDIST_BLD}
    ${If} ${FileExists} "$INSTDIR\resources\vcredist\vc_redist.x64.exe"
      DetailPrint "Installing the Microsoft Visual C++ runtime (needed by the database)..."
      ExecWait '"$INSTDIR\resources\vcredist\vc_redist.x64.exe" /install /quiet /norestart' $1
      DetailPrint "Visual C++ runtime installer finished with code $1"
      ${If} $1 != 0
      ${AndIf} $1 != 3010
      ${AndIf} $1 != 1638
        ${IfNot} ${Silent}
          MessageBox MB_OK|MB_ICONEXCLAMATION "The Microsoft Visual C++ runtime could not be installed (code $1). TexaCore ERP's database may not start. Install 'Microsoft Visual C++ Redistributable 2015-2022 (x64)' from microsoft.com and start TexaCore ERP again."
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${Else}
    DetailPrint "Microsoft Visual C++ runtime already installed (build $2) - skipped"
  ${EndIf}
!macroend
