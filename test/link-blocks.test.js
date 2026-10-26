'use strict';
// The launcher (2.0.5 RC2 design): header (chips · language · stop) · hero (company + ONE primary) · three tabs (links · files and backups · licence and support).
// Every link row has the SAME shape (label · monospace LTR box · «فتح» · «نسخ»), each link appears once, the employees form is gone (adding users lives in the program),
// one font family and three sizes, every text exists in ar / en / ru / uk, and ONE chosen company drives the links. The rendering itself (no scroll, the seven states in four
// languages) is measured in a real browser by scripts/e2e/launcher-layout.cjs.
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

function block(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  assert.ok(a >= 0, `marker not found: ${startMarker}`);
  const b = html.indexOf(endMarker, a + startMarker.length);
  assert.ok(b > a, `end marker not found: ${endMarker}`);
  return html.slice(a, b);
}
const links = block('id="tab-links"', 'id="tab-files"');
const files = block('id="tab-files"', 'id="tab-license"');
const licence = block('id="tab-license"', '<!-- ═══ Dialogs');

test('the page is: header, hero, tabs, three panes — in that order', () => {
  const at = (id) => html.indexOf(id);
  assert.ok(at('class="hdr"') < at('id="hero"') && at('id="hero"') < at('id="tabs"') && at('id="tabs"') < at('id="tab-links"'));
  assert.ok(at('id="tab-links"') < at('id="tab-files"') && at('id="tab-files"') < at('id="tab-license"'));
  const tabs = [...html.matchAll(/role="tab"[^>]*data-tab="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(tabs, ['links', 'files', 'license']);
  assert.match(html, /role="tablist"/);
  // the header: logo + version, three status chips, the language select, a small stop button
  for (const id of ['chip-erp', 'chip-database', 'chip-license', 'lang-select', 'btn-stop', 'version']) assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, id);
});

test('every element id in the page is unique', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual(dup, []);
});

test('the hero has the company select and ONE green primary at a time (open / start / create, chosen by data-mode)', () => {
  const hero = block('id="hero"', 'id="tabs"');
  assert.match(hero, /id="link-company"[^>]*onchange="onEmployeeCompanyChange\(this\)"/);
  const primaries = [...hero.matchAll(/class="btn btn-primary btn-lg" id="(\w[\w-]*)"/g)].map((m) => m[1]);
  assert.deepEqual(primaries, ['btn-open', 'btn-start']);
  // CSS shows exactly one of them in every mode
  for (const mode of ['stopped', 'nolicense', 'starting']) assert.match(css, new RegExp(`\\.hero\\[data-mode="${mode}"\\] #btn-open`), `${mode} hides open`);
  for (const mode of ['ready', 'nocompany']) assert.match(css, new RegExp(`\\.hero\\[data-mode="${mode}"\\] #btn-start`), `${mode} hides start`);
  assert.doesNotMatch(hero, /id="btn-open"[^>]*style="display:none/, 'visibility is the CSS\'s job (data-mode)');
});

test('EVERY link row has the same shape: label, a monospace LTR box, «فتح» and «نسخ» (the file path: «إظهار»); each link appears once', () => {
  const rows = [...html.matchAll(/<div class="linkrow"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g)].map((m) => m[0]);
  assert.ok(rows.length >= 5, `${rows.length} link rows`);
  for (const r of rows) {
    assert.match(r, /<span class="lbl"/, 'a label');
    assert.match(r, /<span class="url"[^>]*dir="ltr"/, 'a monospace LTR box');
  }
  for (const id of ['lan-employee-url', 'employee-url', 'cloud-url']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, id);
    const row = rows.find((r) => r.includes(`id="${id}"`));
    assert.ok(row, `row of ${id}`);
    assert.match(row, /data-i18n="link\.open"/, `${id}: فتح`);
    assert.match(row, /data-i18n="emp\.copy"/, `${id}: نسخ`);
  }
  for (const id of ['copy-lan-employee-url', 'copy-employee-url', 'copy-cloud-url']) assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, id);
  // the office link is on the left card of the links tab, the employee link + the portal address on the cloud card; nothing else carries a link
  const office = block('id="access-box"', 'id="cloud-box"');
  const cloud = links.slice(links.indexOf('id="cloud-box"'));
  assert.match(office, /id="lan-employee-url"/); assert.doesNotMatch(office, /id="(employee-url|cloud-url)"/);
  assert.match(cloud, /id="employee-url"/); assert.match(cloud, /id="cloud-url"/); assert.doesNotMatch(cloud, /id="lan-employee-url"/);
  assert.doesNotMatch(files + licence, /id="(lan-employee-url|employee-url|cloud-url)"|login\?c=/);
  assert.doesNotMatch(html, /id="local-url"|id="employee-link-box"|id="copy-local-url"/);
  assert.match(css, /\.url \{[^}]*direction: ltr; unicode-bidi: isolate/);
  assert.match(css, /--mono:/);
});

