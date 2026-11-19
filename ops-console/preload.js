const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ops', {
  getConfig: () => ipcRenderer.invoke('ops:get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('ops:save-config', cfg),
  fetchConsole: () => ipcRenderer.invoke('ops:fetch-console'),
  fetchUpdates: () => ipcRenderer.invoke('ops:fetch-updates'),
  api: (method, path, body) => ipcRenderer.invoke('ops:api', { method, path, body }),
  setThemeChrome: (themeId) => ipcRenderer.invoke('ops:set-theme-chrome', themeId),
});
