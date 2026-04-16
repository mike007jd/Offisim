import { useCallback, useMemo, useState } from 'react';
import type { PlanStep } from './plan-step-store';
import { usePlanStepStore } from './plan-step-store';

// ---------------------------------------------------------------------------
// Types (re-export TaskInfo for downstream consumers)
// ---------------------------------------------------------------------------

export type { TaskInfo } from './plan-step-store';

export interface DashboardStep extends PlanStep {
  expanded: boolean;
}

export interface TaskDashboardState {
  planId: string | null;
  summary: string;
  steps: DashboardStep[];
  currentStepIndex: number;
  isComplete: boolean;
  stats: { total: number; completed: number; active: number; failed: number };
  toggleStep(stepIndex: number): void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTaskDashboard(_agents?: Map<string, { name: string }>): TaskDashboardState {
  const store = usePlanStepStore();
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set());

  const toggleStep = useCallback((stepIndex: number) => {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      if (next.has(stepIndex)) next.delete(stepIndex);
      else next.add(stepIndex);
      return next;
    });
  }, []);

  const steps: DashboardStep[] = useMemo(
    () =>
      store.steps.map((s) => ({
        ...s,
        expanded: expandedSet.has(s.stepIndex) || s.status === 'active',
      })),
    [store.steps, expandedSet],
  );

  return {
    planId: store.planId,
    summary: store.summary,
    steps,
    currentStepIndex: store.currentStepIndex,
    isComplete: store.isComplete,
    stats: store.stats,
    toggleStep,
  };
}
