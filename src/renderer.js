// ════════════════════════════════════════════════════════════════
// TexaCore Installer — Renderer (UI Logic)
// v2: Native embedded services — no Docker dependency
// ════════════════════════════════════════════════════════════════

let currentState = {};
let statusInterval = null;

// ─── Language switch (titlebar <select>) ─────────────────────
// Top-level so the inline onchange="onLangChange()" can reach it.
async function onLangChange() {
  const sel = document.getElementById('lang-select');
  const lang = sel ? sel.value : 'en';
  applyI18n(lang);
  // Re-render JS-set strings (license date, status cards) so they switch instantly
  // too, not only on the next poll.
  try { if (currentState) { updateStatusCards(currentState); updateControlPanel(currentState); } } catch (e) { /* ignore */ }
  if (window.texacore && window.texacore.setUiLang) {
    try { await window.texacore.setUiLang(lang); } catch (e) { /* ignore */ }
  }
}

// ─── Initialize ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Display version + build date from package.json
  try {
    const verInfo = await texacore.getVersion();
    // Support both old format (string) and new format (object)
    if (typeof verInfo === 'object' && verInfo.version) {
      document.getElementById('version').textContent = `v${verInfo.version}`;
      if (verInfo.buildDate && verInfo.buildDate !== 'unknown') {
        const bd = new Date(verInfo.buildDate);
        const dateStr = bd.toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
        document.getElementById('build-date').textContent = `Build: ${dateStr}`;
      }
    } else {
      document.getElementById('version').textContent = `v${verInfo}`;
    }
  } catch { /* fallback: stays as "v..." */ }

  // Listen for migration progress events from main process
  if (texacore.onMigrationProgress) {
    texacore.onMigrationProgress((data) => {
      const box = document.getElementById('migration-progress-box');
      const bar = document.getElementById('migration-progress-bar');
      const counter = document.getElementById('migration-counter');
      const text = document.getElementById('migration-progress-text');
      if (!box || !bar) return;

      box.style.display = 'block';
      const pct = Math.round((data.step / data.total) * 100);
      bar.style.width = `${pct}%`;
      counter.textContent = `${data.step}/${data.total}`;
      text.textContent = data.name;

      // Hide when complete
      if (data.step >= data.total) {
        setTimeout(() => { box.style.display = 'none'; }, 2000);
      }
    });
  }

  await refreshState();

  // Determine + apply UI language: saved choice wins, else auto-detect from the
  // OS locale (provided by main) or the browser language. t() reads CURRENT_LANG
  // live, so any text set before this still resolves correctly once applied.
  const saved = (currentState && currentState.config && currentState.config.uiLang) || null;
  const lang = saved || detectLang((currentState && currentState.osLocale) || (navigator.language));
  const sel = document.getElementById('lang-select');
  if (sel) sel.value = lang;
  applyI18n(lang);

  refreshAdminPasswordStatus();
  // Adaptive polling: poll fast (1.5s) while the system is starting/not yet
  // connected so the status appears near-instantly, then relax to 5s once
  // connected. Avoids the old fixed 5s lag where the indicator felt slow.
  const _statusTick = async () => {
    await refreshStatus();
    const connected = currentState && currentState.containerRunning;
    statusInterval = setTimeout(_statusTick, connected ? 5000 : 1500);
  };
  statusInterval = setTimeout(_statusTick, 1500);
});

// ─── Refresh Full State ──────────────────────────────────────
async function refreshState() {
  try {
    currentState = await texacore.getState();
    updateUI(currentState);
  } catch (err) {
    console.error('Failed to get state:', err);
  }
}

// ─── Refresh Status Only ─────────────────────────────────────
async function refreshStatus() {
  try {
    const state = await texacore.getState();
    currentState = state;
    updateStatusCards(state);
    // updateControlPanel also refreshes the license badge (tier + expiry), so a
    // cloud-synced tier change / extension shows here within one poll (~5s).
    updateControlPanel(state);
    // The employee link's company-id fetch can miss on first paint (before the DB
    // is up). While the cloud box is shown and the link is still the bare fallback
    // (no ?c=), re-resolve it each poll until the short code lands, then stop.
    refreshEmployeesBox(state);
    const empEl = document.getElementById('employee-url');
    if (state.config && state.config.subdomain && empEl && !String(empEl.dataset.url || '').includes('?c=')) {
      setEmployeeLink(state.config.subdomain);
    }
  } catch { /* silent */ }
}

