import {
  assertPersistedChatMessageWithRepositories,
  loadPersistedChatMessageWithRepositories,
  persistConversationStreamCheckpointWithRepositories,
} from '@/data/chat-message-events.js';
import {
  type McpScopedTool,
  buildDelegationContext,
  buildMcpScope,
} from '@/data/employee-persona.js';
import {
  type CommandArgs,
  type TaskWorkspaceBindingClaim,
  type TaskWorkspaceBindingProjection,
  invokeCommand,
} from '@/lib/tauri-commands.js';
import { requireProjectWorkspaceForRun } from '@/runtime/require-project-workspace.js';
import { agentRunEvent, llmStreamChunk } from '@offisim/core/browser';
import type { AgentRunRow, RuntimeRepositories } from '@offisim/core/browser';
import {
  type AgentRunEvent,
  type AgentRunUsage,
  type AiExecutionTarget,
  type AiRuntimeStatus,
  type RunFailureKind,
  type RuntimeEngineCapabilityManifest,
  type RuntimeEvent,
  type RuntimeSpeedMode,
  type WorkspaceDiagnosticsUpdatedPayload,
  classifyRunFailure,
} from '@offisim/shared-types';
import { Channel } from '@tauri-apps/api/core';
import { AgentRunPersistence } from './agent-run-persistence.js';
import {
  type ConversationRunProjectionRef,
  buildConversationStreamCheckpoint,
} from './conversation-stream-checkpoint.js';
import {
  type ExecutionPreparationRecord,
  type ExecutionPreparedEvent,
  parsePreparedExecutionIdentity,
  requirePreparedExecutionIdentity,
  requireRootResultProvenance,
} from './execution-preparation.js';
import {
  type TurnExecutionProvenance,
  assertSameExecutionAccount,
  requireTurnExecutionProvenance,
  validateExecutionTarget,
} from './execution-provenance.js';
import {
  MODEL_PASSTHROUGH_ENGINES,
  type ResolvedRuntimeExecutionSelection,
  declaredReasoningEffort,
  isSameExecutionTarget,
  parseRuntimeExecutionSelector,
  resolveRuntimeExecutionSelection,
} from './execution-selection.js';
import {
  type ActiveHostEventContext,
  type BufferedHostEventContext,
  type HostEventStreamState,
  dispatchHostEvent,
} from './host-event-dispatch.js';
import { agentLifecycleEvent } from './host-event-factories.js';
import {
  type NativeAgentCommandTransport,
  createNativeAgentCommandTransport,
} from './native-agent-command-transport.js';
import {
  API_ENGINE_RUNTIME,
  CLAUDE_ENGINE_RUNTIME,
  CODEX_ENGINE_RUNTIME,
  type NativeEngineRuntimeConfig,
} from './native-engine-runtime-config.js';
import {
  apiModelSupportsImageInput,
  attachmentImageDowngradeNotice,
  createWorkspaceStatusEmitter,
  newRequestId,
  piRunScope,
  throwIfRunAborted,
} from './native-runtime-helpers.js';
import {
  NativeStreamIdleTimeoutError,
  NativeStreamProgressWatchdog,
} from './native-stream-progress-watchdog.js';
import type {
  PiAgentHostEvent,
  PiAgentHostResponse,
  WorkspaceUnavailableEvent,
} from './pi-runtime-driver.js';
import {
  describeWorkspaceResumeCompatibility,
  resolveAgentRunProjectId,
} from './recovery/reconcile-interrupted-runs.js';
import {
  type ConversationStreamCheckpoint,
  type PersistedRunContext,
  mergeRunContextPreservingNativeIdentity,
  nonAuthorizingAgentHostError,
  normalizeStreamCursor,
  parseRunContext,
  persistRunContextPatchWithRepositories,
  persistStartedNativeSessionIdentity,
  trustedNativeSessionPrestartCode,
} from './run-context.js';
import {
  AgentTerminalCheckpointError,
  TERMINAL_CHECKPOINT_MAX_RETRIES,
  retryTerminalCheckpointUntilDurable,
  waitForTerminalCheckpointRetry,
} from './terminal-checkpoint.js';
import {
  type DurableThreadExecutionAuthority,
  assertThreadExecutionLane,
  planThreadExecutionSelection,
  resolveAuthoritativeThreadExecutionAuthority,
} from './thread-execution-authority.js';
import { persistThreadRuntimeStatus } from './thread-runtime-status.js';
import {
  acceptWorkspaceBinding,
  acceptWorkspaceUnavailable,
  createWorkspaceBindingGate,
  rejectWorkspaceBinding,
} from './workspace-binding-stream-gate.js';
import {
  bindingMatchesRun,
  isSameWorkspaceBindingClaim,
  isSameWorkspaceUnavailable,
  resolveWorkspaceRequirement,
  validateCompetitiveDraftContext,
  workspaceUnavailableMatchesRun,
} from './workspace-binding.js';

// Re-export the mission-bridge event vocabulary so existing importers of
// desktop-agent-runtime keep working; the canonical definition lives in
// mission/mission-events.ts (tauri-free, harness-importable).
export { MISSION_EVALUATION_SUBMITTED_EVENT } from './mission/mission-events.js';
export type { MissionEvaluationSubmittedPayload } from './mission/mission-events.js';
export type { ConversationRunProjectionRef } from './conversation-stream-checkpoint.js';
export { AgentTerminalCheckpointError } from './terminal-checkpoint.js';
export {
  AGENT_LIFECYCLE_EVENT,
  AGENT_UI_REQUEST_EVENT,
  AGENT_UI_REQUEST_RESOLVED_EVENT,
  type AgentLifecyclePayload,
  type AgentUiRequestPayload,
  type AgentUiRequestResolvedPayload,
} from './host-event-factories.js';
export {
  type ResolvedApiExecutionSelection,
  type ResolvedRuntimeExecutionSelection,
  type RuntimeExecutionSelector,
  isSameExecutionTarget,
  parseRuntimeExecutionSelector,
  resolveApiExecutionSelection,
  resolveRuntimeExecutionSelection,
  serializeRuntimeExecutionSelector,
} from './execution-selection.js';
export {
  nativeSessionPrestartCode,
  nonAuthorizingAgentHostError,
  persistStartedNativeSessionIdentity,
  trustedNativeSessionPrestartCode,
} from './run-context.js';
import { resolveThreadMode } from './pi-thread-mode-store.js';
import { resolveThreadSpeedOverride } from './pi-thread-speed-store.js';
import { resolveThreadThinkingOverride } from './pi-thread-thinking-store.js';
import { getRepos, runtimeEventBus } from './repos.js';

const EMPTY_BROWSER_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const;

const OFFISIM_BROWSER_MCP_TOOLS = [
  {
    name: 'browser_navigate',
    server: 'offisim-browser',
    category: 'browser',
    description:
      "Open an absolute http/https URL in this conversation's private incognito Offisim browser. This changes remote browser state. Poll browser_status until loading is false before reading the page.",
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Absolute http:// or https:// URL to open.',
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    write: true,
  },
  {
    name: 'browser_read_page',
    server: 'offisim-browser',
    category: 'browser',
    description:
      "Read the current page URL, title, and visible body text from this conversation's Offisim browser. Text is capped at 256 KiB and reports whether it was truncated.",
    inputSchema: EMPTY_BROWSER_INPUT_SCHEMA,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    write: false,
  },
  {
    name: 'browser_screenshot',
    server: 'offisim-browser',
    category: 'browser',
    description:
      "Capture the current page as a PNG image from this conversation's Offisim browser. The gateway rejects captures larger than 4 MiB with a clear error.",
    inputSchema: EMPTY_BROWSER_INPUT_SCHEMA,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    write: false,
  },
  {
    name: 'browser_back',
    server: 'offisim-browser',
    category: 'browser',
    description:
      "Go back once in this conversation's Offisim browser history. This changes remote browser state and is unavailable in plan mode.",
    inputSchema: EMPTY_BROWSER_INPUT_SCHEMA,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    write: true,
  },
  {
    name: 'browser_status',
    server: 'offisim-browser',
    category: 'browser',
    description:
      "Return the current URL, loading state, and back/forward availability for this conversation's Offisim browser. Poll until loading is false after navigation.",
    inputSchema: EMPTY_BROWSER_INPUT_SCHEMA,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    write: false,
  },
] as const satisfies readonly McpScopedTool[];

/**
 * Frozen, additive capability profile for the agent runtime request (PR-03).
 * `'work'` (default) is the existing execute path — byte-for-byte unchanged when
 * the field is absent. `'collaboration'` routes to the HOST-ENFORCED no-tools /
 * no-workspace / no-persistence streaming path (daily company chat). `'enhance'`
 * stays its own dedicated one-shot Tauri command (PR-06), not a value here, and
 * `'loop_compile'` is reserved for PR-07. Shaped so future profiles only ADD a
 * branch; the work execute path never reads it.
 */
export type AgentCapabilityProfile = 'work' | 'collaboration';
export type WorkspaceRequirement = 'optional' | 'required';

export interface LiveRunReattachResult {
  /** Runs which must not be classified as interrupted during this bootstrap. */
  protectedRootRunIds: ReadonlySet<string>;
  /** Runs whose host stream was successfully replayed/subscribed or terminally reconciled. */
  handledRootRunIds: ReadonlySet<string>;
  /** Roots whose native host is still running and therefore remain stoppable after reload. */
  liveRootRunIds?: ReadonlySet<string>;
  /** Roots from the probed startup snapshot for which the native host is gone. */
  confirmedMissingRootRunIds: ReadonlySet<string>;
  /** False when at least one host probe failed transiently and bootstrap must retry. */
  complete: boolean;
}

export const LIVE_CONVERSATION_TERMINAL_EVENT = 'conversation.run.terminal';

export interface LiveConversationTerminalPayload {
  runId: string;
  status: 'completed' | 'failed' | 'cancelled';
  text: string;
  reasoning?: string;
  error?: string;
  provenance?: TurnExecutionProvenance;
  failureKind?: RunFailureKind;
}

export interface DirectDelegationInput {
  employeeId: string;
  objective: string;
  access: 'read' | 'write' | 'review';
  workKind?: string;
  originRunId?: string;
  /** Competitive drafts must remain isolated until the user selects a winner. */
  deferIntegration?: boolean;
  resumeLease?: {
    leaseId: string;
    runId: string;
    workspaceRoot: string;
    cwd: string;
    branch: string;
    createdAt: string;
  };
}

/** Engine-neutral identity for one independently reviewable best-of-N attempt. */
export interface CompetitiveDraftContext {
  groupId: string;
  sourceRunId: string;
  /** Durable competitive-attempt row identity (distinct from the root run id). */
  attemptId: string;
  /** One-based position in the durable competitive draft group. */
  attemptIndex: number;
  totalAttempts: number;
}

export interface DesktopAgentRunInput {
  text: string;
  images?: Array<{ data: string; mimeType: string }>;
  threadId: string;
  employeeId: string | null;
  projectId: string | null;
  /** Product engine selected for this Turn. Omitted only before a new task has a binding. */
  engineId?: string;
  /** Exact account/model target frozen before the host may perform paid work. */
  executionTarget?: AiExecutionTarget;
  /** Exact native catalog/preset selector paired with `executionTarget`. */
  runtimeModelRef?: string;
  /**
   * Frozen capability enum (PR-03). Absent / `'work'` = the existing work execute
   * path, unchanged. `'collaboration'` is NOT served through this `execute()` —
   * the collaboration transport (runtime/collaboration) invokes the dedicated
   * `agent_runtime_collaborate` command instead, so a work run can never silently
   * acquire the collaboration profile and vice-versa. Carried on the input type so
   * the wire contract is frozen in one place.
   */
  capabilityProfile?: AgentCapabilityProfile;
  /**
   * Whether this Turn may answer without project-file authority. Plain Office
   * conversation defaults to optional; Missions, direct delegation, and resume
   * are always forced to required by the gateway.
   */
  workspaceRequirement?: WorkspaceRequirement;
  /** Controller-owned run id used to isolate stream/tool/UI events per attempt. */
  runId?: string;
  /** Durable best-of-N scope; the selected employee still owns engine selection. */
  competitiveDraft?: CompetitiveDraftContext;
  /** Durable message-projection identity used to rebuild live UI after renderer reload. */
  conversationProjection?: ConversationRunProjectionRef;
  /**
   * Per-turn Pi registry model id (provider/model). When omitted the runtime
   * falls back to the global Settings override, then to Pi's default. Pi still
   * resolves credentials and the real catalog; this only forwards the id.
   */
  model?: string;
  /**
   * Per-conversation permission mode (`plan` / `ask` / `auto` / `full`). When
   * omitted the runtime resolves the thread's stored mode (default `auto`). The
   * host enforces it as Pi tool gating; this only forwards the string.
   */
  permissionMode?: string;
  /**
   * Per-conversation thinking level / reasoning effort (`off` / `minimal` /
   * `low` / `medium` / `high` / `xhigh`). When omitted the runtime forwards the
   * thread's explicit override if one was set, else nothing — so Pi applies its
   * own default/session level. A generic agent capability — the host clamps it to
   * the model's reasoning capabilities; this only forwards the string.
   */
  thinkingLevel?: string;
  /** Explicit per-thread Codex service tier. Omitted means the engine's standard default. */
  speedMode?: RuntimeSpeedMode;
  /** Explicit recovery from a backend-proven broken native Conversation
   * session. Ordinary turns always stay `tracked`; only the in-thread
   * Start-fresh action may request `fresh`. */
  nativeSessionMode?: 'tracked' | 'fresh';
  /** Exact failed root whose durable prestart code authorizes `fresh`. */
  nativeSessionResetSourceRunId?: string;
  /**
   * Verified Missions scope (MS-005). When the renderer's MissionRunController
   * runs a mission attempt it sets these so the host registers the mission-bridge
   * tools (`submit_for_evaluation` / `query_mission_state`) and the agent's prompt
   * carries the goal/criteria. `missionContextJson` is the minimal context packet
   * the host forwards to the bridge; `missionId` / `attemptId` are carried for
   * symmetry + future Rust-side use. Absent on a plain chat — existing behavior
   * is unchanged when no missionId is present. `runId` IS the attempt's run id
   * (rootRunId), which is how the runtime correlates the agent's
   * submit_for_evaluation events back to the attempt.
   */
  missionId?: string;
  attemptId?: string;
  missionContextJson?: string;
  /** Deterministic Task Board dispatch through the existing supervisor.runSingle lane. */
  directDelegation?: DirectDelegationInput;
  /**
   * Optional per-run delegation caps supplied by a higher-level controller.
   * The Node host validates and clamps these against its own hard defaults;
   * this renderer type only carries the opaque request packet across Tauri.
   */
  delegationLimits?: {
    maxDepth?: number;
    maxParallelPerDelegation?: number;
    maxTotalChildren?: number;
    maxTotalTokens?: number;
  };
}

export interface DesktopAgentRunResult {
  text: string;
  reasoning?: string;
  /**
   * Ephemeral capability for the exact workspace selected by the backend for
   * this Turn. Callers may pass it back only to binding-scoped commands; it is
   * never persisted, logged, or reconstructed from the current Project row.
   */
  workspaceBindingClaim?: TaskWorkspaceBindingClaim;
  /** Actual host-selected execution identity. Requested model/settings are not
   * provenance and must never be substituted for this value. */
  provenance?: TurnExecutionProvenance;
  /**
   * The root session's own token usage for this run, when the host reported it.
   * Surfaced on the return (not only folded into the `agent_runs` row by
   * `reconcileRoot`) so a synchronous caller — e.g. the Mission loop's token
   * budget (§19.2) — can debit deterministically without racing the persist
   * queue. Absent when the run threw before returning usage.
   */
  usage?: AgentRunUsage;
  /** Root + delegated-tree usage for synchronous Mission budget debit only.
   *  Never persist this as root usage: child rows are already rolled up there. */
  budgetUsage?: AgentRunUsage;
  /** The runtime atomically committed this Conversation's terminal message with
   * the root run terminal. The controller must not issue a second projection
   * write after this point: a later failure would incorrectly offer to rerun
   * work that has already completed. */
  conversationTerminalCommitted?: boolean;
}

