'use strict';
// Supervised restart of a helper child (PostgREST, GoTrue) that died on its own — e.g. killed by the OS under memory pressure
// ("exited with code null"). Pure policy, no spawning: the caller supplies `restart()`. A deliberate stop (quit, restore, port change)
// never reaches here as an unexpected exit, and cancel() drops a restart that is still waiting.
const BACKOFF_MS = [1000, 2000, 5000];
const MAX_RESTARTS = 5;
const WINDOW_MS = 2 * 60 * 1000;

function createSupervisor({ name, restart, log = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  backoff = BACKOFF_MS, maxRestarts = MAX_RESTARTS, windowMs = WINDOW_MS }) {
  let attempts = [];      // timestamps of restarts scheduled inside the window
  let timer = null;
  let gaveUp = false;
  let generation = 0;     // bumped by cancel(): a restart already in flight when a deliberate stop came must not go on

  function cancel() {
    generation++;
    if (timer) { clearTimer(timer); timer = null; }
  }

  // Called for an exit that nobody asked for. Returns the delay scheduled, or null (gave up / already pending).
  function onUnexpectedExit(detail) {
    if (timer) return null;
    const t = now();
    attempts = attempts.filter((a) => t - a < windowMs);
    if (attempts.length >= maxRestarts) {
      if (!gaveUp) log(`[Supervisor] ${name}: ${maxRestarts} restarts within ${Math.round(windowMs / 1000)}s — giving up (${detail || 'no detail'})`);
      gaveUp = true;
      return null;
    }
    const delay = backoff[Math.min(attempts.length, backoff.length - 1)];
    attempts.push(t);
    const gen = generation;
    log(`[Supervisor] ${name} died unexpectedly (${detail || 'no detail'}) — restart ${attempts.length}/${maxRestarts} in ${delay}ms`);
    timer = setTimer(async () => {
      timer = null;
      if (gen !== generation) return;
      try { await restart(); } catch (e) { log(`[Supervisor] ${name} restart failed: ${e && e.message}`); if (gen === generation) onUnexpectedExit('restart failed'); }
    }, delay);
    if (timer && timer.unref) timer.unref();
    return delay;
  }

  // A healthy start by the app itself (or a restart that came up) clears the give-up state.
  function reset() { attempts = []; gaveUp = false; }

  return { onUnexpectedExit, cancel, reset, get gaveUp() { return gaveUp; }, get pending() { return !!timer; } };
}

module.exports = { createSupervisor, BACKOFF_MS, MAX_RESTARTS, WINDOW_MS };
