import type { HealthCheckResponse } from '@attendance/shared';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

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
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
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

/**
 * Authenticated requests are delegated to the Electron main process, which
 * owns the access/refresh tokens and applies them itself — the renderer never
 * holds a raw token. This is the channel all future authenticated endpoints
 * should use instead of raw `fetch`.
 */
async function authenticatedRequest<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  try {
    return await window.electronApi.auth.apiRequest<T>(path, init);
  } catch (error) {
    const status = error instanceof Error && 'status' in error ? (error as { status?: number }).status : undefined;
    throw new ApiError(error instanceof Error ? error.message : 'Request failed', status);
  }
}

export const apiClient = {
  getHealth: (): Promise<HealthCheckResponse> => request<HealthCheckResponse>('/health'),
  authenticatedRequest,
};
