import {
  assertPersistedChatMessageWithRepositories,
  loadPersistedChatMessageWithRepositories,
  persistChatMessageWithRepositories,
  persistConversationStreamCheckpointWithRepositories,
} from '@/data/chat-message-events.js';
import { buildDelegationContext, buildMcpScope } from '@/data/employee-persona.js';
import type { ChatMessage } from '@/data/types.js';
import {
  type CommandArgs,
  type TaskWorkspaceBindingClaim,
  type TaskWorkspaceBindingProjection,
  invokeCommand,
  parseTaskWorkspaceBindingProjection,
} from '@/lib/tauri-commands.js';
import { requireProjectWorkspaceForRun } from '@/runtime/require-project-workspace.js';
import {
  agentRunEvent,
  isResettableNativeSessionPrestartCode,
  llmStreamChunk,
  toolExecutionTelemetry,
} from '@offisim/core/browser';
import type { AgentRunRow, RuntimeRepositories } from '@offisim/core/browser';
import {
  type AgentRunArtifactPayload,
  type AgentRunEvent,
  type AgentRunFinishedPayload,
  type AgentRunStartedPayload,
  type AgentRunUsage,
  type AiExecutionTarget,
  type AiModelCatalogEntry,
  type AiRuntimeStatus,
  type RunFailureKind,
  type RuntimeEvent,
  type WorkspaceProvenance,
  classifyRunFailure,
} from '@offisim/shared-types';
import { Channel } from '@tauri-apps/api/core';
import { AgentRunPersistenceQueue } from './agent-run-persistence-queue.js';
import {
  type TurnExecutionProvenance,
  assertSameExecutionAccount,
  requireTurnExecutionProvenance,
  validateExecutionTarget,
} from './execution-provenance.js';
import {
  MISSION_EVALUATION_SUBMITTED_EVENT,
  type MissionEvaluationSubmittedPayload,
} from './mission/mission-events.js';
import {
  type NativeAgentCommandTransport,
  createNativeAgentCommandTransport,
} from './native-agent-command-transport.js';
import type {
  PiAgentHostEvent,
  PiAgentHostResponse,
  WorkspaceUnavailableEvent,
} from './pi-runtime-driver.js';
import { persistRunStartIfAbsent } from './recovery/persist-run-idempotency.js';
import {
  PI_HOST_PROTOCOL_VERSION,
  describeWorkspaceResumeCompatibility,
  resolveAgentRunProjectId,
} from './recovery/reconcile-interrupted-runs.js';
import { aggregateSubtreeUsage } from './recovery/usage-aggregation.js';
import {
  type DurableThreadExecutionAuthority,
  assertThreadExecutionLane,
  planThreadExecutionSelection,
  resolveAuthoritativeThreadExecutionAuthority,
} from './thread-execution-authority.js';
import {
  type WorkspaceBindingStreamGate,
  type WorkspaceStreamConsumptionPolicy,
  acceptWorkspaceBinding,
  acceptWorkspaceUnavailable,
  canConsumeWorkspaceEvent,
  createWorkspaceBindingGate,
  rejectWorkspaceBinding,
} from './workspace-binding-stream-gate.js';
import {
  notableWorkspaceProvenanceForBinding,
  parseWorkspaceProvenance,
  workspaceProvenanceForUnavailable,
} from './workspace-provenance.js';

const PI_SDK_VERSION = '0.79.8';
const TERMINAL_CHECKPOINT_RETRY_MS = 5_000;

async function retryTerminalCheckpointUntilDurable({
  label,
  runId,
  commit,
  initialError,
}: {
  label: string;
  runId: string;
  commit: () => Promise<void>;
  initialError: unknown;
}): Promise<void> {
  let persistenceError = initialError;
  for (;;) {
    console.warn('[desktop-agent-runtime] terminal checkpoint retrying', {
      label,
      runId,
      persistenceError,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, TERMINAL_CHECKPOINT_RETRY_MS));
    try {
      await commit();
      return;
    } catch (error) {
      persistenceError = error;
    }
  }
}

interface ConversationStreamCheckpoint {
  companyId: string;
  projectId: string | null;
  message: ChatMessage;
}

function buildConversationStreamCheckpoint({
  projection,
  threadId,
  employeeId,
  runId,
  contentText,
  reasoningText,
  at,
  companyId,
  projectId,
  workspaceProvenance,
}: {
  projection: ConversationRunProjectionRef | null | undefined;
  threadId: string;
  employeeId: string | null;
  runId: string;
  contentText: string;
  reasoningText: string;
  at: number;
  companyId: string;
  projectId: string | null;
  workspaceProvenance?: WorkspaceProvenance;
}): ConversationStreamCheckpoint | undefined {
  const reasoning = reasoningText.trim();
  if (!projection || (!contentText && !reasoning && !workspaceProvenance)) return undefined;
  return {
    companyId,
    projectId,
    message: {
      id: projection.assistantMessageId,
      threadId,
      author: 'employee',
      employeeId,
      body: contentText,
      ...(reasoning ? { reasoning } : {}),
      at,
      replyToMessageId: projection.userMessageId,
      attemptId: runId,
      status: 'streaming',
      ...(workspaceProvenance ? { workspaceProvenance } : {}),
    },
  };
}

// Re-export the mission-bridge event vocabulary so existing importers of
// desktop-agent-runtime keep working; the canonical definition lives in
// mission/mission-events.ts (tauri-free, harness-importable).
export { MISSION_EVALUATION_SUBMITTED_EVENT };
export type { MissionEvaluationSubmittedPayload };
import { resolveThreadMode } from './pi-thread-mode-store.js';
import { resolveThreadThinkingOverride } from './pi-thread-thinking-store.js';
import { getRepos, runtimeEventBus } from './repos.js';
import { persistRunCostAndNotify } from './run-cost-refresh.js';

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

export interface ConversationRunProjectionRef {
  userMessageId: string;
  assistantMessageId: string;
  source: 'office' | 'workspace';
}

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
  resumeLease?: {
    leaseId: string;
    runId: string;
    workspaceRoot: string;
    cwd: string;
    branch: string;
    createdAt: string;
  };
}

export interface DesktopAgentRunInput {
  text: string;
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

export class AgentTerminalCheckpointError extends Error {
  readonly runId: string;

