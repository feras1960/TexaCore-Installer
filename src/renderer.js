// ════════════════════════════════════════════════════════════════
// 🖥️ TexaCore Installer — Renderer (UI Logic)
// ════════════════════════════════════════════════════════════════

let currentState = {};
let statusInterval = null;

// ─── Initialize ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Display version from package.json
  try {
    const ver = await texacore.getVersion();
    document.getElementById('version').textContent = `v${ver}`;
  } catch { /* fallback: stays as "v..." */ }

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

  if (!state.dockerInstalled) {
    // Show Docker install panel
    document.getElementById('panel-no-docker').style.display = 'block';
  } else if (!state.hasLicense) {
    // Show license activation
    document.getElementById('panel-license').style.display = 'block';
    if (state.config?.licenseKey) {
      document.getElementById('input-license').value = state.config.licenseKey;
    }
  } else {
    // Show control panel
    document.getElementById('panel-control').style.display = 'block';
    updateControlPanel(state);
  }

  // Set port
  if (state.config?.port) {
    document.getElementById('input-port').value = state.config.port;
  }
}

// ─── Update Status Cards ─────────────────────────────────────
function updateStatusCards(state) {
  // Docker
  const dockerStatus = document.getElementById('status-docker');
  const dockerIndicator = document.getElementById('indicator-docker');
  if (!state.dockerInstalled) {
    dockerStatus.textContent = 'غير مثبّت';
    dockerIndicator.className = 'status-indicator red';
  } else if (!state.dockerRunning) {
    dockerStatus.textContent = 'متوقف';
    dockerIndicator.className = 'status-indicator yellow';
  } else {
    dockerStatus.textContent = 'يعمل ✓';
    dockerIndicator.className = 'status-indicator green';
  }

  // License
  const licenseStatus = document.getElementById('status-license');
  const licenseIndicator = document.getElementById('indicator-license');
  if (state.hasLicense) {
    licenseStatus.textContent = 'مفعّل ✓';
    licenseIndicator.className = 'status-indicator green';
  } else {
    licenseStatus.textContent = 'غير مفعّل';
    licenseIndicator.className = 'status-indicator red';
  }

  // ERP
  const erpStatus = document.getElementById('status-erp');
  const erpIndicator = document.getElementById('indicator-erp');
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
    const exDate = li.expires_at ? new Date(li.expires_at).toLocaleDateString('ar-SA') : '--';
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

  btn.disabled = true;
  btn.innerHTML = '<span class="btn-icon">⏳</span><span>جاري التشغيل...</span>';
  feedback.className = 'feedback loading';
  feedback.textContent = 'جاري بدء تشغيل TexaCore...';

  try {
    const result = await texacore.startERP({
      licenseKey: currentState.config?.licenseKey,
      dbPassword: currentState.config?.dbPassword || 'texacore2026',
      port: parseInt(port),
    });

    if (result.success) {
      feedback.className = 'feedback success';
      feedback.textContent = result.ready
        ? `✅ النظام يعمل! → http://localhost:${result.port}`
        : '⏳ النظام يُحمّل... انتظر قليلاً ثم افتح المتصفح';
      
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

// ─── Enter key support ──────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const activePanel = document.querySelector('.panel[style*="display: block"], .panel:not([style*="display: none"])');
    if (activePanel?.id === 'panel-license') {
      activateLicense();
    }
  }
});

// ─── Docker Auto-Download ────────────────────────────────────
async function downloadDocker() {
  const btn = document.getElementById('btn-download-docker');
  const progressDiv = document.getElementById('docker-progress');
  const progressBar = document.getElementById('docker-progress-bar');
  const progressText = document.getElementById('docker-progress-text');

  btn.disabled = true;
  btn.textContent = '⏳ جاري التحميل...';
  progressDiv.style.display = 'block';

  try {
    const result = await texacore.downloadDocker();
    if (result.success) {
      progressText.textContent = '✅ تم التحميل! يرجى تثبيت Docker من الملف المفتوح ثم اضغط إعادة الفحص';
      progressBar.style.width = '100%';
      btn.textContent = '✅ تم التحميل';
    } else {
      progressText.textContent = `❌ فشل التحميل: ${result.error}`;
      btn.disabled = false;
      btn.textContent = '🔄 إعادة المحاولة';
    }
  } catch (err) {
    progressText.textContent = `❌ خطأ: ${err.message}`;
    btn.disabled = false;
    btn.textContent = '🔄 إعادة المحاولة';
  }
}

// Listen for Docker download progress
if (texacore.onDockerProgress) {
  texacore.onDockerProgress((data) => {
    const progressBar = document.getElementById('docker-progress-bar');
    const progressText = document.getElementById('docker-progress-text');
    if (!progressBar || !progressText) return;

    if (data.stage === 'downloading') {
      progressBar.style.width = `${data.percent}%`;
      progressText.textContent = `جاري التحميل... ${data.downloaded} MB / ${data.total} MB (${data.percent}%)`;
    } else if (data.stage === 'installing') {
      progressBar.style.width = '100%';
      progressText.textContent = '✅ اكتمل التحميل — جاري فتح ملف التثبيت...';
    } else if (data.stage === 'error') {
      progressText.textContent = `❌ خطأ: ${data.error}`;
    }
  });
}
