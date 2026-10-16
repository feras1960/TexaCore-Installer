'use strict';
// 2.0.4: a stable signing identity (so macOS keeps the privacy permissions and the Keychain access across updates) + the updater that must not throw it away.
// The install script is run for real in bash on scratch folders with a FAKE codesign that prints what the real one prints for each kind of bundle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ms = require('../scripts/lib/mac-sign');
const { MacUpdater } = require('../src/mac-updater');
const { mkdtemp } = require('./helpers');

test('resolveSigning: nothing, empty or "-" is ad-hoc; an identity comes from TEXACORE_MAC_SIGN_IDENTITY (CSC_NAME as fallback); Developer ID implies the hardened runtime', () => {
  assert.equal(ms.resolveSigning({}).mode, 'adhoc');
  assert.equal(ms.resolveSigning({ TEXACORE_MAC_SIGN_IDENTITY: '  ' }).mode, 'adhoc');
  assert.equal(ms.resolveSigning({ TEXACORE_MAC_SIGN_IDENTITY: '-' }).mode, 'adhoc');
  const self = ms.resolveSigning({ TEXACORE_MAC_SIGN_IDENTITY: 'TexaCore Local Signing' });
  assert.deepEqual({ m: self.mode, i: self.identity, h: self.hardened, d: self.developerId }, { m: 'identity', i: 'TexaCore Local Signing', h: false, d: false });
  const dev = ms.resolveSigning({ CSC_NAME: 'Developer ID Application: Acme (AB12CD34EF)', TEXACORE_MAC_SIGN_KEYCHAIN: '/k/build.keychain-db' });
  assert.deepEqual({ m: dev.mode, h: dev.hardened, d: dev.developerId, k: dev.keychain }, { m: 'identity', h: true, d: true, k: '/k/build.keychain-db' });
  assert.equal(ms.resolveSigning({ TEXACORE_MAC_SIGN_IDENTITY: 'X', TEXACORE_MAC_SIGN_HARDENED: '1' }).hardened, true);
  assert.equal(ms.resolveSigning({ TEXACORE_MAC_SIGN_IDENTITY: 'A', CSC_NAME: 'B' }).identity, 'A', 'the TexaCore variable wins');
});

test('codesignArgs: ad-hoc is exactly the old command; an identity adds nothing it was not asked for; Developer ID adds the runtime, a timestamp and the entitlements', () => {
  assert.deepEqual(ms.codesignArgs(ms.resolveSigning({}), '/x/A.app'), ['--force', '--deep', '--sign', '-', '/x/A.app']);
  assert.deepEqual(ms.codesignArgs(ms.resolveSigning({ TEXACORE_MAC_SIGN_IDENTITY: 'TexaCore Local Signing' }), '/x/A.app', { entitlements: '/e.plist' }), ['--force', '--deep', '--sign', 'TexaCore Local Signing', '/x/A.app']);
  const dev = ms.codesignArgs(ms.resolveSigning({ TEXACORE_MAC_SIGN_IDENTITY: 'Developer ID Application: Acme (AB12CD34EF)', TEXACORE_MAC_SIGN_KEYCHAIN: '/k.keychain-db' }), '/x/A.app', { entitlements: '/e.plist' });
  assert.deepEqual(dev, ['--force', '--deep', '--sign', 'Developer ID Application: Acme (AB12CD34EF)', '--keychain', '/k.keychain-db', '--options', 'runtime', '--timestamp', '--entitlements', '/e.plist', '/x/A.app']);
});

// what `codesign -dvv` prints (stderr) for the real kinds of bundle (the ad-hoc one is the owner's installed 2.0.3)
const ADHOC = 'Executable=/Applications/TexaCore ERP.app/Contents/MacOS/TexaCore ERP\nIdentifier=com.texacore.installer\nFormat=app bundle with Mach-O thin (arm64)\nCodeDirectory v=20400 size=335 flags=0x2(adhoc) hashes=4+3 location=embedded\nSignature=adhoc\nInfo.plist entries=35\nTeamIdentifier=not set\nSealed Resources version=2 rules=13 files=4069\n';
const SELF = 'Executable=/x\nIdentifier=com.texacore.installer\nFormat=app bundle with Mach-O thin (arm64)\nCodeDirectory v=20400 size=335 flags=0x0(none) hashes=4+3 location=embedded\nSignature size=1500\nAuthority=TexaCore Local Signing\nTeamIdentifier=not set\nSealed Resources version=2 rules=13 files=4069\n';
const DEVID = 'Executable=/x\nIdentifier=com.texacore.installer\nCodeDirectory v=20500 flags=0x10000(runtime) hashes=4+7\nAuthority=Developer ID Application: Acme (AB12CD34EF)\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTeamIdentifier=AB12CD34EF\n';

