'use strict';
// 2.0.5 — company files, the safe part. The pure rules of src/live-file-policy.js:
//   1. REPLACE-ALL NEEDS AN EXPLICIT YES (only `true` / "true" / "1" count; an unreadable database is not an empty one);
//   2. THE LIVE FILE NEVER CHANGES OWNER BY ITSELF (a company created next to others only RECORDS its chosen file);
//   3. the pre-open backup file name / pruning.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mkdtemp } = require('./helpers');
const P = require('../src/live-file-policy');

const two = [{ id: 'c1', name: '2023 مطور بعد الصيانة' }, { id: 'c2', name: 'Demo' }];

test('only an explicit yes is a yes', () => {
  for (const v of [true, 'true', '1', 1]) assert.equal(P.isConfirmed(v), true, String(v));
  for (const v of [false, 'false', '0', 0, 'yes', 'on', 'TRUE', ' true', 2, null, undefined, {}, [], [true]]) assert.equal(P.isConfirmed(v), false, JSON.stringify(v));
});

test('an empty database needs no confirmation; companies do; an unreadable database counts as "has companies"', () => {
  assert.equal(P.needsReplaceAllConfirmation({ companies: [] }), false);
  assert.equal(P.needsReplaceAllConfirmation({ companies: two }), true);
  assert.equal(P.needsReplaceAllConfirmation({ companies: null }), true);
  assert.equal(P.needsReplaceAllConfirmation(null), true);
  assert.equal(P.needsReplaceAllConfirmation(undefined), true);
});

test('requireReplaceAllConfirmation: refuses with the coded error, the list and the sessions - unless the request says yes', () => {
  const snap = { companies: two, sessions: 3, users: 2, liveFile: '/x/live.tcdb' };
  assert.throws(() => P.requireReplaceAllConfirmation({ confirmReplaceAll: undefined, snapshot: snap }), (e) => {
    assert.equal(e.code, 'REPLACE_ALL_CONFIRM_REQUIRED');
    assert.deepEqual(e.replaceAll.companies, two);
    assert.equal(e.replaceAll.sessions, 3);
    assert.equal(e.replaceAll.users, 2);
    assert.equal(e.replaceAll.liveFile, '/x/live.tcdb');
    assert.equal(e.replaceAll.backupFirst, true);
    // the owner's sentence, word for word, plus its English twin; the old client reads a clear error
    assert.ok(e.message.includes('فتح هذا الملف سيستبدل كل الشركات الحالية على هذا الجهاز لكل المستخدمين. نسخة احتياطية تُحفظ أولاً.'));
    assert.match(e.message, /Opening this file will replace ALL current companies on this computer/);
    assert.ok(e.message.includes('2023 مطور بعد الصيانة') && e.message.includes('Demo'));
    return true;
  });
  for (const no of [false, 'yes', 'false', 0, null, {}]) {
    assert.throws(() => P.requireReplaceAllConfirmation({ confirmReplaceAll: no, snapshot: snap }), (e) => e.code === 'REPLACE_ALL_CONFIRM_REQUIRED', JSON.stringify(no));
  }
  assert.doesNotThrow(() => P.requireReplaceAllConfirmation({ confirmReplaceAll: true, snapshot: snap }));
  assert.doesNotThrow(() => P.requireReplaceAllConfirmation({ confirmReplaceAll: 'true', snapshot: snap }));
  assert.doesNotThrow(() => P.requireReplaceAllConfirmation({ confirmReplaceAll: undefined, snapshot: { companies: [] } }));
  // an unreadable database: refused too, with `companies: null` so the page says the list could not be read
  assert.throws(() => P.requireReplaceAllConfirmation({ snapshot: { companies: null, sessions: null } }), (e) => e.code === 'REPLACE_ALL_CONFIRM_REQUIRED' && e.replaceAll.companies === null);
});

test('the error never carries more than id + name of a company (the page needs nothing else)', () => {
  const e = P.replaceAllError({ companies: [{ id: 'a', name: 'A', tenant_id: 't', secret: 'x' }], sessions: 0 });
  assert.deepEqual(e.replaceAll.companies, [{ id: 'a', name: 'A' }]);
  assert.equal(e.replaceAll.sessions, 0);
});

test('pre-open backup: the path is inside <data dir>/backups/pre-open, named by the local time, and never a user path', () => {
  const dir = mkdtemp('pre-');
  const p = P.preOpenBackupPath(dir, new Date(2026, 9, 22, 8, 5, 9));
  assert.equal(p, path.join(dir, 'backups', 'pre-open', 'before-open-2026-10-22_080509.tcdb'));
  assert.equal(path.dirname(path.dirname(path.dirname(p))), dir);
});

test('pre-open backup: only the newest 10 before-open files are kept, nothing else in the folder is touched', () => {
  const dir = mkdtemp('prune-');
  const names = [];
  for (let i = 1; i <= 14; i++) names.push(`before-open-2026-10-${String(i).padStart(2, '0')}_101010.tcdb`);
  for (const n of names) fs.writeFileSync(path.join(dir, n), 'x');
  fs.writeFileSync(path.join(dir, 'Company.opened-2026-10-01.tcdb'), 'x');
  fs.writeFileSync(path.join(dir, 'before-open-notes.txt'), 'x');
  const gone = P.prunePreOpenBackups(dir, 10);
  assert.equal(gone.length, 4);
  assert.deepEqual(gone, names.slice(0, 4));
  const left = fs.readdirSync(dir).sort();
  assert.ok(left.includes('Company.opened-2026-10-01.tcdb') && left.includes('before-open-notes.txt'));
  assert.equal(left.filter((n) => /^before-open-/.test(n) && n.endsWith('.tcdb')).length, 10);
  assert.deepEqual(P.prunePreOpenBackups(path.join(dir, 'nope'), 10), [], 'a missing folder is not an error');
});

