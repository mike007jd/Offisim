import { idbRequestToPromise, idbTransactionDone } from '../utils/idb-promise.js';
import type { VaultFileSystem } from './fs.js';

const HANDLE_DB_NAME = 'offisim-vault-browser-fs';
const HANDLE_STORE_NAME = 'handles';
const HANDLE_KEY = 'vault-directory';

export type BrowserVaultPermissionState = PermissionState | 'unsupported';
export type BrowserVaultMode = 'unsupported' | 'unmounted' | 'needs-permission' | 'mounted';

export interface BrowserVaultDirectoryStatus {
  supported: boolean;
  mode: BrowserVaultMode;
  directoryName: string | null;
  root: string | null;
}

export interface BrowserVaultHandleStore {
  load(): Promise<FileSystemDirectoryHandle | null>;
  save(handle: FileSystemDirectoryHandle): Promise<void>;
  clear(): Promise<void>;
}

type FileSystemPermissionMethod = (
  descriptor?: { mode?: 'read' | 'readwrite' },
) => Promise<PermissionState>;

type BrowserDirectoryHandle = FileSystemDirectoryHandle & {
  values?: () => AsyncIterable<{ name: string }>;
  queryPermission?: FileSystemPermissionMethod;
  requestPermission?: FileSystemPermissionMethod;
};

type WindowWithDirectoryPicker = Window &
  typeof globalThis & {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  };

function splitRelPath(relPath: string): string[] {
  return relPath
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  return !!value && typeof value === 'object' && 'kind' in value && value.kind === 'directory';
}

function idbSupported(factory: IDBFactory | undefined = globalThis.indexedDB): factory is IDBFactory {
  return typeof factory !== 'undefined';
}

async function openHandleDb(factory: IDBFactory): Promise<IDBDatabase> {
  const request = factory.open(HANDLE_DB_NAME, 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
      db.createObjectStore(HANDLE_STORE_NAME);
    }
  };
  return idbRequestToPromise(request);
}

export function createIndexedDbBrowserVaultHandleStore(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): BrowserVaultHandleStore {
  return {
    async load() {
      if (!idbSupported(factory)) return null;
      const db = await openHandleDb(factory);
      try {
        const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
        const request = tx.objectStore(HANDLE_STORE_NAME).get(HANDLE_KEY);
        const handle = await idbRequestToPromise(request);
        await idbTransactionDone(tx);
        return isDirectoryHandle(handle) ? handle : null;
      } finally {
        db.close();
      }
    },
    async save(handle) {
      if (!idbSupported(factory)) {
        throw new Error('IndexedDB is unavailable; cannot persist the mounted vault directory.');
      }
      const db = await openHandleDb(factory);
      try {
        const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
        tx.objectStore(HANDLE_STORE_NAME).put(handle, HANDLE_KEY);
        await idbTransactionDone(tx);
      } finally {
        db.close();
      }
    },
    async clear() {
      if (!idbSupported(factory)) return;
      const db = await openHandleDb(factory);
      try {
        const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
        tx.objectStore(HANDLE_STORE_NAME).delete(HANDLE_KEY);
        await idbTransactionDone(tx);
      } finally {
        db.close();
      }
    },
  };
}

export function createInMemoryBrowserVaultHandleStore(): BrowserVaultHandleStore {
  let handle: FileSystemDirectoryHandle | null = null;
  return {
    async load() {
      return handle;
    },
    async save(nextHandle) {
      handle = nextHandle;
    },
    async clear() {
      handle = null;
    },
  };
}

export async function loadStoredBrowserVaultDirectoryHandle(
  store: BrowserVaultHandleStore = createIndexedDbBrowserVaultHandleStore(),
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await store.load();
  } catch {
    return null;
  }
}

export async function persistBrowserVaultDirectoryHandle(
  handle: FileSystemDirectoryHandle,
  store: BrowserVaultHandleStore = createIndexedDbBrowserVaultHandleStore(),
): Promise<void> {
  await store.save(handle);
}

export async function clearStoredBrowserVaultDirectoryHandle(
  store: BrowserVaultHandleStore = createIndexedDbBrowserVaultHandleStore(),
): Promise<void> {
  await store.clear();
}

type NavigatorWithStorage = Navigator & {
  storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> };
};

function opfsSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  return typeof (navigator as NavigatorWithStorage).storage?.getDirectory === 'function';
}

export function isOpfsSupported(): boolean {
  return opfsSupported();
}

/**
 * Acquire an OPFS (Origin Private File System) root directory handle. Used as
 * an auto-mount fallback so skill installs / vault writes work out of the box
 * on browsers that support OPFS, without forcing the user through a directory
 * picker first. OPFS handles are scoped to the origin and are persisted
 * implicitly by the browser — there is no stored handle to rehydrate.
 */