// ─── Update UI ───────────────────────────────────────────────
function updateUI(state) {
  updateStatusCards(state);

  // Hide all panels
  document.getElementById('panel-no-docker').style.display = 'none';
  document.getElementById('panel-license').style.display = 'none';
  document.getElementById('panel-control').style.display = 'none';

  // No Docker check — go straight to license or control panel
  if (!state.hasLicense) {
    // Show license activation
    document.getElementById('panel-license').style.display = 'block';
    document.getElementById('btn-cancel-license').style.display = 'none';
    if (state.config?.licenseKey) {
      document.getElementById('input-license').value = state.config.licenseKey;
    }
  } else {
    // Show control panel
    document.getElementById('panel-control').style.display = 'block';
    updateControlPanel(state);
  }

  // Set port and cloud settings
  if (state.config?.port) {
    document.getElementById('input-port').value = state.config.port;
  }
  
  if (state.config?.enableCloud) {
    document.getElementById('input-cloud').checked = true;
    document.getElementById('cloud-content').style.display = 'block';
  } else {
    document.getElementById('input-cloud').checked = false;
    document.getElementById('cloud-content').style.display = 'none';
  }
  syncSwitch();
  
  // If registered (and not known-deleted), show active view. Otherwise setup view.
  if (state.config?.subdomain && _deletedSubdomain !== state.config.subdomain) {
    document.getElementById('input-subdomain').value = state.config.subdomain;
    document.getElementById('cloud-setup').style.display = 'none';
    document.getElementById('cloud-active').style.display = 'block';
    document.getElementById('cloud-url').textContent = `https://${state.config.subdomain}.texacore.ai`;
    
    // Set Local URL
    const localIp = state.localIp || '127.0.0.1';
    const port = state.config.port || 80;
    const portStr = port === 80 ? '' : `:${port}`;
    document.getElementById('local-url').textContent = `http://${localIp}${portStr}`;

    // Set Employee direct-login link (manager shares this with the company's staff).
    // Uses a SHORT, clean company code (the company UUID's first segment, e.g. 6b6e4674)
    // instead of the URL-encoded Arabic name. LocalLauncher resolves the code → company.
    setEmployeeLink(state.config.subdomain);

    // The saved subdomain may have been deleted from the cloud (Cloudflare).
    // Verify it still resolves; if not, flip to the setup view and prompt the
    // user to register a new one instead of showing a dead cloud URL.
    verifyCloudSubdomain(state.config.subdomain);
  } else {
    document.getElementById('cloud-setup').style.display = 'block';
    document.getElementById('cloud-active').style.display = 'none';
    // A saved subdomain that no longer resolves (deleted from the cloud): stay on
    // setup with a warning + the old name pre-filled so the user re-registers it.
    if (state.config?.subdomain && _deletedSubdomain === state.config.subdomain) {
      const warn = document.getElementById('subdomain-deleted-warning');
      if (warn) { setWithIcon(warn, 'triangle-alert', t('subdomain.deleted')); warn.style.display = 'block'; }
      const inp = document.getElementById('input-subdomain');
      if (inp && !inp.value) { inp.value = state.config.subdomain; checkSubdomain(state.config.subdomain); }
    }
  }
}

// Verify the configured subdomain still exists. On a definitive "deleted"
// result, switch from the active view to setup, surface a warning, and pre-fill
// the old name so the user can re-register it (now free) or pick a new one.
let _verifiedAliveSubdomain = null;  // cache: skip re-checking a subdomain we already confirmed alive
let _deletedSubdomain = null;        // a saved subdomain confirmed deleted — keeps updateUI on the setup view
async function verifyCloudSubdomain(subdomain) {
  if (!subdomain || !window.texacore?.verifySubdomain) return;
  if (_verifiedAliveSubdomain === subdomain) return;  // already confirmed — avoid a DNS lookup every poll
  try {
    const r = await texacore.verifySubdomain();
    if (r && r.valid === false && r.reason === 'deleted') {
      _verifiedAliveSubdomain = null;
      _deletedSubdomain = subdomain;  // updateUI now routes straight to setup (no active⇄setup flicker)
      document.getElementById('cloud-active').style.display = 'none';
      document.getElementById('cloud-setup').style.display = 'block';
      const warn = document.getElementById('subdomain-deleted-warning');
      if (warn) { setWithIcon(warn, 'triangle-alert', t('subdomain.deleted')); warn.style.display = 'block'; }
      const inp = document.getElementById('input-subdomain');
      if (inp) { inp.value = subdomain; checkSubdomain(subdomain); }
    } else if (r && r.valid === true) {
      _verifiedAliveSubdomain = subdomain;  // confirmed alive — don't re-check (retry on deleted/error)
      if (_deletedSubdomain === subdomain) _deletedSubdomain = null;  // recovered / re-registered
    }
  } catch { /* network/verify error — keep the active view, retry next refresh */ }
}

// ─── Update Status Cards ─────────────────────────────────────
function updateStatusCards(state) {
  // Database (replaced Docker)
  const dbStatus = document.getElementById('status-database');
  const dbIndicator = document.getElementById('indicator-database');
  if (dbStatus && dbIndicator) {
    if (state.containerRunning) {
      if (state.containerHealth === 'healthy') {
        dbStatus.textContent = t('status.running');
        dbIndicator.className = 'status-indicator green';
      } else {
        dbStatus.textContent = t('status.starting');
        dbIndicator.className = 'status-indicator blue';
      }
    } else {
      dbStatus.textContent = t('status.stopped');
      dbIndicator.className = 'status-indicator yellow';
    }
  }

  // License
  const licenseStatus = document.getElementById('status-license');
  const licenseIndicator = document.getElementById('indicator-license');
  if (licenseStatus && licenseIndicator) {
    if (state.hasLicense) {
      licenseStatus.textContent = t('status.active');
      licenseIndicator.className = 'status-indicator green';
    } else {
      licenseStatus.textContent = t('status.inactive');
      licenseIndicator.className = 'status-indicator red';
    }
  }

  // ERP
  const erpStatus = document.getElementById('status-erp');
  const erpIndicator = document.getElementById('indicator-erp');
  if (erpStatus && erpIndicator) {
    if (state.containerRunning) {
      if (state.containerHealth === 'healthy') {
        erpStatus.textContent = t('status.running');
        erpIndicator.className = 'status-indicator green';
      } else {
        erpStatus.textContent = t('status.starting');
        erpIndicator.className = 'status-indicator blue';
      }
    } else {
      erpStatus.textContent = t('status.stopped');
      erpIndicator.className = 'status-indicator red';
    }
  }

  renderTunnelStatus(state);
}

