import { InMemoryEventBus } from '@offisim/core/browser';

export const ACTIVE_COMPANY_STORAGE_KEY = 'offisim:active-company';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface CompanyLookupRuntime {
  repos: {
    companies: {
      findById: (id: string) => Promise<unknown | null>;
    };
  };
  dispose?: () => void;
}

type CompanyLookupRuntimeFactory = (eventBus: InMemoryEventBus) => Promise<CompanyLookupRuntime>;

export interface RestoreStoredActiveCompanyOptions {
  storage?: StorageLike;
  createTauriRuntime?: CompanyLookupRuntimeFactory;
}

export function readStoredActiveCompany(storage: StorageLike = window.localStorage): string | null {
  const stored = storage.getItem(ACTIVE_COMPANY_STORAGE_KEY);
  return stored && stored.length > 0 ? stored : null;
}

export function storeActiveCompany(
  id: string | null,
  storage: StorageLike = window.localStorage,
): void {
  if (id) {
    storage.setItem(ACTIVE_COMPANY_STORAGE_KEY, id);
    return;
  }
  storage.removeItem(ACTIVE_COMPANY_STORAGE_KEY);
}

async function createTauriCompanyLookupRuntime(
  eventBus: InMemoryEventBus,
): Promise<CompanyLookupRuntime> {
  const { createTauriRuntimeReposOnly } = await import('./tauri-runtime-lite');
  return createTauriRuntimeReposOnly(eventBus);
}

export async function restoreStoredActiveCompany(
  options: RestoreStoredActiveCompanyOptions = {},
): Promise<string | null> {
  const storage = options.storage ?? window.localStorage;
  const storedCompanyId = readStoredActiveCompany(storage);
  if (!storedCompanyId) {
    return null;
  }

  const createRuntime = options.createTauriRuntime ?? createTauriCompanyLookupRuntime;
  const eventBus = new InMemoryEventBus();
  const runtime = await createRuntime(eventBus);
  try {
    const company = await runtime.repos.companies.findById(storedCompanyId);
    if (company) {
      return storedCompanyId;
    }
    storeActiveCompany(null, storage);
    return null;
  } finally {
    runtime.dispose?.();
  }
}
