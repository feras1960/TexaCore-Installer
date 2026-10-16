'use strict';
// ════════════════════════════════════════════════════════════════
// folder-access — macOS "Files and Folders" privacy (TCC), seen from the program's side. Pure of Electron: injectable spawn / clock, so the tests
// run it on scratch folders and a fake child.
//
// WHY (2.0.4, owner's live test 17-10): the first search for a chosen file touched ~/Desktop, ~/Documents and ~/Downloads. macOS shows its own prompt
// for each of them AND BLOCKS the reading call until the user answers (the macOS log of that run: 3 prompts answered "Allow" ~2 s apart, 1.9 s after
// they appeared). The 2.0.3 search gave up on a folder after 1 s, so it read "no folders, nothing found" - and, because the program is signed ad-hoc,
// the grant is tied to the exact build (its cdhash): every update asks again ("Failed to match existing code requirement" in tccd's log).
//
// What this module does about it:
//   • kindOf(path)       - which protected area a path is in (desktop / documents / downloads / icloud / cloud / volume), or null (nothing to ask).
//   • a PROBE per area   - `ls` in a CHILD process. The reading call that blocks on the prompt blocks the child, never the program's event loop, and
//                          a child can be killed. The child is spawned by this program, so macOS asks in TexaCore's name (the "responsible process").
//   • a verdict          - allowed | denied (EPERM / EACCES: the user said no, or a folder permission) | pending (the prompt is still up) |
//                          missing | error. Pending probes keep running: when the user answers, the verdict flips to allowed / denied.
//   • settingsUrl()      - the Privacy & Security → Files and Folders pane, for the "open settings" button (the app opens it, not the page).
// Every other module that touches the user's folders asks check()/ensureUsable() FIRST, so a blocked call never reaches the main process.
// ════════════════════════════════════════════════════════════════
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

/** Areas macOS protects, in the order a search visits them (most likely first). `rel` is relative to the user's home. */
const KINDS = ['desktop', 'documents', 'downloads', 'icloud', 'cloud', 'volume'];
const KIND_REL = {
  desktop: ['Desktop'],
  documents: ['Documents'],
  downloads: ['Downloads'],
  icloud: ['Library', 'Mobile Documents'],
  cloud: ['Library', 'CloudStorage'],
};

const SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders';
const SETTINGS_URL_FALLBACK = 'x-apple.systempreferences:com.apple.preference.security';

const SOFT_WAIT_MS = 1500;          // check(): how long a caller waits for a verdict before being told "pending"
const PROBE_HARD_MS = 5 * 60 * 1000; // a probe that is still blocked after this long is killed and counted as "timeout" (the prompt was ignored)
const ALLOWED_TTL_MS = 30 * 1000;   // a verdict "allowed" is trusted this long
const DENIED_TTL_MS = 1500;         // ... "denied" only briefly: the user may have just switched the permission on in System Settings

const lc = (s) => String(s).toLowerCase();

/** The protected area `p` is in on `platform`, or null (Windows, Linux, and macOS folders that need no permission). */
function kindOf(p, { platform = process.platform, home = os.homedir() } = {}) {
  if (platform !== 'darwin' || typeof p !== 'string' || !p || !path.isAbsolute(p)) return null;
  const r = lc(path.resolve(p));
  const h = lc(path.resolve(home));
  const inside = (base) => r === base || r.startsWith(`${base}${path.sep}`);
  for (const k of ['desktop', 'documents', 'downloads', 'icloud', 'cloud']) {
    if (inside(lc(path.join(h, ...KIND_REL[k])))) return k;
  }
  if (r.startsWith('/volumes/')) return 'volume';   // removable / network volumes (the boot volume's own /Volumes/<name> link is harmless to ask about)
  return null;
}

/** The folder whose listing is the probe for an area. A "volume" probes the volume's own root (/Volumes/<name>). */
function probeDirOf(kind, p, { home = os.homedir() } = {}) {
  if (kind === 'volume') {
    const m = /^(\/Volumes\/[^/]+)/i.exec(String(p || ''));
    return m ? m[1] : null;
  }
  const rel = KIND_REL[kind];
  return rel ? path.join(home, ...rel) : null;
}

