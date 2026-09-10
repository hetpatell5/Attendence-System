/** Production API URL — the live CloudPanel domain. */
export const PRODUCTION_API_URL = 'https://projectadmin.bookmyassignments.com';

/**
 * Returns the API base URL.
 * In packaged app: always the production domain (hardcoded).
 * In dev (Vite): falls back to VITE_API_URL or localhost.
 */
export function getApiBaseUrl(): string {
  // In the packaged Electron app, import.meta.env.PROD is true.
  // We hardcode the production URL so no env var or stored config is needed.
  if (import.meta.env.PROD) {
    return PRODUCTION_API_URL;
  }
  // Dev: respect the VITE_API_URL override (set in .env or .env.network)
  return import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getApiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError('Unable to reach the server. Check your network connection.');
  }

  if (!response.ok) {
    throw new ApiError(`Request failed with status ${response.status}`, response.status);
  }

  return (await response.json()) as T;
}

async function authenticatedRequest<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const electronApi = (window as any).electronApi;
  if (electronApi?.auth?.apiRequest) {
    try {
      return (await electronApi.auth.apiRequest(path, init)) as T;
    } catch (error) {
      const status = error instanceof Error && 'status' in error ? (error as { status?: number }).status : undefined;
      throw new ApiError(error instanceof Error ? error.message : 'Request failed', status);
    }
  }

  // Web browser fallback (dev only)
  const baseUrl = getApiBaseUrl();
  const saved = localStorage.getItem('atten_browser_session');
  let accessToken = '';
  if (saved) {
    try {
      accessToken = JSON.parse(saved).accessToken || '';
    } catch {}
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (!response.ok) {
    let msg = `Request to ${path} failed`;
    try {
      const err = await response.json();
      if (err?.message) msg = Array.isArray(err.message) ? err.message.join(', ') : err.message;
    } catch {}
    throw new ApiError(msg, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const apiClient = {
  getHealth: (): Promise<{ status: string }> => request<{ status: string }>('/health'),
  authenticatedRequest,
};
