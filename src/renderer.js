// ════════════════════════════════════════════════════════════════
// 🖥️ TexaCore Installer — Renderer (UI Logic)
// v2: Native embedded services — no Docker dependency
// ════════════════════════════════════════════════════════════════

let currentState = {};
let statusInterval = null;

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
  // Auto-refresh status every 5 seconds
  statusInterval = setInterval(refreshStatus, 5000);
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
    updateControlButtons(state);
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
        dbStatus.textContent = 'يعمل ✓';
        dbIndicator.className = 'status-indicator green';
      } else {
        dbStatus.textContent = 'جاري التشغيل...';
        dbIndicator.className = 'status-indicator blue';
      }
    } else {
      dbStatus.textContent = 'متوقف';
      dbIndicator.className = 'status-indicator yellow';
    }
  }

  // License
  const licenseStatus = document.getElementById('status-license');
  const licenseIndicator = document.getElementById('indicator-license');
  if (licenseStatus && licenseIndicator) {
    if (state.hasLicense) {
      licenseStatus.textContent = 'مفعّل ✓';
      licenseIndicator.className = 'status-indicator green';
    } else {
      licenseStatus.textContent = 'غير مفعّل';
      licenseIndicator.className = 'status-indicator red';
    }
  }

  // ERP
  const erpStatus = document.getElementById('status-erp');
  const erpIndicator = document.getElementById('indicator-erp');
  if (erpStatus && erpIndicator) {
    if (state.containerRunning) {
      if (state.containerHealth === 'healthy') {
        erpStatus.textContent = 'يعمل ✓';
        erpIndicator.className = 'status-indicator green';
      } else {
        erpStatus.textContent = 'جاري التشغيل...';
        erpIndicator.className = 'status-indicator blue';
      }
    } else {
      erpStatus.textContent = 'متوقف';
      erpIndicator.className = 'status-indicator red';
    }
  }

  // Tunnel
  const tunnelStatusEl = document.getElementById('tunnel-status');
  if (tunnelStatusEl) {
    if (state.containerRunning) {
      tunnelStatusEl.textContent = 'متصل 🟢';
      tunnelStatusEl.style.color = 'var(--accent)';
    } else {
      tunnelStatusEl.textContent = 'غير متصل 🔴';
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
      exDate = new Intl.DateTimeFormat('ar-EG', {
        calendar: 'gregory',
        numberingSystem: 'latn',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      }).format(d);
    }
    
    const daysLeft = li.expires_at ? Math.ceil((new Date(li.expires_at) - Date.now()) / 86400000) : 0;
    expiresEl.textContent = `ينتهي: ${exDate} (${daysLeft} يوم)`;
  }
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
    feedback.textContent = '❌ الرجاء إدخال مفتاح الترخيص';
    input.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ جاري التفعيل...';
  feedback.className = 'feedback loading';
  feedback.textContent = 'جاري الاتصال بسيرفر التراخيص...';

  try {
    const result = await texacore.activateLicense(key);

    if (result.success) {
      feedback.className = 'feedback success';
      feedback.textContent = `✅ تم التفعيل! الباقة: ${result.license.tier} — ينتهي: ${new Date(result.license.expires_at).toLocaleDateString('ar')}`;
      
      // Refresh after 1 second
      setTimeout(refreshState, 1000);
    } else {
      feedback.className = 'feedback error';
      feedback.textContent = `❌ فشل التفعيل: ${result.error}`;
    }
  } catch (err) {
    feedback.className = 'feedback error';
    feedback.textContent = `❌ خطأ: ${err.message}`;
  }

  btn.disabled = false;
  btn.textContent = '⚡ تفعيل الترخيص';
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
  btn.textContent = '⏳ جاري إنشاء النسخة التجريبية...';
  feedback.className = 'feedback loading';
  feedback.textContent = 'جاري الاتصال بالسيرفر...';

  try {
    const result = await texacore.startTrial();

    if (result.success) {
      feedback.className = 'feedback success';
      const msg = result.existing
        ? '✅ لديك نسخة تجريبية بالفعل! يتم التفعيل...'
        : '🎉 تم تفعيل النسخة التجريبية — 30 يوم مجاناً!';
      feedback.textContent = msg;
      setTimeout(refreshState, 1000);
    } else {
      feedback.className = 'feedback error';
      feedback.textContent = `❌ ${result.error}`;
    }
  } catch (err) {
    feedback.className = 'feedback error';
    feedback.textContent = `❌ خطأ: ${err.message}`;
  }

  btn.disabled = false;
  btn.textContent = '🎁 ابدأ تجربة مجانية — 30 يوم';
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
    feedback.textContent = '❌ يرجى حجز النطاق المخصص أولاً';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span><span>جاري التشغيل...</span>';
  feedback.className = 'feedback loading';
  feedback.textContent = 'جاري بدء تشغيل الخدمات...';

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
        migInfo = ` (${result.migrations.applied} مايقريشن مطبّق)`;
      }

      feedback.textContent = result.ready
        ? `✅ النظام يعمل!${migInfo} → http://localhost:${result.port}`
        : '⏳ النظام يُحمّل... انتظر قليلاً ثم افتح المتصفح';

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
    feedback.textContent = `❌ خطأ: ${err.message}`;
  }

  btn.disabled = false;
  btn.innerHTML = '<span class="btn-icon">▶</span><span>تشغيل النظام</span>';
}

