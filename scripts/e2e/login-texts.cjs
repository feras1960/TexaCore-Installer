'use strict';
// Real-browser step of the launch check: the desktop login page (the navy hero + the company panel) shows the owner-approved 27-10 texts and their contrast:
//   · the three feature lines and the tagline say what is true (the data stays on the device; only people given an account and permission reach it; the tunnel is encrypted all the way with no open ports;
//     the AI features send the data they need to the AI provider over an encrypted connection) - and the old overclaims («nobody can access it», «complete secrecy», «combine local data security …») are gone
//   · text on the navy panel is at least white/75; the version line is no longer faint
// It loads the page in Arabic and in English (browser locale) and checks the language that actually rendered.
//   node scripts/e2e/login-texts.cjs --erp <ERP checkout holding node_modules/playwright> --ui http://127.0.0.1:47395 --shots <dir> [--chrome <executable>]
const fs = require('fs');
const path = require('path');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const ERP = arg('erp'); const UI = arg('ui'); const SHOTS = arg('shots'); const CHROME = arg('chrome', '');
const { chromium } = require(path.join(ERP, 'node_modules', 'playwright'));

const TEXTS = {
  rtl: {
    must: ['بياناتك على جهازك، مع قوة الميزات السحابية.', 'ولا يصل إليها إلا من تمنحه حساباً وصلاحية', 'مشفّر طوال الطريق وبلا منافذ مفتوحة', 'مزوّد الذكاء الاصطناعي عبر اتصال مشفّر'],
    mustNot: ['ولا يمكن لأحد الوصول إليها', 'سرية تامة', 'اجمع بين أمان البيانات المحلية'],
  },
  ltr: {
    must: ['Your data on your device, with the power of cloud features.', 'only people you give an account and permission can reach it', 'encrypted all the way, with no open ports', 'sent to the AI provider over an encrypted connection'],
    mustNot: ['Your data is securely stored on your device.', 'Secure access from anywhere via custom subdomain', 'Combine local data security', 'complete secrecy'],
  },
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ ...(CHROME ? { executablePath: CHROME } : { channel: 'chrome' }), headless: true, args: ['--disable-features=MacAppCodeSignClone'] });
  const seen = [];
  try {
    for (const locale of ['ar', 'en-US']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale });
      const page = await ctx.newPage();
      await page.goto(`${UI}/login`, { waitUntil: 'load', timeout: 90000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const info = await page.evaluate(() => {
        const dir = document.documentElement.dir || getComputedStyle(document.body).direction;
        const text = document.body.innerText.replace(/\s+/g, ' ');
        const parse = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
        // every visible element with its own text on the navy side that is WHITE with a transparency below 0.75
        const faint = [];
        for (const el of document.querySelectorAll('body *')) {
          const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(' ');
          if (!own) continue;
          const st = getComputedStyle(el);
          if (st.visibility === 'hidden' || st.display === 'none') continue;
          const c = parse(st.color);
          if (c && c.r === 255 && c.g === 255 && c.b === 255 && c.a < 0.75 * parseFloat(st.opacity || '1')) faint.push(`${own.slice(0, 40)} (alpha ${c.a})`);
        }
        // the version line (bottom end of the white panel): not faint any more
        const ver = document.querySelector('div.absolute.bottom-4');
        const verInfo = ver ? { text: ver.textContent.trim().slice(0, 30), color: getComputedStyle(ver).color, opacity: getComputedStyle(ver).opacity } : null;
        return { dir, text, faint, verInfo };
      });
      const kind = info.dir === 'rtl' ? 'rtl' : 'ltr';
      if (seen.includes(kind)) { await ctx.close(); continue; }
      seen.push(kind);
      await page.screenshot({ path: path.join(SHOTS, `login-texts-${kind}.png`) });
      const spec = TEXTS[kind];
      const missing = spec.must.filter((s) => !info.text.includes(s));
      const present = spec.mustNot.filter((s) => info.text.includes(s));
      if (missing.length) throw new Error(`[${locale}/${kind}] the login page lacks: ${missing.join(' | ')}`);
      if (present.length) throw new Error(`[${locale}/${kind}] the login page still says: ${present.join(' | ')}`);
      if (info.faint.length) throw new Error(`[${locale}/${kind}] text on the navy panel below white/75: ${info.faint.slice(0, 4).join(' | ')}`);
      if (info.verInfo) {
        const m = info.verInfo.color.match(/\d+/g).map(Number);
        const lum = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
        const L = 0.2126 * lum(m[0]) + 0.7152 * lum(m[1]) + 0.0722 * lum(m[2]);
        const ratio = 1.05 / (L + 0.05);
        if (ratio < 4.5 || parseFloat(info.verInfo.opacity) < 1) throw new Error(`[${locale}/${kind}] the version line is faint: ${info.verInfo.color} opacity ${info.verInfo.opacity} (contrast ${ratio.toFixed(2)})`);
      }
      await ctx.close();
    }
    if (!seen.length) throw new Error('no language rendered');
    console.log(`login page texts ok in ${seen.join(' + ')}: the four approved lines are there, no overclaim, navy text >= white/75, version line readable`);
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
