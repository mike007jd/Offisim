import type { BindingStatus, BindingType } from './install.js';
import type {
  EmployeeState,
  InstallState,
  MeetingState,
  RuntimeEntityType,
  TaskState,
} from './states.js';

/**
 * Cross-package event envelope.
 * Extended in Phase 2.0 with companyId and threadId for multi-company isolation.
 */
export interface RuntimeEvent<P = Readonly<Record<string, unknown>>> {
  readonly type: string;
  readonly entityId: string;
  readonly entityType: RuntimeEntityType;
  readonly companyId: string;
  readonly threadId?: string;
  readonly timestamp: number;
  readonly payload: P;
}

/** Well-known event type prefixes */
export type EventFamily =
  | 'employee.state.changed'
  | 'task.state.changed'
  | 'task.assignment.changed'
  | 'meeting.state.changed'
  | 'install.state.changed'
  | 'binding.state.changed'
  | 'report.state.changed'
  | 'runtime.performance.tier.changed'
  | 'ui.selection.changed'
  | 'ui.scene.task.echo'
  | 'llm.call.started'
  | 'llm.call.completed'
  | 'llm.usage.recorded'
  | 'graph.node.entered'
  | 'graph.node.exited'
  | 'llm.stream.chunk'
  | 'plan.created'
  | 'plan.step.started'
  | 'plan.step.completed'
  | 'plan.completed'
  | 'mcp.server.connected'
  | 'mcp.tool.called'
  | 'mcp.tool.result'
  | 'employee.installed'
  | 'employee.created'
  | 'employee.updated'
  | 'employee.deleted'
  | 'error.occurred'
  | 'deliverable.created'
  | 'direct.chat.started'
  | 'direct.chat.completed'
  | 'meeting.action.created'
  | 'handoff.initiated'
  | 'handoff.completed'
  | 'memory.created'
  | 'memory.accessed'
  | 'employee.workstation.changed'
  | 'employee.version.created';

// --- Typed event payloads ---

export interface EmployeeStatePayload {
  readonly employeeId: string;
  readonly prev: EmployeeState;
  readonly next: EmployeeState;
  readonly taskRunId?: string;
}

export interface TaskStatePayload {
  readonly taskRunId: string;
  readonly prev: TaskState;
  readonly next: TaskState;
  readonly employeeId?: string;
}

export interface TaskAssignmentPayload {
  readonly taskRunId: string;
  readonly employeeId: string;
  readonly action: 'assigned' | 'unassigned';
}

export interface MeetingStatePayload {
  readonly meetingId: string;
  readonly prev: MeetingState;
  readonly next: MeetingState;
  readonly participantIds: readonly string[];
}

export interface LlmCallStartedPayload {
  readonly llmCallId: string;
  readonly nodeName: string;
  readonly provider: string;
  readonly model: string;
  readonly threadId: string;
}