// ─── Stop ERP ────────────────────────────────────────────────
async function stopERP() {
  const btn = document.getElementById('btn-stop');
  const feedback = document.getElementById('feedback-control');

  btn.disabled = true;
  feedback.className = 'feedback loading';
  feedback.textContent = 'جاري إيقاف النظام...';

  try {
    const result = await texacore.stopERP();
    if (result.success) {
      feedback.className = 'feedback info';
      feedback.textContent = '⏹ تم إيقاف النظام';
      await refreshState();
    } else {
      feedback.className = 'feedback error';
      feedback.textContent = `❌ ${result.error}`;
    }
  } catch (err) {
    feedback.className = 'feedback error';
    feedback.textContent = `❌ خطأ: ${err.message}`;
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

// ─── Cloud Logic ─────────────────────────────────────────────
function toggleCloudView() {
  const isChecked = document.getElementById('input-cloud').checked;
  document.getElementById('cloud-content').style.display = isChecked ? 'block' : 'none';
}

let checkTimeout;
function checkSubdomain(value) {
  const statusEl = document.getElementById('domain-status');
  const btn = document.getElementById('btn-register-domain');
  
  if (!value) {
    statusEl.textContent = 'يرجى كتابة نطاق للتحقق...';
    statusEl.style.color = 'var(--text-muted)';
    btn.disabled = true;
    return;
  }

  statusEl.textContent = 'جاري التحقق ⏳...';
  statusEl.style.color = 'var(--warning)';
  btn.disabled = true;

  clearTimeout(checkTimeout);
  checkTimeout = setTimeout(() => {
    if (value === 'admin' || value === 'test' || value === 'texacore') {
      statusEl.textContent = '❌ النطاق غير متاح';
      statusEl.style.color = 'var(--danger)';
      btn.disabled = true;
    } else {
      statusEl.textContent = '✅ النطاق متاح!';
      statusEl.style.color = 'var(--accent)';
      btn.disabled = false;
    }
  }, 800);
}

async function registerSubdomain() {
  const input = document.getElementById('input-subdomain');
  const btn = document.getElementById('btn-register-domain');
  const statusEl = document.getElementById('domain-status');
  
  if (!input.value) return;

  btn.disabled = true;
  btn.textContent = '⏳ جاري الحجز...';
  
  try {
    const result = await window.texacore.registerSubdomain(input.value);
    
    if (result.success) {
      if (!currentState.config) currentState.config = {};
      currentState.config.subdomain = input.value;
      currentState.config.enableCloud = true;
      
      document.getElementById('cloud-setup').style.display = 'none';
      document.getElementById('cloud-active').style.display = 'block';
      document.getElementById('cloud-url').textContent = result.url || `https://${input.value}.texacore.ai`;
      
      alert('🎉 تم حجز النطاق بنجاح! سيتم تفعيله عند تشغيل النظام.');
    } else {
      statusEl.textContent = `❌ فشل الحجز: ${result.error}`;
      statusEl.style.color = 'var(--danger)';
      btn.textContent = 'التسجيل الآن';
      btn.disabled = false;
    }
  } catch (err) {
    statusEl.textContent = `❌ خطأ غير متوقع: ${err.message}`;
    statusEl.style.color = 'var(--danger)';
    btn.textContent = 'التسجيل الآن';
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
