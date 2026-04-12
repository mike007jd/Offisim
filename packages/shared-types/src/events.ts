import type { BindingStatus, BindingType } from './install.js';
import type { InteractionMode, InteractionRequest, InteractionResponse } from './interactions.js';
import type { RoleSlug } from './roles.js';
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
  | 'conversation.synopsis.updated'
  | 'conversation.compact.completed'
  | 'employee.state.changed'
  | 'task.state.changed'
  | 'task.assignment.changed'
  | 'meeting.state.changed'
  | 'install.state.changed'
  | 'binding.state.changed'
  | 'report.state.changed'
  | 'runtime.performance.tier.changed'
  | 'ui.selection.changed'
  | 'ui.task.focused'
  | 'ui.scene.task.echo'
  | 'scene.employee.selected'
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
  | 'employee.workstation.drop-requested'
  | 'employee.version.created'
  | 'rack.bound'
  | 'rack.unbound'
  | 'slot.assigned'
  | 'slot.removed'
  | 'cost.aggregated'
  | 'hr.assessment.started'
  | 'hr.assessment.completed'
  | 'hr.recommendation'
  | 'notification.created'
  | 'notification.dismissed'
  | 'knowledge.index.started'
  | 'knowledge.index.completed'
  | 'knowledge.index.failed'
  | 'knowledge.search.started'
  | 'knowledge.search.completed'
  | 'prefab.state.changed'
  | 'cost.session.updated'
  | 'tool.execution.telemetry'
  | 'workspace.staleness.detected'
  | 'execution.resumed'
  | 'execution.aborted'
  | 'interaction.requested'
  | 'interaction.restored'
  | 'interaction.resolved'
  | 'interaction.mode.changed';

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

export interface TaskAssignmentDispatchedPayload {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly stepLabel: string;
  readonly stepIndex: number;
  readonly totalSteps: number;
}

export interface TaskSubtaskProgressPayload {
  readonly employeeId: string;
  readonly stepIndex: number;
  readonly label: string;
  readonly status: 'queued' | 'running' | 'done' | 'failed';
  readonly totalSteps: number;
  readonly completedSteps: number;
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
  readonly nodeName: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
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
  readonly channel?: 'content' | 'reasoning';
}

export interface ConversationSynopsisUpdatedPayload {
  readonly summary: string;
  readonly version: number;
  readonly prunedMessageCount: number;
  readonly totalMessageCount: number;
}

export interface ConversationCompactCompletedPayload {
  readonly compactId: string;
  readonly compactVersion: number;
  readonly compactedNonSystemMessageCount: number;
  readonly keptTailNonSystemMessageCount: number;
  readonly preCompactMessageCount: number;
  readonly preCompactTokenCount: number;
}

export interface WorkspaceStalenessDetectedPayload {
  readonly status: 'warn' | 'block' | 'unavailable';
  readonly reason:
    | 'baseline_matches'
    | 'git_worktree_changed'
    | 'git_head_changed'
    | 'missing_workspace_root'
    | 'missing_baseline'
    | 'not_git_repository'
    | 'capture_failed';
  readonly baselineGitHead: string | null;
  readonly currentGitHead: string | null;
  readonly baselineDirty: boolean | null;
  readonly currentDirty: boolean | null;
  readonly currentStatusLines: number | null;
}

export interface ExecutionResumedPayload {
  readonly threadId: string;
  readonly currentStepIndex: number;
  readonly completedStepCount: number;
  readonly rewoundFromStepIndex: number | null;
  readonly skippedCompletedSteps: boolean;
  readonly updatedPlan: boolean;
}

export interface ExecutionAbortedPayload {
  readonly threadId: string;
  /** 'user' for a user-initiated stop, 'system' for programmatic aborts. */
  readonly reason: 'user' | 'system';
}

export interface InteractionRequestedPayload {
  readonly request: InteractionRequest;
}

export interface InteractionResolvedPayload {
  readonly request: InteractionRequest;
  readonly response: InteractionResponse;
}

export interface InteractionRestoredPayload {
  readonly request: InteractionRequest;
}

export interface InteractionModeChangedPayload {
  readonly previousMode: InteractionMode;
  readonly nextMode: InteractionMode;
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
  /** The SOP template that produced this plan, if any. */
  readonly sopTemplateId?: string;
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
  readonly roleSlug: RoleSlug;
}

export interface EmployeeUpdatedPayload {
  readonly employeeId: string;
  readonly name: string;
  readonly roleSlug: RoleSlug;
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
    readonly roleSlug: RoleSlug;
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
  readonly meetingId: string;
  readonly actionItemId: string;
  readonly description: string;
  readonly assigneeEmployeeId: string;
  readonly priority: 'high' | 'medium' | 'low';
  readonly dependsOn: string[];
}

export interface HandoffInitiatedPayload {
  readonly handoffId: string;
  readonly threadId: string;
  readonly fromEmployeeId: string;
  readonly toEmployeeId: string;
  readonly reason: string;
  readonly taskRunId: string;
}

export interface HandoffCompletedPayload {
  readonly handoffId: string;
  readonly toEmployeeId: string;
  readonly taskRunId: string;
}

export interface MemoryCreatedPayload {
  readonly memoryId: string;
  readonly employeeId: string;
  readonly scope: 'employee' | 'team' | 'company';
  readonly category: 'experience' | 'decision' | 'knowledge' | 'preference';
  readonly contentPreview: string;
}

