import { useEffect, useRef, useState } from 'react';
import type { RuntimeEvent } from '@aics/shared-types';
import { useAicsRuntime } from './aics-runtime-context';

const DEFAULT_MAX = 200;

export function useEventStream(pattern: string, maxEvents = DEFAULT_MAX): RuntimeEvent[] {
  const { eventBus } = useAicsRuntime();
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const eventsRef = useRef<RuntimeEvent[]>([]);

  useEffect(() => {
    eventsRef.current = [];
    setEvents([]);

    const unsub = eventBus.on(pattern, (event: RuntimeEvent) => {
      eventsRef.current = [...eventsRef.current.slice(-(maxEvents - 1)), event];
      setEvents(eventsRef.current);
    });

    return unsub;
  }, [eventBus, pattern, maxEvents]);

  return events;
}
