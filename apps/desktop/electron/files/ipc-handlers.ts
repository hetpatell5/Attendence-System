import { dialog, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import { downloadFile } from '../auth/auth-client';

export function registerFilesIpcHandlers(): void {
  ipcMain.handle(
    'files:download',
    async (_event, pathname: string, suggestedName?: string): Promise<{ saved: boolean } > => {
      const file = await downloadFile(pathname);
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: suggestedName ?? file.fileName,
      });
      if (canceled || !filePath) {
        return { saved: false };
      }
      await fs.writeFile(filePath, file.buffer);
      return { saved: true };
    },
  );
}
