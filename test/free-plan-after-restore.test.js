'use strict';
// (1) The free licence object never limits companies (owner rule; the free plan row seeds -1).
// (2) After a company file is opened / restored, THIS install's licence plan is re-applied at once (the restored database carries the file's plan).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const slice = (from, to) => { const a = src.indexOf(from); assert.ok(a >= 0, from); const b = src.indexOf(to, a + from.length); return src.slice(a, b < 0 ? undefined : b); };

test('every free licence the installer writes has max_companies -1 (start-free, trial → free landing, the harness licence)', () => {
  const startFree = slice("ipcMain.handle('start-free'", 'function landTrialToFree');
  const landing = slice('function landTrialToFree', '// ─── Free plan limit sync');
  const harness = slice('function mintHarnessLicense', 'app.whenReady()');
  assert.match(startFree, /max_companies: -1,/);
  assert.match(landing, /max_companies: -1,/);
  assert.match(harness, /tier: 'free',[^\n]*max_companies: -1,/);
  assert.doesNotMatch(src, /max_companies: 1\b/);
  const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'WINDOWS_SMOKE_CHECKLIST.md'), 'utf8');
  assert.doesNotMatch(doc, /1 company/);
});

test('reapplyLicensePlanAfterRestore: the heartbeat\'s own call (free forced when the user chose Free), never throwing into the open', () => {
  const fn = slice('async function reapplyLicensePlanAfterRestore(', '\nlet _planSyncChain');
  assert.match(fn, /isFree = loadConfig\(\)\.isFree === true/);
  assert.match(fn, /await syncActivePlan\(isFree \? 'free' : undefined\)/);
  // syncActivePlan itself catches (throwOnError defaults to false), so the open never fails because of the plan
  assert.match(slice('async function syncActivePlan(', '\n// Open browser'), /catch \(e\) \{\s*fileLog\('\[Plan\] sync failed:', e\.message\);\s*if \(throwOnError\) throw e;\s*return false;/);
});

test('all three restore paths re-apply the licence plan after a successful restore, before they answer', () => {
  const open = slice('async function openTcdbFromPathUnlocked(', '\nconst httpServer');
  const r1 = open.indexOf('backupManager.restore(selectedPath');
  const p1 = open.indexOf("await reapplyLicensePlanAfterRestore('OpenTCDB')");
  assert.ok(r1 > 0 && p1 > r1 && p1 < open.indexOf('return {\n    success: true,'), 'open in place: after the restore, before the answer');

  const upload = slice("const restoreResult = await backupManager.restore(tcdbPath, { passphrase })", "console.log(`[Restore] ✅ DB restored from");
  assert.match(upload, /await reapplyLicensePlanAfterRestore\('Restore'\)/);

  const ipc = slice("ipcMain.handle('backup-restore'", '// ─── RSF Import');
  const r3 = ipc.indexOf('backupManager.restore(filePath)');
  const p3 = ipc.indexOf("await reapplyLicensePlanAfterRestore('Restore IPC')");
  assert.ok(r3 > 0 && p3 > r3 && p3 < ipc.indexOf('return { success: true'));
});
