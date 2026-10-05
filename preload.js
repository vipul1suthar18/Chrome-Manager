const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getData: () => ipcRenderer.invoke('get-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  getChromeProfiles: () => ipcRenderer.invoke('get-chrome-profiles'),
  launchUrlWithProfile: (params) => ipcRenderer.invoke('launch-url-with-profile', params)
});
