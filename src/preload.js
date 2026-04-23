// ════════════════════════════════════════════════════════════════
// 🔗 Preload — Secure bridge between Main and Renderer
// ════════════════════════════════════════════════════════════════
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('texacore', {
  // State
  getState: () => ipcRenderer.invoke('get-state'),

  // License
  activateLicense: (key) => ipcRenderer.invoke('activate-license', key),
  startTrial: () => ipcRenderer.invoke('start-trial'),

  // Docker
  startERP: (config) => ipcRenderer.invoke('start-erp', config),
  stopERP: () => ipcRenderer.invoke('stop-erp'),
  installDocker: () => ipcRenderer.invoke('install-docker'),
  downloadDocker: () => ipcRenderer.invoke('download-docker'),
  onDockerProgress: (callback) => {
    ipcRenderer.on('docker-download-progress', (_, data) => callback(data));
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

  // Window
  minimize: () => ipcRenderer.invoke('window-minimize'),
  close: () => ipcRenderer.invoke('window-close'),
});
