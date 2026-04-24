import { InMemoryEventBus } from '@offisim/core/browser';
import { loadBrowserRuntimeSnapshot } from './browser-runtime-storage';

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

interface MaybeCompanyRow {
  company_id?: unknown;
}

export interface RestoreStoredActiveCompanyOptions {
  storage?: StorageLike;
  host?: 'browser' | 'tauri';
  createTauriRuntime?: CompanyLookupRuntimeFactory;
}

function isTauriHost(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
      'undefined'
  );
}

export function readStoredActiveCompany(
  storage: StorageLike = window.localStorage,
): string | null {
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

function browserSnapshotHasCompany(companyId: string, storage: StorageLike): boolean {
  const companies = loadBrowserRuntimeSnapshot(storage)?.companies;
  if (!Array.isArray(companies)) return false;
  return companies.some((row) => (row as MaybeCompanyRow).company_id === companyId);
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

  const host = options.host ?? (isTauriHost() ? 'tauri' : 'browser');
  if (host === 'browser') {
    if (browserSnapshotHasCompany(storedCompanyId, storage)) {
      return storedCompanyId;
    }
    storeActiveCompany(null, storage);
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