test('the office card: the employee link and the network-address picker (existing LAN logic); the cloud card: switch, status, employee link, portal link, «change the portal password»', () => {
  assert.match(links, /id="lan-addr"/); assert.match(links, /id="btn-lan-change"[^>]*onclick="toggleLanPicker\(\)"/); assert.match(links, /id="lan-select"[^>]*onchange="onLanPick\(this\.value\)"/);
  for (const id of ['input-cloud', 'tunnel-status', 'tunnel-fix-box', 'btn-fix-link', 'btn-reconnect', 'input-subdomain', 'btn-register-domain', 'btn-toggle-admin-password']) assert.match(links, new RegExp(`id="${id}"`), id);
  assert.match(html, /id="input-cloud" role="switch"/);
  assert.match(html, /id="admin-password-panel"[^>]*role="dialog"/);
});

test('the employees form is gone from the launcher (adding users moves into the program)', () => {
  for (const id of ['employees-box', 'emp-company', 'emp-role', 'emp-name', 'emp-email', 'btn-add-employee', 'emp-result', 'emp-roles-hint', 'btn-open-roles']) assert.doesNotMatch(html, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(renderer, /async function addEmployee\(|loadEmployeeRoles|openRolesPage|inviteEmployee/);
});

test('the Files tab and the Licence tab carry the agreed items', () => {
  for (const id of ['live-file-path', 'btn-live-file-show', 'sync-chip', 'btn-bk-now', 'btn-move-file', 'btn-backup-now', 'bk-list', 'open-file-zone', 'btn-open-file']) assert.match(files, new RegExp(`id="${id}"`), id);
  for (const id of ['badge-days', 'license-meter', 'btn-buy', 'btn-enter-key', 'panel-license', 'input-license', 'btn-activate', 'btn-trial', 'btn-free', 'support-code', 'btn-copy-key', 'info-version', 'build-date', 'input-port', 'btn-check-update', 'btn-open-log']) assert.match(licence, new RegExp(`id="${id}"`), id);
  // the port moved here and stays editable
  assert.match(licence, /id="input-port"[^>]*type="number"|type="number"[^>]*id="input-port"/);
  // the stop question, the replace question and the portal password are dialogs above the page, never in the flow of a card
  for (const id of ['overlay-stop', 'overlay-replace', 'overlay-password']) assert.match(html, new RegExp(`class="overlay" id="${id}"`), id);
});

test('one font family and three sizes: every font-size is 12 / 14 / 16 px (through the tokens); no inline font-size anywhere', () => {
  assert.match(css, /--fs-s: 12px;[\s\S]*--fs-m: 14px;[\s\S]*--fs-l: 16px;/);
  const sizes = [...css.matchAll(/font(?:-size)?:\s*[^;{}]*?(var\(--fs-[sml]\)|\d+(?:\.\d+)?px)/g)].map((m) => m[1]);
  assert.ok(sizes.length > 30);
  for (const s of sizes) assert.ok(/^var\(--fs-[sml]\)$/.test(s) || ['12px', '14px', '16px'].includes(s), `font size ${s}`);
  assert.doesNotMatch(html, /style="[^"]*font-size/);
  assert.doesNotMatch(renderer, /font-size\s*:/);
  assert.match(css, /--font: 'Cairo'/);
});

test('names and paths are isolated: the company select, the backup rows, the replace list; the select text is not clipped', () => {
  assert.match(html, /id="link-company" class="ctl ctl-lg name"/);
  assert.match(css, /\.name \{ unicode-bidi: isolate; \}/);
  assert.match(css, /\.row-main \{[^}]*unicode-bidi: isolate/);
  assert.match(css, /\.replace-confirm-list \{[^}]*unicode-bidi: isolate/);
  assert.match(css, /select\.ctl \{[^}]*line-height: 1\.6/);
});

test('all texts used by the launcher exist in ar, en, ru and uk, with the same {placeholders}', () => {
  const keys = new Set([...html.matchAll(/data-i18n(?:-ph|-aria)?="([^"]+)"/g)].map((m) => m[1]));
  for (const m of renderer.matchAll(/\bt\('([a-zA-Z0-9_.-]+)'\)/g)) keys.add(m[1]);
  for (const m of renderer.matchAll(/'(ui\.[a-zA-Z0-9_.-]*[a-zA-Z0-9_-])'/g)) keys.add(m[1]);
  for (const kind of ['daily', 'pre-open', 'manual']) keys.add('ui.bk.kind.' + kind);
  keys.add('ui.move.err.unknown');
  const ph = (s) => (String(s).match(/\{[a-zA-Z]+\}/g) || []).sort().join(',');
  let n = 0;
  for (const k of keys) {
    n++;
    for (const lang of LANGS) assert.ok(I18N[lang][k] && String(I18N[lang][k]).trim(), `${lang} is missing ${k}`);
    for (const lang of LANGS) assert.equal(ph(I18N[lang][k]), ph(I18N.en[k]), `${lang} ${k} placeholders`);
  }
  assert.ok(n > 100, `${n} keys checked`);
});

// ── behaviour of the renderer's link / state code, run against a tiny fake page ──
function slice(a, b) {
  const i = renderer.indexOf(a); const j = renderer.indexOf(b, i);
  assert.ok(i >= 0 && j > i, `${a} .. ${b}`);
  return renderer.slice(i, j);
}
function loadLinks() {
  const src = slice('// ─── Employee links (Blocks 1 and 2)', 'function fillCompanySelect')
    + '\n' + slice('function heroMode(state)', 'function renderHero(state)')
    + '\nthis.__api = { companyCode, lanEmployeeLink, cloudEmployeeLink, chosenCompanyId, setChosenCompany, renderLinks, heroMode, setList: (l, listed) => { _empCompanies = l; _empListed = listed; } };';
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, style: {}, dataset: {}, textContent: '', value: '', disabled: false });
  const ctx = { $: (id) => el(id), currentState: {} };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { api: ctx.__api, els, el, ctx };
}
const CO1 = { id: '17249eed-1c2a-4b7e-9d0a-6f3b2c1d4e5f', name: '2023 مطور بعد الصيانة' };
const CO2 = { id: 'a91c03de-1c2a-4b7e-9d0a-6f3b2c1d4e5f', name: 'شركة الحمرا للأقمشة' };
const RUN = { containerRunning: true, hasLicense: true };

