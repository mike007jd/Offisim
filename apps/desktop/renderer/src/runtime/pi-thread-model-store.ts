import { create } from 'zustand';

/**
 * Per-thread model selection. The composer model picker writes here so a model
 * chosen on thread A never leaks into thread B; the runtime reads the effective
 * model at send time. A thread with no explicit pick delegates to the runtime
 * catalog's verified stable default; there is no competing global model master.
 * The stored value is the adapter-private selector, never a display label.
 */
const STORAGE_KEY = 'offisim:ai:thread-models';

function loadMap(): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function saveMap(map: Record<string, string>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage can be unavailable in previews; the selection simply does not persist.
  }
}

interface PiThreadModelStore {
  byThread: Record<string, string>;
  /** Set (non-empty) or clear (empty string) this thread's model override. */
  setThreadModel: (threadId: string, model: string) => void;
  /** Drop persisted picks that are no longer in the runtime's available-model list. */
  pruneInvalidModels: (validValues: readonly string[]) => void;
}

export const usePiThreadModelStore = create<PiThreadModelStore>((set) => ({
  byThread: loadMap(),
  setThreadModel: (threadId, model) =>
    set((state) => {
      const next = { ...state.byThread };
      const trimmed = model.trim();
      if (trimmed) next[threadId] = trimmed;
      else delete next[threadId];
      saveMap(next);
      return { byThread: next };
    }),
  pruneInvalidModels: (validValues) =>
    set((state) => {
      const valid = new Set(validValues);
      const entries = Object.entries(state.byThread).filter(([, value]) => valid.has(value));
      if (entries.length === Object.keys(state.byThread).length) return state;
      const next = Object.fromEntries(entries);
      saveMap(next);
      return { byThread: next };
    }),
}));

/**
 * Effective model selector for a thread. Empty means the engine gateway chooses
 * the first verified stable model for the bound account; adapters never choose.
 */
export function resolveThreadModel(threadId: string): string {
  return usePiThreadModelStore.getState().byThread[threadId] || '';
}
