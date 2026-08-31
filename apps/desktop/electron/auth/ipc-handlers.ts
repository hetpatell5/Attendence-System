import { ipcMain } from 'electron';
import type { AuthUser } from '@attendance/shared';
import * as authClient from './auth-client';
import type { ApiRequestInit } from './auth-client';
import { readSession } from './token-store';

export function registerAuthIpcHandlers(): void {
  ipcMain.handle('auth:login', async (_event, email: string, password: string): Promise<AuthUser> => {
    return authClient.login(email, password);
  });

  ipcMain.handle('auth:logout', async (): Promise<void> => {
    await authClient.logout();
  });

  ipcMain.handle('auth:get-session', async (): Promise<AuthUser | null> => {
    return authClient.getSession();
  });

  ipcMain.handle(
    'auth:api-request',
    async <T>(_event: unknown, pathname: string, init?: ApiRequestInit): Promise<T> => {
      return authClient.apiRequest<T>(pathname, init);
    },
  );

  /** Returns the current raw access token (for SSE stream setup in renderer). */
  ipcMain.handle('auth:get-access-token', async (): Promise<string | null> => {
    const session = await readSession();
    return session?.accessToken ?? null;
  });
}
