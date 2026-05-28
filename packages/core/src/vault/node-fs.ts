import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { VaultFileSystem } from './fs.js';

export interface NodeFileSystemOptions {
  readonly root: string;
}

// Lexical `path.resolve` + `startsWith` doesn't follow symlinks. A symlink
// inside the vault pointing to `/etc/passwd` would have passed the old check
// because the path string still looks like it's under the root. We resolve to
// the *canonical* path with `fs.realpath` before comparing.
//
// For write/mkdir into not-yet-existing files, realpath the parent (which we
// have to create anyway) and reattach the basename — that keeps a symlinked
// *parent* directory honest.
export class NodeFileSystem implements VaultFileSystem {
  readonly root: string;
  private realRootPromise: Promise<string> | null = null;

  constructor(options: NodeFileSystemOptions) {
    this.root = path.resolve(options.root);
  }

  private async getRealRoot(): Promise<string> {
    if (!this.realRootPromise) {
      this.realRootPromise = fs
        .mkdir(this.root, { recursive: true })
        .then(() => fs.realpath(this.root))
        .catch(() => this.root);
    }
    return this.realRootPromise;
  }

  private isInsideRoot(realCandidate: string, realRoot: string): boolean {
    if (realCandidate === realRoot) return true;
    return realCandidate.startsWith(realRoot + path.sep);
  }

  private outsideRootError(relPath: string): Error {
    return new Error(`Vault FS: refusing to access path outside root (${relPath})`);
  }

  // Resolve an existing entry. Errors with ENOENT propagate so callers like
  // `stat`/`exists`/`readFile` can decide what to do.
  private async resolveExisting(relPath: string): Promise<string> {
    const full = path.resolve(this.root, relPath);
    const realRoot = await this.getRealRoot();
    const real = await fs.realpath(full);
    if (!this.isInsideRoot(real, realRoot)) {
      throw this.outsideRootError(relPath);
    }
    return real;
  }

  // Resolve a write target. Parent must canonicalize inside the root; final
  // basename is attached unmodified so writing a brand-new file is allowed.
  private async resolveForWrite(relPath: string): Promise<string> {
    const full = path.resolve(this.root, relPath);
    const realRoot = await this.getRealRoot();
    const parent = path.dirname(full);
    await fs.mkdir(parent, { recursive: true });
    const realParent = await fs.realpath(parent);
    if (!this.isInsideRoot(realParent, realRoot)) {
      throw this.outsideRootError(relPath);
    }
    return path.join(realParent, path.basename(full));
  }

  async readFile(relPath: string): Promise<string> {
    return fs.readFile(await this.resolveExisting(relPath), 'utf8');
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const full = await this.resolveForWrite(relPath);
    await fs.writeFile(full, content, 'utf8');
  }

  async listDir(relPath: string): Promise<string[]> {
    try {
      return await fs.readdir(await this.resolveExisting(relPath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async stat(relPath: string): Promise<{ mtimeMs: number; size: number } | null> {
    try {
      const st = await fs.stat(await this.resolveExisting(relPath));
      return { mtimeMs: st.mtimeMs, size: st.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  async remove(relPath: string): Promise<void> {
    try {
      const real = await this.resolveExisting(relPath);
      await fs.rm(real, { recursive: true, force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw err;
    }
  }

  async mkdir(relPath: string): Promise<void> {
    // mkdir target may or may not exist; if it does, ensure it's a real dir
    // inside root. If it doesn't, treat as a write target (parent must be
    // canonical-inside-root, basename creates the new dir).
    const full = await this.resolveForWrite(relPath);
    await fs.mkdir(full, { recursive: true });
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await this.resolveExisting(relPath);
      return true;
    } catch {
      return false;
    }
  }
}