export interface LlmCallCompletedPayload {
  readonly llmCallId: string;
  readonly nodeName: string;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmUsageRecordedPayload {
  readonly llmCallId: string;
  readonly threadId: string;
  readonly taskRunId: string | null;
  readonly provider: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

// --- Phase 2.3: Graph Streaming Pipeline ---

export interface GraphNodeEnteredPayload {
  readonly nodeName: string;
}

export interface GraphNodeExitedPayload {
  readonly nodeName: string;
}

export interface LlmStreamChunkPayload {
  readonly nodeName: string;
  readonly content: string;
}

// --- Phase 6: Install System ---

export interface InstallStatePayload {
  readonly installTxnId: string;
  readonly prev: InstallState;
  readonly next: InstallState;
  readonly packageId?: string;
  readonly errorCode?: string;
}

export interface BindingStatePayload {
  readonly bindingId: string;
  readonly installTxnId: string;
  readonly bindingType: BindingType;
  readonly bindingKey: string;
  readonly prev: BindingStatus;
  readonly next: BindingStatus;
}

// --- Install: Employee Created ---

export interface EmployeeInstalledPayload {
  readonly employeeId: string;
  readonly name: string;
  readonly installTxnId: string;
  readonly packageId: string;
}

// --- Mega-Phase A: Plan & MCP Events ---

export interface PlanCreatedPayload {
  readonly planId: string;
  readonly threadId: string;
  readonly summary: string;
  readonly steps: ReadonlyArray<{
    readonly stepIndex: number;
    readonly description: string;
    readonly taskCount: number;
    readonly tasks: ReadonlyArray<{
      readonly taskRunId: string;
      readonly taskType: string;
      readonly description: string;
      readonly employeeId: string;
    }>;
  }>;
}

export interface PlanStepStartedPayload {
  readonly planId: string;
  readonly stepIndex: number;
  readonly taskCount: number;
}

export interface PlanStepCompletedPayload {
  readonly planId: string;
  readonly stepIndex: number;
  readonly outputCount: number;
}

export interface PlanCompletedPayload {
  readonly planId: string;
  readonly totalSteps: number;
}

export interface McpServerConnectedPayload {
  readonly serverName: string;
  readonly toolCount: number;
}

export interface McpToolCalledPayload {
  readonly serverName: string;
  readonly toolName: string;
  readonly employeeId: string;
}

export interface McpToolResultPayload {
  readonly serverName: string;
  readonly toolName: string;
  readonly employeeId: string;
  readonly toolCallId: string;
  readonly success: boolean;
  readonly latencyMs: number;
  readonly error?: string;
}

// --- Employee CRUD Events ---

export interface EmployeeCreatedPayload {
  readonly employeeId: string;
  readonly name: string;
  readonly roleSlug: string;
}

export interface EmployeeUpdatedPayload {
  readonly employeeId: string;
  readonly name: string;
  readonly roleSlug: string;
}

export interface EmployeeDeletedPayload {
  readonly employeeId: string;
}

// --- P1: Error Events ---

export interface ErrorOccurredPayload {
  readonly errorCode: string;
  readonly message: string;
  readonly recoverable: boolean;
  readonly nodeName: string;
  readonly employeeId?: string;
  readonly taskRunId?: string;
  readonly provider?: string;
  readonly model?: string;
}

// --- P1: Deliverable Events ---

export interface DeliverableCreatedPayload {
  readonly deliverableId: string;
  readonly threadId: string;
  readonly title: string;
  readonly content: string;
  readonly contributingEmployees: ReadonlyArray<{
    readonly employeeId: string;
    readonly employeeName: string;
  }>;
  readonly createdAt: number;
}

// --- P1: Direct Chat Events ---

export interface DirectChatStartedPayload {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly threadId: string;
}

export interface DirectChatCompletedPayload {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly threadId: string;
}

// --- Runtime Experience: Report State ---

export interface ReportStatePayload {
  readonly next: string;
  readonly employeeId?: string;
  readonly threadId?: string;
}

// --- Runtime Experience: UI Selection ---

export interface UiSelectionPayload {
  readonly entityId: string | null;
  readonly entityType: 'employee' | 'meeting' | 'install';
  readonly source: 'scene' | 'panel';
}

// --- P2: Meeting Action, Handoff, Memory Events ---

export interface MeetingActionCreatedPayload {
  meetingId: string;
  actionItemId: string;
  description: string;
  assigneeEmployeeId: string;
  priority: 'high' | 'medium' | 'low';
  dependsOn: string[];
}

export interface HandoffInitiatedPayload {
  handoffId: string;
  threadId: string;
  fromEmployeeId: string;
  toEmployeeId: string;
  reason: string;
  taskRunId: string;
}

export interface HandoffCompletedPayload {
  handoffId: string;
  toEmployeeId: string;
  taskRunId: string;
}

export interface MemoryCreatedPayload {
  memoryId: string;
  employeeId: string;
  scope: 'employee' | 'team' | 'company';
  category: 'experience' | 'decision' | 'knowledge' | 'preference';
  contentPreview: string;
}

export interface MemoryAccessedPayload {
  memoryId: string;
  employeeId: string;
  query: string;
}

// --- Runtime Completion: Workstation & Version Events ---

export interface EmployeeWorkstationChangedPayload {
  readonly employeeId: string;
  readonly fromWorkstationId: string | null;
  readonly toWorkstationId: string | null;
}

export interface EmployeeVersionCreatedPayload {
  readonly employeeId: string;
  readonly versionNum: number;
  readonly changeType: 'create' | 'update' | 'rollback';
}
