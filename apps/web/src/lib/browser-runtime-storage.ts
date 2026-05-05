import type { createMemoryRepositories } from '@offisim/core/browser';
import { mapDeliverablePayloadToRow } from '@offisim/core/browser';
import type { InMemoryEventBus } from '@offisim/core/browser';
import type { MemoryRepositoriesSnapshot } from '@offisim/core/browser';
import type { DeliverableCreatedPayload, RuntimeEvent } from '@offisim/shared-types';
import { putDeliverableContent } from './deliverable-content-idb';

const STORAGE_KEY = 'offisim:browser-runtime-snapshot:v1';
const EVENT_HISTORY_KEY = 'offisim:browser-event-history:v1';
const SAVE_DEBOUNCE_MS = 300;
const SAVE_INTERVAL_MS = 5000;
const MAX_EVENT_HISTORY = 200;
const EVENT_PREFIXES = [
  'graph.node.',
  'meeting.',
  'plan.',
  'task.',
  'deliverable.',
  'employee.',
  'boss.',
  'install.',
  'execution.',
  'workspace-binding.',
  'chat.attachment.',
] as const;

type MemoryRepos = ReturnType<typeof createMemoryRepositories>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface BrowserRuntimeBootstrapState {
  reposSnapshot: MemoryRepositoriesSnapshot | null;
  eventHistory: RuntimeEvent[];
}

function isBrowserStorageAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function loadBrowserRuntimeSnapshot(
  storage: StorageLike = window.localStorage,
): MemoryRepositoriesSnapshot | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as MemoryRepositoriesSnapshot;
  } catch {
    return null;
  }
}

export function saveBrowserRuntimeSnapshot(
  repos: MemoryRepos,
  storage: StorageLike = window.localStorage,
): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(repos.snapshot()));
}

export function clearBrowserRuntimeSnapshot(storage: StorageLike = window.localStorage): void {
  storage.removeItem(STORAGE_KEY);
}

export function loadBrowserEventHistory(
  storage: StorageLike = window.localStorage,
): RuntimeEvent[] {
  try {
    const raw = storage.getItem(EVENT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RuntimeEvent[]) : [];
  } catch {
    return [];
  }
}

export function saveBrowserEventHistory(
  events: RuntimeEvent[],
  storage: StorageLike = window.localStorage,
): void {
  storage.setItem(EVENT_HISTORY_KEY, JSON.stringify(events.slice(-MAX_EVENT_HISTORY)));
}

export function loadBrowserRuntimeBootstrapState(
  storage: StorageLike = window.localStorage,
): BrowserRuntimeBootstrapState {
  return {
    reposSnapshot: loadBrowserRuntimeSnapshot(storage),
    eventHistory: loadBrowserEventHistory(storage),
  };
}

interface MaybeLegacyDeliverableRow {
  deliverable_id?: string;
  content?: string;
}

/**
 * Harvests inline `content` bytes left over from the pre-IDB snapshot shape.
 * Returns `{id, content}` pairs so the caller can fire-and-forget write them
 * into IDB. Safe to call on every boot — returns `[]` once legacy rows are
 * gone (next snapshot flush rewrites the store to summary-only).
 */
export function extractLegacyDeliverableContent(
  snapshot: { deliverables?: readonly unknown[] } | null | undefined,
): Array<{ id: string; content: string }> {
  const rows = snapshot?.deliverables;
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const out: Array<{ id: string; content: string }> = [];
  for (const raw of rows) {
    const row = raw as MaybeLegacyDeliverableRow;
    if (typeof row.deliverable_id !== 'string') continue;
    if (typeof row.content !== 'string' || row.content.length === 0) continue;
    out.push({ id: row.deliverable_id, content: row.content });
  }
  return out;
}

export interface DeliverableContentBridgeOptions {
  readonly eventBus: InMemoryEventBus;
  readonly dbPromise: Promise<IDBDatabase | null>;
}

export function createDeliverableContentBridge({
  eventBus,
  dbPromise,
}: DeliverableContentBridgeOptions): { dispose(): void } {
  const unsubscribe = eventBus.on(
    'deliverable.created',
    (event: RuntimeEvent<DeliverableCreatedPayload>) => {
      const row = mapDeliverablePayloadToRow(event);
      void dbPromise.then((db) => {
        if (!db) return;
        return putDeliverableContent(db, row.deliverable_id, row.content).catch((err) => {
          console.error(`[deliverable-content-idb] failed to write ${row.deliverable_id}`, err);
        });
      });
    },
  );
  return {
    dispose() {
      unsubscribe();
    },
  };
}

export function createBrowserRuntimePersistence(
  repos: MemoryRepos,
  eventBus: InMemoryEventBus,
): {
  flush(): void;
  dispose(): void;
} {
  if (!isBrowserStorageAvailable()) {
    return {
      flush() {},
      dispose() {},
    };
  }

  let saveTimer: number | null = null;
  let eventHistory = loadBrowserEventHistory();

  const flush = () => {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveBrowserRuntimeSnapshot(repos);
    saveBrowserEventHistory(eventHistory);
  };

  const scheduleFlush = () => {
    if (saveTimer !== null) return;
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      flush();
    }, SAVE_DEBOUNCE_MS);
  };

  const unsub = eventBus.on('', () => {
    scheduleFlush();
  });
  const eventUnsubs = EVENT_PREFIXES.map((prefix) =>
    eventBus.on(prefix, (event: RuntimeEvent) => {
      eventHistory = [...eventHistory, event].slice(-MAX_EVENT_HISTORY);
      scheduleFlush();
    }),
  );

  const handlePageHide = () => {
    flush();
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      flush();
    }
  };

  window.addEventListener('pagehide', handlePageHide);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  const intervalId = window.setInterval(flush, SAVE_INTERVAL_MS);

  flush();

  return {
    flush,
    dispose() {
      unsub();
      for (const off of eventUnsubs) off();
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(intervalId);
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
      flush();
    },
  };
}
