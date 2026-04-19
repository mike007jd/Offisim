import type { EventBus, RuntimeRepositories } from '@offisim/core/browser';
import {
  BrowserFsAccessFileSystem,
  acquireOpfsRootHandle,
  clearStoredBrowserVaultDirectoryHandle,
  isOpfsSupported,
  loadStoredBrowserVaultDirectoryHandle,
  persistBrowserVaultDirectoryHandle,
  pickBrowserVaultDirectory,
  queryBrowserVaultPermission,
  requestBrowserVaultPermission,
} from '../../../../packages/core/src/vault/browser-fs';
import type { VaultDirectoryStatus as BrowserVaultDirectoryStatus } from '@offisim/ui-office/web';
import type { VaultActivation } from './vault-activation';
import { activateVaultSync } from './vault-activation';

export interface BrowserVaultController {
  getStatus(): Promise<BrowserVaultDirectoryStatus>;
  mount(handle?: FileSystemDirectoryHandle): Promise<BrowserVaultDirectoryStatus>;
  unmount(): Promise<BrowserVaultDirectoryStatus>;
  dispose(): void;
  readonly activation: VaultActivation | null;
}

export interface BrowserVaultControllerDependencies {
  eventBus: EventBus;
  repos: RuntimeRepositories;
  companyId: string;
  /** Fired every time a mount succeeds, with the fresh activation. */
  onActivate?: (activation: VaultActivation) => void;
  support: {
    isSupported: () => boolean;
    loadStoredHandle: () => Promise<FileSystemDirectoryHandle | null>;
    persistHandle: (handle: FileSystemDirectoryHandle) => Promise<void>;
    clearStoredHandle: () => Promise<void>;
    showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>;
    getPermission: (handle: FileSystemDirectoryHandle) => Promise<PermissionState | 'unsupported'>;
    requestPermission: (
      handle: FileSystemDirectoryHandle,
    ) => Promise<PermissionState | 'unsupported'>;
    createFileSystem: (handle: FileSystemDirectoryHandle) => BrowserFsAccessFileSystem;
  };
  activation: {
    activate: (options: {
      fs: BrowserFsAccessFileSystem;
      eventBus: EventBus;
      repos: RuntimeRepositories;
      companyId: string;
    }) => VaultActivation;
  };
}

function isBrowserVaultHandleError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'NotAllowedError' ||
      err.name === 'AbortError' ||
      err.name === 'NotFoundError' ||
      err.name === 'InvalidStateError' ||
      err.message.toLowerCase().includes('permission') ||
      err.message.toLowerCase().includes('handle'))
  );
}

function unsupportedStatus(): BrowserVaultDirectoryStatus {
  return {
    supported: false,
    mode: 'unsupported',
    directoryName: null,
    root: null,
    errorMessage: null,
  };
}

function disconnectedStatus(
  mode: Extract<BrowserVaultDirectoryStatus['mode'], 'unmounted' | 'needs-permission'>,
  handle?: FileSystemDirectoryHandle | null,
): BrowserVaultDirectoryStatus {
  return {
    supported: true,
    mode,
    directoryName: handle?.name ?? null,
    root: null,
    errorMessage: null,
  };
}

function errorStatus(
  handle: FileSystemDirectoryHandle | null,
  errorMessage: string,
): BrowserVaultDirectoryStatus {
  return {
    supported: true,
    mode: 'error',
    directoryName: handle?.name ?? null,
    root: null,
    errorMessage,
  };
}

function mountedStatus(
  fs: BrowserFsAccessFileSystem,
  handle: FileSystemDirectoryHandle,
): BrowserVaultDirectoryStatus {
  return {
    supported: true,
    mode: 'mounted',
    directoryName: handle.name,
    root: fs.root,
    errorMessage: null,
  };
}

function createDefaultDependencies(
  eventBus: EventBus,
  repos: RuntimeRepositories,
  companyId: string,
): BrowserVaultControllerDependencies {
  return {
    eventBus,
    repos,
    companyId,
    support: {
      isSupported: () => BrowserFsAccessFileSystem.supported(),
      loadStoredHandle: () => loadStoredBrowserVaultDirectoryHandle(),
      persistHandle: (handle) => persistBrowserVaultDirectoryHandle(handle),
      clearStoredHandle: () => clearStoredBrowserVaultDirectoryHandle(),
      showDirectoryPicker: () => pickBrowserVaultDirectory(),
      getPermission: (handle) => queryBrowserVaultPermission(handle),
      requestPermission: (handle) => requestBrowserVaultPermission(handle),
      createFileSystem: (handle) => new BrowserFsAccessFileSystem(handle),
    },
    activation: {
      activate: ({ fs, eventBus: bus, repos: runtimeRepos, companyId: activeCompanyId }) =>
        activateVaultSync({
          fs,
          eventBus: bus,
          repos: runtimeRepos,
          companyId: activeCompanyId,
        }),
    },
  };
}

