import { type PermissionMode, isPermissionMode } from '@/runtime/pi-thread-mode-store.js';
import { type ThinkingLevel, isThinkingLevel } from '@/runtime/pi-thread-thinking-store.js';
import { create } from 'zustand';

export type ConversationTargetKey = `employee:${string}` | `team:${string}`;

export interface ConversationTargetRunDefaults {
  model?: string;
  thinking?: ThinkingLevel;
  speed?: 'fast';
  mode?: PermissionMode;
}

export type ConversationTargetRunDefaultUpdate =
  | { axis: 'model'; value: string | undefined }
  | { axis: 'thinking'; value: ThinkingLevel | undefined }
  | { axis: 'speed'; value: 'fast' | undefined }
  | { axis: 'mode'; value: PermissionMode | undefined };

export function canSeedConversationRunDefaults({
  authorityIsFetched,
  authority,
  hasCatalog,
}: {
  authorityIsFetched: boolean;
  authority: unknown;
  hasCatalog: boolean;
}): boolean {
  return authorityIsFetched && authority === null && hasCatalog;
}

const STORAGE_KEY = 'offisim:ai:target-run-defaults';

function isTargetKey(value: string): value is ConversationTargetKey {
  return /^(?:employee|team):.+$/u.test(value);
}

/**
 * Drop anything that is not a validated four-axis entry: unknown target keys,
 * non-object values, out-of-vocabulary thinking/mode values, entries with no
 * axes at all, and any extra fields (older persisted shapes are simply
 * narrowed, not migrated).
 */
export function normalizeTargetRunDefaults(
  parsed: unknown,
): Record<ConversationTargetKey, ConversationTargetRunDefaults> {
  if (!parsed || typeof parsed !== 'object') return {};
  const out: Record<ConversationTargetKey, ConversationTargetRunDefaults> = {};
  for (const [targetKey, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isTargetKey(targetKey) || !value || typeof value !== 'object') continue;
    const candidate = value as Record<string, unknown>;
    const entry: ConversationTargetRunDefaults = {};
    if (typeof candidate.model === 'string' && candidate.model.trim()) {
      entry.model = candidate.model.trim();
    }
    if (isThinkingLevel(candidate.thinking)) entry.thinking = candidate.thinking;
    if (candidate.speed === 'fast') entry.speed = 'fast';
    if (isPermissionMode(candidate.mode)) entry.mode = candidate.mode;
    if (entry.model || entry.thinking || entry.speed || entry.mode) {
      out[targetKey] = entry;
    }
  }
  return out;
}

function loadMap(): Record<ConversationTargetKey, ConversationTargetRunDefaults> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    return normalizeTargetRunDefaults(JSON.parse(raw));
  } catch {
    return {};
  }
}

function saveMap(map: Record<ConversationTargetKey, ConversationTargetRunDefaults>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage can be unavailable in previews; target defaults simply do not persist.
  }
}

function hasRunDefault(entry: ConversationTargetRunDefaults): boolean {
  return Boolean(entry.model || entry.thinking || entry.speed || entry.mode);
}

interface ConversationTargetDefaultsStore {
  byTarget: Record<ConversationTargetKey, ConversationTargetRunDefaults>;
  setTargetRunDefault: (
    targetKey: ConversationTargetKey,
    update: ConversationTargetRunDefaultUpdate,
  ) => void;
}

export const useConversationTargetDefaultsStore = create<ConversationTargetDefaultsStore>(
  (set) => ({
    byTarget: loadMap(),
    setTargetRunDefault: (targetKey, update) =>
      set((state) => {
        const previous = state.byTarget[targetKey];
        const nextEntry: ConversationTargetRunDefaults = { ...previous };
        if (update.value === undefined || update.value === '') {
          delete nextEntry[update.axis];
        } else if (update.axis === 'model') {
          nextEntry.model = update.value.trim();
        } else if (update.axis === 'thinking') {
          nextEntry.thinking = update.value;
        } else if (update.axis === 'speed') {
          nextEntry.speed = update.value;
        } else {
          nextEntry.mode = update.value;
        }

        if (!previous && !hasRunDefault(nextEntry)) return state;
        const next = { ...state.byTarget };
        if (hasRunDefault(nextEntry)) next[targetKey] = nextEntry;
        else delete next[targetKey];
        saveMap(next);
        return { byTarget: next };
      }),
  }),
);
