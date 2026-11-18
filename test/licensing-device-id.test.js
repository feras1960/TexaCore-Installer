'use strict';
// What the installer sends the licensing edge functions as the device proof.
// register-subdomain (ERP supabase/functions/register-subdomain/index.ts) reads `hardwareId ?? hardware_id` as the hardware id and passes `machineId` to
// licensing_verify_device as p_hostname; license-cloud-backup reads `hardware_id`. 2.0.7 put the hardware id in `machineId` and sent no `hardwareId`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { registerSubdomainBody } = require('../src/tunnel-route');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

test('register-subdomain body: hardwareId carries the hardware id, hostname the real host name, machineId stays as 2.0.7 sent it', () => {
  const b = registerSubdomainBody({ licenseKey: 'TRL-2026-AAAAA-BBBBB', subdomain: 'acme', hardwareId: 'WIN-4C4C4544-0042', hostname: 'OFFICE-PC', companyName: 'TexaCore Desktop' });
  assert.deepEqual(b, {
    licenseKey: 'TRL-2026-AAAAA-BBBBB', subdomain: 'acme',
    machineId: 'WIN-4C4C4544-0042',   // the server version before `hardwareId` compared the licence hardware_id with machineId
    hostname: 'OFFICE-PC',
    hardwareId: 'WIN-4C4C4544-0042',
    companyName: 'TexaCore Desktop',
  });
});

test('register-subdomain body without a hardware id: the host name only (the server hostname path), no empty hardwareId', () => {
  for (const hardwareId of [null, undefined, '', '   ']) {
    const b = registerSubdomainBody({ licenseKey: 'K', subdomain: 'acme', hardwareId, hostname: 'OFFICE-PC' });
    assert.equal(b.machineId, 'OFFICE-PC');
    assert.equal(b.hostname, 'OFFICE-PC');
    assert.equal('hardwareId' in b, false);
  }
  assert.equal(registerSubdomainBody({ licenseKey: 'K', subdomain: 'a', hardwareId: 'X' }).hostname, require('os').hostname(), 'the real host name by default');
});

test('every register-subdomain call builds its body with registerSubdomainBody and passes the hardware id', () => {
  const main = read('main.js');
  const sm = read('service-manager.js');
  const reg = main.slice(main.indexOf("ipcMain.handle('register-subdomain'"), main.indexOf("ipcMain.handle('verify-subdomain'"));
  assert.match(reg, /httpPost\(`\$\{LICENSING_URL\}\/register-subdomain`, require\('\.\/tunnel-route'\)\.registerSubdomainBody\(\{/);
  assert.match(reg, /hardwareId: \(\(\) => \{ try \{ if \(!licenseGuard\) licenseGuard = new LicenseGuard\(DATA_DIR\); return licenseGuard\.getHardwareId\(\); \}/);
  assert.equal((sm.match(/tunnelRoute\.registerSubdomainBody\(\{/g) || []).length, 2, 'the repair and the token refresh');
  assert.equal((sm.match(/hardwareId: hw,/g) || []).length, 2);
  for (const src of [main, sm]) assert.doesNotMatch(src, /machineId:\s*(hw|\(\(\))/, 'no call builds machineId by hand any more');
});

test('license-cloud-backup: every upload carries hardware_id (when it can be read)', () => {
  const main = read('main.js');
  assert.match(main, /function licenceHardwareIdOrNull\(\) \{[\s\S]*?licenseGuard\.getHardwareId\(\)/);
  const uploads = main.split('/license-cloud-backup`, {').slice(1);
  assert.equal(uploads.length, 2, 'the .tcdb and the .rsf upload');
  for (const u of uploads) assert.match(u.slice(0, 200), /\.\.\.\(hardwareId \? \{ hardware_id: hardwareId \} : \{\}\)/);
  assert.match(main, /configureCloudSync\(\{[\s\S]{0,200}hardwareId: licenceHardwareIdOrNull\(\)/);
  const bm = read('backup-manager.js');
  assert.match(bm, /\.\.\.\(this\._hardwareId \? \{ hardware_id: this\._hardwareId \} : \{\}\)/);
});

test('BackupManager sends hardware_id in its metadata call only when it was given one', async () => {
  const BackupManager = require('../src/backup-manager');
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-hw-'));
  const file = path.join(dir, 'c.tcdb');
  fs.writeFileSync(file, Buffer.from('TCDB-test'));
  try {
    for (const [hardwareId, expect] of [['WIN-ABC', 'WIN-ABC'], [undefined, undefined]]) {
      const bm = new BackupManager({ pgBinDir: dir, backupPath: file, dataDir: dir, onProgress: () => {}, onError: () => {} });
      bm.configureCloudSync({ licensingUrl: 'https://example.invalid/functions/v1', licenseKey: 'K-1', hardwareId });
      let sent = null;
      bm._httpPost = async (_url, body) => { sent = body; return { success: true }; };
      await bm.uploadToCloud();
      assert.ok(sent, 'the call was made');
      assert.equal(sent.hardware_id, expect);
      assert.equal(sent.license_key, 'K-1');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
