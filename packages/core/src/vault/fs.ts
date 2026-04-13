/**
 * Minimal FS abstraction used by the vault layer. Kept deliberately small so
 * desktop (Node / Tauri IPC) and web (File System Access) can share the same
 * synchronisation code path.
 *
 * Concrete Node-backed implementation lives in `./node-fs.ts` (Node-only;
 * not part of the browser barrel).
 */
export interface VaultFileSystem {
  readonly root: string;
  readFile(relPath: string): Promise<string>;
  writeFile(relPath: string, content: string): Promise<void>;
  listDir(relPath: string): Promise<string[]>;
  stat(relPath: string): Promise<{ mtimeMs: number; size: number } | null>;
  remove(relPath: string): Promise<void>;
  mkdir(relPath: string): Promise<void>;
  exists(relPath: string): Promise<boolean>;
}
