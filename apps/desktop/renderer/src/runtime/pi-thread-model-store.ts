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
}));

/**
 * Explicit model selector for a thread. Empty means the engine gateway continues
 * the durable exact leaf when one exists; only a new task uses the live default.
 * Adapters never choose or silently replace this value.
 */
export function resolveThreadModel(threadId: string): string {
  return usePiThreadModelStore.getState().byThread[threadId] || '';
}
