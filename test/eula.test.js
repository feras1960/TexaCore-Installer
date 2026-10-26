'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { build, CLAUSE_EN, CLAUSE_AR, rtfEscape, forMacArabic } = require('../scripts/make-eula');

const B = path.join(__dirname, '..', 'build');
const pkg = require('../package.json');

test('the committed licence files are what the generator makes from the two source texts, and carry the mandated clauses verbatim', () => {
  const before = ['license_en.txt', 'license_ar.txt', 'eula.rtf'].map((f) => fs.readFileSync(path.join(B, f), 'utf8'));
  build();
  const after = ['license_en.txt', 'license_ar.txt', 'eula.rtf'].map((f) => fs.readFileSync(path.join(B, f), 'utf8'));
  assert.deepEqual(after, before, 'run `node scripts/make-eula.js` and commit');
  assert.ok(after[0].includes(CLAUSE_EN)); assert.ok(after[1].includes(CLAUSE_AR));
  assert.equal(CLAUSE_EN, 'You may not decompile, disassemble or reverse engineer the software or any part of it, extract its code, database structure or logic, or copy, modify, redistribute or use it to build a competing product, except to the extent expressly permitted by applicable law.');
  assert.ok(CLAUSE_AR.startsWith('لا يجوز فكّ البرنامج أو تفكيكه أو عكس هندسته') && CLAUSE_AR.endsWith('إلا بالقدر الذي يسمح به القانون صراحةً.'));
});

test('the Windows installer is the assisted kind (one-click installers have no licence page) and points at the RTF; the dmg picks up license_en/ar.txt from build/', () => {
  assert.equal(pkg.build.nsis.oneClick, false);
  assert.equal(pkg.build.nsis.license, 'build/eula.rtf');
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, false);
  for (const f of ['license_en.txt', 'license_ar.txt', 'eula.rtf']) assert.ok(fs.existsSync(path.join(B, f)), f);
});

test('RTF escaping keeps Arabic as \\u escapes and braces/backslashes safe', () => {
  assert.equal(rtfEscape('a{b}\\c'), 'a\\{b\\}\\\\c');
  assert.match(rtfEscape('لا'), /^\\u-?\d+\?\\u-?\d+\?$/);
});

test('the licence text carries legal version 2026-10-27 in English and Arabic (the website legal centre\'s version and date), with no placeholder left, in the dmg texts and the NSIS rtf source', () => {
  const read = (f) => fs.readFileSync(path.join(B, f), 'utf8');
  for (const f of ['eula/eula.en.txt', 'license_en.txt']) assert.match(read(f).split('\n')[2], /^Version 2026-10-27 · Effective 27 October 2026$/, f);
  for (const f of ['eula/eula.ar.txt', 'license_ar.txt']) {
    const line = read(f).split('\n')[2];
    assert.ok(line.includes('2026-10-27') && line.includes('27 أكتوبر 2026'), `${f}: ${line}`);
  }
  for (const f of ['eula/eula.en.txt', 'eula/eula.ar.txt', 'license_en.txt', 'license_ar.txt', 'eula.rtf']) assert.ok(!/\{\{|2026-10-20/.test(read(f)), `${f}: placeholder or the previous version is still there`);
  assert.match(read('eula.rtf'), /Version 2026-10-27/);
});

test('the dmg licence screens can be built: the Arabic text has nothing the Mac Arabic charset lacks (no bidi isolates, no middle dot), the English text fits Mac Roman - the build failed on this once (dmg-license: «Cannot encode Arabic license text»)', () => {
  const ar = fs.readFileSync(path.join(B, 'license_ar.txt'), 'utf8');
  assert.ok(!/[\u2066-\u2069]/.test(ar) && !ar.includes('\u00b7'), 'license_ar.txt still has isolates or a middle dot');
  assert.equal(forMacArabic('الإصدار \u20662026-10-27\u2069 \u00b7 سارية'), 'الإصدار 2026-10-27، سارية');
  assert.ok(fs.readFileSync(path.join(B, 'eula', 'eula.ar.txt'), 'utf8').includes('\u2066'), 'the source text (the website\'s) keeps its isolates for the Windows rtf');
  let transcode = null;
  try { ({ transcode } = require('iconv-corefoundation')); } catch { /* not macOS: the CoreFoundation converter is the one dmg-license uses */ }
  if (transcode) {
    transcode(Buffer.from(ar, 'utf8'), 'UTF-8', 'x-mac-arabic');
    transcode(Buffer.from(fs.readFileSync(path.join(B, 'license_en.txt'), 'utf8'), 'utf8'), 'UTF-8', 'x-mac-roman');
  }
});
