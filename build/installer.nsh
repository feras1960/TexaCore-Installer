; TexaCore ERP — extra NSIS steps (electron-builder: nsis.include)
;
; PostgreSQL for Windows (EnterpriseDB build) imports VCRUNTIME140.dll / MSVCP140.dll. A clean Windows PC may not have the
; "Visual C++ 2015-2022 x64 Redistributable"; without it postgres.exe cannot start. If the redistributable is bundled
; ($INSTDIR\resources\vcredist\vc_redist.x64.exe) and the runtime is not installed, install it silently. Nothing happens
; when it is already installed or when it was not bundled.
!macro customInstall
  SetRegView 64
  ReadRegDWORD $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  ${If} $0 != 1
    ${If} ${FileExists} "$INSTDIR\resources\vcredist\vc_redist.x64.exe"
      DetailPrint "Installing the Microsoft Visual C++ runtime..."
      ExecWait '"$INSTDIR\resources\vcredist\vc_redist.x64.exe" /install /quiet /norestart' $1
      DetailPrint "Visual C++ runtime installer finished with code $1"
    ${EndIf}
  ${EndIf}
!macroend