test('one company: the office link and the cloud link carry the SHORT code (not the Arabic name)', () => {
  const { api, els } = loadLinks();
  const st = Object.assign({ localIp: '172.20.10.2', config: { port: 8080, subdomain: 'hama-demo' } }, RUN);
  api.setList([CO1], true);
  api.renderLinks(st);
  assert.equal(els['lan-employee-url'].textContent, 'http://172.20.10.2:8080/login?c=17249eed');
  assert.equal(els['lan-employee-url'].dataset.url, 'http://172.20.10.2:8080/login?c=17249eed');
  assert.equal(els['employee-url'].textContent, 'https://hama-demo.texacore.ai/login?c=17249eed');
  assert.equal(els['lan-link-row'].style.display, 'flex');
  assert.equal(els['cloud-employee-row'].style.display, 'flex');
  assert.equal(els['lan-no-company'].style.display, 'none');
  assert.equal(els['open-lan-employee-url'].disabled, false);
  assert.doesNotMatch(els['lan-employee-url'].textContent + els['employee-url'].textContent, /[^\x00-\x7F]/);   // ASCII only: no URL-encoded Arabic
});

test('port 80 is left out of the office link; no cloud name → no cloud employee link; no LAN address → no office link', () => {
  const { api, els } = loadLinks();
  api.setList([CO1], true);
  api.renderLinks(Object.assign({ localIp: '192.168.1.20', config: { port: 80, subdomain: '' } }, RUN));
  assert.equal(els['lan-employee-url'].textContent, 'http://192.168.1.20/login?c=17249eed');
  assert.equal(els['cloud-employee-row'].style.display, 'none');
  api.renderLinks(Object.assign({ localIp: '', config: { port: 80, subdomain: 'x' } }, RUN));
  assert.equal(els['lan-link-row'].style.display, 'none');
  assert.equal(els['cloud-employee-row'].style.display, 'flex');
});

test('several companies: the hero\'s choice drives BOTH links', () => {
  const { api, els } = loadLinks();
  const st = Object.assign({ localIp: '172.20.10.2', config: { port: 8080, subdomain: 'hama-demo' } }, RUN);
  api.setList([CO1, CO2], true);
  api.renderLinks(st);
  assert.equal(els['lan-employee-url'].textContent, 'http://172.20.10.2:8080/login?c=17249eed');   // the newest company (first of the list) by default
  api.setChosenCompany(CO2.id);
  api.renderLinks(st);
  assert.equal(els['lan-employee-url'].textContent, 'http://172.20.10.2:8080/login?c=a91c03de');
  assert.equal(els['employee-url'].textContent, 'https://hama-demo.texacore.ai/login?c=a91c03de');
  assert.equal(els['link-company'].value, CO2.id);
  api.setList([CO1], true);                                // a company that no longer exists falls back to the first
  assert.equal(api.chosenCompanyId(), CO1.id);
});

