import type { AuthUser } from '@attendance/shared';

export const authClient = {
  login: (email: string, password: string): Promise<AuthUser> =>
    window.electronApi.auth.login(email, password),
  logout: (): Promise<void> => window.electronApi.auth.logout(),
  getSession: (): Promise<AuthUser | null> => window.electronApi.auth.getSession(),
};
