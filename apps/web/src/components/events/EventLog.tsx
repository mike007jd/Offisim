import { useEffect, useRef } from 'react';
import { useEventStream } from '../../runtime/use-event-stream';
import { ScrollArea } from '../ui/scroll-area';
import { EventItem } from './EventItem';

export function EventLog() {
  const events = useEventStream('graph.node.');
  const scrollRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: events array triggers scroll-to-bottom intentionally
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted p-3 pb-1">
        Event Log
      </h2>
      <ScrollArea className="flex-1">
        <div ref={scrollRef}>
          {events.length === 0 ? (
            <div className="p-3 text-xs text-text-muted">No events yet</div>
          ) : (
            events.map((event, i) => <EventItem key={`${event.timestamp}-${i}`} event={event} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
