// ════════════════════════════════════════════════════════════
// pdf-render.js — text PDFs made on this computer (2.0.8)
// ════════════════════════════════════════════════════════════
// The ERP page builds every printable document as one self-contained HTML document (the same one its preview shows).
// In the cloud a server-side Chromium would turn it into a PDF with real text; that service is not set up, and a desktop
// install has no cloud at all — so the page fell back to drawing the pages as pictures (html2canvas): large files whose
// text cannot be selected or searched.
//
// The desktop app already carries Chromium (Electron). POST /api/render-pdf hands the page's HTML to a hidden window of
// that Chromium and returns `webContents.printToPDF` — a PDF with real text, made offline, no service to run.
//
// The HTML is data, not a page to trust:
//   • it is loaded into its own in-memory session (no cookies, no storage, nothing shared with the launcher window);
//   • the window is sandboxed, has no preload and no Node; pop-ups, navigation, downloads and permissions are refused;
//   • a Content-Security-Policy is put first in <head>: no script, no frame, no form, no plugin — styles, fonts and
//     images only (what a printed document is made of);
//   • stylesheets and fonts come only from this computer's own UI server (resolved through a <base> the page names and
//     this module checks is loopback) or from the document itself; images may also come from this computer's other local
//     services and from https (a company logo kept in storage) — as the page's own preview loads them, with no cookies
//     here; nothing else is requested, and never file:// beyond the document's own temporary file.
// One document at a time (a queue), with a time limit; the temporary file and the window are always removed.
//
// The pure parts (request validation, HTML preparation, URL rule) take no Electron and are tested with node --test.

const path = require('path');
const crypto = require('crypto');

const MAX_HTML_BYTES = 12 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 60000;
const FONTS_TIMEOUT_MS = 8000;
const PAPER_SIZES = new Set(['A4', 'A5', 'Letter']);
const MM_PER_INCH = 25.4;

class PdfRenderError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

/** The page's origin, only when it is this computer (the UI server): the base its relative font / style URLs resolve against. */
function loopbackOrigin(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\/+$/, '');
  return LOOPBACK_ORIGIN.test(trimmed) ? trimmed : null;
}

/** The request the page sent, checked. Throws PdfRenderError('BAD_REQUEST' | 'BODY_TOO_LARGE'). */
function validatePdfRequest(body) {
  const html = body && typeof body.html === 'string' ? body.html : '';
  if (!html.trim()) throw new PdfRenderError('BAD_REQUEST', 'html is required');
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw new PdfRenderError('BODY_TOO_LARGE', 'the document is too large');
  const paper = body && body.paper && typeof body.paper === 'object' ? body.paper : {};
  const size = typeof paper.size === 'string' && PAPER_SIZES.has(paper.size) ? paper.size : 'A4';
  if (paper.size !== undefined && paper.size !== null && !PAPER_SIZES.has(paper.size)) {
    throw new PdfRenderError('BAD_REQUEST', 'paper.size must be A4, A5 or Letter');
  }
  let marginMm = 0;
  if (paper.marginMm !== undefined && paper.marginMm !== null) {
    marginMm = Number(paper.marginMm);
    if (!Number.isFinite(marginMm) || marginMm < 0 || marginMm > 50) throw new PdfRenderError('BAD_REQUEST', 'paper.marginMm must be between 0 and 50');
  }
  return {
    html,
    size,
    landscape: paper.landscape === true,
    marginIn: marginMm / MM_PER_INCH,
    waitForFonts: body.waitForFonts !== false,
    baseUrl: loopbackOrigin(body.baseUrl),
  };
}

const escapeAttr = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const LOOPBACK_URL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/|$)/i;

