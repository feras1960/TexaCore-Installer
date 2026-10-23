// ════════════════════════════════════════════════════════════════
// TexaCore launcher — Renderer (UI logic), 2.0.5 RC2
// A no-scroll control panel: header (status chips · language · stop) · hero (the company + ONE primary button) · three tabs
// (links · files and backups · licence and support). Native embedded services — no Docker.
// ════════════════════════════════════════════════════════════════

let currentState = {};
let statusInterval = null;
const $ = (id) => document.getElementById(id);

// ─── Small helpers ────────────────────────────────────────────
let _toastTimer = null;
function showToast(text, ms = 3200) {
  const el = $('toast');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
}
function fillText(template, vars) {
  return Object.keys(vars || {}).reduce((acc, k) => acc.split('{' + k + '}').join(String(vars[k])), String(template));
}
// «3 days» in the active language (Arabic dual / plural, Slavic few / many)
function daysWord(n) {
  const lang = (typeof CURRENT_LANG === 'string' && CURRENT_LANG) || 'ar';
  const a = Math.abs(n);
  if (lang === 'ar') return a === 1 ? 'يوم' : a === 2 ? 'يومان' : (a >= 3 && a <= 10) ? 'أيام' : 'يوماً';
  if (lang === 'ru' || lang === 'uk') {
    const m10 = a % 10, m100 = a % 100;
    if (m10 === 1 && m100 !== 11) return lang === 'ru' ? 'день' : 'день';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return lang === 'ru' ? 'дня' : 'дні';
    return lang === 'ru' ? 'дней' : 'днів';
  }
  return a === 1 ? 'day' : 'days';
}
function fmtMB(bytes) {
  const n = Number(bytes) || 0;
  const mb = n / 1048576;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} ${t('ui.unit.mb')}`;
}
function localeTag() { return ({ ar: 'ar-EG', en: 'en-US', ru: 'ru-RU', uk: 'uk-UA' })[document.documentElement.lang] || 'en-US'; }
function fmtDate(d, opts) { return new Intl.DateTimeFormat(localeTag(), { calendar: 'gregory', numberingSystem: 'latn', ...opts }).format(d); }

// ─── Tabs ─────────────────────────────────────────────────────
const TABS = ['links', 'files', 'license'];
function selectTab(name, focus) {
  if (!TABS.includes(name)) return;
  for (const tb of TABS) {
    const btn = $('tabbtn-' + tb);
    const pane = $('tab-' + tb);
    const on = tb === name;
    if (btn) { btn.classList.toggle('tab-on', on); btn.setAttribute('aria-selected', on ? 'true' : 'false'); btn.tabIndex = on ? 0 : -1; if (on && focus) btn.focus(); }
    if (pane) pane.hidden = !on;
  }
  if (name === 'files') { refreshBackupsBox(); refreshRecentBackups(); }
}
function initTabs() {
  const list = $('tabs');
  if (!list) return;
  list.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) selectTab(b.dataset.tab); });
  list.addEventListener('keydown', (e) => {
    const cur = TABS.findIndex((tb) => $('tabbtn-' + tb) && $('tabbtn-' + tb).getAttribute('aria-selected') === 'true');
    const rtl = document.documentElement.dir === 'rtl';
    let next = -1;
    if (e.key === 'ArrowRight') next = cur + (rtl ? -1 : 1);
    else if (e.key === 'ArrowLeft') next = cur + (rtl ? 1 : -1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next >= 0) { e.preventDefault(); selectTab(TABS[(next + TABS.length) % TABS.length], true); }
  });
}

// ─── Language switch (header <select>) ───────────────────────
// Top-level so the inline onchange="onLangChange()" can reach it.
async function onLangChange() {
  const sel = $('lang-select');
  const lang = sel ? sel.value : 'en';
  applyI18n(lang);
  // re-render the strings that are set from script so they switch instantly too, not only on the next poll
  try { if (currentState) renderState(currentState); } catch (e) { /* ignore */ }
  if (window.texacore && window.texacore.setUiLang) {
    try { await window.texacore.setUiLang(lang); } catch (e) { /* ignore */ }
  }
}

// ─── Initialize ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (/^mac/i.test(navigator.platform || '')) document.documentElement.classList.add('mac');
  initTabs();
  loadCachedCompanies();

  // version + build date (package.json, stamped by the build)
  try {
    const verInfo = await texacore.getVersion();
    const v = typeof verInfo === 'object' && verInfo ? verInfo.version : verInfo;
    if (v) { $('version').textContent = v; $('info-version').textContent = v; }
    if (verInfo && verInfo.buildDate && verInfo.buildDate !== 'unknown') {
      const bd = new Date(verInfo.buildDate);
      if (!Number.isNaN(bd.getTime())) $('build-date').textContent = bd.toISOString().slice(0, 10);
    }
  } catch { /* stays as "v..." */ }

  // migration progress events from the main process (first-run schema setup)
  if (texacore.onMigrationProgress) {
    texacore.onMigrationProgress((data) => {
      const box = $('migration-progress-box');
      const bar = $('migration-progress-bar');
      const counter = $('migration-counter');
      const text = $('migration-progress-text');
      if (!box || !bar) return;
      box.style.display = 'flex';
      const pct = Math.round((data.step / data.total) * 100);
      bar.style.width = `${pct}%`;
      counter.textContent = `${data.step}/${data.total}`;
      text.textContent = data.name;
      if (data.step >= data.total) setTimeout(() => { box.style.display = 'none'; }, 2000);
    });
  }

  await refreshState();

  // language: the saved choice wins, else the OS locale (from main) or the browser's. t() reads CURRENT_LANG live.
  const saved = (currentState && currentState.config && currentState.config.uiLang) || null;
  const lang = saved || detectLang((currentState && currentState.osLocale) || navigator.language);
  const sel = $('lang-select');
  if (sel) sel.value = lang;
  applyI18n(lang);
  try { renderState(currentState); } catch { /* ignore */ }

  refreshAdminPasswordStatus();
  // adaptive polling: fast (1.5 s) while the system is starting / not yet connected, relaxed (5 s) once it runs
  const _statusTick = async () => {
    await refreshStatus();
    const connected = currentState && currentState.containerRunning;
    statusInterval = setTimeout(_statusTick, connected ? 5000 : 1500);
  };
  statusInterval = setTimeout(_statusTick, 1500);
});

// ─── Refresh ─────────────────────────────────────────────────
let _firstRender = true;
async function refreshState() {
  try {
    currentState = await texacore.getState();
    renderState(currentState);
    refreshEmployeesBox(currentState);
    if (_firstRender) {
      _firstRender = false;
      if (!currentState.hasLicense) selectTab('license');     // nothing works without a licence: land where it is fixed
    }
  } catch (err) {
    console.error('Failed to get state:', err);
  }
}
async function refreshStatus() {
  try {
    const state = await texacore.getState();
    currentState = state;
    renderState(state);
    // the company list (and with it the links) can miss on first paint (before the DB is up): refreshEmployeesBox re-asks until it lands
    refreshEmployeesBox(state);
    refreshBackupsBox();
  } catch { /* silent */ }
}

// ─── Render everything the state decides ─────────────────────
function renderState(state) {
  if (!state) return;
  updateStatusCards(state);
  updateControlButtons(state);
  renderHero(state);
  renderLinks(state);
  renderLanAddress(state);
  renderCloud(state);
  renderLicense(state);
  renderSupport(state);
}

// ─── Header chips ────────────────────────────────────────────
function setChip(chipId, dotId, textId, cls, dot, text) {
  const chip = $(chipId), d = $(dotId), tx = $(textId);
  if (chip) chip.className = 'chip' + (cls ? ' ' + cls : '');
  if (d) d.className = 'dot ' + dot;
  if (tx) tx.textContent = text;
}
function licenseView(state) {
  const li = state && state.licenseInfo;
  const cfg = (state && state.config) || {};
  const out = { kind: 'none', tier: '', daysLeft: null, expires: null, total: null };
  if (!li) return out;
  const isTrial = cfg.isTrial === true || /^TRL-/i.test(String(li.license_key || '')) || String(li.tier || '').toLowerCase() === 'trial';
  const isFree = !isTrial && (String(li.tier || '').toLowerCase() === 'free' || cfg.isFree === true) && !li.expires_at;
  out.tier = isFree ? 'free' : (isTrial ? 'trial' : String(li.tier || 'PRO'));
  if (li.expires_at) {
    const end = new Date(li.expires_at).getTime();
    out.expires = Number.isNaN(end) ? null : end;
    out.daysLeft = out.expires === null ? null : Math.ceil((out.expires - Date.now()) / 86400000);
  }
  out.total = isTrial ? 30 : 365;
  if (!state.hasLicense) out.kind = 'expired';
  else if (isFree || !li.expires_at) out.kind = isFree ? 'free' : 'paid-open';
  else out.kind = isTrial ? 'trial' : 'paid';
  return out;
}
function updateStatusCards(state) {
  const running = !!state.containerRunning;
  const healthy = running && state.containerHealth === 'healthy';
  if (running) {
    setChip('chip-erp', 'indicator-erp', 'status-erp', '', healthy ? 'green' : 'blue', healthy ? t('ui.chip.systemRunning') : t('status.starting'));
    setChip('chip-database', 'indicator-database', 'status-database', '', healthy ? 'green' : 'blue', healthy ? t('ui.chip.dbRunning') : t('status.starting'));
  } else {
    setChip('chip-erp', 'indicator-erp', 'status-erp', 'bad', 'red', t('ui.chip.systemStopped'));
    setChip('chip-database', 'indicator-database', 'status-database', '', 'yellow', t('ui.chip.dbStopped'));
  }
  const lv = licenseView(state);
  let cls = '', dot = 'green', text = '';
  if (lv.kind === 'trial') {
    cls = lv.daysLeft <= 7 ? 'warn' : ''; dot = lv.daysLeft <= 7 ? 'yellow' : 'green';
    text = fillText(t('ui.chip.trial'), { n: Math.max(0, lv.daysLeft), d: daysWord(lv.daysLeft) });
  } else if (lv.kind === 'free') { text = t('ui.chip.free'); }
  else if (lv.kind === 'paid' || lv.kind === 'paid-open') {
    text = lv.daysLeft !== null ? fillText(t('ui.chip.paid'), { n: Math.max(0, lv.daysLeft), d: daysWord(lv.daysLeft) }) : t('status.active');
    if (lv.daysLeft !== null && lv.daysLeft <= 7) { cls = 'warn'; dot = 'yellow'; }
  } else if (lv.kind === 'expired') { cls = 'bad'; dot = 'red'; text = t('ui.chip.expired'); }
  else { cls = 'bad'; dot = 'red'; text = t('status.inactive'); }
  setChip('chip-license', 'indicator-license', 'status-license', cls, dot, text);
  renderTunnelStatus(state);
}

function updateControlButtons(state) {
  const running = !!state.containerRunning;
  const stop = $('btn-stop');
  if (stop) stop.style.display = running ? 'inline-flex' : 'none';
}

// ─── Hero: the company and the ONE primary button ────────────
let _starting = false;
function heroMode(state) {
  if (!state.hasLicense) return 'nolicense';
  if (!state.containerRunning) return 'stopped';
  if (_empListed && !_empCompanies.length) return 'nocompany';
  return 'ready';
}
function renderHero(state) {
  const hero = $('hero');
  if (!hero) return;
  const mode = heroMode(state);
  hero.dataset.mode = mode;
  const note = $('hero-note');
  if (note) note.textContent = mode === 'nocompany' ? t('ui.hero.noCompany') : mode === 'nolicense' ? t('ui.hero.noLicense') : '';
  const open = $('btn-open-label');
  if (open) open.textContent = mode === 'nocompany' ? t('ui.hero.createCompany') : t('ui.openProgram');
  const startBtn = $('btn-start');
  if (startBtn && !_starting) startBtn.disabled = false;
  const sel = $('link-company');
  if (sel) sel.disabled = mode !== 'ready';
}

// ─── Start / stop ────────────────────────────────────────────
function currentPort() {
  const running = currentState && currentState.containerRunning;
  const cfgPort = currentState && currentState.config && parseInt(currentState.config.port, 10);
  if (running && cfgPort) return cfgPort;
  return parseInt($('input-port').value, 10) || cfgPort || 8080;
}
async function startERP() {
  const btn = $('btn-start');
  const feedback = $('feedback-control');
  const port = parseInt($('input-port').value, 10) || 8080;
  const enableCloud = $('input-cloud').checked;
  const subdomain = (currentState.config && currentState.config.subdomain) || $('input-subdomain').value;

  if (enableCloud && !subdomain) {
    feedback.className = 'feedback error';
    feedback.textContent = t('cloud.errReserveFirst');
    selectTab('links');
    return;
  }
  _starting = true;
  btn.disabled = true;
  setStartButton('loader', t('status.starting'), true);
  feedback.className = 'feedback loading';
  feedback.textContent = t('system.startingServices');
  try {
    const result = await texacore.startERP({
      licenseKey: currentState.config && currentState.config.licenseKey,
      dbPassword: (currentState.config && currentState.config.dbPassword) || 'texacore2026',
      port,
      enableCloud,
      subdomain,
    });
    if (result.success) {
      feedback.className = 'feedback success';
      let migInfo = '';
      if (result.migrations && result.migrations.applied > 0) migInfo = ` (${result.migrations.applied} ${t('migration.migrationsApplied')})`;
      feedback.textContent = result.ready ? `${t('system.works')}${migInfo}` : t('system.loadingWait');
      const migBox = $('migration-progress-box');
      if (migBox) migBox.style.display = 'none';
      await refreshState();
      setTimeout(() => { if (feedback.className.includes('success')) { feedback.textContent = ''; feedback.className = 'feedback'; } }, 6000);
    } else {
      feedback.className = 'feedback error';
      feedback.textContent = `${result.error}`;
    }
  } catch (err) {
    feedback.className = 'feedback error';
    feedback.textContent = `${t('common.errorPrefix')} ${err.message}`;
  }
  _starting = false;
  btn.disabled = false;
  setStartButton('play', t('btn.start'));
}
// the start button = icon + a labelled span (the label keeps its id so a language switch can re-word it)
function setStartButton(iconName, label, spin) {
  const btn = $('btn-start');
  if (!btn) return;
  btn.textContent = '';
  btn.appendChild(iconEl(iconName, 16, spin ? 'icon-lead spin' : 'icon-lead'));
  const sp = document.createElement('span'); sp.id = 'btn-start-label'; sp.setAttribute('data-i18n', 'btn.start'); sp.textContent = label;
  if (spin) sp.removeAttribute('data-i18n');
  btn.appendChild(sp);
}

// The red button only ASKS: the question appears inside the window (no native dialog) and nothing is stopped until «yes» is pressed.
// «Cancel» has the focus, Esc cancels, and an unanswered question withdraws itself after 15 s.
let _stopAskTimer = null;
function requestStopERP() {
  const overlay = $('overlay-stop');
  if (!overlay) { stopERP(); return; }
  overlay.style.display = 'flex';
  const box = $('stop-confirm');
  if (box) box.style.display = 'flex';
  $('btn-stop-cancel')?.focus();
  clearTimeout(_stopAskTimer);
  _stopAskTimer = setTimeout(cancelStopERP, 15000);
}
function cancelStopERP() {
  clearTimeout(_stopAskTimer);
  const overlay = $('overlay-stop');
  if (overlay) overlay.style.display = 'none';
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('overlay-stop') && $('overlay-stop').style.display === 'flex') cancelStopERP();
  if (e.key === 'Escape' && $('overlay-password') && $('overlay-password').style.display === 'flex') toggleAdminPasswordPanel();
});

async function stopERP() {
  clearTimeout(_stopAskTimer);
  const overlay = $('overlay-stop');
  if (overlay) overlay.style.display = 'none';
  const btn = $('btn-stop');
  const feedback = $('feedback-control');
  btn.disabled = true;
  feedback.className = 'feedback loading';
  feedback.textContent = t('system.stopping');
  try {
    const result = await texacore.stopERP();
    if (result.success) {
      feedback.className = 'feedback info';
      feedback.textContent = t('system.stopped');
      await refreshState();
    } else {
      feedback.className = 'feedback error';
      feedback.textContent = `${result.error}`;
    }
  } catch (err) {
    feedback.className = 'feedback error';
    feedback.textContent = `${t('common.errorPrefix')} ${err.message}`;
  }
  btn.disabled = false;
}

// Stop, then start again with what is configured (a new licence applies its plan; a new port applies its address)
async function restartServices(opts = {}) {
  const fb = $('feedback-license') || $('feedback-control');
  const out = $('feedback-control');
  const say = (cls, text) => { for (const f of [fb, out]) { if (f) { f.className = 'feedback ' + cls; f.textContent = text; } } };
  try {
    say('loading', t('ui.restart.working'));
    try { await texacore.stopERP(); } catch (e) { console.warn('[restart] stop:', e); }
    await new Promise((r) => setTimeout(r, 1800));       // PostgreSQL lets go of its port before the next start
    await refreshState();
    const c = (currentState && currentState.config) || {};
    const result = await texacore.startERP({
      licenseKey: c.licenseKey,
      dbPassword: c.dbPassword || 'texacore2026',
      port: opts.port || parseInt(c.port, 10) || 8080,
      enableCloud: !!c.enableCloud,
      subdomain: c.subdomain,
    });
    await refreshState();
    if (result && result.success) say('success', t('ui.restart.done'));
    else say('error', t('ui.restart.failed') + ' ' + ((result && result.error) || ''));
    setTimeout(() => { for (const f of [fb, out]) { if (f && f.className.includes('success')) { f.textContent = ''; f.className = 'feedback'; } } }, 6000);
  } catch (e) {
    console.error('[restart] failed:', e);
    say('error', t('ui.restart.failed') + ' ' + e.message);
  }
}
async function restartSystemForLicense() { return restartServices(); }

// ─── Open the program ────────────────────────────────────────
function openERP() {
  const port = currentPort();
  const mode = $('hero') && $('hero').dataset.mode;
  const code = companyCode(chosenCompanyId());
  if (mode === 'ready' && code) texacore.openBrowser(`http://localhost:${port}/login?c=${code}`);
  else texacore.openBrowser(port);
}
function openCloudUrl() {
  const subdomain = currentState.config && currentState.config.subdomain;
  if (subdomain) texacore.openBrowser(`https://${subdomain}.texacore.ai`);
}
function openEmployeeUrl() {
  const url = $('employee-url') && $('employee-url').dataset.url;
  if (url) texacore.openBrowser(url);
}
function openLanEmployeeUrl() { const u = $('lan-employee-url') && $('lan-employee-url').dataset.url; if (u) texacore.openBrowser(u); }

