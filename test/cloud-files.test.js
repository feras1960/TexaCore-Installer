'use strict';
// 2.0.4: a file that is only a cloud placeholder must become local WITH progress, and be abandoned only when NOTHING moves. Fake children for the exact
// stat / attrib texts and the stall; a real `cat` on a scratch file for the happy path.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const cf = require('../src/cloud-files');
const { mkdtemp } = require('./helpers');

const fakeExec = (stdout, err = null) => (cmd, args, o, cb) => { fakeExec.last = { cmd, args }; cb(err, stdout, ''); };

test('cloudState (macOS): `dataless` in the flags, or a size with no blocks, is a placeholder; a normal file is local; a failed stat falls back to the blocks rule', async () => {
  assert.equal(await cf.cloudState('/x/a.rsf', { platform: 'darwin', execFile: fakeExec('compressed,dataless|25247744|0\n') }), 'placeholder');
  assert.equal(await cf.cloudState('/x/a.rsf', { platform: 'darwin', execFile: fakeExec('-|25247744|49312\n') }), 'local');
  assert.equal(await cf.cloudState('/x/a.rsf', { platform: 'darwin', execFile: fakeExec('-|25247744|0\n') }), 'placeholder', 'a big file with no blocks');
  assert.equal(await cf.cloudState('/x/tiny', { platform: 'darwin', execFile: fakeExec('-|10|0\n') }), 'local', 'a tiny file is never judged');
  assert.equal(await cf.cloudState('/x/a.rsf', { platform: 'darwin', execFile: fakeExec('', new Error('x')), st: { size: 1e6, blocks: 0 } }), 'placeholder');
  assert.equal(await cf.cloudState('/x/a.rsf', { platform: 'darwin', execFile: fakeExec('', new Error('x')), st: { size: 1e6, blocks: 100 } }), 'local');
  assert.deepEqual(fakeExec.last.args.slice(0, 2), ['-f', '%Sf|%z|%b']);
  assert.equal(fakeExec.last.args.at(-1), '/x/a.rsf', 'the path is an argument, never part of a shell string');
});

test('cloudState (Windows): the offline attribute O in attrib\'s output; Linux and unknown answers are local', async () => {
  const off = '    A    O   U       C:\\Users\\a\\OneDrive\\Desktop\\2023.rsf\r\n';
  const on = 'A                   C:\\Users\\a\\Desktop\\2023.rsf\r\n';
  assert.equal(cf.windowsAttribOffline(off), true);
  assert.equal(cf.windowsAttribOffline(on), false);
  assert.equal(cf.windowsAttribOffline(''), false);
  assert.equal(await cf.cloudState('C:\\a.rsf', { platform: 'win32', execFile: fakeExec(off) }), 'placeholder');
  assert.equal(await cf.cloudState('C:\\a.rsf', { platform: 'win32', execFile: fakeExec(on) }), 'local');
  assert.equal(await cf.cloudState('C:\\a.rsf', { platform: 'win32', execFile: fakeExec('', new Error('x')) }), 'local');
  assert.equal(await cf.cloudState('/a.rsf', { platform: 'linux' }), 'local');
});

test('materializeCommands: iCloud gets brctl + a reading child; any other provider just the read; Windows a binary copy to NUL', () => {
  const mac = cf.materializeCommands('/Users/a/Desktop/x.rsf', { platform: 'darwin', icloud: true });
  assert.deepEqual(mac.map((c) => [c.cmd, c.role]), [['/usr/bin/brctl', 'request'], ['/bin/cat', 'read']]);
  assert.deepEqual(mac[0].args, ['download', '--', '/Users/a/Desktop/x.rsf'], '`--` ends the options: a path is never read as a flag (review F3)');
  assert.deepEqual(mac[1].args, ['--', '/Users/a/Desktop/x.rsf']);
  assert.deepEqual(cf.materializeCommands('/p/x', { platform: 'darwin' }).map((c) => c.cmd), ['/bin/cat']);
  assert.deepEqual(cf.materializeCommands('C:\\x.rsf', { platform: 'win32' })[0].args, ['/d', '/c', 'copy', '/b', 'C:\\x.rsf', 'NUL']);
  assert.deepEqual(cf.materializeCommands('/p/x', { platform: 'linux' })[0].args, ['--', '/p/x']);
});

test('Windows (review F3): attrib and cmd.exe have no `--`, so only an absolute drive / UNC path is ever passed, and cmd.exe never gets a path it would re-read as a second command', async () => {
  const win = (p) => cf.materializeCommands(p, { platform: 'win32' });
  assert.equal(win('C:\\Users\\a\\x.rsf').length, 1);
  assert.equal(win('\\\\server\\share\\x.rsf').length, 1);
  assert.equal(win('C:\\Smith & Sons\\x.rsf').length, 1, 'with a space Node quotes the argument: the "&" is literal');
  assert.equal(win('C:\\a(2)\\x (2).rsf').length, 1, 'parentheses are ordinary');
  for (const bad of ['-x.rsf', '/c', 'x.rsf', '..\\x.rsf', 'C:\\R&D\\x.rsf', 'C:\\100%\\x.rsf', 'C:\\a^b\\x.rsf', 'C:\\a"b\\x.rsf', 'C:\\a|b.rsf', 'C:\\a\nb.rsf']) assert.deepEqual(win(bad), [], `${JSON.stringify(bad)} gets no cmd.exe command`);
  // the materialize job fails cleanly instead of running anything
  const { spawn, kids } = fakeSpawn();
  const m = cf.startMaterialize('C:\\R&D\\x.rsf', { size: 1000, platform: 'win32', spawn });
  assert.deepEqual({ state: (await m.done).state, code: (await m.done).code }, { state: 'failed', code: 'UNSAFE_NAME' });
  assert.equal(kids.length, 0, 'no process was started');
  // attrib is only asked about an absolute path; anything else is judged local without running it
  const ex = fakeExec('');
  fakeExec.last = undefined;
  assert.equal(await cf.cloudState('/c', { platform: 'win32', execFile: ex }), 'local');
  assert.equal(fakeExec.last, undefined, 'attrib was not run for a path that could be read as a switch');
  assert.equal(await cf.cloudState('C:\\a.rsf', { platform: 'win32', execFile: ex }), 'local');
  assert.equal(fakeExec.last.cmd, 'attrib');
});

