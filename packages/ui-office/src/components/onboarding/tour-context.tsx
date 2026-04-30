import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { TourSlot } from './tour-steps.js';

interface TourContextValue {
  targets: Map<TourSlot, HTMLElement>;
  register: (
    slot: TourSlot,
    element: HTMLElement | null,
    previousElement: HTMLElement | null,
  ) => void;
}

const TourContext = createContext<TourContextValue | null>(null);

function mapsEqual(a: Map<TourSlot, HTMLElement>, b: Map<TourSlot, HTMLElement>): boolean {
  if (a.size !== b.size) return false;
  for (const [slot, element] of a) {
    if (b.get(slot) !== element) return false;
  }
  return true;
}

export function OnboardingTourProvider({ children }: { children: ReactNode }) {
  const [targets, setTargets] = useState(() => new Map<TourSlot, HTMLElement>());
  const registryRef = useRef(new Map<TourSlot, Set<HTMLElement>>());
  const flushQueuedRef = useRef(false);

  const flushTargets = useCallback(() => {
    flushQueuedRef.current = false;
    const next = new Map<TourSlot, HTMLElement>();
    for (const [slot, elements] of registryRef.current) {
      const connected = Array.from(elements).filter((candidate) => candidate.isConnected);
      if (connected.length === 0) {
        registryRef.current.delete(slot);
        continue;
      }
      registryRef.current.set(slot, new Set(connected));
      const first = connected[0];
      if (first) next.set(slot, first);
    }
    setTargets((prev) => (mapsEqual(prev, next) ? prev : next));
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushQueuedRef.current) return;
    flushQueuedRef.current = true;
    queueMicrotask(flushTargets);
  }, [flushTargets]);

  const register = useCallback(
    (slot: TourSlot, element: HTMLElement | null, previousElement: HTMLElement | null) => {
      let elements = registryRef.current.get(slot);
      if (!elements) {
        elements = new Set<HTMLElement>();
        registryRef.current.set(slot, elements);
      }
      if (previousElement && previousElement !== element) {
        elements.delete(previousElement);
      }
      if (element) {
        elements.add(element);
      }

      if (elements.size === 0) {
        registryRef.current.delete(slot);
      }
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const value = useMemo(() => ({ targets, register }), [targets, register]);
  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTourTarget(slot: TourSlot): (el: HTMLElement | null) => void {
  const ctx = useContext(TourContext);
  const register = ctx?.register;
  const lastElementRef = useRef<HTMLElement | null>(null);

  return useCallback(
    (el: HTMLElement | null) => {
      const previousElement = lastElementRef.current;
      if (previousElement === el) return;
      lastElementRef.current = el;
      register?.(slot, el, previousElement);
    },
    [register, slot],
  );
}

export function useTourTargetElement(slot: TourSlot): HTMLElement | null {
  const ctx = useContext(TourContext);
  return ctx?.targets.get(slot) ?? null;
}