// ─── Employee links (Blocks 1 and 2) ────────────────────────────────────────
// ONE chosen company (the hero's selector) drives both links:
//   · office   (Links tab, left):  http://<LAN address>[:port]/login?c=<code>   - for staff on the office network, works without internet
//   · anywhere (Links tab, right): https://<name>.texacore.ai/login?c=<code>    - over the internet, only while this computer stays on and connected
// <code> is the first segment of the company's id (8 characters), never the URL-encoded Arabic name; «?c=» opens that company's sign-in directly.
let _empCompanies = [];
let _empRefreshing = false;
let _empLast = 0;
let _empListed = false;          // the company list has been read at least once (so «no company yet» is never shown before the first answer)
let _chosenCompanyId = '';
function companyCode(companyId) { return String(companyId || '').split('-')[0]; }
function lanEmployeeLink(state, companyId) {
  const ip = state && state.localIp;
  if (!ip || !companyId) return '';
  const port = (state.config && state.config.port) || 80;
  return `http://${ip}${port === 80 ? '' : ':' + port}/login?c=${companyCode(companyId)}`;
}
function cloudEmployeeLink(state, companyId) {
  const sub = state && state.config && state.config.subdomain;
  if (!sub || !companyId) return '';
  return `https://${sub}.texacore.ai/login?c=${companyCode(companyId)}`;
}
// the company the links are about: the picked one if it still exists, else the first (the list is newest-first)
function chosenCompanyId() {
  if (_chosenCompanyId && _empCompanies.some((c) => c.id === _chosenCompanyId)) return _chosenCompanyId;
  return (_empCompanies[0] && _empCompanies[0].id) || '';
}
function setChosenCompany(id) {
  _chosenCompanyId = id || '';
  const sel = $('link-company');
  if (sel && sel.value !== _chosenCompanyId) sel.value = _chosenCompanyId;
}
function showLink(rowId, anchorId, url) {
  const row = $(rowId);
  const a = $(anchorId);
  if (row) row.style.display = url ? 'flex' : 'none';
  if (a) { a.textContent = url || '—'; a.dataset.url = url || ''; a.title = url || ''; }
}
function renderLinks(state) {
  const st = state || currentState || {};
  const id = chosenCompanyId();
  const running = !!st.containerRunning;
  showLink('lan-link-row', 'lan-employee-url', lanEmployeeLink(st, id));
  showLink('cloud-employee-row', 'employee-url', cloudEmployeeLink(st, id));
  const none = $('lan-no-company');
  if (none) none.style.display = (running && _empListed && !_empCompanies.length) ? 'block' : 'none';
  const stopped = $('lan-stopped');
  if (stopped) stopped.style.display = (!running && !_empCompanies.length) ? 'block' : 'none';
  // «open» needs the system running; «copy» always works
  for (const bid of ['open-lan-employee-url', 'open-employee-url']) { const b = $(bid); if (b) b.disabled = !running; }
  const portal = $('btn-open-cloud'); if (portal) portal.disabled = !running;
}
function fillCompanySelect(companies) {
  const sel = $('link-company');
  if (!sel) return;
  sel.textContent = '';
  if (!companies.length) { const o = document.createElement('option'); o.value = ''; o.textContent = '—'; sel.appendChild(o); return; }
  for (const c of companies) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); }
}
// the last known company list (display only: names for a stopped system), kept in this window's storage
const CACHE_KEY = 'texacore.launcher.companies';
function loadCachedCompanies() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const list = raw ? JSON.parse(raw) : null;
    if (Array.isArray(list) && list.length && list.every((c) => c && typeof c.id === 'string' && typeof c.name === 'string')) {
      _empCompanies = list.slice(0, 50);
      fillCompanySelect(_empCompanies);
      setChosenCompany(_empCompanies[0].id);
      return;
    }
  } catch { /* storage blocked: fine */ }
  fillCompanySelect([]);
}
function saveCachedCompanies(list) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(list.slice(0, 50).map((c) => ({ id: c.id, name: c.name })))); } catch { /* storage blocked */ }
}
async function refreshEmployeesBox(state) {
  if (_empRefreshing) return;
  if (!(state || currentState).containerRunning) { renderLinks(state || currentState); return; }
  if (_empListed && _empCompanies.length && Date.now() - _empLast < 30000) return;     // the company list rarely changes; the poll runs every ~5 s
  _empRefreshing = true;
  _empLast = Date.now();
  try {
    const r = await window.texacore.listLocalCompanies();
    if (!r || !r.success) return;                                         // services may be down: keep what is shown
    _empListed = true;
    const companies = r.companies || [];
    const sameList = JSON.stringify(companies.map((c) => c.id)) === JSON.stringify(_empCompanies.map((c) => c.id));
    if (!companies.length) { _empCompanies = []; fillCompanySelect([]); saveCachedCompanies([]); }
    else if (!sameList) {
      const keep = chosenCompanyId();
      _empCompanies = companies;
      fillCompanySelect(companies);
      setChosenCompany(companies.some((c) => c.id === keep) ? keep : companies[0].id);
      saveCachedCompanies(companies);
    }
    renderState(state || currentState);
  } catch { /* services may be down */ } finally { _empRefreshing = false; }
}
function onEmployeeCompanyChange(sel) {
  setChosenCompany((sel && sel.value) || '');
  renderLinks(currentState);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  }
}
// Copy a link exactly as it is shown and say so on the button for a moment
async function copyLink(linkId, btnId) {
  const text = (($(linkId) && $(linkId).textContent) || '').trim();
  if (!text || text === '—') return;
  await copyText(text);
  const btn = $(btnId);
  if (btn) {
    btn.textContent = t('emp.copied'); btn.classList.add('copied');
    setTimeout(() => { btn.textContent = t('emp.copy'); btn.classList.remove('copied'); }, 1500);
  }
}

