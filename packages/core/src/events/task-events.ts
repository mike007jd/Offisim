/**
 * Task-related event factories.
 * Extracted from event-factories.ts for domain-scoped modularity.
 */
import type {
  DeliverableCreatedPayload,
  RuntimeEvent,
  TaskAssignmentDispatchedPayload,
  TaskAssignmentPayload,
  TaskState,
  TaskStatePayload,
  TaskSubtaskProgressPayload,
} from '@offisim/shared-types';

export function taskStateChanged(
  companyId: string,
  taskRunId: string,
  prev: TaskState,
  next: TaskState,
  threadId?: string,
  employeeId?: string,
): RuntimeEvent<TaskStatePayload> {
  return {
    type: 'task.state.changed',
    entityId: taskRunId,
    entityType: 'task',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { taskRunId, prev, next, employeeId },
  };
}

export function taskAssignmentChanged(
  companyId: string,
  taskRunId: string,
  employeeId: string,
  action: 'assigned' | 'unassigned',
  threadId?: string,
): RuntimeEvent<TaskAssignmentPayload> {
  return {
    type: 'task.assignment.changed',
    entityId: taskRunId,
    entityType: 'task',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { taskRunId, employeeId, action },
  };
}

export function taskAssignmentDispatched(
  companyId: string,
  employeeId: string,
  employeeName: string,
  stepLabel: string,
  stepIndex: number,
  totalSteps: number,
  threadId?: string,
): RuntimeEvent<TaskAssignmentDispatchedPayload> {
  return {
    type: 'task.assignment.dispatched',
    entityId: employeeId,
    entityType: 'task',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { employeeId, employeeName, stepLabel, stepIndex, totalSteps },
  };
}

export function taskSubtaskProgress(
  companyId: string,
  employeeId: string,
  stepIndex: number,
  label: string,
  status: 'queued' | 'running' | 'done' | 'failed',
  totalSteps: number,
  completedSteps: number,
  threadId?: string,
): RuntimeEvent<TaskSubtaskProgressPayload> {
  return {
    type: 'task.subtask.progress',
    entityId: employeeId,
    entityType: 'task',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { employeeId, stepIndex, label, status, totalSteps, completedSteps },
  };
}

export function deliverableCreated(
  companyId: string,
  deliverableId: string,
  threadId: string,
  title: string,
  content: string,
  contributingEmployees: DeliverableCreatedPayload['contributingEmployees'],
  options?: {
    kind?: DeliverableCreatedPayload['kind'];
    fileName?: string | null;
    mimeType?: string | null;
  },
): RuntimeEvent<DeliverableCreatedPayload> {
  const now = Date.now();
  return {
    type: 'deliverable.created',
    entityId: deliverableId,
    entityType: 'task',
    companyId,
    threadId,
    timestamp: now,
    payload: {
      deliverableId,
      threadId,
      title,
      content,
      kind: options?.kind,
      fileName: options?.fileName,
      mimeType: options?.mimeType,
      contributingEmployees,
      createdAt: now,
    },
  };
}
