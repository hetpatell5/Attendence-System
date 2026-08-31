import { app } from 'electron';

/**
 * Production API URL. This is a placeholder — before shipping a real build,
 * replace this with the actual CloudPanel-hosted API's HTTPS URL, or wire a
 * config.json read from `process.resourcesPath` if the URL needs to differ
 * per deployment without a rebuild.
 */
const PRODUCTION_API_URL = 'https://api.example.com';

/**
 * In development, VITE_API_URL from apps/desktop/.env (loaded via
 * dotenv/config in main.ts) points at the local API. A packaged app has no
 * .env file bundled, so process.env.VITE_API_URL is always undefined there —
 * without this fallback, a packaged build would silently try to talk to
 * localhost:3000 instead of the real backend.
 */
export function getApiUrl(): string {
  if (process.env.VITE_API_URL) {
    return process.env.VITE_API_URL;
  }
  return app.isPackaged ? PRODUCTION_API_URL : 'http://localhost:3000';
}
