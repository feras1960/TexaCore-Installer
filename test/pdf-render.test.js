'use strict';
// POST /api/render-pdf (2.0.8): the page's print document as a text PDF, made by the app's own Chromium (src/pdf-render.js).
// The pure parts are tested here; the Electron run itself was done by hand on 2026-11-16 (a real 10-page statement: 10 pages,
// real text with the app's own Cairo fonts, 281 KB, 0.4 s; the test document's <script>, <iframe> and file:// image did nothing).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../src/pdf-render');

const DOC = '<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Cairo" rel="stylesheet"><style>p{color:red}</style></head><body><p>كشف حساب</p></body></html>';

test('the request is checked: html required, paper A4 / A5 / Letter, margin 0–50 mm, a loopback base only', () => {
  const ok = P.validatePdfRequest({ html: DOC, paper: { size: 'A5', landscape: true, marginMm: 12.7 }, baseUrl: 'http://localhost:3000/' });
  assert.equal(ok.size, 'A5');
  assert.equal(ok.landscape, true);
  assert.equal(ok.marginIn, 0.5);
  assert.equal(ok.baseUrl, 'http://localhost:3000');
  assert.equal(ok.waitForFonts, true);
  const plain = P.validatePdfRequest({ html: DOC });
  assert.deepEqual([plain.size, plain.landscape, plain.marginIn, plain.baseUrl], ['A4', false, 0, null]);
  for (const bad of [{}, { html: '   ' }, { html: DOC, paper: { size: 'A3' } }, { html: DOC, paper: { marginMm: -1 } }, { html: DOC, paper: { marginMm: 99 } }, { html: DOC, paper: { marginMm: 'x' } }]) {
    assert.throws(() => P.validatePdfRequest(bad), (e) => e instanceof P.PdfRenderError && e.code === 'BAD_REQUEST', JSON.stringify(bad).slice(0, 60));
  }
  assert.throws(() => P.validatePdfRequest({ html: 'x'.repeat(P.MAX_HTML_BYTES + 1) }), (e) => e.code === 'BODY_TOO_LARGE');
});

test('only this computer may be named as the base of the document\'s relative URLs', () => {
  for (const good of ['http://localhost:3000', 'http://127.0.0.1:54321/', 'https://localhost', 'http://[::1]:8080']) assert.ok(P.loopbackOrigin(good), good);
  for (const bad of ['https://evil.example', 'http://localhost.evil.example', 'http://192.168.1.5:3000', 'http://localhost:3000/path', 'file:///etc', 'javascript:alert(1)', '', null, 42]) {
    assert.equal(P.loopbackOrigin(bad), null, String(bad));
  }
  assert.equal(P.validatePdfRequest({ html: DOC, baseUrl: 'https://evil.example' }).baseUrl, null);
});

test('the document is loaded with a no-script policy first in <head>, our own <base>, and the app\'s local fonts', () => {
  const html = P.preparePdfHtml(DOC.replace('<head>', '<head><base href="https://evil.example/">'), 'http://localhost:3000');
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  assert.ok(head.startsWith('<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"'), 'the policy comes before anything the document brings');
  assert.match(html, /script-src 'none'/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /frame-src 'none'/);
  assert.equal((html.match(/<base\b/g) || []).length, 1);
  assert.match(html, /<base href="http:\/\/localhost:3000\/">/);
  assert.doesNotMatch(html, /evil\.example/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
  assert.match(html, /<link rel="stylesheet" href="\/fonts\/fonts\.css">/);
  assert.match(html, /style-src 'unsafe-inline' http:\/\/localhost:3000;/);
});

test('with no local origin: no <base>, no font link, base-uri refused; a bare fragment is wrapped', () => {
  const html = P.preparePdfHtml(DOC, null);
  assert.doesNotMatch(html, /<base\b/);
  assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com|\/fonts\/fonts\.css/);
  assert.match(html, /base-uri 'none'/);
  const wrapped = P.preparePdfHtml('<p>x</p>', null);
  assert.ok(wrapped.startsWith('<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy"'));
  assert.ok(wrapped.endsWith('<body><p>x</p></body></html>'));
});

test('the render window may request its own file, data:, the named local origin — and images from local services or https; nothing else', () => {
  const ctx = { documentUrl: 'file:///tmp/texacore-pdf-1.html', baseUrl: 'http://localhost:3000' };
  const allowed = (url, type) => P.requestAllowed(url, ctx, type);
  assert.equal(allowed('file:///tmp/texacore-pdf-1.html', 'mainFrame'), true);
  assert.equal(allowed('data:font/woff2;base64,AAAA', 'font'), true);
  assert.equal(allowed('http://localhost:3000/fonts/fonts.css', 'stylesheet'), true);
  assert.equal(allowed('http://localhost:3000/fonts/cairo.woff2', 'font'), true);
  assert.equal(allowed('http://127.0.0.1:54321/storage/v1/object/public/logo.png', 'image'), true);
  assert.equal(allowed('https://cdn.example/logo.png', 'image'), true);
  // refused
  assert.equal(allowed('file:///etc/hosts', 'image'), false);
  assert.equal(allowed('file:///tmp/other.html', 'subFrame'), false);
  assert.equal(allowed('https://fonts.googleapis.com/css2?family=Cairo', 'stylesheet'), false);
  assert.equal(allowed('https://evil.example/x.js', 'script'), false);
  assert.equal(allowed('http://127.0.0.1:54321/rest/v1/companies', 'xhr'), false);
  assert.equal(allowed('http://192.168.1.9/pixel.png', 'image'), false);
  assert.equal(allowed('http://localhost:3000.evil.example/x.css', 'stylesheet'), false);
  assert.equal(P.requestAllowed('http://localhost:3000/fonts/fonts.css', { documentUrl: ctx.documentUrl, baseUrl: null }, 'stylesheet'), false);
});