// ─── The network address (office link) and its picker ────────
function renderLanAddress(state) {
  const lan = state && state.lan;
  const addr = $('lan-addr');
  if (!addr) return;
  addr.textContent = (lan && lan.address) || (state && state.localIp) || '—';
  const ifc = $('lan-iface');
  if (ifc) ifc.textContent = lan && lan.iface ? `(${lan.iface}${lan.auto ? '' : ' · ' + t('ui.lan.chosen')})` : '';
  const sel = $('lan-select');
  if (sel && lan && Array.isArray(lan.candidates) && !_lanPickerBusy) {
    const sig = JSON.stringify([lan.candidates.map((c) => c.address), lan.auto, lan.address]);
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig;
      sel.textContent = '';
      const auto = document.createElement('option'); auto.value = ''; auto.textContent = `${t('ui.lan.auto')} (${(lan.auto ? lan.address : '') || '—'})`;
      sel.appendChild(auto);
      for (const c of lan.candidates) {
        const o = document.createElement('option'); o.value = c.address;
        o.textContent = `${c.address} — ${c.name}${c.virtual ? ' · ' + t('ui.lan.virtual') : ''}`;
        sel.appendChild(o);
      }
      sel.value = lan.auto ? '' : lan.address;
    }
    const hint = $('lan-pick-hint');
    if (hint) hint.textContent = lan.candidates.length > 1 ? t('ui.lan.pickHint') : t('ui.lan.onlyOne');
  }
}
let _lanPickerBusy = false;
function toggleLanPicker() {
  const p = $('lan-picker'), b = $('btn-lan-change');
  if (!p) return;
  const show = p.style.display === 'none' || !p.style.display;
  p.style.display = show ? 'flex' : 'none';
  if (b) b.setAttribute('aria-expanded', show ? 'true' : 'false');
  if (show) { const s = $('lan-select'); if (s) s.focus(); }
}
async function onLanPick(value) {
  _lanPickerBusy = true;
  try {
    const r = await texacore.setLanAddress(value || '');
    if (r && r.success) { if (currentState) { currentState.lan = r.lan; currentState.localIp = r.lan.address; } const s = $('lan-select'); if (s) s.dataset.sig = ''; showToast(t('ui.lan.saved')); }
    else showToast((r && r.error) || t('ui.lan.failed'));
  } catch (e) { showToast(e.message); }
  _lanPickerBusy = false;
  renderState(currentState);
}

// ─── Cloud access ("من أي مكان") ─────────────────────────────
// role="switch" needs aria-checked to follow the real state (set programmatically from the saved config, and by every click / Space press)
function syncSwitch(el) {
  const i = el || $('input-cloud');
  if (i) i.setAttribute('aria-checked', i.checked ? 'true' : 'false');
  const lab = $('cloud-switch-label');         // the word beside the switch always agrees with it: «مفعّل» / «متوقف»
  if (lab && i) lab.textContent = t(i.checked ? 'ui.cloud.enabled' : 'ui.cloud.disabled');
}
document.addEventListener('i18n-applied', () => { try { syncSwitch(); } catch { /* page not ready */ } });
let _verifiedAliveSubdomain = null;  // cache: skip re-checking a subdomain we already confirmed alive
let _deletedSubdomain = null;        // a saved subdomain confirmed deleted — keeps the render on the setup view
function renderCloud(state) {
  const cfg = state.config || {};
  const enabled = !!cfg.enableCloud;
  const sw = $('input-cloud');
  if (sw && document.activeElement !== sw) sw.checked = enabled;
  syncSwitch();
  const on = sw ? sw.checked : enabled;
  $('cloud-content').style.display = on ? 'flex' : 'none';
  $('cloud-off-note').style.display = on ? 'none' : 'block';
  $('chip-tunnel').style.display = on ? 'inline-flex' : 'none';

  if (cfg.subdomain && _deletedSubdomain !== cfg.subdomain) {
    const inp = $('input-subdomain');
    if (!_tunnelNameTaken && inp && document.activeElement !== inp) inp.value = cfg.subdomain;     // name_taken: leave the field to the user (choose another name)
    $('cloud-setup').style.display = _tunnelNameTaken ? 'flex' : 'none';
    $('cloud-active').style.display = 'flex';
    $('cloud-url').textContent = `https://${cfg.subdomain}.texacore.ai`;
    $('cloud-url').dataset.url = `https://${cfg.subdomain}.texacore.ai`;
    $('cloud-url').title = `https://${cfg.subdomain}.texacore.ai`;
    // the saved subdomain may have been deleted from the cloud: verify it still resolves (cached; retried on error)
    verifyCloudSubdomain(cfg.subdomain);
  } else {
    $('cloud-setup').style.display = 'flex';
    $('cloud-active').style.display = 'none';
    if (cfg.subdomain && _deletedSubdomain === cfg.subdomain) {
      const warn = $('subdomain-deleted-warning');
      if (warn) { setWithIcon(warn, 'triangle-alert', t('subdomain.deleted')); warn.style.display = 'block'; }
      const inp = $('input-subdomain');
      if (inp && !inp.value) { inp.value = cfg.subdomain; checkSubdomain(cfg.subdomain); }
    }
  }
}
// Verify the configured subdomain still exists. On a definitive "deleted" result, switch from the active view to setup, surface a warning and pre-fill the old name.
async function verifyCloudSubdomain(subdomain) {
  if (!subdomain || !window.texacore || !window.texacore.verifySubdomain) return;
  if (_verifiedAliveSubdomain === subdomain) return;  // already confirmed — avoid a DNS lookup every poll
  try {
    const r = await texacore.verifySubdomain();
    if (r && r.valid === false && r.reason === 'deleted') {
      _verifiedAliveSubdomain = null;
      _deletedSubdomain = subdomain;
      $('cloud-active').style.display = 'none';
      $('cloud-setup').style.display = 'flex';
      const warn = $('subdomain-deleted-warning');
      if (warn) { setWithIcon(warn, 'triangle-alert', t('subdomain.deleted')); warn.style.display = 'block'; }
      const inp = $('input-subdomain');
      if (inp) { inp.value = subdomain; checkSubdomain(subdomain); }
    } else if (r && r.valid === true) {
      _verifiedAliveSubdomain = subdomain;
      if (_deletedSubdomain === subdomain) _deletedSubdomain = null;
    }
  } catch { /* network / verify error — keep the active view, retry next refresh */ }
}

