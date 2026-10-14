'use strict';
// The self-updaters' download, against a local imitation of GitHub (scripts/e2e/mock-github.js, plain-HTTP mode: the same 302 → 302 → CDN chain, Range / If-Range /
// ETag, and faults injected at chosen offsets). The code under test is the real src/mac-updater.js + src/update-downloader.js (+ src/win-updater.js for the hand-over).
//
//   resume          a connection dropped at ~40 % and again at ~80 % is picked up with Range (the bytes already on disk are never fetched twice) and the sha512 verifies
//   stall           a server that stops sending without closing → the stall detector drops the socket and resumes
//   restart         the app quits mid-download → the partial survives cleanupIfStale and is resumed at the next start
//   no Range        a server that ignores Range (200) → start over, still succeed
//   corrupt bytes   sha512 mismatch → deleted, downloaded again, never staged; a CDN that keeps corrupting → "failed-verify" and nothing staged
//   pause           no network activity while paused, also after a restart; resume continues
//   plus            disk space, network-up, HTTP errors, a replaced release, stale cleanup rules, the obfuscated engine, the Windows hand-over, the status reducer
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createMockGithub, OWNER_REPO } = require('../scripts/e2e/mock-github');
const { MacUpdater, applyUpdateEvent, createUpdateStatus } = require('../src/mac-updater');
const { UpdateDownloader, readSidecar } = require('../src/update-downloader');
const { mkdtemp } = require('./helpers');

const MB = 1024 * 1024;
const VERSION = '9.9.9';
const CURRENT = '2.0.1';
const ZIP = `TexaCore-ERP-${VERSION}-arm64.zip`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha512b64 = (buf) => crypto.createHash('sha512').update(buf).digest('base64');

