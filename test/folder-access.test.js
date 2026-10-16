'use strict';
// 2.0.4: macOS "Files and Folders" privacy. The reading call that waits for the prompt must block a CHILD process (never the program), the verdict must
// distinguish "still asking" from "no", and an answer given late must still count. Real children on scratch folders (a chmod 000 folder = a real
// denial; a script that sleeps = a prompt nobody answered yet) + fake spawns for the exact `ls` messages macOS prints.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const fa = require('../src/folder-access');
const { mkdtemp } = require('./helpers');

const home = '/Users/someone';
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

test('kindOf: only macOS has these areas; Desktop / Documents / Downloads / iCloud Drive / cloud-provider folders / volumes are told apart (case-insensitively)', () => {
  const k = (p, platform = 'darwin') => fa.kindOf(p, { platform, home });
  assert.equal(k(`${home}/Desktop`), 'desktop');
  assert.equal(k(`${home}/Desktop/حسابات الرشيد/2023.rsf`), 'desktop');
  assert.equal(k(`${home}/documents/TexaCore/x.tcdb`), 'documents');
  assert.equal(k(`${home}/Downloads`), 'downloads');
  assert.equal(k(`${home}/Library/Mobile Documents/com~apple~CloudDocs/x`), 'icloud');
  assert.equal(k(`${home}/Library/CloudStorage/OneDrive-Acme/x`), 'cloud');
  assert.equal(k('/Volumes/USB/x.rsf'), 'volume');
  assert.equal(k(`${home}/Desktopfoo/x`), null, 'a sibling whose name starts the same is not inside');
  assert.equal(k(`${home}/Library/Application Support/texacore-installer/x`), null);
  assert.equal(k('/tmp/x'), null);
  assert.equal(k('relative/Desktop'), null);
  assert.equal(k(`${home}/Desktop/x`, 'win32'), null, 'Windows has no such prompt');
  assert.equal(k(`${home}/Desktop/x`, 'linux'), null);
});

test('classifyLsOutcome: the exact words macOS prints become allowed / denied (EPERM, EACCES) / missing / error', () => {
  const c = (exitCode, stderr, signal = null) => fa.classifyLsOutcome({ exitCode, stderr, signal });
  assert.deepEqual(c(0, ''), { state: 'allowed' });
  assert.deepEqual(c(1, 'ls: /Users/x/Desktop: Operation not permitted\n'), { state: 'denied', code: 'EPERM' });
  assert.deepEqual(c(1, 'ls: /Users/x/Desktop: Permission denied\n'), { state: 'denied', code: 'EACCES' });
  assert.deepEqual(c(1, 'ls: /nope: No such file or directory\n'), { state: 'missing', code: 'ENOENT' });
  assert.deepEqual(c(1, 'ls: /f: Not a directory\n'), { state: 'missing', code: 'ENOENT' });
  assert.equal(c(1, 'something else').state, 'error');
  assert.equal(c(null, '', 'SIGKILL').code, 'SIGKILL');
});

test('startProbe on real folders: a listable folder is allowed, a missing one is missing, a chmod 000 one is denied', { skip: isRoot && 'root ignores folder permissions' }, async () => {
  const dir = mkdtemp();
  const ok = path.join(dir, 'ok'); fs.mkdirSync(ok); fs.writeFileSync(path.join(ok, 'a.txt'), 'x');
  const locked = path.join(dir, 'locked'); fs.mkdirSync(locked); fs.chmodSync(locked, 0o000);
  try {
    assert.equal((await fa.startProbe(ok).done).state, 'allowed');
    assert.equal((await fa.startProbe(path.join(dir, 'nope')).done).state, 'missing');
    const denied = await fa.startProbe(locked).done;
    assert.equal(denied.state, 'denied');
    assert.equal(denied.code, 'EACCES');
  } finally { fs.chmodSync(locked, 0o700); }
});

