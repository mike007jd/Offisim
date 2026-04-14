import type { VaultFileSystem } from '@offisim/core/browser';

// Browser builds alias Tauri packages to a stub module, while Tauri dev/build
// let Vite resolve the real package. Keep the fs bridge lazy so it stays off
// the browser entry path entirely.
export type TauriFsModule = {
  exists: (p: string) => Promise<boolean>;
  mkdir: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
  readDir: (p: string) => Promise<Array<{ name: string }>>;
  readTextFile: (p: string) => Promise<string>;
  remove: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
  stat: (p: string) => Promise<{ mtime: string | null; size: number }>;
  writeTextFile: (p: string, content: string) => Promise<void>;
};

let fsPromise: Promise<TauriFsModule> | null = null;
function fs(): Promise<TauriFsModule> {
  if (!fsPromise) {
    fsPromise = import('@tauri-apps/plugin-fs') as Promise<TauriFsModule>;
  }
  return fsPromise;
}

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
    const m = await fs();
    return m.readTextFile(join(this.root, relPath));
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const m = await fs();
    const full = join(this.root, relPath);
    await m.mkdir(dirname(full), { recursive: true });
    await m.writeTextFile(full, content);
  }

  async listDir(relPath: string): Promise<string[]> {
    const m = await fs();
    try {
      const entries = await m.readDir(join(this.root, relPath));
      return entries.map((entry) => entry.name);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }

  async stat(relPath: string): Promise<{ mtimeMs: number; size: number } | null> {
    const m = await fs();
    try {
      const info = await m.stat(join(this.root, relPath));
      const mtime = info.mtime ? new Date(info.mtime).getTime() : 0;
      return { mtimeMs: mtime, size: info.size };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async remove(relPath: string): Promise<void> {
    const m = await fs();
    try {
      await m.remove(join(this.root, relPath), { recursive: true });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async mkdir(relPath: string): Promise<void> {
    const m = await fs();
    await m.mkdir(join(this.root, relPath), { recursive: true });
  }

  async exists(relPath: string): Promise<boolean> {
    const m = await fs();
    return m.exists(join(this.root, relPath));
  }
}

function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('no such file') ||
    msg.includes('no such file or directory') ||
    msg.includes('not found') ||
    msg.includes('cannot find') ||
    msg.includes('enoent') ||
    msg.includes('os error 2') ||
    msg.includes('failed to open file')
  );
}