async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out (${ms} ms) waiting for ${what}`);
    await sleep(15);
  }
}

/** A release on the mock: random bytes of `size`, its yml, and the spec of the asset (faults etc.). */
async function env({ size = 6 * MB, spec = {}, version = VERSION } = {}) {
  const dir = mkdtemp('upd-resume-');
  const zip = path.join(dir, `TexaCore-ERP-${version}-arm64.zip`);
  const bytes = crypto.randomBytes(size);
  fs.writeFileSync(zip, bytes);
  const sha = sha512b64(bytes);
  const yml = path.join(dir, 'latest-mac.yml');
  const writeYml = (v = version, s = sha, n = size) => fs.writeFileSync(yml, `version: ${v}\nfiles:\n  - url: TexaCore-ERP-${v}-arm64.zip\n    sha512: ${s}\n    size: ${n}\npath: TexaCore-ERP-${v}-arm64.zip\nsha512: ${s}\nreleaseDate: '2026-10-14T00:00:00.000Z'\n`);
  writeYml();
  const files = { 'latest-mac.yml': { path: yml }, [`TexaCore-ERP-${version}-arm64.zip`]: { path: zip, ...spec } };
  const mock = createMockGithub({ plain: true, releases: { [`v${version}`]: { files } }, latest: `v${version}` });
  await mock.listen();
  const userData = path.join(dir, 'userdata');
  const logs = []; const events = []; const staged = [];
  const state = { online: true, free: null };
  const base = `${mock.base}${OWNER_REPO}/releases/latest/download/`;
  const make = (extra = {}) => new MacUpdater({
    getVersion: () => CURRENT, userDataPath: userData, isPackaged: false,
    log: (...a) => logs.push(a.join(' ')),
    emit: (ch, p) => events.push([ch, p]),
    onStaged: () => {},
    feedUrl: `${base}latest-mac.yml`, assetBase: base, allowInsecureHttp: true,
    stage: async (file, stagedDir) => {                 // a fake extraction (the real one is /usr/bin/ditto): record WHAT was staged
      const actual = sha512b64(fs.readFileSync(file));
      staged.push(actual);
      const app = path.join(stagedDir, 'TexaCore ERP.app');
      fs.mkdirSync(app, { recursive: true }); fs.writeFileSync(path.join(app, 'archive.sha512'), actual);
      return app;
    },
    isOnline: () => state.online,
    freeBytes: () => state.free,
    checkInitialDelayMs: 1e9, checkIntervalMs: 1e9,
    engine: { stallMs: 400, connectTimeoutMs: 3000, backoffMs: [40, 60, 80], jitter: 0, progressEveryMs: 5, syncEveryBytes: 256 * 1024, failedVerifyRetryMs: 150, noSpaceRecheckMs: 80,
      networkUpDebounceMs: 0, refreshEveryMs: 1e9, ...(extra.engine || {}) },
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'engine')),
  });
  const phases = () => events.filter(([c]) => c === 'update-status').map(([, p]) => p.phase);
  const codes = () => events.filter(([c, p]) => c === 'update-status' && p.errorCode).map(([, p]) => p.errorCode);
  const stateFile = path.join(userData, 'updates', 'staged.json');
  const cleanup = async (...updaters) => { for (const u of updaters) { try { await u.stop(); } catch { /* */ } } await mock.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { dir, zip, bytes, sha, size, mock, userData, logs, events, staged, state, make, phases, codes, stateFile, writeYml, yml, cleanup,
    pendingDir: path.join(userData, 'updates', 'pending'), controlFile: path.join(userData, 'updates', 'control.json') };
}
const isReady = (u) => () => u.dl.phase() === 'ready';
/** The first byte a Range request asks for. */
const rangeStart = (r) => Number(/^bytes=(\d+)-$/.exec(r.range || '')[1]);
/** The client resumes at the end of what it had WRITTEN: bytes the server had sent but the client had not yet written when the socket died are asked for again (a few KB, never more than a read-ahead window). */
const SLACK = 512 * 1024;

test('drops at ~40 % and ~80 %: each retry resumes with Range + If-Range at the byte where it stopped, no byte is fetched twice, the sha512 verifies, the update is staged', async () => {
  const e = await env({ spec: { faults: [{ at: 0.4, kind: 'drop' }, { at: 0.8, kind: 'drop' }] } });
  const u = e.make();
  try {
    u.cleanupIfStale(); u.start();
    const r = await u.checkAndDownload();
    await waitFor(isReady(u), 20000, 'the update to be ready');
    const d = e.mock.dataRequests();
    assert.equal(d.length, 3, `3 data requests: ${JSON.stringify(d.map((x) => [x.status, x.range, x.bytes]))}`);
    assert.equal(d[0].range, null); assert.equal(d[0].status, 200);
    assert.equal(d[0].bytes, Math.floor(0.4 * e.size), 'the first response was cut at 40 %');
    const s1 = rangeStart(d[1]); const s2 = rangeStart(d[2]);
    assert.ok(s1 <= d[0].bytes && d[0].bytes - s1 < SLACK, `resumed where the first one ended (${s1} vs ${d[0].bytes})`); assert.equal(d[1].status, 206);
    assert.ok(d[1].ifRange && d[1].ifRange.startsWith('"'), 'If-Range carries the ETag');
    assert.ok(s2 <= s1 + d[1].bytes && s1 + d[1].bytes - s2 < SLACK && s2 > s1, `…and again after the second cut (${s2})`); assert.equal(d[2].status, 206);
    assert.ok(e.logs.some((l) => l.includes(`resuming at ${s1} `)) && e.logs.some((l) => l.includes(`resuming at ${s2} `)), 'the log says where it resumed');
    assert.equal(s2 + d[2].bytes, e.size, 'the last response ends at the end of the file');
    const refetched = d[0].bytes + d[1].bytes + d[2].bytes - e.size;
    assert.ok(refetched >= 0 && refetched < 2 * SLACK, `at most a read-ahead window was fetched twice (${refetched} B), never the part already saved (${(0.8 * e.size / MB).toFixed(1)} MB)`);
    assert.deepEqual(e.staged, [e.sha], 'one staging, of the verified bytes');
    assert.ok(fs.existsSync(e.stateFile), 'staged.json written');
    assert.ok(!fs.existsSync(e.pendingDir), 'the archive and the sidecar are removed after staging');
    const ph = e.phases();
    for (const p of ['downloading', 'waiting-retry', 'verifying', 'staging', 'ready']) assert.ok(ph.includes(p), `phase ${p} reported: ${ph.join(',')}`);
    assert.ok(e.codes().includes('network'));
    assert.ok(e.events.some(([c]) => c === 'update-downloaded'));
    assert.ok(r === undefined || true);
  } finally { await e.cleanup(u); }
});

test('the redirect chain is followed again on every resume (the signed CDN URL expires) — feed, tag URL, CDN each time; the tagged URL is remembered', async () => {
  const e = await env({ spec: { faults: [{ at: 0.5, kind: 'drop' }] } });
  const u = e.make();
  try {
    u.start(); await u.checkAndDownload();
    await waitFor(isReady(u), 20000, 'ready');
    const hops = e.mock.state.requests.filter((r) => r.status === 302).map((r) => r.path);
    assert.ok(hops.some((p) => /\/releases\/latest\/download\//.test(p)), 'the feed URL redirected to the tag');
    assert.ok(hops.filter((p) => /\/releases\/download\/v9\.9\.9\//.test(p)).length >= 2, 'the tagged URL was asked again for the resume');
    assert.ok(e.logs.some((l) => /resuming at \d+/.test(l)));
  } finally { await e.cleanup(u); }
});

test('a stall (the server stops sending without closing) is detected after stallMs, the socket is dropped and the download resumes with Range', async () => {
  const e = await env({ spec: { faults: [{ at: 0.5, kind: 'stall', ms: 8000 }] } });
  const u = e.make({ engine: { stallMs: 300 } });
  try {
    u.start(); await u.checkAndDownload();
    const t0 = Date.now();
    await waitFor(isReady(u), 20000, 'ready after a stall');
    const d = e.mock.dataRequests();
    assert.equal(d.length, 2);
    assert.equal(d[0].faulted, 'stall');
    assert.equal(d[1].range, `bytes=${Math.floor(0.5 * e.size)}-`, 'nothing was lost in a stall: the resume starts where the stalled response stopped');
    assert.ok(e.codes().includes('stall'), `error code stall reported: ${e.codes()}`);
    assert.ok(Date.now() - t0 < 6000, 'resumed long before the server would have closed the stalled socket');
    assert.deepEqual(e.staged, [e.sha]);
  } finally { await e.cleanup(u); }
});

test('RESTART mid-download: the partial file and its sidecar survive cleanupIfStale and the next start resumes with Range — straight away, after one look at the feed', async () => {
  const e = await env({ spec: { faults: [{ at: 0.45, kind: 'drop' }] } });
  const a = e.make({ engine: { backoffMs: [60000] } });                  // after the drop A is waiting; we quit it there
  let b = null;
  try {
    a.cleanupIfStale(); a.start(); await a.checkAndDownload();
    await waitFor(() => a.dl.getStatus().phase === 'waiting-retry', 15000, 'the drop');
    await a.stop();                                                       // the app quits
    const part = path.join(e.pendingDir, `${ZIP}.part`);
    const kept = fs.statSync(part).size;
    assert.ok(kept <= Math.floor(0.45 * e.size) && Math.floor(0.45 * e.size) - kept < SLACK, `the bytes received before the drop are on disk (${kept})`);
    const side = readSidecar(e.pendingDir);
    assert.ok(side && side.version === VERSION && side.bytes === kept && side.expectedSha512 === e.sha, `sidecar ${JSON.stringify(side)}`);

    b = e.make();                                                         // the app starts again
    const before = e.mock.state.requests.length;
    b.cleanupIfStale();
    assert.equal(fs.statSync(part).size, kept, 'cleanupIfStale kept the partial download');
    assert.ok(e.logs.some((l) => /keeping the pending download of v9\.9\.9/.test(l)));
    b.start();                                                            // restore → one look at the feed → resumes (not 15 s or 6 h later: the checks are parked at 1e9 ms here)
    await waitFor(isReady(b), 20000, 'the resumed download to finish');
    const d = e.mock.dataRequests();
    assert.equal(d.length, 2, 'one more data request only');
    assert.equal(d[1].range, `bytes=${kept}-`); assert.equal(d[1].status, 206);
    assert.equal(kept + d[1].bytes, e.size, 'the continuation is exactly the rest of the file');
    assert.deepEqual(e.staged, [e.sha]);
    const after = e.mock.state.requests.slice(before);
    assert.ok(after.some((r) => r.asset === 'latest-mac.yml'), 'the feed was looked at first');
    assert.ok(after.findIndex((r) => r.asset === 'latest-mac.yml') < after.findIndex((r) => r.asset === ZIP), '…and only then the file was asked for');
  } finally { await e.cleanup(a, b || a); }
});

test('after a restart only the bytes that were fsynced are trusted (a power cut can leave a file whose length is ahead of its contents)', async () => {
  const e = await env();
  const dir = e.pendingDir; fs.mkdirSync(dir, { recursive: true });
  const part = path.join(dir, `${ZIP}.part`);
  fs.writeFileSync(part, e.bytes.subarray(0, 3 * MB));
  fs.writeFileSync(path.join(dir, 'pending.json'), JSON.stringify({ schema: 1, version: VERSION, fileName: ZIP, url: `${e.mock.base}${OWNER_REPO}/releases/latest/download/${ZIP}`, pinnedUrl: null,
    expectedSize: e.size, expectedSha512: e.sha, etag: null, lastModified: null, bytes: 1 * MB, verifyFailures: 0 }));
  const u = e.make();
  try {
    u.cleanupIfStale(); u.start();
    await waitFor(isReady(u), 20000, 'ready');
    const d = e.mock.dataRequests();
    assert.equal(d[0].range, `bytes=${1 * MB}-`, 'resumed at the synced offset, not at the file length');
    assert.deepEqual(e.staged, [e.sha]);
  } finally { await e.cleanup(u); }
});

test('a server that ignores Range (200 + the whole file) after a drop: start over from 0 and still succeed', async () => {
  const e = await env({ spec: { ignoreRange: true, faults: [{ at: 0.4, kind: 'drop' }] } });
  const u = e.make();
  try {
    u.start(); await u.checkAndDownload();
    await waitFor(isReady(u), 20000, 'ready');
    const d = e.mock.dataRequests();
    assert.equal(d.length, 2);
    assert.ok(rangeStart(d[1]) > 0, 'the client asked for a range');
    assert.equal(d[1].status, 200); assert.equal(d[1].bytes, e.size, 'the server sent everything again');
    assert.ok(e.logs.some((l) => /whole file \(no Range support/.test(l)));
    assert.deepEqual(e.staged, [e.sha], 'and the file is exactly right (not 40 % + a whole file)');
  } finally { await e.cleanup(u); }
});

test('a CDN that corrupts the first response: sha512 mismatch → the file is deleted and downloaded again → verified; the bad file is NEVER staged', async () => {
  const e = await env({ spec: { corruptTimes: 1 } });
  const u = e.make();
  try {
    u.start(); await u.checkAndDownload();
    await waitFor(isReady(u), 20000, 'ready after a mismatch');
    assert.equal(e.mock.dataRequests().length, 2, 'downloaded twice');
    assert.ok(e.logs.some((l) => /sha512 mismatch/.test(l)), 'the mismatch is logged');
    assert.deepEqual(e.staged, [e.sha], 'staging happened once, with the CLEAN bytes');
    assert.ok(e.phases().filter((p) => p === 'verifying').length >= 2);
    assert.ok(e.codes().includes('verify'));
  } finally { await e.cleanup(u); }
});

test('a CDN that keeps corrupting: after 3 mismatches in a row → failed-verify, nothing staged, no staged.json; «retry now» after the CDN is fixed completes', async () => {
  const e = await env({ spec: { tamper: true } });
  const u = e.make({ engine: { failedVerifyRetryMs: 600000 } });
  try {
    u.start(); await u.checkAndDownload();
    await waitFor(() => u.dl.getStatus().phase === 'failed-verify', 20000, 'failed-verify');
    assert.equal(e.mock.dataRequests().length, 3);
    assert.deepEqual(e.staged, []);
    assert.ok(!fs.existsSync(e.stateFile));
    const part = path.join(e.pendingDir, `${ZIP}.part`);
    assert.ok(!fs.existsSync(part) && !fs.existsSync(path.join(e.pendingDir, ZIP)), 'the bad file was deleted');
    assert.equal(u.dl.getStatus().errorCode, 'verify');
    e.mock.state.releases[`v${VERSION}`].files[ZIP].tamper = false;      // the CDN is fixed
    u.retryNow();
    await waitFor(isReady(u), 20000, 'ready after retry now');
    assert.deepEqual(e.staged, [e.sha]);
  } finally { await e.cleanup(u); }
});

test('PAUSE: the in-flight request is cut, nothing touches the network while paused (also not the scheduled check), the pause survives a restart, RESUME continues with Range', async () => {
  const e = await env({ size: 5 * MB, spec: { bytesPerSec: 3 * MB } });
  const u = e.make();
  let v = null;
  try {
    u.start(); await u.checkAndDownload();
    await waitFor(() => u.dl.getStatus().bytesDone > 0.8 * MB, 15000, 'some bytes');
    assert.equal(u.pause(), true);
    assert.equal(u.dl.getStatus().phase, 'paused'); assert.equal(u.dl.getStatus().paused, true);
    const heldBytes = u.dl.getStatus().bytesDone;
    assert.ok(heldBytes > 0 && heldBytes < e.size);
    await sleep(120);
    const frozen = e.mock.state.requests.length;
    await u.checkAndDownload();                                          // the scheduled check while paused: skipped, no request
    await sleep(500);
    assert.equal(e.mock.state.requests.length, frozen, 'no request at all while paused');
    assert.equal(JSON.parse(fs.readFileSync(e.controlFile, 'utf8')).paused, true, 'the pause is persisted');
    assert.ok(readSidecar(e.pendingDir), 'the sidecar is there');
    await u.stop();

    v = e.make();                                                         // restart
    v.cleanupIfStale(); v.start();
    assert.equal(v.dl.isPaused(), true, 'still paused after the restart');
    assert.equal(v.dl.getStatus().phase, 'paused');
    await v.checkAndDownload();
    await sleep(400);
    assert.equal(e.mock.state.requests.length, frozen, 'still no request after the restart');
    v.resume();
    await waitFor(isReady(v), 20000, 'ready after resume');
    const d = e.mock.dataRequests();
    const last = d[d.length - 1];
    assert.match(last.range, /^bytes=\d+-$/, 'the continuation is a Range request');
    assert.ok(Number(/\d+/.exec(last.range)[0]) > 0.5 * MB);
    assert.deepEqual(e.staged, [e.sha]);
    assert.ok(!fs.existsSync(e.controlFile), 'the pause flag is cleared by resume');
  } finally { await e.cleanup(u, v || u); }
});

test('not enough disk space (need = what is left + 2 × size for staging): a clear status, no download started, re-checked, goes on by itself when space appears', async () => {
  const e = await env();
  e.state.free = 5 * MB;
  const u = e.make();
  try {
    u.start(); await u.checkAndDownload();
    await waitFor(() => u.dl.getStatus().errorCode === 'no-space', 10000, 'the no-space status');
    const st = u.dl.getStatus();
    assert.equal(st.phase, 'waiting-retry');
    assert.ok(st.needBytes >= 3 * e.size && st.freeBytes === 5 * MB, `need ${st.needBytes} free ${st.freeBytes}`);
    assert.equal(e.mock.dataRequests().length, 0, 'nothing was downloaded');
    await sleep(300);
    assert.equal(u.dl.getStatus().errorCode, 'no-space', 'still checking');
    e.state.free = 10 * 1024 * MB;
    await waitFor(isReady(u), 20000, 'ready once there is room');
    assert.deepEqual(e.staged, [e.sha]);
  } finally { await e.cleanup(u); }
});

test('the network coming back retries at once instead of waiting out the backoff; a wake from sleep drops the old connection and resumes', async () => {
  const e = await env({ size: 5 * MB, spec: { faults: [{ at: 0.3, kind: 'drop' }], bytesPerSec: 4 * MB } });
  const u = e.make({ engine: { backoffMs: [60000] } });
  try {
    u.start(); await u.checkAndDownload();
    await waitFor(() => u.dl.getStatus().phase === 'waiting-retry', 15000, 'the drop');
    const s = u.dl.getStatus();
    assert.ok(s.nextRetryInSec > 30, `a 60 s wait is scheduled (${s.nextRetryInSec})`);
    e.state.online = false; await sleep(30); e.state.online = true;
    u.networkUp('online');
    await waitFor(isReady(u), 10000, 'ready right after the network event');

    // sleep/wake while a download is running: the socket from before the sleep is dead; the updater drops it and resumes at once
    const f = await env({ size: 5 * MB, spec: { bytesPerSec: 2 * MB } });
    const w = f.make();
    try {
      w.start(); await w.checkAndDownload();
      await waitFor(() => w.dl.getStatus().bytesDone > 0.5 * MB, 15000, 'bytes');
      w.networkUp('resume');
      await waitFor(() => f.mock.dataRequests().length >= 2, 10000, 'the second request');
      assert.match(f.mock.dataRequests()[1].range, /^bytes=\d+-$/);
      await waitFor(isReady(w), 20000, 'ready after the wake');
    } finally { await f.cleanup(w); }
  } finally { await e.cleanup(u); }
});

test('HTTP errors (503 twice) are retried with backoff and reported; the download then completes', async () => {
  const e = await env({ spec: { httpFail: { code: 503, times: 2 } } });
  const u = e.make();
  try {
    u.start(); await u.checkAndDownload();
    await waitFor(isReady(u), 20000, 'ready after 503s');
    assert.ok(e.codes().includes('http'));
    assert.ok(e.logs.some((l) => /HTTP 503/.test(l)));
    assert.deepEqual(e.staged, [e.sha]);
  } finally { await e.cleanup(u); }
});

test('the backoff is exponential with a cap, retries forever, and starts over once an attempt made progress', async () => {
  const dir = mkdtemp('upd-backoff-');
  const phases = [];
  const d = new UpdateDownloader({ dir: path.join(dir, 'pending'), backoffMs: [15e3, 30e3, 60e3, 120e3, 300e3, 600e3], jitter: 0.2, random: () => 0.5, onStatus: (s) => phases.push(s.phase) });
  const seq = []; for (let i = 0; i < 9; i++) seq.push(d._nextBackoff(false));
  assert.deepEqual(seq, [15e3, 30e3, 60e3, 120e3, 300e3, 600e3, 600e3, 600e3, 600e3], 'capped at 10 minutes, never ends');
  assert.equal(d._nextBackoff(true), 15e3, 'progress resets it');
  const lo = new UpdateDownloader({ dir: path.join(dir, 'p2'), random: () => 0 }); const hi = new UpdateDownloader({ dir: path.join(dir, 'p3'), random: () => 1 });
  assert.equal(lo._jitter(10000), 8000); assert.equal(hi._jitter(10000), 12000, '±20 %');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cleanupIfStale: a pending download for a NEWER version is kept; version <= current, a corrupt sidecar, or no sidecar wipe it; an old staged update is wiped', async () => {
  const e = await env();
  try {
    const side = (version) => ({ schema: 1, version, fileName: ZIP, url: 'http://127.0.0.1/x', pinnedUrl: null, expectedSize: e.size, expectedSha512: e.sha, etag: null, lastModified: null, bytes: 10, verifyFailures: 0 });
    const put = (obj, raw) => { fs.rmSync(e.pendingDir, { recursive: true, force: true }); fs.mkdirSync(e.pendingDir, { recursive: true }); fs.writeFileSync(path.join(e.pendingDir, `${ZIP}.part`), 'x'.repeat(10)); fs.writeFileSync(path.join(e.pendingDir, 'pending.json'), raw !== undefined ? raw : JSON.stringify(obj)); };
    const u = () => e.make();
    put(side('2.0.2')); u().cleanupIfStale(); assert.ok(fs.existsSync(path.join(e.pendingDir, `${ZIP}.part`)), 'newer: kept');
    put(side('2.0.1')); u().cleanupIfStale(); assert.ok(!fs.existsSync(e.pendingDir), 'same version as the running one: wiped');
    put(side('2.0.0')); u().cleanupIfStale(); assert.ok(!fs.existsSync(e.pendingDir), 'older: wiped');
    put(null, '{ not json'); u().cleanupIfStale(); assert.ok(!fs.existsSync(e.pendingDir), 'corrupt sidecar: wiped');
    put({ ...side('2.0.2'), fileName: '../../evil' }); u().cleanupIfStale(); assert.ok(!fs.existsSync(e.pendingDir), 'a sidecar naming a path outside the folder is not valid');
    put({ ...side('2.0.2'), expectedSize: 'big' }); u().cleanupIfStale(); assert.ok(!fs.existsSync(e.pendingDir), 'wrong types: wiped');
    // an OLD staged update (<= current) goes together with everything else
    fs.mkdirSync(path.join(e.userData, 'updates', 'staged', 'TexaCore ERP.app'), { recursive: true });
    fs.writeFileSync(e.stateFile, JSON.stringify({ version: '2.0.1', appPath: path.join(e.userData, 'updates', 'staged', 'TexaCore ERP.app') }));
    put(side('2.0.2')); u().cleanupIfStale();
    assert.ok(!fs.existsSync(e.stateFile) && !fs.existsSync(path.join(e.userData, 'updates', 'staged')) && !fs.existsSync(e.pendingDir));
    // a NEWER staged update stays (and a stale pending download beside it goes)
    fs.mkdirSync(path.join(e.userData, 'updates', 'staged', 'TexaCore ERP.app'), { recursive: true });
    fs.writeFileSync(e.stateFile, JSON.stringify({ version: '2.0.2', appPath: path.join(e.userData, 'updates', 'staged', 'TexaCore ERP.app') }));
    put(side('2.0.2')); u().cleanupIfStale();
    assert.ok(fs.existsSync(e.stateFile) && !fs.existsSync(e.pendingDir));
    // a stale pause flag (nothing left to resume) is forgotten
    fs.rmSync(path.join(e.userData, 'updates'), { recursive: true, force: true }); fs.mkdirSync(path.join(e.userData, 'updates'), { recursive: true });
    fs.writeFileSync(e.controlFile, JSON.stringify({ paused: true }));
    const w = u(); assert.equal(w.dl.isPaused(), true); w.cleanupIfStale(); assert.equal(w.dl.isPaused(), false); assert.ok(!fs.existsSync(e.controlFile));
  } finally { await e.cleanup(); }
});

test('the feed changing under a kept partial (same version, new sha512) wipes it at the first feed check and downloads from zero', async () => {
  const e = await env();
  try {
    const dir = e.pendingDir; fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${ZIP}.part`), Buffer.alloc(2 * MB, 7));
    fs.writeFileSync(path.join(dir, 'pending.json'), JSON.stringify({ schema: 1, version: VERSION, fileName: ZIP, url: `${e.mock.base}${OWNER_REPO}/releases/latest/download/${ZIP}`, pinnedUrl: null,
      expectedSize: e.size, expectedSha512: 'OLD-RELEASE-SHA', etag: null, lastModified: null, bytes: 2 * MB, verifyFailures: 0 }));
    const u = e.make({ engine: { backoffMs: [40], noSpaceRecheckMs: 40 }, freeBytes: () => 0 });   // restored target can not start (no space) → the feed check decides
    u.cleanupIfStale(); u.start();
    assert.equal(u.dl.getTarget().sha512, 'OLD-RELEASE-SHA');
    await u.stop();
    const v = e.make();
    v.cleanupIfStale(); v.start();
    await v.checkAndDownload();                                          // the feed names the real sha512 → another target → the old partial is dropped
    await waitFor(isReady(v), 20000, 'ready');
    const d = e.mock.dataRequests();
    assert.equal(d[0].range, null, 'started from zero');
    assert.deepEqual(e.staged, [e.sha]);
    await e.cleanup(v);
  } catch (err) { await e.cleanup(); throw err; }
});

