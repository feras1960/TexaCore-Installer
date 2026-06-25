// ════════════════════════════════════════════════════════════════
// 🖥️ TexaCore Installer — Renderer (UI Logic)
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
  
  // If registered, show active view. Otherwise setup view.
  if (state.config?.subdomain) {
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
    // The `?c=<name>` param is read by LocalLauncher and pre-selects the company.
    const empBox = document.getElementById('employee-link-box');
    const empEl = document.getElementById('employee-url');
    const empCompany = state.config.companies?.[0]?.name;
    if (empBox && empEl && empCompany) {
      const empUrl = `https://${state.config.subdomain}.texacore.ai/login?c=${encodeURIComponent(empCompany)}`;
      empEl.textContent = empUrl;
      empEl.dataset.url = empUrl;
      empBox.style.display = 'block';
    } else if (empBox) {
      empBox.style.display = 'none';
    }
  } else {
    document.getElementById('cloud-setup').style.display = 'block';
    document.getElementById('cloud-active').style.display = 'none';
  }
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

  // Tunnel
  const tunnelStatusEl = document.getElementById('tunnel-status');
  if (tunnelStatusEl) {
    if (state.containerRunning) {
      tunnelStatusEl.textContent = t('cloud.connected');
      tunnelStatusEl.style.color = 'var(--accent)';
    } else {
      tunnelStatusEl.textContent = t('cloud.disconnected');
      tunnelStatusEl.style.color = 'var(--danger)';
    }
  }
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
    
    const daysLeft = li.expires_at ? Math.ceil((new Date(li.expires_at) - Date.now()) / 86400000) : 0;
    expiresEl.textContent = `${t('license.expiresPrefix')} ${exDate} (${daysLeft} ${t('common.daysUnit')})`;

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
    if (btn) { const prev = btn.textContent; btn.textContent = t('common.copied'); setTimeout(() => { btn.textContent = prev; }, 1500); }
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
  btn.textContent = t('license.activating');
  feedback.className = 'feedback loading';
  feedback.textContent = t('license.connectingLicense');

  try {
    const result = await texacore.activateLicense(key);

    if (result.success) {
      feedback.className = 'feedback success';
      feedback.textContent = `${t('license.activatedOk')} ${result.license.tier} — ${t('license.expiresPrefix')} ${new Date(result.license.expires_at).toLocaleDateString()}`;
      
      // Refresh after 1 second
      setTimeout(refreshState, 1000);
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
  btn.textContent = t('trial.creating');
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
      setTimeout(refreshState, 1000);
    } else {
      feedback.className = 'feedback error';
      feedback.textContent = `❌ ${result.error}`;
    }
  } catch (err) {
    feedback.className = 'feedback error';
    feedback.textContent = `${t('common.errorPrefix')} ${err.message}`;
  }

  btn.disabled = false;
  btn.textContent = t('license.trialBtn');
}

// ─── Start Free (offline) ────────────────────────────────────
async function startFree() {
  const btn = document.getElementById('btn-free');
  const feedback = document.getElementById('feedback-license');

  btn.disabled = true;
  btn.textContent = t('free.creating');
  feedback.className = 'feedback loading';
  feedback.textContent = t('free.activating');

  try {
    const result = await texacore.startFree();

    if (result.success) {
      feedback.className = 'feedback success';
      feedback.textContent = t('free.activated');
      setTimeout(refreshState, 1000);
    } else {
      feedback.className = 'feedback error';
      feedback.textContent = `❌ ${result.error}`;
    }
  } catch (err) {
    feedback.className = 'feedback error';
    feedback.textContent = `${t('common.errorPrefix')} ${err.message}`;
  }

  btn.disabled = false;
  btn.textContent = t('license.freeBtn');
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
  btn.innerHTML = `<span class="btn-icon">⏳</span><span>${t('status.starting')}</span>`;
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
      feedback.textContent = `❌ ${result.error}`;
    }
  } catch (err) {
    feedback.className = 'feedback error';
    feedback.textContent = `${t('common.errorPrefix')} ${err.message}`;
  }

  btn.disabled = false;
  btn.innerHTML = `<span class="btn-icon">▶</span><span>${t('btn.start')}</span>`;
}

