'use strict';
// Real-browser step of the final-build checks (E2E BUG-3): the employee/company link /login?c=<code> of ONE of an owner's companies, the owner signs in through the real form, and the app must
// open THAT company: the page's active company, the sign-in session's company and the server's user_profiles.company_id all name it. A fresh browser context per call (no leftover session).
//   node scripts/e2e/browser-company-link.cjs --erp <ERP> --ui http://127.0.0.1:47395 --code <8 hex> --expect <company id> --email … --password … --shots <dir>
const fs = require('fs');
const path = require('path');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const ERP = arg('erp'); const UI = arg('ui'); const CODE = arg('code'); const EXPECT = arg('expect'); const EMAIL = arg('email'); const PASSWORD = arg('password'); const SHOTS = arg('shots');
const { chromium } = require(path.join(ERP, 'node_modules', 'playwright'));

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-features=MacAppCodeSignClone'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${UI}/login?c=${CODE}`, { waitUntil: 'load', timeout: 90000 });
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.fill('input[type="text"]', EMAIL);
    await page.fill('input[type="password"]', PASSWORD);
    await page.screenshot({ path: path.join(SHOTS, `link-${CODE}-1-form.png`) });
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SHOTS, `link-${CODE}-2-after-login.png`) });
    const st = await page.evaluate(() => {
      const j = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
      const tok = j('sb-local-auth-token');
      return { active: j('texacore_active_company'), cached: j('texacore_cached_ids'), uid: tok && tok.user && tok.user.id, metaCompany: tok && tok.user && tok.user.user_metadata && tok.user.user_metadata.company_id,
        access: tok && tok.access_token, anon: window.__TEXACORE_CONFIG__ && window.__TEXACORE_CONFIG__.supabaseKey };
    });
    if (!st.access || !st.uid) throw new Error('no session in localStorage after login');
    const prof = await page.evaluate(async ({ url, tok, anon, uid }) => {
      const r = await fetch(`${url}/_supabase/rest/v1/user_profiles?select=company_id,email&id=eq.${uid}`, { headers: { apikey: anon, Authorization: `Bearer ${tok}` } });
      return { status: r.status, body: await r.json() };
    }, { url: UI, tok: st.access, anon: st.anon, uid: st.uid });
    const server = prof.status === 200 && prof.body.length ? prof.body[0].company_id : null;
    const got = { page: st.active && st.active.id, cached: st.cached && st.cached.company_id, session: st.metaCompany, server };
    const bad = Object.entries(got).filter(([k, v]) => (k === 'cached' ? v && v !== EXPECT : v !== EXPECT)).map(([k, v]) => `${k}=${v || 'none'}`);
    if (bad.length) throw new Error(`the link ?c=${CODE} should open ${EXPECT} but ${bad.join(', ')} (page ${got.page}, session ${got.session}, server ${got.server})`);
    console.log(`?c=${CODE} → ${st.active.name || ''} ${EXPECT.slice(0, 8)}… (page, session and user_profiles agree; now at ${new URL(page.url()).pathname})`);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