test('«first run, no company»: the note shows only once the list was really read and the system runs; nothing is linked', () => {
  const { api, els } = loadLinks();
  const st = Object.assign({ localIp: '172.20.10.2', config: { port: 8080, subdomain: 'hama-demo' } }, RUN);
  api.setList([], false);
  api.renderLinks(st);
  assert.equal(els['lan-no-company'].style.display, 'none');
  assert.equal(api.heroMode(st), 'ready', 'not read yet: not «no company»');
  api.setList([], true);
  api.renderLinks(st);
  assert.equal(els['lan-no-company'].style.display, 'block');
  assert.equal(els['lan-link-row'].style.display, 'none');
  assert.equal(els['cloud-employee-row'].style.display, 'none');
  assert.equal(api.heroMode(st), 'nocompany');
});

test('«system stopped»: the hero offers start; links can be copied but not opened; the stopped note shows when no company is known', () => {
  const { api, els } = loadLinks();
  const st = { containerRunning: false, hasLicense: true, localIp: '172.20.10.2', config: { port: 8080, subdomain: 'hama-demo' } };
  api.setList([], false);
  api.renderLinks(st);
  assert.equal(api.heroMode(st), 'stopped');
  assert.equal(els['lan-stopped'].style.display, 'block');
  api.setList([CO1], true);
  api.renderLinks(st);
  assert.equal(els['lan-stopped'].style.display, 'none');
  assert.equal(els['lan-link-row'].style.display, 'flex');
  assert.equal(els['open-lan-employee-url'].disabled, true);
  assert.equal(els['btn-open-cloud'].disabled, true);
});

test('«licence expired»: the hero has neither open nor start (data-mode nolicense) whatever else is true', () => {
  const { api } = loadLinks();
  assert.equal(api.heroMode({ containerRunning: true, hasLicense: false }), 'nolicense');
  assert.equal(api.heroMode({ containerRunning: false, hasLicense: false }), 'nolicense');
});

test('licence view: trial / free / paid / expired / none, days left and the plural word per language', () => {
  const src = slice('function licenseView(state)', 'function updateStatusCards(state)') + slice('function daysWord(n)', 'function fmtMB(bytes)')
    + '\nthis.__v = { licenseView, daysWord };';
  const ctx = { CURRENT_LANG: 'ar' };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const { licenseView, daysWord } = ctx.__v;
  const plain = (x) => JSON.parse(JSON.stringify(x));
  const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
  const trial = plain(licenseView({ hasLicense: true, config: { isTrial: true }, licenseInfo: { tier: 'professional', license_key: 'TRL-2026-AAAAA-BBBBB', expires_at: inDays(7) } }));
  assert.equal(trial.kind, 'trial'); assert.equal(trial.daysLeft, 7); assert.equal(trial.total, 30);
  assert.equal(plain(licenseView({ hasLicense: true, config: { isFree: true }, licenseInfo: { tier: 'free', license_key: 'FREE-LOCAL' } })).kind, 'free');
  assert.equal(plain(licenseView({ hasLicense: true, config: {}, licenseInfo: { tier: 'professional', license_key: 'LIC-1', expires_at: inDays(200) } })).kind, 'paid');
  assert.equal(plain(licenseView({ hasLicense: false, config: {}, licenseInfo: { tier: 'professional', license_key: 'LIC-1', expires_at: inDays(-3) } })).kind, 'expired');
  assert.equal(plain(licenseView({ hasLicense: false, config: {}, licenseInfo: null })).kind, 'none');
  assert.deepEqual([1, 2, 5, 11].map((n) => daysWord(n)), ['يوم', 'يومان', 'أيام', 'يوماً']);
  ctx.CURRENT_LANG = 'en'; assert.deepEqual([1, 7].map((n) => daysWord(n)), ['day', 'days']);
  ctx.CURRENT_LANG = 'ru'; assert.deepEqual([1, 3, 7, 11, 21].map((n) => daysWord(n)), ['день', 'дня', 'дней', 'дней', 'день']);
  ctx.CURRENT_LANG = 'uk'; assert.deepEqual([1, 3, 7].map((n) => daysWord(n)), ['день', 'дні', 'днів']);
});

