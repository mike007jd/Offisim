import { create } from 'zustand';

/**
 * Per-conversation thinking level (reasoning effort). The composer thinking chip
 * writes here so a level chosen on thread A never leaks into thread B; the runtime
 * reads the thread's override at send time. Like the model picker (and unlike the
 * permission mode) this axis defers to Pi when unset: a thread with no explicit
 * pick forwards no level, so Pi applies its own default/session level
 * (`settingsManager.getDefaultThinkingLevel()`, falling back to `medium`) instead
 * of Offisim manufacturing one. The chip shows `DEFAULT_THINKING_LEVEL` as the
 * resting label only.
 *
 * The selected native model owns the real vocabulary. Codex may publish
 * `none`, `max`, `ultra`, or a future non-empty effort id; API models may still
 * use Pi's `off` vocabulary. The picker only writes ids advertised by the
 * selected model, and each host validates the value again before execution.
 */
export type ThinkingLevel = string;

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

/** Pi's own default (DEFAULT_THINKING_LEVEL) — moderate reasoning. */
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';

const STORAGE_KEY = 'offisim:pi-agent:thread-thinking';
const THINKING_LEVEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && THINKING_LEVEL_PATTERN.test(value);
}

function loadMap(): Record<string, ThinkingLevel> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, ThinkingLevel> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isThinkingLevel(value)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function saveMap(map: Record<string, ThinkingLevel>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage can be unavailable in previews; the selection simply does not persist.
  }
}

interface PiThreadThinkingStore {
  byThread: Record<string, ThinkingLevel>;
  /** Set this thread's thinking level (always one of the closed enum values). */
  setThreadThinking: (threadId: string, level: ThinkingLevel) => void;
  /** Remove an override so the selected native preset applies its own default. */
  clearThreadThinking: (threadId: string) => void;
}

export const usePiThreadThinkingStore = create<PiThreadThinkingStore>((set) => ({
  byThread: loadMap(),
  setThreadThinking: (threadId, level) =>
    set((state) => {
      const next = { ...state.byThread, [threadId]: level };
      saveMap(next);
      return { byThread: next };
    }),
  clearThreadThinking: (threadId) =>
    set((state) => {
      if (!(threadId in state.byThread)) return state;
      const next = { ...state.byThread };
      delete next[threadId];
      saveMap(next);
      return { byThread: next };
    }),
}));

/**
 * The thread's *explicit* thinking-level override, or `undefined` when the user
 * has not picked one. Read at send time and forwarded to the host only when set,
 * mirroring the model override — an absent value lets Pi resolve its own
 * default/session level rather than Offisim forcing `medium` on every run. Read
 * imperatively so the most recent selection always wins without a reactive
 * subscription in the runtime.
 */
export function resolveThreadThinkingOverride(threadId: string): ThinkingLevel | undefined {
  return usePiThreadThinkingStore.getState().byThread[threadId];
}
