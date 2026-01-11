import { ipcMain, BrowserWindow } from 'electron';
import { runExport } from '../../src/exporter';
import { ExportOptions, ExportProgress, ContactSummary, ContactData } from '../../src/exporter/types';
import { startWatching } from './file-watcher';

// In-memory cache of exported data
let cachedContacts: ContactSummary[] = [];
let cachedMessages: Map<string, ContactData> = new Map();
let isExporting = false;

export function setupIpcHandlers(): void {
  // Start or restart export
  ipcMain.handle('export:start', async (event, options?: Partial<ExportOptions>) => {
    if (isExporting) {
      return { success: false, error: 'Export already in progress' };
    }

    const win = BrowserWindow.fromWebContents(event.sender);
    isExporting = true;

    const onProgress = (progress: ExportProgress) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('export:progress', progress);
      }
    };

    try {
      const result = await runExport({
        limit: options?.limit ?? 100,
        onProgress,
      });

      cachedContacts = result.contacts;
      cachedMessages = new Map(Object.entries(result.messages));

      // Start watching after successful export
      if (win && !win.isDestroyed()) {
        startWatching(win);
      }

      return { success: true, contactCount: result.contacts.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: message };
    } finally {
      isExporting = false;
    }
  });

  // Get contacts list
  ipcMain.handle('contacts:list', async () => {
    return cachedContacts;
  });

  // Get contact details
  ipcMain.handle('contacts:get', async (_, filename: string) => {
    return cachedMessages.get(filename) ?? null;
  });

  // Check if data is loaded
  ipcMain.handle('data:isLoaded', async () => {
    return cachedContacts.length > 0;
  });
}
