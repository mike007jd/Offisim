/**
 * Live office dramaturgy store (Phase 4).
 *
 * Subscribes to the neutral `agent.run` event family on the runtime bus, keeps a
 * short rolling per-company window of timestamped AgentRunEvents, and composes
 * them into the deterministic beat timeline. The office scene consumes the beats
 * via {@link useOfficeBeats} and projects them onto its real prefab layout
 * (`projectOfficeStaging`) to direct performance + high-value relocation.
 *
 * The model never authors any of this — it is pure derivation from the same
 * facts the run tree is built from.
 */
import { runtimeEventBus } from '@/runtime/repos.js';
import {
  type AgentRunEvent,
  DRAMATURGY_VERSION,
  type SceneBeat,
  type TimedAgentRunEvent,
  composeBeats,
} from '@offisim/shared-types';
import { useMemo, useSyncExternalStore } from 'react';

const MAX_EVENTS_PER_COMPANY = 400;
const MAX_AGE_MS = 120_000;
const EMPTY_BEATS: readonly SceneBeat[] = Object.freeze([]);

const buffers = new Map<string, TimedAgentRunEvent[]>();
const listeners = new Set<() => void>();
let version = 0;

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

// Singleton subscription for the app lifetime — the office scene mounts/unmounts
// but the rolling window should survive a surface switch.
runtimeEventBus.on('agent.run', (event) => {
  const payload = event.payload as AgentRunEvent | undefined;
  if (!payload?.runId || !event.companyId) return;
  const now = event.timestamp;
  const timed: TimedAgentRunEvent = { ...payload, timestamp: now };
  const prior = buffers.get(event.companyId) ?? [];
  const next = [...prior, timed]
    .filter((e) => now - e.timestamp <= MAX_AGE_MS)
    .slice(-MAX_EVENTS_PER_COMPANY);
  buffers.set(event.companyId, next);
  notify();
});

const officeDramaturgyStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getVersion(): number {
    return version;
  },
  beatsForCompany(companyId: string): readonly SceneBeat[] {
    const events = buffers.get(companyId);
    if (!events || events.length === 0) return EMPTY_BEATS;
    return composeBeats(events, { dramaturgyVersion: DRAMATURGY_VERSION });
  },
};

/** Tracks the OS "reduce motion" accessibility setting (suppresses relocation). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false,
  );
}

/** Live beat timeline for the active company's office (empty when idle). */
export function useOfficeBeats(companyId: string | null): readonly SceneBeat[] {
  const version = useSyncExternalStore(
    officeDramaturgyStore.subscribe,
    officeDramaturgyStore.getVersion,
    officeDramaturgyStore.getVersion,
  );
  return useMemo(
    () => (companyId ? officeDramaturgyStore.beatsForCompany(companyId) : EMPTY_BEATS),
    [companyId, version],
  );
}
