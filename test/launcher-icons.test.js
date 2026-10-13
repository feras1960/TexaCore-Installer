'use strict';
// The launcher draws every icon as an inline SVG (src/icons.js). Emoji as icons rendered flat and uneven on Windows, so none may come back into anything the
// window shows: markup, strings, translations, styles, the tray menu. (Log / console lines in the main process keep theirs: they are not the interface.)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// Emoji and pictograph-style symbols; © ® ™ are ordinary typography and stay allowed.
const PICTO = /[\p{Extended_Pictographic}\p{Emoji_Presentation}️⃣✓-✘⭐]/gu;
const found = (text) => [...text.matchAll(PICTO)].map((m) => m[0]).filter((c) => !['©', '®', '™'].includes(c));

test('no emoji in the launcher window sources (markup, script, styles, preload, icon set)', () => {
  for (const f of ['src/index.html', 'src/renderer.js', 'src/styles.css', 'src/preload.js', 'src/icons.js']) {
    assert.deepEqual(found(read(f)), [], `${f} still has emoji`);
  }
});

test('no emoji in any translated string (all four languages)', () => {
  const ctx = { window: {}, document: {} };
  vm.createContext(ctx);
  vm.runInContext(read('src/i18n.js') + '\n;this.__I18N = I18N;', ctx);
  const I18N = ctx.__I18N;
  assert.deepEqual(Object.keys(I18N).sort(), ['ar', 'en', 'ru', 'uk']);
  for (const [lang, dict] of Object.entries(I18N)) {
    for (const [k, v] of Object.entries(dict)) assert.deepEqual(found(String(v)), [], `${lang} ${k}: ${v}`);
  }
  assert.deepEqual(found(read('src/i18n.js')), [], 'i18n.js has emoji outside the strings');
});

test('the tray menu labels are plain text', () => {
  const main = read('src/main.js');
  const a = main.indexOf('function createTray()');
  const b = main.indexOf('tray.on(', a);
  assert.ok(a > 0 && b > a);
  assert.deepEqual(found(main.slice(a, b)), []);
});

test('the tray title row is a disabled status line: version + running / stopped (Arabic like the rest of the menu)', () => {
  const main = read('src/main.js');
  const a = main.indexOf('function createTray()');
  const block = main.slice(a, main.indexOf('tray.on(', a));
  const m = /label: `TexaCore ERP \$\{app\.getVersion\(\)\} — \$\{running \? 'يعمل' : 'متوقف'\}`,\s*enabled: false,/.exec(block);
  assert.ok(m, 'the first tray item must show the version and the running state and stay disabled');
  assert.ok(/const running = svcManager \? svcManager\.isRunning\(\) : false;/.test(block), 'the running flag comes from the service manager');
});

test('every icon the markup, script and styles ask for exists in the set, and nothing in the set is dead weight', () => {
  const icons = read('src/icons.js');
  const body = icons.slice(icons.indexOf('const ICONS = {'), icons.indexOf('\n};', icons.indexOf('const ICONS = {')));
  const names = [...body.matchAll(/^  '([a-z0-9-]+)':\s*'(.*)',?$/gm)];
  assert.ok(names.length >= 20, `icon set: ${names.length}`);
  const have = new Set(names.map((m) => m[1]));

  const html = read('src/index.html'), js = read('src/renderer.js'), css = read('src/styles.css');
  const requested = new Set();
  for (const m of html.matchAll(/#i-([a-z0-9-]+)/g)) requested.add(m[1]);
  for (const m of js.matchAll(/\b(?:icon|iconEl)\('([a-z0-9-]+)'/g)) requested.add(m[1]);
  for (const m of js.matchAll(/\b(?:setWithIcon|setIconOnly)\([^,]+,\s*'([a-z0-9-]+)'/g)) requested.add(m[1]);
  for (const m of css.matchAll(/--ico-([a-z0-9-]+)/g)) requested.add(m[1]);
  const missing = [...requested].filter((u) => !have.has(u));
  assert.deepEqual(missing, [], 'icons used but not defined');
  // names chosen by a conditional (`cond ? 'lock' : 'info'`, `ico = 'circle-x'`) are not caught by the call patterns: count any quoted name that is in the set
  const used = new Set(requested);
  for (const m of js.matchAll(/'([a-z0-9]+(?:-[a-z0-9]+)*)'/g)) if (have.has(m[1])) used.add(m[1]);
  const dead = [...have].filter((n) => !used.has(n));
  assert.deepEqual(dead, [], 'icons defined but never used');
});

test('icon bodies are plain SVG shapes: no scripts, no handlers, no external references, only known elements', () => {
  const icons = read('src/icons.js');
  const body = icons.slice(icons.indexOf('const ICONS = {'), icons.indexOf('\n};', icons.indexOf('const ICONS = {')));
  for (const m of body.matchAll(/^  '([a-z0-9-]+)':\s*'(.*)',?$/gm)) {
    const [, name, svg] = m;
    assert.ok(!/<script|\son\w+=|href=|xlink|javascript:|<use|<image|<foreignObject/i.test(svg), name);
    const tags = [...svg.matchAll(/<([a-zA-Z]+)\b/g)].map((t) => t[1]);
    assert.ok(tags.length > 0, name);
    for (const t of tags) assert.ok(['path', 'circle', 'rect', 'ellipse', 'line', 'polyline', 'polygon'].includes(t), `${name}: <${t}>`);
    assert.equal((svg.match(/</g) || []).length, (svg.match(/\/>/g) || []).length, `${name}: every element self-closes`);
  }
});

test('icons.js builds the sprite and the helpers in a bare DOM (no network, no modules)', () => {
  const made = [];
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, content: { firstChild: {} } });
  const vars = {};
  const doc = {
    body: { insertBefore: (n) => made.push(n), firstChild: null },
    documentElement: { style: { setProperty: (k, v) => { vars[k] = v; } } },
    getElementById: () => null, createElement: el, addEventListener() {}, createTextNode: (t) => ({ t }),
  };
  const ctx = { window: {}, document: doc };
  vm.createContext(ctx);
  vm.runInContext(read('src/icons.js') + '\n;this.__X = { icon, ICONS };', ctx);
  const { icon, ICONS } = ctx.__X;
  assert.match(icon('key', 20), /<svg class="icon icon-20"[^>]*><use href="#i-key"><\/use><\/svg>/);
  assert.equal(icon('no-such-icon'), '', 'an unknown name draws nothing rather than a broken box');
  assert.equal(made.length, 1, 'the sprite is mounted once');
  assert.match(made[0].innerHTML, /<symbol id="i-key"/);
  assert.equal(Object.keys(vars).length, Object.keys(ICONS).length, 'one --ico-* variable per icon');
  assert.match(vars['--ico-key'], /^url\("data:image\/svg\+xml,/);
});