test('a partial that is already complete on disk is verified and staged without any data request', async () => {
  const e = await env();
  const dir = e.pendingDir; fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${ZIP}.part`), e.bytes);
  fs.writeFileSync(path.join(dir, 'pending.json'), JSON.stringify({ schema: 1, version: VERSION, fileName: ZIP, url: `${e.mock.base}${OWNER_REPO}/releases/latest/download/${ZIP}`, pinnedUrl: null,
    expectedSize: e.size, expectedSha512: e.sha, etag: null, lastModified: null, bytes: e.size, verifyFailures: 0 }));
  const u = e.make();
  try {
    u.cleanupIfStale(); u.start();
    await waitFor(isReady(u), 20000, 'ready');
    assert.equal(e.mock.dataRequests().length, 0, 'no request for the file (only the quick look at the feed)');
    assert.deepEqual(e.staged, [e.sha]);
  } finally { await e.cleanup(u); }
});

test('the feed saying "no update" (release withdrawn) drops a kept partial; an offline feed check changes nothing', async () => {
  const e = await env();
  try {
    const dir = e.pendingDir; fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${ZIP}.part`), Buffer.alloc(1 * MB, 1));
    fs.writeFileSync(path.join(dir, 'pending.json'), JSON.stringify({ schema: 1, version: '9.9.9', fileName: ZIP, url: 'http://127.0.0.1:1/x', pinnedUrl: null, expectedSize: e.size, expectedSha512: e.sha, etag: null, lastModified: null, bytes: 1 * MB, verifyFailures: 0 }));
    const off = e.make({ feedUrl: 'http://127.0.0.1:1/latest-mac.yml', engine: { backoffMs: [60000] } });
    off.cleanupIfStale(); off.start();
    await off.checkForUpdates();                                        // refused connection: the partial is untouched
    assert.ok(fs.existsSync(path.join(dir, 'pending.json')), 'an unreachable feed does not drop the partial');
    await off.stop();
    e.writeYml('2.0.1');                                                // the feed now offers nothing newer than the running version
    fs.writeFileSync(path.join(e.dir, `TexaCore-ERP-2.0.1-arm64.zip`), 'x');
    e.mock.state.releases['v9.9.9'].files['latest-mac.yml'] = { path: e.yml };
    const on = e.make();
    on.cleanupIfStale(); on.start();
    await waitFor(() => !fs.existsSync(e.pendingDir), 10000, 'the partial of a release that is no longer the latest to be dropped');
    assert.equal(on.dl.getStatus().phase, 'idle');
    await e.cleanup(on);
  } catch (err) { await e.cleanup(); throw err; }
});