export class StopLostTerminalRaceError extends Error {
  constructor(readonly terminalStatus: string) {
    super(`The run reached ${terminalStatus} before Stop was acknowledged.`);
    this.name = 'StopLostTerminalRaceError';
  }
}

export type { AiBillingMode, TurnExecutionProvenance } from './execution-provenance.js';

export interface IsolatedTextJobInput {
  jobId: string;
  text: string;
  systemPrompt: string;
  sourceProvenance: TurnExecutionProvenance;
  /** Exact selector used by the source Turn; never re-derived from a leaf id. */
  runtimeModelRef: string;
  thinkingLevel?: string;
  signal?: AbortSignal;
}

export interface IsolatedTextJobResult {
  text: string;
  provenance: TurnExecutionProvenance;
  usage?: AgentRunUsage;
}

/** The user's answer to an `agent.ui.request`. `requestId` locates the paused run;
 *  `id` matches the specific prompt. `confirmed` answers a confirm, `value`
 *  answers select / input / editor, `cancelled` dismisses any of them. Generic so
 *  the UI never names a backend — each runtime maps it to its own transport. */
export interface AgentUiAnswer {
  /** Durable root run used by the gateway to route the answer to one engine. */
  runId: string;
  requestId: string;
  id: string;
  confirmed?: boolean;
  value?: string;
  /** Structured request-user-input answers keyed by backend-issued question id. */
  answers?: Readonly<Record<string, { readonly answers: readonly string[] }>>;
  cancelled?: boolean;
}

export interface DesktopAgentRuntime {
  /** This gateway owns atomic assistant checkpoint + replay-cursor persistence.
   * Controllers must render chunks but must not issue a second projection write. */
  readonly ownsConversationProjectionPersistence?: boolean;
  execute(input: DesktopAgentRunInput, signal?: AbortSignal): Promise<DesktopAgentRunResult>;
  generateText(input: IsolatedTextJobInput): Promise<IsolatedTextJobResult>;
  resume(runId: string, signal?: AbortSignal): Promise<DesktopAgentRunResult>;
  abort(threadId: string): Promise<void>;
  queueMessage(threadId: string, message: AgentQueuedMessage): Promise<void>;
  abortChild(threadId: string, runId: string): void;
  /** Deliver the user's answer to a mid-run `agent.ui.request` back to the host. */
  answerUiRequest(answer: AgentUiAnswer): Promise<void>;
  /** Capability truth for controls bound to one exact engine. */
  getEngineCapabilities(engineId: string): RuntimeEngineCapabilityManifest | undefined;
  /** Reconnect renderer-owned projections to host streams before stale-run reconciliation. */
  reattachLiveRuns?(rootRunIds?: ReadonlySet<string>): Promise<LiveRunReattachResult>;
  dispose(): Promise<void>;
}

export type AgentQueueBehavior = 'steer' | 'followUp';

export interface AgentQueuedMessage {
  id: string;
  text: string;
  behavior: AgentQueueBehavior;
  images?: Array<{ data: string; mimeType: string }>;
}

interface RuntimeEngineAdapter extends DesktopAgentRuntime {
  readonly engineId: string;
  readonly capabilities: RuntimeEngineCapabilityManifest;
}

class DesktopNativeAgentRuntime implements RuntimeEngineAdapter {
  readonly engineId: string;
  readonly capabilities: RuntimeEngineCapabilityManifest;
  readonly ownsConversationProjectionPersistence = true;
  private readonly inFlightByThread = new Map<string, string>();
  // Request ids the user aborted. A Rust-side abort kills the host and resolves
  // the invoke with empty text (not an error), so execute() consults this to
  // classify the root run's terminal as cancelled rather than completed/failed.
  private readonly abortedRequests = new Set<string>();
  // Stop reaches this adapter through both the controller-owned AbortSignal and
  // the runtime abort method. Coalesce those paths so one native request cannot
  // race itself through the host's interrupt and cleanup gates.
  private readonly abortInFlight = new Map<string, Promise<void>>();
  private readonly abortDecisionByRequest = new Map<string, Promise<void>>();
  private readonly progressWatchdogByRequest = new Map<string, NativeStreamProgressWatchdog>();
  private readonly controlReadyByThread = new Map<string, string>();
  private readonly acceptingControlThreads = new Set<string>();
  private readonly disposeController = new AbortController();
  private readonly pendingControlsByThread = new Map<string, AgentQueuedMessage[]>();
  private readonly pendingControlAcks = new Map<
    string,
    { threadId: string; resolve: () => void; reject: (error: unknown) => void }
  >();
  // Serializes agent-run persistence in event order, catches failures at each
  // task boundary, and coalesces high-frequency stream cursors per run.
  private readonly persistQueue: AgentRunPersistence;

  constructor(
    private readonly companyId: string,
    private readonly repos: RuntimeRepositories,
    private readonly config: NativeEngineRuntimeConfig,
    private readonly commands: NativeAgentCommandTransport = createNativeAgentCommandTransport(),
  ) {
    this.persistQueue = new AgentRunPersistence(companyId, repos);
    this.engineId = config.engineId;
    this.capabilities = config.capabilities;
  }

  getEngineCapabilities(engineId: string): RuntimeEngineCapabilityManifest | undefined {
    return engineId === this.engineId ? this.capabilities : undefined;
  }

  private invokeEnhance(args: CommandArgs<'agent_runtime_enhance'>) {
    if (this.engineId === 'codex' || this.engineId === 'claude') {
      const nativeArgs = {
        req: {
          requestId: args.req.requestId,
          text: args.req.text,
          expectedTarget: args.req.expectedTarget,
          systemPrompt: args.req.systemPrompt,
          sourceProvenance: args.req.sourceProvenance,
        },
        onEvent: args.onEvent,
      };
      return this.engineId === 'codex'
        ? this.commands.enhanceCodex(nativeArgs)
        : this.commands.enhanceClaude(nativeArgs);
    }
    return this.commands.enhanceApi(args);
  }

  private invokeAbort(requestId: string): Promise<void> {
    return this.commands.abort(this.config.engineId, { requestId });
  }

  private invokeAbortOnce(requestId: string): Promise<void> {
    const existing = this.abortInFlight.get(requestId);
    if (existing) return existing;
    const pending = this.invokeAbort(requestId);
    this.abortInFlight.set(requestId, pending);
    void pending
      .finally(() => {
        if (this.abortInFlight.get(requestId) === pending) {
          this.abortInFlight.delete(requestId);
        }
      })
      .catch(() => undefined);
    return pending;
  }

  private invokeAnswer(answer: AgentUiAnswer): Promise<void> {
    const args = {
      requestId: answer.requestId,
      id: answer.id,
      confirmed: answer.confirmed,
      value: answer.answers ? JSON.stringify({ answers: answer.answers }) : answer.value,
      cancelled: answer.cancelled,
    };
    return this.commands.answer(this.config.engineId, args).then(() => {
      this.progressWatchdogByRequest.get(answer.requestId)?.resume();
    });
  }

  private invokeStreamSnapshot(requestId: string) {
    return this.commands.streamSnapshot(this.config.engineId, { requestId });
  }

  private invokeReattach(
    requestId: string,
    afterCursor: number | null,
    onEvent: Channel<PiAgentHostEvent>,
  ) {
    const args = { requestId, afterCursor, onEvent };
    return this.commands.reattach(this.config.engineId, args);
  }

  private async releaseRetainedStream(requestId: string): Promise<void> {
    try {
      await this.commands.releaseStream(this.config.engineId, { requestId });
    } catch (err) {
      console.warn('[desktop-agent-runtime] retained stream release failed', {
        engineId: this.engineId,
        requestId,
        err,
      });
    }
  }

  private settleControlAck(controlId: string, error?: unknown): void {
    const pending = this.pendingControlAcks.get(controlId);
    if (!pending) return;
    this.pendingControlAcks.delete(controlId);
    if (error) pending.reject(error);
    else pending.resolve();
  }

  private async sendRuntimeControl(requestId: string, message: AgentQueuedMessage): Promise<void> {
    await this.commands.control({
      requestId,
      action: message.behavior,
      controlId: message.id,
      runId: null,
      text: message.text,
      images: message.images ?? null,
    });
  }

  private flushPendingControls(threadId: string, requestId: string): void {
    this.controlReadyByThread.set(threadId, requestId);
    const pending = this.pendingControlsByThread.get(threadId) ?? [];
    this.pendingControlsByThread.delete(threadId);
    for (const message of pending) {
      void this.sendRuntimeControl(requestId, message).catch((error: unknown) => {
        this.settleControlAck(message.id, error);
      });
    }
  }

  private rejectPendingControls(threadId: string, error: Error): void {
    this.pendingControlsByThread.delete(threadId);
    for (const [controlId, pending] of this.pendingControlAcks) {
      if (pending.threadId === threadId) this.settleControlAck(controlId, error);
    }
  }

  private handleControlLifecycle(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const data = payload as Record<string, unknown>;
    const controlId = typeof data.controlId === 'string' ? data.controlId : '';
    const state = typeof data.state === 'string' ? data.state : '';
    if (!controlId) return;
    if (state === 'accepted' || state === 'consumed') this.settleControlAck(controlId);
    else if (state === 'failed' || state === 'rejected') {
      this.settleControlAck(
        controlId,
        new Error(
          typeof data.errorMessage === 'string'
            ? data.errorMessage
            : 'The queued instruction was rejected.',
        ),
      );
    }
  }

  private async assertTaskExecutionAccount(
    threadId: string,
    currentRunId: string,
    target: AiExecutionTarget,
  ): Promise<void> {
    const rows = await this.repos.agentRuns.findByThread(threadId);
    for (const row of rows) {
      if (
        row.run_id === currentRunId ||
        row.parent_run_id !== null ||
        row.company_id !== this.companyId
      ) {
        continue;
      }
      const priorTarget = parseRunContext(row.runtime_context_json)?.executionTarget;
      if (!priorTarget) {
        throw new Error(
          'This task predates engine binding and cannot safely continue. Start a new task.',
        );
      }
      if (
        priorTarget.engineId !== target.engineId ||
        priorTarget.accountId !== target.accountId ||
        priorTarget.billingMode !== target.billingMode
      ) {
        throw new Error(
          'A task cannot switch AI engine, account, or billing lane after execution begins.',
        );
      }
    }
  }

  private async previousNativeSessionId(
    threadId: string,
    currentRunId: string,
    target: AiExecutionTarget,
  ): Promise<string | undefined> {
    const rows = await this.repos.agentRuns.findByThread(threadId);
    return rows
      .filter(
        (row) =>
          row.run_id !== currentRunId &&
          row.parent_run_id === null &&
          row.company_id === this.companyId,
      )
      .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
      .map((row) => parseRunContext(row.runtime_context_json))
      .find(
        (context) =>
          context?.nativeSessionId &&
          context.executionTarget?.engineId === target.engineId &&
          context.executionTarget.accountId === target.accountId &&
          context.executionTarget.billingMode === target.billingMode,
      )?.nativeSessionId;
  }

  private async assertDurableExecutionTarget(
    runId: string,
    target: AiExecutionTarget,
    requestId?: string,
  ): Promise<void> {
    await this.persistQueue.drain();
    const row = await this.repos.agentRuns.findById(runId);
    const context = parseRunContext(row?.runtime_context_json ?? null);
    if (
      !row ||
      row.company_id !== this.companyId ||
      (requestId !== undefined && context?.requestId !== requestId) ||
      !isSameExecutionTarget(context?.executionTarget, target)
    ) {
      throw new Error('The exact AI execution target was not durably persisted.');
    }
  }

  private async confirmPreparedExecution(
    event: ExecutionPreparedEvent,
    rootRunId: string,
    requestId: string,
    target: AiExecutionTarget,
    durableRunId = rootRunId,
    durableRequestId: string | undefined = requestId,
  ): Promise<void> {
    if (!event.prepareId.trim() || !event.targetDigest.trim()) {
      throw new Error('Agent runtime returned an invalid execution preparation receipt.');
    }
    const identity = parsePreparedExecutionIdentity(event);
    if (event.runId === rootRunId) {
      const expectedIdentity: TurnExecutionProvenance = { ...target, runId: rootRunId };
      assertSameExecutionAccount(expectedIdentity, identity);
    } else {
      if (
        identity.engineId !== target.engineId ||
        identity.accountId !== target.accountId ||
        identity.billingMode !== target.billingMode
      ) {
        throw new Error('A delegated run tried to switch engine, account, or billing lane.');
      }
      const childTarget = validateExecutionTarget(identity);
      if (!childTarget) {
        throw new Error('A delegated run returned an invalid exact execution target.');
      }
      await this.persistQueue.drain();
      const childRow = await this.repos.agentRuns.findById(event.runId);
      if (
        !childRow ||
        childRow.company_id !== this.companyId ||
        childRow.root_run_id !== rootRunId ||
        childRow.parent_run_id === null
      ) {
        throw new Error('The delegated run was not durably linked to its root before execution.');
      }
      await this.persistRunContextPatch(event.runId, {
        executionTarget: childTarget,
        provenance: identity,
      });
      const childReadback = parseRunContext(
        (await this.repos.agentRuns.findById(event.runId))?.runtime_context_json ?? null,
      );
      if (!isSameExecutionTarget(childReadback?.executionTarget, childTarget)) {
        throw new Error('The delegated run execution target failed durable readback.');
      }
    }
    await this.assertDurableExecutionTarget(durableRunId, target, durableRequestId);
    // Codex validates the exact native account/model and the durable renderer
    // target inside execute/resume before it starts a turn. Pi retains its
    // separate provider ACK because its paid boundary occurs later.
    if (this.engineId === 'codex' || this.engineId === 'claude') return;
    await invokeCommand('agent_runtime_confirm_execution', {
      requestId,
      prepareId: event.prepareId,
      targetDigest: event.targetDigest,
    });
  }

  private enqueuePersist(work: () => Promise<void>, label = 'agent runtime persistence'): void {
    this.persistQueue.enqueue(label, work);
  }

  private queueRunStreamCursor(
    runId: string,
    context: Partial<PersistedRunContext>,
    cursor: number,
    conversationCheckpoint?: ConversationStreamCheckpoint,
  ): void {
    this.persistQueue.queueCursor(runId, cursor, (latest) =>
      this.persistRunStreamCursor(runId, context, latest, conversationCheckpoint),
    );
  }

  private flushRunStreamCursor(runId: string): void {
    this.persistQueue.flushCursor(runId);
  }

  /** Merge renderer-owned fields into the current durable context instead of
   * replacing it. Resume writes native-session authority in Rust before the
   * renderer receives WorkspaceBound; preserving unknown/current fields closes
   * the claim-to-Started crash window. */
  private async persistRunContextPatch(
    runId: string,
    patch: Partial<PersistedRunContext>,
    options: {
      sessionFile?: string;
      conversationCheckpoint?: ConversationStreamCheckpoint;
    } = {},
  ): Promise<void> {
    await persistRunContextPatchWithRepositories(this.repos, runId, patch, options);
  }

