import { PERMISSION_MODES, type PermissionMode } from '@/runtime/pi-thread-mode-store.js';
import type { ThinkingLevel } from '@/runtime/pi-thread-thinking-store.js';
import { create } from 'zustand';

export type ConversationTargetKey = `employee:${string}` | `team:${string}`;

export interface ConversationTargetRunDefaults {
  model?: string;
  thinking?: ThinkingLevel;
  speed?: 'fast';
  mode?: PermissionMode;
  updatedAt: number;
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
const THINKING_LEVEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

function isTargetKey(value: string): value is ConversationTargetKey {
  return /^(?:employee|team):.+$/u.test(value);
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && THINKING_LEVEL_PATTERN.test(value);
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value);
}

function loadMap(): Record<ConversationTargetKey, ConversationTargetRunDefaults> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<ConversationTargetKey, ConversationTargetRunDefaults> = {};
    for (const [targetKey, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isTargetKey(targetKey) || !value || typeof value !== 'object') continue;
      const candidate = value as Record<string, unknown>;
      if (typeof candidate.updatedAt !== 'number' || !Number.isFinite(candidate.updatedAt)) {
        continue;
      }
      const entry: ConversationTargetRunDefaults = { updatedAt: candidate.updatedAt };
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
    now: number,
  ) => void;
}

export const useConversationTargetDefaultsStore = create<ConversationTargetDefaultsStore>(
  (set) => ({
    byTarget: loadMap(),
    setTargetRunDefault: (targetKey, update, now) =>
      set((state) => {
        const previous = state.byTarget[targetKey];
        const nextEntry: ConversationTargetRunDefaults = {
          ...(previous ?? { updatedAt: now }),
          updatedAt: now,
        };
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
