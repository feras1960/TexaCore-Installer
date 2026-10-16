'use strict';
// Real-browser audit of the launcher's NEW COMPANY wizard (/local-setup) against a running app (2.0.4): the default folder shown to the user, the five steps,
// the first login, and what happens when macOS has not allowed the company file's folder (the harness pretends - POST /api/e2e-folder-access, never the real privacy settings).
//   node scripts/e2e/launcher-audit.cjs --erp <ERP> --ui http://localhost:47395 --name "Audit Co" --file-base AuditCo --email a@b.test --password 'x' [--country Ukraine]
//        [--perm-script '<json>']   what to do when the permission step shows: {click:'perm-program'|'perm-retry'|'perm-skip'|'perm-open-settings'} | {sim:{...}} | {wait:ms}
// Prints ONE line: AUDIT <json> = { step1:{storagePath,placeholderTexts}, texts:[...per step headings], submitted, permission:{seen,mode,title,body,hasProgramButton,actions}, afterUrl, loggedIn,
//   activeCompany, createAnswer:{status,code,success,tcdbPlacement,tcdbPath}, alerts, toast }
const fs = require('fs');
const path = require('path');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const ERP = arg('erp'); const UI = arg('ui'); const NAME = arg('name', 'Audit Co'); const FILE_BASE = arg('file-base', 'AuditCo'); const EMAIL = arg('email', 'audit@e2e.test');
const PASSWORD = arg('password', 'Audit#2026xyz'); const COUNTRY = arg('country', 'Ukraine'); const SHOTS = arg('shots', ''); const TAG = arg('tag', 'audit');
const PERM_SCRIPT = (() => { try { return JSON.parse(arg('perm-script', '[]')); } catch { return []; } })();
const { chromium } = require(path.join(ERP, 'node_modules', 'playwright'));

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'en-US' });
    const page = await ctx.newPage();
    const out = { step1: null, texts: [], submitted: false, permission: { seen: false, mode: null, title: null, body: null, hasProgramButton: false, actions: [] }, afterUrl: null, loggedIn: false, activeCompany: null, createAnswer: null, alerts: [], createCalls: [] };
    page.on('dialog', async (d) => { out.alerts.push(d.message().slice(0, 300)); await d.dismiss().catch(() => {}); });
    page.on('response', async (r) => {
      if (!/\/api\/create-local-company$/.test(r.url()) || r.request().method() !== 'POST') return;
      let b = null; try { b = await r.json(); } catch { /* not json */ }
      let sent = {}; try { sent = JSON.parse(r.request().postData() || '{}'); } catch { /* not json */ }
      out.createCalls.push({ status: r.status(), code: b && b.code, success: !!(b && b.success), state: b && b.state, area: b && b.area, tcdbPlacement: b && b.tcdbPlacement, tcdbPath: b && b.tcdbPath, fallback: sent.fileFolderFallback || null });
      out.createAnswer = out.createCalls[out.createCalls.length - 1];
    });
    await page.goto(`${UI}/local-setup`, { waitUntil: 'networkidle', timeout: 120000 });
    const secret = await page.evaluate(() => (window.__TEXACORE_CONFIG__ || {}).localApiSecret || '');
    const heading = async () => (await page.locator('h2, h3').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6).join(' | ');
    const next = async () => { await page.locator('#nextButton').click(); await page.waitForTimeout(500); };

    // ── step 1: where the company file is saved ──
    out.step1 = { storagePath: await page.locator('#storagePath').inputValue(), dbFileName: await page.locator('#dbFileName').inputValue() };
    out.texts.push(await heading());
    await page.locator('#dbFileName').fill(FILE_BASE);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG}-1.png`) }).catch(() => {});
    await next();
    // ── step 2: company, country ──
    await page.locator('#companyName').fill(NAME);
    await page.locator('#countryTrigger').click();
    await page.getByRole('option').filter({ hasText: new RegExp(COUNTRY === 'Ukraine' ? 'Ukraine|أوكرانيا' : COUNTRY) }).first().click();
    out.texts.push(await heading());
    await next();
    // ── step 3: currencies (the country's currency is filled in; the main one is USD) ──
    out.texts.push(await heading());
    out.currencies = await page.locator('#localCurrencyTrigger, #mainCurrencyTrigger').allInnerTexts();
    await next();
    // ── step 4: the admin account ──
    await page.locator('#adminUsername').fill('admin');
    await page.locator('#adminEmail').fill(EMAIL);
    await page.locator('#adminPassword').fill(PASSWORD);
    out.texts.push(await heading());
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG}-4.png`) }).catch(() => {});
    await next();
    // ── step 5: create ──
    out.texts.push(await heading());
    await page.locator('#submitButton').click();
    out.submitted = true;

    let permIdx = 0;
    const t0 = Date.now();
    const callApi = (route, body) => page.evaluate(async ({ route: rt, body: bd, secret: sc }) => {
      const r = await fetch(rt, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-texacore-local-secret': sc }, body: JSON.stringify(bd) });
      return r.status;
    }, { route, body, secret });
    while (Date.now() - t0 < 180000) {
      if (await page.locator('[data-testid="folder-permission-step"]').count()) {
        const el = page.locator('[data-testid="folder-permission-step"]').first();
        out.permission.seen = true;
        out.permission.mode = await el.getAttribute('data-mode');
        out.permission.title = (await page.locator('[data-testid="folder-permission-title"]').first().innerText()).replace(/\s+/g, ' ').trim();
        out.permission.body = (await page.locator('[data-testid="folder-permission-body"]').first().innerText()).replace(/\s+/g, ' ').trim();
        out.permission.hasProgramButton = (await page.locator('[data-testid="perm-program"]').count()) > 0;
        if (SHOTS && permIdx === 0) await page.screenshot({ path: path.join(SHOTS, `${TAG}-permission.png`) }).catch(() => {});
        if (permIdx >= PERM_SCRIPT.length) await page.waitForTimeout(1500);   // nothing left to do: a pending step resolves by itself
        else {
          const step = PERM_SCRIPT[permIdx++];
          if (step.click) { await page.locator(`[data-testid="${step.click}"]`).first().click(); out.permission.actions.push(`click:${step.click}`); await page.waitForTimeout(800); }
          else if (step.sim) { await callApi('/api/e2e-folder-access', { sim: step.sim }); out.permission.actions.push('sim'); await page.waitForTimeout(300); }
          else if (step.wait) { await page.waitForTimeout(step.wait); out.permission.actions.push(`wait:${step.wait}`); }
        }
      }
      // done: the page reloaded onto the dashboard with a session
      const url = page.url();
      if (/^https?:\/\/[^/]+\/($|\?|#)/.test(url) && !url.includes('/local-setup') && (await page.evaluate(() => !!localStorage.getItem('sb-local-auth-token')))) break;
      if (out.alerts.length) break;
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(2500);
    out.afterUrl = page.url();
    out.loggedIn = await page.evaluate(() => !!localStorage.getItem('sb-local-auth-token'));
    out.activeCompany = await page.evaluate(() => { try { const c = JSON.parse(localStorage.getItem('texacore_active_company') || 'null'); return c ? { name: c.name, hasId: !!c.id } : null; } catch { return null; } });
    out.toastText = await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => []);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${TAG}-after.png`) }).catch(() => {});
    console.log('AUDIT ' + JSON.stringify(out));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