function fakeSpawn() {
  const kids = [];
  const spawn = (cmd, args) => {
    const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.cmd = cmd;
    c.kill = (sig) => { c.killed = sig; c.emit('close', null, sig); };
    kids.push(c);
    return c;
  };
  return { spawn, kids };
}

test('startMaterialize: progress follows the bytes the reader passes on; done when the reader ends well; a keeps-moving download is never cut', async () => {
  const { spawn, kids } = fakeSpawn();
  let t = 0;
  const m = cf.startMaterialize('/p/x.rsf', { size: 1000, platform: 'darwin', spawn, pollMs: 5, stallMs: 50, now: () => t });
  const reader = kids.find((k) => k.cmd === '/bin/cat');
  reader.stdout.emit('data', Buffer.alloc(300));
  assert.deepEqual(m.snapshot(), { state: 'running', loaded: 300, total: 1000 });
  // far longer than stallMs overall, but always moving
  for (let i = 0; i < 6; i++) { t += 40; reader.stdout.emit('data', Buffer.alloc(100)); await new Promise((r) => setTimeout(r, 12)); }
  assert.equal(m.snapshot().state, 'running');
  assert.equal(m.snapshot().loaded, 900);
  reader.emit('close', 0, null);
  const end = await m.done;
  assert.deepEqual(end, { state: 'done', loaded: 1000, total: 1000 });
});

test('startMaterialize: st_blocks on disk counts as progress too (a download that fills the file in place), clamped to the size', async () => {
  const { spawn } = fakeSpawn();
  let blocks = 0;
  const m = cf.startMaterialize('/p/x.rsf', { size: 4096 * 3, platform: 'darwin', spawn, pollMs: 5, stallMs: 5000, statBlocks: async () => blocks });
  blocks = 8; await new Promise((r) => setTimeout(r, 30));
  assert.equal(m.snapshot().loaded, 4096);
  blocks = 1000; await new Promise((r) => setTimeout(r, 30));
  assert.equal(m.snapshot().loaded, 4096 * 3, 'never above the size');
  m.cancel();
});

test('startMaterialize: no byte for stallMs = DOWNLOAD_STALLED, and the children are killed', async () => {
  const { spawn, kids } = fakeSpawn();
  const m = cf.startMaterialize('/p/x.rsf', { size: 1000, platform: 'darwin', icloud: true, spawn, pollMs: 5, stallMs: 60 });
  const end = await m.done;
  assert.deepEqual({ state: end.state, code: end.code }, { state: 'failed', code: 'DOWNLOAD_STALLED' });
  assert.ok(kids.every((k) => k.killed), 'brctl and the reader are both stopped');
});

test('startMaterialize: cancel stops it at once; a failing reader reports why (EPERM / EACCES / ENOENT / EIO)', async () => {
  {
    const { spawn, kids } = fakeSpawn();
    const m = cf.startMaterialize('/p/x.rsf', { size: 1000, spawn, platform: 'darwin' });
    m.cancel();
    assert.equal((await m.done).state, 'cancelled');
    assert.ok(kids[0].killed);
  }
  for (const [text, code] of [['cat: x: Operation not permitted', 'EPERM'], ['cat: x: Permission denied', 'EACCES'], ['cat: x: No such file or directory', 'ENOENT'], ['cat: x: Input/output error', 'EIO']]) {
    const { spawn, kids } = fakeSpawn();
    const m = cf.startMaterialize('/p/x.rsf', { size: 1000, spawn, platform: 'darwin' });
    kids[0].stderr.emit('data', text);
    kids[0].emit('close', 1, null);
    const end = await m.done;
    assert.deepEqual({ state: end.state, code: end.code }, { state: 'failed', code });
  }
});

test('startMaterialize with a real `cat` on a scratch file: done, and the bytes passed on are the file\'s size', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtemp();
  const f = path.join(dir, 'x.rsf'); fs.writeFileSync(f, Buffer.alloc(3 * 1024 * 1024, 7));
  const m = cf.startMaterialize(f, { size: 3 * 1024 * 1024, platform: 'darwin', icloud: false, pollMs: 10, statBlocks: cf.blocksReader(f) });
  const end = await m.done;
  assert.deepEqual({ state: end.state, loaded: end.loaded, total: end.total }, { state: 'done', loaded: 3145728, total: 3145728 });
  const gone = cf.startMaterialize(path.join(dir, 'missing.rsf'), { size: 10, platform: 'darwin' });
  const bad = await gone.done;
  assert.deepEqual({ state: bad.state, code: bad.code }, { state: 'failed', code: 'ENOENT' });
});