function emitActivationFailure(eventBus: EventBus, companyId: string, reason: string): void {
  try {
    eventBus.emit({
      type: 'vault.sync.failed',
      entityId: '',
      entityType: 'employee',
      companyId,
      timestamp: Date.now(),
      payload: { employeeId: '', reason, target: 'activate' },
    });
  } catch (emitErr) {
    console.warn('[vault] failed to emit browser activation failure', emitErr);
  }
}

export async function createBrowserVaultController(
  deps: BrowserVaultControllerDependencies,
): Promise<BrowserVaultController> {
  let activation: VaultActivation | null = null;
  let currentHandle: FileSystemDirectoryHandle | null = null;
  let status: BrowserVaultDirectoryStatus = deps.support.isSupported()
    ? disconnectedStatus('unmounted')
    : unsupportedStatus();

  const resetActivation = () => {
    activation?.dispose();
    activation = null;
  };

  const activateHandle = async (handle: FileSystemDirectoryHandle) => {
    resetActivation();
    currentHandle = handle;
    try {
      const fs = deps.support.createFileSystem(handle);
      const nextActivation = deps.activation.activate({
        fs,
        eventBus: deps.eventBus,
        repos: deps.repos,
        companyId: deps.companyId,
      });
      await nextActivation.hydrate();
      activation = nextActivation;
      status = mountedStatus(fs, handle);
      try {
        deps.onActivate?.(nextActivation);
      } catch (err) {
        console.warn('[vault] onActivate callback threw', err);
      }
      return status;
    } catch (err) {
      resetActivation();
      if (isBrowserVaultHandleError(err)) {
        currentHandle = null;
        await deps.support.clearStoredHandle();
        status = disconnectedStatus('unmounted');
        return status;
      }
      const reason = err instanceof Error ? err.message : String(err);
      emitActivationFailure(deps.eventBus, deps.companyId, reason);
      status = errorStatus(handle, reason);
      return status;
    }
  };

  if (deps.support.isSupported()) {
    const storedHandle = await deps.support.loadStoredHandle();
    if (storedHandle) {
      currentHandle = storedHandle;
      try {
        const permission = await deps.support.getPermission(storedHandle);
        if (permission === 'granted') {
          await activateHandle(storedHandle);
        } else {
          status = disconnectedStatus('needs-permission', storedHandle);
        }
      } catch (err) {
        if (!isBrowserVaultHandleError(err)) {
          throw err;
        }
        currentHandle = null;
        await deps.support.clearStoredHandle();
        status = disconnectedStatus('unmounted');
      }
    } else if (isOpfsSupported()) {
      // No user-picked directory: auto-mount OPFS so agent-driven writes
      // (skill install, vault sync) work out of the box. The user can later
      // pick a real directory via `mount(...)` and we'll swap handles — OPFS
      // contents don't migrate, but that's an explicit trade-off the user
      // makes when they ask for durable-local storage.
      try {
        const opfsRoot = await acquireOpfsRootHandle();
        await activateHandle(opfsRoot);
      } catch (err) {
        // OPFS failure is non-fatal; we stay in 'unmounted' and the user can
        // still pick a directory manually from Settings.
        console.warn('[vault] OPFS auto-mount failed', err);
      }
    }
  }

  return {
    async getStatus() {
      return status;
    },
    async mount(providedHandle?: FileSystemDirectoryHandle) {
      if (!deps.support.isSupported()) {
        status = unsupportedStatus();
        return status;
      }
      if (status.mode === 'needs-permission' && currentHandle) {
        let permission: PermissionState | 'unsupported';
        try {
          permission = await deps.support.requestPermission(currentHandle);
        } catch (err) {
          if (!isBrowserVaultHandleError(err)) {
            throw err;
          }
          currentHandle = null;
          await deps.support.clearStoredHandle();
          status = disconnectedStatus('unmounted');
          return status;
        }
        if (permission !== 'granted') {
          status = disconnectedStatus('needs-permission', currentHandle);
          return status;
        }
        await deps.support.persistHandle(currentHandle);
        return activateHandle(currentHandle);
      }

      if (status.mode === 'error' && currentHandle && !providedHandle) {
        return activateHandle(currentHandle);
      }

      const handle = providedHandle ?? (await deps.support.showDirectoryPicker());
      const permission = await deps.support.requestPermission(handle);
      if (permission !== 'granted') {
        currentHandle = handle;
        status = disconnectedStatus('needs-permission', handle);
        return status;
      }
      await deps.support.persistHandle(handle);
      return activateHandle(handle);
    },
    async unmount() {
      resetActivation();
      currentHandle = null;
      await deps.support.clearStoredHandle();
      status = deps.support.isSupported() ? disconnectedStatus('unmounted') : unsupportedStatus();
      return status;
    },
    dispose() {
      resetActivation();
    },
    get activation() {
      return activation;
    },
  };
}

export async function createDefaultBrowserVaultController(
  eventBus: EventBus,
  repos: RuntimeRepositories,
  companyId: string,
  opts?: { onActivate?: (activation: VaultActivation) => void },
): Promise<BrowserVaultController> {
  const base = createDefaultDependencies(eventBus, repos, companyId);
  return createBrowserVaultController(
    opts?.onActivate ? { ...base, onActivate: opts.onActivate } : base,
  );
}