  constructor(runId: string, cause: unknown) {
    super('The run finished, but its durable terminal checkpoint could not be committed.', {
      cause,
    });
    this.name = 'AgentTerminalCheckpointError';
    this.runId = runId;
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
  abort(threadId: string): void;
  abortChild(threadId: string, runId: string): void;
  /** Deliver the user's answer to a mid-run `agent.ui.request` back to the host. */
  answerUiRequest(answer: AgentUiAnswer): Promise<void>;
  /** Reconnect renderer-owned projections to host streams before stale-run reconciliation. */
  reattachLiveRuns?(rootRunIds?: ReadonlySet<string>): Promise<LiveRunReattachResult>;
  dispose(): Promise<void>;
}

interface RuntimeEngineAdapter extends DesktopAgentRuntime {
  readonly engineId: string;
}

interface NativeEngineRuntimeConfig {
  readonly engineId: 'api' | 'codex';
  readonly billingMode: 'api' | 'subscription';
  readonly runtimeVersion: string;
  readonly protocolVersion: number;
  readonly requestPrefix: string;
  readonly supportsOffisimDelegation: boolean;
}

const API_ENGINE_RUNTIME: NativeEngineRuntimeConfig = {
  engineId: 'api',
  billingMode: 'api',
  runtimeVersion: PI_SDK_VERSION,
  protocolVersion: PI_HOST_PROTOCOL_VERSION,
  requestPrefix: 'pi-agent',
  supportsOffisimDelegation: true,
};

const CODEX_ENGINE_RUNTIME: NativeEngineRuntimeConfig = {
  engineId: 'codex',
  billingMode: 'subscription',
  runtimeVersion: '0.144.4',
  protocolVersion: 2,
  requestPrefix: 'codex-agent',
  supportsOffisimDelegation: false,
};

type ExecutionPreparedEvent = Extract<PiAgentHostEvent, { kind: 'executionPrepared' }>;

interface ExecutionPreparationRecord {
  readonly targetDigest: string;
  readonly identity: TurnExecutionProvenance;
  readonly promise: Promise<void>;
}

function parsePreparedExecutionIdentity(event: ExecutionPreparedEvent): TurnExecutionProvenance {
  const identity = requireTurnExecutionProvenance(event.identity, event.runId);
  if (
    !identity.adapter ||
    identity.adapter.id !== event.adapter.id ||
    identity.adapter.version !== event.adapter.version
  ) {
    throw new Error('Agent runtime adapter identity changed during execution preparation.');
  }
  return identity;
}

function requirePreparedExecutionIdentity(
  preparations: ReadonlyMap<string, ExecutionPreparationRecord>,
  runId: string,
): TurnExecutionProvenance {
  const matching = [...preparations.values()].filter((entry) => entry.identity.runId === runId);
  const expected = matching[0]?.identity;
  if (!expected?.adapter) {
    throw new Error('Agent runtime returned a result without a prepared adapter identity.');
  }
  for (const entry of matching.slice(1)) {
    assertSameExecutionAccount(expected, entry.identity);
  }
  return expected;
}

function newRequestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Event name for the agent's mid-run "ask the user something" bridge — shared by
 *  the producer (here) and the ConversationRunController consumer so the two
 *  can't drift on a typo. Backend-neutral on purpose: any agent that pauses to
 *  prompt the user (Pi today via `ctx.ui`, others later) routes through this. */
export const AGENT_UI_REQUEST_EVENT = 'agent.ui.request';
export const AGENT_UI_REQUEST_RESOLVED_EVENT = 'agent.ui.request.resolved';

/** Payload shape for the `agent.ui.request` renderer event. An agent paused
 *  mid-run and asked the user something (confirm / select / input / editor). The
 *  renderer needs `requestId` to route the answer back to the run's host and `id`
 *  to match the specific prompt. Mirrors a Pi extension-UI request, but the shape
 *  is generic so it isn't tied to any one backend. */
export interface AgentUiRequestPayload {
  engineId: string;
  requestId: string;
  runId: string;
  id: string;
  method: string;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  params?: unknown;
}

export interface AgentUiRequestResolvedPayload {
  engineId: string;
  requestId: string;
  runId: string;
  id: string;
  resolution: 'answered' | 'cancelled' | 'timeout' | 'native';
}

/** Build an `agent.ui.request` RuntimeEvent inline (no core event factory — this
 *  is a renderer-only host→UI bridge). Matches the envelope shape the core
 *  factories return so `runtimeEventBus.emit` typechecks against RuntimeEvent. */
function agentUiRequestEvent(
  companyId: string,
  threadId: string,
  payload: AgentUiRequestPayload,
): RuntimeEvent<AgentUiRequestPayload> {
  return {
    type: AGENT_UI_REQUEST_EVENT,
    entityId: payload.id,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}

function agentUiRequestResolvedEvent(
  companyId: string,
  threadId: string,
  payload: AgentUiRequestResolvedPayload,
): RuntimeEvent<AgentUiRequestResolvedPayload> {
  return {
    type: AGENT_UI_REQUEST_RESOLVED_EVENT,
    entityId: payload.id,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}

/** Build a `mission.evaluation.submitted` RuntimeEvent inline (renderer-only
 *  host→controller bridge — no core factory), mirroring agentUiRequestEvent. */
function missionEvaluationSubmittedEvent(
  companyId: string,
  threadId: string,
  payload: MissionEvaluationSubmittedPayload,
): RuntimeEvent<MissionEvaluationSubmittedPayload> {
  return {
    type: MISSION_EVALUATION_SUBMITTED_EVENT,
    entityId: payload.criterionId,
    entityType: 'runtime',
    companyId,
    threadId,
    timestamp: Date.now(),
    payload,
  };
}

function piRunScope(
  projectId: string | null,
  threadId: string,
  employeeId: string | null,
  runId?: string,
) {
  return {
    conversationKey: `${projectId ?? ''}::${threadId}::${employeeId ?? ''}`,
    runId: runId || `pi-${crypto.randomUUID()}`,
    threadId,
  };
}

function toolStatus(status: PiAgentHostEvent & { kind: 'tool' }) {
  if (status.status === 'failed') return 'error' as const;
  if (status.status === 'completed') return 'completed' as const;
  return 'started' as const;
}

function createWorkspaceStatusEmitter({
  engineId,
  companyId,
  threadId,
  employeeId,
  runScope,
  rootRun,
  emitRootBus,
}: {
  engineId: string;
  companyId: string;
  threadId: string;
  employeeId: string | null;
  runScope: ReturnType<typeof piRunScope>;
  rootRun: (type: AgentRunEvent['type'], payload: AgentRunEvent['payload']) => AgentRunEvent;
  emitRootBus: (event: AgentRunEvent) => void;
}): (provenance: WorkspaceProvenance) => void {
  let emitted = false;
  return (workspaceProvenance) => {
    if (emitted) return;
    emitted = true;
    const toolCallId = `${runScope.runId}:workspace-status`;
    const startedAt = Date.now();
    for (const status of ['started', 'completed'] as const) {
      runtimeEventBus.emit(
        toolExecutionTelemetry(companyId, threadId, {
          toolCallId,
          toolName: 'Workspace',
          toolType: 'builtin',
          evidenceClass: 'offisim-gateway',
          threadId,
          nodeName: engineId,
          employeeId: employeeId ?? undefined,
          startedAt,
          ...(status === 'completed' ? { completedAt: startedAt, durationMs: 0 } : {}),
          status,
          workspaceProvenance,
          chatConversationKey: runScope.conversationKey,
          chatRunId: runScope.runId,
        }),
      );
      emitRootBus(
        rootRun(status === 'started' ? 'tool.started' : 'tool.completed', {
          toolCallId,
          toolName: 'Workspace',
          status,
        }),
      );
    }
  };
}

function hostModelRef(
  model: Extract<PiAgentHostEvent, { kind: 'started' }>['model'],
): string | null {
  if (model?.api === 'codex-app-server' && model.catalogId?.trim()) {
    return `codex:${model.catalogId.trim()}`;
  }
  if (!model?.id) return null;
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

export interface ResolvedApiExecutionSelection {
  readonly target: AiExecutionTarget;
  readonly runtimeModelRef: string;
}

export type ResolvedRuntimeExecutionSelection = ResolvedApiExecutionSelection;

export function isSameExecutionTarget(
  expected: AiExecutionTarget | null | undefined,
  actual: AiExecutionTarget | null | undefined,
): boolean {
  return Boolean(
    expected &&
      actual &&
      expected.engineId === actual.engineId &&
      expected.accountId === actual.accountId &&
      expected.billingMode === actual.billingMode &&
      expected.modelId === actual.modelId &&
      expected.modelSource.kind === actual.modelSource.kind &&
      expected.modelSource.sourceUrl === actual.modelSource.sourceUrl &&
      expected.modelSource.checkedAt === actual.modelSource.checkedAt,
  );
}

function availableApiModel(status: AiRuntimeStatus, model: AiModelCatalogEntry): boolean {
  const account = status.accounts.find(
    (candidate) => candidate.engineId === model.engineId && candidate.accountId === model.accountId,
  );
  return Boolean(
    model.engineId === 'api' &&
      model.billingMode === 'api' &&
      model.runtimeModelRef.trim() &&
      model.modelId.trim() &&
      (model.availability === 'available' ||
        (model.availability === 'expiring' &&
          model.expiresAt &&
          Date.parse(model.expiresAt) > Date.now())) &&
      account?.billingMode === 'api' &&
      account.status === 'available' &&
      account.capabilities.execute.status === 'available' &&
      account.capabilities.models.status === 'available',
  );
}

function availableRuntimeModel(status: AiRuntimeStatus, model: AiModelCatalogEntry): boolean {
  const account = status.accounts.find(
    (candidate) => candidate.engineId === model.engineId && candidate.accountId === model.accountId,
  );
  return Boolean(
    model.engineId.trim() &&
      model.runtimeModelRef.trim() &&
      model.modelId.trim() &&
      (model.availability === 'available' ||
        (model.availability === 'expiring' &&
          model.expiresAt &&
          Date.parse(model.expiresAt) > Date.now())) &&
      account?.engineId === model.engineId &&
      account.billingMode === model.billingMode &&
      account.status === 'available' &&
      account.capabilities.execute.status === 'available' &&
      account.capabilities.models.status === 'available',
  );
}

/** Resolve one globally unique model/account/engine before the gateway crosses
 * into an adapter. Exact model ids are accepted only when they identify one
 * catalog row; adapter-private runtime refs remain the unambiguous selector. */
export function resolveRuntimeExecutionSelection(
  statusValue: unknown,
  requestedModel: string | undefined,
  frozenTarget: AiExecutionTarget | undefined,
  frozenRuntimeModelRef?: string,
): ResolvedRuntimeExecutionSelection {
  const status = statusValue as Partial<AiRuntimeStatus>;
  if (!Array.isArray(status.accounts) || !Array.isArray(status.models)) {
    throw new Error('AI Accounts status is unavailable. Check the selected account.');
  }
  const runtimeStatus: AiRuntimeStatus = {
    accounts: status.accounts,
    models: status.models,
    checkedAt: typeof status.checkedAt === 'string' ? status.checkedAt : '',
  };
  const candidates = runtimeStatus.models.filter((model) =>
    availableRuntimeModel(runtimeStatus, model),
  );
  const requested = requestedModel?.trim();
  let selected: AiModelCatalogEntry | undefined;
  if (frozenTarget) {
    const validTarget = validateExecutionTarget(frozenTarget);
    if (!validTarget) throw new Error('This task does not have a valid execution target.');
    const frozenSelector = frozenRuntimeModelRef?.trim();
    const matches = candidates.filter(
      (model) =>
        model.engineId === validTarget.engineId &&
        model.accountId === validTarget.accountId &&
        model.billingMode === validTarget.billingMode &&
        model.modelId === validTarget.modelId &&
        (!frozenSelector || model.runtimeModelRef === frozenSelector) &&
        (!requested || requested === model.runtimeModelRef || requested === model.modelId),
    );
    if (matches.length !== 1) {
      throw new Error("The task's saved AI account or exact model is no longer available.");
    }
    selected = matches[0];
    if (!selected) throw new Error("The task's saved AI model selector is unavailable.");
    return { target: validTarget, runtimeModelRef: selected.runtimeModelRef };
  }
  if (requested) {
    const runtimeRefMatch = candidates.find((model) => model.runtimeModelRef === requested);
    if (runtimeRefMatch) {
      selected = runtimeRefMatch;
    } else {
      const modelIdMatches = candidates.filter((model) => model.modelId === requested);
      if (modelIdMatches.length !== 1) {
        throw new Error(`The selected exact AI model is unavailable or ambiguous: ${requested}.`);
      }
      [selected] = modelIdMatches;
    }
  } else {
    selected = candidates.find((model) => model.availability === 'available');
  }
  if (!selected) throw new Error('No verified, available AI model was reported by an account.');
  const target = validateExecutionTarget({
    engineId: selected.engineId,
    accountId: selected.accountId,
    billingMode: selected.billingMode,
    modelId: selected.modelId,
    modelSource: selected.source,
  });
  if (!target) throw new Error('The selected model catalog entry has invalid provenance.');
  return { target, runtimeModelRef: selected.runtimeModelRef };
}

export function resolveApiExecutionSelection(
  statusValue: unknown,
  requestedModel: string | undefined,
  frozenTarget: AiExecutionTarget | undefined,
): ResolvedApiExecutionSelection {
  const status = statusValue as Partial<AiRuntimeStatus>;
  if (!Array.isArray(status.accounts) || !Array.isArray(status.models)) {
    throw new Error('AI Accounts status is unavailable. Check the configured API account.');
  }
  const runtimeStatus: AiRuntimeStatus = {
    accounts: status.accounts,
    models: status.models,
    checkedAt: typeof status.checkedAt === 'string' ? status.checkedAt : '',
  };
  const candidates = runtimeStatus.models.filter((model) =>
    availableApiModel(runtimeStatus, model),
  );
  const requested = requestedModel?.trim();
  let selected: AiModelCatalogEntry | undefined;
  if (frozenTarget) {
    const validTarget = validateExecutionTarget(frozenTarget);
    if (!validTarget || validTarget.engineId !== 'api' || validTarget.billingMode !== 'api') {
      throw new Error('This task does not have a valid API execution target.');
    }
    selected = candidates.find(
      (model) =>
        model.engineId === validTarget.engineId &&
        model.accountId === validTarget.accountId &&
        model.billingMode === validTarget.billingMode &&
        model.modelId === validTarget.modelId &&
        (!requested || requested === model.runtimeModelRef || requested === model.modelId),
    );
    if (!selected) {
      throw new Error("The task's saved API account or exact model is no longer available.");
    }
    return { target: validTarget, runtimeModelRef: selected.runtimeModelRef };
  }
  if (requested) {
    const matches = candidates.filter(
      (model) => model.runtimeModelRef === requested || model.modelId === requested,
    );
    if (matches.length !== 1) {
      throw new Error(`The selected exact API model is unavailable or ambiguous: ${requested}.`);
    }
    [selected] = matches;
  } else {
    selected = candidates.find((model) => model.availability === 'available');
  }
  if (!selected) {
    throw new Error('No verified, stable API model is available for the configured account.');
  }
  const target = validateExecutionTarget({
    engineId: selected.engineId,
    accountId: selected.accountId,
    billingMode: selected.billingMode,
    modelId: selected.modelId,
    modelSource: selected.source,
  });
  if (!target) {
    throw new Error('The selected model catalog entry has invalid execution provenance.');
  }
  return { target, runtimeModelRef: selected.runtimeModelRef };
}

interface PersistedRunContext {
  requestId?: string | null;
  streamCursor?: number | null;
  workspaceBinding: TaskWorkspaceBindingProjection | null;
  workspaceRequirement: WorkspaceRequirement;
  workspaceAvailability: 'pending' | 'bound' | 'unavailable';
  workspaceProvenance?: WorkspaceProvenance;
  runtime: 'agent-runtime';
  executionTarget: AiExecutionTarget | null;
  piSdkVersion?: string;
  wireProtocolVersion?: number;
  nativeRuntimeVersion?: string;
  nativeProtocolVersion?: number;
  model: string | null;
  nativeSessionId?: string;
  nativeSessionPrestartErrorCode?: string;
  /** Reload recovery may reconstruct only an exact plain Conversation Turn. */
  recoveryLane?: 'conversation' | 'direct-delegation' | 'mission';
  provenance: TurnExecutionProvenance | null;
  permissionMode: string;
  thinkingLevel: string | null;
  projectId: string | null;
  conversationProjection: ConversationRunProjectionRef | null;
  createdAt: string;
}

interface SharedHostStreamState {
  workspaceGate: WorkspaceBindingStreamGate<TaskWorkspaceBindingClaim, WorkspaceUnavailableEvent>;
  runtimeContext: Partial<PersistedRunContext>;
  contentText: string;
  reasoningText: string;
  readonly startedAtByTool: Map<string, number>;
}

interface SharedHostEventConsumer {
  event: PiAgentHostEvent;
  state: SharedHostStreamState;
  policy: WorkspaceStreamConsumptionPolicy;
  expectedWorkspace: {
    projectId: string | null;
    access: 'read' | 'write' | null;
    threadId: string;
    turnId: string;
    requestId: string;
  };
  workspaceRequirement: WorkspaceRequirement;
  runScope: ReturnType<typeof piRunScope>;
  employeeId: string | null;
  rootRun: (type: AgentRunEvent['type'], payload: AgentRunEvent['payload']) => AgentRunEvent;
  emitRootBus: (event: AgentRunEvent) => void;
  emitWorkspaceStatus: (provenance: WorkspaceProvenance) => void;
  onWorkspaceAccepted: () => void;
  onRejected: (message: string) => void;
  onStarted: (event: Extract<PiAgentHostEvent, { kind: 'started' }>) => void;
  persistContext: () => void;
}

function projectWorkspaceBinding(claim: TaskWorkspaceBindingClaim): TaskWorkspaceBindingProjection {
  const projection = parseTaskWorkspaceBindingProjection(claim);
  if (!projection) throw new Error('Backend returned an invalid workspace binding projection.');
  return projection;
}

function bindingMatchesRun(
  claim: TaskWorkspaceBindingClaim,
  expected: {
    companyId: string;
    projectId: string;
    threadId: string;
    turnId: string;
    requestId: string;
    access: 'read' | 'write';
  },
): boolean {
  return (
    parseTaskWorkspaceBindingProjection(claim) !== null &&
    typeof claim.workspaceRef === 'string' &&
    claim.workspaceRef.trim().length > 0 &&
    claim.historyId.trim().length > 0 &&
    claim.companyId === expected.companyId &&
    claim.projectId === expected.projectId &&
    claim.threadId === expected.threadId &&
    claim.turnId === expected.turnId &&
    claim.requestId === expected.requestId &&
    claim.access === expected.access
  );
}

function isSameWorkspaceBindingClaim(
  first: TaskWorkspaceBindingClaim,
  next: TaskWorkspaceBindingClaim,
): boolean {
  return (
    first.workspaceRef === next.workspaceRef &&
    first.historyId === next.historyId &&
    first.companyId === next.companyId &&
    first.projectId === next.projectId &&
    first.threadId === next.threadId &&
    first.turnId === next.turnId &&
    first.requestId === next.requestId &&
    first.access === next.access
  );
}

function workspaceUnavailableMatchesRun(
  event: WorkspaceUnavailableEvent,
  expected: {
    projectId: string;
    threadId: string;
    turnId: string;
    requestId: string;
  },
): boolean {
  return (
    event.projectId === expected.projectId &&
    event.threadId === expected.threadId &&
    event.turnId === expected.turnId &&
    event.requestId === expected.requestId &&
    event.source === 'workspace_recovery' &&
    (event.reasonCode === 'none' || event.reasonCode === 'ambiguous')
  );
}

function isSameWorkspaceUnavailable(
  first: WorkspaceUnavailableEvent,
  next: WorkspaceUnavailableEvent,
): boolean {
  return (
    first.projectId === next.projectId &&
    first.threadId === next.threadId &&
    first.turnId === next.turnId &&
    first.requestId === next.requestId &&
    first.source === next.source &&
    first.reasonCode === next.reasonCode
  );
}

function resolveWorkspaceRequirement(
  input: DesktopAgentRunInput,
  commandName: 'agent_runtime_execute' | 'agent_runtime_resume',
): WorkspaceRequirement {
  if (
    commandName === 'agent_runtime_resume' ||
    input.missionId?.trim() ||
    input.missionContextJson?.trim() ||
    input.directDelegation
  ) {
    return 'required';
  }
  return input.workspaceRequirement === 'required' ? 'required' : 'optional';
}

function parseRunContext(raw: string | null | undefined): Partial<PersistedRunContext> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    const workspaceBinding = parseTaskWorkspaceBindingProjection(parsed.workspaceBinding);
    const workspaceProvenance = parseWorkspaceProvenance(parsed.workspaceProvenance);
    const workspaceAvailability =
      parsed.workspaceAvailability === 'bound' && workspaceBinding
        ? 'bound'
        : parsed.workspaceAvailability === 'unavailable' &&
            workspaceProvenance?.availability === 'unavailable'
          ? 'unavailable'
          : 'pending';
    return {
      requestId: typeof parsed.requestId === 'string' ? parsed.requestId : null,
      streamCursor: typeof parsed.streamCursor === 'number' ? parsed.streamCursor : null,
      workspaceBinding,
      workspaceRequirement: parsed.workspaceRequirement === 'optional' ? 'optional' : 'required',
      workspaceAvailability,
      workspaceProvenance: workspaceProvenance ?? undefined,
      runtime: parsed.runtime === 'agent-runtime' ? 'agent-runtime' : undefined,
      executionTarget: validateExecutionTarget(parsed.executionTarget),
      piSdkVersion: typeof parsed.piSdkVersion === 'string' ? parsed.piSdkVersion : undefined,
      wireProtocolVersion:
        typeof parsed.wireProtocolVersion === 'number' ? parsed.wireProtocolVersion : undefined,
      nativeRuntimeVersion:
        typeof parsed.nativeRuntimeVersion === 'string' ? parsed.nativeRuntimeVersion : undefined,
      nativeProtocolVersion:
        typeof parsed.nativeProtocolVersion === 'number' ? parsed.nativeProtocolVersion : undefined,
      model: typeof parsed.model === 'string' ? parsed.model : null,
      nativeSessionId:
        typeof parsed.nativeSessionId === 'string' && parsed.nativeSessionId.trim()
          ? parsed.nativeSessionId.trim()
          : undefined,
      nativeSessionPrestartErrorCode:
        typeof parsed.nativeSessionPrestartErrorCode === 'string' &&
        parsed.nativeSessionPrestartErrorCode.trim()
          ? parsed.nativeSessionPrestartErrorCode.trim()
          : undefined,
      recoveryLane:
        parsed.recoveryLane === 'conversation' ||
        parsed.recoveryLane === 'direct-delegation' ||
        parsed.recoveryLane === 'mission'
          ? parsed.recoveryLane
          : undefined,
      provenance:
        parsed.provenance && typeof parsed.provenance === 'object'
          ? (parsed.provenance as TurnExecutionProvenance)
          : null,
      permissionMode: typeof parsed.permissionMode === 'string' ? parsed.permissionMode : undefined,
      thinkingLevel: typeof parsed.thinkingLevel === 'string' ? parsed.thinkingLevel : null,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : null,
      conversationProjection:
        parsed.conversationProjection &&
        typeof parsed.conversationProjection === 'object' &&
        typeof (parsed.conversationProjection as Record<string, unknown>).userMessageId ===
          'string' &&
        typeof (parsed.conversationProjection as Record<string, unknown>).assistantMessageId ===
          'string' &&
        ((parsed.conversationProjection as Record<string, unknown>).source === 'office' ||
          (parsed.conversationProjection as Record<string, unknown>).source === 'workspace')
          ? (parsed.conversationProjection as ConversationRunProjectionRef)
          : null,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
    };
  } catch {
    return null;
  }
}

function runContextRecord(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mergeRunContextPreservingNativeIdentity(
  currentRaw: string | null | undefined,
  patch: Partial<PersistedRunContext>,
): Record<string, unknown> {
  const current = runContextRecord(currentRaw);
  const currentNativeSessionId = nonEmptyString(current.nativeSessionId);
  const patchNativeSessionId = nonEmptyString(patch.nativeSessionId);
  if (
    currentNativeSessionId &&
    patchNativeSessionId &&
    currentNativeSessionId !== patchNativeSessionId
  ) {
    throw new Error('Native Conversation session identity changed during durable persistence.');
  }
  const definedPatch = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
  return { ...current, ...definedPatch };
}

class AgentHostCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgentHostCommandError';
  }
}

/** Extract only the structured Tauri error prefix. Free-text provider messages
 * cannot authorize a native-session reset. */
export function nativeSessionPrestartCode(error: unknown): string | null {
  // Channel events are presentation telemetry and never authorize reset. Only
  // the final Tauri command rejection reaches this parser as a plain IPC error.
  if (error instanceof AgentHostCommandError) return null;
  const message = error instanceof Error ? error.message : String(error ?? '');
  const separator = message.indexOf(':');
  if (separator <= 0) return null;
  const code = message.slice(0, separator).trim();
  return isResettableNativeSessionPrestartCode(code) ? code : null;
}

/** Host stream errors are untrusted provider/sidecar telemetry. Branding them
 * keeps forged reserved prefixes out of the Fresh-session authority path. */
export function nonAuthorizingAgentHostError(message: string): Error {
  return new AgentHostCommandError('channel', message);
}

export function trustedNativeSessionPrestartCode(
  error: unknown,
  nativeSessionStarted: boolean,
): string | null {
  return nativeSessionStarted ? null : nativeSessionPrestartCode(error);
}

async function persistRunContextPatchWithRepositories(
  repos: RuntimeRepositories,
  runId: string,
  patch: Partial<PersistedRunContext>,
  options: {
    sessionFile?: string;
    conversationCheckpoint?: ConversationStreamCheckpoint;
  } = {},
): Promise<void> {
  let expectedContextJson: string | null = null;
  let expectedSessionFile: string | null = null;
  await repos.asyncTransact(async (transactionRepos) => {
    const tx = transactionRepos ?? repos;
    const current = await tx.agentRuns.findById(runId);
    if (!current) throw new Error(`Cannot update missing agent run ${runId}.`);
    const nextContext = mergeRunContextPreservingNativeIdentity(
      current.runtime_context_json,
      patch,
    );
    const nextContextJson = JSON.stringify(nextContext);
    const sessionFile = options.sessionFile?.trim();
    if (sessionFile && current.session_file?.trim() && current.session_file !== sessionFile) {
      throw new Error('Native Conversation session file changed during durable persistence.');
    }
    await Promise.all([
      tx.agentRuns.updateRuntimeContext(runId, nextContextJson),
      ...(sessionFile ? [tx.agentRuns.updateStatus(runId, 'running', { sessionFile })] : []),
      ...(options.conversationCheckpoint
        ? [
            persistChatMessageWithRepositories({
              message: options.conversationCheckpoint.message,
              companyId: options.conversationCheckpoint.companyId,
              projectId: options.conversationCheckpoint.projectId,
              repos: tx,
            }),
          ]
        : []),
    ]);
    expectedContextJson = nextContextJson;
    expectedSessionFile = sessionFile || null;
  });
  // Tauri's queued transaction adapter does not expose read-your-writes through
  // SELECT inside the callback. Read from the main repository only after the
  // transaction returned, which is the durable commit boundary.
  const readback = await repos.agentRuns.findById(runId);
  if (!readback || !expectedContextJson || readback.runtime_context_json !== expectedContextJson) {
    throw new Error('Agent run context durable readback did not match the committed update.');
  }
  if (expectedSessionFile && readback.session_file !== expectedSessionFile) {
    throw new Error('Native Conversation session file durable readback did not match.');
  }
  if (expectedSessionFile && readback.status !== 'running') {
    throw new Error('Native Conversation session checkpoint did not remain running.');
  }
  const expectedNativeSessionId = nonEmptyString(patch.nativeSessionId);
  if (
    expectedNativeSessionId &&
    nonEmptyString(runContextRecord(readback.runtime_context_json).nativeSessionId) !==
      expectedNativeSessionId
  ) {
    throw new Error('Native Conversation session id durable readback did not match.');
  }
}

/** Production Started checkpoint. File-backed engines persist an exact native
 * file/id pair; opaque engines persist only the native id. Native home paths
 * never cross this product boundary. */
export async function persistStartedNativeSessionIdentity(input: {
  repos: RuntimeRepositories;
  runId: string;
  runtimeContext: Partial<PersistedRunContext>;
  event: Extract<PiAgentHostEvent, { kind: 'started' }>;
  engineId?: string;
}): Promise<void> {
  const engineId = input.engineId ?? 'api';
  const sessionId = input.event.sessionId?.trim();
  const sessionFile = input.event.sessionFile?.trim();
  if (!sessionId || (engineId === 'api' && !sessionFile)) {
    throw new AgentHostCommandError(
      'protocol',
      'Agent runtime Started event did not include its required native session identity.',
    );
  }
  if (engineId !== 'api' && sessionFile) {
    throw new AgentHostCommandError(
      'protocol',
      'Opaque native runtime exposed a session file outside its Agent Home boundary.',
    );
  }
  const actualModel = hostModelRef(input.event.model);
  const nextContext: Partial<PersistedRunContext> = {
    ...input.runtimeContext,
    nativeSessionId: sessionId,
    ...(actualModel ? { model: actualModel } : {}),
  };
  await persistRunContextPatchWithRepositories(
    input.repos,
    input.runId,
    nextContext,
    sessionFile ? { sessionFile } : {},
  );
  // The object is shared with cursor and terminal checkpoints. Do not expose a
  // native identity until its engine-specific checkpoint passed durable readback.
  input.runtimeContext.nativeSessionId = sessionId;
  if (actualModel) input.runtimeContext.model = actualModel;
}

function normalizeStreamCursor(cursor: unknown): number {
  return Number.isSafeInteger(cursor) && Number(cursor) > 0 ? Number(cursor) : 0;
}

function throwIfRunAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Run was stopped before native work started.');
  error.name = 'AbortError';
  throw error;
}

class DesktopNativeAgentRuntime implements RuntimeEngineAdapter {
  readonly engineId: string;
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
  // Serializes agent-run persistence in event order, catches failures at each
  // task boundary, and coalesces high-frequency stream cursors per run.
  private readonly persistQueue = new AgentRunPersistenceQueue();

