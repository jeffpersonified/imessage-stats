import { watch, FSWatcher } from 'fs';
import { BrowserWindow } from 'electron';
import { CHAT_DB_PATH } from './permissions';

const DEBOUNCE_MS = 2000; // Wait 2 seconds after last change

let watcher: FSWatcher | null = null;
let debounceTimer: NodeJS.Timeout | null = null;

/**
 * Start watching chat.db for changes
 */
export function startWatching(mainWindow: BrowserWindow): void {
  if (watcher) return;

  try {
    watcher = watch(CHAT_DB_PATH, (eventType) => {
      if (eventType !== 'change') return;

      // Debounce - iMessage can write multiple times quickly
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('database:changed');
        }
      }, DEBOUNCE_MS);
    });

    watcher.on('error', (error) => {
      console.error('File watcher error:', error);
    });

    console.log('Started watching chat.db for changes');
  } catch (error) {
    console.error('Failed to start file watcher:', error);
  }
}

/**
 * Stop watching chat.db
 */
export function stopWatching(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (watcher) {
    watcher.close();
    watcher = null;
    console.log('Stopped watching chat.db');
  }
}
