'use strict';
// Real-browser step of the launch check: headless Chrome (Playwright from the ERP checkout) opens the served ERP, the company
// is listed (via the admin API + runtime secret), the admin logs in through the real form and reaches the dashboard.
//   node scripts/e2e/browser-login.cjs --erp <ERP> --ui http://127.0.0.1:47395 --email … --password … --shots <dir>
const fs = require('fs');
const path = require('path');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const ERP = arg('erp'); const UI = arg('ui'); const EMAIL = arg('email'); const PASSWORD = arg('password'); const SHOTS = arg('shots');
const COMPANY = arg('company', '');
const { chromium } = require(path.join(ERP, 'node_modules', 'playwright'));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const failures = [];
    page.on('response', (r) => {
      const u = r.url();
      if (r.status() >= 400 && /\/(rest|auth)\/v1\//.test(u) && !/rpc\/(get_user_tenants|get_template_preview)/.test(u)) failures.push(`${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '').slice(0, 100)}`);
    });
    await page.goto(`${UI}/login`, { waitUntil: 'networkidle', timeout: 90000 });
    await page.screenshot({ path: path.join(SHOTS, '1-login.png') });
    const card = COMPANY ? page.getByRole('button', { name: new RegExp(COMPANY) }) : page.locator('button', { hasText: 'Local Database' }).first();
    if (!(await card.count())) throw new Error('no company card on the login page (admin API / runtime secret broken?)');
    await card.click();
    await page.fill('input[type="text"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SHOTS, '2-dashboard.png') });
    const token = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('sb-local-auth-token') || 'null'); } catch { return null; } });
    if (!token || !token.access_token) throw new Error('no session in localStorage after login');
    const profile = await page.evaluate(async ({ url, tok, anon }) => {
      const r = await fetch(`${url}/_supabase/rest/v1/user_profiles?select=email,role,is_tenant_admin`, { headers: { apikey: anon, Authorization: `Bearer ${tok}` } });
      return { status: r.status, body: await r.json() };
    }, { url: UI, tok: token.access_token, anon: await page.evaluate(() => window.__TEXACORE_CONFIG__.supabaseKey) });
    if (profile.status !== 200 || !profile.body.length || profile.body[0].email !== EMAIL) throw new Error(`profile via the page's own session: ${JSON.stringify(profile)}`);
    const text = (await page.innerText('body')).replace(/\s+/g, ' ');
    if (!/لوحة التحكم|Dashboard/.test(text)) throw new Error('dashboard text not found');
    const font = await page.evaluate(() => document.fonts.check('16px Tajawal') || document.fonts.check('16px Cairo'));
    const online = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')).filter((v, i, a) => a.indexOf(v) === i).join(','));
    if (failures.length) throw new Error(`rest/auth responses >= 400 during login: ${failures.slice(0, 5).join(' | ')}`);
    console.log(`login ok: ${EMAIL} → ${new URL(page.url()).pathname}, profile role=${profile.body[0].role} is_tenant_admin=${profile.body[0].is_tenant_admin}, fonts loaded: ${online || 'none'} (screenshots: ${SHOTS})`);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
