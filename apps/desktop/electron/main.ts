import 'dotenv/config';
import { app, BrowserWindow, Menu, globalShortcut, Notification, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { registerAuthIpcHandlers } from './auth/ipc-handlers';
import { registerFilesIpcHandlers } from './files/ipc-handlers';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// Punch-Status file
// ---------------------------------------------------------------------------
let _punchStatusPath = '';

function getPunchStatusPath(): string {
  if (_punchStatusPath) return _punchStatusPath;
  try {
    _punchStatusPath = path.join(app.getPath('userData'), 'punch-status.json');
  } catch {
    _punchStatusPath = path.join(process.cwd(), 'punch-status.json');
  }
  return _punchStatusPath;
}

function writePunchStatus(isPunchedIn: boolean): void {
  try {
    const p = getPunchStatusPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ isPunchedIn }), 'utf8');
  } catch (err) {
    console.error('[ShutdownGate] writePunchStatus error:', err);
  }
}

// ---------------------------------------------------------------------------
// Shutdown-gate: compile-on-demand C# executable
// ---------------------------------------------------------------------------

function findCscExe(): string | null {
  const candidates = [
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework',   'v4.0.30319', 'csc.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function ensureBlockerExe(): Promise<string> {
  const userData = (() => { try { return app.getPath('userData'); } catch { return process.cwd(); } })();

  const srcPath = isDev
    ? path.join(__dirname, '..', 'electron', 'shutdown-blocker.cs')
    : path.join(process.resourcesPath, 'shutdown-blocker.cs');

  const exePath = path.join(userData, 'shutdown-blocker.exe');

  return new Promise<string>((resolve) => {
    try {
      fs.mkdirSync(userData, { recursive: true });

      const srcExists = fs.existsSync(srcPath);
      const exeExists = fs.existsSync(exePath);

      if (!srcExists) {
        console.error('[ShutdownGate] Source not found:', srcPath);
        return resolve('');
      }

      const srcMtime = fs.statSync(srcPath).mtimeMs;
      const exeMtime = exeExists ? fs.statSync(exePath).mtimeMs : 0;

      if (!exeExists || srcMtime > exeMtime) {
        const cscExe = findCscExe();
        if (!cscExe) {
          console.error('[ShutdownGate] csc.exe not found — shutdown gate disabled.');
          return resolve('');
        }

        console.log('[ShutdownGate] Compiling shutdown-blocker.exe …');
        execFile(
          cscExe,
          [
            '/nologo',
            '/target:winexe',
            '/r:System.Windows.Forms.dll',
            '/r:System.Drawing.dll',
            `/out:${exePath}`,
            srcPath,
          ],
          { windowsHide: true },
          (err) => {
            if (err) {
              console.error('[ShutdownGate] Compilation error:', err);
              return resolve('');
            }
            console.log('[ShutdownGate] Compilation succeeded.');
            resolve(exePath);
          },
        );
      } else {
        resolve(exePath);
      }
    } catch (err) {
      console.error('[ShutdownGate] ensureBlockerExe error:', err);
      resolve('');
    }
  });
}

function startShutdownHelper(): void {
  void _startShutdownHelperAsync();
}

async function _startShutdownHelperAsync(): Promise<void> {
  if (process.platform !== 'win32') return;

  const statusFile = getPunchStatusPath();
  if (!fs.existsSync(statusFile)) writePunchStatus(false);

  const exePath = await ensureBlockerExe();
  if (!exePath) return;

  const ps = spawn(
    exePath,
    [
      '--status-file', statusFile,
      '--pid',         String(process.pid),
      '--electron-exe', app.getPath('exe'),
    ],
    {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  ps.unref();

  ps.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const msg of lines) {
      if (msg === 'HELPER_READY') {
        console.log('[ShutdownGate] Helper is ready.');
      } else if (msg === 'SHUTDOWN_BLOCKED') {
        console.log('[ShutdownGate] Shutdown BLOCKED — employee is still clocked in.');
        if (mainWindow) {
          try {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('shutdown:punch-out-required');
          } catch { /* window may be closing */ }
        }
      } else if (msg === 'SHUTDOWN_ALLOWED') {
        console.log('[ShutdownGate] Shutdown allowed.');
      }
    }
  });

  ps.stderr?.on('data', (data: Buffer) => {
    const txt = data.toString().trim();
    if (txt) console.warn('[ShutdownGate] Helper stderr:', txt);
  });

  ps.on('error', (err) => console.error('[ShutdownGate] Spawn error:', err));
  ps.on('exit', (code) => console.log(`[ShutdownGate] Helper exited (code ${code ?? '?'}).`));
}

// ---------------------------------------------------------------------------
// IPC: renderer syncs punch status on every punch-in / punch-out
// ---------------------------------------------------------------------------
function registerShutdownIpcHandlers(): void {
  ipcMain.handle('shutdown:update-punch-status', (_event, isPunchedIn: boolean) => {
    writePunchStatus(isPunchedIn);
  });
}

// ---------------------------------------------------------------------------
// Auto-Updater
// ---------------------------------------------------------------------------
function setupAutoUpdater(): void {
  if (isDev) {
    console.log('[AutoUpdater] Skipped in dev mode.');
    return;
  }

  // Disable automatic download — we control when to install
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdater] Checking for update…');
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[AutoUpdater] Update available: v${info.version}`);
    // Notify the renderer so it can show the update banner
    mainWindow?.webContents.send('updater:update-available', { version: info.version });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log(`[AutoUpdater] Up to date (v${info.version}).`);
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[AutoUpdater] Downloading… ${progress.percent.toFixed(1)}%`);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[AutoUpdater] Update v${info.version} downloaded — will install on quit.`);
    // Notify renderer so it can show "Restart to install" banner
    mainWindow?.webContents.send('updater:update-downloaded', { version: info.version });
    // Also show a native Windows notification
    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'Update Ready',
        body: `Version ${info.version} has been downloaded. Restart the app to apply.`,
        silent: false,
      });
      n.on('click', () => autoUpdater.quitAndInstall(false, true));
      n.show();
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error:', err.message);
  });

  // Check for updates on startup, then every 4 hours
  void autoUpdater.checkForUpdates();
  setInterval(() => void autoUpdater.checkForUpdates(), 4 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Auto-Updater IPC handlers
// ---------------------------------------------------------------------------
function registerUpdaterIpcHandlers(): void {
  ipcMain.handle('updater:check-now', async () => {
    if (!isDev) await autoUpdater.checkForUpdates();
  });

  ipcMain.handle('updater:install-now', () => {
    if (!isDev) autoUpdater.quitAndInstall(false, true);
  });

  // Let renderer read the real app version from package.json
  ipcMain.handle('app:get-version', () => app.getVersion());
}

// ---------------------------------------------------------------------------
// Main window
// ---------------------------------------------------------------------------
function createMainWindow(): void {
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    title: 'Attendance Management System',
    autoHideMenuBar: true,
    show: false, // hold until ready-to-show so we can focus immediately
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow = win;
  win.setMenu(null);
  win.removeMenu();

  // Show & focus once the renderer is fully painted — prevents the blank/frozen window on startup
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
    void win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.webContents.on('before-input-event', (_event, input) => {
    const isCtrl = input.control || input.meta;
    if (input.type !== 'keyDown') return;
    if ((isCtrl && input.key === 'r') || input.key === 'F5') win.webContents.reload();
    if ((isCtrl && input.shift && input.key === 'R') || (isCtrl && input.key === 'F5')) win.webContents.reloadIgnoringCache();
    if ((isCtrl && input.shift && input.key === 'I') || input.key === 'F12') {
      win.webContents.isDevToolsOpened() ? win.webContents.closeDevTools() : win.webContents.openDevTools({ mode: 'detach' });
    }
  });
}

// ---------------------------------------------------------------------------
// Notification IPC
// ---------------------------------------------------------------------------
function registerNotifyIpcHandler(): void {
  ipcMain.handle('notify:show', (_event, title: string, body: string) => {
    try {
      if (Notification.isSupported()) {
        const n = new Notification({ title: title || 'Attendance System', body: body || '', silent: false });
        n.on('click', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
        n.show();
      }
    } catch { /* swallow */ }
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.attendance.desktop');
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
    }
  }

  registerAuthIpcHandlers();
  registerFilesIpcHandlers();
  registerNotifyIpcHandler();
  registerShutdownIpcHandlers();
  registerUpdaterIpcHandlers();
  createMainWindow();
  startShutdownHelper();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// NOTE: punch-status is intentionally NOT cleared on app quit.
app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});
