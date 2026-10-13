'use strict';
// ════════════════════════════════════════════════════════════════
// ports — every TCP port the installer binds, in one place.
//
// Production defaults are the historical ones (PG 54322, PostgREST 3000, GoTrue 9999, API proxy 54321, UI 80→8080,
// admin API 1960). For tests and the release launch-check set TEXACORE_PORT_BASE=47391 to move ALL of them into one
// contiguous, collision-free block:  pg=+0  postgrest=+1  gotrue=+2  api=+3  ui=+4  admin=+5.
// ════════════════════════════════════════════════════════════════
function resolvePorts(env = process.env) {
  const raw = env.TEXACORE_PORT_BASE;
  if (raw !== undefined && raw !== '') {
    const base = Number(raw);
    if (!Number.isInteger(base) || base < 1024 || base > 65000) throw new Error(`TEXACORE_PORT_BASE must be an integer in 1024..65000, got "${raw}"`);
    return { custom: true, pg: base, postgrest: base + 1, gotrue: base + 2, api: base + 3, ui: base + 4, admin: base + 5 };
  }
  return { custom: false, pg: 54322, postgrest: 3000, gotrue: 9999, api: 54321, ui: 80, admin: 1960 };
}

/**
 * Is this process a launch-check run? The harness switches (TEXACORE_HEADLESS / _E2E_AUTOSTART / _STUB_TUNNEL / _STUB_MDM / _USER_DATA)
 * are honoured in a dev checkout, and in a PACKAGED app only when the run is also isolated: its own userData folder AND its own
 * port block (so the check can launch the real build without touching the installed app's data or ports).
 */
function harnessAllowed(isPackaged, env = process.env) {
  return !isPackaged || (!!env.TEXACORE_USER_DATA && !!env.TEXACORE_PORT_BASE);
}

module.exports = { resolvePorts, harnessAllowed, PORTS: resolvePorts() };
