import type { VaultFileSystem } from '@offisim/core/browser';
import {
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  stat,
  writeTextFile,
} from '@tauri-apps/plugin-fs';

function join(root: string, rel: string): string {
  if (!rel || rel === '.' || rel === './') return root;
  const normalized = rel.replace(/^\/+/, '');
  return root.endsWith('/') ? `${root}${normalized}` : `${root}/${normalized}`;
}

function dirname(filePath: string): string {
  const idx = filePath.lastIndexOf('/');
  return idx === -1 ? filePath : filePath.slice(0, idx);
}

/**
 * Desktop (Tauri) implementation of {@link VaultFileSystem}. Requires the
 * invoking path to be within the capability scope declared in
 * `src-tauri/capabilities` — pass an appDataDir-derived absolute root.
 */
export class TauriVaultFileSystem implements VaultFileSystem {
  readonly root: string;

  constructor(root: string) {
    this.root = root.replace(/\/+$/u, '');
  }

  async readFile(relPath: string): Promise<string> {
    return readTextFile(join(this.root, relPath));
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const full = join(this.root, relPath);
    await mkdir(dirname(full), { recursive: true });
    await writeTextFile(full, content);
  }

  async listDir(relPath: string): Promise<string[]> {
    try {
      const entries = await readDir(join(this.root, relPath));
      return entries.map((entry) => entry.name);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }

  async stat(relPath: string): Promise<{ mtimeMs: number; size: number } | null> {
    try {
      const info = await stat(join(this.root, relPath));
      const mtime = info.mtime ? new Date(info.mtime).getTime() : 0;
      return { mtimeMs: mtime, size: info.size };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async remove(relPath: string): Promise<void> {
    try {
      await remove(join(this.root, relPath), { recursive: true });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async mkdir(relPath: string): Promise<void> {
    await mkdir(join(this.root, relPath), { recursive: true });
  }

  async exists(relPath: string): Promise<boolean> {
    return exists(join(this.root, relPath));
  }
}

function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('no such file') ||
    msg.includes('not found') ||
    msg.includes('cannot find') ||
    msg.includes('enoent')
  );
}