// The connection status comes from the REAL connector state (main → ServiceManager.getTunnelStatus → tunnel-monitor.js): «connected» only when
// cloudflared is running AND has logged a registered tunnel connection. 2.0.0 showed «connected» whenever the services ran, even with no cloudflared at all.
function renderTunnelStatus(state) {
  const el = $('tunnel-status');
  const det = $('tunnel-detail');
  if (!el) return;
  const tn = state && state.tunnel;
  let text; let color; let ico; let detail = ''; let chip = 'bad';
  if (!state || !state.containerRunning || !tn || !tn.enabled) {
    text = t('cloud.disconnected'); color = 'var(--danger-text)'; ico = 'circle-x';
  } else if (tn.state === 'connected') {
    text = t('cloud.connected'); color = 'var(--url)'; ico = 'circle-check'; chip = 'ok';
  } else if (tn.state === 'starting') {
    text = tn.reason === 'repairing' ? t('cloud.repairing') : tn.reason === 'verifying_route' ? t('cloud.verifying') : t('cloud.connecting'); color = 'var(--warning)'; ico = 'loader'; chip = 'warn';
  } else if (tn.state === 'route_mismatch') {
    text = t('cloud.st.routeMismatch'); color = 'var(--danger-text)'; ico = 'triangle-alert';
    detail = tn.detail || '';
  } else if (tn.state === 'connected_unverified') {
    text = t('cloud.st.unverified'); color = 'var(--warning)'; ico = 'triangle-alert'; chip = 'warn';
    detail = tn.detail || '';
  } else if (tn.state === 'name_taken') {
    text = t('cloud.st.nameTaken'); color = 'var(--danger-text)'; ico = 'triangle-alert';
  } else if (tn.state === 'error') {
    text = (t('cloud.err.' + tn.reason) !== 'cloud.err.' + tn.reason ? t('cloud.err.' + tn.reason) : t('cloud.disconnected')); color = 'var(--danger-text)'; ico = 'circle-x';
    detail = tn.detail || '';
  } else if (tn.reason === 'subdomain_deleted') {
    text = t('cloud.off.subdomain_deleted'); color = 'var(--danger-text)'; ico = 'triangle-alert';
  } else {
    text = t('cloud.disconnected'); color = 'var(--danger-text)'; ico = 'circle-x';
  }
  // the chip carries a short word; the long reason lives in the red box below the links
  const short = (tn && tn.enabled && state.containerRunning && ['error', 'route_mismatch', 'name_taken'].includes(tn.state)) ? t('cloud.disconnected') : text;
  setWithIcon(el, ico, tn && tn.state === 'connected' ? text : short, 16, ico === 'loader' ? 'icon-lead spin' : 'icon-lead');
  el.style.color = color;
  el.dataset.tunnelState = tn ? `${tn.state}${tn.reason ? ':' + tn.reason : ''}` : 'none';
  el.dataset.tunnelIcon = ico;
  const chipEl = $('chip-tunnel');
  // a stopped system is not a broken tunnel: the chip stays neutral until the system runs
  if (chipEl) chipEl.className = 'chip chip-sm ' + (state && state.containerRunning ? chip : '');
  if (det) { det.textContent = detail; det.style.display = detail ? 'block' : 'none'; }
  renderTunnelFix(tn, !!(state && state.containerRunning && tn && tn.enabled), text);
}

// 2.0.2: «connected» is shown only when the public link was PROVEN to reach this computer (tunnel-route.js). When it does not (route_mismatch), cannot be verified
// (connected_unverified) or the name belongs to an earlier licence (name_taken), the red box says why in words and offers «إصلاح الرابط». RC2: when the connector is simply
// down (stopped, exited, a transient error) it offers «إعادة الاتصال» (the fast reconnect: same tunnel id). For a taken name the subdomain field is shown too.
let _tunnelNameTaken = false;       // while true the setup view (the subdomain input) stays visible beside the active view
function tunnelRepairMessage(r) {
  if (!r || !r.outcome) return '';
  const key = 'cloud.repair.' + r.outcome;
  if (r.outcome === 'taken') return t(r.reason === 'quarantined' ? 'cloud.nameTakenQuarantined' : 'cloud.nameTaken');
  if (t(key) === key) return '';
  return t(key).replace('{min}', String(Math.max(1, Math.ceil((r.retryAfterSec || 60) / 60))));
}
function renderTunnelFix(tn, active, statusText) {
  const box = $('tunnel-fix-box');
  if (!box) return;
  const btn = $('btn-fix-link');
  const recon = $('btn-reconnect');
  const msg = $('tunnel-route-msg');
  const rep = $('tunnel-repair-msg');
  const st = active && tn ? tn.state : null;
  let line = '';
  if (st === 'route_mismatch') line = t('cloud.route.' + tn.reason) !== 'cloud.route.' + tn.reason ? t('cloud.route.' + tn.reason) : t('cloud.route.no_route');
  else if (st === 'connected_unverified') line = (t('cloud.unverified.' + tn.reason) !== 'cloud.unverified.' + tn.reason) ? t('cloud.unverified.' + tn.reason) : t('cloud.connectedUnverified');
  else if (st === 'name_taken') line = t(tn.reason === 'quarantined' ? 'cloud.nameTakenQuarantined' : 'cloud.nameTaken');
  else if (st === 'starting' && tn.reason === 'repairing') line = t('cloud.repairing');
  else if (active && tn && st !== 'connected' && st !== 'starting') line = (statusText && statusText !== t('cloud.disconnected')) ? statusText : t('ui.cloud.downText');
  const show = !!line;
  box.style.display = show ? 'flex' : 'none';
  if (msg) msg.textContent = line;
  const canFix = st === 'route_mismatch' || st === 'name_taken';
  const canReconnect = !!(active && tn && !canFix && st !== 'connected' && st !== 'starting' && st !== 'connected_unverified');
  if (btn) { btn.style.display = canFix ? 'inline-flex' : 'none'; btn.disabled = !!(tn && tn.repairing) || _repairBusy; }
  if (recon) { recon.style.display = canReconnect ? 'inline-flex' : 'none'; recon.disabled = _reconnectBusy; }
  // what the last repair attempt said (kept for 10 minutes; «fixed» only while the link is fine)
  const r = tn && tn.repair;
  const fresh = r && (Date.now() - r.at < 10 * 60 * 1000);
  const rtext = fresh && (r.outcome !== 'fixed' || st === 'connected') ? tunnelRepairMessage(r) : '';
  if (rep) { rep.textContent = rtext; rep.style.display = rtext ? 'block' : 'none'; }
  if (rtext && r.outcome === 'fixed') box.style.display = 'flex';
  _tunnelNameTaken = st === 'name_taken';
  const setup = $('cloud-setup');
  if (setup && _tunnelNameTaken) setup.style.display = 'flex';
  else if (setup && !_tunnelNameTaken && _nameTakenForcedSetup && currentState && currentState.config && currentState.config.subdomain) setup.style.display = 'none';
  _nameTakenForcedSetup = _tunnelNameTaken;
  box.dataset.tunnelFix = st || 'none';
}
let _nameTakenForcedSetup = false;
let _repairBusy = false;
let _reconnectBusy = false;
async function repairTunnelLink() {
  const btn = $('btn-fix-link');
  const rep = $('tunnel-repair-msg');
  if (_repairBusy || !window.texacore || !window.texacore.repairTunnelLink) return;
  _repairBusy = true;
  if (btn) { btn.disabled = true; setWithIcon(btn, 'loader', t('cloud.repairing'), 16, 'icon-lead spin'); }
  try {
    const r = await window.texacore.repairTunnelLink();
    const text = tunnelRepairMessage(r);
    if (rep && text) { rep.textContent = text; rep.style.display = 'block'; }
  } catch (e) {
    if (rep) { rep.textContent = t('cloud.repair.network'); rep.style.display = 'block'; }
  } finally {
    _repairBusy = false;
    if (btn) { btn.textContent = t('cloud.fixBtn'); btn.disabled = false; }
    refreshStatus();
  }
}
// «إعادة الاتصال»: the same fast reconnect the switch does (reuse the existing tunnel token, same tunnel id)
async function reconnectTunnel() {
  const btn = $('btn-reconnect');
  if (_reconnectBusy || !window.texacore || !window.texacore.setCloudAccess) return;
  _reconnectBusy = true;
  if (btn) { btn.disabled = true; setWithIcon(btn, 'loader', t('cloud.connecting'), 16, 'icon-lead spin'); }
  try {
    await window.texacore.setCloudAccess(true);
  } catch (e) { showToast(t('cloud.toggleFailed')); }
  _reconnectBusy = false;
  if (btn) { btn.textContent = t('ui.cloud.reconnect'); btn.disabled = false; }
  await refreshStatus();
  for (const ms of [1500, 4000, 9000]) setTimeout(() => { refreshStatus(); }, ms);
}
async function toggleCloudView() {
  syncSwitch();
  const isChecked = $('input-cloud').checked;
  $('cloud-content').style.display = isChecked ? 'flex' : 'none';
  $('cloud-off-note').style.display = isChecked ? 'none' : 'block';
  $('chip-tunnel').style.display = isChecked ? 'inline-flex' : 'none';
  // Actually enable/disable cloud access — start/stop the Cloudflare tunnel NOW (not just show/hide the panel). Turning it off cuts the public subdomain.
  const statusEl = $('tunnel-status');
  try {
    if (statusEl) {
      setWithIcon(statusEl, 'loader', isChecked ? t('cloud.connecting') : t('cloud.disconnecting'), 16, 'icon-lead spin');
      statusEl.style.color = 'var(--warning)';
    }
    if (window.texacore && window.texacore.setCloudAccess) {
      await window.texacore.setCloudAccess(isChecked);
      if (currentState && currentState.config) currentState.config.enableCloud = isChecked;
    }
    // never assume «connected»: ask for the real state now and again while it settles (the periodic poll continues afterwards)
    await refreshStatus();
    for (const ms of [1500, 4000, 9000]) setTimeout(() => { refreshStatus(); }, ms);
  } catch (e) {
    console.error('[Cloud] setCloudAccess failed:', e);
    if (statusEl) { setWithIcon(statusEl, 'triangle-alert', t('cloud.toggleFailed')); statusEl.style.color = 'var(--danger-text)'; }
  }
}

let checkTimeout;
function checkSubdomain(value) {
  const statusEl = $('domain-status');
  const btn = $('btn-register-domain');
  if (!value) {
    statusEl.textContent = t('subdomain.prompt');
    statusEl.style.color = 'var(--muted)';
    btn.disabled = true;
    return;
  }
  const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (cleaned !== value || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    setWithIcon(statusEl, 'circle-x', t('subdomain.onlyLatin'));
    statusEl.style.color = 'var(--danger-text)';
    btn.disabled = true;
    return;
  }
  setWithIcon(statusEl, 'loader', t('subdomain.checking'), 16, 'icon-lead spin');
  statusEl.style.color = 'var(--warning)';
  btn.disabled = true;
  clearTimeout(checkTimeout);
  checkTimeout = setTimeout(async () => {
    try {
      const res = await fetch('https://wzkklenfsaepegymfxfz.supabase.co/functions/v1/check-subdomain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain: value })
      });
      const data = await res.json();
      if (data.available) {
        setWithIcon(statusEl, 'circle-check', t('subdomain.available'));
        statusEl.style.color = 'var(--url)';
        btn.disabled = false;
      } else {
        const reason = data.reason === 'reserved' ? t('subdomain.reservedName') :
                       data.reason === 'taken' ? t('subdomain.taken') :
                       data.reason === 'invalid_format' ? t('subdomain.badFormat') : t('subdomain.unavailable');
        setWithIcon(statusEl, 'circle-x', reason);
        statusEl.style.color = 'var(--danger-text)';
        btn.disabled = true;
      }
    } catch (err) {
      // offline fallback — allow registration (the server validates)
      setWithIcon(statusEl, 'triangle-alert', t('subdomain.checkFailed'));
      statusEl.style.color = 'var(--warning)';
      btn.disabled = false;
    }
  }, 600);
}

