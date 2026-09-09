import { contextBridge, ipcRenderer } from 'electron';
import type { AuthUser } from '@attendance/shared';

// Minimal, explicit surface exposed to the renderer. The renderer never gets
// direct Node.js or filesystem access, and never receives a raw access or
// refresh token — the main process owns the token lifecycle entirely and
// performs authenticated requests on the renderer's behalf over IPC.
contextBridge.exposeInMainWorld('electronApi', {
  platform: process.platform,
  auth: {
    login: (email: string, password: string): Promise<AuthUser> =>
      ipcRenderer.invoke('auth:login', email, password),
    logout: (): Promise<void> => ipcRenderer.invoke('auth:logout'),
    getSession: (): Promise<AuthUser | null> => ipcRenderer.invoke('auth:get-session'),
    getAccessToken: (): Promise<string | null> => ipcRenderer.invoke('auth:get-access-token'),
    apiRequest: <T>(pathname: string, init?: { method?: string; body?: unknown }): Promise<T> =>
      ipcRenderer.invoke('auth:api-request', pathname, init),
  },
  files: {
    download: (pathname: string, suggestedName?: string): Promise<{ saved: boolean }> =>
      ipcRenderer.invoke('files:download', pathname, suggestedName),
  },
  notify: {
    /** Show a native OS notification (Windows toast). */
    show: (title: string, body: string): Promise<void> =>
      ipcRenderer.invoke('notify:show', title, body),
  },
  server: {
    /** Get the active server URL. */
    getUrl: (): Promise<string> => ipcRenderer.invoke('server:get-url'),
    /** Set and persist a new server URL. */
    setUrl: (url: string): Promise<string> => ipcRenderer.invoke('server:set-url', url),
  },
  shutdown: {
    /**
     * Renderer calls this whenever punch state changes (punch-in or punch-out).
     * Main process writes the status to a file read by the shutdown-gate helper.
     */
    updatePunchStatus: (isPunchedIn: boolean): Promise<void> =>
      ipcRenderer.invoke('shutdown:update-punch-status', isPunchedIn),
    /**
     * Register a callback that fires when the OS shutdown was blocked because
     * the employee is still clocked in. Show the punch-out-first modal.
     * Returns a cleanup function to remove the listener.
     */
    onPunchOutRequired: (callback: () => void): (() => void) => {
      const handler = () => callback();
      ipcRenderer.on('shutdown:punch-out-required', handler);
      return () => ipcRenderer.removeListener('shutdown:punch-out-required', handler);
    },
  },
});