test('the release is REPLACED while the download is cut (new bytes, new ETag): the stale partial is dropped, the feed is asked again, the new file is downloaded and verifies', async () => {
  const e = await env({ spec: { faults: [{ at: 0.4, kind: 'drop' }] } });
  const u = e.make({ engine: { backoffMs: [300] } });
  try {
    u.start(); await u.checkAndDownload();
    await waitFor(() => u.dl.getStatus().phase === 'waiting-retry', 15000, 'the drop');
    // the maintainer re-uploads the asset: different bytes (same size), a new ETag, a new latest-mac.yml
    const fresh = crypto.randomBytes(e.size); const freshSha = sha512b64(fresh);
    fs.writeFileSync(e.zip, fresh); fs.writeFileSync(e.yml, fs.readFileSync(e.yml, 'utf8').split(e.sha).join(freshSha));
    e.mock.state.bufs.clear();
    await waitFor(isReady(u), 25000, 'ready with the NEW file');
    assert.deepEqual(e.staged, [freshSha], 'what was staged is the new file, verified against the new feed');
    assert.ok(e.logs.some((l) => /ETag changed/.test(l)), 'the change was noticed from the ETag, before the whole file was fetched for nothing');
    const d = e.mock.dataRequests();
    assert.ok(d.length >= 3 && d[1].range && d[1].ifRange, `the Range request carried If-Range: ${JSON.stringify(d.map((x) => [x.status, x.bytes, x.range]))}`);
    assert.equal(d[d.length - 1].bytes, e.size, 'the new file was then fetched whole');
  } finally { await e.cleanup(u); }
});