  private emitLiveConversationTerminal(
    row: AgentRunRow,
    payload: LiveConversationTerminalPayload,
  ): void {
    runtimeEventBus.emit({
      type: LIVE_CONVERSATION_TERMINAL_EVENT,
      entityId: row.run_id,
      entityType: 'runtime',
      companyId: this.companyId,
      threadId: row.thread_id,
      timestamp: Date.now(),
      payload,
    });
  }
  private async persistRunStreamCursor(
    runId: string,
    context: Partial<PersistedRunContext>,
    cursor: number,
    conversationCheckpoint?: ConversationStreamCheckpoint,
  ): Promise<void> {
    const nextCursor = normalizeStreamCursor(cursor);
    if (nextCursor <= normalizeStreamCursor(context.streamCursor)) return;
    const nextContext = { ...context, streamCursor: nextCursor };
    if (conversationCheckpoint) {
      const current = await this.repos.agentRuns.findById(runId);
      if (!current) throw new Error(`Cannot checkpoint missing agent run ${runId}.`);
      const runtimeContextJson = JSON.stringify(
        mergeRunContextPreservingNativeIdentity(current.runtime_context_json, nextContext),
      );
      await persistConversationStreamCheckpointWithRepositories({
        runId,
        runtimeContextJson,
        message: conversationCheckpoint.message,
        companyId: conversationCheckpoint.companyId,
        projectId: conversationCheckpoint.projectId,
        repos: this.repos,
      });
      // The Tauri transaction adapter commits queued writes only after its
      // callback returns. Exact readback therefore belongs on the main repos,
      // after the behaviorally-tested atomic helper has returned.
      const durableRun = await this.repos.agentRuns.findById(runId);
      if (!durableRun || durableRun.runtime_context_json !== runtimeContextJson) {
        throw new Error('Conversation stream cursor durable readback did not match.');
      }
      await assertPersistedChatMessageWithRepositories({
        repos: this.repos,
        expected: conversationCheckpoint.message,
        errorMessage: 'Conversation stream message durable readback did not match.',
      });
    } else {
      await this.persistRunContextPatch(runId, nextContext);
    }
    context.streamCursor = nextCursor;
  }

  async execute(input: DesktopAgentRunInput, signal?: AbortSignal): Promise<DesktopAgentRunResult> {
    if (input.engineId && input.engineId !== this.engineId) {
      throw new Error(`${this.engineId} adapter cannot execute engine ${input.engineId}.`);
    }
    return this.runNativeTurn(input, 'agent_runtime_execute', undefined, signal);
  }

  async generateText(input: IsolatedTextJobInput): Promise<IsolatedTextJobResult> {
    if (input.sourceProvenance.engineId !== this.engineId) {
      throw new Error(
        `${this.engineId} adapter cannot run an isolated job for engine ${input.sourceProvenance.engineId}.`,
      );
    }
    const requestId = input.jobId.trim();
    if (!requestId || !input.text.trim() || !input.systemPrompt.trim()) {
      throw new Error('Isolated text job requires jobId, text, and systemPrompt.');
    }
    throwIfRunAborted(input.signal);
    const runtimeModelRef = input.runtimeModelRef.trim();
    const target = validateExecutionTarget(input.sourceProvenance);
    if (!runtimeModelRef || !target) {
      throw new Error("Isolated text job requires the source Turn's exact model selector.");
    }
    const selection = { target, runtimeModelRef };
    const onEvent = new Channel<PiAgentHostEvent>();
    let preparation: Promise<void> | null = null;
    let preparedIdentity: TurnExecutionProvenance | null = null;
    let preparationError: Error | null = null;
    onEvent.onmessage = (event) => {
      if (event.kind !== 'executionPrepared') return;
      if (preparation) {
        preparationError = new Error('Agent runtime prepared the same isolated job twice.');
        onAbort();
        return;
      }
      try {
        preparedIdentity = parsePreparedExecutionIdentity(event);
      } catch (error) {
        preparationError = error instanceof Error ? error : new Error(String(error));
        onAbort();
        return;
      }
      preparation = this.confirmPreparedExecution(
        event,
        requestId,
        requestId,
        selection.target,
        input.sourceProvenance.runId,
        undefined,
      );
      void preparation.catch((error: unknown) => {
        preparationError = error instanceof Error ? error : new Error(String(error));
        onAbort();
      });
    };
    const onAbort = () => {
      void this.invokeAbortOnce(requestId).catch(() => undefined);
    };
    if (input.signal) {
      if (input.signal.aborted) onAbort();
      else input.signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const response = (await this.invokeEnhance({
        req: {
          requestId,
          text: input.text,
          systemPrompt: input.systemPrompt,
          model: selection.runtimeModelRef,
          expectedTarget: selection.target,
          runtimeModelRef: selection.runtimeModelRef,
          thinkingLevel: input.thinkingLevel,
          sourceProvenance: input.sourceProvenance,
        },
        onEvent,
      })) as PiAgentHostResponse;
      if (!preparation) {
        throw new Error('Agent runtime did not prepare the isolated execution target.');
      }
      await preparation;
      if (preparationError) throw preparationError;
      if (!preparedIdentity) {
        throw new Error('Agent runtime did not retain its prepared adapter identity.');
      }
      const provenance = {
        ...requireTurnExecutionProvenance(response.provenance, requestId),
        runtimeModelRef: selection.runtimeModelRef,
      };
      assertSameExecutionAccount(input.sourceProvenance, provenance);
      assertSameExecutionAccount(preparedIdentity, provenance);
      return {
        text: response.text,
        provenance,
        ...(response.usage ? { usage: response.usage } : {}),
      };
    } finally {
      input.signal?.removeEventListener('abort', onAbort);
    }
  }

  async resume(runId: string, signal?: AbortSignal): Promise<DesktopAgentRunResult> {
    throwIfRunAborted(signal);
    const repo = this.repos.agentRuns;
    const row = await repo.findById(runId);
    throwIfRunAborted(signal);
    if (!row || row.company_id !== this.companyId) {
      throw new Error('Cannot resume Agent runtime run: run not found for this company.');
    }
    if (row.status !== 'interrupted') {
      throw new Error(`Cannot resume Agent runtime run: expected interrupted, got ${row.status}.`);
    }
    const context = parseRunContext(row.runtime_context_json);
    if (context?.recoveryLane === 'competitive-draft' || context?.competitiveDraft) {
      throw new Error(
        'Cannot resume a competitive draft as an ordinary task. Review or discard its isolated proposal instead.',
      );
    }
    const projectId = resolveAgentRunProjectId(row);
    if (!projectId) {
      throw new Error(
        'Cannot resume Agent runtime run: original project context is missing. Restart from the objective instead.',
      );
    }
    const workspaceBinding = context?.workspaceBinding;
    const savedPermissionMode =
      typeof context?.permissionMode === 'string' && context.permissionMode.trim()
        ? context.permissionMode.trim()
        : null;
    if (
      !workspaceBinding ||
      !workspaceBinding.historyId.trim() ||
      workspaceBinding.companyId !== this.companyId ||
      workspaceBinding.projectId !== projectId ||
      workspaceBinding.threadId !== row.thread_id ||
      workspaceBinding.turnId !== row.root_run_id ||
      (row.access !== 'read' && row.access !== 'write') ||
      workspaceBinding.access !== row.access ||
      (savedPermissionMode !== null &&
        (savedPermissionMode === 'plan' ? 'read' : 'write') !== row.access) ||
      row.run_id !== row.root_run_id
    ) {
      throw new Error(
        'Cannot resume Agent runtime run: saved workspace authority is missing or incompatible. Restart from the objective instead.',
      );
    }
    const compatibility = await invokeCommand('task_workspace_resume_compatibility', {
      historyId: workspaceBinding.historyId,
      companyId: this.companyId,
      projectId,
      threadId: row.thread_id,
      rootRunId: row.root_run_id,
      access: row.access,
    });
    throwIfRunAborted(signal);
    if (compatibility.status !== 'same') {
      throw new Error(
        `Cannot resume Agent runtime run: ${describeWorkspaceResumeCompatibility(compatibility) ?? 'The original Project folder no longer matches this run.'}`,
      );
    }
    return this.runNativeTurn(
      {
        text: `Continue the interrupted task from its saved agent session.\n\nOriginal objective:\n${
          row.objective || 'Untitled run'
        }`,
        threadId: row.thread_id,
        employeeId: row.employee_id,
        projectId,
        runId: row.run_id,
        engineId: context?.executionTarget?.engineId,
        executionTarget: context?.executionTarget ?? undefined,
        permissionMode: savedPermissionMode
          ? savedPermissionMode
          : row.access === 'read'
            ? 'plan'
            : undefined,
        model:
          typeof context?.model === 'string' && context.model.trim()
            ? context.model.trim()
            : undefined,
        runtimeModelRef:
          typeof context?.model === 'string' && context.model.trim()
            ? context.model.trim()
            : undefined,
        thinkingLevel:
          typeof context?.thinkingLevel === 'string' && context.thinkingLevel.trim()
            ? context.thinkingLevel.trim()
            : undefined,
        speedMode:
          context?.speedMode === 'standard' || context?.speedMode === 'fast'
            ? context.speedMode
            : undefined,
        ...(context?.conversationProjection
          ? { conversationProjection: context.conversationProjection }
          : {}),
      },
      'agent_runtime_resume',
      workspaceBinding,
      signal,
    );
  }

