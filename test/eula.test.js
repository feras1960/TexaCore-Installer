'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { build, CLAUSE_EN, CLAUSE_AR, rtfEscape } = require('../scripts/make-eula');

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
