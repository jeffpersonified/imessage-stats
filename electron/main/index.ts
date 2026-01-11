import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { checkFullDiskAccess, openSystemPreferences } from './permissions';
import { setupIpcHandlers } from './ipc-handlers';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;

// Get preload script path - native JS file, not webpack bundled
const getPreloadPath = (): string => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'preload.js');
  }
  // In dev mode, __dirname is .webpack/main, so go up to project root
  return path.join(app.getAppPath(), 'electron/preload/preload.js');
};

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

app.on('ready', async () => {
  setupIpcHandlers();
  createWindow();

  // Check permissions and notify renderer
  const hasAccess = await checkFullDiskAccess();
  if (mainWindow) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow?.webContents.send('permissions:status', { hasFullDiskAccess: hasAccess });
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle permission check request
ipcMain.handle('permissions:check', async () => {
  return checkFullDiskAccess();
});

// Handle open system preferences
ipcMain.handle('permissions:openSettings', () => {
  openSystemPreferences();
});
