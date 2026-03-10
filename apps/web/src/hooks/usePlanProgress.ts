import type {
  PlanCompletedPayload,
  PlanCreatedPayload,
  PlanStepCompletedPayload,
  PlanStepStartedPayload,
  RuntimeEvent,
} from '@aics/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAicsRuntime } from '../runtime/aics-runtime-context';

export type StepStatus = 'pending' | 'active' | 'completed';

export interface PlanStep {
  stepIndex: number;
  description: string;
  taskCount: number;
  status: StepStatus;
}

export interface PlanProgressState {
  planId: string | null;
  steps: PlanStep[];
  currentStepIndex: number;
  isComplete: boolean;
}

const INITIAL_STATE: PlanProgressState = {
  planId: null,
  steps: [],
  currentStepIndex: -1,
  isComplete: false,
};

/**
 * Subscribes to plan.* events via EventBus and maintains the progress state
 * of the currently active execution plan.
 *
 * Pattern follows the same approach as `use-agent-states` and `use-event-stream`:
 * subscribe on mount, unsub on unmount, track state via useState + refs.
 */
export function usePlanProgress(): PlanProgressState {
  const { eventBus } = useAicsRuntime();
  const [state, setState] = useState<PlanProgressState>(INITIAL_STATE);
  const stateRef = useRef<PlanProgressState>(INITIAL_STATE);

  const updateState = useCallback((updater: (prev: PlanProgressState) => PlanProgressState) => {
    setState((prev) => {
      const next = updater(prev);
      stateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    // Reset on eventBus change (e.g. reinitRuntime)
    stateRef.current = INITIAL_STATE;
    setState(INITIAL_STATE);

    const unsubCreated = eventBus.on('plan.created', (event: RuntimeEvent<PlanCreatedPayload>) => {
      const { planId, steps } = event.payload;
      updateState(() => ({
        planId,
        steps: steps.map((s) => ({
          stepIndex: s.stepIndex,
          description: s.description,
          taskCount: s.taskCount,
          status: 'pending' as StepStatus,
        })),
        currentStepIndex: -1,
        isComplete: false,
      }));
    });

    const unsubStepStarted = eventBus.on(
      'plan.step.started',
      (event: RuntimeEvent<PlanStepStartedPayload>) => {
        const { stepIndex } = event.payload;
        updateState((prev) => ({
          ...prev,
          currentStepIndex: stepIndex,
          steps: prev.steps.map((s) =>
            s.stepIndex === stepIndex ? { ...s, status: 'active' as StepStatus } : s,
          ),
        }));
      },
    );

    const unsubStepCompleted = eventBus.on(
      'plan.step.completed',
      (event: RuntimeEvent<PlanStepCompletedPayload>) => {
        const { stepIndex } = event.payload;
        updateState((prev) => ({
          ...prev,
          steps: prev.steps.map((s) =>
            s.stepIndex === stepIndex ? { ...s, status: 'completed' as StepStatus } : s,
          ),
        }));
      },
    );

    const unsubCompleted = eventBus.on(
      'plan.completed',
      (_event: RuntimeEvent<PlanCompletedPayload>) => {
        updateState((prev) => ({
          ...prev,
          isComplete: true,
        }));
      },
    );

    return () => {
      unsubCreated();
      unsubStepStarted();
      unsubStepCompleted();
      unsubCompleted();
    };
  }, [eventBus, updateState]);

  return state;
}