/** What `ls` said → a verdict. `code` is an errno name; `state` is one of allowed | denied | missing | error. */
function classifyLsOutcome({ exitCode, signal, stderr }) {
  const text = String(stderr || '');
  if (exitCode === 0) return { state: 'allowed' };
  if (/operation not permitted/i.test(text)) return { state: 'denied', code: 'EPERM' };
  if (/permission denied/i.test(text)) return { state: 'denied', code: 'EACCES' };
  if (/no such file|not a directory/i.test(text)) return { state: 'missing', code: 'ENOENT' };
  if (signal) return { state: 'error', code: String(signal) };
  return { state: 'error', code: 'EUNKNOWN' };
}

/**
 * Start listing `dir` in a child process. Returns { done, kill }: `done` resolves ONCE with { state, code?, ms } and never rejects;
 * a child that has not answered after `hardMs` is killed and the verdict is { state: 'timeout' }.
 */
function startProbe(dir, { spawn = childProcess.spawn, hardMs = PROBE_HARD_MS, now = Date.now, lsPath = '/bin/ls' } = {}) {
  const t0 = now();
  let child = null;
  let finished = false;
  let timer = null;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const finish = (verdict) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    resolveDone({ ...verdict, ms: now() - t0 });
  };
  const kill = () => { try { child && child.kill('SIGKILL'); } catch { /* gone */ } };
  try {
    // stdout is discarded: only whether the folder could be listed matters
    child = spawn(lsPath, ['-1', '--', dir], { stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: '/bin:/usr/bin', LC_ALL: 'C' }, windowsHide: true });
    let err = '';
    if (child.stderr) child.stderr.on('data', (c) => { if (err.length < 4096) err += String(c); });
    child.on('error', () => finish({ state: 'error', code: 'SPAWN' }));
    child.on('close', (code, signal) => finish(classifyLsOutcome({ exitCode: code, signal, stderr: err })));
    timer = setTimeout(() => { kill(); finish({ state: 'timeout' }); }, hardMs);
    if (timer.unref) timer.unref();
  } catch {
    finish({ state: 'error', code: 'SPAWN' });
  }
  return { done, kill };
}

/**
 * The access registry: one verdict per area, shared by every caller. `simulate(kind)` (harness only) may return a verdict instead of probing:
 * { state, delayMs? } - so the packaged app can be driven through "denied" and "pending" without touching the real privacy settings.
 */
