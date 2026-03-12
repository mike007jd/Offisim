import type { RuntimeEvent } from '@aics/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAicsRuntime } from './aics-runtime-context';

const DEFAULT_MAX = 200;

export function useEventStream(pattern: string, maxEvents = DEFAULT_MAX): RuntimeEvent[] {
  const { eventBus } = useAicsRuntime();
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const bufferRef = useRef<RuntimeEvent[]>([]);
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    if (bufferRef.current.length === 0) return;
    const batch = bufferRef.current;
    bufferRef.current = [];
    setEvents((prev) => [...prev, ...batch].slice(-maxEvents));
  }, [maxEvents]);

  useEffect(() => {
    bufferRef.current = [];
    setEvents([]);

    const unsub = eventBus.on(pattern, (event: RuntimeEvent) => {
      bufferRef.current.push(event);
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    });

    return () => {
      unsub();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [eventBus, pattern, flush]);

  return events;
}
