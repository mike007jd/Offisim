import type {
  PlanCompletedPayload,
  PlanCreatedPayload,
  PlanStepCompletedPayload,
  PlanStepStartedPayload,
  RuntimeEvent,
  TaskAssignmentPayload,
  TaskStatePayload,
} from '@offisim/shared-types';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useOffisimRuntimeServices } from '../runtime/offisim-runtime-context';
import { useAgentStates } from '../runtime/use-agent-states';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskInfo {
  taskRunId: string;
  employeeId: string | null;
  employeeName: string | null;
  assigneeKind?: 'employee';
  assigneeName?: string | null;
  taskType: string;
  description: string;
  status: string;
}

export interface PlanStep {
  stepIndex: number;
  description: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  tasks: TaskInfo[];
}

export interface PlanStepState {
  planId: string | null;
  summary: string;
  sopTemplateId: string | null;
  steps: PlanStep[];
  currentStepIndex: number;
  isComplete: boolean;
  stats: { total: number; completed: number; active: number; failed: number };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcStats(steps: PlanStep[]) {
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

function findTask(steps: PlanStep[], taskRunId: string): [number, number] {
  for (let si = 0; si < steps.length; si++) {
    const step = steps[si];
    if (!step) continue;
    for (let ti = 0; ti < step.tasks.length; ti++) {
      if (step.tasks[ti]?.taskRunId === taskRunId) return [si, ti];
    }
  }
  return [-1, -1];
}

const NON_TERMINAL_TASK_STATES = new Set(['planned', 'queued', 'running']);
const TERMINAL_FAILURE_TASK_STATES = new Set(['failed', 'cancelled']);

/**
 * Derive a step's status from its task statuses.
 *
 * A step rolls up to 'failed' ONLY when (a) it is not 'active',
 * (b) at least one task is in a terminal-failure state, (c) no task is
 * in a non-terminal state, and (d) no task has reached 'completed'.
 *
 * 'completed' steps are owned by `plan.step.completed`; once a step has
 * reached 'completed' the rollup MUST NOT regress it to 'failed' even if
 * some of its tasks ended in cancel/fail (mixed-terminal completion).
 */
function rollupStepStatus(step: PlanStep): PlanStep['status'] {
  if (step.status === 'active' || step.status === 'completed') return step.status;
  let hasTerminalFailure = false;
  for (const task of step.tasks) {
    if (NON_TERMINAL_TASK_STATES.has(task.status)) return 'pending';
    if (task.status === 'completed') return 'pending';
    if (TERMINAL_FAILURE_TASK_STATES.has(task.status)) hasTerminalFailure = true;
  }
  return hasTerminalFailure ? 'failed' : step.status;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface InternalState {
  planId: string | null;
  summary: string;
  sopTemplateId: string | null;
  steps: PlanStep[];
  currentStepIndex: number;
  isComplete: boolean;
}

const INITIAL: InternalState = {
  planId: null,
  summary: '',
  sopTemplateId: null,
  steps: [],
  currentStepIndex: -1,
  isComplete: false,
};

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const PlanStepStoreContext = createContext<PlanStepState | null>(null);

export function usePlanStepStore(): PlanStepState {
  const ctx = useContext(PlanStepStoreContext);
  if (!ctx) throw new Error('usePlanStepStore must be used within <PlanStepStoreProvider>');
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function PlanStepStoreProvider({ children }: { children: ReactNode }) {
  const { eventBus } = useOffisimRuntimeServices();
  const agents = useAgentStates();
  const [state, setState] = useState<InternalState>(INITIAL);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  const update = useCallback((fn: (prev: InternalState) => InternalState) => {
    setState((prev) => fn(prev));
  }, []);

  useEffect(() => {
    setState(INITIAL);

    const offCreated = eventBus.on('plan.created', (e: RuntimeEvent<PlanCreatedPayload>) => {
      const { planId, summary, steps, sopTemplateId } = e.payload;
      update(() => ({
        planId,
        summary: summary || `Plan ${planId}`,
        sopTemplateId: sopTemplateId ?? null,
        steps: steps.map((s) => ({
          stepIndex: s.stepIndex,
          description: s.description,
          status: 'pending' as const,
          tasks: s.tasks.map((t) => ({
            taskRunId: t.taskRunId,
            employeeId: t.employeeId ?? null,
            employeeName: t.employeeId
              ? (agentsRef.current?.get(t.employeeId)?.name ?? null)
              : null,
            assigneeKind: t.assigneeKind,
            assigneeName:
              t.assigneeName ??
              (t.employeeId ? (agentsRef.current?.get(t.employeeId)?.name ?? null) : null),
            taskType: t.taskType,
            description: t.description,
            status: 'planned',
          })),
        })),
        currentStepIndex: -1,
        isComplete: false,
      }));
    });

    const offStepStarted = eventBus.on(
      'plan.step.started',
      (e: RuntimeEvent<PlanStepStartedPayload>) => {
        const { stepIndex } = e.payload;
        update((prev) => ({
          ...prev,
          currentStepIndex: stepIndex,
          steps: prev.steps.map((s) =>
            s.stepIndex === stepIndex ? { ...s, status: 'active' as const } : s,
          ),
        }));
      },
    );

    const offStepCompleted = eventBus.on(
      'plan.step.completed',
      (e: RuntimeEvent<PlanStepCompletedPayload>) => {
        const { stepIndex } = e.payload;
        update((prev) => ({
          ...prev,
          steps: prev.steps.map((s) => {
            if (s.stepIndex !== stepIndex) return s;
            const completed: PlanStep = { ...s, status: 'completed' };
            // Per-spec: completion of a non-failed step short-circuits the
            // rollup; a step that completed with mixed terminal outcomes
            // does NOT regress to 'failed'. `rollupStepStatus` honors this
            // because it returns the existing status when it is 'completed'.
            return { ...completed, status: rollupStepStatus(completed) };
          }),
        }));
      },
    );

    const offCompleted = eventBus.on('plan.completed', (_e: RuntimeEvent<PlanCompletedPayload>) => {
      update((prev) => ({ ...prev, isComplete: true }));
    });

    const offTaskState = eventBus.on('task.state.changed', (e: RuntimeEvent<TaskStatePayload>) => {
      const { taskRunId, next: nextStatus, employeeId } = e.payload;
      const nextAssigneeName =
        e.payload.assigneeName ??
        (employeeId ? (agentsRef.current?.get(employeeId)?.name ?? employeeId) : null);
      update((prev) => {
        const steps = prev.steps.map((s) => ({ ...s, tasks: [...s.tasks] }));
        const [si, ti] = findTask(steps, taskRunId);

        const existingStep = si >= 0 ? steps[si] : undefined;
        const existingTask = existingStep && ti >= 0 ? existingStep.tasks[ti] : undefined;
        let touchedStepIndex = si;

        if (existingStep && existingTask) {
          const nextEmployeeId = employeeId ?? existingTask.employeeId;
          existingStep.tasks[ti] = {
            ...existingTask,
            status: nextStatus,
            employeeId: nextEmployeeId,
            employeeName: nextEmployeeId
              ? (agentsRef.current?.get(nextEmployeeId)?.name ?? existingTask.employeeName)
              : existingTask.employeeName,
            assigneeKind: e.payload.assigneeKind ?? existingTask.assigneeKind,
            assigneeName: nextAssigneeName ?? existingTask.assigneeName,
          };
        } else {
          if (steps.length === 0) return prev;
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
              assigneeKind: e.payload.assigneeKind,
              assigneeName: nextAssigneeName,
              taskType: nextStatus,
              description: taskRunId,
              status: nextStatus,
            };
            if (placeholderIdx >= 0) {
              targetStep.tasks[placeholderIdx] = newTask;
            } else {
              targetStep.tasks.push(newTask);
            }
            touchedStepIndex = targetIdx;
          }
        }

        // Roll the touched step's status up from its task statuses.
        // Single subscriber rule: this runs inside the existing handler; no
        // new event subscription is opened.
        if (touchedStepIndex >= 0) {
          const touched = steps[touchedStepIndex];
          if (touched) {
            const next = rollupStepStatus(touched);
            if (next !== touched.status) {
              steps[touchedStepIndex] = { ...touched, status: next };
            }
          }
        }
        return { ...prev, steps };
      });
    });

    const offTaskAssign = eventBus.on(
      'task.assignment.changed',
      (e: RuntimeEvent<TaskAssignmentPayload>) => {
        const { taskRunId, employeeId, assigneeName, assigneeKind, action } = e.payload;
        update((prev) => {
          const steps = prev.steps.map((s) => ({ ...s, tasks: [...s.tasks] }));
          const [si, ti] = findTask(steps, taskRunId);
          const assignStep = si >= 0 ? steps[si] : undefined;
          const assignTask = assignStep && ti >= 0 ? assignStep.tasks[ti] : undefined;
          if (assignStep && assignTask) {
            const resolvedName =
              action === 'assigned'
                ? (assigneeName ??
                  (employeeId ? (agentsRef.current?.get(employeeId)?.name ?? employeeId) : null))
                : assignTask.assigneeName;
            assignStep.tasks[ti] = {
              ...assignTask,
              employeeId:
                action === 'assigned'
                  ? (employeeId ?? assignTask.employeeId)
                  : assignTask.employeeId,
              employeeName:
                action === 'assigned' && employeeId
                  ? (agentsRef.current?.get(employeeId)?.name ?? resolvedName ?? null)
                  : (assignTask.employeeName ?? null),
              assigneeKind: action === 'assigned' ? assigneeKind : assignTask.assigneeKind,
              assigneeName: resolvedName ?? null,
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

  const value: PlanStepState = {
    planId: state.planId,
    summary: state.summary,
    sopTemplateId: state.sopTemplateId,
    steps: state.steps,
    currentStepIndex: state.currentStepIndex,
    isComplete: state.isComplete,
    stats: calcStats(state.steps),
  };

  return <PlanStepStoreContext.Provider value={value}>{children}</PlanStepStoreContext.Provider>;
}
