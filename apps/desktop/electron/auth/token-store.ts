import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface StoredSession {
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
}

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'auth.dat');
}

export async function readSession(): Promise<StoredSession | null> {
  if (!safeStorage.isEncryptionAvailable()) {
    // Fail closed: never fall back to storing/reading tokens in plaintext.
    return null;
  }

  try {
    const encrypted = await fs.readFile(getStorePath());
    const decrypted = safeStorage.decryptString(encrypted);
    return JSON.parse(decrypted) as StoredSession;
  } catch {
    return null;
  }
}

export async function writeSession(session: StoredSession): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    return;
  }

  const encrypted = safeStorage.encryptString(JSON.stringify(session));
  await fs.writeFile(getStorePath(), encrypted);
}

export async function clearSession(): Promise<void> {
  try {
    await fs.unlink(getStorePath());
  } catch {
    // Nothing to remove.
  }
}
