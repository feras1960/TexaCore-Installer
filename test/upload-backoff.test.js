'use strict';
// A failed cloud-backup upload waits before the next try (src/upload-backoff.js, used by main.js HeartbeatSender._uploadCloudBackup).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { backoffMs, createUploadBackoff, BASE_MS, CAP_MS } = require('../src/upload-backoff');

const MIN = 60 * 1000;

test('the wait doubles from 5 minutes and stops at the normal 12-hour cadence', () => {
  assert.equal(BASE_MS, 5 * MIN);
  assert.equal(CAP_MS, 12 * 60 * MIN);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 50].map((n) => backoffMs(n) / MIN), [5, 10, 20, 40, 80, 160, 320, 640, 720, 720, 720]);
});

test('no failure → never blocked; a failure blocks until its wait has run out; a success clears it at once', () => {
  let t = 1_000_000;
  const b = createUploadBackoff({ now: () => t });
  assert.equal(b.blocked(), false);
  assert.equal(b.failed(), 5 * MIN);
  assert.equal(b.blocked(), true);
  t += 3 * MIN; assert.equal(b.blocked(), true, 'the next heartbeat (3 min) does not resend');
  t += 2 * MIN; assert.equal(b.blocked(), false, 'after 5 minutes it may try again');
  assert.equal(b.failed(), 10 * MIN, 'a second failure in a row waits twice as long');
  t += 9 * MIN; assert.equal(b.blocked(), true);
  b.succeeded();
  assert.equal(b.blocked(), false);
  assert.equal(b.failures, 0);
  assert.equal(b.failed(), 5 * MIN, 'the count starts over after a success');
});

test('a failing upload over a day of 3-minute heartbeats: about a dozen attempts instead of 480', () => {
  let t = 0;
  const b = createUploadBackoff({ now: () => t });
  let attempts = 0;
  for (t = 0; t < 24 * 60 * MIN; t += 3 * MIN) {
    if (b.blocked()) continue;
    attempts += 1; b.failed();
  }
  assert.ok(attempts <= 12, `attempts: ${attempts}`);
});

test('main.js: the backoff gates only an attempt that is already due, counts real attempts only, and a success clears it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const at = src.indexOf('  async _uploadCloudBackup(config) {');
  const fn = src.slice(at, src.indexOf('  async _uploadRsfBackup(', at));
  assert.match(src, /const \{ createUploadBackoff \} = require\('\.\/upload-backoff'\);/);
  const due = fn.indexOf('if (!fileChanged && !timeElapsed)');
  const gate = fn.indexOf('if (this._uploadBackoff.blocked()) return;');
  const send = fn.indexOf('/license-cloud-backup`');
  assert.ok(due > 0 && gate > due && send > gate, 'due-check, then the backoff, then the upload');
  const ok = fn.indexOf('if (result && result.success) {');
  assert.ok(fn.indexOf('this._uploadBackoff.succeeded();', ok) > ok);
  assert.ok(fn.indexOf('this._lastUploadSize = stats.size;', ok) > ok, 'a success still records size and time exactly as before');
  assert.match(fn, /\} else \{\s*attempting = false;\s*const waitMs = this\._uploadBackoff\.failed\(\);/, 'a refused upload backs off');
  assert.match(fn, /catch \(err\) \{\s*const waitMs = \(attempting && this\._uploadBackoff\) \? this\._uploadBackoff\.failed\(\) : 0;/, 'a thrown upload backs off, a skip does not');
  assert.match(fn, /if \(this\._cloudUploadInFlight\) return;/);
  assert.match(fn, /finally \{\s*this\._cloudUploadInFlight = false;/);
});
