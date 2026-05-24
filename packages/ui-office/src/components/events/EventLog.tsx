import type { EventBus } from '@offisim/core/browser';
import type { RuntimeEvent } from '@offisim/shared-types';

const EVENT_PREFIXES = [
  'graph.node.',
  'plan.',
  'task.',
  'deliverable.',
  'employee.',
  'boss.',
  'install.',
  'skill.',
  'llm.',
  'interaction.',
  'error.',
  'mcp.',
  'knowledge.',
  'meeting.',
  'cost.',
  'hr.',
  'direct.chat.',
  'rack.',
  'slot.',
  'binding.',
  'memory.',
  'git.',
  'execution.',
  'workspace-binding.',
  'chat.attachment.',
] as const;
const MAX_EVENTS = 200;

interface EventHistoryStore {
  events: RuntimeEvent[];
  buffer: RuntimeEvent[];
  listeners: Set<() => void>;
  rafId: number | null;
  initialized: boolean;
  unsubscribes: (() => void)[];
}

const eventHistoryStores = new WeakMap<object, EventHistoryStore>();

function getEventHistoryStore(eventBus: EventBus): EventHistoryStore {
  let store = eventHistoryStores.get(eventBus);
  if (store) return store;

  store = {
    events: [],
    buffer: [],
    listeners: new Set(),
    rafId: null,
    initialized: false,
    unsubscribes: [],
  };
  eventHistoryStores.set(eventBus, store);
  return store;
}

function flushEventHistory(store: EventHistoryStore) {
  store.rafId = null;
  if (store.buffer.length === 0) return;
  const batch = store.buffer;
  store.buffer = [];
  store.events = [...store.events, ...batch].slice(-MAX_EVENTS);
  for (const listener of store.listeners) {
    listener();
  }
}

export function primeEventLogStore(eventBus: EventBus) {
  const store = getEventHistoryStore(eventBus);
  if (store.initialized) return store;

  store.initialized = true;
  for (const prefix of EVENT_PREFIXES) {
    const unsub = eventBus.on(prefix, (event: RuntimeEvent) => {
      store.buffer.push(event);
      if (store.rafId === null) {
        store.rafId = requestAnimationFrame(() => flushEventHistory(store));
      }
    });
    store.unsubscribes.push(unsub);
  }

  return store;
}

export function hydrateEventLogStore(eventBus: EventBus, events: RuntimeEvent[]) {
  const store = primeEventLogStore(eventBus);
  if (store.events.length > 0 || events.length === 0) return store;
  store.events = events.slice(-MAX_EVENTS);
  return store;
}

/** Dispose all EventBus subscriptions held by the store. */
export function disposeEventLogStore(eventBus: EventBus) {
  const store = eventHistoryStores.get(eventBus);
  if (!store) return;
  for (const unsub of store.unsubscribes) {
    unsub();
  }
  store.unsubscribes = [];
  if (store.rafId !== null) {
    cancelAnimationFrame(store.rafId);
    store.rafId = null;
  }
  store.initialized = false;
  eventHistoryStores.delete(eventBus);
}

export type EventDisplayLevel = 'Info' | 'Warning' | 'Error';

export function getEventLevel(event: RuntimeEvent): EventDisplayLevel {
  const topic = event.type.toLowerCase();
  if (topic.includes('failed') || topic.includes('error') || topic.includes('rolled_back')) {
    return 'Error';
  }
  if (
    topic.includes('blocked') ||
    topic.includes('warning') ||
    topic.includes('rejected') ||
    topic.includes('aborted')
  ) {
    return 'Warning';
  }
  return 'Info';
}
