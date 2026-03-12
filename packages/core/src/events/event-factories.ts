import type {
  BindingStatePayload,
  BindingStatus,
  BindingType,
  DeliverableCreatedPayload,
  DirectChatCompletedPayload,
  DirectChatStartedPayload,
  EmployeeCreatedPayload,
  EmployeeDeletedPayload,
  EmployeeInstalledPayload,
  EmployeeState,
  EmployeeStatePayload,
  EmployeeUpdatedPayload,
  ErrorOccurredPayload,
  GraphNodeEnteredPayload,
  GraphNodeExitedPayload,
  HandoffCompletedPayload,
  HandoffInitiatedPayload,
  InstallState,
  InstallStatePayload,
  LlmCallCompletedPayload,
  LlmCallStartedPayload,
  LlmStreamChunkPayload,
  LlmUsageRecordedPayload,
  McpServerConnectedPayload,
  McpToolCalledPayload,
  McpToolResultPayload,
  MeetingActionCreatedPayload,
  MeetingState,
  MeetingStatePayload,
  MemoryAccessedPayload,
  MemoryCreatedPayload,
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

export function mcpToolResult(
  companyId: string,
  serverName: string,
  toolName: string,
  employeeId: string,
  toolCallId: string,
  success: boolean,
  latencyMs: number,
  error?: string,
): RuntimeEvent<McpToolResultPayload> {
  return {
    type: 'mcp.tool.result',
    entityId: `${serverName}/${toolName}`,
    entityType: 'mcp',
    companyId,
    timestamp: Date.now(),
    payload: { serverName, toolName, employeeId, toolCallId, success, latencyMs, error },
  };
}

// --- Install: Employee Created ---

// --- Employee CRUD Events ---

export function employeeCreated(
  companyId: string,
  employeeId: string,
  name: string,
  roleSlug: string,
): RuntimeEvent<EmployeeCreatedPayload> {
  return {
    type: 'employee.created',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    timestamp: Date.now(),
    payload: { employeeId, name, roleSlug },
  };
}

export function employeeUpdated(
  companyId: string,
  employeeId: string,
  name: string,
  roleSlug: string,
): RuntimeEvent<EmployeeUpdatedPayload> {
  return {
    type: 'employee.updated',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    timestamp: Date.now(),
    payload: { employeeId, name, roleSlug },
  };
}

export function employeeDeleted(
  companyId: string,
  employeeId: string,
): RuntimeEvent<EmployeeDeletedPayload> {
  return {
    type: 'employee.deleted',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    timestamp: Date.now(),
    payload: { employeeId },
  };
}

// --- P1: Error, Deliverable, Direct Chat Events ---

export function errorOccurred(
  companyId: string,
  errorCode: string,
  message: string,
  recoverable: boolean,
  nodeName: string,
  opts?: {
    employeeId?: string;
    taskRunId?: string;
    provider?: string;
    model?: string;
    threadId?: string;
  },
): RuntimeEvent<ErrorOccurredPayload> {
  return {
    type: 'error.occurred',
    entityId: opts?.employeeId ?? nodeName,
    entityType: 'employee',
    companyId,
    threadId: opts?.threadId,
    timestamp: Date.now(),
    payload: {
      errorCode,
      message,
      recoverable,
      nodeName,
      employeeId: opts?.employeeId,
      taskRunId: opts?.taskRunId,
      provider: opts?.provider,
      model: opts?.model,
    },
  };
}

export function deliverableCreated(
  companyId: string,
  deliverableId: string,
  threadId: string,
  title: string,
  content: string,
  contributingEmployees: DeliverableCreatedPayload['contributingEmployees'],
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
      contributingEmployees,
      createdAt: now,
    },
  };
}

export function directChatStarted(
  companyId: string,
  employeeId: string,
  employeeName: string,
  threadId: string,
): RuntimeEvent<DirectChatStartedPayload> {
  return {
    type: 'direct.chat.started',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { employeeId, employeeName, threadId },
  };
}

export function directChatCompleted(
  companyId: string,
  employeeId: string,
  employeeName: string,
  threadId: string,
): RuntimeEvent<DirectChatCompletedPayload> {
  return {
    type: 'direct.chat.completed',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { employeeId, employeeName, threadId },
  };
}

export function employeeInstalled(
  companyId: string,
  employeeId: string,
  name: string,
  installTxnId: string,
  packageId: string,
): RuntimeEvent<EmployeeInstalledPayload> {
  return {
    type: 'employee.installed',
    entityId: employeeId,
    entityType: 'employee',
    companyId,
    timestamp: Date.now(),
    payload: { employeeId, name, installTxnId, packageId },
  };
}

// --- P2: Meeting Action, Handoff, Memory Events ---

export function meetingActionCreated(
  companyId: string,
  meetingId: string,
  actionItemId: string,
  description: string,
  assigneeEmployeeId: string,
  priority: MeetingActionCreatedPayload['priority'],
  dependsOn: string[],
): RuntimeEvent<MeetingActionCreatedPayload> {
  return {
    type: 'meeting.action.created',
    entityId: actionItemId,
    entityType: 'task',
    companyId,
    timestamp: Date.now(),
    payload: { meetingId, actionItemId, description, assigneeEmployeeId, priority, dependsOn },
  };
}

export function handoffInitiated(
  companyId: string,
  handoffId: string,
  threadId: string,
  fromEmployeeId: string,
  toEmployeeId: string,
  reason: string,
  taskRunId: string,
): RuntimeEvent<HandoffInitiatedPayload> {
  return {
    type: 'handoff.initiated',
    entityId: handoffId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { handoffId, threadId, fromEmployeeId, toEmployeeId, reason, taskRunId },
  };
}

export function handoffCompleted(
  companyId: string,
  handoffId: string,
  toEmployeeId: string,
  taskRunId: string,
  threadId: string,
): RuntimeEvent<HandoffCompletedPayload> {
  return {
    type: 'handoff.completed',
    entityId: handoffId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { handoffId, toEmployeeId, taskRunId },
  };
}

export function memoryCreated(
  companyId: string,
  memoryId: string,
  employeeId: string,
  scope: MemoryCreatedPayload['scope'],
  category: MemoryCreatedPayload['category'],
  contentPreview: string,
  threadId: string,
): RuntimeEvent<MemoryCreatedPayload> {
  return {
    type: 'memory.created',
    entityId: memoryId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { memoryId, employeeId, scope, category, contentPreview },
  };
}

export function memoryAccessed(
  companyId: string,
  memoryId: string,
  employeeId: string,
  query: string,
  threadId: string,
): RuntimeEvent<MemoryAccessedPayload> {
  return {
    type: 'memory.accessed',
    entityId: memoryId,
    entityType: 'employee',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload: { memoryId, employeeId, query },
  };
}
