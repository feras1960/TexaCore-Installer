'use strict';
// 2.0.5 — "the live file never silently changes owner". handleCreateLocalCompany() is run for real (its source is cut out of main.js and
// evaluated against stubs of Electron / the database / the services), in the three situations that matter:
//   A. another company exists and a file is syncing it  => the live file, the backup manager and companies[0] stay; the new company's
//      chosen file is only RECORDED (planned entry), and the answer says where the data really is;
//   B. the database was empty                           => the old behaviour (the new company's file becomes the live file);
//   C. companies exist but nothing syncs anywhere      => nothing to displace: the new file becomes the live file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { mkdtemp } = require('./helpers');
const companyFile = require('../src/company-file');
const livePolicy = require('../src/live-file-policy');

const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const from = mainSrc.indexOf('async function handleCreateLocalCompany(companyData) {');
const to = mainSrc.indexOf("ipcMain.handle('create-local-company'", from);
assert.ok(from > 0 && to > from, 'handleCreateLocalCompany not found');
const fnSource = mainSrc.slice(from, to);

function world({ companiesBefore, live, config }) {
  const root = mkdtemp('keep-');
  const logs = [];
  const state = { config: JSON.parse(JSON.stringify(config || {})), saved: 0, managersMade: [], stopped: 0, started: 0 };
  class BackupManager {
    constructor(o) { this.backupPath = o.backupPath; this.secondaryBackupPath = o.secondaryBackupPath || null; state.managersMade.push(this); }
    stopSync() { state.stopped++; } startSync() { state.started++; } configureCloudSync() {} startCloudSync() {}
  }
  const sandbox = {
    console, process, require, Buffer,
    fileLog: (...a) => logs.push(a.join(' ')),
    svcManager: { isRunning: () => true, anonKey: 'anon', binsDir: root, dbPassword: 'x', activeApiPort: 54321, provisioningDeps: () => ({}) },
    ServiceManager: { PG_PORT: 54322 },
    provisioningDeps: () => ({}),
    provisioning: {
      createLocalCompany: async () => ({ success: true, tenantId: 't-new', companyId: 'c-new', adminEmail: 'a@b.c', accessToken: 'at', refreshToken: 'rt' }),
      ensureVendorSupport: async () => {},
    },
    netGuard: { safeUploadName: () => true },
    folderAccess: { ensureUsable: async () => ({ state: 'allowed' }) },
    folderPermissionError: () => new Error('no permission'),
    pickedFiles: new Map(),
    companyFile, livePolicy, path, fs,
    DATA_DIR: path.join(root, 'data'),
    UNIFIED_BACKUP_KEY: 'k',
    LICENSING_URL: 'https://licensing.invalid',
    getVendorAccount: () => null,
    mainWindow: null,
    heartbeatSender: { _uploadCloudBackup: async () => {} },
    BackupManager,
    loadConfig: () => JSON.parse(JSON.stringify(state.config)),
    saveConfig: (c) => { state.config = JSON.parse(JSON.stringify(c)); state.saved++; },
    listLocalCompanies: async () => companiesBefore,
    liveCompanyFile: () => live,
    backupManager: live ? new BackupManager({ backupPath: live }) : null,
  };
  sandbox.pickedFiles.drop = () => {};
  state.managersMade.length = 0;   // (the pre-existing live manager is not "made by the creation")
  vm.createContext(sandbox);
  vm.runInContext(fnSource + '\n;this.__create = handleCreateLocalCompany;', sandbox);
  return { root, state, logs, sandbox, create: (data) => sandbox.__create(data) };
}

const LIVE = path.join(path.sep, 'Users', 'me', 'Documents', 'Real.tcdb');
const two = [{ id: 'c-real', name: '2023 مطور بعد الصيانة' }];

test('A: another company exists and a file is syncing it - the live file, the manager and companies[0] stay; the chosen file is only recorded', async () => {
  const w = world({ companiesBefore: two, live: LIVE, config: { companies: [{ name: '2023', tcdbPath: LIVE, storagePath: path.dirname(LIVE) }], storagePath: path.dirname(LIVE) } });
  const chosen = path.join(w.root, 'TexaCore-Demo');
  const r = await w.create({ companyName: 'بروفة العرض', storagePath: chosen, dbFileName: 'بروفة-العرض' });
  assert.equal(r.success, true, r.error);
  // the live file never moved
  assert.equal(w.sandbox.backupManager.backupPath, LIVE);
  assert.equal(w.state.managersMade.length, 0, 'no new backup manager is started for the new company');
  assert.equal(w.state.stopped, 0, 'the existing manager is not stopped');
  assert.equal(w.state.started, 0);
  const cfg = w.state.config;
  assert.equal(cfg.companies[0].tcdbPath, LIVE);
  assert.equal(livePolicy.liveEntryOf(cfg.companies).tcdbPath, LIVE);
  assert.equal(cfg.storagePath, path.dirname(LIVE), 'the install-wide storage folder is not re-pointed either');
  // the new company's choice is recorded for the per-company mode of a later round
  const planned = cfg.companies.filter((c) => c.planned);
  assert.equal(planned.length, 1);
  assert.equal(planned[0].companyId, 'c-new');
  assert.equal(planned[0].plannedTcdbPath, path.join(chosen, 'بروفة-العرض.tcdb'));
  assert.ok(!('tcdbPath' in planned[0]));
  assert.equal(livePolicy.plannedFileOf(cfg.companies, 'c-new'), path.join(chosen, 'بروفة-العرض.tcdb'));
  // nothing was created at the planned place (it is only an intention)
  assert.equal(fs.existsSync(chosen), false, 'the folder of a file that is only recorded is not created');
  // the answer tells the wizard where the data really is
  assert.equal(r.sharedLiveFile, true);
  assert.equal(r.liveFilePath, LIVE);
  assert.equal(r.tcdbPath, LIVE, 'tcdbPath = where the data really goes');
  assert.equal(r.plannedTcdbPath, path.join(chosen, 'بروفة-العرض.tcdb'));
  assert.equal(r.companiesInFile, 2);
});

