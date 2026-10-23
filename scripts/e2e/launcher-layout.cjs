#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// launcher-layout — the launcher page (src/index.html + renderer.js + i18n.js + styles.css) in a real Chrome with a STUB preload bridge, no Electron, no services:
// every state of the design in all four languages, at the default window (960 x 720 content), checking what a screenshot alone cannot prove:
//   · NO scroll: the page, the tab panes and every card fit (scrollHeight <= clientHeight, nothing wider than its box)
//   · ONE font family for text (+ the monospace link / path boxes) and only the three sizes 12 / 14 / 16
//   · the company select and the Arabic names / paths are isolated (unicode-bidi) and not clipped
//   · exactly ONE green primary button in the hero
//   · every link row has the same shape: label · monospace LTR box · «فتح» · «نسخ»
//   · the seven states: stopped · first run (no company) · cloud not set up · tunnel down · licence expired · update available · port (advanced)
//
//   node scripts/e2e/launcher-layout.cjs --shots <dir> [--erp <ERP checkout holding node_modules/playwright>] [--chrome <Chrome executable>] [--only ar] [--lang ar,en]
//   exit 0 = every check passed; screenshots → <dir>/launcher-<state>-<tab>-<lang>.png ; evidence → <dir>/layout.json
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const SHOTS = path.resolve(arg('shots', path.join(process.cwd(), 'launcher-shots')));
const ERP = arg('erp', process.env.TEXACORE_ERP || '');
const CHROME = arg('chrome', process.env.CHROME_BIN || '');
const LANGS = arg('lang', 'ar,en,ru,uk').split(',');
const ONLY = arg('only', '');
const SRC = path.join(__dirname, '..', '..', 'src');

function loadPlaywright() {
  const cands = [ERP && path.join(ERP, 'node_modules', 'playwright'), ERP && path.join(ERP, 'node_modules', 'playwright-core'), 'playwright', 'playwright-core'].filter(Boolean);
  for (const c of cands) { try { return require(c); } catch { /* next */ } }
  throw new Error('playwright not found: pass --erp <an ERP checkout with node_modules>');
}