  async reattachLiveRuns(rootRunIds?: ReadonlySet<string>): Promise<LiveRunReattachResult> {
    const repo = this.repos.agentRuns;
    const rows = await repo.findByStatus(this.companyId, ['running']);
    const protectedRootRunIds = new Set<string>();
    const handledRootRunIds = new Set<string>();
    const liveRootRunIds = new Set<string>();
    const confirmedMissingRootRunIds = new Set<string>();
    let complete = true;
    for (const row of rows) {
      if (row.parent_run_id) continue;
      if (rootRunIds && !rootRunIds.has(row.run_id)) continue;
      const context = parseRunContext(row.runtime_context_json);
      const runtimeContext: Partial<PersistedRunContext> = context ?? {};
      const executionTarget = context?.executionTarget ?? null;
      if (executionTarget?.engineId !== this.engineId) continue;
      const requestId =
        typeof context?.requestId === 'string' && context.requestId.trim()
          ? context.requestId.trim()
          : null;
      if (!requestId) {
        confirmedMissingRootRunIds.add(row.run_id);
        continue;
      }
      let snapshot: {
        running: boolean;
        cursor: number;
        terminal?: { status: string; message?: string };
      } | null;
      try {
        snapshot = await this.invokeStreamSnapshot(requestId);
      } catch (err) {
        protectedRootRunIds.add(row.run_id);
        complete = false;
        console.warn('[desktop-agent-runtime] live run snapshot probe failed', {
          requestId,
          runId: row.run_id,
          err,
        });
        continue;
      }
      // Terminal streams remain replayable until the host TTL expires. A renderer
      // can disconnect after the host finishes but before SQLite receives the
      // Result, so `running: false` must still reattach and reconcile that result.
      if (!snapshot) {
        confirmedMissingRootRunIds.add(row.run_id);
        continue;
      }
      protectedRootRunIds.add(row.run_id);

      let accumulatedContentText = '';
      let accumulatedReasoningText = '';
      let accumulatedMessageAt =
        Date.parse(runtimeContext.createdAt ?? row.started_at) || Date.now();
      if (runtimeContext.conversationProjection) {
        try {
          const persistedAssistant = await loadPersistedChatMessageWithRepositories({
            repos: this.repos,
            threadId: row.thread_id,
            messageId: runtimeContext.conversationProjection.assistantMessageId,
          });
          accumulatedContentText = persistedAssistant?.body ?? '';
          accumulatedReasoningText = persistedAssistant?.reasoning ?? '';
          accumulatedMessageAt = persistedAssistant?.at ?? accumulatedMessageAt;
        } catch (err) {
          complete = false;
          console.warn('[desktop-agent-runtime] live projection checkpoint load failed', {
            requestId,
            runId: row.run_id,
            err,
          });
          continue;
        }
      }

      const projectId = resolveAgentRunProjectId(row);
      const expectedAccess = row.access === 'read' || row.access === 'write' ? row.access : null;
      const runScope = piRunScope(projectId, row.thread_id, row.employee_id, row.run_id);
      const workspaceRequirement: WorkspaceRequirement =
        context?.workspaceRequirement === 'optional' ? 'optional' : 'required';
      const startedAtByTool = new Map<string, number>();
      const inFlightToolCallIds = new Set(runtimeContext.inFlightToolCallIds ?? []);
      let workspaceBindingGate = createWorkspaceBindingGate<
        TaskWorkspaceBindingClaim,
        WorkspaceUnavailableEvent
      >();
      const sharedHostState: HostEventStreamState = {
        workspaceGate: workspaceBindingGate,
        runtimeContext,
        contentText: accumulatedContentText,
        reasoningText: accumulatedReasoningText,
        startedAtByTool,
        inFlightToolCallIds,
      };
      let progressWatchdog: NativeStreamProgressWatchdog | null = null;
      let streamAwaitingUser = false;
      let lastObservedStreamCursor = normalizeStreamCursor(runtimeContext.streamCursor);
      let bindingFailurePersisted = false;
      let bindingAbortPromise: Promise<void> | null = null;
      const executionPreparations = new Map<string, ExecutionPreparationRecord>();
      let executionAckAllowed = snapshot.running;
      let terminalEventSeen = false;
      let pendingTerminalCheckpoint:
        | {
            status: 'completed' | 'failed' | 'cancelled';
            usage?: AgentRunUsage;
            failureKind?: RunFailureKind;
            conversationTerminal?: LiveConversationTerminalPayload;
            summary?: string;
          }
        | undefined;
      const terminalCheckpointPromises: Promise<void>[] = [];
      let bootstrapSettled = false;
      const rootRun = (
        type: AgentRunEvent['type'],
        payload: AgentRunEvent['payload'],
      ): AgentRunEvent =>
        ({
          threadId: row.thread_id,
          rootRunId: row.run_id,
          runId: row.run_id,
          ...(row.employee_id ? { employeeId: row.employee_id } : {}),
          type,
          payload,
        }) as AgentRunEvent;
      const emitRootBus = (evt: AgentRunEvent): void => {
        runtimeEventBus.emit(agentRunEvent(this.companyId, evt));
      };
      const emitWorkspaceStatusActivity = createWorkspaceStatusEmitter({
        engineId: this.engineId,
        companyId: this.companyId,
        threadId: row.thread_id,
        employeeId: row.employee_id,
        runScope,
        rootRun,
        emitRootBus,
      });
      const queueTerminalCheckpoint = (
        label: string,
        terminal: NonNullable<typeof pendingTerminalCheckpoint>,
        streamCursor?: number,
      ): void => {
        const commit = () =>
          this.persistQueue.enqueueTerminalCheckpoint(label, () =>
            this.persistQueue.persistRootTerminal(
              row.run_id,
              terminal.status,
              terminal.usage,
              terminal.failureKind,
              terminal.conversationTerminal
                ? {
                    context: runtimeContext,
                    terminal: terminal.conversationTerminal,
                    streamCursor,
                  }
                : undefined,
            ),
          );
        const publishTerminal = (): void => {
          emitRootBus(
            terminal.status === 'completed'
              ? rootRun('run.completed', {
                  status: 'completed',
                  ...(terminal.summary ? { summary: terminal.summary } : {}),
                  ...(terminal.usage ? { usage: terminal.usage } : {}),
                })
              : terminal.status === 'cancelled'
                ? rootRun('run.cancelled', {
                    status: 'cancelled',
                    ...(terminal.summary ? { summary: terminal.summary } : {}),
                  })
                : rootRun('run.failed', {
                    status: 'failed',
                    ...(terminal.summary ? { summary: terminal.summary } : {}),
                    failureKind: terminal.failureKind,
                  }),
          );
          if (terminal.conversationTerminal) {
            this.emitLiveConversationTerminal(row, terminal.conversationTerminal);
          }
        };
        const outcome = commit().then(publishTerminal);
        void outcome
          .catch(async (initialError) => {
            // Initial replay failures make bootstrap incomplete so its normal retry
            // owns convergence. Once bootstrap returned, however, a future live
            // terminal has no caller left to observe the Promise; keep retrying the
            // same idempotent terminal transaction without re-executing the task.
            if (!bootstrapSettled) return;
            await retryTerminalCheckpointUntilDurable({
              label,
              runId: row.run_id,
              commit,
              initialError,
              signals: [this.disposeController.signal],
            });
            publishTerminal();
          })
          .catch((error: unknown) => {
            console.error('[desktop-agent-runtime] terminal checkpoint retries exhausted', {
              runId: row.run_id,
              error,
            });
          });
        terminalCheckpointPromises.push(outcome);
      };
      const abortRejectedBinding = (): Promise<void> => {
        if (!bindingAbortPromise) {
          bindingAbortPromise = this.invokeAbortOnce(requestId).catch((err: unknown) => {
            console.warn('[desktop-agent-runtime] rejected reattach abort failed', {
              requestId,
              err,
            });
          });
        }
        return bindingAbortPromise;
      };
      const failReattachedBinding = (message: string): void => {
        if (bindingFailurePersisted) return;
        bindingFailurePersisted = true;
        progressWatchdog?.stop();
        this.progressWatchdogByRequest.delete(requestId);
        void abortRejectedBinding();
        this.flushRunStreamCursor(row.run_id);
        const conversationTerminal: LiveConversationTerminalPayload = {
          runId: row.run_id,
          status: 'failed',
          text: accumulatedContentText,
          ...(accumulatedReasoningText.trim()
            ? { reasoning: accumulatedReasoningText.trim() }
            : {}),
          failureKind: 'runtime',
        };
        queueTerminalCheckpoint(`persist rejected reattach terminal for ${row.run_id}`, {
          status: 'failed',
          failureKind: 'runtime',
          summary: message,
          conversationTerminal,
        });
        if (this.inFlightByThread.get(row.thread_id) === requestId) {
          this.inFlightByThread.delete(row.thread_id);
        }
      };
      const consumeEvent = (
        event: PiAgentHostEvent,
        consumptionPolicy: 'bound-required' | 'workspace-optional' | 'terminal-reconcile',
      ): void => {
        const hostEventContext = {
          mode: 'reattach' as const,
          phase: 'active' as const,
          runId: row.run_id,
          threadId: row.thread_id,
          engineId: this.engineId,
          companyId: this.companyId,
          requestId,
          projectId,
          employeeId: row.employee_id,
          activityEngineId:
            this.engineId === 'codex'
              ? 'codex-engine'
              : this.engineId === 'claude'
                ? 'claude-engine'
                : 'api-engine',
          policy: consumptionPolicy,
          workspaceRequirement,
          expectedWorkspace: {
            projectId,
            access: expectedAccess,
            threadId: row.thread_id,
            turnId: row.run_id,
            requestId,
          },
          runScope,
          state: sharedHostState,
          recordProgress: () => progressWatchdog?.recordProgress(),
          onUiRequestObserved: () => {
            streamAwaitingUser = true;
            progressWatchdog?.pause();
          },
          onWorkspaceAccepted: () => {},
          onRejected: failReattachedBinding,
          onStarted: (startedEvent: Extract<PiAgentHostEvent, { kind: 'started' }>) => {
            const checkpoint = this.persistQueue.enqueueTerminalCheckpoint(
              `commit native session identity for ${row.run_id}`,
              () =>
                persistStartedNativeSessionIdentity({
                  repos: this.repos,
                  runId: row.run_id,
                  runtimeContext,
                  event: startedEvent,
                  engineId: this.engineId,
                }),
            );
            terminalCheckpointPromises.push(checkpoint);
            void checkpoint.catch(() => abortRejectedBinding());
          },
          onExecutionPrepared: (
            preparedEvent: Extract<PiAgentHostEvent, { kind: 'executionPrepared' }>,
          ) => {
            if (!executionAckAllowed) return;
            if (!executionTarget) {
              failReattachedBinding('The running task has no durable AI execution target.');
              return;
            }
            let identity: TurnExecutionProvenance;
            try {
              identity = parsePreparedExecutionIdentity(preparedEvent);
            } catch (error) {
              failReattachedBinding(error instanceof Error ? error.message : String(error));
              return;
            }
            const existing = executionPreparations.get(preparedEvent.prepareId);
            if (existing) {
              if (existing.targetDigest !== preparedEvent.targetDigest) {
                failReattachedBinding(
                  'Agent runtime reused an execution preparation id with another target.',
                );
              } else {
                try {
                  assertSameExecutionAccount(existing.identity, identity);
                } catch (error) {
                  failReattachedBinding(error instanceof Error ? error.message : String(error));
                }
              }
              return;
            }
            const promise = this.confirmPreparedExecution(
              preparedEvent,
              row.run_id,
              requestId,
              executionTarget,
            );
            executionPreparations.set(preparedEvent.prepareId, {
              targetDigest: preparedEvent.targetDigest,
              identity,
              promise,
            });
            terminalCheckpointPromises.push(promise);
            void promise.catch((error: unknown) => {
              failReattachedBinding(error instanceof Error ? error.message : String(error));
            });
          },
          onStreamCursor: (cursorEvent: Extract<PiAgentHostEvent, { kind: 'streamCursor' }>) => {
            lastObservedStreamCursor = Math.max(lastObservedStreamCursor, cursorEvent.cursor);
            if (pendingTerminalCheckpoint) {
              const terminal = pendingTerminalCheckpoint;
              pendingTerminalCheckpoint = undefined;
              queueTerminalCheckpoint(
                `persist terminal checkpoint for ${row.run_id}`,
                terminal,
                cursorEvent.cursor,
              );
              return;
            }
            this.queueRunStreamCursor(
              row.run_id,
              runtimeContext,
              cursorEvent.cursor,
              buildConversationStreamCheckpoint({
                projection: runtimeContext.conversationProjection,
                threadId: row.thread_id,
                employeeId: row.employee_id,
                runId: row.run_id,
                contentText: accumulatedContentText,
                reasoningText: accumulatedReasoningText,
                at: accumulatedMessageAt,
                companyId: this.companyId,
                projectId,
                workspaceProvenance: runtimeContext.workspaceProvenance,
              }),
            );
          },
          onResult: (resultEvent: Extract<PiAgentHostEvent, { kind: 'result' }>) => {
            progressWatchdog?.stop();
            this.progressWatchdogByRequest.delete(requestId);
            terminalEventSeen = true;
            if (this.abortedRequests.delete(requestId)) {
              this.flushRunStreamCursor(row.run_id);
              pendingTerminalCheckpoint = {
                status: 'cancelled',
                conversationTerminal: {
                  runId: row.run_id,
                  status: 'cancelled',
                  text: accumulatedContentText,
                  ...(accumulatedReasoningText.trim()
                    ? { reasoning: accumulatedReasoningText.trim() }
                    : {}),
                },
              };
              if (this.inFlightByThread.get(row.thread_id) === requestId) {
                this.inFlightByThread.delete(row.thread_id);
              }
              return;
            }
            let provenance: TurnExecutionProvenance;
            try {
              provenance = requireTurnExecutionProvenance(
                resultEvent.response.provenance,
                row.run_id,
              );
              if (!executionTarget) {
                throw new Error('Agent runtime returned provenance without a durable target.');
              }
              assertSameExecutionAccount({ ...executionTarget, runId: row.run_id }, provenance);
              assertSameExecutionAccount(
                requirePreparedExecutionIdentity(executionPreparations, row.run_id),
                provenance,
              );
            } catch (error) {
              const summary = error instanceof Error ? error.message : String(error);
              this.flushRunStreamCursor(row.run_id);
              const conversationTerminal: LiveConversationTerminalPayload = {
                runId: row.run_id,
                status: 'failed',
                text: accumulatedContentText,
                ...(accumulatedReasoningText.trim()
                  ? { reasoning: accumulatedReasoningText.trim() }
                  : {}),
                failureKind: 'runtime',
              };
              pendingTerminalCheckpoint = {
                status: 'failed',
                failureKind: 'runtime',
                summary,
                conversationTerminal,
              };
              if (this.inFlightByThread.get(row.thread_id) === requestId) {
                this.inFlightByThread.delete(row.thread_id);
              }
              return;
            }
            runtimeContext.provenance = provenance;
            this.enqueuePersist(() => this.persistRunContextPatch(row.run_id, runtimeContext));
            this.flushRunStreamCursor(row.run_id);
            const conversationTerminal: LiveConversationTerminalPayload = {
              runId: row.run_id,
              status: 'completed',
              text: resultEvent.response.text || accumulatedContentText,
              ...(resultEvent.response.reasoning || accumulatedReasoningText
                ? { reasoning: resultEvent.response.reasoning || accumulatedReasoningText }
                : {}),
              provenance,
            };
            pendingTerminalCheckpoint = {
              status: 'completed',
              ...(resultEvent.response.usage ? { usage: resultEvent.response.usage } : {}),
              ...(conversationTerminal.text ? { summary: conversationTerminal.text } : {}),
              conversationTerminal,
            };
            if (this.inFlightByThread.get(row.thread_id) === requestId) {
              this.inFlightByThread.delete(row.thread_id);
            }
          },
          onError: (errorEvent: Extract<PiAgentHostEvent, { kind: 'error' }>) => {
            progressWatchdog?.stop();
            this.progressWatchdogByRequest.delete(requestId);
            terminalEventSeen = true;
            this.flushRunStreamCursor(row.run_id);
            if (this.abortedRequests.delete(requestId)) {
              pendingTerminalCheckpoint = {
                status: 'cancelled',
                conversationTerminal: {
                  runId: row.run_id,
                  status: 'cancelled',
                  text: accumulatedContentText,
                  ...(accumulatedReasoningText.trim()
                    ? { reasoning: accumulatedReasoningText.trim() }
                    : {}),
                },
              };
              if (this.inFlightByThread.get(row.thread_id) === requestId) {
                this.inFlightByThread.delete(row.thread_id);
              }
              return;
            }
            // A host error message is this lane's free-text ORIGIN — classify the
            // typed kind here (a provider 429 is token strain, not machinery),
            // defaulting to 'runtime' for transport/host failures.
            const failureKind = classifyRunFailure(errorEvent.message);
            const conversationTerminal: LiveConversationTerminalPayload = {
              runId: row.run_id,
              status: 'failed',
              text: accumulatedContentText,
              error: errorEvent.message,
              ...(accumulatedReasoningText.trim()
                ? { reasoning: accumulatedReasoningText.trim() }
                : {}),
              failureKind,
            };
            pendingTerminalCheckpoint = {
              status: 'failed',
              failureKind,
              summary: errorEvent.message,
              conversationTerminal,
            };
            if (this.inFlightByThread.get(row.thread_id) === requestId) {
              this.inFlightByThread.delete(row.thread_id);
            }
          },
          flushPendingControls: () => this.flushPendingControls(row.thread_id, requestId),
          handleControlLifecycle: (payload: unknown) => this.handleControlLifecycle(payload),
          persistContext: () =>
            this.enqueuePersist(() => this.persistRunContextPatch(row.run_id, runtimeContext)),
          enqueuePersist: (work: () => Promise<void>) => this.enqueuePersist(work),
          persistArtifact: (agentEvent: AgentRunEvent, claim: TaskWorkspaceBindingClaim | null) =>
            this.persistQueue.persistArtifact(agentEvent, claim),
          persistWorkspaceDiagnostics: (
            agentRunEvent: Extract<PiAgentHostEvent, { kind: 'agentRun' }>,
            fallbackProjectId: string | null,
            payload: WorkspaceDiagnosticsUpdatedPayload,
          ) =>
            this.persistQueue.persistWorkspaceDiagnostics(
              agentRunEvent,
              fallbackProjectId,
              payload,
            ),
          persistMcpToolCall: (
            agentRunEvent: Extract<PiAgentHostEvent, { kind: 'agentRun' }>,
            employeeId: string | null,
          ) => this.persistQueue.persistMcpToolCall(agentRunEvent, employeeId),
          persistWorkspaceLeaseSnapshot: (
            agentRunEvent: Extract<PiAgentHostEvent, { kind: 'agentRun' }>,
            fallbackProjectId: string | null,
          ) => this.persistQueue.persistWorkspaceLeaseSnapshot(agentRunEvent, fallbackProjectId),
          persistWorkspaceCheckpoint: (
            agentRunEvent: Extract<PiAgentHostEvent, { kind: 'agentRun' }>,
            fallbackProjectId: string | null,
          ) => this.persistQueue.persistWorkspaceCheckpoint(agentRunEvent, fallbackProjectId),
          persistAgentRun: (agentEvent: AgentRunEvent) =>
            this.persistQueue.persistAgentRun(agentEvent),
          rootRun,
          emitRootBus,
          emitRuntimeEvent: (runtimeEvent: RuntimeEvent<any>) => runtimeEventBus.emit(runtimeEvent),
          emitWorkspaceStatus: emitWorkspaceStatusActivity,
        } satisfies ActiveHostEventContext;
        void dispatchHostEvent(event, hostEventContext);
        workspaceBindingGate = sharedHostState.workspaceGate;
        accumulatedContentText = sharedHostState.contentText;
        accumulatedReasoningText = sharedHostState.reasoningText;
      };

      let consumptionPolicy: 'bound-required' | 'workspace-optional' | 'terminal-reconcile' | null =
        null;
      const bufferedEvents: PiAgentHostEvent[] = [];
      let bufferedBindingGate = createWorkspaceBindingGate<
        TaskWorkspaceBindingClaim,
        WorkspaceUnavailableEvent
      >();
      const bufferedHostEventContext = {
        mode: 'reattach' as const,
        phase: 'buffering' as const,
        runId: row.run_id,
        threadId: row.thread_id,
        onWorkspaceBound: (event: Extract<PiAgentHostEvent, { kind: 'workspaceBound' }>) => {
          const matchesExpectedTurn = Boolean(
            projectId &&
              expectedAccess &&
              bindingMatchesRun(event, {
                companyId: this.companyId,
                projectId,
                threadId: row.thread_id,
                turnId: row.run_id,
                requestId,
                access: expectedAccess,
              }),
          );
          const matchesBoundClaim =
            bufferedBindingGate.status !== 'bound' ||
            isSameWorkspaceBindingClaim(bufferedBindingGate.claim, event);
          bufferedBindingGate = acceptWorkspaceBinding(
            bufferedBindingGate,
            event,
            matchesExpectedTurn,
            matchesBoundClaim,
          );
          if (bufferedBindingGate.status === 'rejected') {
            workspaceBindingGate = rejectWorkspaceBinding(workspaceBindingGate);
            console.warn('[desktop-agent-runtime] rejected mismatched workspace binding', {
              runId: row.run_id,
              historyId: event.historyId,
            });
            failReattachedBinding('Backend returned a workspace binding for a different Turn.');
            return false;
          }
          return true;
        },
        onWorkspaceUnavailable: (
          event: Extract<PiAgentHostEvent, { kind: 'workspaceUnavailable' }>,
        ) => {
          const matchesExpectedTurn = Boolean(
            projectId &&
              workspaceUnavailableMatchesRun(event, {
                projectId,
                threadId: row.thread_id,
                turnId: row.run_id,
                requestId,
              }),
          );
          const matchesUnavailable =
            bufferedBindingGate.status !== 'unavailable' ||
            isSameWorkspaceUnavailable(bufferedBindingGate.unavailable, event);
          bufferedBindingGate = acceptWorkspaceUnavailable(
            bufferedBindingGate,
            event,
            matchesExpectedTurn,
            matchesUnavailable,
          );
          if (bufferedBindingGate.status === 'rejected') {
            workspaceBindingGate = rejectWorkspaceBinding(workspaceBindingGate);
            failReattachedBinding(
              'Backend returned an unavailable workspace state for a different Turn.',
            );
            return false;
          }
          return true;
        },
        bufferEvent: (event: PiAgentHostEvent) => bufferedEvents.push(event),
      } satisfies BufferedHostEventContext;
      const onEvent = new Channel<PiAgentHostEvent>();
      onEvent.onmessage = (event) => {
        if (consumptionPolicy) {
          consumeEvent(event, consumptionPolicy);
          return;
        }
        void dispatchHostEvent(event, bufferedHostEventContext);
      };

      this.inFlightByThread.set(row.thread_id, requestId);
      try {
        const reattachSnapshot = await this.invokeReattach(
          requestId,
          !snapshot.running &&
            snapshot.cursor > 0 &&
            normalizeStreamCursor(runtimeContext.streamCursor) >= snapshot.cursor
            ? snapshot.cursor - 1
            : normalizeStreamCursor(runtimeContext.streamCursor),
          onEvent,
        );
        executionAckAllowed = reattachSnapshot.running;
        if (reattachSnapshot.running) {
          liveRootRunIds.add(row.run_id);
          if (this.engineId === 'api') {
            this.acceptingControlThreads.add(row.thread_id);
            this.controlReadyByThread.set(row.thread_id, requestId);
            await this.commands.control({ requestId, action: 'reattach' });
          }
        }
        if (bindingFailurePersisted) {
          if (bindingAbortPromise) await bindingAbortPromise;
          bufferedEvents.length = 0;
          await Promise.all(terminalCheckpointPromises);
          handledRootRunIds.add(row.run_id);
          continue;
        }
        const livePolicy =
          workspaceRequirement === 'optional' ? 'workspace-optional' : 'bound-required';
        consumptionPolicy =
          reattachSnapshot.running ||
          bufferedBindingGate.status === 'bound' ||
          bufferedBindingGate.status === 'unavailable'
            ? livePolicy
            : 'terminal-reconcile';
        for (const event of bufferedEvents) consumeEvent(event, consumptionPolicy);
        bufferedEvents.length = 0;
        if (reattachSnapshot.running && !bindingFailurePersisted && !terminalEventSeen) {
          progressWatchdog = new NativeStreamProgressWatchdog({
            requestId,
            timeoutMs: this.config.streamIdleTimeoutMs,
            onRecover: async (allowReattach) => {
              const recoverySnapshot = await this.invokeStreamSnapshot(requestId);
              if (!recoverySnapshot?.running) return 'failed';
              if (recoverySnapshot.cursor > lastObservedStreamCursor) {
                if (!allowReattach) return 'failed';
                await this.invokeReattach(requestId, lastObservedStreamCursor, onEvent);
                return 'recovered';
              }
              return inFlightToolCallIds.size > 0 ? 'still-running' : 'failed';
            },
          });
          this.progressWatchdogByRequest.set(requestId, progressWatchdog);
          void progressWatchdog.start().catch((error: unknown) => {
            if (!(error instanceof NativeStreamIdleTimeoutError)) return;
            failReattachedBinding(error.message);
          });
          if (streamAwaitingUser) progressWatchdog.pause();
        }
        if (pendingTerminalCheckpoint) {
          const terminal = pendingTerminalCheckpoint;
          pendingTerminalCheckpoint = undefined;
          queueTerminalCheckpoint(
            `persist terminal replay for ${row.run_id}`,
            terminal,
            reattachSnapshot.cursor,
          );
        }
        if (!reattachSnapshot.running && !terminalEventSeen && reattachSnapshot.terminal) {
          const terminalStatus = this.abortedRequests.delete(requestId)
            ? 'cancelled'
            : reattachSnapshot.terminal.status === 'completed'
              ? 'completed'
              : reattachSnapshot.terminal.status === 'aborted'
                ? 'cancelled'
                : 'failed';
          const terminalMessage = reattachSnapshot.terminal.message;
          const failureKind =
            terminalStatus === 'failed'
              ? classifyRunFailure(terminalMessage ?? 'Agent runtime failed.')
              : undefined;
          const conversationTerminal: LiveConversationTerminalPayload = {
            runId: row.run_id,
            status: terminalStatus,
            text:
              terminalStatus === 'completed'
                ? terminalMessage || accumulatedContentText
                : accumulatedContentText,
            ...(accumulatedReasoningText.trim()
              ? { reasoning: accumulatedReasoningText.trim() }
              : {}),
            ...(runtimeContext.provenance ? { provenance: runtimeContext.provenance } : {}),
            ...(failureKind ? { failureKind } : {}),
          };
          queueTerminalCheckpoint(`persist terminal snapshot for ${row.run_id}`, {
            status: terminalStatus,
            failureKind,
            ...(terminalMessage ? { summary: terminalMessage } : {}),
            conversationTerminal,
          });
          if (this.inFlightByThread.get(row.thread_id) === requestId) {
            this.inFlightByThread.delete(row.thread_id);
          }
        }
        await Promise.all(terminalCheckpointPromises);
        if (!snapshot.running) await this.releaseRetainedStream(requestId);
        bootstrapSettled = true;
        handledRootRunIds.add(row.run_id);
      } catch (err: unknown) {
        progressWatchdog?.stop();
        this.progressWatchdogByRequest.delete(requestId);
        complete = false;
        if (bindingAbortPromise) await bindingAbortPromise;
        if (this.inFlightByThread.get(row.thread_id) === requestId) {
          this.inFlightByThread.delete(row.thread_id);
        }
        console.warn('[desktop-agent-runtime] reattach live native stream failed', {
          engineId: this.engineId,
          requestId,
          runId: row.run_id,
          err,
        });
      }
    }
    return {
      protectedRootRunIds,
      handledRootRunIds,
      liveRootRunIds,
      confirmedMissingRootRunIds,
      complete,
    };
  }

