import type { TaskState } from '../states.js';

export interface TaskStatePayload {
  readonly taskRunId: string;
  readonly prev: TaskState;
  readonly next: TaskState;
  readonly employeeId?: string;
  readonly assigneeId?: string;
  readonly assigneeName?: string;
  readonly assigneeKind?: 'employee' | 'department';
}

export interface TaskAssignmentPayload {
  readonly taskRunId: string;
  readonly employeeId?: string;
  readonly assigneeId: string;
  readonly assigneeName?: string;
  readonly assigneeKind?: 'employee' | 'department';
  readonly action: 'assigned' | 'unassigned';
}

export interface TaskAssignmentDispatchedPayload {
  readonly employeeId?: string;
  readonly employeeName: string;
  readonly assigneeId: string;
  readonly assigneeName: string;
  readonly assigneeKind?: 'employee' | 'department';
  readonly stepLabel: string;
  readonly stepIndex: number;
  readonly totalSteps: number;
}

export interface TaskSubtaskProgressPayload {
  readonly employeeId?: string;
  readonly assigneeId: string;
  readonly assigneeName?: string;
  readonly assigneeKind?: 'employee' | 'department';
  readonly stepIndex: number;
  readonly label: string;
  readonly status: 'queued' | 'running' | 'done' | 'failed';
  readonly totalSteps: number;
  readonly completedSteps: number;
}
