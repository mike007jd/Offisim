import type {
  PlanCompletedPayload,
  PlanCreatedPayload,
  PlanStepCompletedPayload,
  PlanStepStartedPayload,
  RuntimeEvent,
  TaskAssignmentPayload,
  TaskStatePayload,
} from '@aics/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAicsRuntime } from '../runtime/aics-runtime-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskInfo {
  taskRunId: string;
  employeeId: string | null;
  employeeName: string | null;
  taskType: string;
  description: string;
  status: string;
}

export interface DashboardStep {
  stepIndex: number;
  description: string;
  status: 'pending' | 'active' | 'completed';
  tasks: TaskInfo[];
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
// Internal state (no toggleStep — that's derived)
// ---------------------------------------------------------------------------

interface InternalState {
  planId: string | null;
  summary: string;
  steps: DashboardStep[];
  currentStepIndex: number;
  isComplete: boolean;
}

const INITIAL: InternalState = {
  planId: null,
  summary: '',
  steps: [],
  currentStepIndex: -1,
  isComplete: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcStats(steps: DashboardStep[]) {
  let total = 0;
  let completed = 0;
  let active = 0;
  let failed = 0;
  for (const step of steps) {
    for (const t of step.tasks) {
      total++;
      if (t.status === 'completed') completed++;
      else if (t.status === 'active') active++;
      else if (t.status === 'failed' || t.status === 'cancelled') failed++;
    }
  }
  return { total, completed, active, failed };
}

/**
 * Find step & task index for a given taskRunId. Returns [-1, -1] if not found.
 */
function findTask(steps: DashboardStep[], taskRunId: string): [number, number] {
  for (let si = 0; si < steps.length; si++) {
    const step = steps[si];
    if (!step) continue;
    for (let ti = 0; ti < step.tasks.length; ti++) {
      if (step.tasks[ti]?.taskRunId === taskRunId) return [si, ti];
    }
  }
  return [-1, -1];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTaskDashboard(agents?: Map<string, { name: string }>): TaskDashboardState {
  const { eventBus } = useAicsRuntime();
  const [state, setState] = useState<InternalState>(INITIAL);
  const stateRef = useRef<InternalState>(INITIAL);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  const update = useCallback((fn: (prev: InternalState) => InternalState) => {
    setState((prev) => {
      const next = fn(prev);
      stateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    stateRef.current = INITIAL;
    setState(INITIAL);

    // plan.created — initialize steps with real task data from enriched payload
    const offCreated = eventBus.on('plan.created', (e: RuntimeEvent<PlanCreatedPayload>) => {
      const { planId, summary, steps } = e.payload;
      update(() => ({
        planId,
        summary: summary || `Plan ${planId}`,
        steps: steps.map((s) => ({
          stepIndex: s.stepIndex,
          description: s.description,
          status: 'pending' as const,
          tasks: s.tasks.map((t) => ({
            taskRunId: t.taskRunId,
            employeeId: t.employeeId,
            employeeName: agentsRef.current?.get(t.employeeId)?.name ?? null,
            taskType: t.taskType,
            description: t.description,
            status: 'planned',
          })),
          expanded: false,
        })),
        currentStepIndex: -1,
        isComplete: false,
      }));
    });

    // plan.step.started — mark step active, auto-expand
    const offStepStarted = eventBus.on(
      'plan.step.started',
      (e: RuntimeEvent<PlanStepStartedPayload>) => {
        const { stepIndex } = e.payload;
        update((prev) => ({
          ...prev,
          currentStepIndex: stepIndex,
          steps: prev.steps.map((s) =>
            s.stepIndex === stepIndex ? { ...s, status: 'active' as const, expanded: true } : s,
          ),
        }));
      },
    );

    // plan.step.completed — mark step completed
    const offStepCompleted = eventBus.on(
      'plan.step.completed',
      (e: RuntimeEvent<PlanStepCompletedPayload>) => {
        const { stepIndex } = e.payload;
        update((prev) => ({
          ...prev,
          steps: prev.steps.map((s) =>
            s.stepIndex === stepIndex ? { ...s, status: 'completed' as const } : s,
          ),
        }));
      },
    );

    // plan.completed
    const offCompleted = eventBus.on('plan.completed', (_e: RuntimeEvent<PlanCompletedPayload>) => {
      update((prev) => ({ ...prev, isComplete: true }));
    });

    // task.state.changed — update or create task in its step
    const offTaskState = eventBus.on('task.state.changed', (e: RuntimeEvent<TaskStatePayload>) => {
      const { taskRunId, next: nextStatus, employeeId } = e.payload;
      update((prev) => {
        const steps = prev.steps.map((s) => ({ ...s, tasks: [...s.tasks] }));
        const [si, ti] = findTask(steps, taskRunId);

        const existingStep = si >= 0 ? steps[si] : undefined;
        const existingTask = existingStep && ti >= 0 ? existingStep.tasks[ti] : undefined;

        if (existingStep && existingTask) {
          // Update existing task
          existingStep.tasks[ti] = {
            ...existingTask,
            status: nextStatus,
            employeeId: employeeId ?? existingTask.employeeId,
          };
        } else {
          // Unknown task — assign to active step (or last step), replacing first placeholder.
          // Fallback chain: currentStepIndex → first 'active' step → last step.
          if (steps.length === 0) return prev; // No plan yet — ignore stray task events
          let targetIdx = prev.currentStepIndex >= 0 ? prev.currentStepIndex : -1;
          if (targetIdx < 0) {
            targetIdx = steps.findIndex((s) => s.status === 'active');
          }
          if (targetIdx < 0) targetIdx = steps.length - 1;
          const targetStep = steps[targetIdx];
          if (targetStep) {
            const placeholderIdx = targetStep.tasks.findIndex((t) =>
              t.taskRunId.startsWith('placeholder-'),
            );
            const newTask: TaskInfo = {
              taskRunId,
              employeeId: employeeId ?? null,
              employeeName: employeeId
                ? (agentsRef.current?.get(employeeId)?.name ?? employeeId)
                : null,
              taskType: nextStatus,
              description: taskRunId,
              status: nextStatus,
            };
            if (placeholderIdx >= 0) {
              targetStep.tasks[placeholderIdx] = newTask;
            } else {
              targetStep.tasks.push(newTask);
            }
          }
        }
        return { ...prev, steps };
      });
    });

    // task.assignment.changed — set employeeId on task
    const offTaskAssign = eventBus.on(
      'task.assignment.changed',
      (e: RuntimeEvent<TaskAssignmentPayload>) => {
        const { taskRunId, employeeId, action } = e.payload;
        update((prev) => {
          const steps = prev.steps.map((s) => ({ ...s, tasks: [...s.tasks] }));
          const [si, ti] = findTask(steps, taskRunId);
          const assignStep = si >= 0 ? steps[si] : undefined;
          const assignTask = assignStep && ti >= 0 ? assignStep.tasks[ti] : undefined;
          if (assignStep && assignTask) {
            const resolvedName =
              action === 'assigned'
                ? (agentsRef.current?.get(employeeId)?.name ?? employeeId)
                : null;
            assignStep.tasks[ti] = {
              ...assignTask,
              employeeId: action === 'assigned' ? employeeId : null,
              employeeName: resolvedName,
            };
          }
          return { ...prev, steps };
        });
      },
    );

    return () => {
      offCreated();
      offStepStarted();
      offStepCompleted();
      offCompleted();
      offTaskState();
      offTaskAssign();
    };
  }, [eventBus, update]);

  const toggleStep = useCallback(
    (stepIndex: number) => {
      update((prev) => ({
        ...prev,
        steps: prev.steps.map((s) =>
          s.stepIndex === stepIndex ? { ...s, expanded: !s.expanded } : s,
        ),
      }));
    },
    [update],
  );

  return {
    planId: state.planId,
    summary: state.summary,
    steps: state.steps,
    currentStepIndex: state.currentStepIndex,
    isComplete: state.isComplete,
    stats: calcStats(state.steps),
    toggleStep,
  };
}