test('the failed-backup error is coded and says nothing was replaced', () => {
  const e = P.preOpenBackupError(new Error('disk full'));
  assert.equal(e.code, 'PRE_OPEN_BACKUP_FAILED');
  assert.match(e.message, /nothing was replaced/);
  assert.match(e.message, /disk full/);
});

// ─── the live file ─────────────────────────────────────────────

const LIVE = path.join(path.sep, 'Users', 'me', 'Documents', 'Real.tcdb');
const DEMO = path.join(path.sep, 'Users', 'me', 'Documents', 'TexaCore-Demo', 'Demo.tcdb');

test('planNewCompanyFile: other companies + a live file => the live file stays; an empty database or no live file => the old behaviour', () => {
  assert.deepEqual(P.planNewCompanyFile({ existingCompanyCount: 1, liveFilePath: LIVE }), { keepLive: true, liveFilePath: LIVE });
  assert.deepEqual(P.planNewCompanyFile({ existingCompanyCount: 5, liveFilePath: LIVE }), { keepLive: true, liveFilePath: LIVE });
  assert.equal(P.planNewCompanyFile({ existingCompanyCount: 0, liveFilePath: LIVE }).keepLive, false, 'an empty database: the new company\'s file becomes the live file (current behaviour)');
  assert.equal(P.planNewCompanyFile({ existingCompanyCount: 2, liveFilePath: null }).keepLive, false, 'companies but nothing syncing anywhere: nothing to displace');
  assert.equal(P.planNewCompanyFile({ existingCompanyCount: 2, liveFilePath: 'relative/live.tcdb' }).keepLive, false, 'a relative path is not a live file');
  assert.equal(P.planNewCompanyFile({ existingCompanyCount: undefined, liveFilePath: LIVE }).keepLive, false);
});

test('recordPlannedCompany: the live entry stays first and untouched, the new company is a planned entry without tcdbPath/storagePath', () => {
  const before = [{ name: '2023', tcdbPath: LIVE, storagePath: path.dirname(LIVE) }];
  const out = P.recordPlannedCompany(before, { name: 'Demo', companyId: 'c2', tenantId: 't2', plannedTcdbPath: DEMO, plannedStoragePath: path.dirname(DEMO), placement: 'chosen' }, LIVE, new Date('2026-10-22T10:00:00Z'));
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], before[0]);
  assert.equal(P.liveEntryOf(out), out[0]);
  const p = out[1];
  assert.equal(p.planned, true);
  assert.equal(p.plannedTcdbPath, DEMO);
  assert.equal(p.companyId, 'c2');
  assert.equal(p.plannedAt, '2026-10-22T10:00:00.000Z');
  assert.ok(!('tcdbPath' in p) && !('storagePath' in p), 'readers of tcdbPath / storagePath (cloud upload, search roots, upgrade notice) must never see a planned entry');
  assert.equal(P.plannedFileOf(out, 'c2'), DEMO);
  assert.equal(P.plannedFileOf(out, 'nobody'), null);
  assert.equal(before.length, 1, 'the input list is not mutated');
});

test('recordPlannedCompany: no live entry in the config yet => one is made from the live path and put first (the start-up code reads companies[0])', () => {
  const out = P.recordPlannedCompany([], { name: 'Demo', companyId: 'c2', plannedTcdbPath: DEMO }, LIVE);
  assert.equal(out[0].tcdbPath, LIVE);
  assert.equal(out[0].storagePath, path.dirname(LIVE));
  assert.equal(out[1].planned, true);
  const none = P.recordPlannedCompany(undefined, { name: 'Demo', companyId: 'c2', plannedTcdbPath: DEMO }, LIVE);
  assert.equal(none[0].tcdbPath, LIVE);
});

test('recordPlannedCompany: a planned entry that ended up first is moved behind the live entry; the same company id replaces its earlier planned entry', () => {
  const live = { name: 'L', tcdbPath: LIVE, storagePath: path.dirname(LIVE) };
  const stale = { name: 'Demo', companyId: 'c2', planned: true, plannedTcdbPath: '/old/Demo.tcdb' };
  const out = P.recordPlannedCompany([stale, live], { name: 'Demo', companyId: 'c2', plannedTcdbPath: DEMO }, LIVE);
  assert.equal(out[0], live);
  assert.equal(out.filter((c) => c.planned).length, 1);
  assert.equal(out[1].plannedTcdbPath, DEMO);
});

test('liveEntryOf: skips planned entries, tolerates garbage', () => {
  assert.equal(P.liveEntryOf(undefined), null);
  assert.equal(P.liveEntryOf([]), null);
  assert.equal(P.liveEntryOf([null, 5, { planned: true, plannedTcdbPath: DEMO }]), null);
  const live = { name: 'x', tcdbPath: LIVE };
  assert.equal(P.liveEntryOf([{ planned: true }, live]), live);
});

test('a relative planned path is not recorded (an absolute path only)', () => {
  const out = P.recordPlannedCompany([{ name: 'L', tcdbPath: LIVE }], { name: 'D', companyId: 'd', plannedTcdbPath: 'rel/Demo.tcdb', plannedStoragePath: 'rel' }, LIVE);
  assert.equal(out[1].plannedTcdbPath, null);
  assert.equal(out[1].plannedStoragePath, null);
});
