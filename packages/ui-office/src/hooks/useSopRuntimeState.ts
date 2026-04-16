import { useEffect, useMemo, useRef, useState } from 'react';
import { useOffisimRuntimeStatus } from '../runtime/offisim-runtime-context';
import { usePlanStepStore } from './plan-step-store';

export interface SopRuntimeStepState {
  stepIndex: number;
  status: 'pending' | 'active' | 'completed' | 'failed';
}

export function useSopRuntimeState(sopTemplateId?: string): SopRuntimeStepState[] | null {
  const store = usePlanStepStore();
  const { isRunning } = useOffisimRuntimeStatus();
  const [cleared, setCleared] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isRunning) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCleared(true), 3000);
    } else {
      setCleared(false);
      if (timerRef.current) clearTimeout(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isRunning]);

  return useMemo(() => {
    if (cleared) return null;
    if (!store.planId) return null;
    if (sopTemplateId && store.sopTemplateId !== sopTemplateId) return null;
    return store.steps.map((s) => ({ stepIndex: s.stepIndex, status: s.status }));
  }, [cleared, store.planId, store.sopTemplateId, store.steps, sopTemplateId]);
}
