import type { HealthCheckResponse } from '@attendance/shared';

const DEFAULT_SERVER_URL = 'http://192.168.1.32:3000';

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('atten_custom_server_url');
    if (saved && saved.trim()) return saved.trim();
  }
  return import.meta.env.VITE_API_URL ?? DEFAULT_SERVER_URL;
}

export async function setApiBaseUrl(rawUrl: string): Promise<string> {
  let cleanUrl = rawUrl.trim().replace(/\/+$/, '');
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = `http://${cleanUrl}`;
  }
  if (!cleanUrl.includes(':', 7)) {
    cleanUrl = `${cleanUrl}:3000`;
  }

  if (typeof window !== 'undefined') {
    localStorage.setItem('atten_custom_server_url', cleanUrl);
  }

  const electronApi = (window as any).electronApi;
  if (electronApi?.server?.setUrl) {
    try {
      await electronApi.server.setUrl(cleanUrl);
    } catch {
      // ignore
    }
  }

  return cleanUrl;
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

  // Web browser fallback
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
  getHealth: (): Promise<HealthCheckResponse> => request<HealthCheckResponse>('/health'),
  testUrl: async (testUrl: string): Promise<{ ok: boolean; status: string; latencyMs: number }> => {
    let cleanUrl = testUrl.trim().replace(/\/+$/, '');
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `http://${cleanUrl}`;
    }
    if (!cleanUrl.includes(':', 7)) {
      cleanUrl = `${cleanUrl}:3000`;
    }

    const start = performance.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${cleanUrl}/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      const latencyMs = Math.round(performance.now() - start);
      if (res.ok) {
        const json = await res.json();
        return { ok: json.status === 'ok', status: 'Connected', latencyMs };
      }
      return { ok: false, status: `HTTP ${res.status}`, latencyMs };
    } catch {
      return { ok: false, status: 'Unreachable', latencyMs: 0 };
    }
  },
  authenticatedRequest,
};
