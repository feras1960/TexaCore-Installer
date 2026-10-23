#!/usr/bin/env node
'use strict';
// stamp-build-date — «تاريخ البناء» in the launcher's support card is the date THIS build was made.
// package.json carried a hand-edited `buildDate` ("2026-10-17" in the 2.0.5 RC1 package, which was built on 2026-10-22/23); every build / publish script now runs this first, so
// the date inside the package is the date of the build, never a stale one.
//   node scripts/stamp-build-date.js [--file <package.json>] [--date <ISO timestamp>]
const fs = require('fs');
const path = require('path');

function stamp(file, date) {
  const iso = new Date(date).toISOString();
  const text = fs.readFileSync(file, 'utf8');
  if (!/"buildDate":\s*"[^"]*"/.test(text)) throw new Error('package.json has no buildDate field');
  const next = text.replace(/("buildDate":\s*")[^"]*(")/, `$1${iso}$2`);
  fs.writeFileSync(file, next);
  return iso;
}

if (require.main === module) {
  const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
  const file = arg('file', path.join(__dirname, '..', 'package.json'));
  const iso = stamp(file, arg('date', '') || new Date());
  console.log(`[stamp-build-date] ${path.basename(file)} buildDate = ${iso}`);
}
module.exports = { stamp };
