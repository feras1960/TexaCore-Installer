'use strict';
// The three blocks of the launcher's main screen (2.0.5): «الدخول إلى البرنامج», «الوصول من أي مكان (سحابي)», «الموظفون».
// Each employee link appears exactly once, the form is labelled and full-width, every text is in ar / en / ru / uk, and ONE chosen company drives both links.
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
const access = block('id="access-box"', '<!-- Block 2');
const cloud = block('id="cloud-box"', '<!-- Block 3');
const employees = block('id="employees-box"', '<!-- Backups');

test('the three blocks come in the owner\'s order: access, cloud, employees', () => {
  const at = (id) => html.indexOf(`id="${id}"`);
  assert.ok(at('access-box') > 0 && at('access-box') < at('cloud-box') && at('cloud-box') < at('employees-box'));
  assert.ok(at('btn-open') > at('access-box') && at('btn-open') < at('cloud-box'), 'the big «open the program» button is the first thing of Block 1');
  assert.ok(at('btn-open-cloud') > at('cloud-box') && at('btn-open-cloud') < at('employees-box'));
});

test('every element id in the page is unique', () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual(dup, []);
});

test('each link appears exactly once: the office link in Block 1, the cloud address + the cloud employee link in Block 2, none in Block 3; no old «local» link', () => {
  for (const id of ['lan-employee-url', 'employee-url', 'cloud-url']) assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, id);
  assert.match(access, /id="lan-employee-url"/);
  assert.doesNotMatch(access, /id="(employee-url|cloud-url)"/);
  assert.match(cloud, /id="cloud-url"/);
  assert.match(cloud, /id="employee-url"/);
  assert.doesNotMatch(cloud, /id="lan-employee-url"/);
  assert.doesNotMatch(employees, /class="link-url"|id="(lan-employee-url|employee-url|cloud-url)"|\.texacore\.ai|login\?c=/);
  assert.doesNotMatch(html, /id="local-url"|id="employee-link-box"|id="copy-local-url"/);
  // exactly three link boxes on the whole screen
  assert.equal([...html.matchAll(/class="link-url"|class="lp-url"/g)].length, 3);
  // every link has its own copy button
  for (const id of ['copy-lan-employee-url', 'copy-employee-url', 'copy-cloud-url']) assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, id);
  // the renderer never writes a link into the add-employee result any more
  const add = renderer.slice(renderer.indexOf('async function addEmployee()'), renderer.indexOf('// ─── Cloud Logic'));
  assert.doesNotMatch(add, /lanEmployeeLink|cloudEmployeeLink|login\?c=/);
});

test('Block 3: four visible labels, every control full-width (.field-input, never the 80px .input-small), the roles hint is actionable', () => {
  for (const id of ['emp-company', 'emp-role', 'emp-name', 'emp-email']) {
    assert.match(employees, new RegExp(`<label for="${id}"[^>]*data-i18n="emp\\.(company|role|name|email)"`), `label for ${id}`);
    const tag = employees.match(new RegExp(`<(?:select|input)[^>]*id="${id}"[^>]*>`))[0];
    assert.match(tag, /class="field-input/, id);
    assert.doesNotMatch(tag, /input-small/, id);
  }
  assert.match(css, /\.field-input\s*\{[^}]*width:\s*100%/);
  assert.match(css, /\.input-small\s*\{[^}]*width:\s*80px/);          // still the port field's rule
  assert.doesNotMatch(html.slice(html.indexOf('id="employees-box"'), html.indexOf('id="backups-box"')), /input-small/);
  assert.match(employees, /id="emp-roles-hint"/);
  assert.match(employees, /onclick="openRolesPage\(\)"/);
  // the page the button opens is the ERP's real route (users & permissions, first tab = roles)
  assert.match(renderer, /\/system-config\/users-permissions/);
});

test('the company selector of Block 1 and the form\'s company field both exist and change the same chosen company', () => {
  assert.match(access, /id="link-company"[^>]*onchange="onEmployeeCompanyChange\(this\)"/);
  assert.match(employees, /id="emp-company"[^>]*onchange="onEmployeeCompanyChange\(this\)"/);
});

test('all texts used by the three blocks exist in ar, en, ru and uk (no leftovers of the removed keys)', () => {
  const region = access + cloud + employees;
  const keys = new Set([...region.matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)].map((m) => m[1]));
  for (const k of ['access.title', 'access.subtitle', 'access.lanTitle', 'access.lanHint', 'link.open', 'cloud.openAnywhere', 'cloud.employeeTitle', 'cloud.employeeLinkHint',
    'emp.title', 'emp.subtitle', 'emp.company', 'emp.role', 'emp.name', 'emp.email', 'emp.namePh', 'emp.rolesHintTitle', 'emp.rolesHint', 'emp.openRoles', 'emp.add', 'emp.noCompany', 'btn.open']) keys.add(k);
  for (const lang of LANGS) {
    for (const k of keys) assert.ok(I18N[lang][k] && String(I18N[lang][k]).trim(), `${lang} is missing ${k}`);
    for (const k of ['emp.lanLink', 'cloud.urlRemote', 'cloud.urlLocal', 'cloud.urlEmployee', 'cloud.employeeHint', 'cloud.copyLink']) assert.equal(I18N[lang][k], undefined, `${lang} still has ${k}`);
  }
});

