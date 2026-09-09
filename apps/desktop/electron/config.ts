import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// Current LAN IP default (falls back dynamically to this if no stored config)
const DEFAULT_SERVER_URL = 'http://192.168.1.32:3000';

let inMemoryServerUrl: string | null = null;

function getConfigFilePath(): string {
  try {
    return path.join(app.getPath('userData'), 'server-config.json');
  } catch {
    return path.join(process.cwd(), 'server-config.json');
  }
}

/**
 * Returns the active API URL:
 * 1. User-customized URL persisted in `userData/server-config.json`
 * 2. In-memory override
 * 3. Environment variable `VITE_API_URL`
 * 4. Default LAN address (`http://192.168.1.32:3000`)
 */
export function getApiUrl(): string {
  if (inMemoryServerUrl) {
    return inMemoryServerUrl;
  }
  try {
    const configPath = getConfigFilePath();
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (data?.serverUrl && typeof data.serverUrl === 'string') {
        inMemoryServerUrl = data.serverUrl;
        return data.serverUrl;
      }
    }
  } catch {
    // ignore read error and fall through
  }

  if (process.env.VITE_API_URL) {
    return process.env.VITE_API_URL;
  }
  return DEFAULT_SERVER_URL;
}

/**
 * Persists and updates the backend API URL dynamically.
 */
export function setApiUrl(url: string): string {
  let cleanUrl = url.trim().replace(/\/+$/, '');
  if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
    cleanUrl = `http://${cleanUrl}`;
  }
  // If no port specified and it's an IP address, add :3000 default
  if (!cleanUrl.includes(':', 7)) {
    cleanUrl = `${cleanUrl}:3000`;
  }

  inMemoryServerUrl = cleanUrl;

  try {
    const configPath = getConfigFilePath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ serverUrl: cleanUrl }, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist server-config.json:', err);
  }

  return cleanUrl;
}