test('A2: a second planned company never gets the same planned path as the first', async () => {
  const w = world({ companiesBefore: two, live: LIVE, config: { companies: [{ name: '2023', tcdbPath: LIVE, storagePath: path.dirname(LIVE) }] } });
  const chosen = path.join(w.root, 'Files');
  const a = await w.create({ companyName: 'One', storagePath: chosen, dbFileName: 'Same' });
  const b = await w.create({ companyName: 'Two', storagePath: chosen, dbFileName: 'Same' });
  assert.notEqual(a.plannedTcdbPath, b.plannedTcdbPath);
  assert.equal(b.plannedTcdbPath, path.join(chosen, 'Same (2).tcdb'));
});

test('A3: the planned entry never makes the start-up / export code pick it as the live file', async () => {
  const w = world({ companiesBefore: two, live: LIVE, config: { companies: [{ name: '2023', tcdbPath: LIVE, storagePath: path.dirname(LIVE) }] } });
  await w.create({ companyName: 'Demo', storagePath: path.join(w.root, 'D'), dbFileName: 'Demo' });
  const cfg = w.state.config;
  const entry = livePolicy.liveEntryOf(cfg.companies);
  assert.equal(entry.tcdbPath, LIVE);
  // the readers in main.js that go through the helper
  assert.match(mainSrc, /const company = livePolicy\.liveEntryOf\(config\.companies\);/);
  assert.match(mainSrc, /const co = livePolicy\.liveEntryOf\(loadConfig\(\)\.companies\);/);
});

test('B: an empty database - the old behaviour: the new company\'s file becomes the live file and a manager syncs it', async () => {
  const w = world({ companiesBefore: [], live: null, config: {} });
  const chosen = path.join(w.root, 'Mine');
  const r = await w.create({ companyName: 'First', storagePath: chosen, dbFileName: 'First' });
  assert.equal(r.success, true, r.error);
  const file = path.join(chosen, 'First.tcdb');
  assert.equal(w.state.config.companies.length, 1);
  assert.equal(w.state.config.companies[0].tcdbPath, file);
  assert.equal(w.state.config.storagePath, chosen);
  assert.equal(w.state.managersMade.length, 1);
  assert.equal(w.state.managersMade[0].backupPath, file);
  assert.equal(w.state.started, 1);
  assert.equal(r.tcdbPath, file);
  assert.ok(!('sharedLiveFile' in r));
  assert.ok(fs.existsSync(chosen), 'the folder is made as before');
});

test('B2: a stale live path from a deleted company does not block the next company when the database is empty', async () => {
  const w = world({ companiesBefore: [], live: LIVE, config: { companies: [{ name: 'gone', tcdbPath: LIVE, storagePath: path.dirname(LIVE) }] } });
  const chosen = path.join(w.root, 'Next');
  const r = await w.create({ companyName: 'Next', storagePath: chosen, dbFileName: 'Next' });
  assert.equal(r.tcdbPath, path.join(chosen, 'Next.tcdb'));
  assert.equal(w.state.config.companies[0].tcdbPath, path.join(chosen, 'Next.tcdb'));
  assert.equal(w.state.managersMade.length, 1);
});

test('C: companies exist but nothing syncs anywhere - the new file becomes the live file (nothing to displace)', async () => {
  const w = world({ companiesBefore: two, live: null, config: {} });
  const chosen = path.join(w.root, 'Solo');
  const r = await w.create({ companyName: 'Solo', storagePath: chosen, dbFileName: 'Solo' });
  assert.equal(r.tcdbPath, path.join(chosen, 'Solo.tcdb'));
  assert.equal(w.state.managersMade.length, 1);
  assert.ok(!('sharedLiveFile' in r));
});

test('a company that asked for no file at all (no folder) is still created next to others, with nothing recorded to a path', async () => {
  const w = world({ companiesBefore: two, live: LIVE, config: { companies: [{ name: '2023', tcdbPath: LIVE, storagePath: path.dirname(LIVE) }] } });
  const r = await w.create({ companyName: 'NoFile' });
  assert.equal(r.success, true, r.error);
  assert.equal(r.tcdbPath, LIVE);
  assert.equal(r.plannedTcdbPath, undefined);
  assert.equal(w.state.config.companies[0].tcdbPath, LIVE);
  assert.equal(w.state.managersMade.length, 0);
});

test('wiring: the step that starts a new BackupManager is guarded by the plan, and the answer carries the new fields', () => {
  assert.match(fnSource, /if \(tcdbFilePath && !filePlan\.keepLive\) \{\s*try \{/);
  assert.match(fnSource, /sharedLiveFile: true, liveFilePath: filePlan\.liveFilePath, plannedTcdbPath/);
  assert.match(fnSource, /tcdbPath: filePlan\.keepLive \? filePlan\.liveFilePath : tcdbFilePath/);
  // the companies that exist are read BEFORE the provisioning call (the new one is not counted among "other companies")
  assert.ok(fnSource.indexOf('companiesBefore = await listLocalCompanies()') < fnSource.indexOf('provisioning.createLocalCompany('));
});
