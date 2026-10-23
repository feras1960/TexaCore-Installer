'use strict';
// ════════════════════════════════════════════════════════════════
// live-file-policy — who may replace the database, and which file is "the live one".  (2.0.5, pure: no Electron, no I/O except where a
// function is handed an fs.)
//
// The shape of a TexaCore desktop install today (the reason for this module):
//   • ONE PostgreSQL database holds EVERY company of the install (a company is a row, not a database);
//   • ONE file is the live company file: BackupManager.backupPath, written whole-database every minute;
//   • opening a .tcdb REPLACES the whole database (it truncates every table, for every user) and re-points that live file at the opened one.
// Two things went wrong silently because of it (owner, 21-10): creating a NEW company re-pointed the live file at the new company's
// file, so the real company kept syncing into a demo file; and opening a file wiped every company without a word.
//
// This module is the rule book for the two fixes (the wiring is in main.js; the design of the per-company future is
// docs/desktop-company-files-design.md in the ERP repo):
//   1. REPLACE-ALL NEEDS A YES.  Opening a company file while the database holds companies is refused with REPLACE_ALL_CONFIRM_REQUIRED
//      unless the request carries an explicit confirmReplaceAll = true. An older page never sends it, so it gets a clear error and nothing
//      changes. A pre-open backup of what is about to be replaced is always taken first.
//   2. THE LIVE FILE NEVER CHANGES OWNER BY ITSELF.  A company created while other companies exist leaves the live file where it is; the
//      file the user chose for it is only RECORDED (config.companies[] entry with planned:true) for the per-company mode of a later round.
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const REPLACE_ALL_CODE = 'REPLACE_ALL_CONFIRM_REQUIRED';
const PRE_OPEN_BACKUP_FAILED = 'PRE_OPEN_BACKUP_FAILED';

/** What the owner asked to be said, word for word (ar) and its English twin; the four-language texts live in the two UIs. */
const REPLACE_ALL_WARNING = {
  ar: 'فتح هذا الملف سيستبدل كل الشركات الحالية على هذا الجهاز لكل المستخدمين. نسخة احتياطية تُحفظ أولاً.',
  en: 'Opening this file will replace ALL current companies on this computer, for every user. A backup is saved first.',
};

/** Only an explicit yes counts: JSON true, or the text "true" / "1" of a form field or a query string. Anything else ("yes", 2, {}, null) is a no. */
function isConfirmed(v) {
  return v === true || v === 'true' || v === '1' || v === 1;
}

/**
 * Does opening a company file need the user's explicit yes?  `snapshot` = what replaceAllSnapshot() read from the database:
 *   { companies: [{id,name}, ...] | null, sessions: number|null, users: number|null, liveFile: string|null }
 * companies === null means "could not be read": the answer is then YES-needed (an unreadable database is not an empty one).
 */
function needsReplaceAllConfirmation(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.companies)) return true;
  return snapshot.companies.length > 0;
}

/** The sentence the HTTP error carries (bilingual, like the other coded errors of the admin API), with what would be lost. */
function replaceAllMessage(snapshot) {
  const names = Array.isArray(snapshot && snapshot.companies) ? snapshot.companies.map((c) => c.name || c.id).filter(Boolean) : null;
  const tail = [];
  if (names && names.length) tail.push(`الشركات الحالية (${names.length}): ${names.slice(0, 8).join('، ')}${names.length > 8 ? '…' : ''}`);
  if (snapshot && Number.isFinite(snapshot.sessions) && snapshot.sessions > 0) tail.push(`جلسات متصلة: ${snapshot.sessions}`);
  const tailEn = [];
  if (names && names.length) tailEn.push(`current companies (${names.length}): ${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''}`);
  if (snapshot && Number.isFinite(snapshot.sessions) && snapshot.sessions > 0) tailEn.push(`connected sessions: ${snapshot.sessions}`);
  return `${REPLACE_ALL_WARNING.ar}${tail.length ? ` (${tail.join(' — ')})` : ''} | ${REPLACE_ALL_WARNING.en}${tailEn.length ? ` (${tailEn.join('; ')})` : ''}`
    + ' | Send confirmReplaceAll:true with the request after the user agreed (update the page if it cannot).';
}

