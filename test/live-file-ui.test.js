'use strict';
// 2.0.5 — the installer window: (1) a read-only line on the main screen that always says where everything is saved ("show in Finder"),
// (2) the in-window replace-all confirmation (Cancel is the default) used when a company file is opened from the upgrade notice.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
const renderer = fs.readFileSync(path.join(SRC, 'renderer.js'), 'utf8');
const i18nCtx = { window: {}, document: {} };
vm.createContext(i18nCtx);
vm.runInContext(fs.readFileSync(path.join(SRC, 'i18n.js'), 'utf8') + '\n;this.__I18N = I18N;', i18nCtx);
const I18N = i18nCtx.__I18N;
const LANGS = ['ar', 'en', 'ru', 'uk'];
const KEYS = ['live.title', 'live.single', 'live.many', 'live.planned', 'live.notYet', 'replace.title', 'replace.warn', 'replace.companies', 'replace.sessions', 'replace.unknown', 'replace.cancel', 'replace.confirm'];

test('every text exists in ar / en / ru / uk, with the same {placeholders}, and no emoji', () => {
  const ph = (s) => (String(s).match(/\{[a-z]+\}/g) || []).sort().join(',');
  for (const k of KEYS) {
    const base = I18N.en[k];
    assert.ok(base, `en ${k}`);
    for (const l of LANGS) {
      assert.ok(I18N[l][k] && I18N[l][k].length > 2, `${l} ${k}`);
      assert.equal(ph(I18N[l][k]), ph(base), `${l} ${k} placeholders`);
      assert.doesNotMatch(I18N[l][k], /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${l} ${k} has an emoji`);
    }
  }
});

test('the warning is the owner\'s sentence, word for word', () => {
  assert.equal(I18N.ar['replace.warn'], 'فتح هذا الملف سيستبدل كل الشركات الحالية على هذا الجهاز لكل المستخدمين. نسخة احتياطية تُحفظ أولاً.');
  assert.match(I18N.en['replace.warn'], /replace all current companies on this computer, for every user\. A backup is saved first\./);
  assert.equal(I18N.ar['replace.cancel'], 'إلغاء');
});

test('the Files tab has the read-only live-file path with a «show» button, no input, a sync chip, «sync now» and «change location»', () => {
  const a = html.indexOf('id="tab-files"');
  assert.ok(a > 0);
  const pane = html.slice(a, html.indexOf('id="tab-license"', a));
  assert.match(pane, /id="live-file-path"/);
  assert.match(pane, /id="btn-live-file-show"/);
  assert.match(pane, /id="sync-chip"/);
  assert.match(pane, /id="btn-bk-now"/);
  assert.match(pane, /id="btn-move-file"[^>]*onclick="moveLiveFile\(\)"/);
  const row = pane.slice(pane.indexOf('id="live-file-row"'), pane.indexOf('id="live-file-note"'));
  assert.doesNotMatch(row, /<input|contenteditable/, 'it is read-only');
  assert.match(css, /\.url \{[^}]*user-select: all/, 'the path can be selected and copied');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  for (const id of ['live-file-row', 'live-file-label', 'live-file-path', 'live-file-note', 'btn-live-file-show', 'live-file-show-label', 'replace-confirm', 'btn-replace-cancel', 'btn-replace-yes']) assert.equal(ids.filter((x) => x === id).length, 1, id);
});

test('the red zone «open a company file from another computer» is separate, picks through the main process and goes through the replace-all gate', () => {
  const zone = html.slice(html.indexOf('id="open-file-zone"'), html.indexOf('</section>', html.indexOf('id="open-file-zone"')));
  assert.match(zone, /id="btn-open-file"[^>]*onclick="pickAndOpenCompanyFile\(\)"/);
  assert.match(css, /\.redzone \{[^}]*border: 1px solid #5b2121/);
  const fn = renderer.slice(renderer.indexOf('async function pickAndOpenCompanyFile()'), renderer.indexOf('// ─── OTA Update Widget'));
  assert.match(fn, /window\.texacore\.pickCompanyFile\(\)/);
  assert.match(fn, /openPickedCompanyFile\(confirmed \? \{ confirmReplaceAll: true \} : undefined\)/);
  assert.match(fn, /r\.code === 'REPLACE_ALL_CONFIRM_REQUIRED'/);
  assert.match(fn, /if \(await askReplaceAll\(r\)\)/);
  // the window never names a path to open: only the file the main process remembers
  assert.doesNotMatch(fn, /openPickedCompanyFile\(\s*p\b/);
});

function viewFns() {
  const a = renderer.indexOf('function liveFileView(');
  const b = renderer.indexOf('function renderLiveFile(');
  const c = renderer.indexOf('function replaceConfirmView(');
  const d = renderer.indexOf('function askReplaceAll(');
  assert.ok(a > 0 && b > a && c > 0 && d > c);
  return (lang) => {
    const ctx = { t: (k) => I18N[lang][k] || k };
    vm.createContext(ctx);
    vm.runInContext(renderer.slice(a, b) + renderer.slice(c, d) + '\n;this.__v = { liveFileView, replaceConfirmView };', ctx);
    return ctx.__v;
  };
}
const fnsFor = viewFns();
const LIVE = '/Users/me/Documents/Real.tcdb';
const plain = (x) => JSON.parse(JSON.stringify(x));

test('liveFileView: one company reads «company file»; several read «all companies (N) are saved in ONE file»; the path is always the live file', () => {
  for (const l of LANGS) {
    const v = fnsFor(l);
    const one = plain(v.liveFileView({ liveFile: LIVE, targets: [{ role: 'primary', exists: true, lastSuccess: '2026-10-22T10:00:00Z' }] }, 1));
    assert.equal(one.path, LIVE);
    assert.equal(one.label, I18N[l]['live.single']);
    assert.equal(one.canReveal, true);
    assert.equal(one.note, '');
    const many = plain(v.liveFileView({ liveFile: LIVE, targets: [{ role: 'primary', exists: true }] }, 3));
    assert.equal(many.label, I18N[l]['live.many'].replace('{n}', '3'));
    assert.match(many.label, /3/);
  }
});

test('liveFileView: nothing to show without a live file; a file not written yet says so and cannot be revealed; recorded per-company files are mentioned', () => {
  const v = fnsFor('ar');
  assert.equal(v.liveFileView({ liveFile: null, targets: [] }, 2), null);
  assert.equal(v.liveFileView({}, 0), null);
  const fresh = plain(v.liveFileView({ liveFile: LIVE, targets: [{ role: 'primary', exists: false, lastSuccess: null }] }, 1));
  assert.equal(fresh.canReveal, false);
  assert.equal(fresh.note, I18N.ar['live.notYet']);
  const planned = plain(v.liveFileView({ liveFile: LIVE, plannedCompanies: 2, targets: [{ role: 'primary', exists: true }] }, 3));
  assert.equal(planned.note, I18N.ar['live.planned'].replace('{n}', '2'));
  const noManager = plain(v.liveFileView({ liveFile: LIVE, targets: [] }, 1));
  assert.equal(noManager.canReveal, false, 'no manager yet: nothing is known to exist');
});

test('replaceConfirmView: the warning, the companies (at most 12 listed), the connected sessions; an unreadable list says so', () => {
  const v = fnsFor('en');
  const many = Array.from({ length: 15 }, (_, i) => ({ id: 'id' + i, name: 'Company ' + i }));
  const r = plain(v.replaceConfirmView({ companies: many, sessions: 3 }));
  assert.equal(r.text, I18N.en['replace.warn']);
  assert.equal(r.companiesTitle, 'Current companies (15):');
  assert.equal(r.names.length, 12);
  assert.equal(r.more, 3);
  assert.equal(r.sessions, 'Sessions connected now: 3');
  const unknown = plain(v.replaceConfirmView({ companies: null, sessions: null }));
  assert.equal(unknown.companiesTitle, I18N.en['replace.unknown']);
  assert.deepEqual(unknown.names, []);
  assert.equal(unknown.sessions, '');
  assert.equal(plain(v.replaceConfirmView({ companies: [{ id: 'a', name: '' }], sessions: 0 })).names[0], 'a', 'a company with no name is listed by its id');
  assert.equal(plain(v.replaceConfirmView({ companies: [], sessions: 0 })).companiesTitle, '');
});

test('the confirmation: Cancel is focused first and Escape cancels; only the explicit «yes» button resolves true; text goes in through textContent', () => {
  const ask = renderer.slice(renderer.indexOf('function askReplaceAll('), renderer.indexOf('// After an upgrade over a 1.x install'));
  assert.match(html, /id="overlay-replace"/, 'the question is a dialog above the page');
  assert.match(ask, /no\.focus\(\)/);
  assert.match(ask, /e\.key === 'Escape'[^}]*done\(false\)/);
  assert.match(ask, /yes\.onclick = \(\) => done\(true\)/);
  assert.match(ask, /no\.onclick = \(\) => done\(false\)/);
  assert.doesNotMatch(ask, /innerHTML/);
  // the cancel button comes first in the page (the default / leftmost in the action row)
  assert.ok(html.indexOf('id="btn-replace-cancel"') < html.indexOf('id="btn-replace-yes"'));
});

test('the 1.x upgrade notice is gone: no window, no handler, no bridge, no state file, no leftover style', () => {
  const root = path.join(__dirname, '..', 'src');
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  assert.doesNotMatch(read('index.html'), /overlay-upgrade|upgrade-notice|upgrade-line|upgrade-file/);
  assert.doesNotMatch(read('renderer.js'), /initUpgradeNotice|getUpgradeNotice|openUpgradeTcdb|dismissUpgradeNotice/);
  assert.doesNotMatch(read('preload.js'), /upgrade-notice|UpgradeNotice|openUpgradeFolder|openUpgradeTcdb/);
  assert.doesNotMatch(read('main.js'), /upgrade-notice|readUpgradeNotice|dismissUpgradeNotice/);
  assert.doesNotMatch(read('bootstrap.js'), /upgrade-notice|writeUpgradeNotice|readUpgradeNotice|carryForwardSettings|collectOldTcdbPaths/);
  assert.doesNotMatch(read('styles.css'), /\.upgrade-(notice|file|folder|line|files|status)/);
  // the keys the file-opening flow still uses stay; the dialog's own texts are gone from every language
  const i18n = read('i18n.js');
  for (const k of ['failed', 'opening', 'done', 'doneWithErrors', 'legacyRefused']) assert.equal((i18n.match(new RegExp(`'upgrade\\.${k}':`, 'g')) || []).length, 4, `upgrade.${k} in 4 languages`);
  for (const k of ['title', 'bLegacy', 'a', 'b', 'filesTitle', 'open', 'missing', 'openFolder', 'dismiss']) assert.equal((i18n.match(new RegExp(`'upgrade\\.${k}':`, 'g')) || []).length, 0, `upgrade.${k} removed`);
});

test('the live line is refreshed with the backup status and when the language changes', () => {
  assert.match(renderer, /_lastBackupStatus = st;\s*renderLiveFile\(st\);/);
  assert.match(renderer, /document\.addEventListener\('i18n-applied', \(\) => \{ try \{ if \(typeof _lastBackupStatus/);
  assert.match(renderer, /btn\.onclick = \(\) => \{ window\.texacore\.revealBackup\(v\.path\); \};/);
});
