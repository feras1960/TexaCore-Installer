// ════════════════════════════════════════════════════════════════
// 🔗 Preload — Secure bridge between Main and Renderer
// ════════════════════════════════════════════════════════════════
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('texacore', {
  // Version
  getVersion: () => ipcRenderer.invoke('get-version'),

  // State
  getState: () => ipcRenderer.invoke('get-state'),

  // License
  activateLicense: (key) => ipcRenderer.invoke('activate-license', key),
  startTrial: () => ipcRenderer.invoke('start-trial'),

  // Cloud
  registerSubdomain: (subdomain) => ipcRenderer.invoke('register-subdomain', subdomain),

  // Services
  startERP: (config) => ipcRenderer.invoke('start-erp', config),
  stopERP: () => ipcRenderer.invoke('stop-erp'),
  createLocalCompany: (data) => ipcRenderer.invoke('create-local-company', data),
  installDocker: () => ipcRenderer.invoke('install-docker'),
  downloadDocker: () => ipcRenderer.invoke('download-docker'),
  showInFolder: (path) => ipcRenderer.invoke('show-in-folder', path),
  onDockerProgress: (callback) => {
    ipcRenderer.on('docker-download-progress', (_, data) => callback(data));
  },

  // Migrations
  getMigrationStatus: () => ipcRenderer.invoke('migration-status'),
  onMigrationProgress: (callback) => {
    ipcRenderer.on('migration-progress', (_, data) => callback(data));
  },

  // Updates
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkDockerUpdate: () => ipcRenderer.invoke('check-docker-update'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, d) => cb(d)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_, d) => cb(d)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', () => cb()),

  // Browser
  openBrowser: (port) => ipcRenderer.invoke('open-browser', port),

  // Backup
  restoreBackup: (filePath) => ipcRenderer.invoke('backup-restore', filePath),
  backupStatus: () => ipcRenderer.invoke('backup-status'),
  onBackupProgress: (cb) => ipcRenderer.on('backup-progress', (_, d) => cb(d)),

  // RSF Import/Export (Al-Rasheed)
  detectFileType: (filePath) => ipcRenderer.invoke('detect-file-type', filePath),
  rsfSummary: (filePath) => ipcRenderer.invoke('rsf-summary', filePath),
  importRSF: (filePath) => ipcRenderer.invoke('import-rsf', filePath),
  exportRSF: (rsfPath) => ipcRenderer.invoke('export-rsf', rsfPath),
  onRsfProgress: (cb) => ipcRenderer.on('rsf-progress', (_, d) => cb(d)),

  // Window
  minimize: () => ipcRenderer.invoke('window-minimize'),
  close: () => ipcRenderer.invoke('window-close'),
});