async function registerSubdomain() {
  const input = $('input-subdomain');
  const btn = $('btn-register-domain');
  const statusEl = $('domain-status');
  if (!input.value) return;
  btn.disabled = true;
  setWithIcon(btn, 'loader', t('subdomain.reserving'), 16, 'spin');
  try {
    const result = await window.texacore.registerSubdomain(input.value);
    if (result.success) {
      if (!currentState.config) currentState.config = {};
      currentState.config.subdomain = input.value;
      currentState.config.enableCloud = true;
      // just registered → clear any "deleted" state and trust it as alive (the new DNS record may take a moment to propagate)
      _deletedSubdomain = null;
      _verifiedAliveSubdomain = input.value;
      const delWarn = $('subdomain-deleted-warning');
      if (delWarn) delWarn.style.display = 'none';
      $('cloud-setup').style.display = 'none';
      $('cloud-active').style.display = 'flex';
      $('cloud-url').textContent = result.url || `https://${input.value}.texacore.ai`;
      renderLinks(currentState);
      btn.textContent = t('subdomain.registerBtn');
      showToast(t('subdomain.reserved'), 5000);
    } else {
      setWithIcon(statusEl, 'circle-x', result.error);
      statusEl.style.color = 'var(--danger-text)';
      btn.textContent = t('subdomain.registerNow');
      btn.disabled = false;
    }
  } catch (err) {
    setWithIcon(statusEl, 'circle-x', err.message);
    statusEl.style.color = 'var(--danger-text)';
    btn.textContent = t('subdomain.registerNow');
    btn.disabled = false;
  }
}

// ─── Admin portal password (بوابة الإدارة) — a dialog ───────
async function saveAdminPassword() {
  const input = $('input-admin-password');
  const statusEl = $('admin-password-status');
  const btn = $('btn-save-admin-password');
  const val = (input && input.value || '').trim();
  const n = adminMinLength;
  if (val.length < n) {
    if (statusEl) { setWithIcon(statusEl, 'triangle-alert', t('admin.tooShort').replace('{n}', n)); statusEl.style.color = 'var(--danger-text)'; }
    return;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    const res = await window.texacore.setAdminPassword(val);
    if (res && res.success) {
      if (input) input.value = '';
      if (statusEl) { setWithIcon(statusEl, 'circle-check', t('admin.savedOk')); statusEl.style.color = 'var(--url)'; }
      // close the dialog shortly after a successful change
      setTimeout(() => { const ov = $('overlay-password'); if (ov && ov.style.display === 'flex') toggleAdminPasswordPanel(); }, 1600);
    } else {
      const key = res && res.code ? 'admin.err.' + res.code : null;
      const msg = key && t(key) !== key ? t(key).replace('{n}', (res && res.minLength) || adminMinLength) : ((res && res.error) || t('admin.saveFailed'));
      if (statusEl) { setWithIcon(statusEl, 'triangle-alert', msg); statusEl.style.color = 'var(--danger-text)'; }
    }
  } catch (e) {
    if (statusEl) { setWithIcon(statusEl, 'triangle-alert', e.message); statusEl.style.color = 'var(--danger-text)'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('common.save'); }
  }
}

// The password policy has ONE source (src/admin-password.js, enforced by ServiceManager.setAdminPassword); the window only words it.
let adminMinLength = 8;
let adminStatus = null;
function applyAdminPolicyTexts() {
  const input = $('input-admin-password');
  if (input) input.placeholder = t('admin.placeholder').replace('{n}', adminMinLength);
  const statusEl = $('admin-password-status');
  if (statusEl && adminStatus && adminStatus.success) {
    const key = adminStatus.customized ? 'admin.statusCustom' : (adminStatus.hasDefault ? 'admin.statusDefault' : 'admin.statusNone');
    setWithIcon(statusEl, adminStatus.customized || !adminStatus.hasDefault ? 'lock' : 'info', t(key).replace('{n}', adminMinLength));
    statusEl.style.color = 'var(--muted)';
  }
}
document.addEventListener('i18n-applied', applyAdminPolicyTexts);
async function refreshAdminPasswordStatus() {
  const statusEl = $('admin-password-status');
  if (!statusEl || !window.texacore || !window.texacore.getAdminPasswordStatus) return;
  try {
    const s = await window.texacore.getAdminPasswordStatus();
    if (s && s.success) {
      adminStatus = s;
      if (Number.isInteger(s.minLength) && s.minLength > 0) adminMinLength = s.minLength;
      applyAdminPolicyTexts();
    }
  } catch { /* ignore */ }
}
// «تغيير كلمة مرور البوابة» opens the dialog; the same call closes it (Esc too)
function toggleAdminPasswordPanel() {
  const overlay = $('overlay-password');
  if (!overlay) return;
  const show = overlay.style.display !== 'flex';
  overlay.style.display = show ? 'flex' : 'none';
  if (show) {
    refreshAdminPasswordStatus();
    setTimeout(() => { const i = $('input-admin-password'); if (i) i.focus(); }, 50);
  } else {
    const b = $('btn-toggle-admin-password'); if (b) b.focus();
  }
}

// ─── Licence tab ─────────────────────────────────────────────
let _licensePanelOpen = false;     // «إدخال مفتاح»: the activation form shown over an active licence
function renderLicense(state) {
  const lv = licenseView(state);
  const has = !!state.hasLicense;
  const li = state.licenseInfo;
  const showPanel = !has || _licensePanelOpen;
  $('panel-license').style.display = showPanel ? 'flex' : 'none';
  $('license-active').style.display = (has && !_licensePanelOpen) ? 'flex' : 'none';
  $('license-actions').style.display = showPanel ? 'none' : 'flex';
  $('btn-cancel-license').style.display = (has && _licensePanelOpen) ? 'inline-block' : 'none';
  $('license-expired-note').style.display = has ? 'none' : 'flex';
  if (!has && state.config && state.config.licenseKey && document.activeElement !== $('input-license') && !$('input-license').value) $('input-license').value = state.config.licenseKey;

  // tier chip
  const chip = $('badge-tier-chip'); const tier = $('badge-tier');
  let chipCls = 'chip chip-sm push'; let tierText = '';
  if (lv.kind === 'trial') { chipCls += ' warn'; tierText = t('ui.tier.trial'); }
  else if (lv.kind === 'free') { chipCls += ' ok'; tierText = t('ui.tier.free'); }
  else if (lv.kind === 'expired' || lv.kind === 'none') { chipCls += ' bad'; tierText = lv.kind === 'expired' ? t('ui.chip.expired') : t('status.inactive'); }
  else { chipCls += ' ok'; tierText = String(lv.tier || 'PRO').toUpperCase(); }
  if (chip) chip.className = chipCls;
  if (tier) tier.textContent = tierText;

  // days left + bar + the sentence
  const days = $('badge-days'); const exp = $('badge-expires'); const meter = $('license-meter'); const fill = $('license-meter-fill'); const desc = $('license-desc');
  if (lv.kind === 'free' || lv.kind === 'paid-open') {
    days.textContent = t('license.neverExpires'); exp.textContent = '';
    meter.style.display = 'none';
    desc.textContent = lv.kind === 'free' ? t('ui.license.freeDesc') : t('ui.license.paidDesc');
  } else if (lv.daysLeft !== null && li) {
    const n = Math.max(0, lv.daysLeft);
    days.textContent = fillText(lv.kind === 'trial' ? t('ui.license.daysLeftOf') : t('ui.license.daysLeft'), { n, d: daysWord(n), total: lv.total });
    exp.textContent = `${t('ui.license.ends')} ${fmtDate(new Date(lv.expires), { day: 'numeric', month: 'long', year: 'numeric' })}`;
    meter.style.display = 'block';
    const used = Math.max(0, Math.min(100, Math.round(((lv.total - n) / lv.total) * 100)));
    fill.style.width = used + '%';
    fill.className = 'meter-fill' + (n <= 3 ? ' bad' : (lv.kind === 'trial' ? '' : ' ok'));
    meter.setAttribute('aria-label', fillText(t('ui.license.meterAria'), { used: lv.total - n, total: lv.total }));
    desc.textContent = lv.kind === 'trial' ? t('ui.license.trialDesc') : t('ui.license.paidDesc');
  } else {
    days.textContent = '—'; exp.textContent = ''; meter.style.display = 'none'; desc.textContent = '';
  }
  // the support code = the full licence key (for fast support / activation / extension)
  const codeEl = $('support-code');
  if (codeEl && li && li.license_key) { codeEl.textContent = li.license_key; codeEl.title = li.license_key; }
}
// kept under its old name: the support card and the tests refer to the licence row by it
function updateControlPanel(state) { renderState(state); }

// Copy the support code (licence key) to the clipboard, with a fallback.
function copySupportCode() {
  const code = (($('support-code') && $('support-code').textContent) || '').trim();
  if (!code || code === '—') return;
  const flash = () => {
    const btn = $('btn-copy-key');
    if (btn) { btn.textContent = t('common.copied'); btn.classList.add('copied'); setTimeout(() => { btn.textContent = t('common.copy'); btn.classList.remove('copied'); }, 1500); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(flash).catch(() => fallbackCopy(code, flash));
  else fallbackCopy(code, flash);
}
function fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    if (done) done();
  } catch { /* ignore */ }
}

function showLicensePanel() {
  _licensePanelOpen = true;
  renderState(currentState);
  const i = $('input-license'); if (i) i.focus();
}
function hideLicensePanel() { _licensePanelOpen = false; renderState(currentState); }

async function activateLicense() {
  const input = $('input-license');
  const btn = $('btn-activate');
  const feedback = $('feedback-license');
  const key = input.value.trim();
  if (!key) {
    feedback.className = 'feedback error';
    feedback.textContent = t('license.errNoKey');
    input.focus();
    return;
  }
  btn.disabled = true;
  setWithIcon(btn, 'loader', t('license.activating'), 16, 'icon-lead spin');
  feedback.className = 'feedback loading';
  feedback.textContent = t('license.connectingLicense');
  try {
    const result = await texacore.activateLicense(key);
    if (result.success) {
      feedback.className = 'feedback success';
      feedback.textContent = `${t('license.activatedOk')} ${result.license.tier} — ${t('license.expiresPrefix')} ${new Date(result.license.expires_at).toLocaleDateString()}`;
      _licensePanelOpen = false;
      await restartSystemForLicense();       // every licence change is paired with a real stop → start so the new plan applies with no stale state
    } else {
      feedback.className = 'feedback error';
      feedback.textContent = `${t('license.activateFailed')} ${result.error}`;
    }
  } catch (err) {
    feedback.className = 'feedback error';
    feedback.textContent = `${t('common.errorPrefix')} ${err.message}`;
  }
  btn.disabled = false;
  btn.textContent = t('license.activateBtn');
}

