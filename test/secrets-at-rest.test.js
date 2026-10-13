'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const s = require('../src/secrets');
const v = require('../src/secrets-vault');
const { mkdtemp } = require('./helpers');

// a stand-in for Electron's safeStorage: reversible, not plaintext
const fakeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (t) => Buffer.from(Buffer.from(t, 'utf8').map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from(b).map((x) => x ^ 0x5a).toString('utf8'),
});
const vault = (write = true, available = true) => v.createVault({ safeStorage: fakeStorage(available), policy: { write, reason: 't' } });

test('a new install with a writable vault keeps its secrets ONLY in secrets.enc, unreadable as text, and reopens them identically', () => {
  const d = mkdtemp('sec-');
  const a = s.getOrCreateSecrets(d, vault());
  assert.equal(a.created, true); assert.equal(a.atRest, 'safeStorage');
  assert.ok(fs.existsSync(path.join(d, 'secrets.enc')) && !fs.existsSync(path.join(d, 'secrets.json')));
  const raw = fs.readFileSync(path.join(d, 'secrets.enc'), 'utf8');
  for (const secret of [a.jwtSecret, a.dbPassword, a.localApiSecret, a.serviceKey]) assert.ok(!raw.includes(secret));
  assert.equal(fs.statSync(path.join(d, 'secrets.enc')).mode & 0o777, 0o600);
  const b = s.getOrCreateSecrets(d, vault());
  assert.equal(b.created, false); assert.equal(b.jwtSecret, a.jwtSecret); assert.equal(b.localApiSecret, a.localApiSecret);
});

test('migration: a plain secrets.json (written by this or an earlier 2.0 build) moves into secrets.enc, the plain file is gone, the values are the same', () => {
  const d = mkdtemp('sec-');
  const plain = s.getOrCreateSecrets(d, null);               // no vault → the 0600 file, as before
  assert.equal(plain.atRest, 'file'); assert.ok(fs.existsSync(path.join(d, 'secrets.json')));
  const m = s.getOrCreateSecrets(d, vault());
  assert.equal(m.migrated, true); assert.equal(m.atRest, 'safeStorage'); assert.equal(m.created, false);
  assert.equal(m.jwtSecret, plain.jwtSecret); assert.equal(m.dbPassword, plain.dbPassword); assert.equal(m.localApiSecret, plain.localApiSecret);
  assert.ok(!fs.existsSync(path.join(d, 'secrets.json')) && fs.existsSync(path.join(d, 'secrets.enc')));
});

test('a vault that cannot write (policy off / keychain unavailable) leaves the 0600 file exactly as it was', () => {
  for (const vlt of [null, vault(false), vault(true, false)]) {
    const d = mkdtemp('sec-');
    const a = s.getOrCreateSecrets(d, vlt);
    assert.equal(a.atRest, 'file');
    const b = s.getOrCreateSecrets(d, vlt);
    assert.equal(b.jwtSecret, a.jwtSecret); assert.ok(!fs.existsSync(path.join(d, 'secrets.enc')));
  }
});

test('a failed migration keeps the plain file (no data loss)', () => {
  const d = mkdtemp('sec-');
  const plain = s.getOrCreateSecrets(d, null);
  const broken = v.createVault({ safeStorage: { ...fakeStorage(), encryptString: () => { throw new Error('keychain denied'); } }, policy: { write: true } });
  const r = s.getOrCreateSecrets(d, broken);
  assert.equal(r.atRest, 'file'); assert.equal(r.jwtSecret, plain.jwtSecret);
  assert.ok(fs.existsSync(path.join(d, 'secrets.json')) && !fs.existsSync(path.join(d, 'secrets.enc')));
});

test('an encrypted file that cannot be opened is an ERROR — never new secrets, never a deleted file', () => {
  const d = mkdtemp('sec-');
  s.getOrCreateSecrets(d, vault());
  const enc = path.join(d, 'secrets.enc');
  const before = fs.readFileSync(enc);
  assert.throws(() => s.getOrCreateSecrets(d, null), (e) => e.code === 'SECRETS_UNAVAILABLE');                 // no keychain at all
  assert.throws(() => s.getOrCreateSecrets(d, vault(true, false)), (e) => e.code === 'SECRETS_UNAVAILABLE');   // keychain locked / unavailable
  assert.throws(() => s.getOrCreateSecrets(d, v.createVault({ safeStorage: { ...fakeStorage(), decryptString: () => { throw new Error('user denied'); } }, policy: { write: true } })), /could not be unlocked/);
  fs.writeFileSync(enc, 'garbage'); const damaged = fs.readFileSync(enc);
  assert.throws(() => s.getOrCreateSecrets(d, vault()), /could not be unlocked/);
  assert.ok(fs.readFileSync(enc).equals(damaged) && damaged.length === 7, 'the damaged file was left alone');
  assert.ok(!fs.existsSync(path.join(d, 'secrets.json')));
  assert.ok(before.length > 100);
});

test('policy: macOS auto = only a stable signature; ad-hoc stays on the file; Windows off by default; harness overrides only inside isolated runs', () => {
  const cfg = { darwin: 'auto', win32: 'off' };
  assert.equal(v.secretsAtRestPolicy({ platform: 'darwin', config: cfg, macStable: false }).write, false);
  assert.equal(v.secretsAtRestPolicy({ platform: 'darwin', config: cfg, macStable: true }).write, true);
  assert.equal(v.secretsAtRestPolicy({ platform: 'win32', config: cfg }).write, false);
  assert.equal(v.secretsAtRestPolicy({ platform: 'win32', config: { win32: 'on' } }).write, true);
  assert.equal(v.secretsAtRestPolicy({ platform: 'linux', config: cfg }).write, false);
  assert.equal(v.secretsAtRestPolicy({ platform: 'darwin', config: cfg, macStable: false, harnessOk: true, env: { TEXACORE_SECRETS_AT_REST: 'mock' } }).mock, true);
  assert.equal(v.secretsAtRestPolicy({ platform: 'darwin', config: cfg, macStable: true, harnessOk: true, env: { TEXACORE_SECRETS_AT_REST: '0' } }).write, false);
  assert.equal(v.secretsAtRestPolicy({ platform: 'darwin', config: cfg, macStable: false, harnessOk: false, env: { TEXACORE_SECRETS_AT_REST: '1' } }).write, false, 'an ordinary install ignores the variable');
});

test('macOS signature detection: ad-hoc and unsigned are unstable; a Developer ID / team identifier is stable', () => {
  const run = (text, status = 0) => () => ({ status, stderr: text, stdout: '' });
  const exe = '/Applications/TexaCore ERP.app/Contents/MacOS/TexaCore ERP';
  assert.equal(v.macSignatureIsStable(exe, run('Signature=adhoc\nTeamIdentifier=not set')), false);
  assert.equal(v.macSignatureIsStable(exe, run('code object is not signed at all', 1)), false);
  assert.equal(v.macSignatureIsStable(exe, run('Authority=Developer ID Application: X (ABCDE12345)\nTeamIdentifier=ABCDE12345')), true);
  assert.equal(v.macSignatureIsStable('/usr/local/bin/node', run('Authority=Developer ID Application: X')), false, 'not inside an .app');
  assert.equal(v.macSignatureIsStable(exe, () => { throw new Error('codesign missing'); }), false);
});
