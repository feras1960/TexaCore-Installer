#!/usr/bin/env node
'use strict';
// ════════════════════════════════════════════════════════════════
// ui-shots — the launcher window of the PACKAGED app, driven through its real renderer (isolated harness run: its own userData + port block; the
// window is hidden and captured with capturePage), in Arabic (RTL) and English (LTR):
//
//   U1  the Cloud Access switch: OFF = grey track, knob at the inline-start; ON (a real click on the real control) = green track, knob at the
//       inline-end; the knob stays INSIDE the track with an equal 3px inset on all four sides in both states and both directions
//       (RTL: ON = knob on the left, LTR: ON = knob on the right); role="switch" with a matching aria-checked; the whole switch is the hit area
//   U2  copy buttons next to the cloud link and the local (LAN) link: one click puts exactly the displayed link on the clipboard (the page's clipboard is
//       replaced by a recorder, so the owner's real clipboard is never touched) and the button says so
//   U3  the stop button only ASKS, inside the window (no native dialog): nothing stops until «yes»; Cancel and Esc withdraw the question
//   U4  «yes» stops the services
//   U7  the connection status is HONEST: «connected» only for a connector that registered; starting / off / each error reason (binary missing, token invalid / refused …) is worded as such, in ar and en
//   U8  the admin-portal password UI states the REAL policy (8+ characters, from the main process): placeholder and messages say 8, 7 characters are refused in the window, «admin» and licence-key-like values
//       are refused with their own message, a good password is accepted and the SERVER then verifies it (a free licence has no default password)
//   U9  the licence panel, every kind of status line and the subdomain checker draw SVG icons; the whole page has no emoji and every icon points at a defined symbol
//   U11 licence row: FREE says «never expires» (no date, no 0 days); a trial shows its real end date and the days left
//   U12 the update progress widget (resumable download): every state — downloading with MB / speed / time left, waiting to retry (countdown + reason + what is kept), offline, paused (Resume), no disk space,
//       verifying, staging, failed-verify, ready — in Arabic RTL and English LTR (+ Russian / Ukrainian checked for overflow): right text, right icon, Pause / Resume and «Retry now» exactly where they belong, no overflow
//   U10 starting again: the start button's busy icon, then the running state
//   U5  the one-time upgrade notice (the run starts over a 1.x data folder): shown with the old folder and the old company file, in Arabic RTL and English LTR; «فتح المجلد» asks the OS to open exactly that folder;
//       the «فتح» button beside a 1.x company file is refused with the translated message; «إغلاق» dismisses it for good (still gone after a reload and after the files are re-read)
//
//   node scripts/e2e/ui-shots.js --workdir <empty dir> --app <packaged .app> [--tcdb <a .tcdb written by 1.x>]
//   screenshots → <workdir>/shots/ui-<lang>-*.png   evidence → <workdir>/results.json
// ════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { PORTS, Results, portFree, request, startApp, stopApp } = require('./lib');