test('startProbe: a child that never answers (a prompt nobody clicked) is killed at the hard limit and reported as a timeout - the caller is never stuck', async () => {
  const dir = mkdtemp();
  const slow = path.join(dir, 'slow-ls'); fs.writeFileSync(slow, '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
  const t0 = Date.now();
  const v = await fa.startProbe(dir, { lsPath: slow, hardMs: 300 }).done;
  assert.equal(v.state, 'timeout');
  assert.ok(Date.now() - t0 < 5000);
});

test('startProbe: a spawn that throws / emits an error is an error verdict, never an exception', async () => {
  const v1 = await fa.startProbe('/x', { spawn: () => { throw new Error('boom'); } }).done;
  assert.deepEqual({ state: v1.state, code: v1.code }, { state: 'error', code: 'SPAWN' });
  const fake = new EventEmitter(); fake.stderr = new EventEmitter(); fake.kill = () => {};
  const p = fa.startProbe('/x', { spawn: () => fake });
  fake.emit('error', new Error('ENOENT'));
  assert.equal((await p.done).state, 'error');
});

// a fake `ls` the test controls: it ends when the test says so, with the stderr text of the case
function fakeSpawnFactory() {
  const calls = [];
  const spawn = (cmd, args, o) => {
    const child = new EventEmitter(); child.stderr = new EventEmitter();
    child.kill = () => { child.killed = true; child.emit('close', null, 'SIGKILL'); };
    child.finish = (code, text = '') => { if (text) child.stderr.emit('data', text); child.emit('close', code, null); };
    calls.push({ cmd, args, opts: o, child });
    return child;
  };
  return { spawn, calls };
}

test('the probe is a child process, spawned with stdout discarded, a fixed PATH and the C locale (so the error text is English)', () => {
  const { spawn, calls } = fakeSpawnFactory();
  const acc = fa.createFolderAccess({ platform: 'darwin', home, spawn });
  void acc.check('desktop', { waitMs: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, '/bin/ls');
  assert.deepEqual(calls[0].args, ['-1', '--', `${home}/Desktop`]);
  assert.equal(calls[0].opts.stdio[1], 'ignore');
  assert.equal(calls[0].opts.env.LC_ALL, 'C');
});

test('check(): still asking → "pending" after the soft wait; the probe keeps running and the late "Allow" flips the verdict to allowed - nothing is retried, nothing is lost', async () => {
  const { spawn, calls } = fakeSpawnFactory();
  let t = 1000; const now = () => t;
  const acc = fa.createFolderAccess({ platform: 'darwin', home, spawn, now });
  const first = await acc.check('documents', { waitMs: 20 });
  assert.equal(first.state, 'pending');
  assert.equal(calls.length, 1);
  // asked again while the prompt is up: the SAME probe, no second child
  t += 2000;
  const second = await acc.check('documents', { waitMs: 20 });
  assert.equal(second.state, 'pending');
  assert.ok(second.sinceMs >= 2000);
  assert.equal(calls.length, 1, 'one child per area while it is pending');
  // the user clicks Allow
  calls[0].child.finish(0);
  const third = await acc.check('documents', { waitMs: 200 });
  assert.equal(third.state, 'allowed');
  assert.equal(calls.length, 1, 'an allowed verdict is trusted for a while - no new child');
});

test('check(): "Don\'t Allow" = denied EPERM at once; a retry right after probes again (the user may have switched it on in System Settings)', async () => {
  const { spawn, calls } = fakeSpawnFactory();
  let t = 0; const now = () => t;
  const acc = fa.createFolderAccess({ platform: 'darwin', home, spawn, now });
  const p = acc.check('desktop', { waitMs: 500 });
  calls[0].child.finish(1, 'ls: /Users/someone/Desktop: Operation not permitted\n');
  const v = await p;
  assert.deepEqual({ state: v.state, code: v.code }, { state: 'denied', code: 'EPERM' });
  // inside the short denied window the verdict is reused ...
  assert.equal((await acc.check('desktop', { waitMs: 50 })).state, 'denied');
  assert.equal(calls.length, 1);
  // ... then a retry probes again, and now it works
  t += 5000;
  const again = acc.check('desktop', { waitMs: 500 });
  assert.equal(calls.length, 2);
  calls[1].child.finish(0);
  assert.equal((await again).state, 'allowed');
});

test('check(): an area that is not protected (Windows, Linux, an unknown name) is allowed without any child', async () => {
  const { spawn, calls } = fakeSpawnFactory();
  const win = fa.createFolderAccess({ platform: 'win32', home, spawn });
  assert.equal((await win.check('desktop')).state, 'allowed');
  assert.equal((await win.ensureUsable('C:\\Users\\a\\Desktop\\x')).state, 'allowed');
  const mac = fa.createFolderAccess({ platform: 'darwin', home, spawn });
  assert.equal((await mac.check('nonsense')).state, 'allowed');
  assert.equal((await mac.ensureUsable('/tmp/whatever')).state, 'allowed');
  assert.equal(calls.length, 0);
});

test('ensureUsable: a path inside Documents probes Documents; a volume probes its own root', async () => {
  const { spawn, calls } = fakeSpawnFactory();
  const acc = fa.createFolderAccess({ platform: 'darwin', home, spawn });
  void acc.ensureUsable(`${home}/Documents/TexaCore/x.tcdb`, { waitMs: 0 });
  void acc.ensureUsable('/Volumes/USB DISK/a/b.rsf', { waitMs: 0 });
  assert.deepEqual(calls.map((c) => c.args[2]), [`${home}/Documents`, '/Volumes/USB DISK']);
});

test('simulate (harness): a fake verdict, with an optional delay, replaces the probe', async () => {
  const acc = fa.createFolderAccess({ platform: 'linux', home, simulate: (k) => (k === 'desktop' ? { state: 'denied' } : k === 'documents' ? { state: 'allowed', delayMs: 120 } : null), spawn: () => { throw new Error('no child expected'); } });
  const d = await acc.check('desktop', { waitMs: 100 });
  assert.deepEqual({ state: d.state, code: d.code }, { state: 'denied', code: 'EPERM' });
  const docs = await acc.check('documents', { waitMs: 10 });
  assert.equal(docs.state, 'pending');
  assert.equal((await acc.settle('documents')).state, 'allowed');
});

test('settingsUrls: the Files and Folders pane first, the broader Privacy pane as the fallback', () => {
  assert.deepEqual(fa.settingsUrls(), ['x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders', 'x-apple.systempreferences:com.apple.preference.security']);
});
