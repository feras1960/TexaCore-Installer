'use strict';
// The licence row of the launcher: a licence without an end date (the free local plan) must say it never expires, in every language — never «-- (0 days)».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = { window: {}, document: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n.js'), 'utf8') + '\n;this.__I18N = I18N;', ctx);
const I18N = ctx.__I18N;

test('every language words «never expires» (no digits, not the expiry prefix)', () => {
  for (const lang of ['ar', 'en', 'ru', 'uk']) {
    const v = I18N[lang]['license.neverExpires'];
    assert.ok(v && v.trim(), `${lang} license.neverExpires`);
    assert.ok(!/\d/.test(v), `${lang}: ${v}`);
    assert.notEqual(v, I18N[lang]['license.expiresPrefix']);
  }
  assert.equal(I18N.ar['license.neverExpires'], 'دائمة');
  assert.equal(I18N.en['license.neverExpires'], 'Never expires');
});

test('the renderer shows it for a licence without expires_at and keeps the date + days left for one with an end date', () => {
  const r = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const i = r.indexOf('function renderLicense(state)');
  assert.ok(i > 0, 'no licence renderer');
  const block = r.slice(i, r.indexOf('// kept under its old name', i));
  // a licence with no end date (free local plan / open licence) says «never expires», no date and no bar
  assert.match(block, /lv\.kind === 'free' \|\| lv\.kind === 'paid-open'/);
  assert.match(block, /license\.neverExpires/);
  assert.match(block, /meter\.style\.display = 'none'/);
  // one with an end date shows the days left, the end date and the bar
  assert.match(block, /ui\.license\.daysLeft/);
  assert.match(block, /ui\.license\.ends/);
  assert.match(block, /license-meter|meter\.style\.display = 'block'/);
});

test('the support card has the licence key as the support code, the build date and the version (no stale footer)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
  for (const id of ['support-code', 'btn-copy-key', 'info-version', 'build-date', 'input-port']) assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, id);
  assert.doesNotMatch(html, /class="footer"/);
  const r = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  assert.doesNotMatch(r, /Build: \$\{/, 'the old footer wording is gone');
  assert.match(r, /\$\('build-date'\)\.textContent = bd\.toISOString\(\)\.slice\(0, 10\)/);
});
