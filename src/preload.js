const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script loaded');

// Expose protected methods using contextBridge for security
contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),

  // Steam and game detection
  detectSteamPath: () => ipcRenderer.invoke('detect-steam-path'),
  checkStartupModStatus: () => ipcRenderer.invoke('check-startup-mod-status'),
  browseFolder: () => ipcRenderer.invoke('browse-folder'),
  validateGamePath: (gamePath) => ipcRenderer.invoke('validate-game-path', gamePath),
  checkModInstalled: (gamePath) => ipcRenderer.invoke('check-mod-installed', gamePath),

  // Installation and uninstallation
  installDubbing: (gamePath, installOptions) => ipcRenderer.invoke('install-dubbing', gamePath, installOptions),
  uninstallDubbing: (gamePath) => ipcRenderer.invoke('uninstall-dubbing', gamePath),

  // Game launching and external links
  launchGame: () => ipcRenderer.invoke('launch-game'),
  openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),

  // Progress updates (one-way communication from main to renderer)
  onInstallationProgress: (callback) => {
    ipcRenderer.on('installation-progress', (event, data) => callback(data));
  },

  // Remove progress listener
  removeInstallationProgressListener: () => {
    ipcRenderer.removeAllListeners('installation-progress');
  }
});

console.log('electronAPI exposed to main world');