export interface MemoryAccessedPayload {
  readonly memoryId: string;
  readonly employeeId: string;
  readonly query: string;
}

// --- Runtime Completion: Workstation & Version Events ---

export interface EmployeeWorkstationChangedPayload {
  readonly employeeId: string;
  readonly fromWorkstationId: string | null;
  readonly toWorkstationId: string | null;
}

export interface EmployeeWorkstationDropRequestedPayload {
  readonly employeeId: string;
  readonly targetWorkstationId: string;
}

export interface EmployeeVersionCreatedPayload {
  readonly employeeId: string;
  readonly versionNum: number;
  readonly changeType: 'create' | 'update' | 'rollback';
}

// --- Runtime Completion: Rack/Slot Events ---

export interface RackBoundPayload {
  readonly rackId: string;
  readonly providerType: string;
  readonly label: string;
}

export interface RackUnboundPayload {
  readonly rackId: string;
}

export interface SlotAssignedPayload {
  readonly slotId: string;
  readonly rackId: string;
  readonly capabilityName: string;
  readonly exposureScope: string;
}

export interface SlotRemovedPayload {
  readonly slotId: string;
  readonly rackId: string;
}

// --- Runtime Completion: Cost Aggregation ---

export interface CostAggregatedPayload {
  readonly companyId: string;
  readonly totalCost: number;
  readonly todayCost: number;
  readonly totalCalls: number;
  readonly todayCalls: number;
}

export interface SessionCostBreakdown {
  readonly key: string;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly callCount: number;
  readonly pricedCallCount: number;
  readonly unpricedCallCount: number;
  readonly pricingConfidence: 'exact' | 'catalog' | 'fallback' | 'unknown';
}

export interface SessionCostUpdatedPayload {
  readonly sessionId: string;
  readonly threadId: string;
  readonly totalCostUsd: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalLatencyMs: number;
  readonly totalCalls: number;
  readonly pricedCallCount: number;
  readonly unpricedCallCount: number;
  readonly costConfidence: 'exact' | 'catalog' | 'fallback' | 'unknown';
  readonly byModel: readonly SessionCostBreakdown[];
  readonly byNode: readonly SessionCostBreakdown[];
  readonly byEmployee: readonly SessionCostBreakdown[];
  readonly lastLlmCallId: string;
}

export interface ToolExecutionTelemetryPayload {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly toolType: 'builtin' | 'mcp' | 'workstation';
  readonly threadId: string;
  readonly nodeName?: string;
  readonly employeeId?: string;
  readonly taskRunId?: string | null;
  readonly serverName?: string;
  readonly startedAt: number;
  readonly completedAt?: number;
  readonly durationMs?: number;
  readonly status: 'started' | 'completed' | 'error' | 'denied';
  readonly errorType?: string;
  readonly concurrentWith?: readonly string[];
}

// --- ANIM-015: Task Row ↔ World Echo ---

/** Emitted by TaskDashboard when a task row is clicked — scene reacts. */
export interface UiTaskFocusedPayload {
  readonly employeeId: string;
  readonly taskRunId: string;
}

/** Emitted by SceneManager when an employee is clicked — UI reacts. */
export interface SceneEmployeeSelectedPayload {
  readonly employeeId: string;
  /** Source of the selection — always 'scene' for this event. */
  readonly source: 'scene';
}

// --- HR Agent Events ---

export interface HrAssessmentStartedPayload {
  readonly action: 'hire' | 'assess_team';
  readonly threadId: string;
}

export interface HrAssessmentCompletedPayload {
  readonly action: 'hire' | 'assess_team';
  readonly assessment: string;
  readonly threadId: string;
}

export interface HrRecommendationPayload {
  readonly recommendation: string;
  readonly suggestedRoles: readonly RoleSlug[];
  readonly threadId: string;
}

// --- Notification System ---

export interface NotificationPayload {
  readonly notificationId: string;
  readonly level: 'info' | 'success' | 'warning' | 'error';
  readonly title: string;
  readonly message: string;
  readonly source: 'runtime' | 'market' | 'install' | 'hr';
  readonly actionUrl?: string;
  readonly employeeId?: string;
  readonly dismissable: boolean;
  readonly timestamp: number;
}

export interface NotificationDismissedPayload {
  readonly notificationId: string;
}

// ── Knowledge Events ──────────────────────────────────────────
export interface KnowledgeIndexStartedPayload {
  readonly knowledgeBaseRef: string;
  readonly documentCount: number;
}
export interface KnowledgeIndexCompletedPayload {
  readonly knowledgeBaseRef: string;
  readonly indexedCount: number;
  readonly durationMs: number;
}
export interface KnowledgeIndexFailedPayload {
  readonly knowledgeBaseRef: string;
  readonly error: string;
}
export interface KnowledgeSearchStartedPayload {
  readonly knowledgeBaseRef: string;
  readonly query: string;
  readonly employeeId: string;
}
export interface KnowledgeSearchCompletedPayload {
  readonly knowledgeBaseRef: string;
  readonly resultCount: number;
  readonly employeeId: string;
  readonly durationMs: number;
}

// ── Git Auto-Commit Events ────────────────────────────────────

export interface GitAutoCommittedPayload {
  readonly stepIndex: number;
  readonly fileCount: number;
  readonly commitMessage: string;
}

// ── Prefab Events ──────────────────────────────────────────────
export interface PrefabStateChangedPayload {
  readonly instanceId: string;
  readonly prefabId: string;
  readonly category: string;
  readonly prev: string;
  readonly next: string;
}