test('parseSignatureInfo / signatureMatches: an identity request is only satisfied by that identity; an ad-hoc result for it is a FAILED signature', () => {
  const a = ms.parseSignatureInfo(ADHOC); const s = ms.parseSignatureInfo(SELF); const d = ms.parseSignatureInfo(DEVID);
  assert.deepEqual({ signed: a.signed, adhoc: a.adhoc, team: a.teamId }, { signed: true, adhoc: true, team: null });
  assert.deepEqual({ adhoc: s.adhoc, auth: s.authority, team: s.teamId }, { adhoc: false, auth: 'TexaCore Local Signing', team: null });
  assert.deepEqual({ auth: d.authority, team: d.teamId }, { auth: 'Developer ID Application: Acme (AB12CD34EF)', team: 'AB12CD34EF' });
  assert.equal(ms.parseSignatureInfo('/x: code object is not signed at all').signed, false);
  const adhocReq = ms.resolveSigning({}); const selfReq = ms.resolveSigning({ TEXACORE_MAC_SIGN_IDENTITY: 'TexaCore Local Signing' }); const devReq = ms.resolveSigning({ TEXACORE_MAC_SIGN_IDENTITY: 'Developer ID Application: Acme (AB12CD34EF)' });
  assert.equal(ms.signatureMatches(adhocReq, a), true);
  assert.equal(ms.signatureMatches(adhocReq, s), false);
  assert.equal(ms.signatureMatches(selfReq, s), true);
  assert.equal(ms.signatureMatches(selfReq, a), false, 'the identity was requested but the bundle came out ad-hoc');
  assert.equal(ms.signatureMatches(selfReq, ms.parseSignatureInfo('not signed at all')), false);
  assert.equal(ms.signatureMatches(devReq, d), true);
  assert.equal(ms.signatureMatches(devReq, s), false);
});

test('requirementIsStable: a code hash changes with every build; a certificate requirement does not', () => {
  assert.equal(ms.requirementIsStable('# designated => cdhash H"e2587e49b33782984335d5a11a8bfd581b759173"'), false);
  assert.equal(ms.requirementIsStable('designated => identifier "com.texacore.installer" and certificate leaf = H"9f1c0f6a3e0e2d9d4f1d8f7b2a6c5e4d3b2a1908"'), true);
  assert.equal(ms.requirementIsStable('designated => identifier "com.texacore.installer" and anchor apple generic and certificate leaf[subject.OU] = "AB12CD34EF"'), true);
  assert.equal(ms.requirementIsStable(''), false);
});

// ── the generated install script, run for real against a fake codesign ──
function runInstall(kind) {
  const dir = mkdtemp('tcx-sig-');
  const staged = path.join(dir, 'staged', 'TexaCore ERP.app'); fs.mkdirSync(path.join(staged, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(staged, 'Contents', 'MacOS', 'x'), 'bin');
  const app = path.join(dir, 'Applications', 'TexaCore ERP.app'); fs.mkdirSync(path.dirname(app), { recursive: true });
  const logFile = path.join(dir, 'calls.log');
  const fakeCodesign = path.join(dir, 'codesign');
  const info = { adhoc: ADHOC, self: SELF, devid: DEVID, unsigned: '' }[kind];
  // -dv prints the info (or "not signed" for an unsigned bundle); --verify passes unless the kind is 'broken'; --sign - is logged
  fs.writeFileSync(fakeCodesign, `#!/bin/bash
echo "codesign $*" >> ${JSON.stringify(logFile)}
case "$1" in
  -dv) if [ ${kind === 'unsigned' ? 1 : 0} = 1 ]; then echo "$2: code object is not signed at all" >&2; exit 1; fi; printf '%s' ${JSON.stringify(info)} >&2; exit 0;;
  --verify) exit ${kind === 'broken' ? 1 : (kind === 'unsigned' ? 1 : 0)};;
  *) exit 0;;
esac
`, { mode: 0o755 });
  const fakeOpen = path.join(dir, 'open'); fs.writeFileSync(fakeOpen, `#!/bin/bash\necho "open $*" >> ${JSON.stringify(logFile)}\n`, { mode: 0o755 });
  const upd = new MacUpdater({ userDataPath: path.join(dir, 'ud'), getVersion: () => '2.0.3', isPackaged: true, log: () => {}, emit: () => {} });
  fs.mkdirSync(path.dirname(upd.installLog), { recursive: true });
  const script = upd.buildInstallScript(app, staged, { codesign: fakeCodesign, open: fakeOpen });
  const sp = path.join(dir, 'install.sh'); fs.writeFileSync(sp, script, { mode: 0o755 });
  const r = spawnSync('/bin/bash', [sp, '99999999'], { encoding: 'utf8', timeout: 60000 });
  const calls = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  const log = fs.existsSync(upd.installLog) ? fs.readFileSync(upd.installLog, 'utf8') : '';
  return { r, calls, log, app };
}

test('the install script KEEPS a valid non-ad-hoc signature (a self-signed or Developer ID build) - it never calls codesign --sign', { skip: process.platform === 'win32' }, () => {
  for (const kind of ['self', 'devid']) {
    const { r, calls, log, app } = runInstall(kind);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(app, 'Contents', 'MacOS', 'x')), 'the new bundle was installed');
    assert.ok(!/--sign/.test(calls), `${kind}: no re-signing\n${calls}`);
    assert.match(log, /signature kept \(valid, not ad-hoc\)/);
    assert.match(calls, /^open /m, 'and the app is relaunched');
  }
});

