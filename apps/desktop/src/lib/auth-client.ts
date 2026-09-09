import type { AuthUser, AuthTokens } from '@attendance/shared';
import { getApiBaseUrl } from './api-client';

export const authClient = {
  login: async (username: string, password: string): Promise<AuthUser> => {
    const electronApi = (window as any).electronApi;
    if (electronApi?.auth?.login) {
      return electronApi.auth.login(username, password);
    }
    // Web browser fallback
    const baseUrl = getApiBaseUrl();
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Login failed');
    }
    const tokens = (await res.json()) as AuthTokens;
    localStorage.setItem(
      'atten_browser_session',
      JSON.stringify({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      })
    );
    // Fetch profile
    const profileRes = await fetch(`${baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!profileRes.ok) throw new Error('Failed to fetch profile');
    return profileRes.json();
  },

  logout: async (): Promise<void> => {
    const electronApi = (window as any).electronApi;
    if (electronApi?.auth?.logout) {
      return electronApi.auth.logout();
    }
    localStorage.removeItem('atten_browser_session');
  },

  getSession: async (): Promise<AuthUser | null> => {
    const electronApi = (window as any).electronApi;
    if (electronApi?.auth?.getSession) {
      return electronApi.auth.getSession();
    }
    const saved = localStorage.getItem('atten_browser_session');
    if (!saved) return null;
    try {
      const { accessToken } = JSON.parse(saved);
      const baseUrl = getApiBaseUrl();
      const profileRes = await fetch(`${baseUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!profileRes.ok) {
        localStorage.removeItem('atten_browser_session');
        return null;
      }
      return profileRes.json();
    } catch {
      localStorage.removeItem('atten_browser_session');
      return null;
    }
  },
};
