'use strict';
// The build date shown in the launcher is stamped into package.json by every build / publish script (never a hand-edited, stale value).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stamp } = require('../scripts/stamp-build-date');

test('stamp rewrites only buildDate, with an ISO timestamp', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-'));
  const f = path.join(dir, 'package.json');
  fs.writeFileSync(f, '{\n  "name": "x",\n  "version": "2.0.5",\n  "buildDate": "2026-10-17",\n  "main": "src/main.js"\n}\n');
  const iso = stamp(f, '2026-10-24T09:12:00Z');
  assert.equal(iso, '2026-10-24T09:12:00.000Z');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.equal(j.buildDate, '2026-10-24T09:12:00.000Z');
  assert.equal(j.version, '2.0.5');
  assert.equal(j.main, 'src/main.js');
  fs.writeFileSync(f, '{"name":"x"}');
  assert.throws(() => stamp(f, Date.now()), /no buildDate/);
});

test('every build and publish script stamps first; the launcher shows the stamped date', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  for (const name of ['build:mac', 'build:win', 'build:all', 'publish:mac', 'publish:win', 'publish']) {
    assert.match(pkg.scripts[name], /^node scripts\/stamp-build-date\.js && /, name);
  }
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /buildDate: pkg\.buildDate \|\| 'unknown'/);
});