async function startTrial() {
  const btn = $('btn-trial');
  const feedback = $('feedback-license');
  btn.disabled = true;
  setWithIcon(btn, 'loader', t('trial.creating'), 16, 'icon-lead spin');
  feedback.className = 'feedback loading';
  feedback.textContent = t('trial.connecting');
  try {
    const result = await texacore.startTrial();
    if (result.success) {
      feedback.className = 'feedback success';
      feedback.textContent = result.existing ? t('trial.alreadyHave') : t('trial.activated');
      _licensePanelOpen = false;
      await restartSystemForLicense();
    } else {
      feedback.className = 'feedback error';
      feedback.textContent = `${result.error}`;
    }
  } catch (err) {
    feedback.className = 'feedback error';
    feedback.textContent = `${t('common.errorPrefix')} ${err.message}`;
  }
  btn.disabled = false;
  btn.textContent = t('license.trialBtn');
}

async function startFree() {
  const btn = $('btn-free');
  const feedback = $('feedback-license');
  btn.disabled = true;
  setWithIcon(btn, 'loader', t('free.creating'), 16, 'icon-lead spin');
  feedback.className = 'feedback loading';
  feedback.textContent = t('free.activating');
  try {
    const result = await texacore.startFree();
    if (result.success) {
      feedback.className = 'feedback success';
      feedback.textContent = t('free.activated');
      _licensePanelOpen = false;
      await restartSystemForLicense();
    } else {
      feedback.className = 'feedback error';
      feedback.textContent = `${result.error}`;
    }
  } catch (err) {
    feedback.className = 'feedback error';
    feedback.textContent = `${t('common.errorPrefix')} ${err.message}`;
  }
  btn.disabled = false;
  btn.textContent = t('license.freeBtn');
}

// ─── Support card: version, port (advanced), updates, the run log ───────────
let _portDirty = false;
function renderSupport(state) {
  const cfgPort = state.config && parseInt(state.config.port, 10);
  const input = $('input-port');
  if (input && cfgPort && !_portDirty && document.activeElement !== input) input.value = cfgPort;
  onPortChange(true);
}
// editing the port while the system runs: it only takes effect after a restart - say so and offer it
function onPortChange(fromRender) {
  const input = $('input-port');
  if (!input) return;
  const running = !!(currentState && currentState.containerRunning);
  const cfgPort = currentState && currentState.config && parseInt(currentState.config.port, 10);
  const val = parseInt(input.value, 10);
  if (!fromRender) _portDirty = !!val && val !== cfgPort;
  const valid = Number.isInteger(val) && val >= 1 && val <= 65535;
  const changed = valid && !!cfgPort && val !== cfgPort;
  $('btn-apply-port').style.display = (running && changed) ? 'inline-flex' : 'none';
  const hint = $('port-hint');
  hint.style.display = (changed || !valid) ? 'block' : 'none';
  hint.textContent = !valid ? t('ui.port.invalid') : (running ? t('ui.port.hint') : t('ui.port.hintStopped'));
}
async function applyPortChange() {
  const input = $('input-port');
  const val = parseInt(input.value, 10);
  if (!(Number.isInteger(val) && val >= 1 && val <= 65535)) { onPortChange(); return; }
  $('btn-apply-port').disabled = true;
  _portDirty = false;
  await restartServices({ port: val });
  $('btn-apply-port').disabled = false;
  onPortChange(true);
}
async function checkForUpdateNow() {
  const out = $('update-check-result');
  const btn = $('btn-check-update');
  if (btn) btn.disabled = true;
  if (out) out.textContent = t('ui.update.checking');
  try {
    const r = await texacore.checkForUpdate();
    if (out) out.textContent = r && r.available ? fillText(t('ui.update.found'), { v: r.version || '' }) : t('ui.update.none');
  } catch { if (out) out.textContent = t('ui.update.failed'); }
  if (btn) btn.disabled = false;
  setTimeout(() => { if (out) out.textContent = ''; }, 8000);
}
async function openRunLog() {
  try { const r = await texacore.openRunLog(); if (r && !r.success) showToast(r.error || t('ui.support.logFailed')); }
  catch (e) { showToast(e.message); }
}

