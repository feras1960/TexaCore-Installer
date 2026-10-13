Visual C++ 2015-2022 x64 Redistributable (vc_redist.x64.exe) goes here for the Windows build.
PostgreSQL's Windows build (EnterpriseDB) imports VCRUNTIME140.dll / MSVCP140.dll, which a clean Windows PC may not have.
When vc_redist.x64.exe is present, the installer (build/installer.nsh) runs it silently if the runtime is missing.
Get it: node scripts/prepare-vcredist.js <path to the downloaded vc_redist.x64.exe>   (source: https://aka.ms/vs/17/release/vc_redist.x64.exe)
The .exe itself is never committed.