test('the explanations say WHO uses each link and WHEN, in plain words (Arabic wording agreed with the owner)', () => {
  assert.equal(I18N.ar['access.lanTitle'], 'رابط الموظفين (داخل المكتب)');
  assert.equal(I18N.ar['access.lanHint'], 'أرسله لموظفي هذه الشركة على شبكة المكتب؛ يفتح الشركة مباشرة ويعمل بلا إنترنت.');
  assert.equal(I18N.ar['cloud.employeeTitle'], 'رابط الموظفين (من أي مكان)');
  assert.equal(I18N.ar['cloud.employeeLinkHint'], 'يعمل عبر الإنترنت من أي مكان، ويحتاج أن يبقى هذا الجهاز شغّالاً ومتصلاً.');
  assert.equal(I18N.ar['cloud.openAnywhere'], 'فتح البرنامج من أي مكان');
  assert.equal(I18N.ar['btn.open'], 'فتح البرنامج في المتصفح');
  assert.equal(I18N.ar['access.title'], 'الدخول إلى البرنامج');
  assert.equal(I18N.ar['emp.title'], 'الموظفون');
  for (const lang of LANGS) {
    assert.notEqual(I18N[lang]['access.lanHint'], I18N[lang]['cloud.employeeLinkHint'], `${lang}: the two explanations must differ`);
    assert.match(I18N[lang]['emp.subtitle'], /./);
  }
});

// ── behaviour of the renderer's link code, run against a tiny fake page ──
function loadLinks() {
  const a = renderer.indexOf('// ─── Employee links (Blocks 1 and 2)');
  const b = renderer.indexOf('async function refreshEmployeesBox');
  const src = renderer.slice(a, b) + '\nthis.__api = { companyCode, lanEmployeeLink, cloudEmployeeLink, chosenCompanyId, setChosenCompany, renderLinks, setList: (l, listed) => { _empCompanies = l; _empListed = listed; } };';
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, style: {}, dataset: {}, textContent: '', value: '' });
  const ctx = { document: { getElementById: (id) => el(id) }, currentState: {} };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { api: ctx.__api, els, el, ctx };
}
const CO1 = { id: '17249eed-1c2a-4b7e-9d0a-6f3b2c1d4e5f', name: '2023 مطور بعد الصيانة' };
const CO2 = { id: 'a91c03de-1c2a-4b7e-9d0a-6f3b2c1d4e5f', name: 'شركة الحمرا للأقمشة' };