// The connection status comes from the REAL connector state (main → ServiceManager.getTunnelStatus → tunnel-monitor.js): «connected» only when
// cloudflared is running AND has logged a registered tunnel connection. 2.0.0 showed «connected» whenever the services ran, even with no cloudflared at all.
function renderTunnelStatus(state) {
  const el = document.getElementById('tunnel-status');
  const det = document.getElementById('tunnel-detail');
  if (!el) return;
  const tn = state && state.tunnel;
  let text; let color; let ico; let detail = '';
  if (!state || !state.containerRunning || !tn || !tn.enabled) {
    text = t('cloud.disconnected'); color = 'var(--danger)'; ico = 'circle-x';
  } else if (tn.state === 'connected') {
    text = t('cloud.connected'); color = 'var(--accent)'; ico = 'circle-check';
  } else if (tn.state === 'starting') {
    text = t('cloud.connecting'); color = 'var(--warning)'; ico = 'loader';
  } else if (tn.state === 'error') {
    text = (t('cloud.err.' + tn.reason) !== 'cloud.err.' + tn.reason ? t('cloud.err.' + tn.reason) : t('cloud.disconnected')); color = 'var(--danger)'; ico = 'circle-x';
    detail = tn.detail || '';
  } else if (tn.reason === 'subdomain_deleted') {
    text = t('cloud.off.subdomain_deleted'); color = 'var(--danger)'; ico = 'triangle-alert';
  } else {
    text = t('cloud.disconnected'); color = 'var(--danger)'; ico = 'circle-x';
  }
  setWithIcon(el, ico, text, 16, ico === 'loader' ? 'icon-lead spin' : 'icon-lead');
  el.style.color = color;
  el.dataset.tunnelState = tn ? `${tn.state}${tn.reason ? ':' + tn.reason : ''}` : 'none';
  el.dataset.tunnelIcon = ico;
  if (det) { det.textContent = detail; det.style.display = detail ? 'block' : 'none'; }
}

