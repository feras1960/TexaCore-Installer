'use strict';
// The Windows licence hardware id (license-guard.js _windowsHardwareId): the same WIN-<SMBIOS uuid> with or without wmic, a MachineGuid id
// before the host-name fallback, and an existing license.dat keeps validating with the id it is bound to (the host-name id of a PC that had no wmic).
// Every shell-out is mocked: nothing here runs wmic, PowerShell, reg or system_profiler.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const LicenseGuard = require('../src/license-guard');

const UUID = '4C4C4544-0042-3510-8052-B4C04F564433';
const GUID = '6f1c2a8e-3b7d-4e0f-9a51-2c8d7e6b4f10';

/** A fake Windows: which probes answer, and what they were asked (every call must carry a timeout and windowsHide). */
function fakeWin({ wmic = 'missing', cim = 'missing', guid = 'missing', host = 'OFFICE-PC' } = {}) {
  const calls = [];
  const check = (o) => { assert.ok(o && o.timeout > 0, 'every probe has a timeout'); assert.equal(o.windowsHide, true, 'every probe hides its window'); };
  const execSync = (cmd, o) => {
    calls.push(cmd); check(o);
    assert.equal(cmd, 'wmic csproduct get uuid');
    if (wmic === 'missing') { const e = new Error("'wmic' is not recognized"); e.status = 1; throw e; }
    return Buffer.from(`UUID                                  \r\r\n${wmic}  \r\r\n\r\r\n`);
  };
  const execFileSync = (file, args, o) => {
    calls.push(`${path.win32.basename(file)} ${args.join(' ')}`); check(o);
    if (/powershell\.exe$/i.test(file)) {
      assert.ok(args.some((a) => /Get-CimInstance -ClassName Win32_ComputerSystemProduct\)\.UUID/.test(a)));
      if (cim === 'missing') throw new Error('powershell failed');
      return Buffer.from(`${cim}\r\n`);
    }
    if (file === 'reg') {
      assert.deepEqual(args, ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid']);
      if (guid === 'missing') throw new Error('reg failed');
      return Buffer.from(`\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    ${guid}\r\n\r\n`);
    }
    throw new Error('unexpected ' + file);
  };
  return { calls, opts: { platform: 'win32', execSync, execFileSync, hostname: () => host, arch: 'x64' } };
}

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-hw-')); dirs.push(d); return d; };
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const freeLic = () => ({ tier: 'free', status: 'active', license_key: 'FREE-2026-ABCDE', plan_type: 'free', max_users: 1, max_companies: -1 });

test('wmic present: WIN-<uuid>, parsed exactly as 2.0.7 did, and nothing else is run', () => {
  const w = fakeWin({ wmic: UUID, cim: UUID, guid: GUID });
  const lg = new LicenseGuard(tmp(), w.opts);
  assert.equal(lg.getHardwareId(), `WIN-${UUID}`);
  assert.deepEqual(w.calls, ['wmic csproduct get uuid']);
});

test('wmic missing: PowerShell Get-CimInstance gives the SAME WIN-<uuid>', () => {
  const withWmic = new LicenseGuard(tmp(), fakeWin({ wmic: UUID }).opts).getHardwareId();
  const w = fakeWin({ cim: UUID, guid: GUID });
  const withoutWmic = new LicenseGuard(tmp(), w.opts).getHardwareId();
  assert.equal(withoutWmic, withWmic);
  assert.equal(w.calls.length, 2, 'wmic, then PowerShell; the registry is not needed');
});

test('wmic and PowerShell missing: WINMG-<MachineGuid>; nothing answers: the host-name fallback of before', () => {
  assert.equal(new LicenseGuard(tmp(), fakeWin({ guid: GUID.toUpperCase() }).opts).getHardwareId(), `WINMG-${GUID}`);
  assert.equal(new LicenseGuard(tmp(), fakeWin({}).opts).getHardwareId(), 'FALLBACK-OFFICE-PC-x64');
});

test('an empty answer is not an id: wmic keeps its 2.0.7 parsing, an empty PowerShell answer moves on to the MachineGuid', () => {
  assert.equal(new LicenseGuard(tmp(), fakeWin({ wmic: '' }).opts).getHardwareId(), 'WIN-UUID', 'header only → exactly what 2.0.7 computed');
  assert.equal(new LicenseGuard(tmp(), fakeWin({ cim: '', guid: GUID }).opts).getHardwareId(), `WINMG-${GUID}`);
});

