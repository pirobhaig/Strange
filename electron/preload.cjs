const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('strangeDesktop', {
  isDesktop: true,
  isVaultAvailable: () => ipcRenderer.invoke('strange:vault-available'),
  setSecret: (key, value) => ipcRenderer.invoke('strange:vault-set', key, value),
  deleteSecret: (key) => ipcRenderer.invoke('strange:vault-delete', key),
  openExternal: (url) => ipcRenderer.invoke('strange:open-external', url),
});