// ─── Stop ERP ────────────────────────────────────────────────
async function stopERP() {
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
      feedback.textContent = `❌ ${result.error}`;
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

// ─── Cloud Logic ─────────────────────────────────────────────
async function toggleCloudView() {
  const isChecked = document.getElementById('input-cloud').checked;
  document.getElementById('cloud-content').style.display = isChecked ? 'block' : 'none';
  // Actually enable/disable cloud access — start/stop the Cloudflare tunnel NOW
  // (not just show/hide the panel). Turning it off cuts the public subdomain.
  const statusEl = document.getElementById('tunnel-status');
  try {
    if (statusEl) {
      statusEl.textContent = isChecked ? t('cloud.connecting') : t('cloud.disconnecting');
      statusEl.style.color = 'var(--warning)';
    }
    if (window.texacore && window.texacore.setCloudAccess) {
      await window.texacore.setCloudAccess(isChecked);
      if (currentState && currentState.config) currentState.config.enableCloud = isChecked;
    }
    if (statusEl) {
      if (isChecked) { statusEl.textContent = t('cloud.connectedMaybe'); statusEl.style.color = 'var(--accent)'; }
      else { statusEl.textContent = t('cloud.disconnectedFull'); statusEl.style.color = 'var(--danger)'; }
    }
  } catch (e) {
    console.error('[Cloud] setCloudAccess failed:', e);
    if (statusEl) { statusEl.textContent = t('cloud.toggleFailed'); statusEl.style.color = 'var(--danger)'; }
  }
}

// ─── Admin portal password (بوابة الإدارة) ──────────────────
async function saveAdminPassword() {
  const input = document.getElementById('input-admin-password');
  const statusEl = document.getElementById('admin-password-status');
  const btn = document.getElementById('btn-save-admin-password');
  const val = (input?.value || '').trim();
  if (val.length < 4) {
    if (statusEl) { statusEl.textContent = t('admin.tooShort'); statusEl.style.color = 'var(--danger)'; }
    return;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    const res = await window.texacore.setAdminPassword(val);
    if (res && res.success) {
      if (input) input.value = '';
      if (statusEl) { statusEl.textContent = t('admin.savedOk'); statusEl.style.color = 'var(--accent)'; }
      // Collapse the box shortly after a successful change.
      setTimeout(() => {
        const panel = document.getElementById('admin-password-panel');
        const chevron = document.getElementById('admin-password-chevron');
        if (panel) panel.style.display = 'none';
        if (chevron) chevron.textContent = t('admin.toggleChange');
      }, 1600);
    } else {
      if (statusEl) { statusEl.textContent = '⚠️ ' + ((res && res.error) || t('admin.saveFailed')); statusEl.style.color = 'var(--danger)'; }
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = '⚠️ ' + e.message; statusEl.style.color = 'var(--danger)'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('common.save'); }
  }
}

// Reflect whether a custom admin password is set (vs the license-key default).
async function refreshAdminPasswordStatus() {
  const statusEl = document.getElementById('admin-password-status');
  if (!statusEl || !window.texacore?.getAdminPasswordStatus) return;
  try {
    const s = await window.texacore.getAdminPasswordStatus();
    if (s && s.success) {
      statusEl.textContent = s.customized
        ? t('admin.statusCustom')
        : t('admin.statusDefault');
      statusEl.style.color = 'var(--text-muted)';
    }
  } catch { /* ignore */ }
}

// Collapsible: the button reveals the change-password box; it hides again
// after a successful save (or when toggled off).
function toggleAdminPasswordPanel() {
  const panel = document.getElementById('admin-password-panel');
  const chevron = document.getElementById('admin-password-chevron');
  if (!panel) return;
  const show = !panel.style.display || panel.style.display === 'none';
  panel.style.display = show ? 'block' : 'none';
  if (chevron) chevron.textContent = show ? t('admin.toggleClose') : t('admin.toggleChange');
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
    statusEl.textContent = t('subdomain.onlyLatin');
    statusEl.style.color = 'var(--danger)';
    btn.disabled = true;
    return;
  }

  statusEl.textContent = t('subdomain.checking');
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
        statusEl.textContent = t('subdomain.available');
        statusEl.style.color = 'var(--accent)';
        btn.disabled = false;
      } else {
        const reason = data.reason === 'reserved' ? t('subdomain.reservedName') :
                       data.reason === 'taken' ? t('subdomain.taken') :
                       data.reason === 'invalid_format' ? t('subdomain.badFormat') : t('subdomain.unavailable');
        statusEl.textContent = `❌ ${reason}`;
        statusEl.style.color = 'var(--danger)';
        btn.disabled = true;
      }
    } catch (err) {
      // Offline fallback — allow registration (server will validate)
      statusEl.textContent = t('subdomain.checkFailed');
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
  btn.textContent = t('subdomain.reserving');

  try {
    const result = await window.texacore.registerSubdomain(input.value);
    
    if (result.success) {
      if (!currentState.config) currentState.config = {};
      currentState.config.subdomain = input.value;
      currentState.config.enableCloud = true;
      
      document.getElementById('cloud-setup').style.display = 'none';
      document.getElementById('cloud-active').style.display = 'block';
      document.getElementById('cloud-url').textContent = result.url || `https://${input.value}.texacore.ai`;
      
      alert(t('subdomain.reserved'));
    } else {
      statusEl.textContent = `❌ ${result.error}`;
      statusEl.style.color = 'var(--danger)';
      btn.textContent = t('subdomain.registerNow');
      btn.disabled = false;
    }
  } catch (err) {
    statusEl.textContent = `❌ ${err.message}`;
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
