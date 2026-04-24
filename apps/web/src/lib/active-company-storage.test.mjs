import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVE_COMPANY_STORAGE_KEY,
  readStoredActiveCompany,
  restoreStoredActiveCompany,
  storeActiveCompany,
} from './active-company-storage.ts';

function createStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test('restoreStoredActiveCompany keeps a browser company that still exists in the snapshot', async () => {
  const storage = createStorage({
    [ACTIVE_COMPANY_STORAGE_KEY]: 'company-1',
    'offisim:browser-runtime-snapshot:v1': JSON.stringify({
      companies: [{ company_id: 'company-1', name: 'Acme' }],
    }),
  });

  const restored = await restoreStoredActiveCompany({ storage, host: 'browser' });

  assert.equal(restored, 'company-1');
  assert.equal(readStoredActiveCompany(storage), 'company-1');
});

test('restoreStoredActiveCompany clears a browser company that no longer exists in the snapshot', async () => {
  const storage = createStorage({
    [ACTIVE_COMPANY_STORAGE_KEY]: 'company-missing',
    'offisim:browser-runtime-snapshot:v1': JSON.stringify({
      companies: [{ company_id: 'company-1', name: 'Acme' }],
    }),
  });

  const restored = await restoreStoredActiveCompany({ storage, host: 'browser' });

  assert.equal(restored, null);
  assert.equal(readStoredActiveCompany(storage), null);
});

test('restoreStoredActiveCompany validates Tauri companies through the repos-only runtime', async () => {
  const storage = createStorage({
    [ACTIVE_COMPANY_STORAGE_KEY]: 'company-2',
  });
  let disposed = false;

  const restored = await restoreStoredActiveCompany({
    storage,
    host: 'tauri',
    createTauriRuntime: async () => ({
      repos: {
        companies: {
          findById: async (id) => (id === 'company-2' ? { company_id: id } : null),
        },
      },
      dispose: () => {
        disposed = true;
      },
    }),
  });

  assert.equal(restored, 'company-2');
  assert.equal(disposed, true);
  assert.equal(readStoredActiveCompany(storage), 'company-2');
});

test('storeActiveCompany removes the persisted key when passed null', () => {
  const storage = createStorage({
    [ACTIVE_COMPANY_STORAGE_KEY]: 'company-3',
  });

  storeActiveCompany(null, storage);

  assert.equal(readStoredActiveCompany(storage), null);
});