test('the install script signs ad-hoc exactly as before when the signature is ad-hoc, missing or broken (every build before 2.0.4)', { skip: process.platform === 'win32' }, () => {
  for (const kind of ['adhoc', 'unsigned', 'broken']) {
    const { r, calls, log } = runInstall(kind === 'broken' ? 'broken' : kind);
    assert.equal(r.status, 0, r.stderr);
    assert.match(calls, /codesign --force --deep --sign - /, `${kind}: signed ad-hoc\n${calls}`);
    assert.match(log, /signing ad-hoc/);
  }
});

// ── the owner's secrets and licence across a change of signature ──
test('ad-hoc → self-signed → Developer ID → back: the install\'s secrets and licence are never lost, regenerated or left unreadable', () => {
  const s = require('../src/secrets');
  const v = require('../src/secrets-vault');
  const LicenseGuard = require('../src/license-guard');
  const exe = '/Applications/TexaCore ERP.app/Contents/MacOS/TexaCore ERP';
  const fake = { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from(Buffer.from(t, 'utf8').map((b) => b ^ 0x5a)), decryptString: (b) => Buffer.from(b).map((x) => x ^ 0x5a).toString('utf8') };
  const cfg = { darwin: 'auto' };
  const vaultFor = (codesignText) => {
    const stable = v.macSignatureIsStable(exe, () => ({ status: 0, stderr: codesignText, stdout: '' }));
    return { stable, vault: v.createVault({ safeStorage: fake, policy: v.secretsAtRestPolicy({ platform: 'darwin', config: cfg, macStable: stable }) }) };
  };
  const dir = mkdtemp('tcx-sigsec-');
  // 2.0.3 as installed: ad-hoc → the 0600 file
  const a = vaultFor(ADHOC); assert.equal(a.stable, false);
  const first = s.getOrCreateSecrets(dir, a.vault);
  assert.equal(first.atRest, 'file');
  const lg = new LicenseGuard(dir);
  lg.saveLicense({ license_key: 'TX-OWNER-KEY', tier: 'pro', status: 'active', expires_at: '2030-01-01T00:00:00Z' });
  const licBytes = fs.readFileSync(path.join(dir, 'license.dat'));
  const check = (label, secrets) => {
    for (const k of ['jwtSecret', 'dbPassword', 'localApiSecret', 'anonKey', 'serviceKey', 'authenticatorPassword', 'authAdminPassword']) assert.equal(secrets[k], first[k], `${label}: ${k} unchanged`);
    assert.equal(secrets.created, false, `${label}: nothing regenerated`);
    const lic = new LicenseGuard(dir).loadLicense();
    assert.equal(lic && lic.license_key, 'TX-OWNER-KEY', `${label}: the licence still opens`);
    assert.ok(fs.readFileSync(path.join(dir, 'license.dat')).equals(licBytes), `${label}: licence file untouched`);
  };
  // 2.0.4 signed with a SELF-SIGNED identity (no team id): not "stable" for the Keychain policy → the file stays exactly as it was
  const plainBytes = fs.readFileSync(path.join(dir, 'secrets.json'));
  const self = vaultFor(SELF); assert.equal(self.stable, false);
  check('self-signed', s.getOrCreateSecrets(dir, self.vault));
  assert.ok(fs.readFileSync(path.join(dir, 'secrets.json')).equals(plainBytes), 'self-signed: secrets.json byte-identical');
  assert.ok(!fs.existsSync(path.join(dir, 'secrets.enc')));
  // a Developer ID build: stable → the proven migration moves the secrets into the Keychain-backed file, values unchanged
  const dev = vaultFor(DEVID); assert.equal(dev.stable, true);
  const migrated = s.getOrCreateSecrets(dir, dev.vault);
  assert.equal(migrated.migrated, true);
  check('developer-id', migrated);
  assert.ok(fs.existsSync(path.join(dir, 'secrets.enc')) && !fs.existsSync(path.join(dir, 'secrets.json')));
  // ... and if the app is ever ad-hoc again (a legacy updater re-signed it), an existing secrets.enc is still opened (reading ignores the policy) - never regenerated
  check('back to ad-hoc', s.getOrCreateSecrets(dir, vaultFor(ADHOC).vault));
  assert.ok(fs.existsSync(path.join(dir, 'secrets.enc')));
});

test('nothing in the secrets or the licence code is keyed to the code signature (so changing it cannot lock the owner out)', () => {
  for (const f of ['src/secrets.js', 'src/license-guard.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.doesNotMatch(src, /codesign|cdhash|csreq|DesignatedRequirement/i, f);
  }
});
