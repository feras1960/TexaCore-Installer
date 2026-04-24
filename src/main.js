// ════════════════════════════════════════════════════════════════
// 🖥️ TexaCore Installer — Electron Main Process
// ════════════════════════════════════════════════════════════════

const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { autoUpdater } = require('electron-updater');

// ─── Constants ───────────────────────────────────────────────
const LICENSING_URL = 'https://wzkklenfsaepegymfxfz.supabase.co/functions/v1';
const DOCKER_IMAGE = 'texacore-web:1.0.1';
const CONTAINER_NAME = 'texacore-erp';
const APP_PORT = 80;

// ─── Data Directory ──────────────────────────────────────────
const DATA_DIR = path.join(app.getPath('userData'), 'texacore-data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const LICENSE_FILE = path.join(DATA_DIR, 'license.json');

let mainWindow = null;
let tray = null;

// ─── Ensure data directory exists ────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// ─── Load/Save Config ────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
  return { licenseKey: '', dbPassword: '', port: APP_PORT };
}

function saveConfig(config) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// ─── Create Window ───────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 620,
    minWidth: 700,
    minHeight: 550,
    resizable: true,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a1628',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Hide to tray instead of closing
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      // On macOS, hide dock icon when window is hidden
      if (process.platform === 'darwin') {
        app.dock.hide();
      }
    }
  });

  mainWindow.on('show', () => {
    if (process.platform === 'darwin') {
      app.dock.show();
    }
  });
}

// ─── Docker Helpers ──────────────────────────────────────────
const DOCKER_PATHS = [
  '/usr/local/bin',
  '/usr/bin',
  '/opt/homebrew/bin',
  '/Applications/Docker.app/Contents/Resources/bin',
  process.env.PATH,
].join(':');

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 120000, env: { ...process.env, PATH: DOCKER_PATHS } }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout.trim());
    });
  });
}

async function isDockerInstalled() {
  try {
    await runCommand('docker --version');
    return true;
  } catch { return false; }
}

async function isDockerRunning() {
  try {
    await runCommand('docker info');
    return true;
  } catch { return false; }
}

async function isContainerRunning() {
  try {
    const result = await runCommand(`docker ps --filter name=${CONTAINER_NAME} --format "{{.Status}}"`);
    return result.includes('Up');
  } catch { return false; }
}

async function getContainerStatus() {
  try {
    const running = await isContainerRunning();
    if (running) {
      // Check health
      try {
        const healthResult = await runCommand(`docker inspect --format='{{.State.Health.Status}}' ${CONTAINER_NAME}`);
        return { running: true, health: healthResult.trim() };
      } catch {
        return { running: true, health: 'unknown' };
      }
    }
    return { running: false, health: 'stopped' };
  } catch {
    return { running: false, health: 'error' };
  }
}

// ─── HTTP Request Helper ─────────────────────────────────────
function httpPost(url, data) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    };

    const lib = urlObj.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch { resolve(body); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(JSON.stringify(data));
    req.end();
  });
}

// ─── IPC Handlers ────────────────────────────────────────────

// Get initial state
ipcMain.handle('get-state', async () => {
  const config = loadConfig();
  const dockerInstalled = await isDockerInstalled();
  const dockerRunning = dockerInstalled ? await isDockerRunning() : false;
  const containerStatus = dockerRunning ? await getContainerStatus() : { running: false, health: 'stopped' };
  const hasLicense = fs.existsSync(LICENSE_FILE);
  let licenseInfo = null;
  if (hasLicense) {
    try { licenseInfo = JSON.parse(fs.readFileSync(LICENSE_FILE, 'utf8')); } catch {}
  }

  return {
    config,
    dockerInstalled,
    dockerRunning,
    containerRunning: containerStatus.running,
    containerHealth: containerStatus.health,
    hasLicense,
    licenseInfo,
    port: config.port || APP_PORT,
  };
});