  constructor(
    private readonly companyId: string,
    private readonly repos: RuntimeRepositories,
    private readonly config: NativeEngineRuntimeConfig,
    private readonly commands: NativeAgentCommandTransport = createNativeAgentCommandTransport(),
  ) {
    this.engineId = config.engineId;
  }

  private invokeEnhance(args: CommandArgs<'agent_runtime_enhance'>) {
    return this.engineId === 'codex'
      ? this.commands.enhanceCodex(args)
      : this.commands.enhanceApi(args);
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
    return this.commands.answer(this.config.engineId, args);
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
    if (this.engineId === 'codex') return;
    await invokeCommand('agent_runtime_confirm_execution', {
      requestId,
      prepareId: event.prepareId,
      targetDigest: event.targetDigest,
    });
  }

  private enqueuePersist(work: () => Promise<void>, label = 'agent runtime persistence'): void {
    this.persistQueue.enqueue(label, work);
  }

  /** Consume every non-terminal host fact through one typed state machine.
   * Live execute and reattach supply only their genuinely different checkpoint
   * and terminal behavior; workspace/tool/UI/run semantics stay identical. */
  private consumeSharedHostEvent(input: SharedHostEventConsumer): boolean {
    const {
      event,
      state,
      expectedWorkspace,
      workspaceRequirement,
      runScope,
      employeeId,
      rootRun,
      emitRootBus,
    } = input;

    if (event.kind === 'workspaceBound') {
      const matchesExpectedTurn = Boolean(
        expectedWorkspace.projectId &&
          expectedWorkspace.access &&
          bindingMatchesRun(event, {
            companyId: this.companyId,
            projectId: expectedWorkspace.projectId,
            threadId: expectedWorkspace.threadId,
            turnId: expectedWorkspace.turnId,
            requestId: expectedWorkspace.requestId,
            access: expectedWorkspace.access,
          }),
      );
      const matchesBoundClaim =
        state.workspaceGate.status !== 'bound' ||
        isSameWorkspaceBindingClaim(state.workspaceGate.claim, event);
      state.workspaceGate = acceptWorkspaceBinding(
        state.workspaceGate,
        event,
        matchesExpectedTurn,
        matchesBoundClaim,
      );
      if (state.workspaceGate.status === 'rejected') {
        input.onRejected('Backend returned a workspace binding for a different Turn.');
        return true;
      }
      state.runtimeContext.workspaceBinding = projectWorkspaceBinding(event);
      state.runtimeContext.workspaceAvailability = 'bound';
      const workspaceProvenance = notableWorkspaceProvenanceForBinding(event);
      if (workspaceProvenance) {
        state.runtimeContext.workspaceProvenance = workspaceProvenance;
        input.emitWorkspaceStatus(workspaceProvenance);
      } else {
        state.runtimeContext.workspaceProvenance = undefined;
      }
      input.onWorkspaceAccepted();
      input.persistContext();
      return true;
    }

    if (event.kind === 'workspaceUnavailable') {
      const matchesExpectedTurn = Boolean(
        expectedWorkspace.projectId &&
          workspaceUnavailableMatchesRun(event, {
            projectId: expectedWorkspace.projectId,
            threadId: expectedWorkspace.threadId,
            turnId: expectedWorkspace.turnId,
            requestId: expectedWorkspace.requestId,
          }),
      );
      const matchesUnavailable =
        state.workspaceGate.status !== 'unavailable' ||
        isSameWorkspaceUnavailable(state.workspaceGate.unavailable, event);
      state.workspaceGate = acceptWorkspaceUnavailable(
        state.workspaceGate,
        event,
        matchesExpectedTurn,
        matchesUnavailable,
      );
      if (state.workspaceGate.status === 'rejected') {
        input.onRejected('Backend returned an unavailable workspace state for a different Turn.');
        return true;
      }
      state.runtimeContext.workspaceBinding = null;
      state.runtimeContext.workspaceAvailability = 'unavailable';
      state.runtimeContext.workspaceProvenance = workspaceProvenanceForUnavailable(
        event,
        workspaceRequirement,
      );
      input.onWorkspaceAccepted();
      input.emitWorkspaceStatus(state.runtimeContext.workspaceProvenance);
      input.persistContext();
      if (workspaceRequirement === 'required') {
        input.onRejected('This run requires an available Project folder.');
      }
      return true;
    }

    if (!canConsumeWorkspaceEvent(state.workspaceGate, event, input.policy)) {
      if (input.policy !== 'terminal-reconcile' && state.workspaceGate.status !== 'rejected') {
        state.workspaceGate = rejectWorkspaceBinding(state.workspaceGate);
        input.onRejected(
          `Backend emitted unsafe ${event.kind} activity without a task workspace binding.`,
        );
      }
      return true;
    }

    if (event.kind === 'started') {
      input.onStarted(event);
      return true;
    }
    if (event.kind === 'messageDelta') {
      if (!event.delta) return true;
      const channel = event.channel === 'reasoning' ? 'reasoning' : 'content';
      if (channel === 'reasoning') state.reasoningText += event.delta;
      else state.contentText += event.delta;
      runtimeEventBus.emit(
        llmStreamChunk(
          this.companyId,
          expectedWorkspace.threadId,
          this.engineId,
          event.delta,
          channel,
          runScope,
        ),
      );
      return true;
    }
    if (event.kind === 'messageEnd') {
      if (event.text) state.contentText = event.text;
      return true;
    }
    if (event.kind === 'tool') {
      const startedAt = state.startedAtByTool.get(event.toolCallId) ?? Date.now();
      if (event.status === 'started') state.startedAtByTool.set(event.toolCallId, startedAt);
      const completedAt =
        event.status === 'completed' || event.status === 'failed' ? Date.now() : undefined;
      runtimeEventBus.emit(
        toolExecutionTelemetry(this.companyId, expectedWorkspace.threadId, {
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          toolType: 'builtin',
          evidenceClass: 'sdk-native',
          threadId: expectedWorkspace.threadId,
          nodeName: this.engineId,
          employeeId: employeeId ?? undefined,
          startedAt,
          completedAt,
          durationMs:
            event.durationMs ?? (completedAt ? Math.max(0, completedAt - startedAt) : undefined),
          status: toolStatus(event),
          detail: event.detail,
          errorType:
            event.status === 'failed'
              ? (event.detail ?? `${this.engineId}_tool_failed`)
              : undefined,
          chatConversationKey: runScope.conversationKey,
          chatRunId: runScope.runId,
        }),
      );
      if (event.status === 'started') {
        emitRootBus(
          rootRun('tool.started', {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: 'started',
            detail: event.detail,
          }),
        );
      } else if (event.status === 'completed' || event.status === 'failed') {
        emitRootBus(
          rootRun('tool.completed', {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            status: event.status,
            detail: event.detail,
          }),
        );
      }
      return true;
    }
    if (event.kind === 'uiRequest') {
      runtimeEventBus.emit(
        agentUiRequestEvent(this.companyId, expectedWorkspace.threadId, {
          engineId: this.engineId,
          requestId: expectedWorkspace.requestId,
          runId: expectedWorkspace.turnId,
          id: event.id,
          method: event.method,
          title: event.title,
          message: event.message,
          options: event.options,
          placeholder: event.placeholder,
          prefill: event.prefill,
          params: event.params,
        }),
      );
      if (event.method === 'confirm') {
        emitRootBus(
          rootRun('approval.requested', {
            uiRequestId: event.id,
            title: event.title,
            message: event.message,
          }),
        );
      }
      return true;
    }
    if (event.kind === 'uiRequestResolved') {
      runtimeEventBus.emit(
        agentUiRequestResolvedEvent(this.companyId, expectedWorkspace.threadId, {
          engineId: this.engineId,
          requestId: expectedWorkspace.requestId,
          runId: expectedWorkspace.turnId,
          id: event.id,
          resolution: event.resolution,
        }),
      );
      return true;
    }
    if (event.kind === 'agentRun') {
      if (event.runType === 'mcp.tool.called') {
        this.enqueuePersist(() => this.persistMcpToolCall(event, employeeId));
        return true;
      }
      if (event.runType === 'workspace.lease.snapshot') {
        this.enqueuePersist(() =>
          this.persistWorkspaceLeaseSnapshot(event, expectedWorkspace.projectId),
        );
        return true;
      }
      if (event.runType === 'evaluation_submitted') {
        const payload = (event.payload ?? {}) as {
          criterionId?: string;
          summary?: string;
          evidenceRefs?: string[];
        };
        if (typeof payload.criterionId === 'string' && payload.criterionId.trim()) {
          runtimeEventBus.emit(
            missionEvaluationSubmittedEvent(this.companyId, event.threadId, {
              runId: event.runId,
              rootRunId: event.rootRunId,
              criterionId: payload.criterionId,
              summary: typeof payload.summary === 'string' ? payload.summary : '',
              evidenceRefs: Array.isArray(payload.evidenceRefs)
                ? payload.evidenceRefs.filter((ref): ref is string => typeof ref === 'string')
                : [],
            }),
          );
        }
        return true;
      }
      if (event.runType === 'mission_state_query') return true;
      const agentEvent = {
        threadId: event.threadId,
        rootRunId: event.rootRunId,
        runId: event.runId,
        ...(event.parentRunId ? { parentRunId: event.parentRunId } : {}),
        ...(event.employeeId ? { employeeId: event.employeeId } : {}),
        ...(event.relation ? { relation: event.relation } : {}),
        ...(event.workKind ? { workKind: event.workKind } : {}),
        type: event.runType,
        payload: event.payload,
      } as AgentRunEvent;
      if (event.runType === 'artifact.created') {
        this.enqueuePersist(() => this.persistArtifact(agentEvent, state.workspaceGate.claim));
      } else {
        runtimeEventBus.emit(agentRunEvent(this.companyId, agentEvent));
        this.enqueuePersist(() => this.persistAgentRun(agentEvent));
      }
      return true;
    }
    return false;
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

  private async buildLiveConversationTerminalMessage(
    row: AgentRunRow,
    context: Partial<PersistedRunContext>,
    terminal: LiveConversationTerminalPayload | undefined,
  ): Promise<ChatMessage | null> {
    const projection = context.conversationProjection;
    if (!projection || !terminal) return null;
    const existing = await loadPersistedChatMessageWithRepositories({
      repos: this.repos,
      threadId: row.thread_id,
      messageId: projection.assistantMessageId,
    });
    const body = terminal.text.trim() || existing?.body.trim() || '';
    const reasoning = terminal.reasoning?.trim() || existing?.reasoning?.trim();
    const workspaceProvenance = context.workspaceProvenance ?? existing?.workspaceProvenance;
    if (!body && !reasoning && !workspaceProvenance && terminal.status !== 'completed') return null;
    const status =
      terminal.status === 'completed'
        ? ('complete' as const)
        : terminal.status === 'failed'
          ? ('failed' as const)
          : ('interrupted' as const);
    return {
      id: projection.assistantMessageId,
      threadId: row.thread_id,
      author: 'employee',
      employeeId: row.employee_id,
      body,
      ...(reasoning ? { reasoning } : {}),
      at: existing?.at ?? (Date.parse(context.createdAt ?? '') || Date.now()),
      replyToMessageId: projection.userMessageId,
      attemptId: row.run_id,
      status,
      ...(workspaceProvenance ? { workspaceProvenance } : {}),
    };
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
      let workspaceBindingGate = createWorkspaceBindingGate<
        TaskWorkspaceBindingClaim,
        WorkspaceUnavailableEvent
      >();
      const sharedHostState: SharedHostStreamState = {
        workspaceGate: workspaceBindingGate,
        runtimeContext,
        contentText: accumulatedContentText,
        reasoningText: accumulatedReasoningText,
        startedAtByTool,
      };
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
            this.persistRootTerminal(
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
        void outcome.catch(async (initialError) => {
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
          });
          publishTerminal();
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
        if (event.kind === 'streamCursor') {
          if (pendingTerminalCheckpoint) {
            const terminal = pendingTerminalCheckpoint;
            pendingTerminalCheckpoint = undefined;
            queueTerminalCheckpoint(
              `persist terminal checkpoint for ${row.run_id}`,
              terminal,
              event.cursor,
            );
            return;
          }
          this.queueRunStreamCursor(
            row.run_id,
            runtimeContext,
            event.cursor,
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
          return;
        }
        if (event.kind === 'executionPrepared') {
          if (!executionAckAllowed) return;
          if (!executionTarget) {
            failReattachedBinding('The running task has no durable AI execution target.');
            return;
          }
          let identity: TurnExecutionProvenance;
          try {
            identity = parsePreparedExecutionIdentity(event);
          } catch (error) {
            failReattachedBinding(error instanceof Error ? error.message : String(error));
            return;
          }
          const existing = executionPreparations.get(event.prepareId);
          if (existing) {
            if (existing.targetDigest !== event.targetDigest) {
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
            event,
            row.run_id,
            requestId,
            executionTarget,
          );
          executionPreparations.set(event.prepareId, {
            targetDigest: event.targetDigest,
            identity,
            promise,
          });
          terminalCheckpointPromises.push(promise);
          void promise.catch((error: unknown) => {
            failReattachedBinding(error instanceof Error ? error.message : String(error));
          });
          return;
        }
        const sharedHandled = this.consumeSharedHostEvent({
          event,
          state: sharedHostState,
          policy: consumptionPolicy,
          expectedWorkspace: {
            projectId,
            access: expectedAccess,
            threadId: row.thread_id,
            turnId: row.run_id,
            requestId,
          },
          workspaceRequirement,
          runScope,
          employeeId: row.employee_id,
          rootRun,
          emitRootBus,
          emitWorkspaceStatus: emitWorkspaceStatusActivity,
          onWorkspaceAccepted: () => {},
          onRejected: failReattachedBinding,
          onStarted: (startedEvent) => {
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
          persistContext: () =>
            this.enqueuePersist(() => this.persistRunContextPatch(row.run_id, runtimeContext)),
        });
        workspaceBindingGate = sharedHostState.workspaceGate;
        accumulatedContentText = sharedHostState.contentText;
        accumulatedReasoningText = sharedHostState.reasoningText;
        if (sharedHandled) return;
        if (event.kind === 'result') {
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
            provenance = requireTurnExecutionProvenance(event.response.provenance, row.run_id);
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
            text: event.response.text || accumulatedContentText,
            ...(event.response.reasoning || accumulatedReasoningText
              ? { reasoning: event.response.reasoning || accumulatedReasoningText }
              : {}),
            provenance,
          };
          pendingTerminalCheckpoint = {
            status: 'completed',
            ...(event.response.usage ? { usage: event.response.usage } : {}),
            ...(conversationTerminal.text ? { summary: conversationTerminal.text } : {}),
            conversationTerminal,
          };
          if (this.inFlightByThread.get(row.thread_id) === requestId) {
            this.inFlightByThread.delete(row.thread_id);
          }
          return;
        }
        if (event.kind === 'error') {
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
          const failureKind = classifyRunFailure(event.message);
          const conversationTerminal: LiveConversationTerminalPayload = {
            runId: row.run_id,
            status: 'failed',
            text: accumulatedContentText,
            error: event.message,
            ...(accumulatedReasoningText.trim()
              ? { reasoning: accumulatedReasoningText.trim() }
              : {}),
            failureKind,
          };
          pendingTerminalCheckpoint = {
            status: 'failed',
            failureKind,
            summary: event.message,
            conversationTerminal,
          };
          if (this.inFlightByThread.get(row.thread_id) === requestId) {
            this.inFlightByThread.delete(row.thread_id);
          }
        }
      };

      let consumptionPolicy: 'bound-required' | 'workspace-optional' | 'terminal-reconcile' | null =
        null;
      const bufferedEvents: PiAgentHostEvent[] = [];
      let bufferedBindingGate = createWorkspaceBindingGate<
        TaskWorkspaceBindingClaim,
        WorkspaceUnavailableEvent
      >();
      const onEvent = new Channel<PiAgentHostEvent>();
      onEvent.onmessage = (event) => {
        if (consumptionPolicy) {
          consumeEvent(event, consumptionPolicy);
          return;
        }
        if (event.kind === 'workspaceBound') {
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
            return;
          }
        } else if (event.kind === 'workspaceUnavailable') {
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
            return;
          }
        }
        bufferedEvents.push(event);
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
        if (reattachSnapshot.running) liveRootRunIds.add(row.run_id);
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
        bootstrapSettled = true;
        handledRootRunIds.add(row.run_id);
      } catch (err: unknown) {
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
    throwIfRunAborted(signal);
    if (
      !this.config.supportsOffisimDelegation &&
      (input.missionId ||
        input.missionContextJson ||
        input.directDelegation ||
        input.delegationLimits)
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
    let finalText = '';
    let reasoningText = '';
    let channelError: Error | null = null;
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
    let resolvedModel = input.model?.trim() || undefined;
    let resolvedThinkingLevel =
      input.thinkingLevel?.trim() || resolveThreadThinkingOverride(input.threadId);
    const runtimeContext: PersistedRunContext = {
      requestId,
      streamCursor: 0,
      workspaceBinding:
        commandName === 'agent_runtime_resume' ? (resumeWorkspaceBinding ?? null) : null,
      workspaceRequirement,
      workspaceAvailability: commandName === 'agent_runtime_resume' ? 'bound' : 'pending',
      runtime: 'agent-runtime',
      executionTarget: input.executionTarget ?? null,
      ...(this.engineId === 'api'
        ? {
            piSdkVersion: this.config.runtimeVersion,
            wireProtocolVersion: this.config.protocolVersion,
          }
        : {
            nativeRuntimeVersion: this.config.runtimeVersion,
            nativeProtocolVersion: this.config.protocolVersion,
          }),
      model: resolvedModel ?? null,
      provenance: null,
      permissionMode,
      thinkingLevel: resolvedThinkingLevel ?? null,
      projectId,
      conversationProjection: input.conversationProjection ?? null,
      recoveryLane: input.missionId
        ? 'mission'
        : input.directDelegation
          ? 'direct-delegation'
          : 'conversation',
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
        this.enqueuePersist(() => this.persistAgentRun(startedEvt));
      }
    };

    let workspaceBindingGate = createWorkspaceBindingGate<
      TaskWorkspaceBindingClaim,
      WorkspaceUnavailableEvent
    >();
    const sharedHostState: SharedHostStreamState = {
      workspaceGate: workspaceBindingGate,
      runtimeContext,
      contentText: finalText,
      reasoningText,
      startedAtByTool,
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
    onEvent.onmessage = (event) => {
      if (event.kind === 'streamCursor') {
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
        return;
      }
      if (event.kind === 'executionPrepared') {
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
        return;
      }
      const workspacePolicy =
        workspaceRequirement === 'optional' ? 'workspace-optional' : 'bound-required';
      const sharedHandled = this.consumeSharedHostEvent({
        event,
        state: sharedHostState,
        policy: workspacePolicy,
        expectedWorkspace: {
          projectId,
          access: rootAccess,
          threadId: input.threadId,
          turnId: runScope.runId,
          requestId,
        },
        workspaceRequirement,
        runScope,
        employeeId: input.employeeId,
        rootRun,
        emitRootBus,
        emitWorkspaceStatus: emitWorkspaceStatusActivity,
        onWorkspaceAccepted: openRootRun,
        onRejected: (message) => {
          channelError ??= new Error(message);
          void abortRejectedBinding();
        },
        onStarted: (startedEvent) => {
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
        persistContext: () =>
          this.enqueuePersist(() => this.persistRunContextPatch(runScope.runId, runtimeContext)),
      });
      workspaceBindingGate = sharedHostState.workspaceGate;
      finalText = sharedHostState.contentText;
      reasoningText = sharedHostState.reasoningText;
      if (sharedHandled) return;
      if (event.kind === 'result') {
        finalText = event.response.text || finalText;
        try {
          const provenance = requireTurnExecutionProvenance(
            event.response.provenance,
            runScope.runId,
          );
          if (!executionTarget) {
            throw new Error('Agent runtime returned provenance without an execution target.');
          }
          assertSameExecutionAccount({ ...executionTarget, runId: runScope.runId }, provenance);
          assertSameExecutionAccount(
            requirePreparedExecutionIdentity(executionPreparations, runScope.runId),
            provenance,
          );
          runtimeContext.provenance = provenance;
          this.enqueuePersist(() => this.persistRunContextPatch(runScope.runId, runtimeContext));
        } catch (error) {
          channelError = error instanceof Error ? error : new Error(String(error));
          return;
        }
        this.flushRunStreamCursor(runScope.runId);
        return;
      }
      if (event.kind === 'error') {
        this.flushRunStreamCursor(runScope.runId);
        channelError = nonAuthorizingAgentHostError(event.message);
      }
    };

    // A new run must exist before child events can reference it. Resume already
    // has a durable interrupted row, so it stays untouched until workspaceBound
    // proves backend authority revalidation succeeded.
    if (commandName === 'agent_runtime_execute') openRootRun();

    this.inFlightByThread.set(input.threadId, requestId);
    const abortFromSignal = (): void => {
      this.abortedRequests.add(requestId);
      void this.invokeAbortOnce(requestId).catch((err: unknown) => {
        console.warn('[desktop-agent-runtime] resume abort failed', {
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
      // identity. MCP scope remains a separate safe degradation below.
      const { systemPromptAppend, skillPaths, runtimeSelection, roster } =
        await buildDelegationContext(this.repos, this.companyId, input.employeeId, {
          model: resolvedModel,
          thinkingLevel: resolvedThinkingLevel,
        });
      throwIfRunAborted(signal);
      // The gateway already froze the task's engine/account/model before entering
      // this adapter. Employee settings may still supply a thinking level, but
      // must never replace that exact model with a binding from another engine.
      if (commandName === 'agent_runtime_execute' && input.employeeId) {
        resolvedThinkingLevel = runtimeSelection.thinkingLevel;
        runtimeContext.thinkingLevel = resolvedThinkingLevel ?? null;
        this.enqueuePersist(() => this.persistRunContextPatch(runScope.runId, runtimeContext));
      }
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
      const rosterModels = this.config.supportsOffisimDelegation
        ? roster.map((entry) => entry.model?.trim()).filter(Boolean)
        : [];
      const runtimeStatus = rosterModels.length
        ? await invokeCommand('agent_runtime_status', { includeUsage: false })
        : undefined;
      const boundRoster = this.config.supportsOffisimDelegation
        ? roster.map((entry) => {
            const employeeModel = entry.model?.trim();
            if (!employeeModel) return entry;
            if (!runtimeStatus) throw new Error('The employee model catalog is unavailable.');
            const childSelection = resolveApiExecutionSelection(
              runtimeStatus,
              employeeModel,
              undefined,
            );
            if (
              childSelection.target.engineId !== executionTarget?.engineId ||
              childSelection.target.accountId !== executionTarget.accountId ||
              childSelection.target.billingMode !== executionTarget.billingMode
            ) {
              throw new Error(
                `Employee ${entry.name} is bound to another AI account or billing lane.`,
              );
            }
            return {
              ...entry,
              model: childSelection.runtimeModelRef,
              runtimeModelRef: childSelection.runtimeModelRef,
              executionTarget: childSelection.target,
            };
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
      const mcpTools = this.config.supportsOffisimDelegation
        ? await buildMcpScope(this.repos, this.companyId, input.employeeId, projectId).catch(
            () => [],
          )
        : [];
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
      let commandResponse: PiAgentHostResponse;
      if (this.engineId === 'codex') {
        const commandArgs: CommandArgs<'codex_agent_execute'> = {
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
            model: resolvedModel,
            runtimeModelRef: resolvedModel,
            permissionMode,
            thinkingLevel: resolvedThinkingLevel,
            systemPromptAppend: systemPromptAppend ?? undefined,
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
          },
          onEvent,
        };
        commandResponse = await (commandName === 'agent_runtime_resume'
          ? this.commands.resumeCodex(commandArgs)
          : this.commands.executeCodex(commandArgs));
      } else {
        const commandArgs: CommandArgs<'agent_runtime_execute'> = {
          req: {
            requestId,
            text: input.text,
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
            systemPromptAppend: systemPromptAppend ?? undefined,
            skillPaths,
            rootRunId: runScope.runId,
            nativeSessionMode,
            ...(nativeSessionMode === 'tracked' && runtimeContext.nativeSessionId
              ? { nativeSessionId: runtimeContext.nativeSessionId }
              : {}),
            ...(nativeSessionMode === 'fresh'
              ? { nativeSessionResetSourceRunId: input.nativeSessionResetSourceRunId }
              : {}),
            ...(commandName === 'agent_runtime_resume'
              ? { workspaceBindingHistoryId: resumeWorkspaceBinding?.historyId }
              : {}),
            roster: boundRoster,
            missionContextJson: input.missionContextJson?.trim() || undefined,
            mcpTools,
            directDelegation: input.directDelegation,
            ...(input.delegationLimits !== undefined
              ? { delegationLimits: input.delegationLimits }
              : {}),
          },
          onEvent,
        };
        commandResponse = await (commandName === 'agent_runtime_resume'
          ? this.commands.resumeApi(commandArgs)
          : this.commands.executeApi(commandArgs));
      }
      if (executionPreparations.size === 0) {
        throw new Error('Agent runtime did not prepare the exact execution target.');
      }
      await Promise.all([...executionPreparations.values()].map((entry) => entry.promise));
      await Promise.all(startedIdentityCheckpoints);
      if (channelError) throw channelError;
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
        ...requireTurnExecutionProvenance(commandResponse.provenance, runScope.runId),
        runtimeModelRef: resolvedModel,
      };
      if (!executionTarget) {
        throw new Error('Agent runtime completed without an execution target.');
      }
      assertSameExecutionAccount({ ...executionTarget, runId: runScope.runId }, provenance);
      assertSameExecutionAccount(
        requirePreparedExecutionIdentity(executionPreparations, runScope.runId),
        provenance,
      );
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
          this.persistRootTerminal(runScope.runId, terminalStatus, rootUsage, undefined, {
            context: runtimeContext,
            terminal: conversationTerminal,
          }),
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
        });
      }
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
      const failureKind = aborted ? undefined : classifyRunFailure(message);
      this.flushRunStreamCursor(runScope.runId);
      const terminal: LiveConversationTerminalPayload = {
        runId: runScope.runId,
        status,
        text: finalText,
        ...(reasoningText.trim() ? { reasoning: reasoningText.trim() } : {}),
        ...(failureKind ? { failureKind } : {}),
      };
      const commitFailedTerminal = () =>
        this.persistQueue.enqueueTerminalCheckpoint(
          `commit failed terminal checkpoint for ${runScope.runId}`,
          () =>
            this.persistRootTerminal(runScope.runId, status, undefined, failureKind, {
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
        for (;;) {
          try {
            preflightRoot = await this.repos.agentRuns.findById(runScope.runId);
            break;
          } catch (persistenceError) {
            console.warn('[desktop-agent-runtime] preflight root lookup retrying', {
              runId: runScope.runId,
              persistenceError,
            });
            await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
          }
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
          });
        }
      }
      emitRootBus(
        aborted
          ? rootRun('run.cancelled', { status, summary: message })
          : rootRun('run.failed', { status, summary: message, failureKind }),
      );
      throw err;
    } finally {
      signal?.removeEventListener('abort', abortFromSignal);
      this.abortedRequests.delete(requestId);
      if (this.inFlightByThread.get(input.threadId) === requestId) {
        this.inFlightByThread.delete(input.threadId);
      }
    }
  }

  /** Mark the root run terminal and reconcile any child left in `running` — the
   *  case where a root abort killed the host before a child's terminal event
   *  could be emitted. Also rolls the subtree's usage up into the root record.
   *  On a normal finish every child is already terminal, so the reconciliation is
   *  a no-op. The root row itself was opened by the synthesized run.started. */
  private async persistRootTerminal(
    rootRunId: string,
    status: 'completed' | 'failed' | 'cancelled',
    rootUsage?: AgentRunUsage,
    failureKind?: RunFailureKind,
    conversation?: {
      context: Partial<PersistedRunContext>;
      terminal: LiveConversationTerminalPayload;
      streamCursor?: number;
    },
  ): Promise<void> {
    const repo = this.repos.agentRuns;
    const finishedAt = new Date().toISOString();
    const children = await repo.findByRoot(rootRunId);
    // Roll the whole subtree's usage up into the root record, and reconcile any
    // child left `running` — the case where a root abort killed the host before
    // a child's terminal event (full abort-tree propagation rides the in-process
    // host kill; here we just keep the DB honest). The root's OWN usage comes
    // from the param (persistAgentRun doesn't write the root's terminal event),
    // so children + root sum with no double-count. Shared with the startup
    // interrupted-run reconciler (DR-003).
    const { usageJson, dangling } = aggregateSubtreeUsage(children, rootRunId, rootUsage);
    const root = children.find((run) => run.run_id === rootRunId);
    if (!root) {
      throw new Error(`Cannot finalize missing root agent_run ${rootRunId}.`);
    }
    const conversationMessage = conversation
      ? await this.buildLiveConversationTerminalMessage(
          root,
          conversation.context,
          conversation.terminal,
        )
      : null;
    const terminalCursor = normalizeStreamCursor(conversation?.streamCursor);
    const shouldPersistTerminalCursor = Boolean(
      conversation && terminalCursor > normalizeStreamCursor(conversation.context.streamCursor),
    );
    const terminalContext = conversation
      ? {
          ...conversation.context,
          ...(shouldPersistTerminalCursor ? { streamCursor: terminalCursor } : {}),
        }
      : null;
    await persistRunCostAndNotify({
      persist: async () => {
        let expectedTerminalContextJson: string | null = null;
        await this.repos.asyncTransact(async (transactionRepos) => {
          const tx = transactionRepos ?? this.repos;
          const current = await tx.agentRuns.findById(rootRunId);
          if (!current) throw new Error(`Cannot finalize missing root agent_run ${rootRunId}.`);
          const terminalContextJson = terminalContext
            ? JSON.stringify(
                mergeRunContextPreservingNativeIdentity(
                  current.runtime_context_json,
                  terminalContext,
                ),
              )
            : null;
          expectedTerminalContextJson = terminalContextJson;
          await Promise.all([
            tx.agentRuns.updateStatus(rootRunId, status, {
              finishedAt,
              usageJson,
              // The root's typed failure cause is only meaningful on a failed
              // terminal; completed/cancelled roots never write one.
              ...(status === 'failed' ? { failureKind: failureKind ?? null } : {}),
            }),
            ...dangling.map((id) => tx.agentRuns.updateStatus(id, 'cancelled', { finishedAt })),
            ...(terminalContextJson
              ? [tx.agentRuns.updateRuntimeContext(rootRunId, terminalContextJson)]
              : []),
            ...(conversationMessage
              ? [
                  persistChatMessageWithRepositories({
                    message: conversationMessage,
                    companyId: root.company_id,
                    projectId: resolveAgentRunProjectId(root),
                    repos: tx,
                  }),
                ]
              : []),
          ]);
        });
        const readback = await this.repos.agentRuns.findById(rootRunId);
        if (
          !readback ||
          readback.status !== status ||
          (expectedTerminalContextJson &&
            readback.runtime_context_json !== expectedTerminalContextJson)
        ) {
          throw new Error('Root terminal durable readback did not match the committed checkpoint.');
        }
        if (conversationMessage) {
          await assertPersistedChatMessageWithRepositories({
            repos: this.repos,
            expected: conversationMessage,
            errorMessage:
              'Conversation terminal message durable readback did not match the committed checkpoint.',
          });
        }
      },
      eventSink: runtimeEventBus,
      companyId: this.companyId,
      threadId: root?.thread_id ?? '',
      runId: rootRunId,
    });
    if (shouldPersistTerminalCursor && conversation) {
      conversation.context.streamCursor = terminalCursor;
    }
  }

  /** Persist a delegation run's lifecycle to agent_runs. Runs on the serialized
   *  persist chain — a DB write failure logs but never breaks the live run. Only
   *  the start/finish events carry persistable state; tool/delta events stay
   *  transient. */
  private async persistAgentRun(evt: AgentRunEvent): Promise<void> {
    const repo = this.repos.agentRuns;
    try {
      if (evt.type === 'run.started') {
        const payload = evt.payload as AgentRunStartedPayload;
        // Insert-if-absent: a resume replays run.started for an existing run; the
        // existing row (flipped interrupted→running only after backend authority
        // revalidation) must be left untouched, not re-created or clobbered.
        await persistRunStartIfAbsent(repo, {
          run_id: evt.runId,
          thread_id: evt.threadId,
          company_id: this.companyId,
          project_id: payload.projectId ?? null,
          parent_run_id: evt.parentRunId ?? null,
          root_run_id: evt.rootRunId,
          employee_id: evt.employeeId ?? null,
          relation: evt.relation ?? null,
          work_kind: evt.workKind ?? null,
          objective: payload.objective ?? null,
          access: payload.access ?? null,
          status: 'running',
          runtime_context_json: payload.runtimeContextJson ?? null,
        });
      } else if (
        evt.type === 'run.completed' ||
        evt.type === 'run.failed' ||
        evt.type === 'run.cancelled'
      ) {
        const payload = evt.payload as AgentRunFinishedPayload;
        await repo.updateStatus(evt.runId, payload.status, {
          resultSummaryJson: payload.summary ? JSON.stringify({ summary: payload.summary }) : null,
          usageJson: payload.usage ? JSON.stringify(payload.usage) : null,
          finishedAt: new Date().toISOString(),
          // The typed failure cause is durable only on a failed terminal;
          // completed/cancelled runs never carry one.
          ...(evt.type === 'run.failed' ? { failureKind: payload.failureKind ?? null } : {}),
        });
      }
    } catch (err) {
      console.warn('[desktop-agent-runtime] persist agent_run failed', { runId: evt.runId, err });
    }
  }

  private async persistWorkspaceLeaseSnapshot(
    event: Extract<PiAgentHostEvent, { kind: 'agentRun' }>,
    fallbackProjectId: string | null,
  ): Promise<void> {
    const repo = this.repos.agentEvents;
    const payload =
      event.payload && typeof event.payload === 'object'
        ? (event.payload as Record<string, unknown>)
        : {};
    const projectId =
      typeof payload.projectId === 'string' && payload.projectId.trim()
        ? payload.projectId
        : fallbackProjectId;
    try {
      await repo.append({
        event_id: crypto.randomUUID(),
        project_id: projectId,
        thread_id: event.threadId,
        company_id: this.companyId,
        agent_name: event.employeeId ?? event.runId,
        event_type: 'workspace.lease.snapshot',
        payload_json: JSON.stringify({
          ...payload,
          rootRunId: event.rootRunId,
          runId: event.runId,
          parentRunId: event.parentRunId ?? null,
        }),
        parent_event_id: null,
      });
    } catch (err) {
      console.warn('[desktop-agent-runtime] persist workspace lease snapshot failed', {
        runId: event.runId,
        err,
      });
    }
  }

  /** Persist an `artifact.created` run event as a deliverable row, then emit the
   *  bus event so the Outputs panel refetches AFTER the row is committed. The
   *  agent published a workspace-relative path; we read it through the SAME
   *  sandboxed Tauri command the file browser uses (`project_read_file`), so an
   *  out-of-workspace path is rejected by Rust and no row is written (VM-002
   *  acceptance-(c)). Runs on the serialized persist chain; never throws — a
   *  failure logs and the row is simply skipped (mirrors persistAgentRun). */
  private async persistArtifact(
    evt: AgentRunEvent,
    bindingClaim: TaskWorkspaceBindingClaim | null,
  ): Promise<void> {
    const payload = evt.payload as AgentRunArtifactPayload;
    const path = payload.path?.trim();
    const deliverableId = payload.deliverableId?.trim();
    if (!path || !deliverableId) {
      console.warn(
        '[desktop-agent-runtime] artifact.created missing path/deliverableId — skipped',
        {
          runId: evt.runId,
        },
      );
      return;
    }
    if (!bindingClaim) {
      console.warn(
        '[desktop-agent-runtime] artifact.created arrived without a workspace binding claim — skipped',
        { runId: evt.runId, path },
      );
      return;
    }
    // Read the file through the sandboxed workspace command. A workspace-jail
    // violation or a missing file rejects here → no row, no bus event.
    let content: string;
    try {
      content = await invokeCommand('project_read_file', {
        path,
        projectId: bindingClaim.projectId,
        bindingClaim,
      });
    } catch (err) {
      console.warn(
        '[desktop-agent-runtime] artifact.created path unreadable (out-of-workspace or missing) — no deliverable written',
        { path, err },
      );
      return;
    }
    // Hex sha256 of the content for provenance.
    let hash: string;
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
      hash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch (err) {
      console.warn('[desktop-agent-runtime] artifact hash failed', { path, err });
      return;
    }
    const repo = this.repos.deliverables;
    const basename = path.split(/[\\/]/).pop() || path;
    try {
      await repo.insert({
        deliverable_id: deliverableId,
        company_id: this.companyId,
        thread_id: null,
        chat_thread_id: evt.threadId,
        title: payload.title,
        content,
        kind: payload.kind === 'file' ? 'file' : 'document',
        file_name: basename,
        mime_type: payload.mimeType ?? null,
        // Record the producing employee as the artifact's contributor so the
        // output card can show real producer provenance (J1); empty only when the
        // run had no employee scope (e.g. a bare root turn).
        contributors_json: JSON.stringify(evt.employeeId ? [evt.employeeId] : []),
        created_at: new Date().toISOString(),
        run_id: evt.runId,
        content_hash: hash,
        version: 1,
      });
    } catch (err) {
      console.warn('[desktop-agent-runtime] persist artifact failed', {
        runId: evt.runId,
        deliverableId,
        err,
      });
      return;
    }
    // Row committed — now fan the run event onto the bus so the Outputs refetch
    // (useDeliverableRefresh) sees artifact.created with the row already present.
    runtimeEventBus.emit(agentRunEvent(this.companyId, evt));
  }

  private async persistMcpToolCall(
    event: Extract<PiAgentHostEvent, { kind: 'agentRun' }>,
    fallbackEmployeeId: string | null,
  ): Promise<void> {
    const payload = (event.payload ?? {}) as {
      server?: unknown;
      tool?: unknown;
      arguments?: unknown;
      result?: unknown;
      isError?: unknown;
      error?: unknown;
      latencyMs?: unknown;
      write?: unknown;
      approved?: unknown;
      approvalStatus?: unknown;
    };
    const server = typeof payload.server === 'string' ? payload.server : '';
    const tool = typeof payload.tool === 'string' ? payload.tool : '';
    if (!server || !tool) return;
    const employeeId = event.employeeId ?? fallbackEmployeeId ?? 'unknown';
    const createdAt = new Date().toISOString();
    const isError = payload.isError === true;
    const approvalStatus =
      payload.approvalStatus === 'human_approved' ||
      payload.approvalStatus === 'human_denied' ||
      payload.approvalStatus === 'not_required'
        ? payload.approvalStatus
        : payload.write === true && payload.approved === true
          ? 'human_approved'
          : 'not_required';
    try {
      await this.repos.mcpAudit.create({
        audit_id: crypto.randomUUID(),
        thread_id: event.threadId,
        task_run_id: null,
        employee_id: employeeId,
        server_name: server,
        tool_name: tool,
        arguments_json: JSON.stringify(payload.arguments ?? {}),
        result_json: JSON.stringify(payload.result ?? null),
        error:
          typeof payload.error === 'string'
            ? payload.error
            : isError
              ? 'mcp tool returned isError'
              : null,
        latency_ms: typeof payload.latencyMs === 'number' ? Math.max(0, payload.latencyMs) : 0,
        approval_status: approvalStatus,
        approved_by: approvalStatus === 'human_approved' ? 'boss' : null,
        created_at: createdAt,
      });
      if (payload.write === true && approvalStatus === 'human_approved') {
        await this.repos.toolPermissionApprovals.create({
          approval_id: crypto.randomUUID(),
          thread_id: event.threadId,
          company_id: this.companyId,
          employee_id: employeeId,
          server_name: server,
          tool_name: tool,
          scope: 'thread',
          approved_by: 'boss',
          policy_hash: `${server}:${tool}:write`,
          consumed_at: null,
          created_at: createdAt,
          expires_at: null,
        });
      }
    } catch (err) {
      console.warn('[desktop-agent-runtime] persist MCP audit failed', {
        server,
        tool,
        threadId: event.threadId,
        err,
      });
    }
  }

  abort(threadId: string): void {
    const requestId = this.inFlightByThread.get(threadId);
    if (!requestId) return;
    // Mark before invoking: a Rust abort resolves execute()'s invoke with empty
    // text, and the flag is how execute() knows to classify the terminal as
    // cancelled rather than completed.
    this.abortedRequests.add(requestId);
    void this.invokeAbortOnce(requestId).catch((err: unknown) => {
      console.warn('[desktop-agent-runtime] native abort failed', {
        engineId: this.engineId,
        threadId,
        err,
      });
    });
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
  }
}

const runtimeCache = new Map<string, Promise<DesktopAgentRuntime>>();

class DesktopAgentRuntimeGateway implements DesktopAgentRuntime {
  readonly ownsConversationProjectionPersistence = true;
  private readonly adapters: ReadonlyMap<string, RuntimeEngineAdapter>;
  private readonly activeEngineByThread = new Map<string, string>();

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

  async execute(input: DesktopAgentRunInput, signal?: AbortSignal): Promise<DesktopAgentRunResult> {
    const durableAuthority = resolveAuthoritativeThreadExecutionAuthority(
      await this.repos.agentRuns.findByThread(input.threadId),
      this.companyId,
    );
    let requestedModel = input.model?.trim() || undefined;
    if (!requestedModel && !durableAuthority && input.employeeId && !input.executionTarget) {
      const context = await buildDelegationContext(this.repos, this.companyId, input.employeeId, {
        model: undefined,
        thinkingLevel: input.thinkingLevel,
      });
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
    const selection = selectionPlan.requiresCatalog
      ? resolveRuntimeExecutionSelection(
          await invokeCommand('agent_runtime_status', { includeUsage: false }),
          selectionPlan.requestedModel,
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
    this.activeEngineByThread.set(input.threadId, engineId);
    try {
      return await this.adapter(engineId).execute(
        {
          ...input,
          engineId,
          model: selection.runtimeModelRef,
          runtimeModelRef: selection.runtimeModelRef,
          executionTarget: selection.target,
        },
        signal,
      );
    } finally {
      if (this.activeEngineByThread.get(input.threadId) === engineId) {
        this.activeEngineByThread.delete(input.threadId);
      }
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

  abort(threadId: string): void {
    const engineId = this.activeEngineByThread.get(threadId);
    if (engineId) this.adapter(engineId).abort(threadId);
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
    const engineId = parseRunContext(row.runtime_context_json)?.executionTarget?.engineId;
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
  return new DesktopAgentRuntimeGateway(companyId, repos, [apiAdapter, codexAdapter]);
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