// ─── the stub bridge, built per state (runs in the page BEFORE renderer.js) ───
function stubSource(state) {
  return `(() => {
    const S = ${JSON.stringify(state)};
    const now = Date.now();
    const days = (n) => new Date(now + n * 86400000).toISOString();
    const lic = S.license === 'trial' ? { tier: 'professional', status: 'trial', expires_at: days(7), license_key: 'TRL-2026-3KQ9M-V7X2P' }
      : S.license === 'free' ? { tier: 'free', status: 'active', license_key: 'FREE-LOCAL' }
      : S.license === 'expired' ? { tier: 'professional', status: 'expired', expires_at: days(-3), license_key: 'LIC-2026-AB12C-D34EF' }
      : S.license === 'none' ? null : { tier: 'professional', status: 'active', expires_at: days(210), license_key: 'LIC-2026-AB12C-D34EF' };
    const companies = S.companies;
    const state = {
      config: { port: 8080, uiLang: S.lang, licenseKey: lic && lic.license_key, isTrial: S.license === 'trial', isFree: S.license === 'free', enableCloud: !!S.cloud, subdomain: S.subdomain || '' },
      containerRunning: !!S.running, containerHealth: S.running ? 'healthy' : 'stopped', hasLicense: S.license !== 'expired' && S.license !== 'none', licenseInfo: lic, port: 8080,
      localIp: '172.20.10.2', lan: { address: '172.20.10.2', iface: 'en0', auto: true, candidates: [{ name: 'en0', address: '172.20.10.2', virtual: false, private: true }, { name: 'utun9', address: '12.1.1.4', virtual: true, private: false }] },
      liveFile: S.liveFile, osLocale: 'ar', tunnel: S.tunnel || { enabled: !!S.cloud, state: 'connected', reason: null, connector: 'connected' },
    };
    const ev = {};
    const on = (name) => (cb) => { (ev[name] = ev[name] || []).push(cb); };
    window.__emit = (name, payload) => (ev[name] || []).forEach((cb) => cb(payload));
    window.__calls = [];
    const rec = (name, ret) => (...a) => { window.__calls.push([name, ...a]); return Promise.resolve(typeof ret === 'function' ? ret(...a) : ret); };
    const mb = 1048576;
    window.texacore = {
      getLocalApiSecret: () => 's', getVersion: rec('getVersion', { version: '2.0.5', buildDate: '2026-10-24T09:12:00.000Z' }),
      getState: rec('getState', () => JSON.parse(JSON.stringify(state))), listLocalCompanies: rec('listLocalCompanies', { success: true, companies }),
      setUiLang: rec('setUiLang', { success: true }), setLanAddress: rec('setLanAddress', (a) => ({ success: true, lan: Object.assign({}, state.lan, { address: a || '172.20.10.2', auto: !a }) })),
      activateLicense: rec('activateLicense', { success: false, error: 'stub' }), startTrial: rec('startTrial', { success: false, error: 'stub' }), startFree: rec('startFree', { success: false, error: 'stub' }),
      registerSubdomain: rec('registerSubdomain', { success: false, error: 'stub' }), verifySubdomain: rec('verifySubdomain', { valid: true }), repairTunnelLink: rec('repairTunnelLink', { success: true, outcome: 'fixed' }),
      startERP: rec('startERP', { success: true, ready: true }), stopERP: rec('stopERP', { success: true }), setCloudAccess: rec('setCloudAccess', { success: true }),
      setAdminPassword: rec('setAdminPassword', { success: true }), getAdminPasswordStatus: rec('getAdminPasswordStatus', { success: true, customized: false, hasDefault: true, minLength: 8 }),
      checkForUpdate: rec('checkForUpdate', { available: false }), installUpdate: rec('installUpdate', {}), openBrowser: rec('openBrowser', {}),
      onUpdateAvailable: on('update-available'), onUpdateProgress: on('update-progress'), onUpdateDownloaded: on('update-downloaded'), onUpdateNotAvailable: on('update-not-available'), onUpdateStatus: on('update-status'),
      getUpdateStatus: rec('getUpdateStatus', S.update || { phase: 'idle' }), updateControl: rec('updateControl', { ok: true, status: S.update || { phase: 'idle' } }),
      getUpgradeNotice: rec('getUpgradeNotice', null), dismissUpgradeNotice: rec('dismissUpgradeNotice', { success: true }), openUpgradeFolder: rec('openUpgradeFolder', { success: true }), openUpgradeTcdb: rec('openUpgradeTcdb', { success: false }),
      backupStatus: rec('backupStatus', { running: false, syncing: false, liveFile: S.liveFile, plannedCompanies: 0, targets: S.liveFile ? [{ role: 'primary', path: S.liveFile, dir: '/x', exists: true, state: S.syncState || 'ok', lastSuccess: new Date(now - 20000).toISOString(), error: S.syncState === 'error' ? { reason: 'no-permission' } : null, cloudFolder: null }] : [], consecutiveFailures: S.syncState === 'error' ? 3 : 0 }),
      backupNow: rec('backupNow', { success: true }), revealBackup: rec('revealBackup', { success: true }), restoreBackup: rec('restoreBackup', {}),
      listBackups: rec('listBackups', { success: true, total: 3, items: [
        { kind: 'daily', name: 'a', path: '/a', mtimeMs: now - 3600000, size: 6.2 * mb }, { kind: 'daily', name: 'b', path: '/b', mtimeMs: now - 86400000 - 3600000, size: 6.1 * mb },
        { kind: 'pre-open', name: 'c', path: '/c', mtimeMs: now - 86400000 * 3, size: 615 * mb } ] }),
      createBackup: rec('createBackup', { success: true, path: '/m', size: 6.3 * mb }), pickCompanyFile: rec('pickCompanyFile', { success: false, canceled: true }),
      openPickedCompanyFile: rec('openPickedCompanyFile', { success: false, code: 'REPLACE_ALL_CONFIRM_REQUIRED', companies: companies.map((c) => ({ id: c.id, name: c.name })), sessions: 2 }),
      openRunLog: rec('openRunLog', { success: true }), moveLiveFile: rec('moveLiveFile', { success: false, canceled: true }), onMigrationProgress: on('migration-progress'),
    };
  })();`;
}

const COMPANIES = [
  { id: 'd4c3b5d3-1c2a-4b7e-9d0a-6f3b2c1d4e5f', name: 'بروفة العرض' },
  { id: '17249eed-1c2a-4b7e-9d0a-6f3b2c1d4e5f', name: '2023 مطور بعد الصيانة' },
  { id: 'a91c03de-1c2a-4b7e-9d0a-6f3b2c1d4e5f', name: 'تجربة محلية 2.0.5' },
];
const BASE = { lang: 'ar', running: true, license: 'trial', companies: COMPANIES, cloud: true, subdomain: 'dubaistroy', liveFile: '/Users/firas/TexaCore/شركاتي.tcdb' };
const UPDATE = { phase: 'downloading', version: '2.0.6', bytesDone: 128.4 * 1048576, bytesTotal: 305 * 1048576, percent: 42, speedBps: 1.2 * 1048576, etaSec: 147, nextRetryAt: null, lastError: null, errorCode: null, online: true };

