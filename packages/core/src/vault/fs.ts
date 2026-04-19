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

/**
 * Placeholder `VaultFileSystem` for use before a real vault is activated.
 * Tier-1 consumers (DB-only listings) work without touching the fs; tier-2/3
 * consumers will reject cleanly with `reason`.
 */
export function createStubVaultFs(reason = 'Vault not activated yet'): VaultFileSystem {
  const notReady = () => Promise.reject(new Error(reason));
  return {
    root: '',
    readFile: notReady,
    writeFile: () => notReady(),
    listDir: () => notReady(),
    stat: async () => null,
    remove: () => notReady(),
    mkdir: () => notReady(),
    exists: async () => false,
  };
}
