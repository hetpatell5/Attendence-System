import type { AuthUser } from '@attendance/shared';

export interface UpdateInfo {
  version: string;
  releaseNotes?: string;
}

export interface ElectronApi {
  platform: string;
  auth: {
    login: (email: string, password: string) => Promise<AuthUser>;
    logout: () => Promise<void>;
    getSession: () => Promise<AuthUser | null>;
    getAccessToken: () => Promise<string | null>;
    apiRequest: <T>(pathname: string, init?: { method?: string; body?: unknown }) => Promise<T>;
  };
  files: {
    download: (pathname: string, suggestedName?: string) => Promise<{ saved: boolean }>;
  };
  notify: {
    show: (title: string, body: string) => Promise<void>;
  };
  shutdown: {
    /**
     * Notify the main process (and the shutdown-gate helper) of the current
     * punch-in / punch-out state so it can decide whether to block shutdown.
     */
    updatePunchStatus: (isPunchedIn: boolean) => Promise<void>;
    /**
     * Register a callback that fires when the OS shutdown was blocked because
     * the employee is still clocked in. Returns a disposer function.
     */
    onPunchOutRequired: (callback: () => void) => () => void;
  };
  updater: {
    /** Manually trigger an update check. */
    checkNow: () => Promise<void>;
    /** Quit and install the downloaded update immediately. */
    installNow: () => Promise<void>;
    /** Register a listener for when an update is available (not yet downloaded). */
    onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void;
    /** Register a listener for when an update has been fully downloaded. */
    onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => () => void;
  };
}

declare global {
  interface Window {
    electronApi: ElectronApi;
  }
}

export {};
