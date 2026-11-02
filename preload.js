const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getData: () => ipcRenderer.invoke('get-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  getChromeProfiles: () => ipcRenderer.invoke('get-chrome-profiles'),
  launchUrlWithProfile: (params) => ipcRenderer.invoke('launch-url-with-profile', params),
  startReportDownloadOrganization: (params) => ipcRenderer.invoke('start-report-download-organization', params),
  getReportDownloadStatus: (id) => ipcRenderer.invoke('get-report-download-status', id),
  cancelReportDownloadOrganization: (id) => ipcRenderer.invoke('cancel-report-download-organization', id)
});