  private async runNativeTurn(
    input: DesktopAgentRunInput,
    commandName: 'agent_runtime_execute' | 'agent_runtime_resume',
    resumeWorkspaceBinding?: TaskWorkspaceBindingProjection,
    signal?: AbortSignal,
  ): Promise<DesktopAgentRunResult> {
    if (this.engineId === 'api') this.acceptingControlThreads.add(input.threadId);
    throwIfRunAborted(signal);
    const competitiveDraft = validateCompetitiveDraftContext(input);
    if (
      !this.config.supportsOffisimDelegation &&
      (input.missionId ||
        input.missionContextJson ||
        input.directDelegation ||
        (input.delegationLimits && !competitiveDraft))
    ) {
      throw new Error(
        `${this.engineId} cannot execute Offisim Mission or delegation semantics yet. Choose an API account for this task.`,
      );
    }
    if (commandName === 'agent_runtime_resume' && !resumeWorkspaceBinding?.historyId.trim()) {
      throw new Error(
        'Cannot resume Agent runtime run: saved workspace authority history is missing.',
      );
    }
    const projectId = await requireProjectWorkspaceForRun(
      this.repos,
      this.companyId,
      input.projectId,
    );
    throwIfRunAborted(signal);
    const runScope = piRunScope(projectId, input.threadId, input.employeeId, input.runId);
    const requestId = newRequestId(this.config.requestPrefix);
    const workspaceRequirement = resolveWorkspaceRequirement(input, commandName);
    const startedAtByTool = new Map<string, number>();
    const inFlightToolCallIds = new Set<string>();
    let finalText = '';
    let reasoningText = '';
    let channelError: Error | null = null;
    let progressWatchdog: NativeStreamProgressWatchdog | null = null;
    let lastObservedStreamCursor = 0;
    const startedIdentityCheckpoints: Promise<void>[] = [];
    const executionPreparations = new Map<string, ExecutionPreparationRecord>();
    let executionTarget = input.executionTarget ?? null;

    // The renderer is the AgentRunEventNormalizer for the ROOT run: it already
    // sees every root fact as a legacy wire line (tool / uiRequest / result /
    // error), so it synthesizes the root's neutral agent.run stream here — the
    // SAME contract child runs arrive on from the host supervisor. The root's
    // runId IS its rootRunId and it has no parent/relation. Every user run gets
    // this stream (not only delegating ones), so a plain dev task drives the
    // office dramaturgy + run projection just like delegated work.
    const permissionMode = input.permissionMode?.trim() || resolveThreadMode(input.threadId);
    const rootAccess: 'read' | 'write' = permissionMode === 'plan' ? 'read' : 'write';
    const effectiveDirectDelegation: DirectDelegationInput | undefined =
      this.engineId === 'api' && competitiveDraft
        ? {
            employeeId: input.employeeId!,
            objective: input.text,
            access: rootAccess,
            workKind: 'implement',
            originRunId: runScope.runId,
            deferIntegration: true,
          }
        : input.directDelegation;
    let resolvedModel = input.model?.trim() || undefined;
    let resolvedThinkingLevel =
      input.thinkingLevel?.trim() || resolveThreadThinkingOverride(input.threadId);
    const resolvedSpeedMode =
      this.engineId === 'codex' || this.engineId === 'claude'
        ? (input.speedMode ?? resolveThreadSpeedOverride(input.threadId))
        : undefined;
    const runtimeContext: PersistedRunContext = {
      requestId,
      streamCursor: 0,
      inFlightToolCallIds: [],
      workspaceBinding:
        commandName === 'agent_runtime_resume' ? (resumeWorkspaceBinding ?? null) : null,
      workspaceRequirement,
      workspaceAvailability: commandName === 'agent_runtime_resume' ? 'bound' : 'pending',
      runtime: 'agent-runtime',
      executionTarget: input.executionTarget ?? null,
      ...(this.config.engineId === 'api'
        ? {
            piSdkVersion: this.config.runtimeVersion,
            wireProtocolVersion: this.config.protocolVersion,
          }
        : {
            nativeProtocolVersion: this.config.protocolVersion,
          }),
      model: resolvedModel ?? null,
      provenance: null,
      permissionMode,
      thinkingLevel: resolvedThinkingLevel ?? null,
      ...(this.engineId === 'codex' || this.engineId === 'claude'
        ? { speedMode: resolvedSpeedMode ?? null }
        : {}),
      projectId,
      conversationProjection: input.conversationProjection ?? null,
      recoveryLane: input.missionId
        ? 'mission'
        : competitiveDraft
          ? 'competitive-draft'
          : input.directDelegation
            ? 'direct-delegation'
            : 'conversation',
      competitiveDraft,
      createdAt: new Date().toISOString(),
    };
    const rootRun = (
      type: AgentRunEvent['type'],
      payload: AgentRunEvent['payload'],
    ): AgentRunEvent =>
      ({
        threadId: input.threadId,
        rootRunId: runScope.runId,
        runId: runScope.runId,
        ...(input.employeeId ? { employeeId: input.employeeId } : {}),
        type,
        payload,
      }) as AgentRunEvent;
    const emitRootBus = (evt: AgentRunEvent): void => {
      runtimeEventBus.emit(agentRunEvent(this.companyId, evt));
    };
    const emitWorkspaceStatusActivity = createWorkspaceStatusEmitter({
      engineId: this.engineId,
      companyId: this.companyId,
      threadId: input.threadId,
      employeeId: input.employeeId,
      runScope,
      rootRun,
      emitRootBus,
    });

    let rootRunOpened = false;
    let hostCommandStarted = false;
    const openRootRun = (): void => {
      if (rootRunOpened) return;
      rootRunOpened = true;
      const startedEvt = rootRun('run.started', {
        objective: input.text,
        access: rootAccess,
        projectId,
        runtimeContextJson: JSON.stringify(runtimeContext),
      });
      emitRootBus(startedEvt);
      if (commandName === 'agent_runtime_resume') {
        // A resumed row already exists. Move it back to running only after the
        // backend has revalidated and emitted the exact workspace authority.
        this.enqueuePersist(() =>
          this.repos.agentRuns.updateStatus(runScope.runId, 'running', { finishedAt: null }),
        );
      } else {
        this.enqueuePersist(() => this.persistQueue.persistAgentRun(startedEvt));
      }
    };

    let workspaceBindingGate = createWorkspaceBindingGate<
      TaskWorkspaceBindingClaim,
      WorkspaceUnavailableEvent
    >();
    const sharedHostState: HostEventStreamState = {
      workspaceGate: workspaceBindingGate,
      runtimeContext,
      contentText: finalText,
      reasoningText,
      startedAtByTool,
      inFlightToolCallIds,
    };
    let bindingAbortPromise: Promise<void> | null = null;
    const abortRejectedBinding = (): Promise<void> => {
      if (!bindingAbortPromise) {
        bindingAbortPromise = this.invokeAbortOnce(requestId).catch((err: unknown) => {
          console.warn('[desktop-agent-runtime] rejected workspace binding abort failed', {
            requestId,
            err,
          });
        });
      }
      return bindingAbortPromise;
    };
    const onEvent = new Channel<PiAgentHostEvent>();
    const hostEventContext = {
      mode: 'live' as const,
      phase: 'active' as const,
      runId: runScope.runId,
      threadId: input.threadId,
      engineId: this.engineId,
      companyId: this.companyId,
      requestId,
      projectId,
      employeeId: input.employeeId,
      activityEngineId:
        this.engineId === 'codex'
          ? 'codex-engine'
          : this.engineId === 'claude'
            ? 'claude-engine'
            : 'api-engine',
      policy:
        workspaceRequirement === 'optional'
          ? ('workspace-optional' as const)
          : ('bound-required' as const),
      workspaceRequirement,
      expectedWorkspace: {
        projectId,
        access: rootAccess,
        threadId: input.threadId,
        turnId: runScope.runId,
        requestId,
      },
      runScope,
      state: sharedHostState,
      recordProgress: () => progressWatchdog?.recordProgress(),
      onUiRequestObserved: () => progressWatchdog?.pause(),
      onWorkspaceAccepted: openRootRun,
      onRejected: (message: string) => {
        channelError ??= new Error(message);
        void abortRejectedBinding();
      },
      onStarted: (startedEvent: Extract<PiAgentHostEvent, { kind: 'started' }>) => {
        // A direct-delegation root is an orchestration shell, not a native Pi
        // conversation. Its exact execution identity comes from the prepared
        // child session below; there is no root session file/id to persist or
        // resume as plain chat.
        if (input.directDelegation || competitiveDraft) return;
        const checkpoint = this.persistQueue.enqueueTerminalCheckpoint(
          `commit native session identity for ${runScope.runId}`,
          () =>
            persistStartedNativeSessionIdentity({
              repos: this.repos,
              runId: runScope.runId,
              runtimeContext,
              event: startedEvent,
              engineId: this.engineId,
            }),
        );
        startedIdentityCheckpoints.push(checkpoint);
        void checkpoint.catch((error) => {
          channelError ??=
            error instanceof Error
              ? error
              : new Error('Native Conversation session identity could not be saved.');
          void abortRejectedBinding();
        });
      },
      onExecutionPrepared: (event: Extract<PiAgentHostEvent, { kind: 'executionPrepared' }>) => {
        if (!executionTarget) {
          channelError ??= new Error('Agent runtime prepared work without an execution target.');
          void abortRejectedBinding();
          return;
        }
        let identity: TurnExecutionProvenance;
        try {
          identity = parsePreparedExecutionIdentity(event);
        } catch (error) {
          channelError = error instanceof Error ? error : new Error(String(error));
          void abortRejectedBinding();
          return;
        }
        const existing = executionPreparations.get(event.prepareId);
        if (existing) {
          if (existing.targetDigest !== event.targetDigest) {
            channelError ??= new Error(
              'Agent runtime reused an execution preparation id with another target.',
            );
            void abortRejectedBinding();
          } else {
            try {
              assertSameExecutionAccount(existing.identity, identity);
            } catch (error) {
              channelError = error instanceof Error ? error : new Error(String(error));
              void abortRejectedBinding();
            }
          }
          return;
        }
        const promise = this.confirmPreparedExecution(
          event,
          runScope.runId,
          requestId,
          executionTarget,
        );
        executionPreparations.set(event.prepareId, {
          targetDigest: event.targetDigest,
          identity,
          promise,
        });
        void promise.catch((error: unknown) => {
          channelError ??= error instanceof Error ? error : new Error(String(error));
          void abortRejectedBinding();
        });
      },
      onStreamCursor: (event: Extract<PiAgentHostEvent, { kind: 'streamCursor' }>) => {
        lastObservedStreamCursor = Math.max(lastObservedStreamCursor, event.cursor);
        this.queueRunStreamCursor(
          runScope.runId,
          runtimeContext,
          event.cursor,
          buildConversationStreamCheckpoint({
            projection: runtimeContext.conversationProjection,
            threadId: input.threadId,
            employeeId: input.employeeId,
            runId: runScope.runId,
            contentText: finalText,
            reasoningText,
            at: Date.parse(runtimeContext.createdAt ?? '') || Date.now(),
            companyId: this.companyId,
            projectId,
            workspaceProvenance: runtimeContext.workspaceProvenance,
          }),
        );
      },
      onResult: (event: Extract<PiAgentHostEvent, { kind: 'result' }>) => {
        finalText = event.response.text || finalText;
        try {
          const provenance = requireRootResultProvenance(
            event.response.provenance,
            runScope.runId,
            executionPreparations,
            Boolean(input.directDelegation || competitiveDraft),
          );
          if (!executionTarget) {
            throw new Error('Agent runtime returned provenance without an execution target.');
          }
          assertSameExecutionAccount({ ...executionTarget, runId: runScope.runId }, provenance);
          runtimeContext.provenance = provenance;
          this.enqueuePersist(() => this.persistRunContextPatch(runScope.runId, runtimeContext));
        } catch (error) {
          channelError = error instanceof Error ? error : new Error(String(error));
          return;
        }
        this.flushRunStreamCursor(runScope.runId);
      },
      onError: (event: Extract<PiAgentHostEvent, { kind: 'error' }>) => {
        this.flushRunStreamCursor(runScope.runId);
        channelError = nonAuthorizingAgentHostError(event.message);
      },
      flushPendingControls: () => this.flushPendingControls(input.threadId, requestId),
      handleControlLifecycle: (payload: unknown) => this.handleControlLifecycle(payload),
      persistContext: () =>
        this.enqueuePersist(() => this.persistRunContextPatch(runScope.runId, runtimeContext)),
      enqueuePersist: (work: () => Promise<void>) => this.enqueuePersist(work),
      persistArtifact: (event: AgentRunEvent, claim: TaskWorkspaceBindingClaim | null) =>
        this.persistQueue.persistArtifact(event, claim),
      persistWorkspaceDiagnostics: (
        event: Extract<PiAgentHostEvent, { kind: 'agentRun' }>,
        fallbackProjectId: string | null,
        payload: WorkspaceDiagnosticsUpdatedPayload,
      ) => this.persistQueue.persistWorkspaceDiagnostics(event, fallbackProjectId, payload),
      persistMcpToolCall: (
        event: Extract<PiAgentHostEvent, { kind: 'agentRun' }>,
        employeeId: string | null,
      ) => this.persistQueue.persistMcpToolCall(event, employeeId),
      persistWorkspaceLeaseSnapshot: (
        event: Extract<PiAgentHostEvent, { kind: 'agentRun' }>,
        fallbackProjectId: string | null,
      ) => this.persistQueue.persistWorkspaceLeaseSnapshot(event, fallbackProjectId),
      persistWorkspaceCheckpoint: (
        event: Extract<PiAgentHostEvent, { kind: 'agentRun' }>,
        fallbackProjectId: string | null,
      ) => this.persistQueue.persistWorkspaceCheckpoint(event, fallbackProjectId),
      persistAgentRun: (event: AgentRunEvent) => this.persistQueue.persistAgentRun(event),
      rootRun,
      emitRootBus,
      emitRuntimeEvent: (event: RuntimeEvent<any>) => runtimeEventBus.emit(event),
      emitWorkspaceStatus: emitWorkspaceStatusActivity,
    } satisfies ActiveHostEventContext;
    onEvent.onmessage = (event) => {
      void dispatchHostEvent(event, hostEventContext);
      workspaceBindingGate = sharedHostState.workspaceGate;
      finalText = sharedHostState.contentText;
      reasoningText = sharedHostState.reasoningText;
    };
    const recoverStalledStream = async (allowReattach: boolean) => {
      const snapshot = await this.invokeStreamSnapshot(requestId);
      if (!snapshot?.running) return 'failed' as const;
      if (snapshot.cursor > lastObservedStreamCursor) {
        if (!allowReattach) return 'failed' as const;
        await this.invokeReattach(requestId, lastObservedStreamCursor, onEvent);
        return 'recovered' as const;
      }
      return inFlightToolCallIds.size > 0 ? ('still-running' as const) : ('failed' as const);
    };

    // A new run must exist before child events can reference it. Resume already
    // has a durable interrupted row, so it stays untouched until workspaceBound
    // proves backend authority revalidation succeeded.
    if (commandName === 'agent_runtime_execute') openRootRun();

    this.inFlightByThread.set(input.threadId, requestId);
    if (this.engineId === 'api') this.acceptingControlThreads.add(input.threadId);
    const abortFromSignal = (): void => {
      void this.abort(input.threadId).catch((err: unknown) => {
        if (err instanceof StopLostTerminalRaceError) return;
        console.warn('[desktop-agent-runtime] signal abort confirmation failed', {
          threadId: input.threadId,
          err,
        });
      });
    };
    signal?.addEventListener('abort', abortFromSignal, { once: true });
    try {
      // Resolve, in one DB pass, the acting employee's persona (forwarded as Pi's
      // `appendSystemPrompt`) plus the delegation roster. If this fails, the run
      // fails visibly instead of silently becoming a base Pi run with no employee
      // identity. MCP scope resolution is also fail-closed before host startup.
      const {
        systemPromptAppend,
        skillPaths,
        projectSkillPaths,
        projectExperience,
        runtimeSelection,
        roster,
      } = await buildDelegationContext(
        this.repos,
        this.companyId,
        input.employeeId,
        {
          model: resolvedModel,
          thinkingLevel: resolvedThinkingLevel,
        },
        projectId,
        competitiveDraft ? { includeActingEmployeeInRoster: true } : undefined,
      );
      const effectiveSystemPromptAppend = competitiveDraft
        ? [
            systemPromptAppend,
            [
              'Competitive draft workspace rules:',
              '- Work only inside the assigned isolated worktree and produce the requested files there.',
              '- Do not commit, amend, merge, rebase, switch branches, or create branches. Offisim owns proposal capture, winner integration, and loser cleanup.',
              '- Finish with the worktree changes left uncommitted so Offisim can compare and adopt them.',
            ].join('\n'),
          ]
            .filter(Boolean)
            .join('\n\n')
        : systemPromptAppend;
      throwIfRunAborted(signal);
      const exactTarget = validateExecutionTarget(input.executionTarget);
      const exactRuntimeModelRef = input.runtimeModelRef?.trim();
      if (!exactTarget || !exactRuntimeModelRef) {
        throw new Error('The engine adapter requires an exact gateway-frozen execution binding.');
      }
      if (
        exactTarget.engineId !== this.engineId ||
        exactTarget.billingMode !== this.config.billingMode
      ) {
        throw new Error('The gateway-frozen execution binding belongs to another engine.');
      }
      executionTarget = exactTarget;
      resolvedModel = exactRuntimeModelRef;
      const delegatedThinkingLevel =
        commandName === 'agent_runtime_execute' && input.employeeId
          ? runtimeSelection.thinkingLevel
          : undefined;
      const rosterModels = this.config.supportsOffisimDelegation
        ? roster.map((entry) => entry.model?.trim()).filter(Boolean)
        : [];
      const runtimeStatus =
        rosterModels.length ||
        (delegatedThinkingLevel && MODEL_PASSTHROUGH_ENGINES.has(this.engineId))
          ? await invokeCommand('agent_runtime_status', { includeUsage: false })
          : undefined;
      // The gateway already froze the task's engine/account/model before entering
      // this adapter. Employee settings may still supply a thinking level, but
      // must never replace that exact model with a binding from another engine —
      // and an inherited level the frozen model does not declare (Pi's `off`, or
      // a stale employee `xhigh` on a model without it) degrades to the engine
      // default instead of hard-failing the host's closed-set validation.
      if (commandName === 'agent_runtime_execute' && input.employeeId) {
        resolvedThinkingLevel = MODEL_PASSTHROUGH_ENGINES.has(this.engineId)
          ? declaredReasoningEffort(
              runtimeStatus,
              this.engineId,
              exactTarget.modelId,
              delegatedThinkingLevel,
            )
          : delegatedThinkingLevel;
        runtimeContext.thinkingLevel = resolvedThinkingLevel ?? null;
        this.enqueuePersist(() => this.persistRunContextPatch(runScope.runId, runtimeContext));
      }
      // One root run owns one engine/account/billing lane. Employees bound to a
      // different lane stay visible in Offisim but are not exposed as Pi child
      // candidates; their presence must never reject otherwise valid root work.
      const boundRoster = this.config.supportsOffisimDelegation
        ? roster.flatMap((entry) => {
            const employeeModel = entry.model?.trim();
            if (!employeeModel) return [entry];
            if (!runtimeStatus) return [];
            const childSelection: ResolvedRuntimeExecutionSelection =
              resolveRuntimeExecutionSelection(
                runtimeStatus,
                parseRuntimeExecutionSelector(employeeModel),
                undefined,
              );
            if (
              childSelection.target.engineId !== executionTarget?.engineId ||
              childSelection.target.accountId !== executionTarget.accountId ||
              childSelection.target.billingMode !== executionTarget.billingMode
            ) {
              return [];
            }
            return [
              {
                ...entry,
                model: childSelection.runtimeModelRef,
                runtimeModelRef: childSelection.runtimeModelRef,
                executionTarget: childSelection.target,
              },
            ];
          })
        : [];
      runtimeContext.executionTarget = executionTarget;
      runtimeContext.model = resolvedModel;
      await this.assertTaskExecutionAccount(input.threadId, runScope.runId, executionTarget);
      const nativeSessionMode = input.nativeSessionMode === 'fresh' ? 'fresh' : 'tracked';
      if (nativeSessionMode === 'tracked') {
        runtimeContext.nativeSessionId ??= await this.previousNativeSessionId(
          input.threadId,
          runScope.runId,
          executionTarget,
        );
      } else {
        // Fresh recovery is an explicit new native Conversation. Never let the
        // broken tracked opaque ref cross the host boundary or its durable row.
        runtimeContext.nativeSessionId = undefined;
      }
      // Resume must leave the interrupted witness untouched until Rust has
      // validated its original request/workspace/session and atomically claimed
      // the replacement binding. Prewriting this new request id makes that
      // validation reject the renderer's own mutation as resume_context_invalid.
      if (commandName === 'agent_runtime_execute') {
        this.enqueuePersist(() => this.persistRunContextPatch(runScope.runId, runtimeContext));
      }
      const mcpTools = [
        ...OFFISIM_BROWSER_MCP_TOOLS,
        ...(this.config.supportsOffisimDelegation
          ? await buildMcpScope(this.repos, this.companyId, input.employeeId, projectId)
          : []),
      ];
      throwIfRunAborted(signal);

      await this.assertDurableExecutionTarget(
        runScope.runId,
        executionTarget,
        commandName === 'agent_runtime_execute' ? requestId : undefined,
      );
      if (commandName === 'agent_runtime_execute') {
        // Opening the root is a paid/side-effect boundary, not best-effort
        // telemetry. The host must not start until the exact run authority is
        // durable and readable with this request id and scope.
        await this.persistQueue.drain();
        const openedRoot = await this.repos.agentRuns.findById(runScope.runId);
        const openedContext = parseRunContext(openedRoot?.runtime_context_json ?? null);
        if (
          !openedRoot ||
          openedRoot.company_id !== this.companyId ||
          openedRoot.thread_id !== input.threadId ||
          openedRoot.project_id !== projectId ||
          openedRoot.run_id !== openedRoot.root_run_id ||
          openedRoot.parent_run_id !== null ||
          openedRoot.status !== 'running' ||
          openedContext?.requestId !== requestId ||
          openedContext?.projectId !== projectId ||
          !isSameExecutionTarget(openedContext?.executionTarget, executionTarget)
        ) {
          throw new Error('Agent run authority could not be persisted before execution.');
        }
      }

      throwIfRunAborted(signal);
      hostCommandStarted = true;
      progressWatchdog = new NativeStreamProgressWatchdog({
        requestId,
        timeoutMs: this.config.streamIdleTimeoutMs,
        onRecover: recoverStalledStream,
      });
      this.progressWatchdogByRequest.set(requestId, progressWatchdog);
      let commandExecution: Promise<PiAgentHostResponse>;
      if (this.engineId === 'codex') {
        const commandArgs: CommandArgs<'codex_agent_execute'> = {
          req: {
            requestId,
            text: input.text,
            images: input.images?.length ? input.images : [],
            expectedTarget: executionTarget,
            companyId: this.companyId,
            threadId: input.threadId,
            projectId,
            employeeId: input.employeeId,
            rootRunId: runScope.runId,
            workspaceRequirement,
            nativeSessionMode,
            permissionMode,
            ...(resolvedThinkingLevel ? { effort: resolvedThinkingLevel } : {}),
            ...(resolvedSpeedMode === 'fast' ? { speedMode: 'fast' } : {}),
            systemPromptAppend: effectiveSystemPromptAppend ?? undefined,
            projectExperience: projectExperience ?? undefined,
            skillPaths,
            projectSkillPaths,
            clientUserMessageId: input.conversationProjection?.userMessageId,
            ...(nativeSessionMode === 'tracked' && runtimeContext.nativeSessionId
              ? { nativeSessionId: runtimeContext.nativeSessionId }
              : {}),
            ...(nativeSessionMode === 'fresh'
              ? { nativeSessionResetSourceRunId: input.nativeSessionResetSourceRunId }
              : {}),
            ...(commandName === 'agent_runtime_resume'
              ? { workspaceBindingHistoryId: resumeWorkspaceBinding?.historyId }
              : {}),
            competitiveDraft,
          },
          onEvent,
        };
        commandExecution =
          commandName === 'agent_runtime_resume'
            ? this.commands.resumeCodex(commandArgs)
            : this.commands.executeCodex(commandArgs);
      } else if (this.engineId === 'claude') {
        const commandArgs: CommandArgs<'claude_agent_execute'> = {
          req: {
            requestId,
            text: input.text,
            expectedTarget: executionTarget,
            companyId: this.companyId,
            threadId: input.threadId,
            projectId,
            employeeId: input.employeeId,
            rootRunId: runScope.runId,
            workspaceRequirement,
            nativeSessionMode,
            permissionMode,
            ...(resolvedThinkingLevel ? { effort: resolvedThinkingLevel } : {}),
            ...(resolvedSpeedMode === 'fast' ? { speedMode: 'fast' } : {}),
            systemPromptAppend: effectiveSystemPromptAppend ?? undefined,
            projectExperience: projectExperience ?? undefined,
            skillPaths,
            projectSkillPaths,
            ...(nativeSessionMode === 'tracked' && runtimeContext.nativeSessionId
              ? { nativeSessionId: runtimeContext.nativeSessionId }
              : {}),
            ...(nativeSessionMode === 'fresh'
              ? { nativeSessionResetSourceRunId: input.nativeSessionResetSourceRunId }
              : {}),
            ...(commandName === 'agent_runtime_resume'
              ? { workspaceBindingHistoryId: resumeWorkspaceBinding?.historyId }
              : {}),
            competitiveDraft,
          },
          onEvent,
        };
        commandExecution =
          commandName === 'agent_runtime_resume'
            ? this.commands.resumeClaude(commandArgs)
            : this.commands.executeClaude(commandArgs);
      } else {
        const commandArgs: CommandArgs<'agent_runtime_execute'> = {
          req: {
            requestId,
            text: input.text,
            images: input.images?.length ? input.images : null,
            companyId: this.companyId,
            threadId: input.threadId,
            projectId,
            workspaceRequirement,
            employeeId: input.employeeId,
            model: resolvedModel,
            expectedTarget: executionTarget,
            runtimeModelRef: resolvedModel,
            permissionMode,
            thinkingLevel: resolvedThinkingLevel,
            systemPromptAppend: effectiveSystemPromptAppend ?? undefined,
            projectExperience: projectExperience ?? undefined,
            skillPaths,
            projectSkillPaths,
            rootRunId: runScope.runId,
            nativeSessionMode,
            ...(nativeSessionMode === 'fresh'
              ? { nativeSessionResetSourceRunId: input.nativeSessionResetSourceRunId }
              : {}),
            ...(commandName === 'agent_runtime_resume'
              ? { workspaceBindingHistoryId: resumeWorkspaceBinding?.historyId }
              : {}),
            roster: boundRoster,
            missionContextJson: input.missionContextJson?.trim() || undefined,
            mcpTools,
            directDelegation: effectiveDirectDelegation,
            competitiveDraft,
            ...(input.delegationLimits !== undefined
              ? { delegationLimits: input.delegationLimits }
              : {}),
          },
          onEvent,
        };
        commandExecution =
          commandName === 'agent_runtime_resume'
            ? this.commands.resumeApi(commandArgs)
            : this.commands.executeApi(commandArgs);
      }
      let commandResponse: PiAgentHostResponse;
      try {
        commandResponse = await progressWatchdog.watch(commandExecution);
      } catch (error) {
        if (error instanceof NativeStreamIdleTimeoutError) {
          await this.invokeAbortOnce(requestId).catch((abortError: unknown) => {
            console.warn('[desktop-agent-runtime] stalled native stream abort failed', {
              engineId: this.engineId,
              requestId,
              abortError,
            });
          });
        }
        throw error;
      }
      // A host error is the primary failure. Surface it before the downstream
      // absence of an execution-prepared checkpoint can replace the cause with
      // a generic provenance symptom.
      if (channelError) throw channelError;
      if (executionPreparations.size === 0) {
        const abortDecision = this.abortDecisionByRequest.get(requestId);
        if (abortDecision) {
          try {
            await abortDecision;
          } catch (error) {
            if (!(error instanceof StopLostTerminalRaceError)) throw error;
          }
        }
        if (!this.abortedRequests.has(requestId)) {
          // Direct delegation can fail before the child prepares a model (for
          // example, while adopting a review lease). The host still returns the
          // child's bounded failure summary; keep that actionable cause instead
          // of replacing it with the downstream provenance symptom.
          const directDelegationFailure = input.directDelegation ? commandResponse.text.trim() : '';
          throw new Error(
            directDelegationFailure || 'Agent runtime did not prepare the exact execution target.',
          );
        }
      }
      await Promise.all([...executionPreparations.values()].map((entry) => entry.promise));
      await Promise.all(startedIdentityCheckpoints);
      // The sidecar may resolve its command response as soon as the retained
      // stream aborts, while Stop is still polling Rust for the authoritative
      // terminal snapshot. Join that decision before validating success-only
      // provenance: an acknowledged cancellation is a valid terminal without
      // result provenance, whereas a natural Result/Error keeps winning the
      // race and continues through the normal validation below.
      const pendingAbortDecision = this.abortDecisionByRequest.get(requestId);
      if (pendingAbortDecision) {
        try {
          await pendingAbortDecision;
        } catch (error) {
          if (!(error instanceof StopLostTerminalRaceError)) throw error;
        }
      }
      if (this.abortedRequests.has(requestId)) {
        this.flushRunStreamCursor(runScope.runId);
        const cancelledText = commandResponse.text || finalText;
        const cancelledReasoning = (commandResponse.reasoning || reasoningText).trim();
        const conversationTerminal: LiveConversationTerminalPayload = {
          runId: runScope.runId,
          status: 'cancelled',
          text: cancelledText,
          ...(cancelledReasoning ? { reasoning: cancelledReasoning } : {}),
        };
        const terminalCheckpointLabel = `commit terminal checkpoint for ${runScope.runId}`;
        const commitTerminal = () =>
          this.persistQueue.enqueueTerminalCheckpoint(terminalCheckpointLabel, () =>
            this.persistQueue.persistRootTerminal(
              runScope.runId,
              'cancelled',
              commandResponse.usage,
              undefined,
              {
                context: runtimeContext,
                terminal: conversationTerminal,
              },
            ),
          );
        try {
          await commitTerminal();
        } catch (cause) {
          if (runtimeContext.conversationProjection) {
            throw new AgentTerminalCheckpointError(runScope.runId, cause);
          }
          await retryTerminalCheckpointUntilDurable({
            label: terminalCheckpointLabel,
            runId: runScope.runId,
            commit: commitTerminal,
            initialError: cause,
            signals: [signal, this.disposeController.signal].filter(
              (candidate): candidate is AbortSignal => Boolean(candidate),
            ),
          });
        }
        await this.releaseRetainedStream(requestId);
        emitRootBus(rootRun('run.cancelled', { status: 'cancelled' }));
        return {
          text: cancelledText,
          ...(workspaceBindingGate.status === 'bound'
            ? { workspaceBindingClaim: workspaceBindingGate.claim }
            : {}),
          ...(cancelledReasoning ? { reasoning: cancelledReasoning } : {}),
          ...(commandResponse.usage ? { usage: commandResponse.usage } : {}),
          ...(commandResponse.budgetUsage ? { budgetUsage: commandResponse.budgetUsage } : {}),
          ...(runtimeContext.conversationProjection ? { conversationTerminalCommitted: true } : {}),
        };
      }
      if (workspaceRequirement === 'required' && workspaceBindingGate.status !== 'bound') {
        throw new Error('Backend completed a workspace-required Turn without a binding claim.');
      }
      if (
        workspaceRequirement === 'optional' &&
        workspaceBindingGate.status !== 'bound' &&
        workspaceBindingGate.status !== 'unavailable'
      ) {
        throw new Error('Backend completed the Turn without declaring workspace availability.');
      }
      // Root session's own usage is folded into the root agent_runs row (children
      // come from their own rows). Only in scope in this try-branch; the catch
      // branch's invoke threw before returning.
      const rootUsage = commandResponse.usage;
      const provenance = {
        ...requireRootResultProvenance(
          commandResponse.provenance,
          runScope.runId,
          executionPreparations,
          Boolean(input.directDelegation || competitiveDraft),
        ),
        runtimeModelRef: resolvedModel,
      };
      if (!executionTarget) {
        throw new Error('Agent runtime completed without an execution target.');
      }
      assertSameExecutionAccount({ ...executionTarget, runId: runScope.runId }, provenance);
      if (runtimeContext.provenance?.runId !== provenance.runId) {
        runtimeContext.provenance = provenance;
        this.enqueuePersist(() => this.persistRunContextPatch(runScope.runId, runtimeContext));
      }
      this.flushRunStreamCursor(runScope.runId);
      if (commandResponse.reasoning && !reasoningText.trim()) {
        runtimeEventBus.emit(
          llmStreamChunk(
            this.companyId,
            input.threadId,
            this.engineId,
            commandResponse.reasoning,
            'reasoning',
            runScope,
          ),
        );
      }
      finalText = commandResponse.text || finalText;
      const reasoning = (commandResponse.reasoning || reasoningText).trim();
      // A Rust abort resolves the invoke with empty text (not an error), so
      // classify the terminal from the aborted-set: cancelled, not completed.
      const aborted = this.abortedRequests.has(requestId);
      const terminalStatus = aborted ? 'cancelled' : 'completed';
      const conversationTerminal: LiveConversationTerminalPayload = {
        runId: runScope.runId,
        status: terminalStatus,
        text: finalText,
        ...(reasoning ? { reasoning } : {}),
        provenance,
      };
      const terminalCheckpointLabel = `commit terminal checkpoint for ${runScope.runId}`;
      const commitTerminal = () =>
        this.persistQueue.enqueueTerminalCheckpoint(terminalCheckpointLabel, () =>
          this.persistQueue.persistRootTerminal(
            runScope.runId,
            terminalStatus,
            rootUsage,
            undefined,
            {
              context: runtimeContext,
              terminal: conversationTerminal,
            },
          ),
        );
      try {
        await commitTerminal();
      } catch (cause) {
        if (runtimeContext.conversationProjection) {
          throw new AgentTerminalCheckpointError(runScope.runId, cause);
        }
        await retryTerminalCheckpointUntilDurable({
          label: terminalCheckpointLabel,
          runId: runScope.runId,
          commit: commitTerminal,
          initialError: cause,
          signals: [signal, this.disposeController.signal].filter(
            (candidate): candidate is AbortSignal => Boolean(candidate),
          ),
        });
      }
      await this.releaseRetainedStream(requestId);
      if (aborted) {
        emitRootBus(rootRun('run.cancelled', { status: 'cancelled' }));
      } else {
        emitRootBus(
          rootRun('run.completed', {
            status: 'completed',
            ...(finalText ? { summary: finalText } : {}),
            ...(rootUsage ? { usage: rootUsage } : {}),
          }),
        );
      }
      return {
        text: finalText,
        ...(workspaceBindingGate.status === 'bound'
          ? { workspaceBindingClaim: workspaceBindingGate.claim }
          : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(rootUsage ? { usage: rootUsage } : {}),
        provenance,
        ...(commandResponse.budgetUsage ? { budgetUsage: commandResponse.budgetUsage } : {}),
        ...(runtimeContext.conversationProjection ? { conversationTerminalCommitted: true } : {}),
      };
    } catch (err) {
      if (bindingAbortPromise) await bindingAbortPromise;
      if (err instanceof AgentTerminalCheckpointError) throw err;
      if (commandName === 'agent_runtime_resume' && !rootRunOpened) {
        // Resume compatibility/authority failed before the host obtained a
        // binding. Preserve the interrupted row and recovery card; the user can
        // inspect/discard it or retry after restoring the original folder.
        await this.persistQueue.drain();
        throw err;
      }
      // A thrown invoke / channel error is a failure unless the user aborted —
      // abort wins (it can surface as a throw on some teardown paths).
      const aborted = this.abortedRequests.has(requestId);
      const status = aborted ? 'cancelled' : 'failed';
      const message = err instanceof Error ? err.message : String(err);
      const prestartCode = aborted
        ? null
        : trustedNativeSessionPrestartCode(err, startedIdentityCheckpoints.length > 0);
      if (prestartCode) runtimeContext.nativeSessionPrestartErrorCode = prestartCode;
      // A thrown invoke / channel error carries this lane's origin free text —
      // classify the typed kind from it (provider messages surface here too);
      // a cancel never carries a failureKind.
      const failureKind = aborted
        ? undefined
        : err instanceof NativeStreamIdleTimeoutError
          ? err.failureKind
          : classifyRunFailure(message);
      this.flushRunStreamCursor(runScope.runId);
      const terminalText = finalText.trim() ? finalText : message;
      const terminal: LiveConversationTerminalPayload = {
        runId: runScope.runId,
        status,
        text: terminalText,
        ...(reasoningText.trim() ? { reasoning: reasoningText.trim() } : {}),
        ...(failureKind ? { failureKind } : {}),
      };
      const commitFailedTerminal = () =>
        this.persistQueue.enqueueTerminalCheckpoint(
          `commit failed terminal checkpoint for ${runScope.runId}`,
          () =>
            this.persistQueue.persistRootTerminal(runScope.runId, status, undefined, failureKind, {
              context: runtimeContext,
              terminal,
            }),
        );
      if (!hostCommandStarted) {
        // No native/provider side effect exists to replay. Keep converging this
        // already-open root locally until it is terminal so Stop/preflight
        // failure can never manufacture a later interrupted-run recovery card.
        await this.persistQueue.drain();
        let preflightRoot: AgentRunRow | null = null;
        let preflightLookupError: unknown;
        for (let attempt = 1; attempt <= TERMINAL_CHECKPOINT_MAX_RETRIES; attempt += 1) {
          try {
            preflightRoot = await this.repos.agentRuns.findById(runScope.runId);
            break;
          } catch (persistenceError) {
            preflightLookupError = persistenceError;
            console.warn('[desktop-agent-runtime] preflight root lookup retrying', {
              runId: runScope.runId,
              attempt,
              persistenceError,
            });
            if (attempt < TERMINAL_CHECKPOINT_MAX_RETRIES) {
              await waitForTerminalCheckpointRetry(
                [signal, this.disposeController.signal].filter(
                  (candidate): candidate is AbortSignal => Boolean(candidate),
                ),
              );
            }
          }
        }
        if (!preflightRoot && preflightLookupError) {
          throw new AgentTerminalCheckpointError(runScope.runId, preflightLookupError);
        }
        if (
          !preflightRoot ||
          preflightRoot.company_id !== this.companyId ||
          preflightRoot.thread_id !== input.threadId ||
          preflightRoot.run_id !== preflightRoot.root_run_id
        ) {
          throw err;
        }
        try {
          await commitFailedTerminal();
        } catch (initialError) {
          await retryTerminalCheckpointUntilDurable({
            label: `commit failed terminal checkpoint for ${runScope.runId}`,
            runId: runScope.runId,
            commit: commitFailedTerminal,
            initialError,
            signals: [signal, this.disposeController.signal].filter(
              (candidate): candidate is AbortSignal => Boolean(candidate),
            ),
          });
        }
      } else {
        try {
          await commitFailedTerminal();
        } catch (cause) {
          if (runtimeContext.conversationProjection) {
            throw new AgentTerminalCheckpointError(runScope.runId, cause);
          }
          await retryTerminalCheckpointUntilDurable({
            label: `commit failed terminal checkpoint for ${runScope.runId}`,
            runId: runScope.runId,
            commit: commitFailedTerminal,
            initialError: cause,
            signals: [signal, this.disposeController.signal].filter(
              (candidate): candidate is AbortSignal => Boolean(candidate),
            ),
          });
        }
      }
      if (hostCommandStarted) await this.releaseRetainedStream(requestId);
      emitRootBus(
        aborted
          ? rootRun('run.cancelled', { status, summary: message })
          : rootRun('run.failed', { status, summary: message, failureKind }),
      );
      throw err;
    } finally {
      progressWatchdog?.stop();
      this.progressWatchdogByRequest.delete(requestId);
      signal?.removeEventListener('abort', abortFromSignal);
      this.abortedRequests.delete(requestId);
      this.controlReadyByThread.delete(input.threadId);
      this.acceptingControlThreads.delete(input.threadId);
      this.rejectPendingControls(
        input.threadId,
        new Error('The run ended before the queued instruction was accepted.'),
      );
      if (this.inFlightByThread.get(input.threadId) === requestId) {
        this.inFlightByThread.delete(input.threadId);
      }
    }
  }

  async queueMessage(threadId: string, message: AgentQueuedMessage): Promise<void> {
    if (this.engineId !== 'api') {
      throw new Error('Queued steering is available only for API engine runs.');
    }
    if (!message.id.trim()) throw new Error('Queued messages require a stable id.');
    if (this.pendingControlAcks.has(message.id)) {
      throw new Error('This queued message is already awaiting acknowledgement.');
    }
    const acknowledged = new Promise<void>((resolve, reject) => {
      this.pendingControlAcks.set(message.id, { threadId, resolve, reject });
    });
    const requestId = this.controlReadyByThread.get(threadId);
    if (requestId) {
      void this.sendRuntimeControl(requestId, message).catch((error: unknown) => {
        this.settleControlAck(message.id, error);
      });
    } else if (this.acceptingControlThreads.has(threadId)) {
      const pending = this.pendingControlsByThread.get(threadId) ?? [];
      pending.push(message);
      this.pendingControlsByThread.set(threadId, pending);
    } else {
      this.settleControlAck(
        message.id,
        new Error('This conversation is no longer accepting queued messages.'),
      );
    }
    await acknowledged;
  }

  async abort(threadId: string): Promise<void> {
    const requestId = this.inFlightByThread.get(threadId);
    if (!requestId) return;
    const existing = this.abortDecisionByRequest.get(requestId);
    if (existing) return existing;
    const decision = (async () => {
      let nextAbortAt = 0;
      for (;;) {
        if (Date.now() >= nextAbortAt) {
          try {
            await this.invokeAbortOnce(requestId);
          } catch (err) {
            console.warn('[desktop-agent-runtime] native abort request retrying', {
              engineId: this.engineId,
              threadId,
              err,
            });
          }
          nextAbortAt = Date.now() + 2_000;
        }
        let snapshot: Awaited<ReturnType<DesktopNativeAgentRuntime['invokeStreamSnapshot']>>;
        try {
          snapshot = await this.invokeStreamSnapshot(requestId);
        } catch (err) {
          console.warn('[desktop-agent-runtime] Stop snapshot confirmation retrying', {
            engineId: this.engineId,
            threadId,
            err,
          });
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
          continue;
        }
        if (snapshot?.terminal?.status === 'aborted') {
          this.abortedRequests.add(requestId);
          this.controlReadyByThread.delete(threadId);
          this.acceptingControlThreads.delete(threadId);
          this.rejectPendingControls(
            threadId,
            new Error('The queued message was cancelled with the run.'),
          );
          return;
        }
        if (snapshot?.terminal) {
          throw new StopLostTerminalRaceError(snapshot.terminal.status);
        }
        if (!snapshot && this.inFlightByThread.get(threadId) !== requestId) {
          // No stream to confirm against and execute() has already settled
          // this request (failed before host registration, or released after
          // its natural terminal): there is nothing left for Stop to win.
          throw new StopLostTerminalRaceError('settled');
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
    })();
    this.abortDecisionByRequest.set(requestId, decision);
    try {
      await decision;
    } finally {
      if (this.abortDecisionByRequest.get(requestId) === decision) {
        this.abortDecisionByRequest.delete(requestId);
      }
    }
  }

  abortChild(threadId: string, runId: string): void {
    const requestId = this.inFlightByThread.get(threadId);
    if (!requestId) return;
    if (!this.config.supportsOffisimDelegation) return;
    void this.commands
      .stopChild({ requestId, action: 'stopChild', runId })
      .catch((err: unknown) =>
        console.warn('[desktop-agent-runtime] child stop failed', { runId, err }),
      );
  }

  async answerUiRequest(answer: AgentUiAnswer): Promise<void> {
    await this.invokeAnswer(answer);
  }

  async dispose(): Promise<void> {
    // Renderer dispose is a detach boundary, not a user cancel. Explicit Stop
    // still calls abort(threadId); unmount/reload must leave the Rust host alive
    // so a fresh renderer can `agent_runtime_reattach` by the persisted requestId.
    this.inFlightByThread.clear();
    this.disposeController.abort();
  }
}

const runtimeCache = new Map<string, Promise<DesktopAgentRuntime>>();

class DesktopAgentRuntimeGateway implements DesktopAgentRuntime {
  readonly ownsConversationProjectionPersistence = true;
  private readonly adapters: ReadonlyMap<string, RuntimeEngineAdapter>;
  private readonly activeEngineByThread = new Map<string, string>();
  private readonly admittingThreads = new Set<string>();
  private readonly pendingQueuesByThread = new Map<
    string,
    Array<{
      message: AgentQueuedMessage;
      resolve: () => void;
      reject: (error: unknown) => void;
    }>
  >();

  constructor(
    private readonly companyId: string,
    private readonly repos: RuntimeRepositories,
    adapters: readonly RuntimeEngineAdapter[],
  ) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.engineId, adapter]));
  }

  private adapter(engineId: string): RuntimeEngineAdapter {
    const adapter = this.adapters.get(engineId);
    if (!adapter) {
      throw new Error(`AI engine ${engineId} is not available for this task.`);
    }
    return adapter;
  }

  private flushPendingQueue(threadId: string, engineId: string): void {
    const pending = this.pendingQueuesByThread.get(threadId) ?? [];
    this.pendingQueuesByThread.delete(threadId);
    for (const entry of pending) {
      void this.adapter(engineId)
        .queueMessage(threadId, entry.message)
        .then(entry.resolve, entry.reject);
    }
  }

  private rejectPendingQueue(threadId: string, error: Error): void {
    const pending = this.pendingQueuesByThread.get(threadId) ?? [];
    this.pendingQueuesByThread.delete(threadId);
    for (const entry of pending) entry.reject(error);
  }

  getEngineCapabilities(engineId: string): RuntimeEngineCapabilityManifest | undefined {
    return this.adapters.get(engineId)?.capabilities;
  }

  async execute(input: DesktopAgentRunInput, signal?: AbortSignal): Promise<DesktopAgentRunResult> {
    this.admittingThreads.add(input.threadId);
    try {
      const durableAuthority = resolveAuthoritativeThreadExecutionAuthority(
        await this.repos.agentRuns.findByThread(input.threadId),
        this.companyId,
      );
      let requestedModel = input.model?.trim() || undefined;
      if (!requestedModel && !durableAuthority && input.employeeId && !input.executionTarget) {
        const context = await buildDelegationContext(
          this.repos,
          this.companyId,
          input.employeeId,
          {
            model: undefined,
            thinkingLevel: input.thinkingLevel,
          },
          input.projectId,
        );
        requestedModel = context.runtimeSelection.model?.trim() || undefined;
      }
      const initialSelector = input.runtimeModelRef?.trim() || input.model?.trim() || undefined;
      const initialAuthority: DurableThreadExecutionAuthority | undefined =
        input.executionTarget && initialSelector
          ? { target: input.executionTarget, runtimeModelRef: initialSelector }
          : undefined;
      const selectionPlan = planThreadExecutionSelection(
        durableAuthority,
        requestedModel,
        initialAuthority,
      );
      let runtimeStatus: AiRuntimeStatus | undefined;
      if (selectionPlan.requiresCatalog) {
        runtimeStatus = await invokeCommand('agent_runtime_status', { includeUsage: false });
      }
      const selection = selectionPlan.requiresCatalog
        ? resolveRuntimeExecutionSelection(
            runtimeStatus,
            parseRuntimeExecutionSelector(selectionPlan.requestedModel),
            selectionPlan.frozenAuthority?.target ?? input.executionTarget,
            selectionPlan.frozenAuthority?.runtimeModelRef ?? input.runtimeModelRef,
          )
        : selectionPlan.frozenAuthority;
      if (!selection) throw new Error('This task does not have an executable AI binding.');
      if (selectionPlan.authoritativeAuthority) {
        assertThreadExecutionLane(selectionPlan.authoritativeAuthority.target, selection.target);
      }
      if (input.engineId && input.engineId !== selection.target.engineId) {
        throw new Error('The selected model belongs to another AI engine.');
      }
      const engineId = selection.target.engineId;
      const adapter = this.adapter(engineId);
      if (
        input.images?.length &&
        adapter.capabilities.attachmentInput.images === 'model-dependent' &&
        !runtimeStatus
      ) {
        runtimeStatus = await invokeCommand('agent_runtime_status', { includeUsage: false }).catch(
          () => undefined,
        );
      }
      const supportsImages =
        adapter.capabilities.attachmentInput.images === 'supported' ||
        (adapter.capabilities.attachmentInput.images === 'model-dependent' &&
          apiModelSupportsImageInput(runtimeStatus, selection));
      const attachmentNotice =
        input.images?.length && !supportsImages ? attachmentImageDowngradeNotice(engineId) : null;
      if (attachmentNotice && input.runId) {
        runtimeEventBus.emit(
          agentLifecycleEvent(this.companyId, input.threadId, {
            requestId: `attachment-capability-${input.runId}`,
            runId: input.runId,
            event: 'attachmentCapability',
            data: {
              state: 'degraded',
              message: attachmentNotice,
              imageCount: input.images?.length ?? 0,
            },
          }),
        );
      }
      const executableInput: DesktopAgentRunInput = attachmentNotice
        ? {
            ...input,
            text: `${input.text}\n\n## Attachment capability notice\nThe selected engine/model cannot inspect the attached images. Do not claim to have seen them; ask for a textual description or a vision-capable model if visual details are required.`,
            images: [],
          }
        : input;
      const threadStatusInput = {
        repos: this.repos,
        eventBus: runtimeEventBus,
        companyId: this.companyId,
        threadId: input.threadId,
        projectId: input.projectId,
        rootTaskId: input.runId ?? null,
        entryMode: input.employeeId ? 'direct_chat' : 'boss_chat',
      } as const;
      await persistThreadRuntimeStatus({ ...threadStatusInput, status: 'running' });
      this.activeEngineByThread.set(input.threadId, engineId);
      try {
        const execution = adapter.execute(
          {
            ...executableInput,
            engineId,
            model: selection.runtimeModelRef,
            runtimeModelRef: selection.runtimeModelRef,
            executionTarget: selection.target,
          },
          signal,
        );
        this.flushPendingQueue(input.threadId, engineId);
        const result = await execution;
        if (!input.missionId) {
          await persistThreadRuntimeStatus({ ...threadStatusInput, status: 'completed' });
        }
        return result;
      } catch (error) {
        if (!input.missionId) {
          await persistThreadRuntimeStatus({
            ...threadStatusInput,
            status: signal?.aborted ? 'paused' : 'failed',
          });
        }
        throw error;
      } finally {
        this.rejectPendingQueue(
          input.threadId,
          new Error('The run ended before the queued instruction was accepted.'),
        );
        if (this.activeEngineByThread.get(input.threadId) === engineId) {
          this.activeEngineByThread.delete(input.threadId);
        }
      }
    } finally {
      this.admittingThreads.delete(input.threadId);
      this.rejectPendingQueue(
        input.threadId,
        new Error('The run ended before the queued instruction was accepted.'),
      );
    }
  }

  generateText(input: IsolatedTextJobInput): Promise<IsolatedTextJobResult> {
    return this.adapter(input.sourceProvenance.engineId).generateText(input);
  }

  async resume(runId: string, signal?: AbortSignal): Promise<DesktopAgentRunResult> {
    const row = await this.repos.agentRuns.findById(runId);
    if (!row || row.company_id !== this.companyId) {
      throw new Error('Cannot resume Agent runtime run: run not found for this company.');
    }
    const context = parseRunContext(row.runtime_context_json);
    const engineId = context?.executionTarget?.engineId;
    if (!engineId) {
      throw new Error('Cannot resume Agent runtime run: execution target is missing.');
    }
    this.activeEngineByThread.set(row.thread_id, engineId);
    try {
      return await this.adapter(engineId).resume(runId, signal);
    } finally {
      if (this.activeEngineByThread.get(row.thread_id) === engineId) {
        this.activeEngineByThread.delete(row.thread_id);
      }
    }
  }

  async abort(threadId: string): Promise<void> {
    const engineId = this.activeEngineByThread.get(threadId);
    if (engineId) await this.adapter(engineId).abort(threadId);
  }

  async queueMessage(threadId: string, message: AgentQueuedMessage): Promise<void> {
    const engineId = this.activeEngineByThread.get(threadId);
    if (engineId) {
      await this.adapter(engineId).queueMessage(threadId, message);
      return;
    }
    if (!this.admittingThreads.has(threadId)) {
      throw new Error('This conversation no longer has an active engine.');
    }
    await new Promise<void>((resolve, reject) => {
      const pending = this.pendingQueuesByThread.get(threadId) ?? [];
      pending.push({ message, resolve, reject });
      this.pendingQueuesByThread.set(threadId, pending);
    });
  }

  abortChild(threadId: string, runId: string): void {
    const engineId = this.activeEngineByThread.get(threadId);
    if (engineId) this.adapter(engineId).abortChild(threadId, runId);
  }

  async answerUiRequest(answer: AgentUiAnswer): Promise<void> {
    const row = await this.repos.agentRuns.findById(answer.runId);
    if (!row || row.company_id !== this.companyId || row.parent_run_id !== null) {
      throw new Error('Cannot route an interaction without its durable root run.');
    }
    const context = parseRunContext(row.runtime_context_json);
    if (context?.requestId !== answer.requestId) {
      throw new Error('Cannot route an interaction without its durable request binding.');
    }
    const engineId = context.executionTarget?.engineId;
    if (!engineId) throw new Error('Cannot route an interaction without an exact engine binding.');
    await this.adapter(engineId).answerUiRequest(answer);
  }

  async reattachLiveRuns(rootRunIds?: ReadonlySet<string>): Promise<LiveRunReattachResult> {
    const idsByEngine = new Map<string, Set<string>>();
    const routingByRunId = new Map<string, { threadId: string; engineId: string }>();
    const gatewayConfirmedMissingRootRunIds = new Set<string>();
    const candidateRows = rootRunIds
      ? (
          await Promise.all([...rootRunIds].map((runId) => this.repos.agentRuns.findById(runId)))
        ).filter((row): row is AgentRunRow => Boolean(row))
      : await this.repos.agentRuns.findByStatus(this.companyId, ['running']);
    for (const row of candidateRows) {
      if (row.company_id !== this.companyId || row.parent_run_id !== null) continue;
      const engineId = parseRunContext(row.runtime_context_json)?.executionTarget?.engineId;
      if (!engineId || !this.adapters.has(engineId)) {
        gatewayConfirmedMissingRootRunIds.add(row.run_id);
        continue;
      }
      const ids = idsByEngine.get(engineId) ?? new Set<string>();
      ids.add(row.run_id);
      idsByEngine.set(engineId, ids);
      routingByRunId.set(row.run_id, { threadId: row.thread_id, engineId });
    }
    const results = await Promise.all(
      [...this.adapters.values()].map((adapter) =>
        adapter.reattachLiveRuns
          ? rootRunIds
            ? idsByEngine.has(adapter.engineId)
              ? adapter.reattachLiveRuns(idsByEngine.get(adapter.engineId))
              : Promise.resolve({
                  protectedRootRunIds: new Set<string>(),
                  handledRootRunIds: new Set<string>(),
                  liveRootRunIds: new Set<string>(),
                  confirmedMissingRootRunIds: new Set<string>(),
                  complete: true,
                })
            : adapter.reattachLiveRuns()
          : (() => {
              for (const runId of idsByEngine.get(adapter.engineId) ?? []) {
                gatewayConfirmedMissingRootRunIds.add(runId);
              }
              return Promise.resolve({
                protectedRootRunIds: new Set<string>(),
                handledRootRunIds: new Set<string>(),
                liveRootRunIds: new Set<string>(),
                confirmedMissingRootRunIds: new Set<string>(),
                complete: true,
              });
            })(),
      ),
    );
    const liveRootRunIds = new Set(results.flatMap((result) => [...(result.liveRootRunIds ?? [])]));
    for (const runId of liveRootRunIds) {
      const route = routingByRunId.get(runId);
      if (route) this.activeEngineByThread.set(route.threadId, route.engineId);
    }
    const confirmedMissingRootRunIds = new Set([
      ...gatewayConfirmedMissingRootRunIds,
      ...results.flatMap((result) => [...result.confirmedMissingRootRunIds]),
    ]);
    const settledRootRunIds = new Set([
      ...confirmedMissingRootRunIds,
      ...results.flatMap((result) => [...result.handledRootRunIds]),
    ]);
    for (const runId of settledRootRunIds) {
      if (liveRootRunIds.has(runId)) continue;
      const route = routingByRunId.get(runId);
      if (route && this.activeEngineByThread.get(route.threadId) === route.engineId) {
        this.activeEngineByThread.delete(route.threadId);
      }
    }
    return {
      protectedRootRunIds: new Set(results.flatMap((result) => [...result.protectedRootRunIds])),
      handledRootRunIds: new Set(results.flatMap((result) => [...result.handledRootRunIds])),
      liveRootRunIds,
      confirmedMissingRootRunIds,
      complete: results.every((result) => result.complete),
    };
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.adapters.values()].map((adapter) => adapter.dispose()));
  }
}

