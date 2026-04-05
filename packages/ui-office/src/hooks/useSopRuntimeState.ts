import type {
  PlanCompletedPayload,
  PlanCreatedPayload,
  PlanStepCompletedPayload,
  PlanStepStartedPayload,
  RuntimeEvent,
} from '@offisim/shared-types';
import { useEffect, useRef, useState } from 'react';
import { useOffisimRuntime, useOffisimRuntimeStatus } from '../runtime/offisim-runtime-context';

export interface SopRuntimeStepState {
  stepIndex: number;
  status: 'pending' | 'active' | 'completed' | 'failed';
}

/**
 * Maps EventBus plan lifecycle events to per-step status.
 * When `sopTemplateId` is provided, only activates for plans originating from that SOP.
 * Returns null when no matching plan is active.
 */
export function useSopRuntimeState(sopTemplateId?: string): SopRuntimeStepState[] | null {
  const { eventBus } = useOffisimRuntime();
  const { isRunning } = useOffisimRuntimeStatus();
  const [steps, setSteps] = useState<SopRuntimeStepState[] | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Track which planId belongs to us so step/complete events can match. */
  const activePlanIdRef = useRef<string | null>(null);

  // Auto-clear 3s after runtime stops (aligned with usePipelineStage pattern)
  useEffect(() => {
    if (!isRunning) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setSteps(null);
        activePlanIdRef.current = null;
      }, 3000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isRunning]);

  useEffect(() => {
    const offs: Array<() => void> = [];

    offs.push(
      eventBus.on('plan.created', (e: RuntimeEvent<PlanCreatedPayload>) => {
        // If filtering by SOP and this plan doesn't match, ignore
        if (sopTemplateId && e.payload.sopTemplateId !== sopTemplateId) {
          // A different SOP's plan — clear our state if we were active
          if (activePlanIdRef.current) {
            activePlanIdRef.current = null;
            setSteps(null);
          }
          return;
        }

        if (timerRef.current) clearTimeout(timerRef.current);
        activePlanIdRef.current = e.payload.planId;
        setSteps(
          e.payload.steps.map((s) => ({
            stepIndex: s.stepIndex,
            status: 'pending' as const,
          })),
        );
      }),
    );

    offs.push(
      eventBus.on('plan.step.started', (e: RuntimeEvent<PlanStepStartedPayload>) => {
        if (sopTemplateId && activePlanIdRef.current !== e.payload.planId) return;
        setSteps(
          (prev) =>
            prev?.map((s) =>
              s.stepIndex === e.payload.stepIndex ? { ...s, status: 'active' as const } : s,
            ) ?? null,
        );
      }),
    );

    offs.push(
      eventBus.on('plan.step.completed', (e: RuntimeEvent<PlanStepCompletedPayload>) => {
        if (sopTemplateId && activePlanIdRef.current !== e.payload.planId) return;
        setSteps(
          (prev) =>
            prev?.map((s) =>
              s.stepIndex === e.payload.stepIndex ? { ...s, status: 'completed' as const } : s,
            ) ?? null,
        );
      }),
    );

    offs.push(
      eventBus.on('plan.completed', (e: RuntimeEvent<PlanCompletedPayload>) => {
        if (sopTemplateId && activePlanIdRef.current !== e.payload.planId) return;
        setSteps((prev) => prev?.map((s) => ({ ...s, status: 'completed' as const })) ?? null);
      }),
    );

    return () => {
      for (const off of offs) off();
    };
  }, [eventBus, sopTemplateId]);

  return steps;
}
