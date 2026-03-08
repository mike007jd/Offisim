import type {
  EmployeeState,
  EmployeeStatePayload,
  GraphNodeEnteredPayload,
  GraphNodeExitedPayload,
  LlmCallCompletedPayload,
  LlmCallStartedPayload,
  LlmStreamChunkPayload,
  LlmUsageRecordedPayload,
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

export function llmCallStarted(
  companyId: string,
  llmCallId: string,
  nodeName: string,
  provider: string,
  model: string,
  threadId: string,
): RuntimeEvent<LlmCallStartedPayload> {
  return {
    type: 'llm.call.started',
    entityId: llmCallId,
    entityType: 'llm',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { llmCallId, nodeName, provider, model, threadId },
  };
}

export function llmCallCompleted(
  companyId: string,
  llmCallId: string,
  nodeName: string,
  latencyMs: number,
  inputTokens: number,
  outputTokens: number,
): RuntimeEvent<LlmCallCompletedPayload> {
  return {
    type: 'llm.call.completed',
    entityId: llmCallId,
    entityType: 'llm',
    companyId,
    timestamp: Date.now(),
    payload: { llmCallId, nodeName, latencyMs, inputTokens, outputTokens },
  };
}

export function llmUsageRecorded(
  companyId: string,
  llmCallId: string,
  threadId: string,
  taskRunId: string | null,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): RuntimeEvent<LlmUsageRecordedPayload> {
  return {
    type: 'llm.usage.recorded',
    entityId: llmCallId,
    entityType: 'llm',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { llmCallId, threadId, taskRunId, provider, model, inputTokens, outputTokens },
  };
}

// --- Phase 2.3: Graph Streaming Pipeline ---

export function graphNodeEntered(
  companyId: string,
  threadId: string,
  nodeName: string,
): RuntimeEvent<GraphNodeEnteredPayload> {
  return {
    type: 'graph.node.entered',
    entityId: nodeName,
    entityType: 'graph',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { nodeName },
  };
}

export function graphNodeExited(
  companyId: string,
  threadId: string,
  nodeName: string,
): RuntimeEvent<GraphNodeExitedPayload> {
  return {
    type: 'graph.node.exited',
    entityId: nodeName,
    entityType: 'graph',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { nodeName },
  };
}

export function llmStreamChunk(
  companyId: string,
  threadId: string,
  nodeName: string,
  content: string,
): RuntimeEvent<LlmStreamChunkPayload> {
  return {
    type: 'llm.stream.chunk',
    entityId: nodeName,
    entityType: 'llm',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { nodeName, content },
  };
}
