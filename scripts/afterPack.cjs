/**
 * electron-builder afterPack hook
 * Ensures all transitive dependencies are present in the built app.
 * Fixes: "Cannot find module 'call-bind-apply-helpers'" on Windows/Mac
 */
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  const srcModules = path.join(__dirname, '..', 'node_modules');

  // Determine the correct node_modules path based on platform
  let appDir;
  if (context.electronPlatformName === 'darwin') {
    // macOS: dist/mac-arm64/TexaCore ERP.app/Contents/Resources/app/node_modules
    const appName = context.packager.appInfo.productFilename + '.app';
    appDir = path.join(context.appOutDir, appName, 'Contents', 'Resources', 'app', 'node_modules');
  } else {
    // Windows/Linux: dist/win-unpacked/resources/app/node_modules
    appDir = path.join(context.appOutDir, 'resources', 'app', 'node_modules');
  }

  console.log(`  • afterPack: target node_modules path: ${appDir}`);

  // Modules that electron-builder's npm install sometimes misses
  const requiredModules = [
    'call-bind-apply-helpers',
    'call-bound',
    'es-errors',
    'gopd',
    'es-define-property',
    'math-intrinsics',
    'hasown',
    'function-bind',
    'side-channel-list',
    'side-channel-weakmap',
  ];

  for (const mod of requiredModules) {
    const dest = path.join(appDir, mod);
    const src = path.join(srcModules, mod);
    if (!fs.existsSync(dest) && fs.existsSync(src)) {
      console.log(`  • afterPack: copying missing module ${mod}`);
      fs.cpSync(src, dest, { recursive: true });
    }
  }
};
