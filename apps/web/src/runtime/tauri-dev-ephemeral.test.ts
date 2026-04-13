import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEV_RESET_STORAGE_KEYS,
  clearTauriDevData,
  isTauriDevEphemeralEnabled,
} from './tauri-dev-ephemeral';

function createStorage(seed: Record<string, string>) {
  const data = new Map(Object.entries(seed));
  return {
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

describe('isTauriDevEphemeralEnabled', () => {
  it('only enables ephemeral desktop state in dev tauri sessions', () => {
    expect(isTauriDevEphemeralEnabled({ dev: true, tauri: true })).toBe(true);
    expect(isTauriDevEphemeralEnabled({ dev: true, tauri: false })).toBe(false);
    expect(isTauriDevEphemeralEnabled({ dev: false, tauri: true })).toBe(false);
    expect(isTauriDevEphemeralEnabled({ dev: false, tauri: false })).toBe(false);
  });
});

describe('clearTauriDevData', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('removes desktop sqlite files, vault data, and volatile local storage keys', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const storage = createStorage({
      'offisim:active-company': 'company-123',
      'offisim:browser-runtime-snapshot:v1': '{"companies":[]}',
      'offisim.interaction-mode.default': 'boss_proxy',
      'offisim.onboarding.v2': '{"done":true}',
      untouched: 'keep-me',
    });

    await clearTauriDevData({
      fsModule: { remove },
      pathModule: { BaseDirectory: { AppData: 'APPDATA' } },
      storage,
    });

    expect(remove).toHaveBeenCalledTimes(4);
    expect(remove).toHaveBeenNthCalledWith(1, 'offisim.db', {
      baseDir: 'APPDATA',
      recursive: false,
    });
    expect(remove).toHaveBeenNthCalledWith(2, 'offisim.db-shm', {
      baseDir: 'APPDATA',
      recursive: false,
    });
    expect(remove).toHaveBeenNthCalledWith(3, 'offisim.db-wal', {
      baseDir: 'APPDATA',
      recursive: false,
    });
    expect(remove).toHaveBeenNthCalledWith(4, 'vault', {
      baseDir: 'APPDATA',
      recursive: true,
    });

    for (const key of DEV_RESET_STORAGE_KEYS) {
      expect(storage.getItem(key)).toBeNull();
    }
    expect(storage.getItem('untouched')).toBe('keep-me');
  });

  it('keeps clearing remaining targets when some paths are already missing', async () => {
    const remove = vi
      .fn()
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValue(undefined);
    const storage = createStorage({
      'offisim:active-company': 'company-123',
    });

    await expect(
      clearTauriDevData({
        fsModule: { remove },
        pathModule: { BaseDirectory: { AppData: 'APPDATA' } },
        storage,
      }),
    ).resolves.toBeUndefined();

    expect(remove).toHaveBeenCalledTimes(4);
    expect(storage.getItem('offisim:active-company')).toBeNull();
  });
});
