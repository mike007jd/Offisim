import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VaultFileSystem } from './fs.js';

export interface NodeFileSystemOptions {
  readonly root: string;
}

export class NodeFileSystem implements VaultFileSystem {
  readonly root: string;

  constructor(options: NodeFileSystemOptions) {
    this.root = path.resolve(options.root);
  }

  private resolve(relPath: string): string {
    const full = path.resolve(this.root, relPath);
    if (!full.startsWith(this.root)) {
      throw new Error(`Vault FS: refusing to access path outside root (${relPath})`);
    }
    return full;
  }

  async readFile(relPath: string): Promise<string> {
    return fs.readFile(this.resolve(relPath), 'utf8');
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const full = this.resolve(relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, 'utf8');
  }

  async listDir(relPath: string): Promise<string[]> {
    try {
      return await fs.readdir(this.resolve(relPath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async stat(relPath: string): Promise<{ mtimeMs: number; size: number } | null> {
    try {
      const st = await fs.stat(this.resolve(relPath));
      return { mtimeMs: st.mtimeMs, size: st.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async remove(relPath: string): Promise<void> {
    await fs.rm(this.resolve(relPath), { recursive: true, force: true });
  }

  async mkdir(relPath: string): Promise<void> {
    await fs.mkdir(this.resolve(relPath), { recursive: true });
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(relPath));
      return true;
    } catch {
      return false;
    }
  }
}
