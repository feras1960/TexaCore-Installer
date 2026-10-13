'use strict';
// The web bundle's service worker precaches /config.js (the installer's per-install runtime config) under a revision that never changes — the FIRST copy it ever
// stored stays for good, also across app upgrades. The installer serves the worker without that entry, and gives the shell a versioned config script URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ServiceManager = require('../src/service-manager');

const strip = ServiceManager.stripConfigFromServiceWorker;

test('the config.js precache entry is removed in every position and spelling workbox emits; nothing else is touched', () => {
  const mid = 'precacheAndRoute([{url:"icon.svg",revision:"8e4c"},{url:"config.js",revision:"59c4552f"},{url:"assets/a.js",revision:null}]);';
  assert.equal(strip(mid), 'precacheAndRoute([{url:"icon.svg",revision:"8e4c"},{url:"assets/a.js",revision:null}]);');
  assert.equal(strip('[{url:"config.js",revision:"x"}]'), '[]');
  assert.equal(strip('[{url:"a.js",revision:null},{url:"config.js",revision:"x"}]'), '[{url:"a.js",revision:null}]');
  assert.equal(strip("[{ url : 'config.js' , revision : null }, {url:\"b.js\",revision:null}]").replace(/\s+/g, ''), '[{url:"b.js",revision:null}]');
  // a file merely CALLED like it, or another entry, stays
  const keep = '[{url:"workbox-config.js",revision:"a"},{url:"assets/config.js",revision:"b"},{url:"config.json",revision:"c"}]';
  assert.equal(strip(keep), keep);
  assert.equal(strip('nothing to do'), 'nothing to do');
});

test('the real service worker of the synced web bundle (when present) loses exactly its config.js entry', (t) => {
  const f = path.join(__dirname, '..', 'frontend', 'sw.js');
  if (!fs.existsSync(f)) return t.skip('no synced frontend/sw.js');
  const text = fs.readFileSync(f, 'utf8');
  const out = strip(text);
  if (!/url:"config\.js"/.test(text)) return;                       // a bundle built after the ERP's own globIgnores: nothing to strip
  assert.ok(!/url:"config\.js"/.test(out));
  assert.equal(text.length - out.length, text.match(/\{url:"config\.js",revision:(?:"[^"]*"|null)\},?/)[0].length);
});

test('_logOnce: one line per distinct reason within the window, a different reason is logged, and the window re-opens', () => {
  const lines = [];
  const sm = Object.create(ServiceManager.prototype);
  sm.logger = (l) => lines.push(l);
  const real = console.log; console.log = () => {};
  try {
    sm._logOnce('a', 'first', 1000); sm._logOnce('a', 'again', 1000); sm._logOnce('b', 'other', 1000);
    assert.deepEqual(lines, ['first', 'other']);
    sm._onceLog.set('a', Date.now() - 2000);
    sm._logOnce('a', 'after the window', 1000);
    assert.deepEqual(lines, ['first', 'other', 'after the window']);
  } finally { console.log = real; }
});