export async function acquireOpfsRootHandle(): Promise<FileSystemDirectoryHandle> {
  if (!opfsSupported()) {
    throw new Error('OPFS is not available in this browser.');
  }
  return (navigator as NavigatorWithStorage).storage!.getDirectory!();
}

function directoryPickerSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === 'function';
}

export function browserFsAccessSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (!idbSupported()) return false;
  return directoryPickerSupported() || opfsSupported();
}

export async function pickBrowserVaultDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!directoryPickerSupported()) {
    throw new Error(
      'Your browser does not support the directory picker. Use `navigator.storage.getDirectory()` for an OPFS-backed vault instead.',
    );
  }
  return (window as WindowWithDirectoryPicker).showDirectoryPicker!({ mode: 'readwrite' });
}

/**
 * Permission state for a vault handle. User-picker handles (FSAccess) expose
 * `queryPermission` / `requestPermission` and may return `'prompt'` /
 * `'denied'`. OPFS handles (from `navigator.storage.getDirectory()`) do NOT
 * expose these methods — OPFS is implicitly granted by the browser, so we
 * treat missing methods as `'granted'`. Without this fallback OPFS mounts
 * would stall in `needs-permission` forever.
 */
export async function queryBrowserVaultPermission(
  handle: FileSystemDirectoryHandle,
): Promise<BrowserVaultPermissionState> {
  if (!browserFsAccessSupported()) return 'unsupported';
  const query = (handle as BrowserDirectoryHandle).queryPermission;
  if (!query) return 'granted';
  return query.call(handle, { mode: 'readwrite' });
}

export async function requestBrowserVaultPermission(
  handle: FileSystemDirectoryHandle,
): Promise<BrowserVaultPermissionState> {
  if (!browserFsAccessSupported()) return 'unsupported';
  const request = (handle as BrowserDirectoryHandle).requestPermission;
  if (!request) return 'granted';
  return request.call(handle, { mode: 'readwrite' });
}

export class BrowserFsAccessFileSystem implements VaultFileSystem {
  readonly root: string;

  constructor(private readonly rootHandle: FileSystemDirectoryHandle) {
    this.root = `browser-fsaccess://${rootHandle.name}`;
  }

  static supported(): boolean {
    return browserFsAccessSupported();
  }

  private async resolveDirectory(
    relPath: string,
    options?: { create?: boolean },
  ): Promise<FileSystemDirectoryHandle> {
    let current = this.rootHandle;
    for (const part of splitRelPath(relPath)) {
      current = await current.getDirectoryHandle(part, { create: options?.create });
    }
    return current;
  }

  private async resolveParent(relPath: string, options?: { create?: boolean }) {
    const parts = splitRelPath(relPath);
    const name = parts.pop();
    if (!name) {
      throw new Error(`Invalid vault path: ${relPath}`);
    }
    const parent = parts.length > 0 ? await this.resolveDirectory(parts.join('/'), options) : this.rootHandle;
    return { parent, name };
  }

  async readFile(relPath: string): Promise<string> {
    const { parent, name } = await this.resolveParent(relPath);
    const fileHandle = await parent.getFileHandle(name);
    const file = await fileHandle.getFile();
    return file.text();
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const { parent, name } = await this.resolveParent(relPath, { create: true });
    const fileHandle = await parent.getFileHandle(name, { create: true });
    const writer = await fileHandle.createWritable();
    await writer.write(content);
    await writer.close();
  }

  async listDir(relPath: string): Promise<string[]> {
    const dir = relPath ? await this.resolveDirectory(relPath) : this.rootHandle;
    const entries: string[] = [];
    for await (const entry of (dir as BrowserDirectoryHandle).values?.() ?? []) {
      entries.push(entry.name);
    }
    return entries.sort((left, right) => left.localeCompare(right));
  }

  async stat(relPath: string): Promise<{ mtimeMs: number; size: number } | null> {
    try {
      const { parent, name } = await this.resolveParent(relPath);
      const fileHandle = await parent.getFileHandle(name);
      const file = await fileHandle.getFile();
      return { mtimeMs: file.lastModified, size: file.size };
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFoundError') {
        return null;
      }
      throw err;
    }
  }

  async remove(relPath: string): Promise<void> {
    const { parent, name } = await this.resolveParent(relPath);
    await parent.removeEntry(name, { recursive: true });
  }

  async mkdir(relPath: string): Promise<void> {
    await this.resolveDirectory(relPath, { create: true });
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      if (!relPath) return true;
      const { parent, name } = await this.resolveParent(relPath);
      try {
        await parent.getFileHandle(name);
        return true;
      } catch (fileErr) {
        if (fileErr instanceof Error && fileErr.name !== 'NotFoundError') {
          throw fileErr;
        }
      }
      await parent.getDirectoryHandle(name);
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === 'NotFoundError') {
        return false;
      }
      if (err instanceof Error && err.message.includes('not found')) {
        return false;
      }
      return false;
    }
  }
}