/** What the document may load. No script at all; styles and fonts from the named local origin; images also from local services and https. */
function contentSecurityPolicy(baseUrl) {
  const local = baseUrl ? ` ${baseUrl}` : '';
  return [
    "default-src 'none'",
    `style-src 'unsafe-inline'${local}`,
    `font-src data:${local}`,
    'img-src data: blob: https: http://localhost:* http://127.0.0.1:*',
    "script-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/**
 * The HTML as it is loaded: the policy first in <head> (before anything the document brings), then a <base> for the
 * document's relative URLs when the page named a loopback origin. The document's own <base> tags are removed (the policy
 * forbids them anyway) so nothing can point its URLs elsewhere.
 */
function preparePdfHtml(html, baseUrl) {
  // The ERP's print documents link Cairo / Tajawal / Inter from fonts.googleapis.com. A desktop install serves the same
  // fonts itself (/fonts/fonts.css — scripts/localize-fonts.js), so the link is pointed there: the PDF gets its real fonts
  // offline and the render window never leaves this computer. With no local origin named, the link is dropped (system fonts).
  const localFonts = baseUrl ? '<link rel="stylesheet" href="/fonts/fonts.css">' : '';
  let fontsLinked = false;
  const withLocalFonts = html.replace(/<link\b[^>]*\bhref\s*=\s*["']https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"']*["'][^>]*>/gi, () => {
    if (fontsLinked) return '';
    fontsLinked = true;
    return localFonts;
  });
  const withoutBase = withLocalFonts.replace(/<base\b[^>]*>/gi, '');
  // `base-uri 'none'` would refuse our own <base> too, so it is left out when we add one; ours is the only one left in the document
  const policy = baseUrl ? contentSecurityPolicy(baseUrl).replace("; base-uri 'none'", '') : contentSecurityPolicy(null);
  // the file is written as UTF-8: say so first, whatever the document declares later
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeAttr(policy)}">${baseUrl ? `<base href="${escapeAttr(baseUrl)}/">` : ''}`;
  if (/<head\b[^>]*>/i.test(withoutBase)) return withoutBase.replace(/<head\b[^>]*>/i, (tag) => `${tag}${head}`);
  if (/<html\b[^>]*>/i.test(withoutBase)) return withoutBase.replace(/<html\b[^>]*>/i, (tag) => `${tag}<head>${head}</head>`);
  return `<!DOCTYPE html><html><head>${head}</head><body>${withoutBase}</body></html>`;
}

/**
 * May the render window request this URL? (The network-level twin of the policy above.) Its own file, data: / blob:,
 * the named local origin for anything, and for images also this computer's other local services and https.
 */
function requestAllowed(url, { documentUrl, baseUrl }, resourceType) {
  if (typeof url !== 'string') return false;
  if (url === documentUrl) return true;
  if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return true;
  if (baseUrl && (url === baseUrl || url.startsWith(`${baseUrl}/`))) return true;
  if (resourceType === 'image') return LOOPBACK_URL.test(url) || /^https:\/\//i.test(url);
  return false;
}

function printToPdfOptions(request) {
  return {
    printBackground: true,
    // the document's own `@page` (size, margins) wins when it has one — the same rule the page's print path follows
    preferCSSPageSize: true,
    pageSize: request.size,
    landscape: request.landscape,
    margins: { marginType: 'custom', top: request.marginIn, bottom: request.marginIn, left: request.marginIn, right: request.marginIn },
  };
}

/**
 * The renderer. `deps`: { BrowserWindow, session, fs (promises), tmpDir, now? } — Electron's pieces, injected.
 * `render(body)` resolves a Buffer (the PDF) or rejects with a PdfRenderError.
 */
function createPdfRenderer(deps) {
  const { BrowserWindow, session, fs, tmpDir } = deps;
  let queue = Promise.resolve();
  let counter = 0;

  async function renderNow(request) {
    const id = `${Date.now().toString(36)}-${(counter += 1)}-${crypto.randomBytes(6).toString('hex')}`;
    const file = path.join(tmpDir, `texacore-pdf-${id}.html`);
    const documentUrl = require('url').pathToFileURL(file).toString();
    await fs.writeFile(file, preparePdfHtml(request.html, request.baseUrl), { encoding: 'utf8', mode: 0o600 });

    // its own in-memory session: no cookies, no cache on disk, nothing of the launcher's
    const renderSession = session.fromPartition(`pdf-render-${id}`, { cache: false });
    renderSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    renderSession.on('will-download', (event) => event.preventDefault());
    renderSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !requestAllowed(details.url, { documentUrl, baseUrl: request.baseUrl }, details.resourceType) });
    });

    const win = new BrowserWindow({
      show: false,
      width: 1024,
      height: 1448,
      webPreferences: {
        session: renderSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        // script-src 'none' keeps the document's own scripts from running; executeJavaScript below is ours
        javascript: true,
        backgroundThrottling: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());

    let timer;
    try {
      const work = (async () => {
        await win.loadURL(documentUrl);
        if (request.waitForFonts) {
          await Promise.race([
            win.webContents.executeJavaScript('document.fonts && document.fonts.ready ? document.fonts.ready.then(() => true) : true', true),
            new Promise((resolve) => setTimeout(resolve, FONTS_TIMEOUT_MS)),
          ]).catch(() => undefined);
        }
        return win.webContents.printToPDF(printToPdfOptions(request));
      })();
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new PdfRenderError('RENDER_TIMEOUT', 'the document took too long to render')), RENDER_TIMEOUT_MS);
      });
      const pdf = await Promise.race([work, timeout]);
      if (!Buffer.isBuffer(pdf) || pdf.length < 5 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new PdfRenderError('RENDER_FAILED', 'the renderer did not return a PDF');
      }
      return pdf;
    } catch (err) {
      if (err instanceof PdfRenderError) throw err;
      throw new PdfRenderError('RENDER_FAILED', err && err.message ? err.message : 'render failed');
    } finally {
      clearTimeout(timer);
      try { if (!win.isDestroyed()) win.destroy(); } catch { /* already gone */ }
      await fs.unlink(file).catch(() => undefined);
    }
  }

  return {
    /** One document at a time: a second request waits for the first (a hidden Chromium window each is memory enough). */
    render(body) {
      const request = validatePdfRequest(body);
      const run = queue.then(() => renderNow(request));
      queue = run.catch(() => undefined);
      return run;
    },
  };
}

/** HTTP status for a coded failure. */
function pdfErrorStatus(code) {
  return ({ BAD_REQUEST: 400, BAD_JSON: 400, BODY_TOO_LARGE: 413, RENDER_TIMEOUT: 504, RENDER_FAILED: 500 })[code] || 500;
}

module.exports = {
  MAX_HTML_BYTES,
  PdfRenderError,
  loopbackOrigin,
  validatePdfRequest,
  contentSecurityPolicy,
  preparePdfHtml,
  requestAllowed,
  printToPdfOptions,
  createPdfRenderer,
  pdfErrorStatus,
};
