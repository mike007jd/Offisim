import type { FileSnapshotAdapter } from '@offisim/core/dist/services/file-history-service.js';
import { exists, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';

export class TauriFileSnapshotAdapter implements FileSnapshotAdapter {
  async exists(path: string): Promise<boolean> {
    return exists(path);
  }

  async readTextFile(path: string): Promise<string> {
    return readTextFile(path);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await writeTextFile(path, content);
  }

  async remove(path: string): Promise<void> {
    await remove(path);
  }
}
