'use strict';
// 2.0.4: the job routes + the folder-permission routes in main.js (not loadable without Electron: the wiring is checked in the source).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const set = main.slice(main.indexOf('const DESTRUCTIVE_API = new Set(['), main.indexOf(']);', main.indexOf('const DESTRUCTIVE_API')));
const from = main.indexOf('// ═══ 2.0.4: the search for the picked file as a JOB');
const to = main.indexOf("// ── POST /api/open-picked-tcdb");
const routes = main.slice(from, to);

test('every 2.0.4 route is a same-machine, secret-guarded admin route', () => {
  for (const p of ['locate-start', 'locate-status', 'locate-materialize', 'locate-cancel', 'locate-confirm', 'folder-access', 'open-privacy-settings', 'e2e-folder-access']) {
    assert.match(set, new RegExp(`'/api/${p}'`), p);
    assert.match(routes, new RegExp(`case '(GET|POST) /api/${p}'`), p);
  }
});

test('locate-start validates the body (a hash is NOT required: the page has not read the file yet) before it looks at the disk', () => {
  const start = routes.slice(routes.indexOf("case 'POST /api/locate-start'"), routes.indexOf("case 'GET /api/locate-status'"));
  assert.match(start, /validateLocateBody\(await readJsonBody\(req\), \{ requireHash: false \}\)/);
  assert.ok(start.indexOf('validateLocateBody') < start.indexOf('locateJobs.start'));
});

test('locate-confirm registers a pick ONLY after a hash-verified match, and answers 200 NOT_FOUND (with the reason) otherwise - no path in that answer', () => {
  const c = routes.slice(routes.indexOf("case 'POST /api/locate-confirm'"), routes.indexOf('// ── GET /api/folder-access'));
  assert.match(c, /locateJobs\.confirm\(/);
  const notFound = c.indexOf("if (!r.found) { sendJson(res, 200, { success: false, code: 'NOT_FOUND', reason: r.reason }); return true; }");
  assert.ok(notFound > 0);
  assert.ok(c.indexOf('registerPickedFile(r.filePath, ext)') > notFound);
  const logs = c.split('\n').filter((l) => /fileLog\(/.test(l));
  assert.equal(logs.length, 2);
  for (const m of logs[0].matchAll(/\$\{([^}]*)\}/g)) assert.match(m[1], /^r\.stats\.\w+$/, 'the count line holds numbers only');
});

test('the status route cannot reveal a path: nothing but locateJobs.status() is sent', () => {
  const st = routes.slice(routes.indexOf("case 'GET /api/locate-status'"), routes.indexOf("case 'POST /api/locate-materialize'"));
  assert.match(st, /sendJson\(res, 200, locateJobs\.status\(urlObj\.searchParams\.get\('job'\)\)\)/);
});

test('the permission step: the SETTINGS pane is opened by the app (a web page cannot open an x-apple.systempreferences link); a headless test run only records it', () => {
  const r = routes.slice(routes.indexOf("case 'POST /api/open-privacy-settings'"), routes.indexOf('// ── (harness only)'));
  assert.match(r, /shell\.openExternal\(url\)/);
  assert.match(r, /folderAccessMod\.settingsUrls\(\)/);
  assert.match(r, /HARNESS_OK && process\.env\.TEXACORE_HEADLESS === '1'/);
});

test('the harness route exists only for an isolated run; the pretend verdicts/areas/placeholders are ignored otherwise', () => {
  assert.match(routes, /case 'POST \/api\/e2e-folder-access': \{\s*if \(!HARNESS_OK\) return false;/);
  assert.match(main, /simulate: \(kind\) => \(HARNESS_OK \?/);
  assert.match(main, /const e2eKindOf = \(p\) => \{\s*if \(!HARNESS_OK\) return null;/);
  assert.match(main, /HARNESS_OK && E2E_FS\.placeholders\.has\(/);
});

test('a missing permission is a coded 403 the page can act on (area + state), not a generic error', () => {
  assert.match(main, /FOLDER_PERMISSION: 403/);
  assert.match(main, /code === 'FOLDER_PERMISSION' \? \{ area: err\.area \|\| null, state: err\.state \|\| 'denied' \}/);
});

test('the 2.0.3 route no longer waits on a protected folder: a root whose permission is not "allowed" is left out of its walk', () => {
  const old = main.slice(main.indexOf("case 'POST /api/locate-picked-file'"), from);
  assert.match(old, /folderAccess\.ensureUsable\(r0, \{ waitMs: 1500 \}\)/);
  assert.match(old, /if \(v\.state === 'allowed'\) roots\.push\(r0\)/);
});
