'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAdminPassword: v } = require('../src/admin-password');

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
