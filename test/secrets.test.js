'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../src/secrets');
const { mkdtemp } = require('./helpers');

test('a fresh install gets unique random secrets; a second read returns the same ones', () => {
  const a = s.getOrCreateSecrets(mkdtemp());
  const b = s.getOrCreateSecrets(mkdtemp());
  assert.notEqual(a.jwtSecret, b.jwtSecret);
  assert.notEqual(a.dbPassword, b.dbPassword);
  const d = mkdtemp();
  const x = s.getOrCreateSecrets(d);
  const y = s.getOrCreateSecrets(d);
  assert.equal(x.created, true);
  assert.equal(y.created, false);
  assert.equal(x.jwtSecret, y.jwtSecret);
  assert.ok(x.jwtSecret.length >= 48);
});

test('an existing provisioned-looking dir does NOT get the shared 1.x secrets any more', () => {
  const d = mkdtemp();
  fs.mkdirSync(path.join(d, 'pgdata'), { recursive: true });
  fs.writeFileSync(path.join(d, 'pgdata', 'PG_VERSION'), '17\n');
  const x = s.getOrCreateSecrets(d);
  assert.notEqual(x.jwtSecret, s.LEGACY.jwtSecret);
  assert.equal(s.isLegacySecrets(x), false);
});

test('a secrets file holding the legacy values is replaced, never used', () => {
  const d = mkdtemp();
  fs.writeFileSync(path.join(d, 'secrets.json'), JSON.stringify({ ...s.LEGACY, legacy: true }));
  const x = s.getOrCreateSecrets(d);
  assert.equal(x.created, true);
  assert.equal(s.isLegacySecrets(x), false);
});

test('keys are HS256 JWTs signed with the install secret and carry the right roles', () => {
  const x = s.getOrCreateSecrets(mkdtemp());
  const crypto = require('crypto');
  for (const [key, role] of [[x.anonKey, 'anon'], [x.serviceKey, 'service_role']]) {
    const [h, p, sig] = key.split('.');
    const want = crypto.createHmac('sha256', x.jwtSecret).update(`${h}.${p}`).digest('base64url');
    assert.equal(sig, want);
    assert.equal(JSON.parse(Buffer.from(p, 'base64url').toString()).role, role);
  }
});
