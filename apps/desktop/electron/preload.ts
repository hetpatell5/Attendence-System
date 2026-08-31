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
});
