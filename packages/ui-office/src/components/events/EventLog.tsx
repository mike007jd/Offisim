import type { EventBus } from '@offisim/core/browser';
import type { RuntimeEvent } from '@offisim/shared-types';
import { ScrollArea } from '@offisim/ui-core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
import { EventFilters } from './EventFilters';
import type { EventFilterState, EventFilterType } from './EventFilters';
import { EventItem } from './EventItem';

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

/** Map a filter type label to the topic prefix(es) it covers */
export const TYPE_PREFIX_MAP: Record<EventFilterType, string[]> = {
  All: [],
  Node: ['graph.node.'],
  Plan: ['plan.'],
  Task: ['task.'],
  Deliverable: ['deliverable.'],
  Employee: ['employee.'],
  Install: ['install.'],
  Skill: ['skill.'],
  LLM: ['llm.'],
  Interaction: ['interaction.'],
  Error: ['error.'],
  MCP: ['mcp.'],
  Knowledge: ['knowledge.'],
  Meeting: ['meeting.', 'direct.chat.'],
  HR: ['hr.'],
  Memory: ['memory.'],
  Infrastructure: ['rack.', 'slot.', 'binding.', 'cost.'],
  Git: ['git.'],
  Attachment: ['chat.attachment.'],
};

/** Determine a display level from event topic only — no payload serialization */
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

type EnrichedEvent = { event: RuntimeEvent; level: EventDisplayLevel; employeeId: string | null };

/** Extract an employeeId from the event payload if present */
function extractEmployeeId(event: RuntimeEvent): string | null {
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload.employeeId === 'string') return payload.employeeId;
  return null;
}

export const LEVEL_ROW_STYLES: Record<EventDisplayLevel, string> = {
  Info: '',
  Warning: 'border-l-2 border-warning bg-warning-muted',
  Error: 'border-l-2 border-error bg-error-muted',
};

export function EventLog() {
  const { eventBus, bootstrapState } = useOffisimRuntime();
  const store = useMemo(
    () => hydrateEventLogStore(eventBus, bootstrapState?.eventHistory ?? []),
    [eventBus, bootstrapState],
  );
  const [events, setEvents] = useState<RuntimeEvent[]>(() => store.events);
  const [filters, setFilters] = useState<EventFilterState>({
    types: ['All'],
    levels: ['Info', 'Warning', 'Error'],
    search: '',
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEvents(store.events);
    const syncEvents = () => setEvents(store.events);
    store.listeners.add(syncEvents);

    return () => {
      store.listeners.delete(syncEvents);
    };
  }, [store]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: events array triggers scroll-to-bottom intentionally
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  /** Filtered events — computed in useMemo to avoid re-render on every new event.
   *  Returns enriched tuples so level and employeeId are computed only once per event. */
  const filteredEvents = useMemo((): EnrichedEvent[] => {
    const { types, levels, search } = filters;
    const selectedType = (types[0] ?? 'All') as EventFilterType;
    const prefixes = TYPE_PREFIX_MAP[selectedType] ?? [];
    const searchLower = search.toLowerCase();

    const result: EnrichedEvent[] = [];
    for (const event of events) {
      // Type filter
      if (prefixes.length > 0 && !prefixes.some((p) => event.type.startsWith(p))) {
        continue;
      }

      // Level filter — computed once here, reused in render
      const level = getEventLevel(event);
      if (!levels.includes(level)) continue;

      // Search filter — type string only, no payload serialization
      if (searchLower && !event.type.toLowerCase().includes(searchLower)) {
        continue;
      }

      result.push({ event, level, employeeId: extractEmployeeId(event) });
    }
    return result;
  }, [events, filters]);

  const handleEmployeeClick = useCallback(
    (employeeId: string) => {
      eventBus.emit({
        type: 'ui.employee.focused',
        entityId: employeeId,
        entityType: 'employee',
        companyId: '',
        timestamp: Date.now(),
        payload: { employeeId },
      });
    },
    [eventBus],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface-elevated text-text-primary">
      <h2 className="p-3 pb-1 text-[8px] uppercase tracking-wider text-text-secondary">
        Event Log
      </h2>
      <EventFilters onFilterChange={setFilters} />
      <ScrollArea className="flex-1">
        <div ref={scrollRef}>
          {filteredEvents.length === 0 ? (
            <div className="p-3 text-xs text-text-muted">
              {events.length === 0 ? 'No events yet' : 'No events match filters'}
            </div>
          ) : (
            filteredEvents.map(({ event, level, employeeId }, i) => {
              const rowStyle = LEVEL_ROW_STYLES[level];
              const clickable = employeeId !== null;

              return (
                <div
                  key={`${event.timestamp}-${i}`}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  className={`${rowStyle} ${clickable ? 'cursor-pointer hover:bg-surface-hover' : ''}`}
                  onClick={clickable ? () => handleEmployeeClick(employeeId) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleEmployeeClick(employeeId);
                          }
                        }
                      : undefined
                  }
                >
                  <EventItem event={event} />
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
