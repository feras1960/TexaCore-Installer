'use strict';
// Real-browser step of the final-build checks (build #4), one signed-in owner session on the PACKAGED app's page, seeded documents (multi-company-checks.js seeds them):
//   usersToast   N8: adding an employee on the desktop says the account was created (createdBody), not «pending invitation»; the add-user role list is not empty (BUG-9, in the page)
//   print        G3: the share centre of a sales invoice and of a sales quote render >= 1 page and every fn_document_qr_link answers 200 (it answered 400 «unknown entity_type» when the print catalogs were missing);
//                #1030(ii): opening them requests NO fn_issue_document_token (no public token on the desktop)
//   statement    G3: the customer statement preview renders >= 1 page (it said «0 pages» without the global print templates, rehearsal finding 3)
//   materialSave R6-1 (build #7): the installer-created OWNER saves a new material card from the real page: «إضافة مادة» -> name + group -> «حفظ»; no «تعذّر تحديد المستأجر» (it threw on build #6 because the owner's
//                user_metadata had no tenant_id), a write request reached the server and the page told the owner nothing failed (the row itself is asserted by multi-company-checks 9.13 over SQL)
//   rail         #1030(i): at 1280x800 and 1440x900, rail expanded and collapsed, the «⋯» row buttons of a list are what a click at their centre hits (not the company rail)
//   node scripts/e2e/browser-final-checks.cjs --erp <ERP> --ui <origin> --code <8 hex> --email … --password … --invoice SEED-INV-1 --quote SEED-Q-1 --customer SEED-C1 --shots <dir> [--only usersToast,print,statement,rail]
const fs = require('fs');
const path = require('path');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const ERP = arg('erp'); const UI = arg('ui'); const CODE = arg('code'); const EMAIL = arg('email'); const PASSWORD = arg('password'); const SHOTS = arg('shots');
const INVOICE = arg('invoice', 'SEED-INV-1'); const QUOTE = arg('quote', 'SEED-Q-1'); const CUSTOMER = arg('customer', 'SEED-C1'); const STAFF = arg('staff', 'staff-final@e2e.test');
const MATERIAL = arg('material', 'مادة فحص المالك R6-1');
const ONLY = arg('only', 'usersToast,print,statement,rail').split(',');
const { chromium } = require(path.join(ERP, 'node_modules', 'playwright'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-features=MacAppCodeSignClone'] });
  const out = {};
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    const qr = []; const tokenAsks = [];
    page.on('response', (r) => { if (/rpc\/fn_document_qr_link/.test(r.url())) qr.push(r.status()); });
    page.on('request', (r) => { if (/fn_issue_document_token/.test(r.url())) tokenAsks.push(r.url().replace(/^https?:\/\/[^/]+/, '')); });
    await page.goto(`${UI}/login?c=${CODE}`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.fill('input[type="text"]', EMAIL); await page.fill('input[type="password"]', PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500); await page.keyboard.press('Escape');
    const goto = async (p) => { await page.goto(`${UI}${p}`, { waitUntil: 'load', timeout: 90000 }); await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(3000); };
    const pagesOf = async () => { const t = await page.locator('body').innerText({ timeout: 60000 }); const m = [...t.matchAll(/(\d+)\s*صفحات/g)].map((x) => +x[1]); return m.length ? Math.max(...m) : 0; };
    const waitPages = async (label) => { let n = 0; for (let i = 0; i < 20 && n < 1; i++) { await sleep(1000); n = await pagesOf(); } if (n < 1) throw new Error(`${label}: the preview shows ${n} pages`); return n; };

    if (ONLY.includes('usersToast')) {
      await goto('/system-config/users-permissions');
      await page.getByRole('tab', { name: 'المستخدمين', exact: true }).click(); await page.waitForTimeout(2000);
      await page.getByRole('button', { name: 'إضافة مستخدم', exact: true }).click(); await page.waitForTimeout(2500);
      const dlg = page.locator('[role="dialog"]').last();
      await dlg.locator('input[type="email"]').fill(STAFF); await dlg.locator('input[placeholder="اسم المستخدم"]').fill('موظف الفحص النهائي');
      await dlg.getByText('Multi One', { exact: true }).click(); await page.waitForTimeout(1500);
      const roles = await dlg.locator('button').evaluateAll((els) => els.map((e) => (e.textContent || '').trim()).filter(Boolean));
      if (roles.length < 8 || !roles.includes('محاسب')) throw new Error(`the add-user role list is not populated: ${roles.slice(0, 10).join(' | ')}`);
      await dlg.getByRole('button', { name: 'محاسب', exact: true }).click(); await page.waitForTimeout(400);
      await dlg.getByRole('button', { name: 'إرسال الدعوة', exact: true }).click();
      let toast = '';
      for (let i = 0; i < 12 && !/أُنشئ حساب|معلَّق|معلق/.test(toast); i++) {
        await sleep(700);
        toast = (await page.evaluate(() => [...document.querySelectorAll('[role="status"], [role="alert"], [data-sonner-toast]')].map((e) => (e.textContent || '').trim()).join(' | '))) || '';
      }
      if (!/أُنشئ حساب الموظف/.test(toast)) throw new Error(`the new-employee toast does not say the account was created: ${toast.slice(0, 200)}`);
      if (/معلَّق|معلق/.test(toast.replace(/اختر شركة[^|]*/g, ''))) throw new Error(`the toast still says pending: ${toast.slice(0, 200)}`);
      out.usersToast = { roleButtons: roles.length, toast: toast.slice(0, 120) };
      await page.screenshot({ path: path.join(SHOTS, 'final-users-toast.png') });
    }

    if (ONLY.includes('print')) {
      out.print = {};
      for (const [label, doc] of [['invoice', INVOICE], ['quote', QUOTE]]) {
        await goto('/sales/cycle');
        await page.getByText(doc, { exact: false }).first().click(); await page.waitForTimeout(3000);
        await page.getByText('طباعة ومشاركة', { exact: false }).first().click();
        out.print[label] = await waitPages(`${label} share centre`);
        await page.screenshot({ path: path.join(SHOTS, `final-share-${label}.png`) });
        await page.keyboard.press('Escape'); await page.waitForTimeout(500);
      }
      if (!qr.length) throw new Error('the share centre never asked fn_document_qr_link');
      if (qr.some((s) => s !== 200)) throw new Error(`fn_document_qr_link answered ${[...new Set(qr)].join(',')} (400 = «unknown entity_type»: the print catalogs are missing)`);
      if (tokenAsks.length) throw new Error(`a public token was requested on the desktop: ${tokenAsks.slice(0, 2).join(' | ')}`);
      out.print.qrCalls = qr.length;
    }

    if (ONLY.includes('statement')) {
      await goto('/sales/customers');
      await page.getByText(CUSTOMER, { exact: false }).first().click(); await page.waitForTimeout(3000);
      await page.getByRole('button', { name: 'طباعة', exact: true }).first().click();
      out.statement = await waitPages('customer statement preview');
      await page.screenshot({ path: path.join(SHOTS, 'final-statement.png') });
      await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    }

    if (ONLY.includes('materialSave')) {
      const writes = [];
      page.on('response', (r) => { const rq = r.request(); if (rq.method() !== 'GET' && /\/rest\/v1\//.test(r.url())) writes.push(`${rq.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]} ${r.status()}`); });
      await goto('/warehouse/materials');
      await page.getByRole('button', { name: 'إضافة مادة', exact: true }).first().click(); await page.waitForTimeout(2500);
      const dlg = page.locator('[role="dialog"]').last();
      await dlg.locator('input[placeholder="مثال: أسمنت بورتلاندي"]').fill(MATERIAL);
      await dlg.getByText('اختر المجموعة...', { exact: false }).first().click(); await page.waitForTimeout(1200);
      await page.getByRole('option').first().click(); await page.waitForTimeout(1500);
      const before = writes.length;
      await dlg.getByRole('button', { name: 'حفظ', exact: true }).click();
      let toast = '';
      for (let i = 0; i < 25 && !toast; i++) {
        await sleep(700);
        toast = (await page.evaluate(() => [...document.querySelectorAll('[role="status"], [role="alert"], [data-sonner-toast]')].map((e) => (e.textContent || '').trim()).join(' | '))) || '';
      }
      await page.screenshot({ path: path.join(SHOTS, 'final-material-save.png') });
      if (/تعذّر تحديد المستأجر|Tenant could not be resolved/.test(toast)) throw new Error(`R6-1: the owner cannot save a material - ${toast.slice(0, 220)}`);
      if (/لم تُحفظ|did not save|not saved|failed/i.test(toast)) throw new Error(`the page says the material was not saved: ${toast.slice(0, 220)}`);
      await sleep(1500);
      const sent = writes.slice(before);
      if (!sent.length) throw new Error(`no write request reached the server after «حفظ» (toast: ${toast.slice(0, 160) || 'none'})`);
      if (sent.some((w) => !/ 2\d\d$/.test(w))) throw new Error(`a write was refused: ${sent.join(' | ')}`);
      out.materialSave = { toast: toast.slice(0, 100), writes: sent };
    }

    if (ONLY.includes('rail')) {
      out.rail = [];
      for (const [w, h] of [[1280, 800], [1440, 900]]) {
        for (const collapsed of [false, true]) {
          await page.setViewportSize({ width: w, height: h });
          await page.evaluate((v) => localStorage.setItem('company_sidebar_collapsed', v), String(collapsed));
          await goto('/warehouse/materials');
          await page.getByRole('button', { name: 'جدول', exact: true }).click(); await page.waitForTimeout(2500);
          const r = await page.evaluate(() => {
            const rail = getComputedStyle(document.documentElement).getPropertyValue('--company-rail-w').trim();
            const btns = [...document.querySelectorAll('table tbody tr button')].filter((b) => { const q = b.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(b).visibility !== 'hidden'; });
            let tested = 0; const bad = [];
            for (const b of btns) {
              b.scrollIntoView({ block: 'center', inline: 'nearest' });
              const q = b.getBoundingClientRect(); const cx = q.left + q.width / 2; const cy = q.top + q.height / 2;
              if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) continue;
              tested++;
              const hit = document.elementFromPoint(cx, cy);
              if (!(hit === b || b.contains(hit))) bad.push(`${(b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 12)}@${Math.round(cx)},${Math.round(cy)} hit ${hit ? hit.tagName + '.' + String(hit.className).slice(0, 40) : 'null'}`);
            }
            return { rail, tested, bad, total: btns.length };
          });
          if (r.tested < 6) throw new Error(`${w}x${h} ${collapsed ? 'collapsed' : 'expanded'}: only ${r.tested} row buttons could be tested (of ${r.total})`);
          if (r.bad.length) throw new Error(`${w}x${h} ${collapsed ? 'collapsed' : 'expanded'} (rail ${r.rail}): ${r.bad.length} row button(s) are covered: ${r.bad.slice(0, 3).join(' | ')}`);
          const expect = collapsed ? '2.5rem' : '76px';
          if (r.rail !== expect) throw new Error(`${w}x${h} ${collapsed ? 'collapsed' : 'expanded'}: --company-rail-w is "${r.rail}", expected ${expect}`);
          out.rail.push(`${w}x${h} ${collapsed ? 'collapsed' : 'expanded'}: ${r.tested} buttons, rail ${r.rail}`);
          await page.screenshot({ path: path.join(SHOTS, `final-rail-${w}-${collapsed ? 'collapsed' : 'expanded'}.png`) });
        }
      }
      await page.evaluate(() => localStorage.setItem('company_sidebar_collapsed', 'false'));
    }
    console.log(`FINAL ${JSON.stringify(out)}`);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
