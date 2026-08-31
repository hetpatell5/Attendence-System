import 'dotenv/config';
import { app, BrowserWindow, Menu, globalShortcut, Notification, ipcMain } from 'electron';
import path from 'node:path';
import { registerAuthIpcHandlers } from './auth/ipc-handlers';
import { registerFilesIpcHandlers } from './files/ipc-handlers';

const isDev = !app.isPackaged;

function createMainWindow(): void {
  // Remove the native File/Edit/View/Window/Help menu bar entirely
  Menu.setApplicationMenu(null);

  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    title: 'Attendance Management System',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenu(null);
  mainWindow.removeMenu();

  if (isDev) {
    // VITE_DEV_SERVER_URL lets another PC point to the main PC's Vite server
    const devUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
    void mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Re-register keyboard shortcuts that were lost when we removed the native menu
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    const isCtrl = input.control || input.meta;
    if (input.type !== 'keyDown') return;

    // Ctrl+R / F5 → soft reload (hot-reload in dev, page reload in prod)
    if ((isCtrl && input.key === 'r') || input.key === 'F5') {
      mainWindow.webContents.reload();
    }

    // Ctrl+Shift+R / Ctrl+F5 → hard reload (bypass cache)
    if ((isCtrl && input.shift && input.key === 'R') || (isCtrl && input.key === 'F5')) {
      mainWindow.webContents.reloadIgnoringCache();
    }

    // Ctrl+Shift+I / F12 → toggle DevTools
    if ((isCtrl && input.shift && input.key === 'I') || input.key === 'F12') {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    }
  });
}

/**
 * Register IPC handler for showing native OS notifications from renderer.
 * Renderer calls: window.electronApi.notify.show(title, body)
 */
function registerNotifyIpcHandler(): void {
  ipcMain.handle('notify:show', (_event, title: string, body: string) => {
    try {
      if (Notification.isSupported()) {
        const notification = new Notification({
          title,
          body,
          silent: false,
        });
        notification.show();
      }
    } catch {
      // Notifications may not be available in all environments — swallow silently
    }
  });
}

app.whenReady().then(() => {
  registerAuthIpcHandlers();
  registerFilesIpcHandlers();
  registerNotifyIpcHandler();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
