import type { AuthTokens, AuthUser } from '@attendance/shared';
import { clearSession, readSession, writeSession, type StoredSession } from './token-store';
import { getApiUrl } from '../config';

export class AuthApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

function toStoredSession(tokens: AuthTokens): StoredSession {
  return {
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: Date.now() + tokens.expiresIn * 1000,
    refreshToken: tokens.refreshToken,
  };
}

async function postJson<T>(pathname: string, body: unknown, accessToken?: string): Promise<T> {
  const apiUrl = getApiUrl();
  const response = await fetch(`${apiUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let errorMessage = `Request to ${pathname} failed`;
    try {
      const errBody = (await response.json()) as any;
      if (errBody && errBody.message) {
        errorMessage = Array.isArray(errBody.message) ? errBody.message.join(', ') : String(errBody.message);
      }
    } catch {}
    throw new AuthApiError(errorMessage, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const tokens = await postJson<AuthTokens>('/auth/login', { username, password });
  await writeSession(toStoredSession(tokens));
  return fetchProfile(tokens.accessToken);
}

export async function logout(): Promise<void> {
  const session = await readSession();
  if (session) {
    try {
      await postJson<void>('/auth/logout', { refreshToken: session.refreshToken }, session.accessToken);
    } catch {
      // Best-effort: proceed to clear the local session regardless.
    }
  }
  await clearSession();
}

async function refreshSession(session: StoredSession): Promise<StoredSession> {
  const tokens = await postJson<AuthTokens>('/auth/refresh', { refreshToken: session.refreshToken });
  const newSession = toStoredSession(tokens);
  await writeSession(newSession);
  return newSession;
}

async function fetchProfile(accessToken: string): Promise<AuthUser> {
  const apiUrl = getApiUrl();
  const response = await fetch(`${apiUrl}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    let errorMessage = 'Failed to fetch profile';
    try {
      const errBody = (await response.json()) as any;
      if (errBody && errBody.message) {
        errorMessage = Array.isArray(errBody.message) ? errBody.message.join(', ') : String(errBody.message);
      }
    } catch {}
    throw new AuthApiError(errorMessage, response.status);
  }
  return (await response.json()) as AuthUser;
}

/**
 * Returns the current user's profile if a valid session exists, silently
 * refreshing the access token first if it has expired. Returns null if there
 * is no session or the refresh token itself is no longer valid.
 */
export async function getSession(): Promise<AuthUser | null> {
  let session = await readSession();
  if (!session) {
    return null;
  }

  const isExpired = session.accessTokenExpiresAt <= Date.now() + 5000;
  if (isExpired) {
    try {
      session = await refreshSession(session);
    } catch {
      await clearSession();
      return null;
    }
  }

  try {
    return await fetchProfile(session.accessToken);
  } catch (error) {
    if (error instanceof AuthApiError && error.status === 401) {
      try {
        session = await refreshSession(session);
        return await fetchProfile(session.accessToken);
      } catch {
        await clearSession();
        return null;
      }
    }
    throw error;
  }
}

export interface ApiRequestInit {
  method?: string;
  body?: unknown;
}

/**
 * Generic authenticated request pass-through used by the renderer for all
 * non-auth API calls in later phases. Applies the stored access token and
 * transparently retries once after a silent refresh on a 401 response.
 */
export async function apiRequest<T>(pathname: string, init: ApiRequestInit = {}): Promise<T> {
  let session = await readSession();
  if (!session) {
    throw new AuthApiError('Not authenticated', 401);
  }

  const doFetch = async (accessToken: string): Promise<Response> => {
    const apiUrl = getApiUrl();
    return fetch(`${apiUrl}${pathname}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  };

  let response = await doFetch(session.accessToken);

  if (response.status === 401) {
    session = await refreshSession(session);
    response = await doFetch(session.accessToken);
  }

  if (!response.ok) {
    let errorMessage = `Request to ${pathname} failed`;
    try {
      const errBody = (await response.json()) as any;
      if (errBody && errBody.message) {
        errorMessage = Array.isArray(errBody.message) ? errBody.message.join(', ') : String(errBody.message);
      }
    } catch {}
    throw new AuthApiError(errorMessage, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

/**
 * Authenticated binary download (Excel/PDF reports, salary slips). Separate
 * from apiRequest because that channel always parses the response as JSON —
 * binary responses need their raw bytes returned to the main process instead.
 */
export async function downloadFile(
  pathname: string,
): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
  let session = await readSession();
  if (!session) {
    throw new AuthApiError('Not authenticated', 401);
  }

  const doFetch = async (accessToken: string): Promise<Response> => {
    const apiUrl = getApiUrl();
    return fetch(`${apiUrl}${pathname}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  };

  let response = await doFetch(session.accessToken);
  if (response.status === 401) {
    session = await refreshSession(session);
    response = await doFetch(session.accessToken);
  }
  if (!response.ok) {
    let errorMessage = `Request to ${pathname} failed`;
    try {
      const errBody = (await response.json()) as any;
      if (errBody && errBody.message) {
        errorMessage = Array.isArray(errBody.message) ? errBody.message.join(', ') : String(errBody.message);
      }
    } catch {}
    throw new AuthApiError(errorMessage, response.status);
  }

  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const fileName = match?.[1] ?? pathname.split('/').pop() ?? 'download';

  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType, fileName };
}
