'use strict';
// ════════════════════════════════════════════════════════════════
// locate-job — finding the file the user chose in the browser, as a JOB the page follows (2.0.4).
//
// 2.0.3 answered in one request, read the content to find the file, and gave up after 1-3 s. On a real Mac that meant: (1) a folder whose macOS permission
// prompt was still up counted as "empty" (the prompt takes a human a few seconds), (2) an iCloud placeholder was never found or was read with a fixed cap,
// (3) the page could show nothing in between. A job fixes all three:
//
//   POST start        {name,size,lastModified}      → a job id at once; the search runs in the background
//   GET  status       the PHASE the page shows      → searching | waiting-permission | ready | not-found | permission-denied | cancelled | failed
//   POST materialize  download the placeholders     → progress in status (loaded / total), cancel
//   POST confirm      {sha256}                      → the page hashes the (now local) file; ONLY a file whose full content hashes equal is answered with its path
//   POST cancel
//
// The search goes by METADATA - exact name, exact size, modification time within 2 s - and never reads the content. Protected macOS folders are visited
// one at a time, in the order a user keeps files (Desktop, Documents, Downloads, iCloud Drive, ...), each only after its permission verdict is "allowed"
// (folder-access.js - a child process, so a pending prompt blocks nothing). The search stops at the first folder that yields a candidate, so the user is not
// asked about folders that do not matter. Status never carries a path: a candidate is an opaque id, its state and the kind of folder it is in.
//
// Pure of Electron: every collaborator is injectable (the tests run it on scratch folders with fake access / cloud / clock).
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const locateFile = require('./locate-file');
const companyFile = require('./company-file');
const folderAccessMod = require('./folder-access');
const cloudFiles = require('./cloud-files');

const GROUP_WALK_BUDGET_MS = 8000;     // one folder group (Desktop, Documents, ...) once it is readable
const MAX_CANDIDATES = 8;
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_JOBS = 5;

const newId = () => crypto.randomBytes(12).toString('hex');
const badRequest = (msg, code = 'BAD_REQUEST') => Object.assign(new Error(msg), { code });

/** roots → groups in the order they are visited: unprotected folders first, then each protected area in folderAccess.KINDS order. */
function groupRoots(roots, kindOf) {
  const plain = [];
  const byKind = new Map();
  for (const r of roots) {
    const k = kindOf(r);
    if (!k) plain.push(r);
    else { if (!byKind.has(k)) byKind.set(k, []); byKind.get(k).push(r); }
  }
  const groups = [];
  if (plain.length) groups.push({ kind: null, roots: plain });
  for (const k of folderAccessMod.KINDS) if (byKind.has(k)) groups.push({ kind: k, roots: byKind.get(k) });
  for (const [k, rs] of byKind) if (!folderAccessMod.KINDS.includes(k)) groups.push({ kind: k, roots: rs });
  return groups;
}

