'use strict';
// The launcher's password text must match the enforced policy: no hard-coded "4" anywhere, every language words the real minimum from {n}.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MIN_LENGTH } = require('../src/admin-password');

const ctx = { window: {}, document: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n.js'), 'utf8') + '\n;this.__I18N = I18N;', ctx);
const I18N = ctx.__I18N;

test('every language: placeholder / too-short / status texts use {n} (the policy minimum), never a fixed number, and the codes the main process returns all have a text', () => {
  for (const lang of ['ar', 'en', 'ru', 'uk']) {
    const d = I18N[lang];
    for (const k of ['admin.placeholder', 'admin.tooShort', 'admin.err.short', 'admin.statusNone', 'admin.statusDefault']) {
      assert.ok(d[k], `${lang} ${k}`);
      assert.match(d[k], /\{n\}/, `${lang} ${k} must take the minimum from {n}`);
      assert.ok(!/(^|[^0-9])4([^0-9]|$)/.test(d[k].replace('{n}', String(MIN_LENGTH))), `${lang} ${k} still mentions 4: ${d[k]}`);
    }
    for (const code of ['admin', 'short', 'is_key', 'key_like']) assert.ok(d['admin.err.' + code], `${lang} admin.err.${code}`);
    assert.ok(d['admin.desc'] && d['admin.statusNone'], `${lang} texts`);
  }
});

test('the renderer takes the minimum from the main process (no literal 4 in the length check)', () => {
  const r = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  assert.ok(!/val\.length\s*<\s*4/.test(r), 'renderer still checks length < 4');
  assert.match(r, /val\.length\s*<\s*n\b/);
  assert.match(r, /minLength/);
});
