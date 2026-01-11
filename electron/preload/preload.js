// Native preload script - not bundled by webpack
const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
  permissions: {
    check: () => ipcRenderer.invoke('permissions:check'),
    openSettings: () => ipcRenderer.invoke('permissions:openSettings'),
    onStatus: (callback) => {
      ipcRenderer.on('permissions:status', (_, status) => callback(status));
    },
  },

  export: {
    start: (options) => ipcRenderer.invoke('export:start', options),
    onProgress: (callback) => {
      ipcRenderer.on('export:progress', (_, progress) => callback(progress));
    },
  },

  contacts: {
    list: () => ipcRenderer.invoke('contacts:list'),
    get: (filename) => ipcRenderer.invoke('contacts:get', filename),
  },

  data: {
    isLoaded: () => ipcRenderer.invoke('data:isLoaded'),
    onDatabaseChanged: (callback) => {
      ipcRenderer.on('database:changed', () => callback());
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