// Activate license
ipcMain.handle('activate-license', async (_, licenseKey) => {
  try {
    const hardwareId = await runCommand(
      process.platform === 'darwin'
        ? "system_profiler SPHardwareDataType | grep 'Serial Number' | awk '{print $NF}'"
        : "wmic csproduct get uuid | findstr /v UUID"
    ).catch(() => `DESKTOP-${Date.now()}`);

    const result = await httpPost(`${LICENSING_URL}/license-activate`, {
      license_key: licenseKey,
      hardware_id: `DESKTOP-${hardwareId.replace(/\s/g, '')}`,
      os_info: `${process.platform} ${process.arch}`,
      hostname: require('os').hostname(),
    });

    if (result.success) {
      ensureDataDir();
      fs.writeFileSync(LICENSE_FILE, JSON.stringify(result.license, null, 2));
      const config = loadConfig();
      config.licenseKey = licenseKey;
      saveConfig(config);
      return { success: true, license: result.license };
    }

    return { success: false, error: result.error || 'Activation failed' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Start ERP
ipcMain.handle('start-erp', async (_, { licenseKey, dbPassword, port }) => {
  try {
    // Save config
    saveConfig({ licenseKey, dbPassword, port: port || APP_PORT });

    // Check Docker
    if (!await isDockerRunning()) {
      return { success: false, error: 'Docker غير شغّال. يرجى تشغيل Docker Desktop أولاً.' };
    }

    // Stop existing container if any
    await runCommand(`docker stop ${CONTAINER_NAME} 2>/dev/null || true`);
    await runCommand(`docker rm ${CONTAINER_NAME} 2>/dev/null || true`);

    // Read Supabase credentials
    const supabaseUrl = 'https://wzkklenfsaepegymfxfz.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind6a2tsZW5mc2FlcGVneW1meGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg3NTIxNzcsImV4cCI6MjA4NDMyODE3N30.ATYSK_WvOfbqEaInbg5nKau-wgixF0lIGaue3m8AJtI';

    // Start container
    const runCmd = [
      'docker run -d',
      `--name ${CONTAINER_NAME}`,
      `-p ${port || APP_PORT}:80`,
      `--restart unless-stopped`,
      `-e LICENSE_KEY="${licenseKey}"`,
      `-e LICENSING_SERVER_URL="${LICENSING_URL}"`,
      `-e APP_VERSION="1.0.1"`,
      `-e SUPABASE_URL="${supabaseUrl}"`,
      `-e SUPABASE_ANON_KEY="${supabaseKey}"`,
      DOCKER_IMAGE,
    ].join(' ');

    await runCommand(runCmd);

    // Wait for container to be ready
    let ready = false;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 1000));
      try {
        const health = await runCommand(`curl -sf http://localhost:${port || APP_PORT}/health`);
        if (health.includes('healthy')) { ready = true; break; }
      } catch { /* retry */ }
    }

    return { success: true, ready, port: port || APP_PORT };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Stop ERP
ipcMain.handle('stop-erp', async () => {
  try {
    await runCommand(`docker stop ${CONTAINER_NAME}`);
    await runCommand(`docker rm ${CONTAINER_NAME}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Start Trial
ipcMain.handle('start-trial', async () => {
  try {
    const hardwareId = await runCommand(
      process.platform === 'darwin'
        ? "system_profiler SPHardwareDataType | grep 'Serial Number' | awk '{print $NF}'"
        : "wmic csproduct get uuid | findstr /v UUID"
    ).catch(() => `DESKTOP-${Date.now()}`);

    const result = await httpPost(`${LICENSING_URL}/license-trial`, {
      hardware_id: `DESKTOP-${hardwareId.replace(/\s/g, '')}`,
      os_info: `${process.platform} ${process.arch}`,
      hostname: require('os').hostname(),
    });

    if (result.success) {
      ensureDataDir();
      fs.writeFileSync(LICENSE_FILE, JSON.stringify(result.license, null, 2));
      const config = loadConfig();
      config.licenseKey = result.license.license_key;
      config.isTrial = true;
      saveConfig(config);
      return { success: true, license: result.license };
    }

    // If trial already exists, use existing
    if (result.error === 'trial_already_exists' && result.license) {
      ensureDataDir();
      fs.writeFileSync(LICENSE_FILE, JSON.stringify(result.license, null, 2));
      return { success: true, license: result.license, existing: true };
    }

    return { success: false, error: result.error || result.message || 'Trial failed' };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Open browser
ipcMain.handle('open-browser', async (_, port) => {
  shell.openExternal(`http://localhost:${port || APP_PORT}`);
});

// Window controls
ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-close', () => mainWindow?.close());

// Download & Install Docker automatically
ipcMain.handle('download-docker', async () => {
  try {
    const os = require('os');
    const arch = os.arch(); // 'arm64' or 'x64'
    let downloadUrl, fileName;

    if (process.platform === 'darwin') {
      downloadUrl = arch === 'arm64'
        ? 'https://desktop.docker.com/mac/main/arm64/Docker.dmg'
        : 'https://desktop.docker.com/mac/main/amd64/Docker.dmg';
      fileName = 'Docker.dmg';
    } else {
      downloadUrl = 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe';
      fileName = 'DockerDesktopInstaller.exe';
    }

    const downloadPath = path.join(app.getPath('temp'), fileName);

    // Send progress to renderer
    mainWindow?.webContents.send('docker-download-progress', { stage: 'starting', percent: 0 });

    // Download with progress
    await new Promise((resolve, reject) => {
      const followRedirect = (url) => {
        const lib = url.startsWith('https') ? https : http;
        lib.get(url, { headers: { 'User-Agent': 'TexaCore-Installer/1.0' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            followRedirect(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: ${res.statusCode}`));
            return;
          }

          const totalSize = parseInt(res.headers['content-length'], 10);
          let downloaded = 0;
          const file = fs.createWriteStream(downloadPath);

          res.on('data', (chunk) => {
            downloaded += chunk.length;
            const percent = totalSize ? Math.round((downloaded / totalSize) * 100) : 0;
            mainWindow?.webContents.send('docker-download-progress', {
              stage: 'downloading', percent,
              downloaded: (downloaded / 1024 / 1024).toFixed(1),
              total: totalSize ? (totalSize / 1024 / 1024).toFixed(0) : '?',
            });
          });

          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
          file.on('error', reject);
        }).on('error', reject);
      };
      followRedirect(downloadUrl);
    });

    mainWindow?.webContents.send('docker-download-progress', { stage: 'installing', percent: 100 });

    // Auto-run the installer
    if (process.platform === 'darwin') {
      // macOS: mount DMG and open the app
      try {
        await runCommand(`hdiutil attach "${downloadPath}" -nobrowse`);
        await runCommand('cp -R "/Volumes/Docker/Docker.app" /Applications/');
        await runCommand(`hdiutil detach "/Volumes/Docker"`);
        await runCommand('open /Applications/Docker.app');
        mainWindow?.webContents.send('docker-download-progress', { stage: 'installed', percent: 100 });
      } catch (mountErr) {
        // Fallback: just open the DMG
        shell.openPath(downloadPath);
      }
    } else {
      // Windows: run installer with admin privileges (silent install)
      try {
        // Try silent install first
        const { execFile } = require('child_process');
        await new Promise((resolve, reject) => {
          execFile(downloadPath, ['install', '--quiet', '--accept-license'], {
            timeout: 300000, // 5 min timeout
            env: { ...process.env, PATH: DOCKER_PATHS },
          }, (error) => {
            if (error) reject(error);
            else resolve();
          });
        });
        mainWindow?.webContents.send('docker-download-progress', { stage: 'installed', percent: 100 });
      } catch (silentErr) {
        // Fallback: open installer normally (user will see Docker installer UI)
        shell.openPath(downloadPath);
        mainWindow?.webContents.send('docker-download-progress', { stage: 'manual-install', percent: 100 });
      }
    }

    return { success: true, path: downloadPath };
  } catch (err) {
    mainWindow?.webContents.send('docker-download-progress', { stage: 'error', error: err.message });
    return { success: false, error: err.message };
  }
});

// Open Docker download page (fallback)
ipcMain.handle('install-docker', () => {
  shell.openExternal('https://www.docker.com/products/docker-desktop/');
});

// ─── System Tray ─────────────────────────────────────────────
function createTray() {
  const trayIconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'trayTemplate.png')
    : path.join(__dirname, '..', 'build', 'trayTemplate.png');

  const icon = nativeImage.createFromPath(trayIconPath);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('TexaCore ERP');

  const updateTrayMenu = async () => {
    const running = await isContainerRunning().catch(() => false);
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'TexaCore ERP',
        enabled: false,
        icon: icon,
      },
      { type: 'separator' },
      {
        label: '📊 فتح لوحة التحكم',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        },
      },
      {
        label: '🌐 فتح في المتصفح',
        click: () => {
          const config = loadConfig();
          shell.openExternal(`http://localhost:${config.port || APP_PORT}`);
        },
      },
      { type: 'separator' },
      {
        label: running ? '⏹ إيقاف النظام' : '▶ تشغيل النظام',
        click: async () => {
          if (running) {
            await runCommand(`docker stop ${CONTAINER_NAME}`).catch(() => {});
            await runCommand(`docker rm ${CONTAINER_NAME}`).catch(() => {});
          } else {
            if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
            else createWindow();
          }
          updateTrayMenu();
        },
      },
      { type: 'separator' },
      {
        label: '❌ إنهاء TexaCore',
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setContextMenu(contextMenu);
  };

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  updateTrayMenu();
  // Refresh tray menu every 10 seconds
  setInterval(updateTrayMenu, 10000);
}

// ─── Auto-Update System ──────────────────────────────────────
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('update-not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update-progress', {
      percent: Math.round(progress.percent),
      transferred: (progress.transferred / 1024 / 1024).toFixed(1),
      total: (progress.total / 1024 / 1024).toFixed(0),
    });
  });

  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-downloaded');
  });

  autoUpdater.on('error', (err) => {
    console.error('Update error:', err);
  });

  // Check for updates after 5 seconds
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

// Check for update (manual)
ipcMain.handle('check-for-update', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { available: !!result?.updateInfo, version: result?.updateInfo?.version };
  } catch {
    return { available: false };
  }
});

// Download update
ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Install update
ipcMain.handle('install-update', () => {
  app.isQuitting = true;
  autoUpdater.quitAndInstall();
});

// Check Docker image update
ipcMain.handle('check-docker-update', async () => {
  try {
    const currentImage = DOCKER_IMAGE;
    const latestTag = await runCommand(`docker pull ${currentImage} 2>&1 | grep 'Status'`).catch(() => '');
    const isNew = latestTag.includes('Downloaded newer image');
    return { available: isNew, image: currentImage };
  } catch {
    return { available: false };
  }
});

// ─── App Lifecycle ───────────────────────────────────────────
app.whenReady().then(() => {
  ensureDataDir();
  createTray();
  createWindow();
  setupAutoUpdater();

  // Set dock icon (macOS)
  if (process.platform === 'darwin') {
    app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png'));
  }
});

app.on('window-all-closed', () => {
  // Don't quit — keep running in tray
  if (process.platform !== 'darwin') {
    // On Windows/Linux, keep in tray
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
