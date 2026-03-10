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
  | 'employee.installed';

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
  readonly steps: ReadonlyArray<{
    readonly stepIndex: number;
    readonly description: string;
    readonly taskCount: number;
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
