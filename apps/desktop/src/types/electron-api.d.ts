import type { AuthUser } from '@attendance/shared';

export interface ElectronApi {
  platform: string;
  auth: {
    login: (email: string, password: string) => Promise<AuthUser>;
    logout: () => Promise<void>;
    getSession: () => Promise<AuthUser | null>;
    apiRequest: <T>(pathname: string, init?: { method?: string; body?: unknown }) => Promise<T>;
  };
  files: {
    download: (pathname: string, suggestedName?: string) => Promise<{ saved: boolean }>;
  };
}

declare global {
  interface Window {
    electronApi: ElectronApi;
  }
}

export {};
