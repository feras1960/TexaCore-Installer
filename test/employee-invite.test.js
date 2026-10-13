'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const p = require('../src/provisioning');

const U = '8f1b5d3e-1c2a-4b7e-9d0a-6f3b2c1d4e5f';

test('one-time passwords: 3 groups of 4 unambiguous characters, different every time', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const pw = p.generateOneTimePassword();
    assert.match(pw, /^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
    seen.add(pw);
  }
  assert.equal(seen.size, 200);
});

test('employee input: company and role must be uuids, a valid e-mail and a name are required', () => {
  assert.equal(p.normaliseEmployeeInput({ companyId: U, roleId: U, email: ' Staff@Example.COM ', fullName: ' Staff ' }).value.email, 'staff@example.com');
  for (const bad of [{}, { companyId: U, roleId: U, email: 'nope', fullName: 'x' }, { companyId: 'x', roleId: U, email: 'a@b.co', fullName: 'x' },
    { companyId: U, roleId: "x'; drop", email: 'a@b.co', fullName: 'x' }, { companyId: U, roleId: U, email: 'a@b.co', fullName: '  ' }]) {
    assert.equal(p.normaliseEmployeeInput(bad).ok, false);
  }
});

test('the invite code never logs the one-time password and never reads the service key from the request', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'provisioning.js'), 'utf8');
  const i = src.indexOf('async function inviteLocalEmployee');
  const body = src.slice(i, src.indexOf('module.exports', i));
  for (const m of body.matchAll(/log\(([^;]*)\);/g)) assert.doesNotMatch(m[1], /password|otp/i, `a log line mentions the password: ${m[0]}`);
  assert.doesNotMatch(body, /rawInput\.(serviceKey|gotrueUrl|restUrl)/);
});

test('inviteLocalEmployee refuses bad input without touching anything', async () => {
  const deps = { connect: async () => { throw new Error('must not connect'); }, log: () => {} };
  const r = await p.inviteLocalEmployee(deps, { companyId: 'x' });
  assert.equal(r.success, false); assert.equal(r.code, 'BAD_REQUEST');
});
