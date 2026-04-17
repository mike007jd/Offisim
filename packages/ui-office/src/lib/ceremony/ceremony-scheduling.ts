import { type MutableRefObject, useCallback, useEffect, useRef } from 'react';
import { type CeremonyState, createIdleCeremonyState } from '../../hooks/useCeremonyState';

export interface CeremonySchedulingDeps {
  ceremonyVersionRef: MutableRefObject<number>;
  setCeremony: React.Dispatch<React.SetStateAction<CeremonyState>>;
  clearAssignedSceneState: () => void;
}

export interface CeremonyScheduling {
  timerRefs: MutableRefObject<Set<ReturnType<typeof setTimeout>>>;
  safeTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearSceneBubbleText: (label: string, delayMs: number) => void;
  scheduleCeremonyReset: (version: number, delayMs: number) => void;
}

export function useCeremonyScheduling({
  ceremonyVersionRef,
  setCeremony,
  clearAssignedSceneState,
}: CeremonySchedulingDeps): CeremonyScheduling {
  const timerRefs = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    return () => {
      timerRefs.current.forEach(clearTimeout);
      timerRefs.current.clear();
    };
  }, []);

  const safeTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timerRefs.current.delete(id);
      fn();
    }, ms);
    timerRefs.current.add(id);
    return id;
  }, []);

  const clearSceneBubbleText = useCallback(
    (label: string, delayMs: number) => {
      safeTimeout(() => {
        setCeremony((prev) => {
          if (prev.bubbleText !== label) return prev;
          return { ...prev, bubbleText: '' };
        });
      }, delayMs);
    },
    [safeTimeout, setCeremony],
  );

  const scheduleCeremonyReset = useCallback(
    (version: number, delayMs: number) => {
      safeTimeout(() => {
        if (ceremonyVersionRef.current !== version) return;
        setCeremony(createIdleCeremonyState());
        clearAssignedSceneState();
      }, delayMs);
    },
    [ceremonyVersionRef, clearAssignedSceneState, safeTimeout, setCeremony],
  );

  return { timerRefs, safeTimeout, clearSceneBubbleText, scheduleCeremonyReset };
}
