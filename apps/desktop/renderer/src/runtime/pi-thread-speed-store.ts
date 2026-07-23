import type { RuntimeSpeedMode } from '@offisim/shared-types';
import { create } from 'zustand';

const STORAGE_KEY = 'offisim:pi-agent:thread-speed';

function isRuntimeSpeedMode(value: unknown): value is RuntimeSpeedMode {
  return value === 'standard' || value === 'fast';
}

function loadMap(): Record<string, RuntimeSpeedMode> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, RuntimeSpeedMode> = {};
    for (const [threadId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isRuntimeSpeedMode(value)) out[threadId] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function saveMap(map: Record<string, RuntimeSpeedMode>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage can be unavailable in previews; the selection simply does not persist.
  }
}

interface PiThreadSpeedStore {
  byThread: Record<string, RuntimeSpeedMode>;
  setThreadSpeed: (threadId: string, speedMode: RuntimeSpeedMode) => void;
  clearThreadSpeed: (threadId: string) => void;
}

export const usePiThreadSpeedStore = create<PiThreadSpeedStore>((set) => ({
  byThread: loadMap(),
  setThreadSpeed: (threadId, speedMode) =>
    set((state) => {
      const next = { ...state.byThread, [threadId]: speedMode };
      saveMap(next);
      return { byThread: next };
    }),
  clearThreadSpeed: (threadId) =>
    set((state) => {
      if (!(threadId in state.byThread)) return state;
      const next = { ...state.byThread };
      delete next[threadId];
      saveMap(next);
      return { byThread: next };
    }),
}));

export function resolveThreadSpeedOverride(threadId: string): RuntimeSpeedMode | undefined {
  return usePiThreadSpeedStore.getState().byThread[threadId];
}

export function clearThreadSpeed(threadId: string): void {
  usePiThreadSpeedStore.getState().clearThreadSpeed(threadId);
}