// ─── Update Control Panel ────────────────────────────────────
function updateControlPanel(state) {
  updateControlButtons(state);

    // Update license badge from state.licenseInfo
  if (state.licenseInfo) {
    const li = state.licenseInfo;
    const tierEl = document.getElementById('badge-tier');
    const expiresEl = document.getElementById('badge-expires');
    tierEl.textContent = (li.tier || 'PRO').toUpperCase();
    if (li.tier === 'free') tierEl.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
    
    // Format date specifically as Gregorian with Western/Arabic numerals (1, 2, 3...)
    let exDate = '--';
    if (li.expires_at) {
      const d = new Date(li.expires_at);
      const _dl = ({ ar: 'ar-EG', en: 'en-US', ru: 'ru-RU', uk: 'uk-UA' })[document.documentElement.lang] || 'en-US';
      exDate = new Intl.DateTimeFormat(_dl, {
        calendar: 'gregory',
        numberingSystem: 'latn',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(d);
    }
    
    if (!li.expires_at) {
      // A licence without an end date never expires (the free local plan: license-guard.validate() never marks it expired) — never «-- (0 days)».
      expiresEl.textContent = t('license.neverExpires');
      expiresEl.dataset.expiry = 'never';
    } else {
      const daysLeft = Math.ceil((new Date(li.expires_at) - Date.now()) / 86400000);
      expiresEl.textContent = `${t('license.expiresPrefix')} ${exDate} (${daysLeft} ${t('common.daysUnit')})`;
      expiresEl.dataset.expiry = 'date';
    }

    // Support code = the full license key (for fast support / activation / extension).
    const codeEl = document.getElementById('support-code');
    if (codeEl && li.license_key) codeEl.textContent = li.license_key;
  }
}

// Copy the support code (license key) to the clipboard, with a file:// fallback.
function copySupportCode() {
  const code = (document.getElementById('support-code')?.textContent || '').trim();
  if (!code || code === '—') return;
  const flash = () => {
    const btn = document.getElementById('btn-copy-key');
    if (btn) { const prev = btn.innerHTML; setWithIcon(btn, 'check', t('common.copied'), 16, ''); setTimeout(() => { btn.innerHTML = prev; }, 1500); }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(flash).catch(() => fallbackCopy(code, flash));
  } else {
    fallbackCopy(code, flash);
  }
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

function updateControlButtons(state) {
  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const btnOpen = document.getElementById('btn-open');

  if (state.containerRunning) {
    btnStart.style.display = 'none';
    btnStop.style.display = 'inline-flex';
    btnOpen.style.display = 'inline-flex';
  } else {
    btnStart.style.display = 'inline-flex';
    btnStop.style.display = 'none';
    btnOpen.style.display = 'none';
  }
}

// ─── Activate License ────────────────────────────────────────
async function activateLicense() {
  const input = document.getElementById('input-license');
  const btn = document.getElementById('btn-activate');
  const feedback = document.getElementById('feedback-license');
  const key = input.value.trim();

  if (!key) {
    feedback.className = 'feedback error';
    feedback.textContent = t('license.errNoKey');
    input.focus();
    return;
  }

  btn.disabled = true;
  setWithIcon(btn, 'loader', t('license.activating'), 20, 'spin');
  feedback.className = 'feedback loading';
  feedback.textContent = t('license.connectingLicense');

  try {
    const result = await texacore.activateLicense(key);

    if (result.success) {
      feedback.className = 'feedback success';
      feedback.textContent = `${t('license.activatedOk')} ${result.license.tier} — ${t('license.expiresPrefix')} ${new Date(result.license.expires_at).toLocaleDateString()}`;
      // اقتران التبديل بإعادة تشغيل فعلية لتطبيق الباقة
      await restartSystemForLicense();
    } else {
      feedback.className = 'feedback error';
      feedback.textContent = `${t('license.activateFailed')} ${result.error}`;
    }
  } catch (err) {
    feedback.className = 'feedback error';
    feedback.textContent = `${t('common.errorPrefix')} ${err.message}`;
  }

  btn.disabled = false;
  setWithIcon(btn, 'zap', t('license.activateBtn'), 20, '');
}

// ─── إعادة تشغيل المحرّكات بعد تغيير الرخصة ──────────────────────
// نفس تدفّق أزرار Stop→Start المُثبت (IPC مباشر) ⇒ يقترن كل تبديل رخصة بإيقاف
// وإعادة تشغيل فعلية فتُطبَّق الباقة الجديدة بلا حالة قديمة. أضمن + يفيد التحصين.
async function restartSystemForLicense() {
  const fb = document.getElementById('feedback-license') || document.getElementById('feedback-control');
  try {
    if (fb) { fb.className = 'feedback loading'; fb.textContent = 'جارٍ إيقاف وإعادة تشغيل المحرّكات لتطبيق الباقة…'; }
    try { await texacore.stopERP(); } catch (e) { console.warn('[restart] stop:', e); }
    await new Promise(r => setTimeout(r, 1800));       // مهلة تحرّر PG قبل الإقلاع
    await refreshState();                               // config محدّث بالرخصة الجديدة
    const c = (currentState && currentState.config) || {};
    const result = await texacore.startERP({
      licenseKey: c.licenseKey,
      dbPassword: c.dbPassword || 'texacore2026',
      port: parseInt(c.port) || 8080,
      enableCloud: !!c.enableCloud,
      subdomain: c.subdomain,
    });
    await refreshState();
    if (fb) {
      if (result && result.success) { fb.className = 'feedback success'; fb.textContent = 'أُعيد التشغيل وطُبّقت الباقة'; }
      else { fb.className = 'feedback error'; fb.textContent = 'فشلت إعادة التشغيل: ' + ((result && result.error) || ''); }
    }
  } catch (e) {
    console.error('[restart] failed:', e);
    if (fb) { fb.className = 'feedback error'; fb.textContent = 'خطأ إعادة التشغيل: ' + e.message; }
  }
}

function showLicensePanel() {
  document.getElementById('panel-control').style.display = 'none';
  document.getElementById('panel-license').style.display = 'block';
  document.getElementById('btn-cancel-license').style.display = 'block';
}

// ─── Start Trial ─────────────────────────────────────────────
async function startTrial() {
  const btn = document.getElementById('btn-trial');
  const feedback = document.getElementById('feedback-license');

  btn.disabled = true;
  setWithIcon(btn, 'loader', t('trial.creating'), 20, 'spin');
  feedback.className = 'feedback loading';
  feedback.textContent = t('trial.connecting');

  try {
    const result = await texacore.startTrial();

    if (result.success) {
      feedback.className = 'feedback success';
      const msg = result.existing
        ? t('trial.alreadyHave')
        : t('trial.activated');
      feedback.textContent = msg;
      // اقتران التبديل بإعادة تشغيل فعلية لتطبيق الباقة
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
  setWithIcon(btn, 'gift', t('license.trialBtn'), 20, '');
}

// ─── Start Free (offline) ────────────────────────────────────
async function startFree() {
  const btn = document.getElementById('btn-free');
  const feedback = document.getElementById('feedback-license');

  btn.disabled = true;
  setWithIcon(btn, 'loader', t('free.creating'), 20, 'spin');
  feedback.className = 'feedback loading';
  feedback.textContent = t('free.activating');

  try {
    const result = await texacore.startFree();

    if (result.success) {
      feedback.className = 'feedback success';
      feedback.textContent = t('free.activated');
      // اقتران التبديل بإعادة تشغيل فعلية لتطبيق الباقة المجانية
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
  setWithIcon(btn, 'sparkles', t('license.freeBtn'), 20, '');
}

// ─── Start ERP ───────────────────────────────────────────────
async function startERP() {
  const btn = document.getElementById('btn-start');
  const feedback = document.getElementById('feedback-control');
  const port = document.getElementById('input-port').value || 80;
  const enableCloud = document.getElementById('input-cloud').checked;
  const subdomain = currentState.config?.subdomain || document.getElementById('input-subdomain').value;

  if (enableCloud && !subdomain) {
    feedback.className = 'feedback error';
    feedback.textContent = t('cloud.errReserveFirst');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="btn-icon">${icon('loader', 20, 'spin')}</span><span>${t('status.starting')}</span>`;
  feedback.className = 'feedback loading';
  feedback.textContent = t('system.startingServices');

  try {
    const result = await texacore.startERP({
      licenseKey: currentState.config?.licenseKey,
      dbPassword: currentState.config?.dbPassword || 'texacore2026',
      port: parseInt(port),
      enableCloud,
      subdomain
    });

    if (result.success) {
      feedback.className = 'feedback success';

      // Show migration summary if available
      let migInfo = '';
      if (result.migrations && result.migrations.applied > 0) {
        migInfo = ` (${result.migrations.applied} ${t('migration.migrationsApplied')})`;
      }

      feedback.textContent = result.ready
        ? `${t('system.works')}${migInfo} → http://localhost:${result.port}`
        : t('system.loadingWait');

      // Hide migration progress box
      const migBox = document.getElementById('migration-progress-box');
      if (migBox) migBox.style.display = 'none';
      
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
  btn.innerHTML = `<span class="btn-icon">${icon('play', 20)}</span><span>${t('btn.start')}</span>`;
}

// ─── Stop ERP ────────────────────────────────────────────────
// The red button only ASKS: the question appears inside the window (no native dialog) and nothing is stopped until «yes» is pressed.
// «Cancel» has the focus, Esc cancels, and an unanswered question withdraws itself after 15 s.
let _stopAskTimer = null;
function requestStopERP() {
  const box = document.getElementById('stop-confirm');
  if (!box) { stopERP(); return; }
  box.style.display = 'block';
  document.getElementById('btn-stop-cancel')?.focus();
  clearTimeout(_stopAskTimer);
  _stopAskTimer = setTimeout(cancelStopERP, 15000);
}
function cancelStopERP() {
  clearTimeout(_stopAskTimer);
  const box = document.getElementById('stop-confirm');
  if (box) box.style.display = 'none';
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('stop-confirm')?.style.display === 'block') cancelStopERP();
});

async function stopERP() {
  clearTimeout(_stopAskTimer);
  const confirmBox = document.getElementById('stop-confirm');
  if (confirmBox) confirmBox.style.display = 'none';
  const btn = document.getElementById('btn-stop');
  const feedback = document.getElementById('feedback-control');

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

// ─── Open Browser ────────────────────────────────────────────
function openERP() {
  const port = document.getElementById('input-port').value || 80;
  texacore.openBrowser(parseInt(port));
}

function openCloudUrl() {
  const subdomain = currentState.config?.subdomain;
  if (subdomain) {
    texacore.openBrowser(`https://${subdomain}.texacore.ai`);
  }
}

function openLocalUrl() {
  openERP(); // Always open localhost to prevent Vite strict MIME issues locally
}

// Build the employee direct-login link with a SHORT, clean company code (the
// company UUID's first segment) so it carries no URL-encoded Arabic. Fetches the
// id from the local admin API; falls back to the bare /login URL when the system
// isn't running (still valid — the employee just picks the company once).
async function setEmployeeLink(subdomain) {
  const empBox = document.getElementById('employee-link-box');
  const empEl = document.getElementById('employee-url');
  if (!empBox || !empEl) return;
  if (!subdomain) { empBox.style.display = 'none'; return; }
  let code = '';
  try {
    // IPC, not fetch(): the admin API has no CORS for a file:// page, and the secret never leaves the main process.
    const j = await window.texacore.listLocalCompanies();
    if (j && j.success) {
      const companies = j.companies || [];
      code = String(companies[0] && companies[0].id || '').split('-')[0];  // e.g. 6b6e4674
    }
  } catch (e) { /* services may be down — fall back to the base link */ }
  const url = code
    ? `https://${subdomain}.texacore.ai/login?c=${code}`
    : `https://${subdomain}.texacore.ai/login`;
  empEl.textContent = url;
  empEl.dataset.url = url;
  empBox.style.display = 'block';
}

function openEmployeeUrl() {
  const url = document.getElementById('employee-url')?.dataset.url;
  if (url) texacore.openBrowser(url);
}

async function copyEmployeeUrl() {
  const url = document.getElementById('employee-url')?.dataset.url;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // Fallback for environments without the async clipboard API
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  const btn = document.getElementById('copy-employee-url');
  if (btn) {
    btn.textContent = t('cloud.copied');
    setTimeout(() => { btn.textContent = t('cloud.copyLink'); }, 1500);
  }
}


// ─── Employees (LAN link + add an employee on this machine) ──────────────────
let _empCompanies = [];
let _empRefreshing = false;
let _empLast = 0;
function lanEmployeeLink(state, companyId) {
  const ip = state && state.localIp;
  if (!ip || !companyId) return '';
  const port = (state.config && state.config.port) || 80;
  return `http://${ip}${port === 80 ? '' : ':' + port}/login?c=${String(companyId).split('-')[0]}`;
}
async function refreshEmployeesBox(state) {
  const box = document.getElementById('employees-box');
  if (!box || _empRefreshing) return;
  if (_empCompanies.length && Date.now() - _empLast < 30000) return;     // the company list rarely changes; the poll runs every ~5 s
  _empRefreshing = true;
  _empLast = Date.now();
  try {
    const r = await window.texacore.listLocalCompanies();
    const companies = (r && r.success && r.companies) || [];
    if (!companies.length) { box.style.display = 'none'; return; }
    box.style.display = 'block';
    const sel = document.getElementById('emp-company');
    const sameList = JSON.stringify(companies.map((c) => c.id)) === JSON.stringify(_empCompanies.map((c) => c.id));
    if (!sameList) {
      _empCompanies = companies;
      const keep = sel.value;
      sel.innerHTML = '';
      for (const c of companies) { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; sel.appendChild(o); }
      if (keep && companies.some((c) => c.id === keep)) sel.value = keep;
      await loadEmployeeRoles();
    }
    const url = lanEmployeeLink(state || currentState, sel.value);
    const a = document.getElementById('lan-employee-url');
    a.textContent = url || '—'; a.dataset.url = url;
  } catch { /* services may be down */ } finally { _empRefreshing = false; }
}
async function loadEmployeeRoles() {
  const sel = document.getElementById('emp-role');
  const cid = document.getElementById('emp-company').value;
  sel.innerHTML = '';
  if (!cid) return;
  const r = await window.texacore.listEmployeeRoles(cid);
  const lang = (typeof CURRENT_LANG === 'string' && CURRENT_LANG) || 'en';
  const roles = (r && r.roles) || [];
  const hint = document.getElementById('emp-roles-hint');
  if (hint) hint.style.display = roles.some((x) => !/^(company_owner|tenant_owner|tenant_admin)$/.test(x.code)) ? 'none' : 'block';
  for (const role of roles) {
    const o = document.createElement('option'); o.value = role.id;
    o.textContent = (lang === 'ar' ? role.name_ar : role.name_en) || role.name_en || role.name_ar || role.code;
    sel.appendChild(o);
  }
}
async function onEmployeeCompanyChange() { await loadEmployeeRoles(); await refreshEmployeesBox(currentState); }
function openLanEmployeeUrl() { const u = document.getElementById('lan-employee-url')?.dataset.url; if (u) texacore.openBrowser(u); }
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  }
}
// Copy a link exactly as it is shown (cloud link, local/LAN link) and say so on the button for a moment
async function copyLink(linkId, btnId) {
  const text = (document.getElementById(linkId)?.textContent || '').trim();
  if (!text || text === '—') return;
  await copyText(text);
  const btn = document.getElementById(btnId);
  if (btn) {
    btn.textContent = t('emp.copied'); btn.classList.add('copied');
    setTimeout(() => { btn.textContent = t('emp.copy'); btn.classList.remove('copied'); }, 1500);
  }
}
async function copyLanEmployeeUrl() {
  const u = document.getElementById('lan-employee-url')?.dataset.url;
  if (!u) return;
  await copyText(u);
  const btn = document.getElementById('copy-lan-employee-url');
  if (btn) { btn.textContent = t('emp.copied'); setTimeout(() => { btn.textContent = t('emp.copy'); }, 1500); }
}
async function addEmployee() {
  const out = document.getElementById('emp-result');
  const btn = document.getElementById('btn-add-employee');
  const data = {
    companyId: document.getElementById('emp-company').value, roleId: document.getElementById('emp-role').value,
    fullName: document.getElementById('emp-name').value.trim(), email: document.getElementById('emp-email').value.trim(),
  };
  const show = (html, color) => { out.style.display = 'block'; out.style.color = color || 'inherit'; out.innerHTML = html; };
  const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  if (!data.companyId) { show(esc(t('emp.noCompany')), 'var(--danger)'); return; }
  btn.disabled = true;
  try {
    const r = await window.texacore.inviteEmployee(data);
    if (!r || !r.success) {
      const msg = r && r.code === 'PLAN_LIMIT_EXCEEDED' ? t('emp.errLimit') : (r && r.code === 'EMAIL_EXISTS' ? t('emp.errExists') : `${t('emp.errGeneric')} ${esc((r && r.error) || '')}`);
      show(esc(msg), 'var(--danger)');
      return;
    }
    const link = lanEmployeeLink(currentState, r.companyId);
    show(`<div style="font-weight:700; color:#16a34a;">${esc(t('emp.created'))}: ${esc(r.fullName)} — ${esc(r.email)}</div>
      <div style="margin-top:6px;">${esc(t('emp.otp'))}</div>
      <div style="font-family:monospace; font-size:18px; font-weight:700; letter-spacing:1px; user-select:all;" dir="ltr">${esc(r.oneTimePassword)}</div>
      <div style="color:var(--text-muted); margin-top:4px;">${esc(t('emp.otpHint'))}</div>
      ${link ? `<div style="margin-top:6px; font-family:monospace; word-break:break-all;" dir="ltr">${esc(link)}</div>` : ''}`);
    document.getElementById('emp-name').value = ''; document.getElementById('emp-email').value = '';
  } catch (e) { show(`${esc(t('emp.errGeneric'))} ${esc(e.message)}`, 'var(--danger)'); } finally { btn.disabled = false; }
}

// ─── Cloud Logic ─────────────────────────────────────────────
// role="switch" needs aria-checked to follow the real state (set programmatically from the saved config, and by every click / Space press)
function syncSwitch(el) {
  const i = el || document.getElementById('input-cloud');
  if (i) i.setAttribute('aria-checked', i.checked ? 'true' : 'false');
}

async function toggleCloudView() {
  syncSwitch();
  const isChecked = document.getElementById('input-cloud').checked;
  document.getElementById('cloud-content').style.display = isChecked ? 'block' : 'none';
  // Actually enable/disable cloud access — start/stop the Cloudflare tunnel NOW
  // (not just show/hide the panel). Turning it off cuts the public subdomain.
  const statusEl = document.getElementById('tunnel-status');
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
    if (statusEl) { setWithIcon(statusEl, 'triangle-alert', t('cloud.toggleFailed')); statusEl.style.color = 'var(--danger)'; }
  }
}

// ─── Admin portal password (بوابة الإدارة) ──────────────────
async function saveAdminPassword() {
  const input = document.getElementById('input-admin-password');
  const statusEl = document.getElementById('admin-password-status');
  const btn = document.getElementById('btn-save-admin-password');
  const val = (input?.value || '').trim();
  const n = adminMinLength;
  if (val.length < n) {
    if (statusEl) { setWithIcon(statusEl, 'triangle-alert', t('admin.tooShort').replace('{n}', n)); statusEl.style.color = 'var(--danger)'; }
    return;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    const res = await window.texacore.setAdminPassword(val);
    if (res && res.success) {
      if (input) input.value = '';
      if (statusEl) { setWithIcon(statusEl, 'circle-check', t('admin.savedOk')); statusEl.style.color = 'var(--accent)'; }
      // Collapse the box shortly after a successful change.
      setTimeout(() => {
        const panel = document.getElementById('admin-password-panel');
        if (panel) panel.style.display = 'none';
        setChevron(false);
      }, 1600);
    } else {
      const key = res && res.code ? 'admin.err.' + res.code : null;
      const msg = key && t(key) !== key ? t(key).replace('{n}', (res && res.minLength) || adminMinLength) : ((res && res.error) || t('admin.saveFailed'));
      if (statusEl) { setWithIcon(statusEl, 'triangle-alert', msg); statusEl.style.color = 'var(--danger)'; }
    }
  } catch (e) {
    if (statusEl) { setWithIcon(statusEl, 'triangle-alert', e.message); statusEl.style.color = 'var(--danger)'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('common.save'); }
  }
}

// Reflect whether a custom admin password is set (vs the license-key default).
// The password policy has ONE source (src/admin-password.js, enforced by ServiceManager.setAdminPassword); the window only words it.
let adminMinLength = 8;
let adminStatus = null;
function applyAdminPolicyTexts() {
  const input = document.getElementById('input-admin-password');
  if (input) input.placeholder = t('admin.placeholder').replace('{n}', adminMinLength);
  const statusEl = document.getElementById('admin-password-status');
  if (statusEl && adminStatus && adminStatus.success) {
    const key = adminStatus.customized ? 'admin.statusCustom' : (adminStatus.hasDefault ? 'admin.statusDefault' : 'admin.statusNone');
    setWithIcon(statusEl, adminStatus.customized || !adminStatus.hasDefault ? 'lock' : 'info', t(key).replace('{n}', adminMinLength));
    statusEl.style.color = 'var(--text-muted)';
  }
}
document.addEventListener('i18n-applied', applyAdminPolicyTexts);
async function refreshAdminPasswordStatus() {
  const statusEl = document.getElementById('admin-password-status');
  if (!statusEl || !window.texacore?.getAdminPasswordStatus) return;
  try {
    const s = await window.texacore.getAdminPasswordStatus();
    if (s && s.success) {
      adminStatus = s;
      if (Number.isInteger(s.minLength) && s.minLength > 0) adminMinLength = s.minLength;
      applyAdminPolicyTexts();
    }
  } catch { /* ignore */ }
}

// The label of the collapsible header: text + a chevron that turns over when the box is open (the label is the inner span; the icon is kept).
function setChevron(open) {
  const chevron = document.getElementById('admin-password-chevron');
  if (!chevron) return;
  const label = chevron.querySelector('[data-i18n]');
  if (label) { label.setAttribute('data-i18n', open ? 'admin.toggleClose' : 'admin.toggleChange'); label.textContent = t(open ? 'admin.toggleClose' : 'admin.toggleChange'); }
  chevron.classList.toggle('chevron-open', !!open);
}

// Collapsible: the button reveals the change-password box; it hides again
// after a successful save (or when toggled off).
function toggleAdminPasswordPanel() {
  const panel = document.getElementById('admin-password-panel');
  if (!panel) return;
  const show = !panel.style.display || panel.style.display === 'none';
  panel.style.display = show ? 'block' : 'none';
  setChevron(show);
  if (show) {
    refreshAdminPasswordStatus();
    setTimeout(() => document.getElementById('input-admin-password')?.focus(), 50);
  }
}

let checkTimeout;
function checkSubdomain(value) {
  const statusEl = document.getElementById('domain-status');
  const btn = document.getElementById('btn-register-domain');
  
  if (!value) {
    statusEl.textContent = t('subdomain.prompt');
    statusEl.style.color = 'var(--text-muted)';
    btn.disabled = true;
    return;
  }

  // Basic format validation
  const cleaned = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (cleaned !== value || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(value)) {
    setWithIcon(statusEl, 'circle-x', t('subdomain.onlyLatin'));
    statusEl.style.color = 'var(--danger)';
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
        statusEl.style.color = 'var(--accent)';
        btn.disabled = false;
      } else {
        const reason = data.reason === 'reserved' ? t('subdomain.reservedName') :
                       data.reason === 'taken' ? t('subdomain.taken') :
                       data.reason === 'invalid_format' ? t('subdomain.badFormat') : t('subdomain.unavailable');
        setWithIcon(statusEl, 'circle-x', reason);
        statusEl.style.color = 'var(--danger)';
        btn.disabled = true;
      }
    } catch (err) {
      // Offline fallback — allow registration (server will validate)
      setWithIcon(statusEl, 'triangle-alert', t('subdomain.checkFailed'));
      statusEl.style.color = 'var(--warning)';
      btn.disabled = false;
    }
  }, 600);
}

async function registerSubdomain() {
  const input = document.getElementById('input-subdomain');
  const btn = document.getElementById('btn-register-domain');
  const statusEl = document.getElementById('domain-status');
  
  if (!input.value) return;

  btn.disabled = true;
  setWithIcon(btn, 'loader', t('subdomain.reserving'), 16, 'spin');

  try {
    const result = await window.texacore.registerSubdomain(input.value);
    
    if (result.success) {
      if (!currentState.config) currentState.config = {};
      currentState.config.subdomain = input.value;
      currentState.config.enableCloud = true;

      // Just registered → clear any "deleted" state and trust it as alive
      // (the new DNS record may take a moment to propagate; don't re-verify and
      // bounce back to setup). Hide the deletion warning if it was showing.
      _deletedSubdomain = null;
      _verifiedAliveSubdomain = input.value;
      const delWarn = document.getElementById('subdomain-deleted-warning');
      if (delWarn) delWarn.style.display = 'none';

      document.getElementById('cloud-setup').style.display = 'none';
      document.getElementById('cloud-active').style.display = 'block';
      document.getElementById('cloud-url').textContent = result.url || `https://${input.value}.texacore.ai`;

      alert(t('subdomain.reserved'));
    } else {
      setWithIcon(statusEl, 'circle-x', result.error);
      statusEl.style.color = 'var(--danger)';
      btn.textContent = t('subdomain.registerNow');
      btn.disabled = false;
    }
  } catch (err) {
    setWithIcon(statusEl, 'circle-x', err.message);
    statusEl.style.color = 'var(--danger)';
    btn.textContent = t('subdomain.registerNow');
    btn.disabled = false;
  }
}

// ─── Enter key support ──────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const activePanel = document.querySelector('.panel[style*="display: block"], .panel:not([style*="display: none"])');
    if (activePanel?.id === 'panel-license') {
      activateLicense();
    }
  }
});

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


// ─── One-time upgrade notice ──────────────────────────────────
// After an upgrade over a 1.x install the main process leaves <data dir>/upgrade-notice.json: where the previous data is kept and the company
// files (.tcdb) the old settings named. Shown until dismissed (or until a file is restored through it); every action goes through the main process,
// which only acts on what the notice itself lists.
(function initUpgradeNotice() {
  const box = document.getElementById('upgrade-notice');
  if (!box || !window.texacore || !window.texacore.getUpgradeNotice) return;
  const el = (id) => document.getElementById(id);
  let note = null;
  let busy = false;
  let result = null;   // { ok, text } of the last restore attempt

  function setStatus(text, cls) { const st = el('upgrade-status'); st.textContent = text || ''; st.className = 'upgrade-status' + (cls ? ' ' + cls : ''); }

  function render() {
    if (!note) { box.style.display = 'none'; return; }
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
        const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost'; setWithIcon(b, 'folder-open', t('upgrade.open'), 16, ''); b.disabled = busy;
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

  async function openFile(p) {
    if (busy) return;
    busy = true; result = null; render();
    let r;
    try { r = await window.texacore.openUpgradeTcdb(p); } catch (e) { r = { success: false, error: e.message }; }
    busy = false;
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