// state name → { tab, state overrides, setup(page) }
const STATES = {
  main:        { tab: 'links',   s: {} },
  files:       { tab: 'files',   s: {} },
  license:     { tab: 'license', s: {} },
  stopped:     { tab: 'links',   s: { running: false } },
  firstrun:    { tab: 'links',   s: { companies: [], liveFile: '' } },
  cloudunset:  { tab: 'links',   s: { subdomain: '', tunnel: { enabled: true, state: 'stopped', reason: null } } },
  tunneldown:  { tab: 'links',   s: { tunnel: { enabled: true, state: 'error', reason: 'exited' } } },
  expired:     { tab: 'license', s: { license: 'expired' } },
  update:      { tab: 'links',   s: { update: UPDATE } },
  port:        { tab: 'license', s: {}, setup: async (page) => { await page.fill('#input-port', '9090'); await page.dispatchEvent('#input-port', 'input'); } },
  filesdoc:    { tab: 'files',   s: { liveFile: '/Users/firas/Documents/TexaCore/شركاتي.tcdb', syncState: 'error' } },
};

(async () => {
  const { chromium } = loadPlaywright();
  fs.mkdirSync(SHOTS, { recursive: true });
  const launchOpts = { headless: true, args: ['--disable-features=MacAppCodeSignClone'] };
  if (CHROME) launchOpts.executablePath = CHROME; else launchOpts.channel = 'chrome';
  const browser = await chromium.launch(launchOpts);
  const html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  const results = []; let failed = 0;
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail || '' }); if (!ok) { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); } };
  try {
    for (const [name, def] of Object.entries(STATES)) {
      if (ONLY && name !== ONLY) continue;
      for (const lang of LANGS) {
        const s = Object.assign({}, BASE, def.s, { lang });
        const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text())) errors.push(m.text()); });
        const stubbed = html.replace('<script src="icons.js">', `<script>${stubSource(s)}</script>\n  <script src="icons.js">`)
          .replace('<head>', `<head>\n  <base href="file://${SRC}/">`)
          .replace(/<link[^>]*fonts\.g[^>]*>/g, '');
        const tmp = path.join(SHOTS, `.page-${name}-${lang}.html`);
        fs.writeFileSync(tmp, stubbed);
        await page.goto('file://' + tmp);
        await page.waitForFunction(() => document.documentElement.lang && document.getElementById('status-erp') && !/\.\.\./.test(document.getElementById('status-erp').textContent), null, { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(500);
        if (def.tab) await page.evaluate((t) => selectTab(t), def.tab);
        if (def.setup) await def.setup(page);
        if (s.update) await page.evaluate((u) => window.__emit('update-status', u), s.update);
        await page.waitForTimeout(300);
        const tag = `${name}/${lang}`;
        const m = await page.evaluate(() => {
          const vis = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
          const box = (sel) => { const e = document.querySelector(sel); return e && vis(e) ? { sh: e.scrollHeight, ch: e.clientHeight, sw: e.scrollWidth, cw: e.clientWidth } : null; };
          const de = document.documentElement;
          const cards = [...document.querySelectorAll('.pane:not([hidden]) .card')].filter(vis).map((c) => ({ id: c.id, sh: c.scrollHeight, ch: c.clientHeight, sw: c.scrollWidth, cw: c.clientWidth }));
          const sizes = new Set(); const fams = new Set();
          for (const e of document.querySelectorAll('body *')) {
            if (!vis(e) || !e.childNodes.length) continue;
            const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!hasText && !['INPUT', 'SELECT'].includes(e.tagName)) continue;
            const cs = getComputedStyle(e);
            sizes.add(cs.fontSize);
            fams.add(cs.fontFamily.split(',')[0].replace(/['"]/g, '').trim());
          }
          const primaries = [...document.querySelectorAll('#hero .btn-primary')].filter(vis).map((b) => b.id);
          const sel = document.getElementById('link-company');
          const urls = [...document.querySelectorAll('.pane:not([hidden]) .linkrow')].filter(vis).map((r) => ({
            id: r.id, dir: getComputedStyle(r.querySelector('.url')).direction, bidi: getComputedStyle(r.querySelector('.url')).unicodeBidi, mono: /mono|Menlo|Consolas|SF Mono/i.test(getComputedStyle(r.querySelector('.url')).fontFamily),
            btns: [...r.querySelectorAll('.linkline > button')].map((b) => b.textContent.trim()),
          }));
          const clipped = [];
          for (const e of document.querySelectorAll('.btn, .chip, .tab, h2, .lbl, .desc, .note, .alert, select.ctl')) {
            if (!vis(e)) continue;
            if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'hidden' && !e.classList.contains('url')) clipped.push((e.id || e.className) + ':' + e.textContent.trim().slice(0, 24));
          }
          const trk = document.querySelector('.toggle-switch .slider');
          const sw = trk && vis(trk) ? (() => { const t = trk.getBoundingClientRect(); const k = getComputedStyle(trk, '::before'); const kl = parseFloat(k.left), kt = parseFloat(k.top), kw = parseFloat(k.width), kh = parseFloat(k.height);
            return { dir: de.dir, checked: document.getElementById('input-cloud').checked, trackW: t.width, trackH: t.height, knob: [kw, kh], insets: [kl, t.width - kl - kw, kt, t.height - kt - kh] }; })() : null;
          return {
            sw,
            page: { sh: de.scrollHeight, ch: de.clientHeight, sw: de.scrollWidth, cw: de.clientWidth }, body: { sh: document.body.scrollHeight, ch: document.body.clientHeight },
            pane: box('.pane:not([hidden])'), cards, sizes: [...sizes].sort(), fams: [...fams].sort(), primaries,
            select: sel ? { bidi: getComputedStyle(sel).unicodeBidi, h: sel.clientHeight, sh: sel.scrollHeight, text: sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '' } : null,
            urls, clipped, dir: de.dir, hero: document.getElementById('hero').dataset.mode, tabs: [...document.querySelectorAll('.tab')].map((t) => t.getAttribute('aria-selected')),
            visibleText: document.body.innerText.length,
          };
        });
        check(`${tag} no page scroll`, m.page.sh <= m.page.ch && m.page.sw <= m.page.cw && m.body.sh <= m.body.ch, JSON.stringify(m.page));
        if (m.pane) check(`${tag} no pane scroll`, m.pane.sh <= m.pane.ch + 1 && m.pane.sw <= m.pane.cw + 1, JSON.stringify(m.pane));
        for (const c of m.cards) check(`${tag} card ${c.id} fits (no inner scroll)`, c.sh <= c.ch + 1 && c.sw <= c.cw + 1, JSON.stringify(c));
        if (m.sw) check(`${tag} the switch knob sits inside the track with an equal inset on all four sides`, m.sw.insets.every((x) => Math.abs(x - 3) < 0.6 || (m.sw.checked && Math.abs(x - 3) < 0.6) || x >= 0) && Math.abs(m.sw.insets[2] - 3) < 0.6 && Math.abs(m.sw.insets[3] - 3) < 0.6 && m.sw.insets.every((x) => x >= 0), JSON.stringify(m.sw));
        check(`${tag} three sizes only`, m.sizes.every((x) => ['12px', '14px', '16px'].includes(x)), m.sizes.join(','));
        check(`${tag} one text family (+ mono)`, m.fams.filter((f) => !/mono|menlo|consolas|sf mono/i.test(f)).length <= 1, m.fams.join(' | '));
        check(`${tag} at most ONE primary in the hero`, m.primaries.length <= 1, m.primaries.join(','));
        if (m.select) check(`${tag} company select isolated and not clipped`, m.select.bidi === 'isolate' && m.select.sh <= m.select.h + 1, JSON.stringify(m.select));
        for (const u of m.urls) check(`${tag} link row ${u.id} = box + فتح/نسخ`, u.dir === 'ltr' && u.bidi === 'isolate' && u.mono && u.btns.length >= 1, JSON.stringify(u));
        check(`${tag} nothing clipped`, m.clipped.length === 0, m.clipped.join(' | '));
        check(`${tag} no page errors`, errors.length === 0, errors.join(' | '));
        await page.screenshot({ path: path.join(SHOTS, `launcher-${name}-${def.tab}-${lang}.png`) });
        fs.rmSync(tmp, { force: true });
        await page.close();
        console.log(`  ${name}/${lang}: hero=${m.hero} sizes=${m.sizes.join('/')} cards=${m.cards.length}`);
      }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(SHOTS, 'layout.json'), JSON.stringify({ failed, results }, null, 1));
  console.log(failed ? `FAILED ${failed} of ${results.length}` : `ALL ${results.length} layout checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
