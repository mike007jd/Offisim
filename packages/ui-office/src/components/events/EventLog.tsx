import { ScrollArea } from '@aics/ui-core';
import type { RuntimeEvent } from '@aics/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAicsRuntime } from '../../runtime/aics-runtime-context';
import { EventItem } from './EventItem';

const EVENT_PREFIXES = ['graph.node.', 'plan.', 'task.', 'deliverable.'] as const;
const MAX_EVENTS = 200;

export function EventLog() {
  const { eventBus } = useAicsRuntime();
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
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

  return (
    <div className="flex flex-col h-full">
      <h2 className="font-pixel-display text-[8px] uppercase tracking-wider text-shell p-3 pb-1">
        Event Log
      </h2>
      <ScrollArea className="flex-1">
        <div ref={scrollRef}>
          {events.length === 0 ? (
            <div className="p-3 text-xs text-ocean-light">No events yet</div>
          ) : (
            events.map((event, i) => <EventItem key={`${event.timestamp}-${i}`} event={event} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
