'use strict';
// Real-browser step for the launcher's «فتح ملف شركة» (2.0.3): the page uses the BROWSER's own file chooser. Headless Chrome (Playwright from the ERP checkout) puts
// a file into the launcher's <input type=file> exactly as the chooser would (setInputFiles), the page hashes it and asks the desktop app where it is
// (POST /api/locate-picked-file), then opens it in place / places the company file beside it / falls back. Prints ONE line: OPENFILE <json>.
//   node scripts/e2e/browser-open-file.cjs --erp <ERP> --ui http://localhost:47395 --file <path> [--phrase <passphrase>] [--shots <dir>] [--tag <name>]
// Result: { located: <the POST /api/locate-picked-file answer the PAGE received, without anything but success/type/code/reason/ref-present>, locateRequest: {name,size,hasSha}, locateStatus,
//           statusTexts: [text shown while locating], note: { testId, text } | null, prompt: bool, alerts: [...], restoreRoute: [{url,status}], texts }
const fs = require('fs');
const path = require('path');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const ERP = arg('erp'); const UI = arg('ui'); const FILE = arg('file'); const PHRASE = arg('phrase', ''); const SHOTS = arg('shots', ''); const TAG = arg('tag', 'open');
const DELAY_LOCATE = Number(arg('delay-locate', '0')) || 0;   // hold the app's answer back so the page's «locating…» line stays on screen long enough to be seen
const { chromium } = require(path.join(ERP, 'node_modules', 'playwright'));

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const out = { locateRequest: null, located: null, locateStatus: null, statusTexts: [], note: null, prompt: false, alerts: [], routes: [], rsfLine: null };
    page.on('dialog', async (d) => { out.alerts.push(d.message().slice(0, 300)); await d.dismiss().catch(() => {}); });
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/api\/locate-picked-file$/.test(r.url())) {
        let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch { /* not json */ }
        out.locateRequest = { keys: Object.keys(b).sort(), name: b.name, size: b.size, shaOk: /^[0-9a-f]{64}$/.test(String(b.sha256 || '')), lastModifiedIsNumber: typeof b.lastModified === 'number' };
      }
    });
    page.on('response', async (r) => {
      const m = /\/api\/(locate-picked-file|open-picked-tcdb|restore-tcdb|create-local-company|pick-company-file)$/.exec(r.url());
      if (!m || r.request().method() !== 'POST') return;
      let body = null; try { body = await r.json(); } catch { /* not json */ }
      out.routes.push({ route: m[1], status: r.status() });
      if (m[1] === 'locate-picked-file') {
        out.locateStatus = r.status();
        out.located = body ? { success: body.success === true, type: body.type, code: body.code, reason: body.reason, hasRef: !!body.ref, filePath: body.filePath, dir: body.dir, companyFilePath: body.companyFilePath } : null;
      }
    });
    if (DELAY_LOCATE) await page.route('**/api/locate-picked-file', async (route) => { await new Promise((r) => setTimeout(r, DELAY_LOCATE)); await route.continue(); });
    await page.goto(`${UI}/login`, { waitUntil: 'networkidle', timeout: 120000 });
    // the status line under the tile while the app searches
    const sampler = setInterval(async () => {
      try { const t = await page.locator('[data-testid="company-file-notice"]').first().innerText({ timeout: 300 }); if (t && !out.statusTexts.includes(t)) out.statusTexts.push(t); } catch { /* not there */ }
    }, 120);
    await page.locator('#company-file-upload').setInputFiles(FILE);

    const isTcdb = /\.tcdb$/i.test(FILE);
    const noteSel = isTcdb ? '[data-testid="live-company-file-note"]' : '[data-testid="rsf-company-file-target"], [data-testid="rsf-company-file-fallback"]';
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {   // (a restore of a 6 MB company file takes 25-60 s, longer on a busy machine)
      if (await page.locator('[data-testid="tcdb-passphrase-prompt"]').count()) {
        out.prompt = true;
        if (!PHRASE) break;
        await page.locator('#tcdb-open-passphrase').fill(PHRASE);
        await page.locator('[data-testid="tcdb-passphrase-prompt"] button').last().click();
        await page.waitForTimeout(800);
        continue;
      }
      if (await page.locator(noteSel).count()) break;
      if (out.alerts.length) break;
      await page.waitForTimeout(400);
    }
    clearInterval(sampler);
    await page.waitForTimeout(500);
    const noteEl = page.locator(noteSel).first();
    if (await noteEl.count()) {
      out.note = { testId: await noteEl.getAttribute('data-testid'), text: (await noteEl.innerText()).replace(/\s+/g, ' ').trim() };
    }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG}.png`) }).catch(() => {});
    console.log('OPENFILE ' + JSON.stringify(out));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
