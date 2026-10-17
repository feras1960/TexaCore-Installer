'use strict';
// Real-browser step for the launcher's «فتح ملف شركة»: the page uses the BROWSER's own file chooser. Headless Chrome (Playwright from the ERP checkout) puts a file
// into the launcher's <input type=file> exactly as the chooser would (setInputFiles). 2.0.4 protocol: the page tells the desktop app only the file's name, size and
// modification time (POST /api/locate-start), follows the job (GET /api/locate-status), asks for the download of an iCloud placeholder (POST /api/locate-materialize),
// hashes the file ONLY once the app says it is local and proves it (POST /api/locate-confirm {job, sha256}); then it opens the file in place / places the company
// file beside it / falls back, or shows the macOS permission step. Prints ONE line: OPENFILE <json>.
//   node scripts/e2e/browser-open-file.cjs --erp <ERP> --ui http://localhost:47395 --file <path> [--phrase <passphrase>] [--shots <dir>] [--tag <name>]
//        [--delay-status <ms>]            hold every locate-status answer back (the page's «locating…» line stays on screen)
//        [--perm-script '<json>']          what to do each time the permission step is on screen, in order: {click:'perm-open-settings'|'perm-retry'|'perm-skip'|'perm-program'}
//                                          | {sim:{desktop:{state:'allowed'}}} (POST /api/e2e-folder-access from the page, with its own secret) | {wait:ms}
//        [--click-skip-when-waiting]       press «تابع بدون تحديد مكان الملف» as soon as the page waits for macOS' prompt
//        [--click-cancel-at <percent>]     press «إلغاء» when the download bar reaches that percent
//        [--wait-currency]                 (.rsf) after the form appears, wait for «جارٍ قراءة عملة الملف…» to END and report the selected currency / country
// Result: { start:{keys,name,size,lastModifiedIsNumber,hasSha}|null, confirm:{keys,shaOk}|null, located:<the locate-confirm answer: success/type/code/reason/ref-present/filePath/dir/companyFilePath>|null,
//           phases:[...], candidateStates:[...], progress:[percent...], statusTexts:[...], note:{testId,text}|null, finalNotice, prompt, permission:{seen,mode,title,body,still,actions:[...]},
//           alerts:[...], routes:[{route,status}], cancelClicked, skipClicked, order:[request order] }
const fs = require('fs');
const path = require('path');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(`--${n}`);
const ERP = arg('erp'); const UI = arg('ui'); const FILE = arg('file'); const PHRASE = arg('phrase', ''); const SHOTS = arg('shots', ''); const TAG = arg('tag', 'open');
const DELAY_STATUS = Number(arg('delay-status', '0')) || 0;   // hold the app's status answers back so the page's «locating…» line stays on screen long enough to be seen
const PERM_SCRIPT = (() => { try { return JSON.parse(arg('perm-script', '[]')); } catch { return []; } })();
const CLICK_SKIP = has('click-skip-when-waiting');
const CANCEL_AT = arg('click-cancel-at', '') === '' ? null : Number(arg('click-cancel-at'));
const WAIT_CURRENCY = has('wait-currency');
const { chromium } = require(path.join(ERP, 'node_modules', 'playwright'));

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const out = {
      start: null, confirm: null, located: null, phases: [], candidateStates: [], progress: [], statusTexts: [], note: null, finalNotice: null, prompt: false,
      permission: { seen: false, mode: null, title: null, body: null, still: null, actions: [] }, alerts: [], routes: [], cancelClicked: false, skipClicked: false, order: [],
    };
    page.on('dialog', async (d) => { out.alerts.push(d.message().slice(0, 300)); await d.dismiss().catch(() => {}); });
    page.on('request', (r) => {
      if (r.method() !== 'POST') return;
      const m = /\/api\/(locate-start|locate-confirm|locate-materialize|locate-cancel|open-privacy-settings|create-local-company)$/.exec(r.url());
      if (!m) return;
      let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch { /* not json */ }
      out.order.push(m[1]);
      if (m[1] === 'locate-start') out.start = { keys: Object.keys(b).sort(), name: b.name, size: b.size, lastModifiedIsNumber: typeof b.lastModified === 'number', hasSha: 'sha256' in b };
      if (m[1] === 'locate-confirm') out.confirm = { keys: Object.keys(b).sort(), shaOk: /^[0-9a-f]{64}$/.test(String(b.sha256 || '')) };
    });
    page.on('response', async (r) => {
      const m = /\/api\/(locate-start|locate-status|locate-confirm|locate-materialize|locate-cancel|open-picked-tcdb|restore-tcdb|create-local-company|pick-company-file|open-privacy-settings|picked-file)(\?.*)?$/.exec(r.url());
      if (!m) return;
      const method = r.request().method();
      if (m[1] === 'picked-file') { out.routes.push({ route: 'picked-file', status: r.status() }); return; }
      let body = null; try { body = await r.json(); } catch { /* not json */ }
      if (m[1] === 'locate-status' || m[1] === 'locate-start' || m[1] === 'locate-materialize') {
        if (body && body.phase && out.phases[out.phases.length - 1] !== body.phase) out.phases.push(body.phase);
        for (const c of (body && body.candidates) || []) if (!out.candidateStates.includes(c.state)) out.candidateStates.push(c.state);
        if (m[1] !== 'locate-status') out.routes.push({ route: m[1], status: r.status() });
        return;
      }
      if (method !== 'POST') return;
      out.routes.push({ route: m[1], status: r.status() });
      if (m[1] === 'locate-confirm') {
        out.located = body ? { success: body.success === true, type: body.type, code: body.code, reason: body.reason, hasRef: !!body.ref, filePath: body.filePath, dir: body.dir, companyFilePath: body.companyFilePath } : null;
      }
    });
    if (DELAY_STATUS) await page.route('**/api/locate-status*', async (route) => { await new Promise((r) => setTimeout(r, DELAY_STATUS)); await route.continue(); });
    await page.goto(`${UI}/login`, { waitUntil: 'networkidle', timeout: 120000 });
    const sampler = setInterval(async () => {
      try {
        const t = await page.locator('[data-testid="company-file-notice"]').first().innerText({ timeout: 300 });
        if (t && !out.statusTexts.includes(t)) out.statusTexts.push(t);
      } catch { /* not there */ }
      try {
        const v = await page.locator('[data-testid="locate-progress-bar"]').first().getAttribute('aria-valuenow', { timeout: 300 });
        if (v !== null && (out.progress.length === 0 || out.progress[out.progress.length - 1] !== Number(v))) out.progress.push(Number(v));
      } catch { /* no bar */ }
    }, 100);
    const secret = await page.evaluate(() => (window.__TEXACORE_CONFIG__ || {}).localApiSecret || '');
    const callApi = (route, body) => page.evaluate(async ({ route: rt, body: bd, secret: sc }) => {
      const r = await fetch(rt, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-texacore-local-secret': sc }, body: JSON.stringify(bd) });
      return r.status;
    }, { route, body, secret });
    await page.locator('#company-file-upload').setInputFiles(FILE);

    const isTcdb = /\.tcdb$/i.test(FILE);
    const noteSel = isTcdb ? '[data-testid="live-company-file-note"]' : '[data-testid="rsf-company-file-target"], [data-testid="rsf-company-file-fallback"]';
    let permStepIdx = 0; let permWasShown = false;
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
      // the macOS permission step
      if (await page.locator('[data-testid="folder-permission-step"]').count()) {
        const stepEl = page.locator('[data-testid="folder-permission-step"]').first();
        out.permission.seen = true; permWasShown = true;
        out.permission.mode = await stepEl.getAttribute('data-mode');
        out.permission.title = (await page.locator('[data-testid="folder-permission-title"]').first().innerText()).replace(/\s+/g, ' ').trim();
        out.permission.body = (await page.locator('[data-testid="folder-permission-body"]').first().innerText()).replace(/\s+/g, ' ').trim();
        if (await page.locator('[data-testid="folder-permission-still"]').count()) out.permission.still = (await page.locator('[data-testid="folder-permission-still"]').first().innerText()).replace(/\s+/g, ' ').trim();
        if (SHOTS && permStepIdx === 0) await page.screenshot({ path: path.join(SHOTS, `${TAG}-permission.png`) }).catch(() => {});
        if (permStepIdx >= PERM_SCRIPT.length) break;   // nothing left to do: report what is on screen
        const step = PERM_SCRIPT[permStepIdx++];
        if (step.click) { await page.locator(`[data-testid="${step.click}"]`).first().click(); out.permission.actions.push(`click:${step.click}`); await page.waitForTimeout(700); }
        else if (step.sim) { await callApi('/api/e2e-folder-access', { sim: step.sim }); out.permission.actions.push('sim'); await page.waitForTimeout(300); }
        else if (step.wait) { await page.waitForTimeout(step.wait); out.permission.actions.push(`wait:${step.wait}`); }
        continue;
      }
      if (CLICK_SKIP && !out.skipClicked && await page.locator('[data-testid="locate-skip"]').count()) { await page.locator('[data-testid="locate-skip"]').first().click(); out.skipClicked = true; await page.waitForTimeout(500); continue; }
      if (CANCEL_AT !== null && !out.cancelClicked && out.progress.length && out.progress[out.progress.length - 1] >= CANCEL_AT && await page.locator('[data-testid="locate-cancel"]').count()) {
        await page.locator('[data-testid="locate-cancel"]').first().click(); out.cancelClicked = true; await page.waitForTimeout(800); continue;
      }
      if (await page.locator(noteSel).count()) break;
      if (out.alerts.length) break;
      // a final notice with no progress panel = the open ended without a result page (cancelled / a failed download)
      if (!(await page.locator('[data-testid="locate-panel"]').count()) && out.phases.length && await page.locator('[data-testid="company-file-notice"]').count()) {
        await page.waitForTimeout(600);
        if (!(await page.locator('[data-testid="locate-panel"]').count()) && !(await page.locator(noteSel).count())) break;
      }
      await page.waitForTimeout(300);
    }
    if (WAIT_CURRENCY && !isTcdb) {
      // the form's currency read must END (the 2.0.3 spinner never did on an iCloud placeholder) with the file's currency selected
      const tc = Date.now();
      const reading = page.getByText(/جارٍ قراءة عملة الملف|Reading the file's currency/);
      while (Date.now() - tc < 120000 && (await reading.count())) await page.waitForTimeout(300);
      out.currency = { ended: (await reading.count()) === 0, ms: Date.now() - tc, combos: (await page.locator('[role="combobox"]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()), failureShown: (await page.locator('[data-testid="rsf-read-failure"]').count()) > 0 };
    }
    clearInterval(sampler);
    await page.waitForTimeout(500);
    const noteEl = page.locator(noteSel).first();
    if (await noteEl.count()) {
      out.note = { testId: await noteEl.getAttribute('data-testid'), text: (await noteEl.innerText()).replace(/\s+/g, ' ').trim() };
    }
    if (!(await page.locator('[data-testid="locate-panel"]').count()) && await page.locator('[data-testid="company-file-notice"]').count()) {
      out.finalNotice = (await page.locator('[data-testid="company-file-notice"]').first().innerText()).replace(/\s+/g, ' ').trim();
    }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG}.png`) }).catch(() => {});
    console.log('OPENFILE ' + JSON.stringify(out));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
