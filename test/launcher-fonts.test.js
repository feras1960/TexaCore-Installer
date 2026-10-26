'use strict';
// The launcher must not need the internet for its font: Cairo is bundled (src/fonts, OFL) and the page links no font host.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
const fontsCss = fs.readFileSync(path.join(SRC, 'fonts', 'fonts.css'), 'utf8');

test('no font is fetched from the network: no Google Fonts link in the page, no external url() in the styles', () => {
  assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com|rel="preconnect"/);
  assert.doesNotMatch(css + fontsCss, /url\(\s*['"]?https?:\/\//);          // (an SVG namespace inside a data: url is not a fetch)
  assert.match(html, /<link rel="stylesheet" href="fonts\/fonts\.css">/);
});

test('fonts.css names 4 weights x 3 subsets of Cairo and every file it names exists, is woff2 and is small', () => {
  const faces = [...fontsCss.matchAll(/@font-face \{[^}]*font-weight: (\d+);[^}]*url\('([^']+)'\) format\('woff2'\); unicode-range: ([^;]+);/g)];
  assert.equal(faces.length, 12);
  assert.deepEqual([...new Set(faces.map((f) => f[1]))].sort(), ['400', '500', '600', '700']);
  for (const [, , file] of faces) {
    const p = path.join(SRC, 'fonts', file);
    assert.ok(fs.existsSync(p), file);
    const b = fs.readFileSync(p);
    assert.equal(b.subarray(0, 4).toString('latin1'), 'wOF2', `${file} is not woff2`);
    assert.ok(b.length > 2000 && b.length < 60000, `${file}: ${b.length} bytes`);
  }
  assert.ok(faces.some((f) => /U\+0600-06FF/.test(f[3])), 'an Arabic subset');
  assert.match(css, /--font: 'Cairo', -apple-system/);          // with a system fallback
});

test('the OFL licence of the bundled font is acknowledged', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'THIRD_PARTY_NOTICES.md'), 'utf8'), /Cairo \(launcher font\)[\s\S]*SIL Open Font License, Version 1\.1/);
});

test('the files ship in the package (src/** is packaged) and the generator is documented', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('src/**/*'));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'scripts', 'localize-launcher-fonts.js')));
});
