import { create } from 'zustand';

/**
 * Per-conversation permission mode. The composer mode chip writes here so a mode
 * chosen on thread A never leaks into thread B; the runtime reads the effective
 * mode at send time. Unlike the model picker there is no global override layer —
 * the axis is a closed enum with a safe default (`auto`), so a thread with no
 * explicit pick simply runs autonomous-with-guard. The host turns the forwarded
 * string into real Pi tool gating; this only stores and forwards it.
 */
export type PermissionMode = 'plan' | 'auto' | 'full';

export const PERMISSION_MODES: readonly PermissionMode[] = ['plan', 'auto', 'full'];

/** Autonomous with a catastrophe guard — the sane leave-it-on default. */
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'auto';

const STORAGE_KEY = 'offisim:pi-agent:thread-modes';

function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value);
}

function loadMap(): Record<string, PermissionMode> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, PermissionMode> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isPermissionMode(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function saveMap(map: Record<string, PermissionMode>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage can be unavailable in previews; the selection simply does not persist.
  }
}

interface PiThreadModeStore {
  byThread: Record<string, PermissionMode>;
  /** Set this thread's permission mode (always one of the closed enum values). */
  setThreadMode: (threadId: string, mode: PermissionMode) => void;
}

export const usePiThreadModeStore = create<PiThreadModeStore>((set) => ({
  byThread: loadMap(),
  setThreadMode: (threadId, mode) =>
    set((state) => {
      const next = { ...state.byThread, [threadId]: mode };
      saveMap(next);
      return { byThread: next };
    }),
}));

/**
 * Effective permission mode for a thread: the per-thread pick, else the safe
 * default. Read at send time so the most recent selection always wins without a
 * reactive subscription in the runtime.
 */
export function resolveThreadMode(threadId: string): PermissionMode {
  return usePiThreadModeStore.getState().byThread[threadId] ?? DEFAULT_PERMISSION_MODE;
}