// ─── Files tab ───────────────────────────────────────────────
// «Where is my data» (2.0.5): the ONE live company file, with «show in Finder», when it was last in step, a failure that stays visible, «sync now»,
// «change location», the newest backups and «backup now». Text only goes in through textContent (a path is data, never markup).
function liveFileView(st, companyCount) {
  const live = st && typeof st.liveFile === 'string' && st.liveFile ? st.liveFile : '';
  if (!live) return null;
  const primary = ((st && st.targets) || []).find((x) => x.role === 'primary') || null;
  const n = Number.isFinite(companyCount) ? companyCount : 0;
  const planned = Number(st && st.plannedCompanies) || 0;
  return {
    path: live,
    label: n > 1 ? t('live.many').replace('{n}', String(n)) : t('live.single'),
    note: planned > 0 ? t('live.planned').replace('{n}', String(planned)) : (primary && primary.exists === false && !primary.lastSuccess ? t('live.notYet') : ''),
    canReveal: !!(primary && primary.exists),
  };
}
// iCloud Drive and Documents are the two places the default no longer uses: a file there keeps its notice (iCloud may not keep it on this computer;
// macOS may ask for the Documents permission again after an update)
function pathArea(p) {
  const s = String(p || '').replace(/\\/g, '/');
  if (/\/Library\/Mobile Documents\//i.test(s) || /\/iCloud Drive\//i.test(s)) return 'icloud';
  if (/\/Documents(\/|$)/i.test(s)) return 'documents';
  return null;
}
function renderLiveFile(st) {
  const v = liveFileView(st, typeof _empCompanies !== 'undefined' ? _empCompanies.length : 0);
  const pathEl = $('live-file-path');
  const label = $('live-file-label');
  const btn = $('btn-live-file-show');
  const noteEl = $('live-file-note');
  const area = $('files-icloud');
  const def = $('files-default-note');
  if (!pathEl) return;
  if (!v) {
    pathEl.textContent = '—'; pathEl.title = '';
    if (btn) btn.disabled = true;
    if (area) area.style.display = 'none';
    if (def) def.style.display = 'flex';
    return;
  }
  label.textContent = _empCompanies.length > 1 ? fillText(t('ui.files.descMany'), { n: _empCompanies.length }) : t('ui.files.desc');
  pathEl.textContent = v.path; pathEl.title = v.path;
  noteEl.textContent = v.note; noteEl.style.display = v.note ? 'block' : 'none';
  $('live-file-show-label').textContent = bkRevealLabel();
  btn.disabled = !v.canReveal;
  btn.onclick = () => { window.texacore.revealBackup(v.path); };
  const a = pathArea(v.path);
  if (area) { area.textContent = a === 'icloud' ? t('bk.cloudICloud') : a === 'documents' ? t('ui.files.documentsNote') : ''; area.style.display = a ? 'block' : 'none'; }
  if (def) def.style.display = a ? 'none' : 'flex';
}
document.addEventListener('i18n-applied', () => { try { if (typeof _lastBackupStatus !== 'undefined' && _lastBackupStatus) renderLiveFile(_lastBackupStatus); renderSyncChip(_lastBackupStatus); renderRecentBackups(_lastRecent); } catch { /* ignore */ } });
let _lastBackupStatus = null;
let _lastRecent = null;
function bkAgo(iso) {
  if (!iso) return t('bk.never');
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return t('bk.justNow');
  if (secs < 3600) return t('bk.minutesAgo').replace('{n}', String(Math.floor(secs / 60)));
  if (secs < 86400) return t('bk.hoursAgo').replace('{n}', String(Math.floor(secs / 3600)));
  return t('bk.daysAgo').replace('{n}', String(Math.floor(secs / 86400)));
}
function bkRevealLabel() { return t('ui.files.show'); }
function renderSyncChip(st) {
  const chip = $('sync-chip'), dot = $('sync-dot'), text = $('sync-text');
  if (!chip) return;
  const tg = ((st && st.targets) || []).find((x) => x.role === 'primary') || ((st && st.targets) || [])[0];
  let cls = 'chip chip-sm push', d = 'dot', tx = '—';
  if (!tg) { tx = t('ui.sync.none'); }
  else if (tg.state === 'error') { cls += ' bad'; d += ' red'; tx = t('ui.sync.failed'); }
  else if (tg.state === 'syncing') { cls += ' warn'; d += ' blue'; tx = t('bk.syncing'); }
  else if (tg.state === 'pending') { d += ' yellow'; tx = t('bk.pending'); }
  else { cls += ' ok'; d += ' green'; tx = t('bk.last').replace('{ago}', bkAgo(tg.lastSuccess)); }
  chip.className = cls; dot.className = d; text.textContent = tx;
}
let _bkRefreshing = false;
let _bkBusy = false;
async function refreshBackupsBox() {
  if (_bkRefreshing) return;
  _bkRefreshing = true;
  try {
    const st = await window.texacore.backupStatus();
    _lastBackupStatus = st;
    renderLiveFile(st);
    renderSyncChip(st);
    const targets = (st && st.targets) || [];
    // a visible warning once it keeps failing (or any target is failing) - the reason in words
    const warn = $('bk-warn');
    const failing = targets.filter((x) => x.state === 'error');
    if (failing.length) {
      const first = failing[0];
      warn.textContent = t('bk.failed').replace('{reason}', t('bk.r.' + ((first.error && first.error.reason) || 'unknown')));
      warn.style.display = 'flex';
    } else { warn.style.display = 'none'; }
    const btn = $('btn-bk-now');
    if (btn && !_bkBusy) btn.disabled = !!st.running;
    const mv = $('btn-move-file');
    if (mv && !_moveBusy) mv.disabled = !(st && st.liveFile);
  } catch { /* services may be down */ } finally { _bkRefreshing = false; }
}
async function syncBackupsNow() {
  if (_bkBusy) return;
  _bkBusy = true;
  const btn = $('btn-bk-now');
  if (btn) { btn.disabled = true; btn.textContent = t('bk.syncing'); }
  try { await window.texacore.backupNow(); } catch { /* the chip shows the error from the status */ }
  _bkBusy = false;
  if (btn) { btn.disabled = false; btn.textContent = t('bk.syncNow'); }
  await refreshBackupsBox();
}

// the newest backups: kind · when · size · «show»
function backupWhen(ms) {
  const d = new Date(ms);
  const now = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const y = new Date(now.getTime() - 86400000);
  const hm = fmtDate(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (sameDay(d, now)) return `${t('ui.when.today')} ${hm}`;
  if (sameDay(d, y)) return `${t('ui.when.yesterday')} ${hm}`;
  return `${fmtDate(d, { day: 'numeric', month: 'long' })} ${hm}`;
}
function renderRecentBackups(r) {
  const list = $('bk-list');
  if (!list) return;
  list.textContent = '';
  const items = (r && r.items) || [];
  $('bk-empty').style.display = items.length ? 'none' : 'block';
  for (const it of items) {
    const row = document.createElement('div'); row.className = 'row'; row.dataset.kind = it.kind;
    const when = document.createElement('span'); when.className = 'row-main'; when.textContent = backupWhen(it.mtimeMs);
    const meta = document.createElement('span'); meta.className = 'muted';
    meta.textContent = `${t('ui.bk.kind.' + it.kind)} · ${fmtMB(it.size)}`;
    const show = document.createElement('button'); show.type = 'button'; show.className = 'linkbtn';
    show.textContent = t('ui.files.show');
    show.addEventListener('click', () => { window.texacore.revealBackup(it.path); });
    row.append(when, meta, show);
    list.appendChild(row);
  }
}
async function refreshRecentBackups() {
  try {
    const r = await window.texacore.listBackups(3);
    _lastRecent = r;
    renderRecentBackups(r);
  } catch { /* ignore */ }
}
async function createBackupNow() {
  const btn = $('btn-backup-now');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = t('bk.syncing');
  try {
    const r = await window.texacore.createBackup();
    if (r && r.success) showToast(fillText(t('ui.bk.done'), { size: fmtMB(r.size) }));
    else showToast(r && r.code === 'SERVICES_DOWN' ? t('ui.bk.needsSystem') : fillText(t('ui.bk.failed'), { e: (r && r.error) || '?' }), 5000);
  } catch (e) { showToast(fillText(t('ui.bk.failed'), { e: e.message }), 5000); }
  btn.disabled = false;
  btn.textContent = t('ui.bk.now');
  refreshRecentBackups();
}

// «تغيير المكان»: the main process copies the live file to a folder the owner picks, verifies the copy, switches to it and KEEPS the old file
let _moveBusy = false;
async function moveLiveFile() {
  if (_moveBusy) return;
  const out = $('move-result');
  if (!window.texacore.moveLiveFile) { out.textContent = t('ui.move.unavailable'); out.style.display = 'block'; return; }
  _moveBusy = true;
  const btn = $('btn-move-file');
  btn.disabled = true;
  out.style.display = 'block'; out.textContent = t('ui.move.working');
  try {
    const r = await window.texacore.moveLiveFile();
    if (r && r.success) {
      out.textContent = fillText(t('ui.move.done'), { to: r.to, from: r.from });
      refreshBackupsBox();
    } else if (r && r.canceled) {
      out.textContent = '';
    } else {
      const key = 'ui.move.err.' + ((r && r.code) || 'unknown');
      out.textContent = (t(key) !== key ? t(key) : fillText(t('ui.move.err.unknown'), { e: (r && r.error) || '?' }));
    }
  } catch (e) { out.textContent = fillText(t('ui.move.err.unknown'), { e: e.message }); }
  _moveBusy = false;
  btn.disabled = false;
}

// «فتح ملف…» (red zone): pick in the OS window, then open through the replace-all gate (the main process takes the pre-open backup)
async function pickAndOpenCompanyFile() {
  const st = $('open-file-status');
  const btn = $('btn-open-file');
  if (btn.disabled) return;
  btn.disabled = true;
  st.className = 'note'; st.textContent = '';
  try {
    const p = await window.texacore.pickCompanyFile();
    if (!p || !p.success) {
      if (p && !p.canceled) { st.className = 'note err'; st.textContent = fillText(t('upgrade.failed'), { e: p.error || '?' }); }
      btn.disabled = false;
      return;
    }
    st.textContent = fillText(t('ui.open.picked'), { name: p.name });
    await openPickedFile(false, st);
  } catch (e) { st.textContent = fillText(t('upgrade.failed'), { e: e.message }); }
  btn.disabled = false;
}
async function openPickedFile(confirmed, st) {
  let r;
  try { r = await window.texacore.openPickedCompanyFile(confirmed ? { confirmReplaceAll: true } : undefined); } catch (e) { r = { success: false, error: e.message }; }
  if (r && !r.success && r.code === 'REPLACE_ALL_CONFIRM_REQUIRED') {
    // nothing was touched: ask, and only an explicit yes calls again (the main process then saves a backup of the current companies first)
    if (await askReplaceAll(r)) { st.textContent = t('upgrade.opening'); return openPickedFile(true, st); }
    st.textContent = t('ui.open.canceled');
    return;
  }
  if (r && r.success) {
    const n = r.copyErrors || 0;
    st.textContent = n ? fillText(t('upgrade.doneWithErrors'), { n, f: r.copyErrorsLog || '' }) : fillText(t('upgrade.done'), { c: r.companyName || '' });
    _empLast = 0;
    try { await refreshState(); await refreshEmployeesBox(currentState); } catch { /* ignore */ }
    refreshRecentBackups();
  } else {
    st.textContent = (r && r.code === 'LEGACY_TCDB') ? t('upgrade.legacyRefused') : fillText(t('upgrade.failed'), { e: (r && r.error) || '?' });
  }
}

// ─── OTA Update Widget ───────────────────────────────────────
// Shows the automatic update from "found" to "ready", driven by the main process: 'update-status' carries the detailed download status
// (phase: downloading · paused · waiting-retry · verifying · staging · failed-verify · ready, bytes, speed, the countdown to the next try, the last
// error), and the older 'update-available' / 'update-progress' / 'update-downloaded' / 'update-not-available' events still work (Windows' own
// electron-updater download). The download itself survives drops, restarts and sleep — this widget only shows it and has three controls:
// Pause / Resume, «Retry now», and (when ready) «Restart now» / «Later» (the update still installs on quit).
(function initUpdateWidget() {
  const widget = document.getElementById('update-widget');
  if (!widget || !window.texacore?.onUpdateAvailable) return;

  const el = (id) => document.getElementById(id);
  const iconEl = el('update-icon');
  const textEl = el('update-text');
  const mbEl = el('update-mb');
  const barWrap = el('update-progress-wrap');
  const barEl = el('update-progress-bar');
  const restartBtn = el('update-restart-btn');
  const laterBtn = el('update-later-btn');
  const detailRow = el('update-detail-row');
  const detailEl = el('update-detail');
  const pauseBtn = el('update-pause-btn');
  const retryBtn = el('update-retry-btn');

  const MB = 1048576;
  let snap = { phase: 'idle' };
  let dismissed = false;
  let ticker = null;

  const iso = (x) => '⁦' + x + '⁩';                      // numbers and units keep their own direction inside an Arabic sentence
  const fill = (key, vars) => Object.keys(vars).reduce((acc, k) => acc.split('{' + k + '}').join(vars[k]), t(key));
  const fmtSize = (b) => {
    const n = Number(b) || 0;
    return n >= 1024 * MB ? `${(n / 1024 / MB).toFixed(2)} ${t('update.unitGB')}` : `${(n / MB).toFixed(1)} ${t('update.unitMB')}`;
  };
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDur = (sec) => {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  };
  const fmtWait = (sec) => (sec < 60 ? `${sec} ${t('update.secShort')}` : fmtDur(sec));

  function setCtl(btn, show, icon, label) {
    btn.style.display = show ? 'inline-flex' : 'none';
    if (show) setWithIcon(btn, icon, label, 16);
  }

  function render() {
    const phase = snap.phase || 'idle';
    if (phase === 'idle' || phase === 'checking' || (phase === 'ready' && dismissed)) {
      widget.style.display = 'none'; widget.className = 'update-widget';
      if (ticker) { clearInterval(ticker); ticker = null; }
      return;
    }
    const v = snap.version || '';
    const done = Number(snap.bytesDone) || 0;
    const total = Number(snap.bytesTotal) || 0;
    const pct = phase === 'ready' ? 100 : (typeof snap.percent === 'number' ? snap.percent : (total ? Math.floor((done / total) * 100) : 0));
    const secs = snap.nextRetryAt ? Math.max(0, Math.ceil((snap.nextRetryAt - Date.now()) / 1000)) : 0;
    const keeps = total > 0 && done > 0 ? fill('update.keeps', { done: iso(fmtSize(done)), total: iso(fmtSize(total)) }) : '';
    const reasonKey = snap.errorCode ? 'update.reason.' + snap.errorCode : '';
    const reason = reasonKey && t(reasonKey) !== reasonKey ? t(reasonKey) : '';
    const rawErr = snap.lastError ? ' ' + iso('(' + snap.lastError + ')') : '';

    let cls = '', ico = 'download', spin = false, text = '', detail = '';
    let showBar = true, showPause = false, showRetry = false, paused = false, ready = false;
    switch (phase) {
      case 'downloading': {
        text = fill('update.downloading', { v });
        const bits = [];
        if (snap.speedBps > 0) bits.push(iso(`${(snap.speedBps / MB).toFixed(1)} ${t('update.unitMBs')}`));
        if (typeof snap.etaSec === 'number') bits.push(fill('update.remaining', { t: iso(fmtDur(snap.etaSec)) }));
        detail = bits.join(' · ');
        showPause = true;
        break;
      }
      case 'paused':
        cls = 'paused'; ico = 'pause'; paused = true; showPause = true;
        text = fill('update.paused', { v });
        detail = t('update.pausedNote');
        break;
      case 'waiting-retry':
        cls = 'warn'; showPause = true; showRetry = true;
        if (snap.errorCode === 'no-space') {
          ico = 'hard-drive';
          text = fill('update.noSpace', { v });
          detail = fill('update.noSpaceNote', { need: iso(fmtSize(snap.needBytes)), free: iso(fmtSize(snap.freeBytes)) });
        } else {
          const off = snap.errorCode === 'offline' || snap.online === false;
          ico = off ? 'wifi-off' : 'clock';
          text = off ? t('update.offline') : (secs > 0 ? fill('update.waiting', { s: iso(fmtWait(secs)) }) : t('update.waitingNow'));
          detail = [reason + rawErr, keeps].filter(Boolean).join(' — ');
        }
        break;
      case 'verifying':
        ico = 'shield-check'; text = fill('update.verifying', { v }); break;
      case 'staging':
        ico = 'loader'; spin = true; text = fill('update.staging', { v }); break;
      case 'failed-verify':
        cls = 'warn'; ico = 'triangle-alert'; showRetry = true;
        text = fill('update.failedVerify', { v });
        detail = [t('update.reason.verify'), secs > 0 ? fill('update.waiting', { s: iso(fmtWait(secs)) }) : ''].filter(Boolean).join(' — ');
        break;
      case 'ready':
        cls = 'ready'; ico = 'circle-check'; ready = true; showBar = false;
        text = fill('update.ready', { v });
        break;
      default:
        text = fill('update.downloading', { v }); break;
    }

    widget.style.display = 'block';
    widget.className = 'update-widget' + (cls ? ' ' + cls : '');
    setIconOnly(iconEl, ico, 20);
    if (spin && iconEl.firstChild && iconEl.firstChild.classList) iconEl.firstChild.classList.add('spin');
    textEl.textContent = text;
    mbEl.textContent = !ready && total > 0 ? `${pct}% — ${fmtSize(done)} / ${fmtSize(total)}` : '';
    barWrap.style.display = showBar ? 'block' : 'none';
    barEl.style.width = (showBar ? pct : 0) + '%';
    detailEl.textContent = detail;
    detailRow.style.display = !ready && (detail || showPause || showRetry) ? 'flex' : 'none';
    setCtl(pauseBtn, showPause, paused ? 'play' : 'pause', t(paused ? 'update.resume' : 'update.pause'));
    setCtl(retryBtn, showRetry, 'rotate-cw', t('update.retryNow'));
    restartBtn.style.display = ready ? 'inline-flex' : 'none';
    laterBtn.style.display = ready ? 'inline-flex' : 'none';
    if (ready) { restartBtn.textContent = t('update.restartNow'); laterBtn.textContent = t('update.later'); }

    // the countdown ticks once a second while a retry is scheduled
    const counting = (phase === 'waiting-retry' || phase === 'failed-verify') && !!snap.nextRetryAt;
    if (counting && !ticker) ticker = setInterval(render, 1000);
    else if (!counting && ticker) { clearInterval(ticker); ticker = null; }
  }

  function apply(next) {
    if (!next || typeof next !== 'object') return;
    if (snap.phase === 'ready' && next.phase === 'ready' && snap.version !== next.version) dismissed = false;
    if (next.phase !== 'ready') dismissed = false;
    snap = next;
    render();
  }

  document.addEventListener('i18n-applied', render);   // switching the language re-words the banner at once

  window.texacore.onUpdateStatus?.((s) => apply(s));

  // the original events (Windows' electron-updater download, and the "found" notice) map onto the same picture
  window.texacore.onUpdateAvailable((info) => {
    if (snap.phase === 'ready') return;
    apply({ phase: 'downloading', version: info?.version || '', bytesDone: 0, bytesTotal: 0, percent: 0 });
  });

  window.texacore.onUpdateProgress((p) => {
    if (snap.phase === 'ready') return;
    apply({ ...snap, phase: 'downloading', version: snap.version || '', percent: typeof p?.percent === 'number' ? p.percent : snap.percent,
      bytesDone: p?.transferred ? parseFloat(p.transferred) * MB : snap.bytesDone, bytesTotal: p?.total ? parseFloat(p.total) * MB : snap.bytesTotal });
  });

  window.texacore.onUpdateDownloaded(() => {
    apply({ ...snap, phase: 'ready' });
  });

  // a download that was refused (nothing staged) — or no update at all: the "downloading…" notice must not stay
  window.texacore.onUpdateNotAvailable?.(() => {
    if (snap.phase === 'ready') return;                 // an already staged update is not withdrawn by a later failed attempt
    apply({ phase: 'idle' });
  });

  // the window may open (or reload) while a download is paused or waiting: no event is coming, so ask
  window.texacore.getUpdateStatus?.().then((st) => { if (st && st.phase && st.phase !== 'idle') apply(st); }).catch(() => {});

  const control = (btn, action) => {
    btn.disabled = true;
    Promise.resolve(window.texacore.updateControl(action))
      .then((r) => { if (r && r.status && r.status.phase) apply({ ...snap, ...r.status }); })
      .catch(() => {})
      .then(() => { btn.disabled = false; });
  };
  pauseBtn?.addEventListener('click', () => control(pauseBtn, snap.phase === 'paused' ? 'resume' : 'pause'));
  retryBtn?.addEventListener('click', () => control(retryBtn, 'retry'));

  restartBtn?.addEventListener('click', () => {
    restartBtn.disabled = true;
    window.texacore.installUpdate();
  });
  laterBtn?.addEventListener('click', () => {
    dismissed = true;
    render();
  });
})();

// ─── Replace-all confirmation (2.0.5) ───────────────────────────────────────────────────────────────────────────────────────
// Opening a company file REPLACES every company of this computer, for every user. The main process refuses (REPLACE_ALL_CONFIRM_REQUIRED + the list + the connected
// sessions) until the window has asked; «Cancel» is the focused default and Escape. Resolves true only on the explicit «Yes, replace».
function replaceConfirmView(info) {
  const cs = info && Array.isArray(info.companies) ? info.companies : null;
  const sessions = info && Number.isFinite(info.sessions) ? info.sessions : null;
  return {
    text: t('replace.warn'),
    companiesTitle: cs === null ? t('replace.unknown') : (cs.length ? t('replace.companies').replace('{n}', String(cs.length)) : ''),
    names: cs === null ? [] : cs.slice(0, 12).map((c) => String(c.name || c.id || '')),
    more: cs && cs.length > 12 ? cs.length - 12 : 0,
    sessions: sessions && sessions > 0 ? t('replace.sessions').replace('{n}', String(sessions)) : '',
  };
}
function askReplaceAll(info) {
  return new Promise((resolve) => {
    const box = document.getElementById('replace-confirm');
    const overlay = document.getElementById('overlay-replace');
    if (!box || !overlay) { resolve(false); return; }
    const v = replaceConfirmView(info);
    document.getElementById('replace-confirm-text').textContent = v.text;
    document.getElementById('replace-confirm-companies-title').textContent = v.companiesTitle;
    const ul = document.getElementById('replace-confirm-list');
    ul.textContent = '';
    for (const name of v.names) { const li = document.createElement('li'); li.textContent = name; ul.appendChild(li); }
    if (v.more) { const li = document.createElement('li'); li.textContent = '+' + v.more; ul.appendChild(li); }
    document.getElementById('replace-confirm-sessions').textContent = v.sessions;
    const yes = document.getElementById('btn-replace-yes');
    const no = document.getElementById('btn-replace-cancel');
    const done = (answer) => { overlay.style.display = 'none'; yes.onclick = null; no.onclick = null; document.removeEventListener('keydown', onKey, true); resolve(answer); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    document.addEventListener('keydown', onKey, true);
    overlay.style.display = 'flex';
    try { no.focus(); } catch { /* not focusable yet */ }
  });
}

// After an upgrade over a 1.x install the main process leaves <data dir>/upgrade-notice.json: where the previous data is kept and the company
// files (.tcdb) the old settings named. Shown until dismissed (or until a file is restored through it); every action goes through the main process,
// which only acts on what the notice itself lists.
(function initUpgradeNotice() {
  const box = document.getElementById('upgrade-notice');
  const overlay = document.getElementById('overlay-upgrade');
  if (!box || !overlay || !window.texacore || !window.texacore.getUpgradeNotice) return;
  const el = (id) => document.getElementById(id);
  let note = null;
  let busy = false;
  let result = null;   // { ok, text } of the last restore attempt

  function setStatus(text, cls) { const st = el('upgrade-status'); st.textContent = text || ''; st.className = 'upgrade-status' + (cls ? ' ' + cls : ''); }

  function render() {
    if (!note) { box.style.display = 'none'; overlay.style.display = 'none'; return; }
    overlay.style.display = 'flex';
    box.style.display = 'block';
    el('upgrade-line-a').textContent = t('upgrade.a').replace('{v}', 'v' + (note.appVersion || ''));
    el('upgrade-folder').textContent = note.folder || '';
    el('upgrade-line-b').textContent = t(note.kind === 'legacy' ? 'upgrade.bLegacy' : 'upgrade.b');
    el('upgrade-open-folder').style.display = note.folderExists ? '' : 'none';
    const files = note.tcdb || [];
    el('upgrade-files').style.display = files.length ? 'block' : 'none';
    const ul = el('upgrade-file-list');
    ul.textContent = '';
    for (const f of files) {
      const li = document.createElement('li'); li.className = 'upgrade-file';
      const info = document.createElement('div'); info.className = 'upgrade-file-info';
      const nm = document.createElement('div'); nm.className = 'upgrade-file-name'; nm.textContent = f.name;
      const pa = document.createElement('div'); pa.className = 'upgrade-file-path'; pa.textContent = f.path; pa.title = f.path;
      info.append(nm, pa); li.append(info);
      if (f.exists) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-sm'; setWithIcon(b, 'folder-open', t('upgrade.open'), 16, ''); b.disabled = busy;
        b.dataset.path = f.path; b.addEventListener('click', () => openFile(f.path));
        li.append(b);
      } else {
        const m = document.createElement('span'); m.className = 'upgrade-file-missing'; m.textContent = t('upgrade.missing'); li.append(m);
      }
      ul.append(li);
    }
    if (busy) setStatus(t('upgrade.opening'), 'busy');
    else if (result) setStatus(result.text, result.ok ? 'ok' : 'err');
  }

  async function dismiss() {
    try { await window.texacore.dismissUpgradeNotice(); } catch { /* ignore */ }
    note = null; result = null; render();
  }

  async function openFile(p, confirmed) {
    if (busy) return;
    busy = true; result = null; render();
    let r;
    try { r = await window.texacore.openUpgradeTcdb(p, confirmed ? { confirmReplaceAll: true } : undefined); } catch (e) { r = { success: false, error: e.message }; }
    busy = false;
    if (r && !r.success && r.code === 'REPLACE_ALL_CONFIRM_REQUIRED') {
      // 2.0.5: the database already holds companies - nothing was touched; ask, and only on an explicit yes open the file (the main process then saves a backup first)
      render();
      if (await askReplaceAll(r)) return openFile(p, true);
      result = null; render();
      return;
    }
    if (r && r.success) {
      const n = r.copyErrors || 0;
      result = { ok: true, text: n ? t('upgrade.doneWithErrors').replace('{n}', n).replace('{f}', r.copyErrorsLog || '') : t('upgrade.done').replace('{c}', r.companyName || '') };
      if (typeof refreshState === 'function') { try { await refreshState(); } catch { /* ignore */ } }
    } else {
      result = { ok: false, text: (r && r.code === 'LEGACY_TCDB') ? t('upgrade.legacyRefused') : t('upgrade.failed').replace('{e}', (r && r.error) || '?') };
    }
    render();
  }

  el('upgrade-close').addEventListener('click', dismiss);
  el('upgrade-dismiss').addEventListener('click', dismiss);
  el('upgrade-open-folder').addEventListener('click', async () => {
    try { const r = await window.texacore.openUpgradeFolder(); if (r && !r.success) setStatus(t('upgrade.failed').replace('{e}', r.error || '?'), 'err'); } catch { /* ignore */ }
  });
  document.addEventListener('i18n-applied', render);

  window.texacore.getUpgradeNotice().then((n) => { note = n; render(); }).catch(() => {});
})();