test('the downloaded installer is refused when the URL is not https (only the tests may use http)', async () => {
  const dir = mkdtemp('upd-https-');
  const staged = [];
  const d = new UpdateDownloader({ dir: path.join(dir, 'pending'), backoffMs: [30], jitter: 0, onDownloaded: async (f) => staged.push(f) });
  d.setTarget({ version: '9.9.9', url: 'http://127.0.0.1:9/x.zip', fileName: 'x.zip', sha512: 'abc', size: 100 });
  await waitFor(() => d.getStatus().lastError, 5000, 'an error');
  assert.match(d.getStatus().lastError, /non-https/);
  await d.stop(); assert.deepEqual(staged, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the OBFUSCATED engine (as shipped inside the package) resumes a dropped download just the same', async () => {
  const { obfuscateAppCode } = require('../scripts/lib/obfuscate-app');
  const app = mkdtemp('upd-obf-'); fs.mkdirSync(path.join(app, 'src'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'src', 'update-downloader.js'), path.join(app, 'src', 'update-downloader.js'));
  obfuscateAppCode(app);
  assert.ok(!/class UpdateDownloader|_nextBackoff|If-Range/.test(fs.readFileSync(path.join(app, 'src', 'update-downloader.js'), 'utf8')), 'it really is obfuscated');
  const { UpdateDownloader: Obf } = require(path.join(app, 'src', 'update-downloader.js'));
  const e = await env({ size: 4 * MB, spec: { faults: [{ at: 0.4, kind: 'drop' }] } });
  const got = [];
  const d = new Obf({ dir: path.join(e.dir, 'obf-pending'), allowInsecureHttp: true, backoffMs: [40], jitter: 0, stallMs: 400, onDownloaded: async (f) => { got.push(sha512b64(fs.readFileSync(f))); } });
  try {
    d.setTarget({ version: VERSION, url: `${e.mock.base}${OWNER_REPO}/releases/latest/download/${ZIP}`, fileName: ZIP, sha512: e.sha, size: e.size });
    await waitFor(() => d.getStatus().phase === 'ready', 20000, 'ready (obfuscated)');
    assert.deepEqual(got, [e.sha]);
    assert.equal(e.mock.dataRequests().length, 2);
    const s1 = rangeStart(e.mock.dataRequests()[1]);
    assert.ok(s1 <= Math.floor(0.4 * e.size) && Math.floor(0.4 * e.size) - s1 < SLACK);
  } finally { await d.stop(); await e.cleanup(); fs.rmSync(app, { recursive: true, force: true }); }
});

test('Windows: the verified installer is handed to electron-updater\'s own cache in the format ITS DownloadedUpdateHelper accepts, so downloadUpdate() needs no network', async () => {
  const { EventEmitter } = require('events');
  const { DownloadedUpdateHelper } = require('electron-updater/out/DownloadedUpdateHelper');
  const { WinUpdater } = require('../src/win-updater');
  const exe = 'TexaCore-ERP-Setup-9.9.9.exe';
  const e = await env({ spec: { faults: [{ at: 0.4, kind: 'drop' }] } });
  // the same bytes, published as the Windows installer + latest.yml
  const exeBytes = fs.readFileSync(e.zip);
  fs.writeFileSync(path.join(e.dir, exe), exeBytes);
  e.mock.state.releases[`v${VERSION}`].files[exe] = { path: path.join(e.dir, exe), faults: [{ at: 0.4, kind: 'drop' }, { at: 0.75, kind: 'drop' }] };
  const files = [{ url: exe, sha512: e.sha, size: e.size }];
  const info = { version: VERSION, files, releaseDate: new Date().toISOString() };
  const cacheDir = path.join(e.dir, 'electron-updater-cache');
  const helper = new DownloadedUpdateHelper(cacheDir);
  const au = new EventEmitter();
  let stockDownloads = 0; const checks = [];
  au.updateInfoAndProvider = { info, provider: { resolveFiles: (i) => i.files.map((f) => ({ url: new URL(`${e.mock.base}${OWNER_REPO}/releases/download/v${i.version}/${f.url}`), info: f })) } };
  au.checkForUpdates = async () => { checks.push(1); setImmediate(() => au.emit('update-available', info)); return { updateInfo: info }; };
  au.getOrCreateDownloadHelper = async () => helper;
  au.downloadUpdate = async () => {                                   // what electron-updater's executeDownload does first: validate the cache, else download
    const fileInfo = au.updateInfoAndProvider.provider.resolveFiles(info)[0];
    const updateFile = path.join(helper.cacheDirForPendingUpdate, exe);
    const cached = await helper.validateDownloadedPath(updateFile, info, fileInfo, { info() {}, warn() {}, error() {} });
    if (!cached) { stockDownloads++; throw new Error('electron-updater would download the installer itself'); }
    au.emit('update-downloaded', info);
    return [cached];
  };
  const events = [];
  const w = new WinUpdater({ autoUpdater: au, getVersion: () => CURRENT, userDataPath: path.join(e.dir, 'win-ud'), log: () => {}, emit: (c, p) => events.push([c, p]), allowInsecureHttp: true,
    checkInitialDelayMs: 1e9, checkIntervalMs: 1e9, engine: { backoffMs: [40], jitter: 0, stallMs: 400, progressEveryMs: 5, noSpaceRecheckMs: 50 } });
  try {
    w.start();
    await w.checkAndDownload();
    await waitFor(() => events.some(([c]) => c === 'update-downloaded'), 25000, 'update-downloaded');
    assert.equal(stockDownloads, 0, 'electron-updater did not have to download anything');
    assert.equal(au.autoDownload, false, 'the resumable engine owns the download');
    assert.ok(e.mock.dataRequests().filter((r) => r.asset === exe).length >= 2, 'resumed after the drop');
    assert.equal(sha512b64(fs.readFileSync(path.join(helper.cacheDirForPendingUpdate, exe))), e.sha);
    const meta = JSON.parse(fs.readFileSync(path.join(helper.cacheDirForPendingUpdate, 'update-info.json'), 'utf8'));
    assert.deepEqual(meta, { fileName: exe, sha512: e.sha, isAdminRightsRequired: false });
    assert.equal(w.getStatus().phase, 'ready');
    assert.ok(events.some(([c, p]) => c === 'update-status' && p.phase === 'waiting-retry'));
  } finally { await w.stop(); await e.cleanup(); }
});

test('a STAGED (ready) update stays ready: a later feed check does not publish idle / checking and hide the banner', async () => {
  const e = await env();
  try {
    const app = path.join(e.userData, 'updates', 'staged', 'TexaCore ERP.app'); fs.mkdirSync(app, { recursive: true });
    fs.writeFileSync(e.stateFile, JSON.stringify({ version: VERSION, appPath: app }));
    const shared = createUpdateStatus();
    const u = e.make({ emit: (c, p) => { e.events.push([c, p]); applyUpdateEvent(shared, c, p); } });
    u.cleanupIfStale(); u.start();
    assert.equal(shared.state, 'ready'); assert.equal(shared.version, VERSION);
    const r = await u.checkForUpdates();                                   // the feed names the same version: "already staged"
    assert.equal(r.available, true);
    await sleep(50);
    assert.equal(shared.state, 'ready', 'still ready after the check');
    assert.equal(shared.phase, 'ready');
    assert.ok(!e.events.some(([c, p]) => c === 'update-status' && (p.phase === 'idle' || p.phase === 'checking')), 'the engine published nothing that could hide it');
    assert.equal(u.getStatus().phase, 'ready');
    assert.equal(e.mock.dataRequests().length, 0, 'and nothing was downloaded');
    await e.cleanup(u);
  } catch (err) { await e.cleanup(); throw err; }
});

test('Windows: an installer that a previous run already left in electron-updater\'s cache is accepted without downloading anything', async () => {
  const { EventEmitter } = require('events');
  const { DownloadedUpdateHelper } = require('electron-updater/out/DownloadedUpdateHelper');
  const { WinUpdater } = require('../src/win-updater');
  const exe = 'TexaCore-ERP-Setup-9.9.9.exe';
  const e = await env();
  const files = [{ url: exe, sha512: e.sha, size: e.size }];
  const info = { version: VERSION, files };
  const helper = new DownloadedUpdateHelper(path.join(e.dir, 'cache'));
  fs.mkdirSync(helper.cacheDirForPendingUpdate, { recursive: true });
  fs.writeFileSync(path.join(helper.cacheDirForPendingUpdate, exe), e.bytes);
  fs.writeFileSync(path.join(helper.cacheDirForPendingUpdate, 'update-info.json'), JSON.stringify({ fileName: exe, sha512: e.sha, isAdminRightsRequired: false }));
  const au = new EventEmitter(); const events = []; let downloadCalls = 0;
  au.updateInfoAndProvider = { info, provider: { resolveFiles: (i) => i.files.map((f) => ({ url: new URL(`${e.mock.base}${OWNER_REPO}/releases/download/v${i.version}/${f.url}`), info: f })) } };
  au.checkForUpdates = async () => { setImmediate(() => au.emit('update-available', info)); return { updateInfo: info }; };
  au.getOrCreateDownloadHelper = async () => helper;
  au.downloadUpdate = async () => { downloadCalls++; au.emit('update-downloaded', info); return []; };
  const w = new WinUpdater({ autoUpdater: au, getVersion: () => CURRENT, userDataPath: path.join(e.dir, 'win-ud2'), log: () => {}, emit: (c, p) => events.push([c, p]), allowInsecureHttp: true, checkInitialDelayMs: 1e9, checkIntervalMs: 1e9 });
  try {
    w.start(); await w.checkAndDownload();
    await waitFor(() => events.some(([c]) => c === 'update-downloaded'), 10000, 'update-downloaded');
    assert.equal(downloadCalls, 1);
    assert.equal(e.mock.state.requests.length, 0, 'no request at all');
    assert.ok(!events.some(([c, p]) => c === 'update-status' && p.phase === 'downloading'), 'the engine never started');
  } finally { await w.stop(); await e.cleanup(); }
});

test('the shared status keeps the ORIGINAL shape (state idle | downloading | ready + version / percent / MB) for every detailed phase, so an older ERP page still works', () => {
  const st = createUpdateStatus();
  const snap = (phase, extra = {}) => ({ phase, version: '2.0.2', paused: phase === 'paused', bytesDone: 275 * MB, bytesTotal: 305 * MB, percent: 90, speedBps: 0, etaSec: null, nextRetryAt: null, lastError: null, errorCode: null, ...extra });
  for (const phase of ['downloading', 'paused', 'waiting-retry', 'verifying', 'staging', 'failed-verify']) {
    applyUpdateEvent(st, 'update-status', snap(phase, phase === 'waiting-retry' ? { errorCode: 'network', lastError: 'aborted', nextRetryAt: Date.now() + 30000 } : {}));
    assert.equal(st.state, 'downloading', phase); assert.equal(st.version, '2.0.2'); assert.equal(st.percent, 90);
    assert.equal(st.transferredMB, '275.0'); assert.equal(st.totalMB, '305'); assert.equal(st.phase, phase);
  }
  assert.equal(st.errorCode, null, 'the last snapshot wins');
  applyUpdateEvent(st, 'update-status', snap('waiting-retry', { errorCode: 'stall', lastError: 'no data for 45 s' }));
  assert.equal(st.lastError, 'no data for 45 s'); assert.equal(st.errorCode, 'stall');
  applyUpdateEvent(st, 'update-status', snap('ready'));
  assert.equal(st.state, 'ready'); assert.equal(st.percent, 100);
  applyUpdateEvent(st, 'update-status', { phase: 'checking' });
  assert.equal(st.state, 'ready', 'a feed check does not change what is shown');
  applyUpdateEvent(st, 'update-not-available');
  assert.deepEqual({ s: st.state, v: st.version, p: st.phase }, { s: 'idle', v: null, p: 'idle' });
  applyUpdateEvent(st, 'update-status', snap('paused'));
  applyUpdateEvent(st, 'update-status', { phase: 'idle', version: null });
  assert.equal(st.state, 'idle');
  // the original events still work
  applyUpdateEvent(st, 'update-available', { version: '2.0.3' }); assert.equal(st.state, 'downloading');
  applyUpdateEvent(st, 'update-progress', { percent: 12, transferred: '36.6', total: '305' }); assert.equal(st.percent, 12);
  applyUpdateEvent(st, 'update-downloaded'); assert.equal(st.state, 'ready');
});

test('wiring: the local API has Pause / Resume / Retry (loopback + CSRF-guarded + status keeps its fields), the window bridge exposes the three controls, the network watch exists, the engine is stopped on quit', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  const set = /const DESTRUCTIVE_API = new Set\(\[([\s\S]*?)\]\);/.exec(main)[1];
  for (const p of ['/api/update/install', '/api/update/pause', '/api/update/resume', '/api/update/retry']) assert.ok(set.includes(`'${p}'`), `${p} is in DESTRUCTIVE_API`);
  assert.match(main, /req\.url === '\/api\/update\/pause' \|\| req\.url === '\/api\/update\/resume' \|\| req\.url === '\/api\/update\/retry'/);
  assert.match(main, /forbidden: update controls are local-only/);
  assert.match(main, /nextRetryInSec/);
  for (const k of ['onUpdateStatus', 'getUpdateStatus', 'updateControl']) assert.ok(preload.includes(k), `preload exposes ${k}`);
  assert.match(main, /ipcMain\.handle\('update-control'/); assert.match(main, /ipcMain\.handle\('get-update-status'/);
  assert.match(main, /powerMonitor\.on\('resume'/); assert.match(main, /net\.isOnline\(\)/);
  assert.match(main, /await activeUpdater\(\)\?\.stop\(\)/);
  assert.match(main, /TEXACORE_UPDATE_TUNING/);
  assert.ok(/function updaterTuning\(\) \{\s*if \(!HARNESS_OK/.test(main), 'the engine tuning is honoured only in isolated harness runs');
});
