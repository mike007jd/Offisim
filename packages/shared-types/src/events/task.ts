import type { TaskState } from '../states.js';

export interface TaskStatePayload {
  readonly taskRunId: string;
  readonly prev: TaskState;
  readonly next: TaskState;
  readonly employeeId?: string;
  readonly assigneeId?: string;
  readonly assigneeName?: string;
  readonly assigneeKind?: 'employee';
}

export interface TaskAssignmentPayload {
  readonly taskRunId: string;
  readonly employeeId?: string;
  readonly assigneeId: string;
  readonly assigneeName?: string;
  readonly assigneeKind?: 'employee';
  readonly action: 'assigned' | 'unassigned';
}

export interface TaskAssignmentDispatchedPayload {
  readonly employeeId?: string;
  readonly employeeName: string;
  readonly assigneeId: string;
  readonly assigneeName: string;
  readonly assigneeKind?: 'employee';
  readonly stepLabel: string;
  readonly stepIndex: number;
  readonly totalSteps: number;
}

export interface TaskSubtaskProgressPayload {
  readonly employeeId?: string;
  readonly assigneeId: string;
  readonly assigneeName?: string;
  readonly assigneeKind?: 'employee';
  readonly stepIndex: number;
  readonly label: string;
  readonly status: 'queued' | 'running' | 'done' | 'failed';
  readonly totalSteps: number;
  readonly completedSteps: number;
}

/**
 * Reasons a runtime node may override an LLM/planner-chosen task assignment.
 *
 * - `requires-local-tools`: routing gate filtered out an external A2A pick
 *   for a task that needs Offisim-local file/shell tooling.
 * - `employee-not-found`: pm-planner sanitize swapped a missing employee.
 * - `employee-disabled`: pm-planner sanitize swapped a disabled employee.
 * - `no-recommendation-fallback`: pm-planner sanitize fell back to the first
 *   valid employee because the plan provided no `recommendedEmployees`
 *   ordering — surfaces the silent ordering dependency.
 */
export type TaskAssignmentRerouteReason =
  | 'requires-local-tools'
  | 'employee-not-found'
  | 'employee-disabled'
  | 'no-recommendation-fallback';

/** Which routing layer made the rerouting decision. */
export type TaskAssignmentRerouteSource = 'manager' | 'pm-planner';

/** Canonical event type literal — use everywhere instead of the bare string. */
export const TASK_ASSIGNMENT_REROUTED = 'task.assignment.rerouted' as const;

export interface TaskAssignmentReroutedPayload {
  readonly taskRunId: string;
  readonly requestedEmployeeId: string;
  readonly resolvedEmployeeId: string;
  readonly reason: TaskAssignmentRerouteReason;
  readonly source: TaskAssignmentRerouteSource;
}
