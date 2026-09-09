import 'dotenv/config';
import { app, BrowserWindow, Menu, globalShortcut, Notification, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { registerAuthIpcHandlers } from './auth/ipc-handlers';
import { registerFilesIpcHandlers } from './files/ipc-handlers';
import { getApiUrl, setApiUrl } from './config';

const isDev = !app.isPackaged;
let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------
// Punch-Status file
// Written exclusively by renderer IPC (punch-in / punch-out events).
// Never cleared on app-quit — the helper checks Electron PID liveness to
// ignore stale values if Electron exited without a real punch-out.
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
//
// Why not PowerShell + Add-Type?
//   PowerShell's Add-Type compiles C# at runtime — this takes 10-15 seconds on
//   first run and 5-8 seconds on warm runs. If the user shuts down during that
//   window, no helper is listening for WM_QUERYENDSESSION and the shutdown
//   proceeds unblocked.
//
// Why a compiled .exe?
//   `csc.exe` (ships with every Windows since Vista via .NET Framework) compiles
//   our tiny 120-line program in ~1-2 seconds. The resulting .exe is cached in
//   userData and starts in <100 ms on every subsequent launch.
//
// Lifecycle:
//   - Spawned detached + unref'd so it survives Electron's own quit during an
//     OS-initiated shutdown (Windows may start closing Electron before our helper
//     has finished responding to WM_QUERYENDSESSION).
//   - The helper holds a watchdog timer that checks the Electron PID every 3 s.
//     When the PID is gone (normal app close), it exits itself — no orphan process.
//   - Before blocking a shutdown, the helper re-checks the Electron PID.  If
//     Electron has already exited, it treats any punch-status as stale and allows
//     the shutdown.
// ---------------------------------------------------------------------------

/** Absolute path to csc.exe — null if not found (non-Windows or missing .NET). */
function findCscExe(): string | null {
  const candidates = [
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework',   'v4.0.30319', 'csc.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * Ensures the compiled shutdown-blocker.exe exists in userData.
 * Compiles from source using csc.exe if the exe is absent or source is newer.
 * Returns the exe path, or empty string if compilation is impossible.
 */
function ensureBlockerExe(): string {
  const userData = (() => { try { return app.getPath('userData'); } catch { return process.cwd(); } })();

  // Source lives next to this file in dev; beside the packaged resources in prod
  const srcPath = isDev
    ? path.join(__dirname, '..', 'electron', 'shutdown-blocker.cs')
    : path.join(process.resourcesPath, 'shutdown-blocker.cs');

  const exePath = path.join(userData, 'shutdown-blocker.exe');

  try {
    fs.mkdirSync(userData, { recursive: true });

    const srcExists = fs.existsSync(srcPath);
    const exeExists = fs.existsSync(exePath);

    if (!srcExists) {
      console.error('[ShutdownGate] Source not found:', srcPath);
      return '';
    }

    // Recompile if the exe is missing or the source is newer
    const srcMtime = fs.statSync(srcPath).mtimeMs;
    const exeMtime = exeExists ? fs.statSync(exePath).mtimeMs : 0;

    if (!exeExists || srcMtime > exeMtime) {
      const cscExe = findCscExe();
      if (!cscExe) {
        console.error('[ShutdownGate] csc.exe not found — shutdown gate disabled.');
        return '';
      }

      console.log('[ShutdownGate] Compiling shutdown-blocker.exe …');
      execFileSync(cscExe, [
        '/nologo',
        '/target:winexe',          // no console window
        '/r:System.Windows.Forms.dll',
        '/r:System.Drawing.dll',
        `/out:${exePath}`,
        srcPath,
      ], { windowsHide: true });

      console.log('[ShutdownGate] Compilation succeeded.');
    }
  } catch (err) {
    console.error('[ShutdownGate] ensureBlockerExe error:', err);
    return '';
  }

  return exePath;
}

function startShutdownHelper(): void {
  if (process.platform !== 'win32') return;

  // Ensure the status file exists with a safe default
  const statusFile = getPunchStatusPath();
  if (!fs.existsSync(statusFile)) writePunchStatus(false);

  const exePath = ensureBlockerExe();
  if (!exePath) return;

  const ps = spawn(
    exePath,
    [
      '--status-file', statusFile,
      '--pid',         String(process.pid),
      '--electron-exe', app.getPath('exe'),   // lets helper relaunch app if Electron was closed
    ],
    {
      // detached: survives independently during OS-initiated shutdown
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  // unref() so Electron's event-loop does not wait for this child to exit
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

function registerServerConfigIpcHandlers(): void {
  ipcMain.handle('server:get-url', () => getApiUrl());
  ipcMain.handle('server:set-url', (_event, url: string) => setApiUrl(url));
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.attendance.desktop');
    // Auto-start on Windows login — only for the packaged/installed app
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
    }
  }

  registerAuthIpcHandlers();
  registerFilesIpcHandlers();
  registerNotifyIpcHandler();
  registerServerConfigIpcHandlers();
  registerShutdownIpcHandlers();
  createMainWindow();
  startShutdownHelper();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// NOTE: punch-status is intentionally NOT cleared on app quit.
// The helper checks Electron PID liveness to ignore stale status values.

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') app.quit();
});