/** The coded error. `replaceAll` is what the page shows in its confirmation (the company list, the sessions); it is copied into the JSON answer. */
function replaceAllError(snapshot) {
  const e = new Error(replaceAllMessage(snapshot));
  e.code = REPLACE_ALL_CODE;
  e.replaceAll = {
    companies: Array.isArray(snapshot && snapshot.companies) ? snapshot.companies.map((c) => ({ id: c.id, name: c.name })) : null,
    sessions: snapshot && Number.isFinite(snapshot.sessions) ? snapshot.sessions : null,
    users: snapshot && Number.isFinite(snapshot.users) ? snapshot.users : null,
    liveFile: (snapshot && snapshot.liveFile) || null,
    backupFirst: true,
  };
  return e;
}

/** Throws REPLACE_ALL_CONFIRM_REQUIRED unless the database holds no companies or the request carried an explicit yes. */
function requireReplaceAllConfirmation({ confirmReplaceAll, snapshot }) {
  if (isConfirmed(confirmReplaceAll)) return;
  if (!needsReplaceAllConfirmation(snapshot)) return;
  throw replaceAllError(snapshot);
}

/** The pre-open backup could not be written although companies exist: nothing is replaced. */
function preOpenBackupError(cause) {
  const e = new Error('تعذّر حفظ نسخة احتياطية من الشركات الحالية قبل الاستبدال، فلم يتغيّر شيء | '
    + `The backup of the current companies could not be saved first, so nothing was replaced (${String((cause && cause.message) || cause || 'unknown').slice(0, 200)})`);
  e.code = PRE_OPEN_BACKUP_FAILED;
  return e;
}

// ─── the pre-open backup file ────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }
/** yyyy-mm-dd_HHMMSS in the LOCAL calendar. */
function localStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

/** <data dir>/backups/pre-open/before-open-<stamp>.tcdb — inside the program's own folder (never beside the user's file, never over another file). */
function preOpenBackupPath(dataDir, now = new Date()) {
  return path.join(dataDir, 'backups', 'pre-open', `before-open-${localStamp(now)}.tcdb`);
}

/** Keep the newest `keep` pre-open backups of this folder, delete older ones. Only files named before-open-*.tcdb are ever touched. Returns the deleted names. */
function prunePreOpenBackups(dir, keep = 10, fsApi = fs) {
  const gone = [];
  try {
    const names = fsApi.readdirSync(dir).filter((n) => /^before-open-\d{4}-\d{2}-\d{2}_\d{6}\.tcdb$/.test(n)).sort();   // the stamp sorts chronologically
    while (names.length > keep) {
      const old = names.shift();
      try { fsApi.unlinkSync(path.join(dir, old)); gone.push(old); } catch { /* in use / already gone */ }
    }
  } catch { /* no folder yet */ }
  return gone;
}

// ─── which file is the live one, and a company created next to others ─────────────────────

function isAbs(p) { return typeof p === 'string' && p.length > 0 && path.isAbsolute(p); }

/**
 * The entry of config.companies that names the live file: the first one that is NOT a planned (per-company, future) entry.
 * Every reader of the live file (start-up auto-backup, «backup export info») goes through this, so a planned entry can never be mistaken for it.
 */
function liveEntryOf(companies) {
  for (const c of Array.isArray(companies) ? companies : []) {
    if (c && typeof c === 'object' && c.planned !== true) return c;
  }
  return null;
}

/**
 * Where the data of a company created now will actually be saved.
 *   existingCompanyCount — companies already in the database BEFORE this one was created;
 *   liveFilePath         — the file the whole database is syncing into right now (null when there is none).
 * keepLive = other companies exist AND a live file exists: the live file stays, the new company's chosen path is only recorded.
 * Otherwise (an empty database, or nothing was syncing anywhere) the new company's file becomes the live file, as before.
 */
