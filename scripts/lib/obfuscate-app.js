'use strict';
// ════════════════════════════════════════════════════════════════
// obfuscate-app — build-time hardening of the PACKAGED Electron main-process / preload / service code (afterPack). The sources in git stay readable;
// only the copy inside the package is transformed, in place, before the app is signed and put into the dmg/zip/exe.
//
// javascript-obfuscator, pure JS, so the same output is produced on macOS for both platforms (no per-platform bytecode — that is bytenode,
// the next step). Settings are deliberately LIGHT where they cost start-up time or risk behaviour:
//   on : identifier mangling (incl. module-level names — every file is a CommonJS module), string array with RC4 encoding, rotation, shuffle
//        and index shift (every string literal AND template literal, so SQL/paths/messages are not readable), light dead-code injection
//   off: control-flow flattening, self-defending, debug protection, console stripping (the logs the support team reads must stay), property
//        renaming and object-key transforms (IPC channel/handler names and JSON shapes must keep working)
// The browser-side files of the installer window (renderer.js, i18n.js) are NOT touched: index.html calls their globals from inline handlers.
// A manifest of the ORIGINAL sources' sha256 goes into the package, so a verifier can prove which sources an obfuscated build was made from.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SKIP = new Set(['renderer.js', 'i18n.js']);
const OPTIONS = {
  target: 'node',
  compact: true,
  simplify: true,
  identifierNamesGenerator: 'mangled',
  renameGlobals: true,                    // module-level names: safe, every file is a CommonJS module (not for the browser-side files, which are skipped)
  renameProperties: false,
  transformObjectKeys: false,
  stringArray: true,
  stringArrayEncoding: ['rc4'],
  stringArrayThreshold: 1,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayIndexShift: true,
  stringArrayWrappersCount: 2,
  stringArrayWrappersType: 'variable',
  splitStrings: false,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.2,
  controlFlowFlattening: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  numbersToExpressions: false,
  unicodeEscapeSequence: false,
  sourceMap: false,
  log: false,
};

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
}

/** Obfuscate every main-process .js under <appCodeDir>/src in place. Returns { files, before, after, manifest }. */
function obfuscateAppCode(appCodeDir, { log = () => {} } = {}) {
  const JavaScriptObfuscator = require('javascript-obfuscator');
  const srcDir = path.join(appCodeDir, 'src');
  const manifest = {};
  let before = 0; let after = 0; let files = 0;
  for (const f of walk(srcDir)) {
    const rel = path.relative(srcDir, f).split(path.sep).join('/');
    const buf = fs.readFileSync(f);
    manifest[rel] = sha256(buf);
    if (!f.endsWith('.js') || SKIP.has(path.basename(f))) continue;
    const out = JavaScriptObfuscator.obfuscate(buf.toString('utf8'), OPTIONS).getObfuscatedCode();
    // it must still COMPILE as a CommonJS module before it replaces the original
    const body = out.startsWith('#!') ? out.slice(out.indexOf('\n') + 1) : out;                     // a CLI script keeps its hashbang line
    new vm.Script(`(function (exports, require, module, __filename, __dirname) {${body}\n})`, { filename: rel });
    fs.writeFileSync(f, out);
    before += buf.length; after += out.length; files += 1;
  }
  fs.writeFileSync(path.join(appCodeDir, 'src-manifest.json'), JSON.stringify({ obfuscated: true, tool: 'javascript-obfuscator', files: manifest }, null, 2) + '\n');
  log(`obfuscated ${files} files (${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB)`);
  return { files, before, after, manifest };
}

module.exports = { obfuscateAppCode, OPTIONS, SKIP };
