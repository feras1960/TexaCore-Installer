'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAdminPassword: v, adminPasswordProblem: prob, defaultAdminPasswordFor: def, MIN_LENGTH } = require('../src/admin-password');

test('rejects short, "admin", license-like and the license key itself', () => {
  assert.ok(v('abc1234'));                      // 7 chars
  assert.ok(v('admin'));
  assert.ok(v('ADMIN'));
  assert.ok(v(' Admin '));
  assert.ok(v('TRL-2026-ABCD1234'));
  assert.ok(v('FREE-2026-12345'));
  assert.ok(v('XXXX-YYYY-ZZZZ'));
  assert.ok(v('MyKey9999', { licenseKey: 'mykey9999' }));
});

test('accepts an ordinary strong password', () => {
  assert.equal(v('correct horse battery'), null);
  assert.equal(v('E2ePass#2026'), null);
  assert.equal(v('12345678'), null);            // length is the policy floor; shape rules above are the only others
});

test('the policy is 8 characters, and the problem codes the windows translate are stable', () => {
  assert.equal(MIN_LENGTH, 8);
  assert.equal(prob('1234567'), 'short');
  assert.equal(prob('admin'), 'admin');
  assert.equal(prob('MyKey9999', { licenseKey: 'mykey9999' }), 'is_key');
  assert.equal(prob('TRL-2026-ABCD1234'), 'key_like');
  assert.equal(prob('Correct#Horse9'), null);
  assert.equal(v('1234567'), 'كلمة المرور قصيرة جداً (8 أحرف على الأقل)');     // the Arabic text names the real minimum
});

test('default password: a paid/trial key only; a FREE key (or none) gives no default', () => {
  assert.equal(def('TRL-2026-CGWGJ-W2FSX'), 'TRL-2026-CGWGJ-W2FSX');
  assert.equal(def('PRO-2026-ABCDE'), 'PRO-2026-ABCDE');
  assert.equal(def('FREE-LOCAL'), null);
  assert.equal(def('FREE-2026-12345'), null);
  assert.equal(def('free-2026-12345'), null);
  assert.equal(def(''), null); assert.equal(def(undefined), null);
});