test('one company: the office link and the cloud link carry the SHORT code (not the Arabic name), the selector stays hidden', () => {
  const { api, els } = loadLinks();
  const st = { localIp: '172.20.10.2', config: { port: 8080, subdomain: 'hama-demo' } };
  api.setList([CO1], true);
  api.renderLinks(st);
  assert.equal(els['lan-employee-url'].textContent, 'http://172.20.10.2:8080/login?c=17249eed');
  assert.equal(els['lan-employee-url'].dataset.url, 'http://172.20.10.2:8080/login?c=17249eed');
  assert.equal(els['employee-url'].textContent, 'https://hama-demo.texacore.ai/login?c=17249eed');
  assert.equal(els['lan-link-row'].style.display, 'block');
  assert.equal(els['cloud-employee-row'].style.display, 'block');
  assert.equal(els['link-company-row'].style.display, 'none');
  assert.equal(els['lan-no-company'].style.display, 'none');
  assert.doesNotMatch(els['lan-employee-url'].textContent + els['employee-url'].textContent, /[^\x00-\x7F]/);   // ASCII only: no URL-encoded Arabic
});

test('port 80 is left out of the office link; no cloud name → no cloud employee link; no LAN address → no office link', () => {
  const { api, els } = loadLinks();
  api.setList([CO1], true);
  api.renderLinks({ localIp: '192.168.1.20', config: { port: 80, subdomain: '' } });
  assert.equal(els['lan-employee-url'].textContent, 'http://192.168.1.20/login?c=17249eed');
  assert.equal(els['cloud-employee-row'].style.display, 'none');
  api.renderLinks({ localIp: '', config: { port: 80, subdomain: 'x' } });
  assert.equal(els['lan-link-row'].style.display, 'none');
  assert.equal(els['cloud-employee-row'].style.display, 'block');
});

test('several companies: the selector appears and ONE choice drives BOTH links and both company fields', () => {
  const { api, els } = loadLinks();
  const st = { localIp: '172.20.10.2', config: { port: 8080, subdomain: 'hama-demo' } };
  api.setList([CO1, CO2], true);
  api.renderLinks(st);
  assert.equal(els['link-company-row'].style.display, 'flex');
  assert.equal(els['lan-employee-url'].textContent, 'http://172.20.10.2:8080/login?c=17249eed');   // the newest company (first of the list) by default
  api.setChosenCompany(CO2.id);
  api.renderLinks(st);
  assert.equal(els['lan-employee-url'].textContent, 'http://172.20.10.2:8080/login?c=a91c03de');
  assert.equal(els['employee-url'].textContent, 'https://hama-demo.texacore.ai/login?c=a91c03de');   // the old code always used the FIRST company here
  assert.equal(els['link-company'].value, CO2.id);
  assert.equal(els['emp-company'].value, CO2.id);
  // a company that no longer exists falls back to the first
  api.setList([CO1], true);
  assert.equal(api.chosenCompanyId(), CO1.id);
});

test('no company yet: «create a company first» shows only once the list has really been read', () => {
  const { api, els } = loadLinks();
  const st = { localIp: '172.20.10.2', config: { port: 8080, subdomain: 'hama-demo' } };
  api.setList([], false);
  api.renderLinks(st);
  assert.equal(els['lan-no-company'].style.display, 'none');
  api.setList([], true);
  api.renderLinks(st);
  assert.equal(els['lan-no-company'].style.display, 'block');
  assert.equal(els['lan-link-row'].style.display, 'none');
  assert.equal(els['cloud-employee-row'].style.display, 'none');
});

test('Block 1 follows the real running state (shown while the system runs, hidden otherwise)', () => {
  const i = renderer.indexOf('function updateControlButtons');
  const body = renderer.slice(i, renderer.indexOf('\n}\n', i));
  assert.match(body, /access-box/);
  assert.match(body, /accessBox\.style\.display = 'block'/);
  assert.match(body, /accessBox\.style\.display = 'none'/);
});

test('the cloud address is one primary button (open) with its copy button; the admin-portal password comes last in Block 2', () => {
  assert.match(cloud, /id="btn-open-cloud"[^>]*onclick="openCloudUrl\(\); return false;"/);
  assert.ok(cloud.indexOf('id="cloud-url"') < cloud.indexOf('id="employee-url"'));
  assert.ok(cloud.indexOf('id="employee-url"') < cloud.indexOf('id="tunnel-status"'));
  assert.ok(cloud.indexOf('id="tunnel-status"') < cloud.indexOf('id="btn-toggle-admin-password"'));
});
