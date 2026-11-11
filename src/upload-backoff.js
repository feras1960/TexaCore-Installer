'use strict';
// ════════════════════════════════════════════════════════════════
// upload-backoff (2.0.8) — the wait after a FAILED cloud-backup upload (main.js HeartbeatSender._uploadCloudBackup).
//
// The upload is due every 12 hours OR whenever the company file's size changed — and the file is rewritten every minute, so its size changes
// almost every heartbeat (3 min). Only a SUCCESS recorded the size/time, so a failing upload (offline, a refusal, a server error) re-sent the
// whole file (up to 100 MB, base64) on every heartbeat. After a failure the next attempt now waits 5 min, 10, 20, 40 … capped at the normal 12 h
// cadence; one success clears it. When an upload is due after a success is unchanged: this only ever delays an attempt that follows a failure.
// Pure (the clock is injected): unit-tested in test/upload-backoff.test.js.
// ════════════════════════════════════════════════════════════════

const BASE_MS = 5 * 60 * 1000;
const CAP_MS = 12 * 60 * 60 * 1000;

/** The wait after the n-th consecutive failure (n >= 1): base · 2^(n-1), never more than cap. */
function backoffMs(failures, { baseMs = BASE_MS, capMs = CAP_MS } = {}) {
  const n = Math.max(1, Math.floor(Number(failures) || 1));
  if (n > 40) return capMs;
  return Math.min(capMs, baseMs * 2 ** (n - 1));
}

function createUploadBackoff({ baseMs = BASE_MS, capMs = CAP_MS, now = () => Date.now() } = {}) {
  let failures = 0;
  let retryAt = 0;
  return {
    /** true while an attempt must wait (a failure happened and its backoff has not run out). */
    blocked() { return failures > 0 && now() < retryAt; },
    /** milliseconds until the next attempt may run (0 when it may run now). */
    remainingMs() { return failures > 0 ? Math.max(0, retryAt - now()) : 0; },
    failed() { failures += 1; retryAt = now() + backoffMs(failures, { baseMs, capMs }); return retryAt - now(); },
    succeeded() { failures = 0; retryAt = 0; },
    get failures() { return failures; },
  };
}

module.exports = { BASE_MS, CAP_MS, backoffMs, createUploadBackoff };
