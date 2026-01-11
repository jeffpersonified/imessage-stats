import { contextBridge, ipcRenderer } from 'electron';
import { ExportProgress, ContactSummary, ContactData } from '../../src/exporter/types';

export interface ElectronAPI {
  // Permissions
  permissions: {
    check: () => Promise<boolean>;
    openSettings: () => Promise<void>;
    onStatus: (callback: (status: { hasFullDiskAccess: boolean }) => void) => void;
  };

  // Export
  export: {
    start: (options?: { limit?: number }) => Promise<{ success: boolean; error?: string; contactCount?: number }>;
    onProgress: (callback: (progress: ExportProgress) => void) => void;
  };

  // Contacts
  contacts: {
    list: () => Promise<ContactSummary[]>;
    get: (filename: string) => Promise<ContactData | null>;
  };

  // Data
  data: {
    isLoaded: () => Promise<boolean>;
    onDatabaseChanged: (callback: () => void) => void;
  };
}

const electronAPI: ElectronAPI = {
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

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