test('the path notice: iCloud Drive and Documents keep their warning, the new default does not', () => {
  const src = slice('function pathArea(p)', 'function renderLiveFile(st)') + '\nthis.__f = pathArea;';
  const ctx = {}; vm.createContext(ctx); vm.runInContext(src, ctx);
  const f = ctx.__f;
  assert.equal(f('/Users/me/Library/Mobile Documents/com~apple~CloudDocs/TexaCore/a.tcdb'), 'icloud');
  assert.equal(f('/Users/me/iCloud Drive/x.tcdb'), 'icloud');
  assert.equal(f('/Users/me/Documents/TexaCore/a.tcdb'), 'documents');
  assert.equal(f('C:\\Users\\me\\Documents\\TexaCore\\a.tcdb'), 'documents');
  assert.equal(f('/Users/me/TexaCore/a.tcdb'), null);
  assert.equal(f('C:\\TexaCore\\a.tcdb'), null);
});

test('the cloud card keeps its order: employee link, portal link, status box, portal password', () => {
  const cloud = links.slice(links.indexOf('id="cloud-box"'));
  assert.match(cloud, /id="btn-open-cloud"[^>]*onclick="openCloudUrl\(\)"/);
  assert.ok(cloud.indexOf('id="employee-url"') < cloud.indexOf('id="cloud-url"'));
  assert.ok(cloud.indexOf('id="cloud-url"') < cloud.indexOf('id="tunnel-fix-box"'));
  assert.ok(cloud.indexOf('id="tunnel-fix-box"') < cloud.indexOf('id="btn-toggle-admin-password"'));
});

test('«tunnel down» shows the reason and «إعادة الاتصال» (the fast reconnect); a route problem keeps «إصلاح الرابط»', () => {
  assert.match(renderer, /async function reconnectTunnel\(\)[\s\S]*setCloudAccess\(true\)/);
  const fix = slice('function renderTunnelFix(', 'let _nameTakenForcedSetup');
  assert.match(fix, /canReconnect/);
  assert.match(fix, /btn\.style\.display = canFix \? 'inline-flex' : 'none'/);
});

test('the cloud card carries the agreed security help line (muted, wrapping, an info icon) - in four languages, never worded as «end-to-end»', () => {
  const cloud = links.slice(links.indexOf('id="cloud-box"'));
  assert.match(cloud, /class="help" id="cloud-secure-note"><svg class="icon icon-16"[^>]*><use href="#i-info"><\/use><\/svg><span data-i18n="ui\.cloud\.secureNote"/);
  // it sits under the header (status line) and before the links
  assert.ok(cloud.indexOf('id="cloud-secure-note"') > cloud.indexOf('id="tunnel-status"') && cloud.indexOf('id="cloud-secure-note"') < cloud.indexOf('id="cloud-content"'));
  assert.equal(I18N.ar['ui.cloud.secureNote'], 'الاتصال مشفّر في كل الطريق: من جهاز الموظف إلى Cloudflare عبر HTTPS، ومنها إلى هذا الجهاز عبر نفق مشفّر يفتحه جهازك بنفسه. لا يُفتح أي منفذ على جهازك أو على الراوتر، ولا يدخل أحد إلا بتسجيل الدخول وصلاحياته.');
  for (const lang of LANGS) {
    const v = I18N[lang]['ui.cloud.secureNote'];
    assert.ok(v && v.length > 120, lang);
    assert.doesNotMatch(v, /end[- ]to[- ]end|от начала до конца|наскрізн|сквозн|طرف إلى طرف/i, `${lang} must not claim end-to-end`);
    assert.match(v, /Cloudflare/, lang);
  }
  // muted, the small size token (the design allows three sizes only), wrapping
  assert.match(css, /\.help \{[^}]*color: var\(--muted\)[^}]*font-size: var\(--fs-s\)/);
  assert.doesNotMatch(css.match(/\.help \{[^}]*\}/)[0], /white-space: nowrap/);
});

test('the word beside the cloud switch follows the switch (on / off), in every language', () => {
  assert.match(html, /<span id="cloud-switch-label">/);
  const fn = slice('function syncSwitch(el)', 'let _verifiedAliveSubdomain');
  assert.match(fn, /t\(i\.checked \? 'ui\.cloud\.enabled' : 'ui\.cloud\.disabled'\)/);
  for (const lang of LANGS) { assert.ok(I18N[lang]['ui.cloud.enabled'] && I18N[lang]['ui.cloud.disabled'], lang); assert.notEqual(I18N[lang]['ui.cloud.enabled'], I18N[lang]['ui.cloud.disabled'], lang); }
});
