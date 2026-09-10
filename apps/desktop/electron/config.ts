import { app } from 'electron';

/** Production API URL — the live server domain. */
export const PRODUCTION_API_URL = 'https://projectadmin.bookmyassignments.com';

/**
 * Returns the active API URL.
 * In production: always the live domain.
 * In dev: uses VITE_API_URL env var, or falls back to localhost.
 */
export function getApiUrl(): string {
  if (!app.isPackaged && process.env.VITE_API_URL) {
    return process.env.VITE_API_URL;
  }
  if (!app.isPackaged) {
    return process.env.VITE_API_URL ?? 'http://localhost:3000';
  }
  return PRODUCTION_API_URL;
}
