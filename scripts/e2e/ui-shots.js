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

      await R.check(`U2 [${lang}] copy buttons beside the cloud link and the local link copy exactly what is shown`, async () => {
        // display-only sample state (no cloud account exists in this isolated run): a subdomain and a LAN address, through the renderer's own updateUI
        await js(`(() => { window.__copied = []; navigator.clipboard.writeText = (x) => { window.__copied.push(x); return Promise.resolve(); };
          updateUI(Object.assign({}, currentState, { config: Object.assign({}, currentState.config, { enableCloud: true, subdomain: 'acme-demo', port: 80 }), localIp: '192.168.1.20' }));
          document.getElementById('cloud-url').scrollIntoView({ block: 'center' }); })()`);
        await sleep(500);
        await ev({ shot: `ui-${lang}-copy-buttons.png`, wait: 200 });
        const shown = await js(`({ cloud: document.getElementById('cloud-url').textContent.trim(), local: document.getElementById('local-url').textContent.trim(),
          cloudBtn: document.getElementById('copy-cloud-url').textContent, localBtn: document.getElementById('copy-local-url').textContent,
          lanBtn: document.getElementById('copy-lan-employee-url') ? document.getElementById('copy-lan-employee-url').textContent : null })`);
        await js(`document.getElementById('copy-cloud-url').click()`); await sleep(300);
        const afterCloud = await js(`({ copied: window.__copied.slice(), btn: document.getElementById('copy-cloud-url').textContent })`);
        await ev({ shot: `ui-${lang}-copy-clicked.png`, wait: 100 });
        await js(`document.getElementById('copy-local-url').click()`); await sleep(300);
        const afterLocal = await js(`({ copied: window.__copied.slice(), btn: document.getElementById('copy-local-url').textContent })`);
        if (shown.cloud !== 'https://acme-demo.texacore.ai' || shown.local !== 'http://192.168.1.20') throw new Error(`links shown: ${JSON.stringify(shown)}`);
        if (afterCloud.copied[0] !== shown.cloud) throw new Error(`cloud copy: ${JSON.stringify(afterCloud.copied)}`);
        if (afterLocal.copied[1] !== shown.local) throw new Error(`local copy: ${JSON.stringify(afterLocal.copied)}`);
        if (afterCloud.btn === shown.cloudBtn) throw new Error('the button did not acknowledge the copy');
        evidence[`copy_${lang}`] = { shown, afterCloud, afterLocal };
        await js(`updateUI(Object.assign({}, currentState, { config: Object.assign({}, currentState.config, { enableCloud: false }) }))`);
        return `cloud ${shown.cloud} → copied; local ${shown.local} → copied; button label «${shown.cloudBtn}» → «${afterCloud.btn}»`;
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
          ['connected', { enabled: true, state: 'connected', reason: null, detail: '' }, /🟢/, 'connected'],
          ['starting', { enabled: true, state: 'starting', reason: null, detail: '' }, /⏳/, 'starting'],
          ['off', { enabled: true, state: 'off', reason: 'stopped', detail: '' }, /🔴/, 'off:stopped'],
          ['error-binary-missing', { enabled: true, state: 'error', reason: 'binary_missing', detail: 'looked in /Applications/TexaCore ERP.app/Contents/Resources/bin/cloudflared/cloudflared' }, /❌/, 'error:binary_missing'],
          ['error-token-invalid', { enabled: true, state: 'error', reason: 'token_invalid', detail: 'Provided Tunnel token is not valid.' }, /❌/, 'error:token_invalid'],
          ['error-token-rejected', { enabled: true, state: 'error', reason: 'token_rejected', detail: 'ERR Register tunnel error from server side error="Failed to get tunnel"' }, /❌/, 'error:token_rejected'],
          ['error-exited', { enabled: true, state: 'error', reason: 'exited', detail: 'exit code 1' }, /❌/, 'error:exited'],
        ];
        const seen = [];
        for (const [name, tn, mark, dataState] of cases) {
          await js(`renderTunnelStatus({ containerRunning: true, tunnel: ${JSON.stringify(tn)} })`);
          const w = await js(`({ text: document.getElementById('tunnel-status').textContent, state: document.getElementById('tunnel-status').dataset.tunnelState, color: document.getElementById('tunnel-status').style.color,
            detail: document.getElementById('tunnel-detail').textContent, detailShown: getComputedStyle(document.getElementById('tunnel-detail')).display !== 'none' })`);
          if (w.state !== dataState) throw new Error(`${name}: state ${w.state}`);
          if (!mark.test(w.text)) throw new Error(`${name}: text "${w.text}"`);
          if (name !== 'connected' && /🟢/.test(w.text)) throw new Error(`${name}: shows the connected mark`);
          if (name.startsWith('error') && (!w.detailShown || !w.detail)) throw new Error(`${name}: no detail line`);
          if (/^(error-binary-missing|error-token-rejected|connected)$/.test(name)) { await js(`document.getElementById('tunnel-status').scrollIntoView({ block: 'center' })`); await ev({ shot: `ui-${lang}-tunnel-${name}.png`, wait: 100 }); }
          seen.push(`${name}: "${w.text}"`);
        }
        // services stopped, or cloud access off: never «connected»
        await js(`renderTunnelStatus({ containerRunning: false, tunnel: { enabled: true, state: 'connected' } })`);
        const stopped = await js(`document.getElementById('tunnel-status').textContent`);
        if (/🟢/.test(stopped)) throw new Error(`services stopped but the window says "${stopped}"`);
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
          return js(`({ text: document.getElementById('admin-password-status').textContent, color: document.getElementById('admin-password-status').style.color })`);
        };
        const short = await attempt('1234567');
        if (!/8/.test(short.text) || /✅/.test(short.text)) throw new Error(`7 characters: "${short.text}"`);
        await ev({ shot: `ui-${lang}-admin-password-too-short.png`, wait: 100 });
        const adminPw = await attempt('admin');
        if (/✅/.test(adminPw.text)) throw new Error(`"admin" accepted: ${adminPw.text}`);
        const keyLike = await attempt('FREE-2026-12345');
        if (/✅/.test(keyLike.text)) throw new Error(`a licence-key shape accepted: ${keyLike.text}`);
        if (!/⚠️/.test(keyLike.text)) throw new Error(`the server's refusal is not shown: "${keyLike.text}"`);
        await ev({ shot: `ui-${lang}-admin-password-key-like.png`, wait: 100 });
        const good = lang === 'ar' ? 'Correct#Horse9' : 'Another#Pass77';
        const ok = await attempt(good);
        if (!/✅/.test(ok.text)) throw new Error(`a good password was not accepted: "${ok.text}"`);
        await ev({ shot: `ui-${lang}-admin-password-saved.png`, wait: 100 });
        const verify = async (p) => (await request('POST', `http://127.0.0.1:${PORTS.api}/rest/v1/rpc/verify_admin_password`, { headers: { apikey: secrets.anonKey, Authorization: `Bearer ${secrets.anonKey}` }, body: { p_input: p } })).json;
        if (await verify(good) !== true) throw new Error('the server does not accept the password the window reported as saved');
        if (await verify('1234567') !== false || await verify('FREE-LOCAL') !== false) throw new Error('the server accepts a refused value');
        return `placeholder "${open.ph}"; status "${open.status}"; 7 chars → "${short.text}"; "admin" → "${adminPw.text}"; key shape → "${keyLike.text}"; good → "${ok.text}" and the server verifies it (a free licence has no default)`;
      });
    }

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
  } finally {
    await stopApp(child, userData);
  }
  fs.writeFileSync(path.join(WORK, 'results.json'), JSON.stringify({ at: new Date().toISOString(), app: APP, summary: R.summary(), rows: R.rows, evidence }, null, 2));
  console.log(`\nui-shots: ${R.summary()}  →  ${shots}`);
  process.exit(R.failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
