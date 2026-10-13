'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PINNED, peFacts, verifyRedist } = require('../scripts/prepare-vcredist');

test('the pin is the file the owner downloaded (when it is on this machine) and nothing else passes', () => {
  assert.equal(PINNED.sha256, 'cc0ff0eb1dc3f5188ae6300faef32bf5beeba4bdd6e8e445a9184072096b713b');
  assert.equal(PINNED.bytes, 25635768);
  const f = '/Users/firas/Desktop/TexaCore_Dev_Core.nosync/downloads/vc_redist.x64.exe';
  if (fs.existsSync(f)) {
    const buf = fs.readFileSync(f);
    assert.deepEqual(verifyRedist(buf), []);
    assert.equal(peFacts(buf).version, PINNED.version);
    const flipped = Buffer.from(buf); flipped[1000] ^= 1;
    assert.match(verifyRedist(flipped).join(), /sha256/);
  }
  assert.match(verifyRedist(Buffer.from('MZ not the file')).join(), /size|sha256|PE/);
  assert.match(verifyRedist(Buffer.alloc(PINNED.bytes)).join(), /sha256|not a PE/);
});

test('installer.nsh: silent, version-aware, tolerant of 3010/1638, skipped when installed; the version header is generated and git-ignored', () => {
  const nsh = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.nsh'), 'utf8');
  assert.match(nsh, /\/install \/quiet \/norestart/);
  assert.match(nsh, /Runtimes\\x64" "Installed"/); assert.match(nsh, /"Bld"/);
  assert.match(nsh, /\$\{OrIf\} \$2 < \$\{VCREDIST_BLD\}/);
  assert.match(nsh, /3010/); assert.match(nsh, /1638/);
  assert.match(nsh, /already installed[^\n]*skipped/);
  assert.match(nsh, /!include \/NONFATAL/);
  const gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(gi, /build\/vcredist\/\*\.exe/); assert.match(gi, /build\/vcredist\/\*\.nsh/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'), /"from": "build\/vcredist"/);
});
