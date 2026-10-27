'use strict';
// Real-browser step of the final-build checks (E2E BUG-19 / BUG-20), on the desktop the page is served by the app (desktop mode):
//   · an attachment upload answers { success:false, errorCode:'DESKTOP_STORAGE_UNAVAILABLE' } with a reason in the interface language - the SHIPPED bundle's attachmentService, called in the real signed-in page
//   · the share hub issues no public token on the desktop: the app serves the desktop gate (its source says desktop = purchase document) and the reason text in ar / en / ru / uk, and the page never asks for a
//     public token while it is used
//   node scripts/e2e/browser-desktop-guards.cjs --erp <ERP checkout (src + dist)> --ui http://127.0.0.1:47395 --email … --password … --code <8 hex> --shots <dir>
const fs = require('fs');
const path = require('path');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const ERP = arg('erp'); const UI = arg('ui'); const EMAIL = arg('email'); const PASSWORD = arg('password'); const CODE = arg('code'); const SHOTS = arg('shots');
const { chromium } = require(path.join(ERP, 'node_modules', 'playwright'));
const ASSETS = path.join(ERP, 'dist', 'assets');
const assetFiles = () => fs.readdirSync(ASSETS).filter((f) => f.endsWith('.js'));
const filesWith = (needle) => assetFiles().filter((f) => fs.readFileSync(path.join(ASSETS, f), 'utf8').includes(needle));
const dig = (o, p) => p.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o);

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  // what the shipped bundle must carry
  const chunk = filesWith('DESKTOP_STORAGE_UNAVAILABLE');
  if (!chunk.length) throw new Error('no chunk of the ERP bundle carries DESKTOP_STORAGE_UNAVAILABLE');
  const texts = {};
  for (const l of ['ar', 'en', 'ru', 'uk']) {
    const json = JSON.parse(fs.readFileSync(path.join(ERP, 'src', 'i18n', 'locales', `${l}.json`), 'utf8'));
    texts[l] = dig(json, 'crm.shareHub.r7.noDesktopPublicPage');
    if (!texts[l] || typeof texts[l] !== 'string') throw new Error(`locale ${l} lacks crm.shareHub.r7.noDesktopPublicPage`);
  }
  const hubSrc = fs.readFileSync(path.join(ERP, 'src', 'features', 'crm', 'opportunities', 'share', 'ShareHubDialog.tsx'), 'utf8');
  if (!/const noPublicPageOnDesktop = isDesktopMode\(\);/.test(hubSrc) || !/const noPublicPageForPurchase = docTradeMode === 'purchase' \|\| noPublicPageOnDesktop;/.test(hubSrc)) throw new Error('the share hub source lacks the desktop gate');

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-features=MacAppCodeSignClone'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
    const page = await ctx.newPage();
    const tokenAsks = [];
    page.on('request', (r) => { if (/public_token|document_public_tokens|issue_public|create_public_link|short_link/i.test(r.url()) && r.method() !== 'GET') tokenAsks.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 90)}`); });
    await page.goto(CODE ? `${UI}/login?c=${CODE}` : `${UI}/login`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    if (!CODE) { const card = page.locator('button', { hasText: 'Multi One' }).first(); if (await card.count()) await card.click(); }
    await page.fill('input[type="text"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);

    // the app SERVES the shipped chunk (not just the checkout)
    const served = await page.evaluate(async (names) => {
      const out = {};
      for (const n of names) { const r = await fetch(`/assets/${n}`); const t = await r.text(); out[n] = { status: r.status, has: t.includes('DESKTOP_STORAGE_UNAVAILABLE') }; }
      return out;
    }, chunk);
    if (!Object.values(served).some((x) => x.status === 200 && x.has)) throw new Error(`the app does not serve the attachment guard: ${JSON.stringify(served)}`);

    // the real attachmentService of the bundle, in the real page
    const up = await page.evaluate(async (names) => {
      for (const n of names) {
        const m = await import(`/assets/${n}`);
        const svc = Object.values(m).find((v) => v && typeof v === 'object' && typeof v.upload === 'function' && typeof v.getByEntity === 'function');
        if (svc) {
          const file = new File(['%PDF-1.4 test'], 'test.pdf', { type: 'application/pdf' });
          const r = await svc.upload({ file, entityType: 'journal_entry', entityId: crypto.randomUUID(), tenantId: crypto.randomUUID(), category: 'other', documentTitle: 'desktop guard check' });
          return { chunk: n, result: r, lang: document.documentElement.lang, desktop: window.__TEXACORE_CONFIG__ ? Object.keys(window.__TEXACORE_CONFIG__).slice(0, 6) : null };
        }
      }
      return { chunk: null };
    }, chunk);
    if (!up.chunk) throw new Error(`attachmentService not found among the exports of ${chunk.join(', ')}`);
    const r = up.result;
    if (!r || r.success !== false || r.errorCode !== 'DESKTOP_STORAGE_UNAVAILABLE' || !r.error || String(r.error).length < 20) throw new Error(`upload → ${JSON.stringify(r)}`);
    if (!/المرفقات|Attachments|Вложения|Вкладення/.test(r.error)) throw new Error(`the reason is not a sentence about attachments: ${r.error}`);

    // the share hub: the reason in every language is shipped, and the dialog's chunk carries the key
    const shipped = {};
    for (const l of Object.keys(texts)) {
      const f = filesWith(texts[l].slice(0, 40));
      if (!f.length) throw new Error(`the ${l} reason is not in the shipped bundle: "${texts[l].slice(0, 50)}"`);
      shipped[l] = f[0];
    }
    const keyFiles = filesWith('crm.shareHub.r7.noDesktopPublicPage');
    if (!keyFiles.length) throw new Error('no chunk references crm.shareHub.r7.noDesktopPublicPage (the dialog\'s desktop branch is not shipped)');
    const servedKey = await page.evaluate(async (n) => (await (await fetch(`/assets/${n}`)).text()).includes('crm.shareHub.r7.noDesktopPublicPage'), keyFiles[0]);
    if (!servedKey) throw new Error('the app does not serve the share hub chunk with the desktop key');
    if (tokenAsks.length) throw new Error(`the page asked for a public token / link: ${tokenAsks.slice(0, 3).join(' | ')}`);
    await page.screenshot({ path: path.join(SHOTS, 'desktop-guards.png') });
    console.log(`upload → ${r.errorCode} ("${String(r.error).slice(0, 70)}…", chunk ${up.chunk}); share hub: desktop gate in source, key in ${keyFiles[0]}, reason shipped in ar/en/ru/uk, no public-token request while the page ran`);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
