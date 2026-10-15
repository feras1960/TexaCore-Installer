'use strict';
// Real-browser probe of what the ERP page does with the plan answer (usePlanLimits → Sidebar / ModuleGuard): headless Chrome (Playwright from the ERP checkout)
// logs in as a local admin, records every get_all_plan_limits / check_plan_limits answer the PAGE receives, lists the sidebar links and opens module routes to see
// whether the plan block screen ("not included in your current plan") appears. Prints ONE line: PROBE <json>. Used by scripts/e2e/limits-compat-check.js.
//   node scripts/e2e/browser-plan-probe.cjs --erp <ERP> --ui http://127.0.0.1:47395 --email … --password … [--code <company code>] [--shots <dir>] [--routes /sales,/accounting]
const fs = require('fs');
const path = require('path');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const ERP = arg('erp'); const UI = arg('ui'); const EMAIL = arg('email'); const PASSWORD = arg('password'); const SHOTS = arg('shots', '');
const CODE = arg('code', '');
const COMPANY = arg('company', '');
const ROUTES = arg('routes', '/accounting,/sales,/warehouse,/purchases,/fabric,/manufacturing,/hr,/crm').split(',').filter(Boolean);
const { chromium } = require(path.join(ERP, 'node_modules', 'playwright'));

(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const rpcs = [];
    page.on('response', async (r) => {
      const m = /\/rpc\/(get_all_plan_limits|check_plan_limits)/.exec(r.url());
      if (!m) return;
      let body = null; try { body = await r.json(); } catch { /* not json */ }
      rpcs.push({ fn: m[1], status: r.status(), body });
    });
    await page.goto(CODE ? `${UI}/login?c=${CODE}` : `${UI}/login`, { waitUntil: 'networkidle', timeout: 90000 });
    if (!CODE) {
      const card = COMPANY ? page.getByRole('button', { name: new RegExp(COMPANY) }) : page.locator('button', { hasText: 'Local Database' }).first();
      if (!(await card.count())) throw new Error('no company card on the login page');
      await card.click();
    }
    await page.fill('input[type="text"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'probe-dashboard.png') });
    const links = await page.$$eval('nav a[href], aside a[href]', (as) => [...new Set(as.map((a) => a.getAttribute('href')).filter(Boolean))]);
    const dash = (await page.innerText('body')).replace(/\s+/g, ' ');
    const BLOCK = /غير مشمول في باقتك|not included in your current plan|Protected by Subscription System|محمي بنظام الاشتراكات/;
    const routes = {};
    for (const r of ROUTES) {
      await page.goto(`${UI}${r}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(3500);
      const text = (await page.innerText('body')).replace(/\s+/g, ' ');
      routes[r] = { path: new URL(page.url()).pathname, blockedByPlan: BLOCK.test(text), chars: text.length };
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `probe${r.replace(/\//g, '-')}.png`) });
    }
    const plan = rpcs.filter((x) => x.fn === 'get_all_plan_limits').map((x) => ({ status: x.status, error: x.body && x.body.error ? x.body.error : null, plan: x.body && x.body.plan_code, modules: x.body && Array.isArray(x.body.modules) ? x.body.modules.length : null }));
    console.log('PROBE ' + JSON.stringify({ dashboardOk: /لوحة التحكم|Dashboard/.test(dash), sidebarLinks: links.length, links, planAnswers: plan, routes }));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
