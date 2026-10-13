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
  const i = r.indexOf('if (!li.expires_at) {');
  assert.ok(i > 0, 'no branch for a licence without an end date');
  const block = r.slice(i, i + 700);
  assert.match(block, /license\.neverExpires/);
  assert.match(block, /license\.expiresPrefix/);
  assert.match(block, /common\.daysUnit/);
});
