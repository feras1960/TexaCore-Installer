// 2.0.3: the native open/save panel must open IN FRONT of the browser that asked for it (owner's report 2026-10-15: in 2.0.2 the
// «فتح ملف شركة» panel opened behind Chrome, attached to a hidden window, and the page sat at «جار فتح الملف…»).
// The real window order can only be seen on a desktop (scripts/dialog-front-check.js); this pins the code that produces it.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const start = src.indexOf('async function showNativeDialog(');
const body = src.slice(start, src.indexOf('\n}\n', start) + 2);

test('every native file dialog goes through showNativeDialog', () => {
  assert.ok(start > 0, 'showNativeDialog exists');
  const direct = src.split('\n').filter((l) => /\.(showOpenDialog|showSaveDialog)\(/.test(l) && !body.includes(l));
  assert.deepStrictEqual(direct, [], 'no dialog call outside the helper');
});

test('the panel hangs from a visible always-on-top host on the current Space, never from a hidden window', () => {
  assert.match(body, /setAlwaysOnTop\(true, 'screen-saver'\)/);
  assert.match(body, /setVisibleOnAllWorkspaces\(true, \{ visibleOnFullScreen: true \}\)/);
  assert.match(body, /host\.showInactive\(\)/);
  assert.match(body, /show(Open|Save)Dialog\(host, options\)/);
  assert.doesNotMatch(body, /width: 0, height: 0, show: false/, 'the 2.0.2 hidden 0x0 parent is gone');
});

test('macOS: the app activates before the panel and hands the screen back when it had no window open', () => {
  assert.match(body, /app\.focus\(\{ steal: true \}\)/);
  assert.ok(body.indexOf('app.focus({ steal: true })') < body.indexOf('Dialog(host, options)'), 'activate first');
  assert.match(body, /if \(isMac && !appWindowOpen\) \{ try \{ app\.hide\(\); \}/);
  assert.match(body, /finally \{\s*try \{ host\.destroy\(\); \}/);
});

test('a headless harness run still never opens a real window', () => {
  assert.ok(body.indexOf("process.env.TEXACORE_HEADLESS === '1'") < body.indexOf('new BW('), 'the harness answer comes before any window');
});