test('printToPDF: backgrounds on, the document\'s own @page wins, margins in inches', () => {
  const o = P.printToPdfOptions(P.validatePdfRequest({ html: DOC, paper: { size: 'Letter', landscape: true, marginMm: 25.4 } }));
  assert.deepEqual(o, { printBackground: true, preferCSSPageSize: true, pageSize: 'Letter', landscape: true, margins: { marginType: 'custom', top: 1, bottom: 1, left: 1, right: 1 } });
});

test('one document at a time, the window and the temporary file always removed, a non-PDF answer refused', async () => {
  const written = new Map(); const unlinked = []; let open = 0; let maxOpen = 0; const partitions = [];
  const fakeFs = { writeFile: async (file, data, opts) => { written.set(file, { data, opts }); }, unlink: async (file) => { unlinked.push(file); } };
  const fakeSession = { fromPartition: (name) => { partitions.push(name); return { setPermissionRequestHandler() {}, on() {}, webRequest: { onBeforeRequest() {} } }; } };
  let answer = () => Buffer.from('%PDF-1.7 ...');
  class FakeWindow {
    constructor(opts) {
      this.opts = opts; this.destroyed = false; open += 1; maxOpen = Math.max(maxOpen, open);
      this.webContents = {
        setWindowOpenHandler() {}, on() {},
        executeJavaScript: async () => true,
        printToPDF: async () => { await new Promise((r) => setTimeout(r, 15)); return answer(); },
      };
    }
    async loadURL(url) { this.url = url; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; open -= 1; }
  }
  const renderer = P.createPdfRenderer({ BrowserWindow: FakeWindow, session: fakeSession, fs: fakeFs, tmpDir: '/tmp' });
  const [a, b] = await Promise.all([renderer.render({ html: DOC }), renderer.render({ html: DOC, baseUrl: 'http://localhost:3000' })]);
  assert.ok(Buffer.isBuffer(a) && Buffer.isBuffer(b));
  assert.equal(maxOpen, 1, 'never two render windows at once');
  assert.equal(open, 0);
  assert.equal(written.size, 2);
  assert.deepEqual([...written.keys()].sort(), [...unlinked].sort(), 'every temporary file is removed');
  for (const { opts } of written.values()) assert.equal(opts.mode, 0o600);
  assert.equal(new Set(partitions).size, 2, 'each document gets its own in-memory session');
  assert.ok(partitions.every((name) => !name.startsWith('persist:')));
  // a failure still cleans up, and does not block the next document
  answer = () => Buffer.from('<html>not a pdf</html>');
  await assert.rejects(renderer.render({ html: DOC }), (e) => e.code === 'RENDER_FAILED');
  assert.equal(open, 0);
  assert.equal(written.size, unlinked.length);
  answer = () => Buffer.from('%PDF-1.7 again');
  assert.ok(await renderer.render({ html: DOC }));
  // a bad request is refused before anything is created
  assert.throws(() => renderer.render({ html: '' }), (e) => e.code === 'BAD_REQUEST');
});

test('the render window is sandboxed with no preload and no Node (source contract)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/pdf-render.js'), 'utf8');
  assert.match(src, /sandbox: true,/);
  assert.match(src, /contextIsolation: true,/);
  assert.match(src, /nodeIntegration: false,/);
  assert.doesNotMatch(src, /preload:/);
  assert.match(src, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(src, /on\('will-navigate', \(event\) => event\.preventDefault\(\)\)/);
  assert.match(src, /setPermissionRequestHandler\(\(_wc, _permission, callback\) => callback\(false\)\)/);
});

test('the route is local-only like the rest of the admin API and answers a PDF (source contract)', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.match(main, /'\/api\/render-pdf',\s*\/\/ 2\.0\.8/, 'listed with the same-machine-origin endpoints');
  assert.match(main, /req\.method === 'POST' && \(req\.url \|\| ''\)\.split\('\?'\)\[0\] === '\/api\/render-pdf'/);
  assert.match(main, /readJsonBody\(req, pdfRender\.MAX_HTML_BYTES \+ 64 \* 1024\)/);
  assert.match(main, /'Content-Type': 'application\/pdf'/);
  // registered after the local-only, same-origin and install-secret checks
  const guard = main.indexOf('if (!adminApiAuthorized(req)) {');
  const route = main.indexOf("=== '/api/render-pdf'");
  assert.ok(guard > 0 && route > guard, 'the route sits behind the admin API guards');
  assert.deepEqual([P.pdfErrorStatus('BAD_REQUEST'), P.pdfErrorStatus('BODY_TOO_LARGE'), P.pdfErrorStatus('RENDER_TIMEOUT'), P.pdfErrorStatus('RENDER_FAILED'), P.pdfErrorStatus('whatever')], [400, 413, 504, 500, 500]);
});
