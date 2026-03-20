import { ScrollArea } from '@aics/ui-core';
import type { RuntimeEvent } from '@aics/shared-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';
import { EventFilters } from './EventFilters';
import type { EventFilterState } from './EventFilters';
import { EventItem } from './EventItem';

const EVENT_PREFIXES = ['graph.node.', 'plan.', 'task.', 'deliverable.', 'employee.', 'install.'] as const;
const MAX_EVENTS = 200;

/** Map a filter type label to the topic prefix(es) it covers */
const TYPE_PREFIX_MAP: Record<string, string[]> = {
  All: [],
  Node: ['graph.node.'],
  Plan: ['plan.'],
  Task: ['task.'],
  Deliverable: ['deliverable.'],
  Employee: ['employee.'],
  Install: ['install.'],
};

/** Determine a display level from event topic only — no payload serialization */
export type EventDisplayLevel = 'Info' | 'Warning' | 'Error';

export function getEventLevel(event: RuntimeEvent): EventDisplayLevel {
  const topic = event.type.toLowerCase();
  if (
    topic.includes('failed') ||
    topic.includes('error') ||
    topic.includes('rolled_back')
  ) {
    return 'Error';
  }
  if (
    topic.includes('blocked') ||
    topic.includes('warning') ||
    topic.includes('rejected')
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

const LEVEL_ROW_STYLES: Record<EventDisplayLevel, string> = {
  Info: '',
  Warning: 'border-l-2 border-amber-400 bg-amber-400/5',
  Error: 'border-l-2 border-red-400 bg-red-400/5',
};

export function EventLog() {
  const { eventBus } = useAicsRuntime();
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [filters, setFilters] = useState<EventFilterState>({
    types: ['All'],
    levels: ['Info', 'Warning', 'Error'],
    search: '',
  });
  const bufferRef = useRef<RuntimeEvent[]>([]);
  const rafRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    if (bufferRef.current.length === 0) return;
    const batch = bufferRef.current;
    bufferRef.current = [];
    setEvents((prev) => [...prev, ...batch].slice(-MAX_EVENTS));
  }, []);

  useEffect(() => {
    bufferRef.current = [];
    setEvents([]);

    const unsubs = EVENT_PREFIXES.map((prefix) =>
      eventBus.on(prefix, (event: RuntimeEvent) => {
        bufferRef.current.push(event);
        if (rafRef.current === null) {
          rafRef.current = requestAnimationFrame(flush);
        }
      }),
    );

    return () => {
      for (const unsub of unsubs) unsub();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [eventBus, flush]);

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
    const selectedType = types[0] ?? 'All';
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
    <div className="flex flex-col h-full overflow-hidden">
      <h2 className="text-[8px] uppercase tracking-wider text-slate-400 p-3 pb-1">
        Event Log
      </h2>
      <EventFilters onFilterChange={setFilters} />
      <ScrollArea className="flex-1">
        <div ref={scrollRef}>
          {filteredEvents.length === 0 ? (
            <div className="p-3 text-xs text-slate-500">
              {events.length === 0 ? 'No events yet' : 'No events match filters'}
            </div>
          ) : (
            filteredEvents.map(({ event, level, employeeId }, i) => {
              const rowStyle = LEVEL_ROW_STYLES[level];
              const clickable = employeeId !== null;

              return (
                <div
                  key={`${event.timestamp}-${i}`}
                  className={`${rowStyle} ${clickable ? 'cursor-pointer hover:bg-blue-500/5' : ''}`}
                  onClick={clickable ? () => handleEmployeeClick(employeeId) : undefined}
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