async function assembleRuntime(companyId: string): Promise<DesktopAgentRuntime> {
  const repos = await getRepos();
  for (const required of ['threads', 'chatThreads', 'projects'] as const) {
    if (!repos[required]) {
      throw new Error(`Cannot start Agent runtime: repos.${required} is unavailable.`);
    }
  }
  const apiAdapter = new DesktopNativeAgentRuntime(companyId, repos, API_ENGINE_RUNTIME);
  const codexAdapter = new DesktopNativeAgentRuntime(companyId, repos, CODEX_ENGINE_RUNTIME);
  const claudeAdapter = new DesktopNativeAgentRuntime(companyId, repos, CLAUDE_ENGINE_RUNTIME);
  return new DesktopAgentRuntimeGateway(companyId, repos, [
    apiAdapter,
    codexAdapter,
    claudeAdapter,
  ]);
}

export function getDesktopAgentRuntime(companyId: string): Promise<DesktopAgentRuntime> {
  const cached = runtimeCache.get(companyId);
  if (cached) return cached;
  const promise = assembleRuntime(companyId).catch((err) => {
    runtimeCache.delete(companyId);
    throw err;
  });
  runtimeCache.set(companyId, promise);
  return promise;
}

export async function disposeDesktopAgentRuntime(companyId: string): Promise<void> {
  const cached = runtimeCache.get(companyId);
  if (!cached) return;
  runtimeCache.delete(companyId);
  try {
    const runtime = await cached;
    await runtime.dispose();
  } catch (err) {
    console.warn('[desktop-agent-runtime] dispose failed', { companyId, err });
  }
}