test('a PC without wmic, licensed by 2.0.7 (license.dat bound to FALLBACK-<host>-<arch>), keeps validating — and keeps sending that same id', () => {
  const dir = tmp();
  // 2.0.7 on this PC: wmic missing, no other probe → the host-name id
  const old = new LicenseGuard(dir, { ...fakeWin({}).opts });
  assert.equal(old.getHardwareId(), 'FALLBACK-OFFICE-PC-x64');
  old.saveLicense(freeLic());
  // 2.0.8 on the same PC: PowerShell answers now, but license.dat is bound to the host-name id
  const w = fakeWin({ cim: UUID, guid: GUID });
  const lg = new LicenseGuard(dir, w.opts);
  assert.equal(lg.getHardwareId(), 'FALLBACK-OFFICE-PC-x64', 'the bound id is kept (the server holds it as the licence hardware_id)');
  const v = lg.validate();
  assert.equal(v.valid, true);
  assert.equal(v.license.license_key, 'FREE-2026-ABCDE');
  // a re-save stays bound to the same id
  lg.saveLicense({ ...v.license, max_users: 2 });
  const again = new LicenseGuard(dir, fakeWin({ cim: UUID, guid: GUID }).opts);
  assert.equal(again.validate().valid, true);
  assert.equal(again.getHardwareId(), 'FALLBACK-OFFICE-PC-x64');
});

test('a licence written by 2.0.8 binds to WIN-<uuid> and survives a PC rename', () => {
  const dir = tmp();
  new LicenseGuard(dir, fakeWin({ cim: UUID, host: 'OLD-NAME' }).opts).saveLicense(freeLic());
  const renamed = new LicenseGuard(dir, fakeWin({ cim: UUID, host: 'NEW-NAME' }).opts);
  assert.equal(renamed.getHardwareId(), `WIN-${UUID}`);
  assert.equal(renamed.validate().valid, true);
});

test('a licence bound to WIN-<uuid> by wmic still opens after wmic is removed (PowerShell gives the same id)', () => {
  const dir = tmp();
  new LicenseGuard(dir, fakeWin({ wmic: UUID }).opts).saveLicense(freeLic());
  const lg = new LicenseGuard(dir, fakeWin({ cim: UUID, guid: GUID }).opts);
  assert.equal(lg.getHardwareId(), `WIN-${UUID}`);
  assert.equal(lg.validate().valid, true);
});

test('a licence bound to the MachineGuid id (PowerShell failed once) still opens when PowerShell answers again', () => {
  const dir = tmp();
  new LicenseGuard(dir, fakeWin({ guid: GUID }).opts).saveLicense(freeLic());
  const lg = new LicenseGuard(dir, fakeWin({ cim: UUID, guid: GUID }).opts);
  assert.equal(lg.getHardwareId(), `WINMG-${GUID}`);
  assert.equal(lg.validate().valid, true);
});

test('the check is not weakened: a license.dat from ANOTHER PC (or a host-name licence after a rename) still does not open', () => {
  const dir = tmp();
  new LicenseGuard(dir, fakeWin({ cim: 'AAAAAAAA-0000-0000-0000-000000000001', host: 'OTHER-PC' }).opts).saveLicense(freeLic());
  const here = new LicenseGuard(dir, fakeWin({ cim: UUID, guid: GUID, host: 'OFFICE-PC' }).opts);
  assert.equal(here.getHardwareId(), `WIN-${UUID}`, 'only ids THIS PC produces are tried');
  assert.equal(here.validate().valid, false);

  const dir2 = tmp();
  new LicenseGuard(dir2, fakeWin({ host: 'OLD-NAME' }).opts).saveLicense(freeLic());   // 2.0.7 host-name licence
  const renamed = new LicenseGuard(dir2, fakeWin({ cim: UUID, guid: GUID, host: 'NEW-NAME' }).opts);
  assert.equal(renamed.validate().valid, false, 'a host-name licence is still tied to the host name it was written under');
});

test('macOS and Linux keep their exact ids and their single fallback (no alternate ids, no PowerShell/registry probes)', () => {
  const sp = (cmd) => Buffer.from(/Serial Number/.test(cmd) ? 'C02XYZ\n' : 'ABCD-1234\n');
  const mac = new LicenseGuard(tmp(), { platform: 'darwin', execSync: sp, execFileSync: () => { throw new Error('not used on macOS'); }, hostname: () => 'mac', arch: 'arm64' });
  assert.equal(mac.getHardwareId(), 'MAC-C02XYZ-ABCD-1234');
  const macFail = new LicenseGuard(tmp(), { platform: 'darwin', execSync: () => { throw new Error('no system_profiler'); }, hostname: () => 'mac', arch: 'arm64' });
  assert.equal(macFail.getHardwareId(), 'FALLBACK-mac-arm64');

  // a macOS license.dat bound to the FALLBACK id does NOT open once system_profiler answers (unchanged strictness)
  const dir = tmp();
  macFail.licensePath = path.join(dir, 'license.dat');
  macFail.saveLicense(freeLic());
  const macOk = new LicenseGuard(dir, { platform: 'darwin', execSync: sp, hostname: () => 'mac', arch: 'arm64' });
  assert.equal(macOk.getHardwareId(), 'MAC-C02XYZ-ABCD-1234');
  assert.equal(macOk.validate().valid, false);

  const linux = new LicenseGuard(tmp(), { platform: 'linux', execSync: () => { throw new Error('no wmic'); }, execFileSync: () => { throw new Error('not used on Linux'); }, hostname: () => 'box', arch: 'x64' });
  assert.equal(linux.getHardwareId(), 'FALLBACK-box-x64');
});
