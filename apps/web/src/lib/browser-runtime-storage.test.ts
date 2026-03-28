import { createMemoryRepositories } from '@offisim/core/browser';
import { describe, expect, it } from 'vitest';
import {
  clearBrowserRuntimeSnapshot,
  loadBrowserEventHistory,
  loadBrowserRuntimeBootstrapState,
  loadBrowserRuntimeSnapshot,
  saveBrowserEventHistory,
  saveBrowserRuntimeSnapshot,
} from './browser-runtime-storage';

function createStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
    removeItem(key: string) {
      store.delete(key);
    },
  };
}

describe('browser runtime storage', () => {
  it('round-trips a repository snapshot through storage', async () => {
    const storage = createStorageMock();
    const repos = createMemoryRepositories();
    const now = new Date().toISOString();

    await repos.companies.create({
      company_id: 'c-1',
      name: 'Persisted Browser Co',
      status: 'active',
      workspace_root: null,
      default_model_policy_json: null,
      created_at: now,
      updated_at: now,
    });
    repos.seed.employees([
      {
        employee_id: 'e-1',
        company_id: 'c-1',
        source_asset_id: null,
        source_package_id: null,
        name: 'Browser Agent',
        role_slug: 'developer',
        workstation_id: null,
        persona_json: null,
        config_json: null,
        enabled: 1,
        created_at: now,
        updated_at: now,
      },
    ]);

    saveBrowserRuntimeSnapshot(repos, storage);
    const snapshot = loadBrowserRuntimeSnapshot(storage);

    expect(snapshot?.companies).toEqual(
      expect.arrayContaining([expect.objectContaining({ company_id: 'c-1' })]),
    );
    expect(snapshot?.employees).toEqual(
      expect.arrayContaining([expect.objectContaining({ employee_id: 'e-1' })]),
    );
  });

  it('returns null for invalid stored JSON', () => {
    const storage = createStorageMock();
    storage.setItem('offisim:browser-runtime-snapshot:v1', '{bad json');

    expect(loadBrowserRuntimeSnapshot(storage)).toBeNull();
  });

  it('clears the stored snapshot', () => {
    const storage = createStorageMock();
    storage.setItem('offisim:browser-runtime-snapshot:v1', '{"companies":[]}');

    clearBrowserRuntimeSnapshot(storage);

    expect(loadBrowserRuntimeSnapshot(storage)).toBeNull();
  });

  it('round-trips persisted event history', () => {
    const storage = createStorageMock();
    const event = {
      type: 'employee.created',
      timestamp: Date.now(),
      companyId: 'c-1',
      entityId: 'e-1',
      entityType: 'employee',
      payload: {
        employeeId: 'e-1',
        name: 'Persisted Event Agent',
      },
    } as const;

    saveBrowserEventHistory([event], storage);

    expect(loadBrowserEventHistory(storage)).toEqual([event]);
    expect(loadBrowserRuntimeBootstrapState(storage).eventHistory).toEqual([event]);
  });
});
