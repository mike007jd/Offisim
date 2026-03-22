// Node 25 exposes a native --localstorage-file backed localStorage that
// shadows jsdom's implementation and lacks .clear() / .setItem() etc.
// Replace it with a proper in-memory Map-backed stub before every test file.
//
// jsdom also does not implement window.matchMedia — stub it too.

import '@testing-library/jest-dom';
import { vi } from 'vitest';

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
}

vi.stubGlobal('localStorage', createLocalStorageStub());

// Stub matchMedia — default to light (non-dark) system preference.
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));
