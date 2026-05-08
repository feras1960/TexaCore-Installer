/**
 * electron-builder afterPack hook
 * Ensures all transitive dependencies are present in the built app.
 * Fixes: "Cannot find module 'call-bind-apply-helpers'" on Windows/Mac
 */
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  const appDir = path.join(context.appOutDir, 'resources', 'app', 'node_modules');
  const srcModules = path.join(__dirname, '..', 'node_modules');

  // Modules that electron-builder's npm install sometimes misses
  const requiredModules = [
    'call-bind-apply-helpers',
    'es-errors',
    'gopd',
    'es-define-property',
    'math-intrinsics',
    'hasown',
    'function-bind',
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
