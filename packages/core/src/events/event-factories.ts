import type {
  EmployeeState,
  EmployeeStatePayload,
  MeetingState,
  MeetingStatePayload,
  RuntimeEvent,
  TaskAssignmentPayload,
  TaskState,
  TaskStatePayload,
} from '@aics/shared-types';

export function employeeStateChanged(
  companyId: string,
  employeeId: string,
  prev: EmployeeState,
  next: EmployeeState,
  threadId?: string,
  taskRunId?: string,
): RuntimeEvent<EmployeeStatePayload> {
  return {
    type: 'employee.state.changed',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { employeeId, prev, next, taskRunId },
  };
}

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

export function meetingStateChanged(
  companyId: string,
  meetingId: string,
  prev: MeetingState,
  next: MeetingState,
  participantIds: string[],
  threadId?: string,
): RuntimeEvent<MeetingStatePayload> {
  return {
    type: 'meeting.state.changed',
    entityId: meetingId,
    entityType: 'meeting',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { meetingId, prev, next, participantIds },
  };
}