function planNewCompanyFile({ existingCompanyCount, liveFilePath }) {
  const live = isAbs(liveFilePath) ? liveFilePath : null;
  const keepLive = Number(existingCompanyCount) > 0 && !!live;
  return { keepLive, liveFilePath: live };
}

/**
 * config.companies after a company was created while the live file stays where it is: the live entry first (made from `liveFilePath` when
 * the config had none), then one planned entry per company that chose its own file. Same company id again = the planned entry is replaced.
 * Entries are plain data: { name, companyId, tenantId, planned:true, plannedTcdbPath, plannedStoragePath, placement, plannedAt }.
 */
function recordPlannedCompany(companies, planned, liveFilePath, now = new Date()) {
  const list = (Array.isArray(companies) ? companies : []).filter((c) => c && typeof c === 'object');
  const out = list.filter((c) => !(c.planned === true && planned.companyId && c.companyId === planned.companyId));
  if (isAbs(liveFilePath) && !liveEntryOf(out)) {
    out.unshift({ name: path.basename(liveFilePath).replace(/\.tcdb$/i, ''), tcdbPath: liveFilePath, storagePath: path.dirname(liveFilePath) });
  } else if (liveEntryOf(out)) {
    // keep the live entry at index 0: the start-up code of 2.0.x reads companies[0]
    const li = out.indexOf(liveEntryOf(out));
    if (li > 0) out.unshift(out.splice(li, 1)[0]);
  }
  out.push({
    name: String(planned.name || '').slice(0, 200),
    companyId: planned.companyId || null,
    tenantId: planned.tenantId || null,
    planned: true,
    plannedTcdbPath: isAbs(planned.plannedTcdbPath) ? planned.plannedTcdbPath : null,
    plannedStoragePath: isAbs(planned.plannedStoragePath) ? planned.plannedStoragePath : null,
    placement: planned.placement || null,
    plannedAt: now.toISOString(),
  });
  return out;
}

/** The planned (per-company) file recorded for a company, or null. */
function plannedFileOf(companies, companyId) {
  const c = (Array.isArray(companies) ? companies : []).find((x) => x && x.planned === true && x.companyId === companyId);
  return c && c.plannedTcdbPath ? c.plannedTcdbPath : null;
}

/**
 * config.companies after the live file MOVED to `to` (2.0.5 RC2, «change place»): the live entry (never a planned one) keeps its name and its
 * other fields (copyPath...) and gets the new tcdbPath + storagePath; with no live entry yet one is made, first in the list (the start-up code reads
 * the live entry). Planned entries are untouched. The old file is NOT recorded anywhere as owned - it is left in place for the user.
 */
function moveLiveEntry(companies, from, to) {
  if (!isAbs(to)) return Array.isArray(companies) ? companies.slice() : [];
  const list = (Array.isArray(companies) ? companies : []).map((c) => (c && typeof c === 'object' ? { ...c } : c));
  const live = liveEntryOf(list);
  if (live) {
    live.tcdbPath = to;
    live.storagePath = path.dirname(to);
    return list;
  }
  list.unshift({ name: path.basename(to).replace(/\.tcdb$/i, ''), tcdbPath: to, storagePath: path.dirname(to) });
  return list;
}

module.exports = {
  REPLACE_ALL_CODE, PRE_OPEN_BACKUP_FAILED, REPLACE_ALL_WARNING,
  isConfirmed, needsReplaceAllConfirmation, replaceAllMessage, replaceAllError, requireReplaceAllConfirmation, preOpenBackupError,
  localStamp, preOpenBackupPath, prunePreOpenBackups,
  liveEntryOf, planNewCompanyFile, recordPlannedCompany, plannedFileOf, moveLiveEntry,
};