function createFolderAccess({ platform = process.platform, home = os.homedir(), spawn = childProcess.spawn, now = Date.now, hardMs = PROBE_HARD_MS, simulate = null, kindResolver = null, lsPath } = {}) {
  const entries = new Map();   // kind → { state, code, at, startedAt, probe, promise }
  const opts = { platform, home };
  // (harness only) kindResolver(p) may name the area of a scratch folder, so a test can pretend that a folder of its own is "Desktop"
  const kindFor = (p) => (kindResolver && kindResolver(p)) || kindOf(p, opts);

  const entryFor = (kind) => {
    if (!entries.has(kind)) entries.set(kind, { state: 'unknown', code: null, at: 0, startedAt: 0, probe: null, promise: null });
    return entries.get(kind);
  };

  /** Start (or reuse) the probe of an area; returns a promise of the FINAL verdict (it can take as long as the user takes to answer the prompt). */
  function probe(kind, sample) {
    const e = entryFor(kind);
    if (e.promise) return e.promise;
    const dir = probeDirOf(kind, sample, { home });
    e.state = 'pending';
    e.startedAt = now();
    const fake = simulate ? simulate(kind) : null;
    let run;
    if (fake) {
      let timer = null;
      const p = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ state: fake.state, code: fake.code || (fake.state === 'denied' ? 'EPERM' : undefined), ms: fake.delayMs || 0 }), fake.delayMs || 0);
      });
      run = { done: p, kill: () => clearTimeout(timer) };
    } else if (!dir) {
      run = { done: Promise.resolve({ state: 'missing', code: 'ENOENT', ms: 0 }), kill() {} };
    } else {
      run = startProbe(dir, { spawn, hardMs, now, lsPath });
    }
    e.probe = run;
    e.promise = run.done.then((v) => {
      e.state = v.state === 'timeout' ? 'timeout' : v.state;
      e.code = v.code || null;
      e.at = now();
      e.probe = null;
      e.promise = null;
      return { kind, state: e.state, code: e.code };
    });
    return e.promise;
  }

  /**
   * The verdict for an area, waiting at most `waitMs` for the prompt. Resolves { kind, state, code?, waitedMs } where state is
   * allowed | denied | pending | missing | timeout | error. 'pending' = the probe is still running (the prompt is on screen) - ask again later.
   */
  async function check(kind, { waitMs = SOFT_WAIT_MS, sample } = {}) {
    if (!KINDS.includes(kind)) return { kind, state: 'allowed', code: null };
    if (platform !== 'darwin' && !simulate) return { kind, state: 'allowed', code: null };
    const e = entryFor(kind);
    const t = now();
    if (e.state === 'allowed' && t - e.at < ALLOWED_TTL_MS) return { kind, state: 'allowed', code: null };
    if ((e.state === 'denied' || e.state === 'missing' || e.state === 'error' || e.state === 'timeout') && t - e.at < DENIED_TTL_MS) return { kind, state: e.state, code: e.code };
    const final = probe(kind, sample);
    let timer = null;
    const soft = new Promise((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, waitMs)); });
    const v = await Promise.race([final, soft]);
    clearTimeout(timer);
    if (v) return { kind, state: v.state, code: v.code || null, waitedMs: now() - t };
    return { kind, state: 'pending', code: null, sinceMs: now() - entryFor(kind).startedAt };
  }

  /** The area of a path, then check(). A path outside every protected area is simply allowed. */
  async function ensureUsable(p, o = {}) {
    const kind = kindFor(p);
    if (!kind) return { kind: null, state: 'allowed', code: null };
    return check(kind, { ...o, sample: p });
  }

  /** The final verdict of an area (waits for the user's answer, up to the probe's hard limit). */
  function settle(kind, sample) {
    if (!KINDS.includes(kind) || (platform !== 'darwin' && !simulate)) return Promise.resolve({ kind, state: 'allowed', code: null });
    const e = entryFor(kind);
    if (e.state === 'allowed' && now() - e.at < ALLOWED_TTL_MS) return Promise.resolve({ kind, state: 'allowed', code: null });
    return probe(kind, sample);
  }

  /** Forget a stale verdict (the retry button after the user changed a setting): the next check() probes again. */
  function forget(kind) {
    const e = entries.get(kind);
    if (e && !e.promise) { e.state = 'unknown'; e.at = 0; }
  }

  function snapshot() {
    const out = {};
    for (const [k, e] of entries) out[k] = { state: e.state, code: e.code, sinceMs: e.state === 'pending' ? now() - e.startedAt : undefined };
    return out;
  }

  function dispose() { for (const e of entries.values()) { try { e.probe && e.probe.kill(); } catch { /* gone */ } } }

  return { kindOf: kindFor, check, ensureUsable, settle, forget, snapshot, dispose, probeDirOf: (k, s) => probeDirOf(k, s, { home }) };
}

/** The Privacy & Security pane to open, and the broader pane to fall back on. */
function settingsUrls() { return [SETTINGS_URL, SETTINGS_URL_FALLBACK]; }

module.exports = {
  KINDS, SETTINGS_URL, SETTINGS_URL_FALLBACK, SOFT_WAIT_MS, PROBE_HARD_MS,
  kindOf, probeDirOf, classifyLsOutcome, startProbe, createFolderAccess, settingsUrls,
};
