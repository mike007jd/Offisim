import { isTauri } from '@offisim/ui-office/web';
import { useEffect, useRef, useState } from 'react';

export const DEV_RESET_STORAGE_KEYS = [
  'offisim:active-company',
  'offisim.interaction-mode.default',
  'offisim.onboarding.v2',
] as const;

const DEV_RESET_PATHS = [
  { path: 'offisim.db', recursive: false },
  { path: 'offisim.db-shm', recursive: false },
  { path: 'offisim.db-wal', recursive: false },
  { path: 'vault', recursive: true },
] as const;

type StorageLike = Pick<Storage, 'removeItem'>;

type DevResetFsModule = {
  remove: (path: string, options?: { baseDir?: unknown; recursive?: boolean }) => Promise<void>;
};

type DevResetPathModule = {
  BaseDirectory: {
    AppData: unknown;
  };
};

export function isTauriDevEphemeralEnabled(options?: {
  dev?: boolean;
  tauri?: boolean;
}): boolean {
  return (options?.dev ?? import.meta.env.DEV) && (options?.tauri ?? isTauri());
}

function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('not found') || message.includes('no such file') || message.includes('enoent')
  );
}

export async function clearTauriDevData(options?: {
  fsModule?: DevResetFsModule;
  pathModule?: DevResetPathModule;
  storage?: StorageLike | null;
}): Promise<void> {
  const fsModule =
    options?.fsModule ?? ((await import('@tauri-apps/plugin-fs')) as unknown as DevResetFsModule);
  const pathModule =
    options?.pathModule ??
    ((await import('@tauri-apps/api/path')) as unknown as DevResetPathModule);
  const storage = options?.storage ?? (typeof window === 'undefined' ? null : window.localStorage);

  for (const target of DEV_RESET_PATHS) {
    try {
      await fsModule.remove(target.path, {
        baseDir: pathModule.BaseDirectory.AppData,
        recursive: target.recursive,
      });
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
  }

  for (const key of DEV_RESET_STORAGE_KEYS) {
    storage?.removeItem(key);
  }
}

export function useTauriDevEphemeralReset(): boolean {
  const enabled = isTauriDevEphemeralEnabled();
  const [isResetting, setIsResetting] = useState(enabled);
  const closeInFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let unlisten: (() => void | Promise<void>) | null = null;

    void (async () => {
      try {
        await clearTauriDevData();
        if (disposed) return;

        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();
        unlisten = await currentWindow.onCloseRequested(async (event) => {
          if (closeInFlightRef.current) return;
          closeInFlightRef.current = true;
          event.preventDefault();
          try {
            await clearTauriDevData();
          } finally {
            await currentWindow.destroy();
          }
        });
      } catch (error) {
        console.warn('[dev-reset] failed to clear desktop dev state', error);
      } finally {
        if (!disposed) {
          setIsResetting(false);
        }
      }
    })();

    return () => {
      disposed = true;
      if (unlisten) {
        void Promise.resolve(unlisten());
      }
    };
  }, [enabled]);

  return isResetting;
}