function createLocateJobs({
  folderAccess, platform = process.platform, home = os.homedir(), now = Date.now, fsp = fs.promises,
  execFile, cloud = cloudFiles, hashFile = null, useMdfind = true, budgets = {},
} = {}) {
  const jobs = new Map();
  const groupBudget = budgets.groupWalkMs || GROUP_WALK_BUDGET_MS;

  const prune = () => {
    const t = now();
    for (const [id, j] of jobs) if (t - j.touched > JOB_TTL_MS) { cancelJob(j); jobs.delete(id); }
    while (jobs.size > MAX_JOBS) {
      const oldest = jobs.keys().next().value;
      cancelJob(jobs.get(oldest)); jobs.delete(oldest);
    }
  };

  function cancelJob(j) {
    if (!j) return;
    j.cancelled = true;
    if (j.phase === 'searching' || j.phase === 'waiting-permission' || j.phase === 'ready') j.phase = 'cancelled';
    if (j.mat && j.mat.ctl) { try { j.mat.ctl.cancel(); } catch { /* already over */ } }
    if (j.wake) j.wake();
  }

  /** One candidate = a regular file with the exact name's size and (when the browser said) the modification time. */
  async function evaluate(p, q, area) {
    const st = await locateFile.withTimeout(fsp.lstat(p), locateFile.LSTAT_TIMEOUT_MS, null);
    if (!st || !st.isFile() || st.size !== q.size) return null;
    const mtimeOk = typeof q.lastModified !== 'number' || Math.abs(st.mtimeMs - q.lastModified) <= locateFile.MTIME_TOLERANCE_MS;
    if (!mtimeOk) return null;   // a copy has its own time: it is not the file the user chose
    const state = await cloud.cloudState(p, { platform, st, execFile });
    return { filePath: p, key: st.ino ? `${st.dev}:${st.ino}` : `p:${p.toLowerCase()}`, size: st.size, mtimeMs: st.mtimeMs, state, area };
  }

  async function addCandidates(j, paths, area) {
    for (const p of paths) {
      if (j.cancelled || j.candidates.length >= MAX_CANDIDATES) return;
      const c = await evaluate(p, j.q, area);
      if (!c || j.seen.has(c.key)) continue;
      j.seen.add(c.key);
      j.candidates.push({ ...c, cid: j.candidates.length + 1, loaded: 0, code: null });
    }
  }

  async function run(j) {
    try {
      const kindOf = (p) => folderAccess.kindOf(p);
      const groups = groupRoots(j.roots, kindOf);
      j.stats.roots = j.roots.length;
      for (const g of groups) {
        if (j.cancelled) return;
        if (g.kind) {
          j.phase = 'waiting-permission'; j.searching = g.kind;
          j.permissions[g.kind] = { state: 'pending', since: now() };
          const verdict = await Promise.race([
            folderAccess.settle(g.kind, g.roots[0]),
            new Promise((resolve) => { j.wake = () => resolve({ kind: g.kind, state: 'cancelled' }); }),
          ]);
          j.wake = null;
          if (j.cancelled) return;
          j.permissions[g.kind] = { state: verdict.state, ...(verdict.code ? { code: verdict.code } : {}) };
          if (verdict.state !== 'allowed') continue;   // denied / missing / timeout: nothing to look at there
        }
        j.phase = 'searching'; j.searching = g.kind || 'other';
        const walked = { found: [], visited: 0, timedOut: false };
        const deadline = now() + groupBudget;
        await locateFile.withTimeout(
          locateFile.walkForFile(g.roots, j.q.name, { deadline, now, platform, fsp, state: walked, maxDepth: j.deps.maxDepth, maxDirs: j.deps.maxDirs, dirTimeoutMs: j.deps.dirTimeoutMs }),
          groupBudget + 1000, null,
        );
        j.stats.walkDirs += walked.visited;
        if (walked.timedOut) j.stats.walkTimedOut = true;
        await addCandidates(j, walked.found, g.kind || 'other');
        if (j.candidates.length) break;   // found where the user keeps it: no need to ask about the other folders
      }
      if (j.cancelled) return;
      if (!j.candidates.length && useMdfind && j.deps.useMdfind !== false && platform === 'darwin') {
        const hits = await locateFile.mdfindCandidates(j.q.name, { home, platform, execFile: j.deps.execFile, timeoutMs: j.deps.mdfindTimeoutMs });
        j.stats.spotlight = hits.length;
        await addCandidates(j, hits, 'spotlight');
      }
      if (j.cancelled) return;
      j.searching = null;
      const denied = Object.entries(j.permissions).filter(([, v]) => v.state === 'denied' || v.state === 'timeout').map(([k]) => k);
      j.phase = j.candidates.length ? 'ready' : (denied.length ? 'permission-denied' : 'not-found');
    } catch (e) {
      j.phase = 'failed'; j.error = e && e.message ? String(e.message) : 'error';
    } finally {
      j.finishedAt = now();
    }
  }

  function snapshot(j) {
    // live progress of a running download (read when asked - no timer to keep in step)
    if (j.mat && j.mat.ctl) {
      const s = j.mat.ctl.snapshot();
      j.mat.loaded = s.loaded;
      const cur = j.candidates.find((c) => c.cid === j.mat.cid);
      if (cur) cur.loaded = s.loaded;
    }
    const waiting = Object.entries(j.permissions).filter(([, v]) => v.state === 'pending').map(([k]) => k);
    const denied = Object.entries(j.permissions).filter(([, v]) => v.state === 'denied' || v.state === 'timeout').map(([k]) => k);
    const perms = {};
    for (const [k, v] of Object.entries(j.permissions)) perms[k] = v.state === 'pending' ? { state: 'pending', sinceMs: now() - v.since } : { state: v.state, ...(v.code ? { code: v.code } : {}) };
    return {
      success: true, job: j.id, phase: j.phase, elapsedMs: (j.finishedAt || now()) - j.startedAt,
      searching: j.searching, permissions: perms, waiting, denied,
      candidates: j.candidates.map((c) => ({ cid: c.cid, state: c.state, size: c.size, loaded: c.loaded || 0, area: c.area, ...(c.code ? { code: c.code } : {}) })),
      materialize: j.mat ? { state: j.mat.state, cid: j.mat.cid, loaded: j.mat.loaded, total: j.mat.total, ...(j.mat.code ? { code: j.mat.code } : {}) } : null,
      stats: { ...j.stats, candidates: j.candidates.length },
    };
  }

  /** Start a job. `q` is validated (validateLocateBody with requireHash:false). `ctx.roots` = the folders to search. */
  function start(q, ctx = {}) {
    prune();
    const j = {
      id: newId(), q, roots: ctx.roots || [], deps: ctx.deps || {}, startedAt: now(), touched: now(), finishedAt: 0,
      phase: 'searching', searching: null, permissions: {}, candidates: [], seen: new Set(), mat: null, cancelled: false, wake: null, error: null,
      stats: { roots: 0, walkDirs: 0, walkTimedOut: false, spotlight: 0, hashed: 0, matches: 0 },
    };
    jobs.set(j.id, j);
    j.running = run(j);
    return j.id;
  }

  const get = (id) => {
    const j = typeof id === 'string' ? jobs.get(id) : null;
    if (j) j.touched = now();
    return j || null;
  };
  const need = (id) => {
    const j = get(id);
    if (!j) throw badRequest('This search is no longer available - choose the file again', 'JOB_EXPIRED');
    return j;
  };

  function status(id) { return snapshot(need(id)); }

  /** Download every placeholder candidate (one after the other). The call returns at once; status shows the progress. */
  function materialize(id) {
    const j = need(id);
    if (j.phase !== 'ready') throw badRequest('Nothing to download yet', 'BAD_STATE');
    if (j.mat && j.mat.state === 'running') return snapshot(j);
    const todo = j.candidates.filter((c) => c.state === 'placeholder');
    if (!todo.length) return snapshot(j);
    j.mat = { state: 'running', cid: todo[0].cid, loaded: 0, total: todo[0].size, ctl: null, code: null };
    (async () => {
      for (const c of todo) {
        if (j.cancelled) break;
        const provider = (companyFile.detectCloudFolder(path.dirname(c.filePath), { platform, home }) || {}).provider;
        c.state = 'downloading';
        j.mat.cid = c.cid; j.mat.total = c.size; j.mat.loaded = 0;
        const ctl = cloud.startMaterialize(c.filePath, { size: c.size, platform, icloud: provider === 'icloud', statBlocks: cloud.blocksReader ? cloud.blocksReader(c.filePath, fsp) : null, ...(j.deps.materialize || {}) });
        j.mat.ctl = ctl;
        const end = await ctl.done;
        c.loaded = end.loaded;
        if (end.state === 'done') { c.state = 'local'; c.loaded = c.size; j.mat.loaded = c.size; continue; }
        c.state = end.state === 'cancelled' ? 'placeholder' : 'failed';
        c.code = end.code || null;
        j.mat.state = end.state; j.mat.code = end.code || null; j.mat.loaded = end.loaded;
        j.mat.ctl = null;
        return;
      }
      j.mat.state = j.cancelled ? 'cancelled' : 'done';
      j.mat.ctl = null;
    })().catch((e) => { if (j.mat) { j.mat.state = 'failed'; j.mat.code = (e && e.code) || 'EUNKNOWN'; } });
    return snapshot(j);
  }

  function cancel(id) {
    const j = get(id);
    if (!j) return { success: true, job: id, phase: 'cancelled' };
    cancelJob(j);
    return snapshot(j);
  }

  /**
   * The page hashed the file it holds (now local): hash the local candidates and answer the path of the one whose full content is equal.
   * @returns {Promise<{found:true,filePath:string,stats:object}|{found:false,reason:'none'|'ambiguous'|'mtime',stats:object}>}
   */
  async function confirm(id, sha256) {
    const j = need(id);
    if (!/^[0-9a-f]{64}$/i.test(String(sha256 || ''))) throw badRequest('sha256 must be 64 hex characters');
    if (j.phase !== 'ready') throw badRequest('There is no candidate to confirm', 'BAD_STATE');
    if (j.candidates.some((c) => c.state === 'placeholder' || c.state === 'downloading')) throw badRequest('The file is not on this computer yet', 'NOT_LOCAL');
    const want = String(sha256).toLowerCase();
    const hash = hashFile || ((p, size) => locateFile.sha256FileIdle(p, { idleMs: locateFile.HASH_IDLE_MS, expectedSize: size }));
    const matches = [];
    for (const c of j.candidates) {
      if (c.state !== 'local') continue;
      j.stats.hashed += 1;
      try {
        const r = await hash(c.filePath, c.size);
        if (r && r.hex === want && r.bytes === c.size) matches.push(c);
      } catch { /* unreadable / stalled / changed while reading: not a match */ }
    }
    j.stats.matches = matches.length;
    const stats = { ...j.stats, candidates: j.candidates.length };
    if (!matches.length) return { found: false, reason: 'none', stats };
    // (review rv203 S1) the candidates already carry the browser's modification time (evaluate() drops the rest) - a single match is the file chosen
    if (matches.length === 1) return { found: true, filePath: matches[0].filePath, stats };
    // identical copies with the same size AND the same modification time (a copy made with `cp -p`): cannot tell which one the user chose
    return { found: false, reason: 'ambiguous', stats };
  }

  return { start, status, materialize, cancel, confirm, _jobs: jobs };
}

module.exports = { createLocateJobs, groupRoots, GROUP_WALK_BUDGET_MS };
