import type { EventBus, RuntimeRepositories } from '@offisim/core/browser';
import {
  BrowserFsAccessFileSystem,
  clearStoredBrowserVaultDirectoryHandle,
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
  mount(): Promise<BrowserVaultDirectoryStatus>;
  unmount(): Promise<BrowserVaultDirectoryStatus>;
  dispose(): void;
  readonly activation: VaultActivation | null;
}

export interface BrowserVaultControllerDependencies {
  eventBus: EventBus;
  repos: RuntimeRepositories;
  companyId: string;
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

function unsupportedStatus(): BrowserVaultDirectoryStatus {
  return { supported: false, mode: 'unsupported', directoryName: null, root: null };
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

export async function createBrowserVaultController(
  deps: BrowserVaultControllerDependencies,
): Promise<BrowserVaultController> {
  let activation: VaultActivation | null = null;
  let status: BrowserVaultDirectoryStatus = deps.support.isSupported()
    ? disconnectedStatus('unmounted')
    : unsupportedStatus();

  const resetActivation = () => {
    activation?.dispose();
    activation = null;
  };

  const activateHandle = async (handle: FileSystemDirectoryHandle) => {
    resetActivation();
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
    return status;
  };

  if (deps.support.isSupported()) {
    const storedHandle = await deps.support.loadStoredHandle();
    if (storedHandle) {
      const permission = await deps.support.getPermission(storedHandle);
      if (permission === 'granted') {
        await activateHandle(storedHandle);
      } else {
        status = disconnectedStatus('needs-permission', storedHandle);
      }
    }
  }

  return {
    async getStatus() {
      return status;
    },
    async mount() {
      if (!deps.support.isSupported()) {
        status = unsupportedStatus();
        return status;
      }
      const handle = await deps.support.showDirectoryPicker();
      const permission = await deps.support.requestPermission(handle);
      if (permission !== 'granted') {
        status = disconnectedStatus('needs-permission', handle);
        return status;
      }
      await deps.support.persistHandle(handle);
      return activateHandle(handle);
    },
    async unmount() {
      resetActivation();
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
): Promise<BrowserVaultController> {
  return createBrowserVaultController(createDefaultDependencies(eventBus, repos, companyId));
}
