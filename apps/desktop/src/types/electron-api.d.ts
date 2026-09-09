import type { AuthUser } from '@attendance/shared';

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
  server: {
    getUrl: () => Promise<string>;
    setUrl: (url: string) => Promise<string>;
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
}

declare global {
  interface Window {
    electronApi: ElectronApi;
  }
}

export {};
