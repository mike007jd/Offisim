import type {
  BindingStatus,
  BindingStatePayload,
  BindingType,
  EmployeeState,
  EmployeeStatePayload,
  GraphNodeEnteredPayload,
  GraphNodeExitedPayload,
  InstallState,
  InstallStatePayload,
  LlmCallCompletedPayload,
  LlmCallStartedPayload,
  LlmStreamChunkPayload,
  LlmUsageRecordedPayload,
  McpServerConnectedPayload,
  McpToolCalledPayload,
  MeetingState,
  MeetingStatePayload,
  PlanCompletedPayload,
  PlanCreatedPayload,
  PlanStepCompletedPayload,
  PlanStepStartedPayload,
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

// --- Phase 6: Install Pipeline ---

export function installStateChanged(
  companyId: string,
  installTxnId: string,
  prev: InstallState,
  next: InstallState,
  threadId?: string,
  packageId?: string,
  errorCode?: string,
): RuntimeEvent<InstallStatePayload> {
  return {
    type: 'install.state.changed',
    entityId: installTxnId,
    entityType: 'install',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { installTxnId, prev, next, packageId, errorCode },
  };
}

export function bindingStateChanged(
  companyId: string,
  bindingId: string,
  installTxnId: string,
  bindingType: BindingType,
  bindingKey: string,
  prev: BindingStatus,
  next: BindingStatus,
  threadId?: string,
): RuntimeEvent<BindingStatePayload> {
  return {
    type: 'binding.state.changed',
    entityId: bindingId,
    entityType: 'install',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { bindingId, installTxnId, bindingType, bindingKey, prev, next },
  };
}

// --- Mega-Phase A: Plan & MCP Events ---

export function planCreated(
  companyId: string,
  planId: string,
  threadId: string,
  steps: PlanCreatedPayload['steps'],
): RuntimeEvent<PlanCreatedPayload> {
  return {
    type: 'plan.created',
    entityId: planId,
    entityType: 'plan',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { planId, threadId, steps },
  };
}

export function planStepStarted(
  companyId: string,
  planId: string,
  stepIndex: number,
  taskCount: number,
  threadId?: string,
): RuntimeEvent<PlanStepStartedPayload> {
  return {
    type: 'plan.step.started',
    entityId: planId,
    entityType: 'plan',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { planId, stepIndex, taskCount },
  };
}

export function planStepCompleted(
  companyId: string,
  planId: string,
  stepIndex: number,
  outputCount: number,
  threadId?: string,
): RuntimeEvent<PlanStepCompletedPayload> {
  return {
    type: 'plan.step.completed',
    entityId: planId,
    entityType: 'plan',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { planId, stepIndex, outputCount },
  };
}

export function planCompleted(
  companyId: string,
  planId: string,
  totalSteps: number,
  threadId?: string,
): RuntimeEvent<PlanCompletedPayload> {
  return {
    type: 'plan.completed',
    entityId: planId,
    entityType: 'plan',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { planId, totalSteps },
  };
}

export function mcpServerConnected(
  companyId: string,
  serverName: string,
  toolCount: number,
): RuntimeEvent<McpServerConnectedPayload> {
  return {
    type: 'mcp.server.connected',
    entityId: serverName,
    entityType: 'mcp',
    companyId,
    timestamp: Date.now(),
    payload: { serverName, toolCount },
  };
}

export function mcpToolCalled(
  companyId: string,
  serverName: string,
  toolName: string,
  employeeId: string,
  threadId?: string,
): RuntimeEvent<McpToolCalledPayload> {
  return {
    type: 'mcp.tool.called',
    entityId: `${serverName}/${toolName}`,
    entityType: 'mcp',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { serverName, toolName, employeeId },
  };
}
