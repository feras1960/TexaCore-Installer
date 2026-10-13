'use strict';
// ServiceManager.setAdminPassword / syncAdminPassword with the DB and config faked (no Electron needed: the class only touches `electron` in its constructor).
const test = require('node:test');
const assert = require('node:assert/strict');
const ServiceManager = require('../src/service-manager');

function fake(cfg = {}) {
  const sm = Object.create(ServiceManager.prototype);
  const queries = [];
  let written = null;
  sm._readConfig = () => ({ ...cfg });
  sm._writeConfig = (c) => { written = c; };
  sm._withPgClient = async (fn) => fn({ query: async (text, params) => { queries.push({ text, params }); return { rows: [{ h: '$2a$06$hash' }] }; } });
  return { sm, queries, written: () => written };
}

test('setAdminPassword refuses weak / "admin" / license-like passwords before touching the database', async () => {
  const f = fake({ licenseKey: 'TRL-2026-ABCD1234' });
  for (const bad of ['admin', 'short', 'FREE-2026-12345', 'TRL-2026-ABCD1234', '']) {
    await assert.rejects(f.sm.setAdminPassword(bad));
  }
  assert.equal(f.queries.length, 0);
  assert.equal(f.written(), null);
});

test('setAdminPassword stores a bcrypt hash (config + DB), clears the lockout, and keeps the plaintext out of SQL text', async () => {
  const f = fake({ licenseKey: 'TRL-2026-ABCD1234' });
  assert.equal(await f.sm.setAdminPassword('correct horse battery'), true);
  assert.equal(f.written().adminPasswordHash, '$2a$06$hash');
  const [hashQ, upsert] = f.queries;
  assert.match(hashQ.text, /extensions\.crypt\(\$1, extensions\.gen_salt\('bf'\)\)/);
  assert.deepEqual(hashQ.params, ['correct horse battery']);
  assert.match(upsert.text, /failed_attempts = 0, locked_until = NULL/);
  assert.ok(!f.queries.some((q) => q.text.includes('correct horse')));
});

test('syncAdminPassword: custom hash wins; else the license key; with neither the portal is LOCKED (no "admin" fallback)', async () => {
  let f = fake({ adminPasswordHash: '$2a$06$custom', licenseKey: 'K' });
  await f.sm.syncAdminPassword();
  assert.deepEqual(f.queries[0].params, ['$2a$06$custom']);

  f = fake({ licenseKey: 'FREE-LOCAL' });
  await f.sm.syncAdminPassword();
  assert.match(f.queries[0].text, /extensions\.crypt\(\$1, extensions\.gen_salt\('bf'\)\)/);
  assert.deepEqual(f.queries[0].params, ['FREE-LOCAL']);

  f = fake({});
  await f.sm.syncAdminPassword();
  assert.match(f.queries[0].text, /VALUES \(1, NULL, now\(\)\)/);
  assert.equal(f.queries[0].params, undefined);
  assert.ok(!f.queries.some((q) => /'admin'/.test(q.text) || (q.params || []).includes('admin')));
});
