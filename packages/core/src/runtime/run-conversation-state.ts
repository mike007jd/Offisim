import type { LlmMessage, LlmUsage, ToolCallResult } from '../llm/gateway.js';
import type { RegisteredTool } from '../tools/tool-registry.js';
import type { RecentToolResult } from './completion-verifier.js';

export interface RunConversationStateSnapshot {
  readonly runId: string | null;
  readonly threadId: string | null;
  readonly messages: readonly LlmMessage[];
  readonly pendingToolCalls: readonly ToolCallResult[];
  readonly toolResults: readonly RunToolResultRecord[];
  readonly permissionDenials: readonly RunPermissionDenialRecord[];
  readonly discoveredToolSnapshot: RunDiscoveredToolSnapshot | null;
  readonly activeContext: RunActiveContextSnapshot | null;
  readonly usage: LlmUsage;
  readonly budget: RunBudgetSnapshot;
  readonly retry: RunRetrySnapshot;
  readonly cancellation: RunCancellationSnapshot;
  readonly checkpointIdentity: RunCheckpointIdentity | null;
}

export interface RunToolResultRecord extends RecentToolResult {
  readonly toolCallId: string;
}

export interface RunPermissionDenialRecord {
  readonly toolName: string;
  readonly reason: string;
}

export interface RunDiscoveredToolSnapshot {
  readonly allToolNames: readonly string[];
  readonly allowedRuntimeToolNames: readonly string[];
  readonly allowedMcpToolNames: readonly string[];
  readonly toolRegistry: readonly RunDiscoveredToolRecord[];
}

export type RunDiscoveredToolRecord = Pick<
  RegisteredTool,
  'name' | 'surface' | 'serverName' | 'permissionIdentity' | 'exposedToLlm'
>;

export interface RunActiveContextSnapshot {
  readonly companyId: string;
  readonly threadId: string;
  readonly projectId: string | null;
  readonly chatThreadId: string | null;
  readonly employeeId?: string;
  readonly taskRunId?: string;
  readonly runScopeThreadId?: string;
}

export interface RunBudgetSnapshot {
  readonly maxToolRounds: number | null;
  readonly roundsUsed: number;
  readonly maxContextMessages: number | null;
}

export interface RunRetrySnapshot {
  readonly attempts: number;
  readonly lastError: string | null;
}

export interface RunCancellationSnapshot {
  readonly requested: boolean;
  readonly reason: string | null;
}

export interface RunCheckpointIdentity {
  readonly graphThreadId: string;
  readonly taskRunId?: string;
  readonly runScopeThreadId?: string;
}

const EMPTY_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0 };

export class RunConversationState {
  private snapshot: RunConversationStateSnapshot = emptySnapshot();

  beginRun(params: {
    readonly runId: string;
    readonly threadId: string;
    readonly checkpointIdentity?: RunCheckpointIdentity | null;
  }): void {
    this.snapshot = {
      ...emptySnapshot(),
      runId: params.runId,
      threadId: params.threadId,
      checkpointIdentity: params.checkpointIdentity ?? null,
    };
  }

  recordMessages(messages: readonly LlmMessage[]): void {
    this.snapshot = { ...this.snapshot, messages: [...messages] };
  }

  recordPendingToolCalls(toolCalls: readonly ToolCallResult[]): void {
    this.snapshot = { ...this.snapshot, pendingToolCalls: [...toolCalls] };
  }

  recordToolResults(results: readonly RunToolResultRecord[]): void {
    this.snapshot = { ...this.snapshot, toolResults: [...this.snapshot.toolResults, ...results] };
  }

  recordPermissionDenial(denial: RunPermissionDenialRecord): void {
    this.snapshot = {
      ...this.snapshot,
      permissionDenials: [...this.snapshot.permissionDenials, denial],
    };
  }

  recordDiscoveredTools(snapshot: RunDiscoveredToolSnapshot): void {
    this.snapshot = { ...this.snapshot, discoveredToolSnapshot: snapshot };
  }

  recordActiveContext(snapshot: RunActiveContextSnapshot): void {
    this.snapshot = { ...this.snapshot, activeContext: snapshot };
  }

  recordUsage(usage: LlmUsage | undefined): void {
    if (!usage) return;
    this.snapshot = {
      ...this.snapshot,
      usage: {
        inputTokens: this.snapshot.usage.inputTokens + usage.inputTokens,
        outputTokens: this.snapshot.usage.outputTokens + usage.outputTokens,
      },
    };
  }

  recordBudget(budget: Partial<RunBudgetSnapshot>): void {
    this.snapshot = { ...this.snapshot, budget: { ...this.snapshot.budget, ...budget } };
  }

  recordRetry(error: string): void {
    this.snapshot = {
      ...this.snapshot,
      retry: {
        attempts: this.snapshot.retry.attempts + 1,
        lastError: error,
      },
    };
  }

  recordCancellation(reason: string | null = null): void {
    this.snapshot = {
      ...this.snapshot,
      cancellation: { requested: true, reason },
    };
  }

  toJSON(): RunConversationStateSnapshot {
    return {
      ...this.snapshot,
      messages: [...this.snapshot.messages],
      pendingToolCalls: [...this.snapshot.pendingToolCalls],
      toolResults: [...this.snapshot.toolResults],
      permissionDenials: [...this.snapshot.permissionDenials],
    };
  }
}

function emptySnapshot(): RunConversationStateSnapshot {
  return {
    runId: null,
    threadId: null,
    messages: [],
    pendingToolCalls: [],
    toolResults: [],
    permissionDenials: [],
    discoveredToolSnapshot: null,
    activeContext: null,
    usage: { ...EMPTY_USAGE },
    budget: {
      maxToolRounds: null,
      roundsUsed: 0,
      maxContextMessages: null,
    },
    retry: {
      attempts: 0,
      lastError: null,
    },
    cancellation: {
      requested: false,
      reason: null,
    },
    checkpointIdentity: null,
  };
}