const arg = (n, d = '') => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const WORK = path.resolve(arg('workdir', ''));
const APP = arg('app', '');
const TCDB = arg('tcdb', '');
if (!arg('workdir')) { console.error('--workdir <dir> is required'); process.exit(2); }
const binary = APP ? path.join(path.resolve(APP), 'Contents', 'MacOS', path.basename(path.resolve(APP), '.app')) : '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const R = new Results();
  fs.rmSync(WORK, { recursive: true, force: true });
  const shots = path.join(WORK, 'shots'); fs.mkdirSync(shots, { recursive: true });
  for (const p of Object.values(PORTS)) if (!(await portFree(p))) { console.error(`port ${p} busy`); process.exit(2); }
  const userData = path.join(WORK, 'userdata');
  // the run starts over a 1.x data folder (PostgreSQL 15 cluster marker + a config naming one company file), so the upgrade notice exists
  const dd = path.join(userData, 'texacore-data');
  const userFiles = path.join(WORK, 'user-files'); fs.mkdirSync(userFiles, { recursive: true });
  const companyFile = path.join(userFiles, 'old18.tcdb');
  if (TCDB) fs.copyFileSync(path.resolve(TCDB), companyFile); else fs.writeFileSync(companyFile, 'not a real company file');
  fs.mkdirSync(path.join(dd, 'pgdata'), { recursive: true }); fs.writeFileSync(path.join(dd, 'pgdata', 'PG_VERSION'), '15\n');
  fs.writeFileSync(path.join(dd, 'config.json'), JSON.stringify({ licenseKey: 'FREE-LOCAL', isFree: true, companies: [{ name: 'شركة الاختبار القديمة', tcdbPath: companyFile }] }));
  const { child, ready } = startApp({ userData, logFile: path.join(WORK, 'app.log'), appBinary: binary, extraEnv: { TEXACORE_UI_SMOKE: '1', TEXACORE_SHOT_DIR: shots, TEXACORE_STUB_SHELL: '1' } });
  child.on('error', () => {});
  const evidence = {};
  try {
    await ready;
    const secrets = JSON.parse(fs.readFileSync(path.join(userData, 'texacore-data', 'secrets.json'), 'utf8'));
    const H = { 'x-texacore-local-secret': secrets.localApiSecret };
    const ev = async (body) => {
      const r = await request('POST', `http://127.0.0.1:${PORTS.admin}/api/ui-eval`, { headers: H, body });
      if (!r.json || !r.json.ok) throw new Error(`ui-eval: ${r.text.slice(0, 300)}`);
      return r.json;
    };
    const js = async (code) => (await ev({ js: code })).result;
    await ev({ size: [900, 1500] });                       // tall enough to show the whole control panel in one frame
    await sleep(1500);

    // what the page can measure about the switch: track box, knob box (the knob is the track's ::before), direction, state
    const MEASURE = `(() => { const i = document.getElementById('input-cloud'), tr = document.querySelector('.toggle-switch .slider'), sw = document.querySelector('.toggle-switch');
      const t = tr.getBoundingClientRect(), s = sw.getBoundingClientRect(), k = getComputedStyle(tr, '::before'), kl = parseFloat(k.left), kt = parseFloat(k.top), kw = parseFloat(k.width), kh = parseFloat(k.height);
      return { dir: document.documentElement.dir, checked: i.checked, ariaChecked: i.getAttribute('aria-checked'), role: i.getAttribute('role'), trackW: t.width, trackH: t.height,
        insetLeft: kl, insetRight: t.width - kl - kw, insetTop: kt, insetBottom: t.height - kt - kh, knob: [kw, kh], trackBg: getComputedStyle(tr).backgroundColor, knobBg: k.backgroundColor,
        inputCoversSwitch: (() => { const r = i.getBoundingClientRect(); return Math.abs(r.width - s.width) < 1 && Math.abs(r.height - s.height) < 1; })(),
        pointerOnSwitch: getComputedStyle(sw).cursor }; })()`;
    const near = (a, b) => Math.abs(a - b) < 0.6;

    // U12 helpers: push a synthetic updater status through the REAL path (shared status → IPC → the window) and read what the widget shows
    const emitUpd = async (payload, channel = 'update-status') => { const r = await request('POST', `http://127.0.0.1:${PORTS.admin}/api/ui-update-emit`, { headers: H, body: { channel, payload } }); if (!r.json || !r.json.ok) throw new Error(`ui-update-emit ${r.text.slice(0, 160)}`); return r.json; };
    const WIDGET_STATE = `(() => { const g = (id) => document.getElementById(id); const w = g('update-widget');
      const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
      const href = (el) => { const u = el && el.querySelector('use'); return u ? u.getAttribute('href') : ''; };
      return { shown: vis(w), cls: w.className, text: g('update-text').textContent, mb: g('update-mb').textContent, detail: g('update-detail').textContent, bar: g('update-progress-bar').style.width, barVisible: vis(g('update-progress-wrap')),
        pause: vis(g('update-pause-btn')) ? g('update-pause-btn').textContent.trim() : null, pauseIcon: href(g('update-pause-btn')), retry: vis(g('update-retry-btn')) ? g('update-retry-btn').textContent.trim() : null, restart: vis(g('update-restart-btn')), later: vis(g('update-later-btn')),
        icon: href(g('update-icon')), spin: !!g('update-icon').querySelector('.spin'), overflowX: w.scrollWidth > w.clientWidth + 1, dir: document.documentElement.dir, lang: document.documentElement.lang, width: Math.round(w.getBoundingClientRect().width) }; })()`;
    const base = (extra) => ({ version: '2.0.2', paused: false, bytesTotal: 305 * 1048576, bytesDone: 128.4 * 1048576, percent: 42, speedBps: 1.2 * 1048576, etaSec: 147, nextRetryAt: null, lastError: null, errorCode: null, needBytes: null, freeBytes: null, online: true, ...extra });
    const UPD_STATES = [
      { name: 'downloading', snap: () => base({ phase: 'downloading' }), want: (w, tr) => w.cls === 'update-widget' && w.icon === '#i-download' && w.bar === '42%' && w.barVisible && w.pause === tr.pause && w.pauseIcon === '#i-pause' && w.retry === null && /1\.2/.test(w.detail) && /2:27/.test(w.detail) && /128\.4/.test(w.mb) && /42%/.test(w.mb) },
      { name: 'waiting-retry', snap: () => base({ phase: 'waiting-retry', bytesDone: 275.3 * 1048576, percent: 90, speedBps: 0, etaSec: null, errorCode: 'network', lastError: 'aborted', nextRetryAt: Date.now() + 42000 }), want: (w, tr) => w.cls.includes('warn') && w.icon === '#i-clock' && /4[12]/.test(w.text) && w.pause === tr.pause && w.retry === tr.retry && /aborted/.test(w.detail) && /275\.3/.test(w.detail) && w.bar === '90%' },
      { name: 'offline', snap: () => base({ phase: 'waiting-retry', bytesDone: 275.3 * 1048576, percent: 90, speedBps: 0, etaSec: null, errorCode: 'offline', lastError: 'getaddrinfo ENOTFOUND github.com', nextRetryAt: Date.now() + 120000, online: false }), want: (w, tr) => w.cls.includes('warn') && w.icon === '#i-wifi-off' && w.text === tr.offline && w.retry === tr.retry },
      { name: 'paused', snap: () => base({ phase: 'paused', paused: true, speedBps: 0, etaSec: null }), want: (w, tr) => w.cls.includes('paused') && w.icon === '#i-pause' && w.pause === tr.resume && w.pauseIcon === '#i-play' && w.retry === null && /128\.4/.test(w.mb) && w.detail === tr.pausedNote },
      { name: 'no-space', snap: () => base({ phase: 'waiting-retry', speedBps: 0, etaSec: null, errorCode: 'no-space', lastError: 'not enough free disk space', needBytes: 915 * 1048576, freeBytes: 400 * 1048576, nextRetryAt: Date.now() + 60000 }), want: (w, tr) => w.cls.includes('warn') && w.icon === '#i-hard-drive' && /915\.0/.test(w.detail) && /400\.0/.test(w.detail) && w.retry === tr.retry },
      { name: 'verifying', snap: () => base({ phase: 'verifying', bytesDone: 305 * 1048576, percent: 100, speedBps: 0, etaSec: null }), want: (w) => w.icon === '#i-shield-check' && w.pause === null && w.retry === null && w.bar === '100%' },
      { name: 'staging', snap: () => base({ phase: 'staging', bytesDone: 305 * 1048576, percent: 100, speedBps: 0, etaSec: null }), want: (w) => w.icon === '#i-loader' && w.spin && w.pause === null && w.retry === null },
      { name: 'failed-verify', snap: () => base({ phase: 'failed-verify', bytesDone: 0, percent: 0, speedBps: 0, etaSec: null, errorCode: 'verify', lastError: 'sha512 mismatch', nextRetryAt: Date.now() + 3600000 }), want: (w, tr) => w.cls.includes('warn') && w.icon === '#i-triangle-alert' && w.retry === tr.retry && w.pause === null },
      { name: 'ready', snap: () => base({ phase: 'ready', percent: 100, speedBps: 0, etaSec: null }), want: (w) => w.cls.includes('ready') && w.icon === '#i-circle-check' && w.restart && w.later && !w.barVisible && w.pause === null && w.retry === null },
    ];

    for (const lang of ['ar', 'en']) {
      await js(`(() => { const s = document.getElementById('lang-select'); s.value = '${lang}'; onLangChange(); document.getElementById('input-cloud').blur(); window.scrollTo(0, 0); })()`);
      await sleep(600);

      await R.check(`U1 [${lang}] the Cloud Access switch: OFF grey with the knob at the inline-start, ON green with the knob at the inline-end, always inside the track with equal insets`, async () => {
        // make sure it starts OFF (a real click would be needed otherwise)
        const off = await js(MEASURE);
        if (off.checked) throw new Error('the switch started ON');
        await js(`document.getElementById('cloud-box').scrollIntoView({ block: 'center' })`);
        await ev({ shot: `ui-${lang}-switch-off.png`, wait: 200 });
        // a REAL click on the real control — the same path as a user's press (it also runs toggleCloudView → setCloudAccess)
        await js(`document.querySelector('.toggle-switch').click()`);
        await sleep(900);                                                       // the .25s transition is over
        const on = await js(MEASURE);
        await ev({ shot: `ui-${lang}-switch-on.png`, wait: 200 });
        const rtl = lang === 'ar';
        if (off.role !== 'switch' || off.ariaChecked !== 'false' || on.ariaChecked !== 'true' || !on.checked) throw new Error(`aria: ${JSON.stringify({ off: off.ariaChecked, on: on.ariaChecked, role: off.role })}`);
        for (const [name, m] of [['OFF', off], ['ON', on]]) {
          const all = [m.insetLeft, m.insetRight, m.insetTop, m.insetBottom];
          if (m.insetLeft < 0 || m.insetRight < 0 || m.insetTop < 0 || m.insetBottom < 0) throw new Error(`${name}: the knob sticks out of the track (${all.join(', ')})`);
          if (!near(m.insetTop, 3) || !near(m.insetBottom, 3)) throw new Error(`${name}: vertical inset ${m.insetTop}/${m.insetBottom} is not 3`);
          const startSide = rtl ? m.insetRight : m.insetLeft, endSide = rtl ? m.insetLeft : m.insetRight;
          const want = name === 'OFF' ? [3, m.trackW - 3 - m.knob[0]] : [m.trackW - 3 - m.knob[0], 3];
          if (!near(startSide, want[0]) || !near(endSide, want[1])) throw new Error(`${name}: knob on the wrong side for ${m.dir}: inline-start gap ${startSide}, inline-end gap ${endSide}`);
        }
        if (on.trackBg === off.trackBg) throw new Error('the track colour did not change');
        if (!off.inputCoversSwitch) throw new Error('the hit area is smaller than the switch');
        evidence[`switch_${lang}`] = { off, on };
        // back to OFF (a real click again) so the next language starts from the same state
        await js(`document.querySelector('.toggle-switch').click()`); await sleep(600);
        const back = await js(MEASURE);
        if (back.checked || back.ariaChecked !== 'false') throw new Error('the second click did not switch it OFF');
        return `${m(off)} | ON: ${m(on)}`;
        function m(x) { return `${x.checked ? 'ON' : 'OFF'} track ${x.trackW}×${x.trackH} bg ${x.trackBg}, knob ${x.knob[0]}px, gaps L${x.insetLeft}/R${x.insetRight}/T${x.insetTop}/B${x.insetBottom} (${x.dir}), aria-checked=${x.ariaChecked}`; }
      });

      await R.check(`U2 [${lang}] the copy buttons beside the cloud address, the office employee link and the cloud employee link copy exactly what is shown (each link appears once)`, async () => {
        // display-only sample state (no cloud account exists in this isolated run): a subdomain, a LAN address and one company, through the renderer's own updateUI / renderLinks
        await js(`(() => { window.__copied = []; navigator.clipboard.writeText = (x) => { window.__copied.push(x); return Promise.resolve(); };
          _empCompanies = [{ id: '6b6e4674-1c2a-4b7e-9d0a-6f3b2c1d4e5f', name: 'Acme' }]; _empListed = true; _chosenCompanyId = '';
          updateUI(Object.assign({}, currentState, { config: Object.assign({}, currentState.config, { enableCloud: true, subdomain: 'acme-demo', port: 80 }), localIp: '192.168.1.20' }));
          document.getElementById('cloud-url').scrollIntoView({ block: 'center' }); })()`);
        await sleep(500);
        await ev({ shot: `ui-${lang}-copy-buttons.png`, wait: 200 });
        const shown = await js(`({ cloud: document.getElementById('cloud-url').textContent.trim(), lan: document.getElementById('lan-employee-url').textContent.trim(), emp: document.getElementById('employee-url').textContent.trim(),
          cloudBtn: document.getElementById('copy-cloud-url').textContent, local: document.getElementById('local-url') ? 'still there' : null })`);
        await js(`document.getElementById('copy-cloud-url').click()`); await sleep(300);
        const afterCloud = await js(`({ copied: window.__copied.slice(), btn: document.getElementById('copy-cloud-url').textContent })`);
        await ev({ shot: `ui-${lang}-copy-clicked.png`, wait: 100 });
        await js(`document.getElementById('copy-lan-employee-url').click()`); await sleep(300);
        await js(`document.getElementById('copy-employee-url').click()`); await sleep(300);
        const afterAll = await js(`window.__copied.slice()`);
        if (shown.cloud !== 'https://acme-demo.texacore.ai' || shown.lan !== 'http://192.168.1.20/login?c=6b6e4674' || shown.emp !== 'https://acme-demo.texacore.ai/login?c=6b6e4674' || shown.local) throw new Error(`links shown: ${JSON.stringify(shown)}`);
        if (afterAll[0] !== shown.cloud || afterAll[1] !== shown.lan || afterAll[2] !== shown.emp) throw new Error(`copied: ${JSON.stringify(afterAll)}`);
        if (afterCloud.btn === shown.cloudBtn) throw new Error('the button did not acknowledge the copy');
        evidence[`copy_${lang}`] = { shown, afterCloud, afterAll };
        await js(`updateUI(Object.assign({}, currentState, { config: Object.assign({}, currentState.config, { enableCloud: false }) }))`);
        return `cloud ${shown.cloud}, office ${shown.lan}, anywhere ${shown.emp} → each copied; button label «${shown.cloudBtn}» → «${afterCloud.btn}»`;
      });

      await R.check(`U3 [${lang}] the red stop button only ASKS, inside the window; Cancel and Esc withdraw it; nothing is stopped`, async () => {
        await js(`window.scrollTo(0, 0)`); await sleep(300);
        const before = await js(`texacore.getState().then((s) => ({ running: !!s.containerRunning, stopVisible: getComputedStyle(document.getElementById('btn-stop')).display !== 'none' }))`);
        if (!before.running || !before.stopVisible) throw new Error(`precondition: ${JSON.stringify(before)}`);
        await js(`document.getElementById('btn-stop').click()`); await sleep(500);
        const asked = await js(`({ box: getComputedStyle(document.getElementById('stop-confirm')).display, text: document.getElementById('stop-confirm-text').textContent, yes: document.getElementById('btn-stop-confirm').textContent,
          cancel: document.getElementById('btn-stop-cancel').textContent, focus: document.activeElement && document.activeElement.id, role: document.getElementById('stop-confirm').getAttribute('role') })`);
        await js(`document.getElementById('stop-confirm').scrollIntoView({ block: 'center' })`);
        await ev({ shot: `ui-${lang}-stop-confirm.png`, wait: 300 });
        await sleep(1500);
        const still = await js(`texacore.getState().then((s) => !!s.containerRunning)`);
        if (asked.box !== 'block' || !still) throw new Error(`asked ${JSON.stringify(asked)}; still running: ${still}`);
        if (asked.focus !== 'btn-stop-cancel') throw new Error(`focus is on ${asked.focus}, not on Cancel`);
        await js(`document.getElementById('btn-stop-cancel').click()`); await sleep(300);
        const afterCancel = await js(`getComputedStyle(document.getElementById('stop-confirm')).display`);
        await js(`document.getElementById('btn-stop').click()`); await sleep(300);
        await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(300);
        const afterEsc = await js(`getComputedStyle(document.getElementById('stop-confirm')).display`);
        if (afterCancel !== 'none' || afterEsc !== 'none') throw new Error(`cancel → ${afterCancel}, Esc → ${afterEsc}`);
        const stillAfter = await js(`texacore.getState().then((s) => !!s.containerRunning)`);
        if (!stillAfter) throw new Error('the system stopped without a «yes»');
        evidence[`stop_${lang}`] = asked;
        return `question shown in the window («${asked.yes}» / «${asked.cancel}», focus on Cancel), system still running; Cancel → hidden; Esc → hidden; text: "${asked.text.slice(0, 90)}…"`;
      });

      await R.check(`U5 [${lang}] the one-time upgrade notice: shown with the old folder and the old company file; «فتح المجلد» opens exactly that folder; «فتح» on a 1.x file is refused with the translated message`, async () => {
        await js(`window.scrollTo(0, 0)`); await sleep(400);
        const w = await js(`({ shown: getComputedStyle(document.getElementById('upgrade-notice')).display !== 'none', dir: document.documentElement.dir, title: document.getElementById('upgrade-notice-title').textContent,
          a: document.getElementById('upgrade-line-a').textContent, folder: document.getElementById('upgrade-folder').textContent, b: document.getElementById('upgrade-line-b').textContent,
          files: [...document.querySelectorAll('#upgrade-file-list .upgrade-file-name')].map((e) => e.textContent), buttons: [...document.querySelectorAll('#upgrade-notice button')].map((e) => e.textContent.trim()) })`);
        if (!w.shown || !w.folder || w.files.length !== 1) throw new Error(`notice: ${JSON.stringify(w)}`);
        if (!/texacore-data\.v18-backup-/.test(w.folder)) throw new Error(`folder shown: ${w.folder}`);
        if (!w.a.includes('v' + require('../../package.json').version)) throw new Error(`first line lacks the version: ${w.a}`);
        await ev({ shot: `ui-${lang}-upgrade-notice.png`, wait: 300 });
        // the folder button — recorded, not opened, in an isolated run
        await js(`document.getElementById('upgrade-open-folder').click()`); await sleep(800);
        const logText = fs.readFileSync(path.join(WORK, 'app.log'), 'utf8');
        if (!logText.includes(`[Shell] would open the folder: ${w.folder}`)) throw new Error('the folder button did not ask for the notice\'s folder');
        // the file button
        await js(`document.querySelector('#upgrade-file-list button').click()`); await sleep(TCDB ? 4000 : 2500);
        const st = await js(`({ text: document.getElementById('upgrade-status').textContent, cls: document.getElementById('upgrade-status').className })`);
        await ev({ shot: `ui-${lang}-upgrade-notice-open-file.png`, wait: 200 });
        if (!/err/.test(st.cls) || !st.text) throw new Error(`file button result: ${JSON.stringify(st)}`);
        evidence[`notice_${lang}`] = { ...w, status: st };
        return `${w.dir}: "${w.a}" + ${w.folder.slice(-44)} ; "${w.b.slice(0, 60)}…" ; file «${w.files[0]}» ; folder button → the OS was asked for that folder ; file button → "${st.text.slice(0, 110)}"`;
      });

      await R.check(`U7 [${lang}] the connection status is honest: connected / starting / off / each error reason is worded as such — «connected» only for a connector that registered`, async () => {
        await js(`window.refreshStatus = async () => {}; window.scrollTo(0, 0)`);          // stop the poll overwriting the states shown here
        await js(`updateUI(Object.assign({}, currentState, { config: Object.assign({}, currentState.config, { enableCloud: true, subdomain: 'acme-demo', port: 80 }), localIp: '192.168.1.20' }))`);
        await sleep(300);
        const cases = [
          ['connected', { enabled: true, state: 'connected', reason: null, detail: '' }, 'circle-check', 'connected'],
          ['starting', { enabled: true, state: 'starting', reason: null, detail: '' }, 'loader', 'starting'],
          ['off', { enabled: true, state: 'off', reason: 'stopped', detail: '' }, 'circle-x', 'off:stopped'],
          ['error-binary-missing', { enabled: true, state: 'error', reason: 'binary_missing', detail: 'looked in /Applications/TexaCore ERP.app/Contents/Resources/bin/cloudflared/cloudflared' }, 'circle-x', 'error:binary_missing'],
          ['error-token-invalid', { enabled: true, state: 'error', reason: 'token_invalid', detail: 'Provided Tunnel token is not valid.' }, 'circle-x', 'error:token_invalid'],
          ['error-token-rejected', { enabled: true, state: 'error', reason: 'token_rejected', detail: 'ERR Register tunnel error from server side error="Failed to get tunnel"' }, 'circle-x', 'error:token_rejected'],
          ['error-exited', { enabled: true, state: 'error', reason: 'exited', detail: 'exit code 1' }, 'circle-x', 'error:exited'],
        ];
        const seen = [];
        for (const [name, tn, mark, dataState] of cases) {
          await js(`renderTunnelStatus({ containerRunning: true, tunnel: ${JSON.stringify(tn)} })`);
          const w = await js(`({ icon: (document.querySelector('#tunnel-status use') || { getAttribute: () => '' }).getAttribute('href'), text: document.getElementById('tunnel-status').textContent, state: document.getElementById('tunnel-status').dataset.tunnelState, color: document.getElementById('tunnel-status').style.color,
            detail: document.getElementById('tunnel-detail').textContent, detailShown: getComputedStyle(document.getElementById('tunnel-detail')).display !== 'none' })`);
          if (w.state !== dataState) throw new Error(`${name}: state ${w.state}`);
          if (w.icon !== `#i-${mark}`) throw new Error(`${name}: icon ${w.icon} (wanted ${mark}); text "${w.text}"`);
          if (!w.text.trim() || /\p{Extended_Pictographic}/u.test(w.text)) throw new Error(`${name}: text "${w.text}" is empty or carries an emoji`);
          if (name !== 'connected' && w.icon === '#i-circle-check') throw new Error(`${name}: shows the connected mark`);
          if (name.startsWith('error') && (!w.detailShown || !w.detail)) throw new Error(`${name}: no detail line`);
          if (/^(error-binary-missing|error-token-rejected|connected)$/.test(name)) { await js(`document.getElementById('tunnel-status').scrollIntoView({ block: 'center' })`); await ev({ shot: `ui-${lang}-tunnel-${name}.png`, wait: 100 }); }
          seen.push(`${name}: "${w.text}"`);
        }
        // services stopped, or cloud access off: never «connected»
        await js(`renderTunnelStatus({ containerRunning: false, tunnel: { enabled: true, state: 'connected' } })`);
        const stopped = await js(`({ text: document.getElementById('tunnel-status').textContent, icon: (document.querySelector('#tunnel-status use') || { getAttribute: () => '' }).getAttribute('href') })`);
        if (stopped.icon === '#i-circle-check') throw new Error(`services stopped but the window says "${stopped.text}" with the connected mark`);
        await js(`delete window.refreshStatus`);
        await js(`updateUI(Object.assign({}, currentState, { config: Object.assign({}, currentState.config, { enableCloud: false }) }))`);   // leave the switch as it was
        return seen.join(' | ');
      });

      await R.check(`U8 [${lang}] the admin-portal password UI states the real policy (8+), refuses 7 characters / «admin» / a licence-key shape, and a good password is accepted and verified by the server`, async () => {
        await js(`window.scrollTo(0, 0); document.getElementById('admin-password-panel').style.display = 'none'; toggleAdminPasswordPanel()`); await sleep(1200);
        const open = await js(`({ ph: document.getElementById('input-admin-password').placeholder, status: document.getElementById('admin-password-status').textContent, desc: document.querySelector('[data-i18n="admin.desc"]').textContent })`);
        if (!/8/.test(open.ph) || /(^|[^0-9])4([^0-9]|$)/.test(open.ph + open.status + open.desc)) throw new Error(`policy text: ${JSON.stringify(open)}`);
        if (lang === 'ar' && !/8/.test(open.status)) throw new Error(`status text lacks the minimum: ${open.status}`);   // (the second language runs after a password was set: «custom password is set» has no number)
        await js(`document.getElementById('admin-password-panel').scrollIntoView({ block: 'center' })`);
        const attempt = async (value) => {
          await js(`document.getElementById('input-admin-password').value = ${JSON.stringify(value)}; saveAdminPassword()`); await sleep(1200);
          return js(`({ text: document.getElementById('admin-password-status').textContent, color: document.getElementById('admin-password-status').style.color, icon: (document.querySelector('#admin-password-status use') || { getAttribute: () => '' }).getAttribute('href') })`);
        };
        const short = await attempt('1234567');
        if (!/8/.test(short.text) || short.icon === '#i-circle-check') throw new Error(`7 characters: "${short.text}"`);
        await ev({ shot: `ui-${lang}-admin-password-too-short.png`, wait: 100 });
        const adminPw = await attempt('admin');
        if (adminPw.icon === '#i-circle-check') throw new Error(`"admin" accepted: ${adminPw.text}`);
        const keyLike = await attempt('FREE-2026-12345');
        if (keyLike.icon === '#i-circle-check') throw new Error(`a licence-key shape accepted: ${keyLike.text}`);
        if (keyLike.icon !== '#i-triangle-alert') throw new Error(`the server's refusal is not shown: "${keyLike.text}"`);
        await ev({ shot: `ui-${lang}-admin-password-key-like.png`, wait: 100 });
        const good = lang === 'ar' ? 'Correct#Horse9' : 'Another#Pass77';
        const ok = await attempt(good);
        if (ok.icon !== '#i-circle-check') throw new Error(`a good password was not accepted: "${ok.text}"`);
        await ev({ shot: `ui-${lang}-admin-password-saved.png`, wait: 100 });
        const verify = async (p) => (await request('POST', `http://127.0.0.1:${PORTS.api}/rest/v1/rpc/verify_admin_password`, { headers: { apikey: secrets.anonKey, Authorization: `Bearer ${secrets.anonKey}` }, body: { p_input: p } })).json;
        if (await verify(good) !== true) throw new Error('the server does not accept the password the window reported as saved');
        if (await verify('1234567') !== false || await verify('FREE-LOCAL') !== false) throw new Error('the server accepts a refused value');
        return `placeholder "${open.ph}"; status "${open.status}"; 7 chars → "${short.text}"; "admin" → "${adminPw.text}"; key shape → "${keyLike.text}"; good → "${ok.text}" and the server verifies it (a free licence has no default)`;
      });

      // Every icon is an inline SVG now (no emoji): the licence panel, every kind of status line, the subdomain checker, the buttons' busy labels — shot and measured, per language.
      await R.check(`U9 [${lang}] the licence panel and every status line draw SVG icons (no emoji anywhere on the page); icons have a size, point at a defined symbol, and the status ::before masks are painted`, async () => {
        await js(`window.refreshStatus = async () => {}; window.scrollTo(0, 0); showLicensePanel()`); await sleep(400);
        await ev({ shot: `ui-${lang}-license-panel.png`, wait: 200 });
        // each kind of status line, as the real code sets them (class + plain text): four lines on one frame
        const kinds = await js(`(() => {
          const fb = document.getElementById('feedback-license'); const out = [];
          const set = (cls, text) => { fb.className = 'feedback ' + cls; fb.textContent = text; };
          const probe = (el) => { const b = getComputedStyle(el, '::before'); return { content: b.content, mask: (b.webkitMaskImage || b.maskImage || ''), w: b.width }; };
          for (const [cls, text] of [['loading', t('license.connectingLicense')], ['success', t('license.activatedOk')], ['error', t('license.errNoKey')], ['info', t('cloud.connecting')]]) { set(cls, text); out.push({ cls, ...probe(fb) }); }
          // a composite frame: the four lines stacked (clones keep the classes)
          set('loading', t('license.connectingLicense'));
          for (const [cls, text] of [['success', t('license.activatedOk')], ['error', t('license.errNoKey')], ['info', t('cloud.connecting')]]) { const c = fb.cloneNode(false); c.className = 'feedback ' + cls; c.textContent = text; c.dataset.clone = '1'; fb.parentNode.insertBefore(c, fb.nextSibling); }
          return out; })()`);
        for (const k of kinds) if (!/svg\+xml/.test(k.mask) || k.w !== '16px') throw new Error(`status "${k.cls}" has no painted icon: ${JSON.stringify(k)}`);
        // busy buttons exactly as the real code words them
        await js(`(() => { const b = document.getElementById('btn-activate'); b.disabled = true; setWithIcon(b, 'loader', t('license.activating'), 20, 'spin'); })()`);
        await js(`document.getElementById('feedback-license').scrollIntoView({ block: 'center' })`);
        await ev({ shot: `ui-${lang}-feedback-states.png`, wait: 250 });
        await js(`(() => { document.querySelectorAll('[data-clone]').forEach((n) => n.remove()); const fb = document.getElementById('feedback-license'); fb.className = 'feedback'; fb.textContent = ''; const b = document.getElementById('btn-activate'); b.disabled = false; setWithIcon(b, 'zap', t('license.activateBtn'), 20, ''); })()`);
        // the subdomain checker: a non-Latin name is refused with its own icon (no network involved)
        await js(`document.getElementById('cloud-setup').style.display = 'block'; document.getElementById('cloud-active').style.display = 'none'; checkSubdomain('عربي')`); await sleep(300);
        const dom = await js(`({ icon: (document.querySelector('#domain-status use') || { getAttribute: () => '' }).getAttribute('href'), text: document.getElementById('domain-status').textContent })`);
        if (dom.icon !== '#i-circle-x' || !dom.text) throw new Error(`subdomain status: ${JSON.stringify(dom)}`);
        await js(`document.getElementById('domain-status').scrollIntoView({ block: 'center' })`);
        await ev({ shot: `ui-${lang}-subdomain-refused.png`, wait: 200 });
        // page-wide: no emoji / pictograph in what is shown; every icon has a size and a defined symbol
        const page = await js(`(() => {
          const text = document.body.innerText; const bad = [...text.matchAll(/[\\p{Extended_Pictographic}\\p{Emoji_Presentation}\\uFE0F\\u20E3\\u2713-\\u2718]/gu)].map((m) => m[0]).filter((c) => !['\\u00A9', '\\u00AE', '\\u2122'].includes(c));
          const uses = [...document.querySelectorAll('svg.icon use')]; const undef = uses.filter((u) => !document.querySelector(u.getAttribute('href'))).map((u) => u.getAttribute('href'));
          const flat = [...document.querySelectorAll('svg.icon')].filter((sv) => sv.getClientRects().length && (sv.getBoundingClientRect().width < 10 || sv.getBoundingClientRect().height < 10)).length;
          return { emoji: bad, icons: uses.length, undef, flat, sprite: !!document.getElementById('icon-sprite') }; })()`);
        if (page.emoji.length || page.undef.length || page.flat || !page.sprite || page.icons < 15) throw new Error(`page icons: ${JSON.stringify(page)}`);
        await js(`delete window.refreshStatus; refreshState()`); await sleep(800);
        return `${page.icons} icons on the page, none undefined/collapsed, no emoji in the text; status lines ${kinds.map((k) => k.cls).join('/')} painted; subdomain refusal "${dom.text}"`;
      });

      // The licence row: a licence without an end date (the free local plan) never expires — «دائمة» / "Never expires", not «ينتهي: -- (0 يوم)»; a trial shows its real end date and the days left.
      await R.check(`U11 [${lang}] licence row: FREE says "never expires" (no date, no «0 days»); a trial shows the real end date and the days left`, async () => {
        await js(`window.refreshStatus = async () => {}; window.scrollTo(0, 0); document.getElementById('panel-license').style.display = 'none'; document.getElementById('panel-control').style.display = 'block'`);
        const probe = `(() => { const e = document.getElementById('badge-expires'); return { text: e.textContent, expiry: e.dataset.expiry || '', tier: document.getElementById('badge-tier').textContent, never: t('license.neverExpires'), prefix: t('license.expiresPrefix'), unit: t('common.daysUnit') }; })()`;
        // FREE — the real licence of this run
        const real = await js(`({ tier: (currentState.licenseInfo || {}).tier, expires: (currentState.licenseInfo || {}).expires_at || null })`);
        if (real.tier !== 'free' || real.expires) throw new Error(`this run's licence is not a free one without an end date: ${JSON.stringify(real)}`);
        await js(`updateControlPanel(currentState)`);
        const free = await js(probe);
        if (free.expiry !== 'never' || free.text !== free.never || !free.never || /\d/.test(free.text) || free.text.includes('--')) throw new Error(`FREE row: ${JSON.stringify(free)}`);
        await js(`document.getElementById('license-badge').scrollIntoView({ block: 'center' })`);
        await ev({ shot: `ui-${lang}-license-row-free.png`, wait: 200 });
        // TRIAL — a licence with an end date 11.5 days away (→ 12 days left)
        const ends = Date.now() + Math.round(11.5 * 86400000);
        await js(`updateControlPanel(Object.assign({}, currentState, { licenseInfo: { tier: 'trial', license_key: 'TRL-UI-SHOT', expires_at: new Date(${ends}).toISOString() } }))`);
        const trial = await js(probe);
        const wantDate = await js(`new Intl.DateTimeFormat(({ ar: 'ar-EG', en: 'en-US', ru: 'ru-RU', uk: 'uk-UA' })[document.documentElement.lang] || 'en-US', { calendar: 'gregory', numberingSystem: 'latn', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(${ends}))`);
        if (trial.expiry !== 'date' || trial.text !== `${trial.prefix} ${wantDate} (12 ${trial.unit})` || trial.text === trial.never) throw new Error(`TRIAL row: ${JSON.stringify(trial)} — wanted «${trial.prefix} ${wantDate} (12 ${trial.unit})»`);
        await ev({ shot: `ui-${lang}-license-row-trial.png`, wait: 200 });
        await js(`updateControlPanel(currentState); delete window.refreshStatus`);
        return `FREE: "${free.text}" ; TRIAL (tier ${trial.tier}): "${trial.text}"`;
      });
      await R.check(`U12 [${lang}] the update widget shows every state of the resumable download with the right text, icon and controls — and does not overflow`, async () => {
        await js(`window.scrollTo(0, 0); document.getElementById('panel-license').style.display = 'none'; document.getElementById('panel-control').style.display = 'block'`);
        const tr = await js(`({ pause: t('update.pause'), resume: t('update.resume'), retry: t('update.retryNow'), offline: t('update.offline'), pausedNote: t('update.pausedNote') })`);
        const seen = [];
        for (const st of UPD_STATES) {
          await emitUpd(st.snap()); await sleep(250);
          const w = await js(WIDGET_STATE);
          if (!w.shown) throw new Error(`${st.name}: the widget is not shown (${JSON.stringify(w)})`);
          if (w.overflowX) throw new Error(`${st.name}: the widget overflows horizontally (${JSON.stringify(w)})`);
          if (w.dir !== (lang === 'ar' ? 'rtl' : 'ltr') || w.lang !== lang) throw new Error(`${st.name}: direction ${w.dir}/${w.lang}`);
          if (!st.want(w, tr)) throw new Error(`${st.name}: unexpected widget ${JSON.stringify(w)} (labels ${JSON.stringify(tr)})`);
          await js(`document.getElementById('update-widget').scrollIntoView({ block: 'center' })`);
          await ev({ shot: `ui-${lang}-update-${st.name}.png`, wait: 150 });
          seen.push(`${st.name}: "${w.text}"${w.pause ? ` [${w.pause}]` : ''}${w.retry ? ` [${w.retry}]` : ''}`);
        }
        await emitUpd({ phase: 'idle' }); await sleep(200);   // (a staged update is never withdrawn by update-not-available — only an explicit idle status clears the ready banner)
        const gone = await js(`getComputedStyle(document.getElementById('update-widget')).display === 'none'`);
        if (!gone) throw new Error('the widget stays after the update is withdrawn');
        evidence[`update-widget-${lang}`] = seen;
        return seen.join(' | ').slice(0, 900);
      });

    }

    await R.check('U12 [ru, uk] the longest update states do not overflow the widget (shots taken)', async () => {
      const out = [];
      for (const lang of ['ru', 'uk']) {
        await js(`(() => { const s = document.getElementById('lang-select'); s.value = '${lang}'; onLangChange(); window.scrollTo(0, 0); document.getElementById('panel-license').style.display = 'none'; document.getElementById('panel-control').style.display = 'block'; })()`);
        await sleep(400);
        for (const st of UPD_STATES.filter((x) => ['waiting-retry', 'paused', 'no-space', 'failed-verify'].includes(x.name))) {
          await emitUpd(st.snap()); await sleep(250);
          const w = await js(WIDGET_STATE);
          if (!w.shown || w.overflowX) throw new Error(`${lang}/${st.name}: ${JSON.stringify(w)}`);
          if (!/[А-Яа-яІіЇїЄє]/.test(w.text)) throw new Error(`${lang}/${st.name}: not translated: "${w.text}"`);
          await js(`document.getElementById('update-widget').scrollIntoView({ block: 'center' })`);
          await ev({ shot: `ui-${lang}-update-${st.name}.png`, wait: 100 });
          out.push(`${lang}/${st.name} ${w.width}px`);
        }
      }
      await emitUpd({ phase: 'idle' });
      await js(`(() => { const s = document.getElementById('lang-select'); s.value = 'en'; onLangChange(); })()`);
      return out.join(', ');
    });

    await R.check('U6 «إغلاق» dismisses the notice for good: gone at once, still gone after a reload, and the notice file says so', async () => {
      await js(`document.getElementById('upgrade-dismiss').click()`); await sleep(800);
      const hidden = await js(`getComputedStyle(document.getElementById('upgrade-notice')).display === 'none'`);
      if (!hidden) throw new Error('still visible after the button');
      await js(`location.reload()`); await sleep(4000);
      await js(`window.scrollTo(0, 0)`);
      const after = await js(`getComputedStyle(document.getElementById('upgrade-notice')).display === 'none'`);
      await ev({ shot: 'ui-en-upgrade-notice-dismissed.png', wait: 300 });
      const note = JSON.parse(fs.readFileSync(path.join(dd, 'upgrade-notice.json'), 'utf8'));
      if (!after || !note.dismissedAt) throw new Error(`after reload hidden=${after}, dismissedAt=${note.dismissedAt}`);
      return `hidden at once and after a reload; dismissedAt ${note.dismissedAt}`;
    });

    await R.check('U4 «yes» (confirm) stops the services', async () => {
      await js(`document.getElementById('btn-stop').click()`); await sleep(400);
      await js(`document.getElementById('btn-stop-confirm').click()`);
      const t0 = Date.now(); let running = true;
      while (running && Date.now() - t0 < 60000) { await sleep(1500); running = await js(`texacore.getState().then((s) => !!s.containerRunning)`); }
      await ev({ shot: 'ui-en-after-stop.png', wait: 300 });
      if (running) throw new Error('the services did not stop after «yes»');
      return `stopped after ${Math.round((Date.now() - t0) / 1000)}s`;
    });

    await R.check('U10 starting the system again: the start button shows the busy icon, then the running state returns — shot at each step', async () => {
      await js(`window.scrollTo(0, 0); document.getElementById('btn-start').click()`); await sleep(350);
      const busy = await js(`({ icon: (document.querySelector('#btn-start use') || { getAttribute: () => '' }).getAttribute('href'), spin: !!document.querySelector('#btn-start .spin'), disabled: document.getElementById('btn-start').disabled, text: document.getElementById('btn-start').textContent.trim(), fb: document.getElementById('feedback-control').className })`);
      await ev({ shot: 'ui-en-starting.png', wait: 200 });
      if (busy.icon !== '#i-loader' || !busy.spin || !busy.disabled) throw new Error(`start button while starting: ${JSON.stringify(busy)}`);
      const t0 = Date.now(); let running = false;
      while (!running && Date.now() - t0 < 240000) { await sleep(2000); running = await js(`texacore.getState().then((s) => !!s.containerRunning)`); }
      if (!running) throw new Error('the services did not start again');
      await sleep(2500);
      await ev({ shot: 'ui-en-running-again.png', wait: 300 });
      const after = await js(`({ stopShown: getComputedStyle(document.getElementById('btn-stop')).display !== 'none', startShown: getComputedStyle(document.getElementById('btn-start')).display !== 'none' })`);
      if (!after.stopShown || after.startShown) throw new Error(`after starting: ${JSON.stringify(after)}`);
      return `busy: ${busy.icon} spinning, "${busy.text}", status line "${busy.fb}"; running again after ${Math.round((Date.now() - t0) / 1000)}s`;
    });
  } finally {
    await stopApp(child, userData);
  }
  fs.writeFileSync(path.join(WORK, 'results.json'), JSON.stringify({ at: new Date().toISOString(), app: APP, summary: R.summary(), rows: R.rows, evidence }, null, 2));
  console.log(`\nui-shots: ${R.summary()}  →  ${shots}`);
  process.exit(R.failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
