/**
 * Neutral multi-agent delegation contract.
 *
 * `AgentRunEvent` is the agent-agnostic vocabulary for the run tree: who
 * delegated to whom, what each run is doing, and how each run ends. It rides the
 * runtime event bus as a single `agent.run` family event whose payload is this
 * self-describing envelope (consumers switch on `payload.type`). No `pi_agent_*`
 * term crosses into this layer — the Pi host is one possible producer, never the
 * vocabulary.
 *
 * The run tree is rebuilt purely from the scope fields (`runId / parentRunId /
 * rootRunId`), so a child run can be grafted under its parent without any
 * out-of-band ordering. `rootRunId` is the user-turn run (the controller
 * `attemptId`); the root agent keeps its existing event stream and is the tree
 * root. `runId` is minted per child by the supervisor, consistent with
 * `RunScope`'s per-run identity model (see `../run-scope.ts`).
 *
 * See `Docs/DELEGATION_ARCHITECTURE.md` for the full architecture.
 */

/** How a child run relates to its parent. `handoff` is reserved (not v1). */
export type AgentRunRelation = 'delegate' | 'parallel' | 'review' | 'handoff';

/** Terminal + in-flight states a run can be in. */
export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

/** Capability band a delegated run is granted. */
export type AgentRunAccess = 'read' | 'write' | 'review';

export type AgentRunEventType =
  | 'run.started'
  | 'run.delta' // child token stream (content | reasoning)
  | 'tool.started'
  | 'tool.completed' // carries status: completed | failed
  | 'artifact.created'
  | 'approval.requested'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

/** Rolled-up token/cost accounting for a run (and, aggregated, its subtree). */
export interface AgentRunUsage {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
  readonly cacheWrite?: number;
  readonly cost?: number;
  readonly turns?: number;
}

/** Scope fields present on every event — the run tree is rebuilt from these. */
export interface AgentRunScopeFields {
  readonly threadId: string;
  readonly rootRunId: string;
  readonly runId: string;
  readonly parentRunId?: string;
  readonly employeeId?: string;
  readonly relation?: AgentRunRelation;
}

export interface AgentRunStartedPayload {
  readonly objective: string;
  readonly access: AgentRunAccess;
}

export interface AgentRunDeltaPayload {
  readonly channel: 'content' | 'reasoning';
  readonly delta: string;
}

export interface AgentRunToolPayload {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly status: 'started' | 'completed' | 'failed';
  readonly detail?: string;
  readonly durationMs?: number;
}

export interface AgentRunArtifactPayload {
  readonly title: string;
  readonly ref?: string;
}

export interface AgentRunApprovalPayload {
  readonly uiRequestId: string;
  readonly title: string;
  readonly message?: string;
}

export interface AgentRunFinishedPayload {
  readonly status: AgentRunStatus;
  readonly summary?: string;
  readonly usage?: AgentRunUsage;
}

/** Self-describing delegation event. Discriminated by `type`. */
export type AgentRunEvent = AgentRunScopeFields &
  (
    | { readonly type: 'run.started'; readonly payload: AgentRunStartedPayload }
    | { readonly type: 'run.delta'; readonly payload: AgentRunDeltaPayload }
    | { readonly type: 'tool.started' | 'tool.completed'; readonly payload: AgentRunToolPayload }
    | { readonly type: 'artifact.created'; readonly payload: AgentRunArtifactPayload }
    | { readonly type: 'approval.requested'; readonly payload: AgentRunApprovalPayload }
    | {
        readonly type: 'run.completed' | 'run.failed' | 'run.cancelled';
        readonly payload: AgentRunFinishedPayload;
      }
  );

/** Persisted run record — mirrors the `agent_runs` row (1:1 with a run). */
export interface AgentRunRecord extends AgentRunScopeFields {
  readonly companyId: string;
  readonly objective: string;
  readonly access: AgentRunAccess;
  readonly status: AgentRunStatus;
  readonly usage?: AgentRunUsage;
  readonly resultSummary?: string;
  readonly startedAt: string;
  readonly finishedAt?: string;
}

/**
 * Minimal delegation tool input (v1). `single` runs one child and awaits it;
 * `parallel` (Phase 2) fans out. The supervisor holds an async handle per child.
 */
export interface DelegateTaskInput {
  readonly employeeId: string;
  readonly objective: string;
  readonly access: AgentRunAccess;
}

export interface DelegateToolInput {
  readonly tasks: readonly DelegateTaskInput[];
  readonly mode: 'single' | 'parallel';
}
