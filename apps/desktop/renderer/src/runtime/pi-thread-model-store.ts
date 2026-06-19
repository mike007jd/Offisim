import { create } from 'zustand';
import { readPiModelOverride } from './pi-agent-config.js';

/**
 * Per-thread model selection. The composer model picker writes here so a model
 * chosen on thread A never leaks into thread B; the runtime reads the effective
 * model at send time. This is a thin per-thread layer over the global Settings
 * override (`pi-agent-config`): a thread with no explicit pick falls back to the
 * global override, which itself falls back to Pi's default. Pi still owns
 * credentials and the real catalog — this only forwards a registry id.
 */
const STORAGE_KEY = 'offisim:pi-agent:thread-models';

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
 * Effective Pi model for a thread: the per-thread pick, else the global Settings
 * override, else `''` (let Pi choose its default). Read at send time so the most
 * recent selection always wins without a reactive subscription in the runtime.
 */
export function resolveThreadModel(threadId: string): string {
  return usePiThreadModelStore.getState().byThread[threadId] || readPiModelOverride();
}
