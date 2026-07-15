import { buildDelegationContext, buildMcpScope } from '@/data/employee-persona.js';
import { type PiRunStreamSnapshot, invokeCommand } from '@/lib/tauri-commands.js';
import { ensureProjectBoundForRun } from '@/runtime/ensure-default-workspace.js';
import { agentRunEvent, llmStreamChunk, toolExecutionTelemetry } from '@offisim/core/browser';
import type { RuntimeRepositories } from '@offisim/core/browser';
import {
  type AgentRunArtifactPayload,
  type AgentRunEvent,
  type AgentRunFinishedPayload,
  type AgentRunStartedPayload,
  type AgentRunUsage,
  type RunFailureKind,
  type RuntimeEvent,
  classifyRunFailure,
} from '@offisim/shared-types';
import { Channel } from '@tauri-apps/api/core';
import { AgentRunPersistenceQueue } from './agent-run-persistence-queue.js';
import {
  MISSION_EVALUATION_SUBMITTED_EVENT,
  type MissionEvaluationSubmittedPayload,
} from './mission/mission-events.js';
import { readPiModelOverride } from './pi-agent-config.js';
import type { PiAgentHostEvent, PiAgentHostResponse } from './pi-runtime-driver.js';
import { persistRunStartIfAbsent } from './recovery/persist-run-idempotency.js';
import {
  PI_HOST_PROTOCOL_VERSION,
  resolveAgentRunProjectId,
} from './recovery/reconcile-interrupted-runs.js';
import { aggregateSubtreeUsage } from './recovery/usage-aggregation.js';

const PI_SDK_VERSION = '0.80.7';

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
  /** Native multimodal images forwarded to Pi for this turn. */
  images?: readonly AgentPromptImage[];
  threadId: string;
  employeeId: string | null;
  projectId: string | null;
  /**
   * Frozen capability enum (PR-03). Absent / `'work'` = the existing work execute
   * path, unchanged. `'collaboration'` is NOT served through this `execute()` —
   * the collaboration transport (runtime/collaboration) invokes the dedicated
   * `agent_runtime_collaborate` command instead, so a work run can never silently
   * acquire the collaboration profile and vice-versa. Carried on the input type so
   * the wire contract is frozen in one place.
   */
  capabilityProfile?: AgentCapabilityProfile;
  /** Controller-owned run id used to isolate stream/tool/UI events per attempt. */
  runId?: string;
  /**
   * Keep the durable root row in `running` until the conversation controller has
   * committed the final transcript and active-interaction cleanup. Mission runs,
   * which have no chat transcript, omit this and settle inside the runtime.
   */
  deferTerminalSettlement?: boolean;
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
}

/** The user's answer to an `agent.ui.request`. `requestId` locates the paused run;
 *  `id` matches the specific prompt. `confirmed` answers a confirm, `value`
 *  answers select / input / editor, `cancelled` dismisses any of them. Generic so
 *  the UI never names a backend — each runtime maps it to its own transport. */
export interface AgentUiAnswer {
  requestId: string;
  id: string;
  confirmed?: boolean;
  value?: string;
  cancelled?: boolean;
}

export interface AgentPromptImage {
  data: string;
  mimeType: string;
}

export type AgentQueueBehavior = 'steer' | 'followUp';

export interface AgentQueuedMessage {
  /** Stable id used to acknowledge and de-duplicate this queued user turn. */
  id: string;
  text: string;
  images?: readonly AgentPromptImage[];
  behavior: AgentQueueBehavior;
}

export interface ReattachedAgentRun {
  requestId: string;
  runId: string;
  companyId: string;
  threadId: string;
  employeeId: string | null;
  projectId: string | null;
  objective: string;
  startedAt: string;
  model?: string;
  permissionMode?: string;
  thinkingLevel?: string;
}

export interface ReattachedAgentRunObserver {
  /** Stream cursor committed in the same durable assistant checkpoint. */
  afterCursor?: number;
  onReady?: () => void | Promise<void>;
  onResult: (result: DesktopAgentRunResult) => void | Promise<void>;
  onError: (error: Error) => void | Promise<void>;
  onCancelled?: () => void | Promise<void>;
}

export interface DesktopAgentRuntime {
  /** Persist the root discovery row before the visible user message is committed. */
  admitRun(input: DesktopAgentRunInput): Promise<void>;
  execute(input: DesktopAgentRunInput): Promise<DesktopAgentRunResult>;
  resume(
    runId: string,
    restart?: { text: string; images?: readonly AgentPromptImage[]; threadId: string },
  ): Promise<DesktopAgentRunResult>;
  /** Stop the host and wait until Rust reports a terminal stream snapshot. */
  abort(threadId: string): Promise<void>;
  /**
   * Commit the root terminal marker only after the caller's durable UI state is
   * saved, then release the retained Rust stream. Idempotent per thread.
   */
  settleRun(threadId: string, status: 'completed' | 'failed' | 'cancelled'): Promise<void>;
  abortChild(threadId: string, runId: string): void;
  /** Queue a live correction or a post-turn follow-up on Pi's native session. */
  queueMessage(threadId: string, message: AgentQueuedMessage): Promise<void>;
  /** Deliver the user's answer to a mid-run `agent.ui.request` back to the host. */
  answerUiRequest(answer: AgentUiAnswer): Promise<void>;
  /** Adopt host processes that survived a renderer reload before recovery parks them. */
  reattachLiveRuns?(
    claim: (run: ReattachedAgentRun) => Promise<ReattachedAgentRunObserver | null>,
  ): Promise<readonly string[]>;
  dispose(): Promise<void>;
}

function newRequestId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Event name for the agent's mid-run "ask the user something" bridge — shared by
 *  the producer (here) and the ConversationRunController consumer so the two
 *  can't drift on a typo. Backend-neutral on purpose: any agent that pauses to
 *  prompt the user (Pi today via `ctx.ui`, others later) routes through this. */
export const AGENT_UI_REQUEST_EVENT = 'agent.ui.request';
export const AGENT_LIFECYCLE_EVENT = 'agent.lifecycle';

/** Payload shape for the `agent.ui.request` renderer event. An agent paused
 *  mid-run and asked the user something (confirm / select / input / editor). The
 *  renderer needs `requestId` to route the answer back to the run's host and `id`
 *  to match the specific prompt. Mirrors a Pi extension-UI request, but the shape
 *  is generic so it isn't tied to any one backend. */
export interface AgentUiRequestPayload {
  requestId: string;
  runId: string;
  id: string;
  method: string;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
}

export interface AgentLifecyclePayload {
  requestId: string;
  runId: string;
  event: string;
  data: Record<string, unknown>;
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

function agentLifecycleEvent(
  companyId: string,
  threadId: string,
  payload: AgentLifecyclePayload,
): RuntimeEvent<AgentLifecyclePayload> {
  return {
    type: AGENT_LIFECYCLE_EVENT,
    entityId: payload.runId,
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

function emitPiStreamChunk(
  companyId: string,
  threadId: string,
  content: string,
  channel: 'content' | 'reasoning',
  runScope: ReturnType<typeof piRunScope>,
  streamCursor: number,
): void {
  const event = llmStreamChunk(companyId, threadId, 'pi_agent', content, channel, runScope);
  runtimeEventBus.emit({
    ...event,
    payload: { ...event.payload, streamCursor },
  } as RuntimeEvent<Record<string, unknown>>);
}

function toolStatus(status: PiAgentHostEvent & { kind: 'tool' }) {
  if (status.status === 'failed') return 'error' as const;
  if (status.status === 'completed') return 'completed' as const;
  return 'started' as const;
}

function hostModelRef(
  model: Extract<PiAgentHostEvent, { kind: 'started' }>['model'],
): string | null {
  if (!model?.id) return null;
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

interface PersistedRunContext {
  requestId?: string | null;
  streamCursor?: number | null;
  workspaceRoot: string | null;
  runtime: 'pi-agent';
  piSdkVersion: string;
  wireProtocolVersion: number;
  model: string | null;
  permissionMode: string;
  thinkingLevel: string | null;
  projectId: string | null;
  createdAt: string;
}

interface PendingTerminalSettlement {
  runId: string;
  requestId: string;
  status: 'completed' | 'failed' | 'cancelled';
  usage?: AgentRunUsage;
  failureKind?: RunFailureKind;
}

interface PiRunAdmission {
  runScope: ReturnType<typeof piRunScope>;
  requestId: string;
  projectId: string | null;
  project: Awaited<ReturnType<RuntimeRepositories['projects']['findById']>>;
  permissionMode: string;
  resolvedModel?: string;
  resolvedThinkingLevel?: string;
  runtimeContext: PersistedRunContext;
  startedEvent: AgentRunEvent;
}

class TerminalReattachClaimError extends Error {
  constructor(readonly originalError: unknown) {
    super('Could not rebuild controller ownership for a terminal Pi stream.');
    this.name = 'TerminalReattachClaimError';
  }
}

class ReattachDiscoveryError extends Error {
  constructor(readonly originalError: unknown) {
    super('Could not inspect the retained Pi stream.');
    this.name = 'ReattachDiscoveryError';
  }
}

class ReattachSafetyError extends Error {
  constructor(readonly originalError: unknown) {
    super('Could not prove the retained Pi host stopped after reattach lost ownership.');
    this.name = 'ReattachSafetyError';
  }
}

function parseRunContext(raw: string | null | undefined): Partial<PersistedRunContext> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedRunContext>;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeStreamCursor(cursor: unknown): number {
  return Number.isSafeInteger(cursor) && Number(cursor) > 0 ? Number(cursor) : 0;
}

export class DesktopPiAgentRuntime implements DesktopAgentRuntime {
  private readonly inFlightByThread = new Map<string, string>();
  private readonly controlReadyByThread = new Map<string, string>();
  private readonly acceptingControlThreads = new Set<string>();
  private readonly pendingControlsByThread = new Map<string, AgentQueuedMessage[]>();
  private readonly pendingControlAcks = new Map<
    string,
    {
      threadId: string;
      resolve: () => void;
      reject: (error: unknown) => void;
    }
  >();
  private readonly pendingAbortThreads = new Set<string>();
  private readonly runIdentityByThread = new Map<string, { runId: string; requestId: string }>();
  private readonly pendingTerminalByThread = new Map<string, PendingTerminalSettlement>();
  private readonly admissionsByThread = new Map<
    string,
    { runId: string; promise: Promise<PiRunAdmission> }
  >();
  private disposed = false;
  // Request ids the user aborted. A Rust-side abort kills the host and resolves
  // the invoke with empty text (not an error), so execute() consults this to
  // classify the root run's terminal as cancelled rather than completed/failed.
  private readonly abortedRequests = new Set<string>();
  // Serializes agent-run persistence in event order and coalesces high-frequency
  // cursors. Ordinary telemetry failures are contained; semantic terminal commits
  // use enqueueRequired so their failure keeps the retained stream retryable.
  private readonly persistQueue = new AgentRunPersistenceQueue();

  constructor(
    private readonly companyId: string,
    private readonly repos: RuntimeRepositories,
    private readonly invokeRuntimeCommand: typeof invokeCommand = invokeCommand,
  ) {}

  async queueMessage(threadId: string, message: AgentQueuedMessage): Promise<void> {
    if (this.disposed) throw new Error('This renderer runtime has detached.');
    if (!message.id.trim()) throw new Error('Queued messages require a stable id.');
    if (this.pendingControlAcks.has(message.id)) {
      throw new Error('This queued message is already awaiting Pi acknowledgement.');
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
      const error = new Error('This conversation is no longer accepting queued messages.');
      this.settleControlAck(message.id, error);
    }
    await acknowledged;
  }

  private async sendRuntimeControl(requestId: string, message: AgentQueuedMessage): Promise<void> {
    await invokeCommand('agent_runtime_control', {
      requestId,
      action: message.behavior,
      controlId: message.id,
      runId: null,
      text: message.text,
      images: message.images ? [...message.images] : null,
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

  private settleControlAck(controlId: string, error?: unknown): void {
    const pending = this.pendingControlAcks.get(controlId);
    if (!pending) return;
    this.pendingControlAcks.delete(controlId);
    if (error) pending.reject(error);
    else pending.resolve();
  }

  private handleControlLifecycle(threadId: string, payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;
    const data = payload as Record<string, unknown>;
    const controlId = typeof data.controlId === 'string' ? data.controlId : '';
    if (!controlId) return;
    const pending = this.pendingControlAcks.get(controlId);
    if (!pending || pending.threadId !== threadId) return;
    if (data.state === 'accepted' || data.state === 'consumed') {
      this.settleControlAck(controlId);
    } else if (data.state === 'failed' || data.state === 'rejected') {
      const detail = typeof data.errorMessage === 'string' ? data.errorMessage : '';
      this.settleControlAck(
        controlId,
        new Error(detail || 'Pi did not accept the queued instruction.'),
      );
    }
  }

  private enqueuePersist(work: () => Promise<void>, label = 'agent runtime persistence'): void {
    this.persistQueue.enqueue(label, work);
  }

  private queueRunStreamCursor(
    runId: string,
    context: Partial<PersistedRunContext>,
    cursor: number,
  ): void {
    this.persistQueue.queueCursor(runId, cursor, (latest) =>
      this.persistRunStreamCursor(runId, context, latest),
    );
  }

  private flushRunStreamCursor(runId: string): void {
    this.persistQueue.flushCursor(runId);
  }

  private async persistRunStreamCursor(
    runId: string,
    context: Partial<PersistedRunContext>,
    cursor: number,
  ): Promise<void> {
    const nextCursor = normalizeStreamCursor(cursor);
    if (nextCursor <= normalizeStreamCursor(context.streamCursor)) return;
    const nextContext = { ...context, streamCursor: nextCursor };
    await this.repos.agentRuns.updateRuntimeContext(runId, JSON.stringify(nextContext));
    context.streamCursor = nextCursor;
  }

  private registerTerminalSettlement(
    threadId: string,
    settlement: PendingTerminalSettlement,
  ): PendingTerminalSettlement {
    const stopWon = this.abortedRequests.has(settlement.requestId);
    const next = stopWon ? { ...settlement, status: 'cancelled' as const } : settlement;
    const existing = this.pendingTerminalByThread.get(threadId);
    if (existing?.status === 'cancelled') return existing;
    if (existing && existing.status !== next.status) {
      // A user Stop is the only legal terminal override. Any other conflict means
      // two business outcomes raced and must stay visible instead of being hidden
      // by whichever persistence task happened to run last.
      if (next.status !== 'cancelled') {
        throw new Error(
          `Conflicting Pi terminal settlement for ${threadId}: ${existing.status} -> ${next.status}.`,
        );
      }
    }
    this.pendingTerminalByThread.set(threadId, next);
    return next;
  }

  async settleRun(threadId: string, status: 'completed' | 'failed' | 'cancelled'): Promise<void> {
    const identity = this.runIdentityByThread.get(threadId);
    let pending = this.pendingTerminalByThread.get(threadId);
    if (!pending && identity) {
      pending = this.registerTerminalSettlement(threadId, { ...identity, status });
    }
    if (!pending) return;
    const requestedStatus = this.abortedRequests.has(pending.requestId) ? 'cancelled' : status;
    if (pending.status !== requestedStatus) {
      throw new Error(
        `Cannot settle Pi run ${pending.runId} as ${requestedStatus}; host reported ${pending.status}.`,
      );
    }
    await this.persistQueue.enqueueRequired(`commit ${pending.status} root ${pending.runId}`, () =>
      this.reconcileRoot(pending.runId, pending.status, pending.usage, pending.failureKind),
    );
    await invokeCommand('agent_runtime_release_stream', { requestId: pending.requestId }).catch(
      (error: unknown) => {
        // The root terminal marker is already durable. A failed best-effort release
        // cannot roll that commit back; Rust's bounded terminal TTL reaps it.
        console.warn('[desktop-agent-runtime] terminal stream release deferred to TTL', {
          requestId: pending.requestId,
          runId: pending.runId,
          error,
        });
      },
    );
    this.pendingTerminalByThread.delete(threadId);
    this.runIdentityByThread.delete(threadId);
    this.admissionsByThread.delete(threadId);
    this.pendingAbortThreads.delete(threadId);
    this.abortedRequests.delete(pending.requestId);
  }

  private async waitForTerminalStream(
    requestId: string,
    mode: 'bounded-reattach' | 'confirmed-stop',
  ): Promise<PiRunStreamSnapshot | null> {
    const deadline = Date.now() + 15_000;
    while (true) {
      let snapshot: PiRunStreamSnapshot | null;
      try {
        snapshot = await this.invokeRuntimeCommand('agent_runtime_stream_snapshot', {
          requestId,
        });
      } catch (error) {
        if (mode === 'bounded-reattach') throw error;
        // Once Rust accepted an abort, reverting the request to a normal live run
        // is unsafe: the cancellation token may unwind later. Retain ownership
        // and retry the authoritative snapshot instead of inventing a timeout.
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 250));
        continue;
      }
      if (!snapshot || !snapshot.running) return snapshot;
      if (mode === 'bounded-reattach' && Date.now() >= deadline) {
        throw new Error(`Timed out waiting for Pi request ${requestId} to stop.`);
      }
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 25));
    }
  }

  private async abortUnsafeReattachHost(requestId: string, ownershipError: unknown): Promise<void> {
    try {
      await this.invokeRuntimeCommand('agent_runtime_abort', { requestId });
      const terminalSnapshot = await this.waitForTerminalStream(requestId, 'bounded-reattach');
      if (terminalSnapshot?.terminal?.status !== 'aborted') {
        throw new Error(
          `Pi request ${requestId} reached ${terminalSnapshot?.terminal?.status ?? 'an unknown terminal state'} before unsafe reattach abort was acknowledged.`,
        );
      }
    } catch (stopError) {
      throw new ReattachSafetyError(
        new AggregateError(
          [ownershipError, stopError],
          `Pi request ${requestId} may still be running after reattach ownership failed.`,
        ),
      );
    }
  }

  private async createRunAdmission(input: DesktopAgentRunInput): Promise<PiRunAdmission> {
    if (this.disposed) throw new Error('This renderer runtime has detached.');
    this.acceptingControlThreads.add(input.threadId);
    const projectId = await ensureProjectBoundForRun(this.repos, this.companyId, input.projectId);
    if (this.pendingAbortThreads.has(input.threadId)) {
      throw new Error('The Pi run was cancelled before admission completed.');
    }
    const runScope = piRunScope(projectId, input.threadId, input.employeeId, input.runId);
    const requestId = newRequestId('pi-agent');
    const permissionMode = input.permissionMode?.trim() || resolveThreadMode(input.threadId);
    const rootAccess: 'read' | 'write' = permissionMode === 'plan' ? 'read' : 'write';
    const resolvedModel = input.model?.trim() || readPiModelOverride() || undefined;
    const resolvedThinkingLevel =
      input.thinkingLevel?.trim() || resolveThreadThinkingOverride(input.threadId);
    const project = projectId ? await this.repos.projects.findById(projectId) : null;
    const runtimeContext: PersistedRunContext = {
      requestId,
      streamCursor: 0,
      workspaceRoot: project?.workspace_root ?? null,
      runtime: 'pi-agent',
      piSdkVersion: PI_SDK_VERSION,
      wireProtocolVersion: PI_HOST_PROTOCOL_VERSION,
      model: resolvedModel ?? null,
      permissionMode,
      thinkingLevel: resolvedThinkingLevel ?? null,
      projectId,
      createdAt: new Date().toISOString(),
    };
    const startedEvent = {
      threadId: input.threadId,
      rootRunId: runScope.runId,
      runId: runScope.runId,
      ...(input.employeeId ? { employeeId: input.employeeId } : {}),
      type: 'run.started',
      payload: {
        objective: input.text,
        access: rootAccess,
        projectId,
        runtimeContextJson: JSON.stringify(runtimeContext),
      },
    } as AgentRunEvent;
    // This discovery row is the durable intent/outbox. It commits before the
    // visible boss message; a crash in either direction therefore produces an
    // explicit interrupted card instead of a sent-looking message with no run.
    await this.persistAgentRun(startedEvent);
    this.runIdentityByThread.set(input.threadId, { runId: runScope.runId, requestId });
    return {
      runScope,
      requestId,
      projectId,
      project,
      permissionMode,
      resolvedModel,
      resolvedThinkingLevel,
      runtimeContext,
      startedEvent,
    };
  }

  private async ensureRunAdmission(input: DesktopAgentRunInput): Promise<PiRunAdmission> {
    const existing = this.admissionsByThread.get(input.threadId);
    if (existing) {
      if (input.runId?.trim() && existing.runId !== input.runId.trim()) {
        throw new Error('This conversation already has a different admitted Pi run.');
      }
      return existing.promise;
    }
    const runId = input.runId?.trim() || `pi-${crypto.randomUUID()}`;
    const admittedInput = { ...input, runId };
    const promise = this.createRunAdmission(admittedInput).catch((error) => {
      this.admissionsByThread.delete(input.threadId);
      this.acceptingControlThreads.delete(input.threadId);
      this.pendingAbortThreads.delete(input.threadId);
      this.rejectPendingControls(
        input.threadId,
        new Error('The Pi run could not be admitted, so its queued message was not delivered.'),
      );
      throw error;
    });
    this.admissionsByThread.set(input.threadId, { runId, promise });
    return promise;
  }

  async admitRun(input: DesktopAgentRunInput): Promise<void> {
    await this.ensureRunAdmission(input);
  }

  async execute(input: DesktopAgentRunInput): Promise<DesktopAgentRunResult> {
    return this.runPiTurn(input, 'agent_runtime_execute');
  }

  async resume(
    runId: string,
    restart?: { text: string; images?: readonly AgentPromptImage[]; threadId: string },
  ): Promise<DesktopAgentRunResult> {
    if (!restart?.threadId.trim()) {
      throw new Error('Cannot resume Agent runtime run: thread context is missing.');
    }
    const admissionThreadId = restart.threadId.trim();
    // Resume performs durable run/project checks before runPiTurn can allocate a
    // request id. Open admission synchronously so Stop becomes a pending abort
    // and steer/follow-up waits for host readiness instead of being rejected in
    // that preflight window.
    this.acceptingControlThreads.add(admissionThreadId);
    let handedOffToRun = false;
    try {
      const repo = this.repos.agentRuns;
      const row = await repo.findById(runId);
      if (!row || row.company_id !== this.companyId || row.thread_id !== admissionThreadId) {
        throw new Error('Cannot resume Agent runtime run: run not found for this conversation.');
      }
      if (row.status !== 'interrupted') {
        throw new Error(
          `Cannot resume Agent runtime run: expected interrupted, got ${row.status}.`,
        );
      }
      const context = parseRunContext(row.runtime_context_json);
      const projectId = resolveAgentRunProjectId(row);
      if (!projectId) {
        throw new Error(
          'Cannot resume Agent runtime run: original project context is missing. Restart from the objective instead.',
        );
      }
      await this.assertProjectWorkspaceAvailable(projectId);
      const resumeSessionFile = row.session_file?.trim() || null;
      handedOffToRun = true;
      return await this.runPiTurn(
        {
          text: resumeSessionFile
            ? `Continue the interrupted task from its saved Pi session.\n\nOriginal objective:\n${
                row.objective || 'Untitled run'
              }`
            : restart.text || row.objective || 'Continue the interrupted task.',
          images: resumeSessionFile ? [] : restart.images,
          threadId: row.thread_id,
          employeeId: row.employee_id,
          projectId,
          runId: row.run_id,
          deferTerminalSettlement: true,
          permissionMode:
            typeof context?.permissionMode === 'string' && context.permissionMode.trim()
              ? context.permissionMode.trim()
              : row.access === 'read'
                ? 'plan'
                : undefined,
          model:
            typeof context?.model === 'string' && context.model.trim()
              ? context.model.trim()
              : undefined,
          thinkingLevel:
            typeof context?.thinkingLevel === 'string' && context.thinkingLevel.trim()
              ? context.thinkingLevel.trim()
              : undefined,
        },
        'agent_runtime_resume',
        {
          mode: resumeSessionFile ? 'open' : 'fresh',
          sessionFile: resumeSessionFile,
        },
      );
    } catch (error) {
      if (!handedOffToRun) {
        this.acceptingControlThreads.delete(admissionThreadId);
        this.pendingAbortThreads.delete(admissionThreadId);
        this.rejectPendingControls(
          admissionThreadId,
          new Error('The Pi run could not resume, so its queued message was not delivered.'),
        );
      }
      throw error;
    }
  }

  private async assertProjectWorkspaceAvailable(projectId: string): Promise<void> {
    const project = await this.repos.projects.findById(projectId);
    if (!project || project.company_id !== this.companyId) {
      throw new Error('Cannot resume Agent runtime run: original project is unavailable.');
    }
    if (!project.workspace_root?.trim()) {
      throw new Error(
        'Cannot resume Agent runtime run: original project has no workspace folder bound.',
      );
    }
    try {
      const exists = await invokeCommand('project_exists', {
        path: '.',
        cwd: null,
        projectId,
      });
      if (exists !== true) {
        throw new Error('workspace folder no longer exists');
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Cannot resume Agent runtime run: original workspace is unavailable (${detail}).`,
      );
    }
  }

  async reattachLiveRuns(
    claim: (run: ReattachedAgentRun) => Promise<ReattachedAgentRunObserver | null>,
  ): Promise<readonly string[]> {
    const repo = this.repos.agentRuns;
    const rows = await repo.findByStatus(this.companyId, ['running']);
    const attachedRunIds: string[] = [];
    for (const row of rows) {
      try {
        if (row.parent_run_id) continue;
        const context = parseRunContext(row.runtime_context_json);
        const runtimeContext: Partial<PersistedRunContext> = context ?? {};
        const requestId =
          typeof context?.requestId === 'string' && context.requestId.trim()
            ? context.requestId.trim()
            : null;
        if (!requestId) continue;
        const snapshot = await this.invokeRuntimeCommand('agent_runtime_stream_snapshot', {
          requestId,
        }).catch((error: unknown) => {
          throw new ReattachDiscoveryError(error);
        });
        if (!snapshot) continue;
        const projectId = resolveAgentRunProjectId(row);
        let observer: ReattachedAgentRunObserver | null;
        try {
          observer = await claim({
            requestId,
            runId: row.run_id,
            companyId: this.companyId,
            threadId: row.thread_id,
            employeeId: row.employee_id,
            projectId,
            objective: row.objective?.trim() || 'Continue the active Pi run.',
            startedAt: row.started_at,
            ...(typeof context?.model === 'string' && context.model.trim()
              ? { model: context.model.trim() }
              : {}),
            ...(typeof context?.permissionMode === 'string' && context.permissionMode.trim()
              ? { permissionMode: context.permissionMode.trim() }
              : {}),
            ...(typeof context?.thinkingLevel === 'string' && context.thinkingLevel.trim()
              ? { thinkingLevel: context.thinkingLevel.trim() }
              : {}),
          });
        } catch (claimError) {
          // The controller could not rebuild durable ownership (for example a
          // damaged attachment vault row). Stop a still-running host before
          // recovery parks the DB row, or Pi could keep using tools invisibly.
          if (snapshot.running) {
            await this.abortUnsafeReattachHost(requestId, claimError);
            throw claimError;
          }
          throw new TerminalReattachClaimError(claimError);
        }
        if (!observer) {
          // A second durable row for the same thread can be declined after the
          // controller has already adopted the real owner. Keep an idempotent
          // re-scan of that same request alive, but abort any different live host
          // that would otherwise continue without a controller.
          if (snapshot.running && this.inFlightByThread.get(row.thread_id) !== requestId) {
            await this.abortUnsafeReattachHost(
              requestId,
              new Error(`No controller claimed Pi run ${row.run_id}.`),
            );
          }
          continue;
        }
        this.runIdentityByThread.set(row.thread_id, { runId: row.run_id, requestId });
        const runScope = piRunScope(projectId, row.thread_id, row.employee_id, row.run_id);
        const startedAtByTool = new Map<string, number>();
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
        let terminalSettled = false;
        const settleReattached = (
          result: DesktopAgentRunResult | null,
          error: Error | null,
          cancelled = false,
          terminalStatus: 'completed' | 'failed' | 'cancelled' = cancelled
            ? 'cancelled'
            : error
              ? 'failed'
              : 'completed',
        ): void => {
          if (terminalSettled) return;
          terminalSettled = true;
          this.acceptingControlThreads.delete(row.thread_id);
          this.controlReadyByThread.delete(row.thread_id);
          this.rejectPendingControls(
            row.thread_id,
            error ?? new Error('The Pi run ended before the queued message could be delivered.'),
          );
          if (this.inFlightByThread.get(row.thread_id) === requestId) {
            this.inFlightByThread.delete(row.thread_id);
          }
          const completion = cancelled
            ? observer.onCancelled
              ? observer.onCancelled()
              : observer.onError(new Error('The Pi run was cancelled.'))
            : error
              ? observer.onError(error)
              : result
                ? observer.onResult(result)
                : undefined;
          // The observer owns the chat transcript and active-interaction commit.
          // Only after that resolves may the root status become terminal; the root
          // row is the durable commit marker and stream release is last.
          void Promise.resolve(completion)
            .then(() => this.settleRun(row.thread_id, terminalStatus))
            .catch((settlementError: unknown) => {
              console.warn('[desktop-agent-runtime] reattached run settlement retained stream', {
                requestId,
                runId: row.run_id,
                settlementError,
              });
            });
        };
        let resolveReattachReady: (() => void) | null = null;
        const reattachReady = new Promise<void>((resolve) => {
          resolveReattachReady = resolve;
        });
        let pendingMessageDelta: Extract<PiAgentHostEvent, { kind: 'messageDelta' }> | null = null;
        const onEvent = new Channel<PiAgentHostEvent>();
        onEvent.onmessage = (event) => {
          if (this.disposed) return;
          if (event.kind === 'streamCursor') {
            if (pendingMessageDelta) {
              emitPiStreamChunk(
                this.companyId,
                row.thread_id,
                pendingMessageDelta.delta,
                pendingMessageDelta.channel === 'reasoning' ? 'reasoning' : 'content',
                runScope,
                event.cursor,
              );
              pendingMessageDelta = null;
            }
            this.queueRunStreamCursor(row.run_id, runtimeContext, event.cursor);
            return;
          }
          if (event.kind === 'messageDelta') {
            pendingMessageDelta = event;
            return;
          }
          if (event.kind === 'started') {
            const actualModel = hostModelRef(event.model);
            if (actualModel && runtimeContext.model !== actualModel) {
              runtimeContext.model = actualModel;
              this.enqueuePersist(() =>
                this.repos.agentRuns.updateRuntimeContext(
                  row.run_id,
                  JSON.stringify(runtimeContext),
                ),
              );
            }
            if (event.sessionFile) {
              this.enqueuePersist(() =>
                this.repos.agentRuns.updateStatus(row.run_id, 'running', {
                  sessionFile: event.sessionFile,
                }),
              );
            }
            return;
          }
          if (event.kind === 'lifecycle') {
            if (
              event.event === 'reattach' &&
              event.payload &&
              typeof event.payload === 'object' &&
              (event.payload as Record<string, unknown>).state === 'ready'
            ) {
              resolveReattachReady?.();
            }
            this.handleControlLifecycle(row.thread_id, event.payload);
            runtimeEventBus.emit(
              agentLifecycleEvent(this.companyId, row.thread_id, {
                requestId,
                runId: row.run_id,
                event: event.event,
                data:
                  event.payload && typeof event.payload === 'object'
                    ? (event.payload as Record<string, unknown>)
                    : {},
              }),
            );
            return;
          }
          if (event.kind === 'tool') {
            const startedAt = startedAtByTool.get(event.toolCallId) ?? Date.now();
            if (event.status === 'started') {
              startedAtByTool.set(event.toolCallId, startedAt);
            }
            const completedAt =
              event.status === 'completed' || event.status === 'failed' ? Date.now() : undefined;
            runtimeEventBus.emit(
              toolExecutionTelemetry(this.companyId, row.thread_id, {
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                toolType: 'builtin',
                evidenceClass: 'sdk-native',
                threadId: row.thread_id,
                nodeName: 'pi_agent',
                employeeId: row.employee_id ?? undefined,
                startedAt,
                completedAt,
                durationMs:
                  event.durationMs ??
                  (completedAt ? Math.max(0, completedAt - startedAt) : undefined),
                status: toolStatus(event),
                detail: event.detail,
                errorType:
                  event.status === 'failed' ? (event.detail ?? 'pi_tool_failed') : undefined,
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
            return;
          }
          if (event.kind === 'uiRequest') {
            runtimeEventBus.emit(
              agentUiRequestEvent(this.companyId, row.thread_id, {
                requestId,
                runId: row.run_id,
                id: event.id,
                method: event.method,
                title: event.title,
                message: event.message,
                options: event.options,
                placeholder: event.placeholder,
                prefill: event.prefill,
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
            return;
          }
          if (event.kind === 'agentRun') {
            if (event.runType === 'mcp.tool.called') {
              this.enqueuePersist(() => this.persistMcpToolCall(event, row.employee_id));
              return;
            }
            if (event.runType === 'workspace.lease.snapshot') {
              this.enqueuePersist(() => this.persistWorkspaceLeaseSnapshot(event, projectId));
              return;
            }
            if (event.runType === 'evaluation_submitted') {
              const p = (event.payload ?? {}) as {
                criterionId?: string;
                summary?: string;
                evidenceRefs?: string[];
              };
              if (typeof p.criterionId === 'string' && p.criterionId.trim()) {
                runtimeEventBus.emit(
                  missionEvaluationSubmittedEvent(this.companyId, event.threadId, {
                    runId: event.runId,
                    rootRunId: event.rootRunId,
                    criterionId: p.criterionId,
                    summary: typeof p.summary === 'string' ? p.summary : '',
                    evidenceRefs: Array.isArray(p.evidenceRefs)
                      ? p.evidenceRefs.filter((r): r is string => typeof r === 'string')
                      : [],
                  }),
                );
              }
              return;
            }
            if (event.runType === 'mission_state_query') return;
            const agentEvt = {
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
              this.enqueuePersist(() => this.persistArtifact(agentEvt, projectId));
            } else {
              runtimeEventBus.emit(agentRunEvent(this.companyId, agentEvt));
              this.enqueuePersist(() => this.persistAgentRun(agentEvt));
            }
            return;
          }
          if (event.kind === 'result') {
            this.flushRunStreamCursor(row.run_id);
            emitRootBus(
              rootRun('run.completed', {
                status: 'completed',
                ...(event.response.text ? { summary: event.response.text } : {}),
                ...(event.response.usage ? { usage: event.response.usage } : {}),
              }),
            );
            const settlement = this.registerTerminalSettlement(row.thread_id, {
              runId: row.run_id,
              requestId,
              status: 'completed',
              usage: event.response.usage,
            });
            if (this.inFlightByThread.get(row.thread_id) === requestId) {
              this.inFlightByThread.delete(row.thread_id);
            }
            // Stop wins over a concurrently delivered Result. The initiating
            // stopAndWait call owns transcript cleanup and terminal settlement.
            if (settlement.status === 'cancelled') return;
            settleReattached(
              {
                text: event.response.text,
                ...(event.response.reasoning ? { reasoning: event.response.reasoning } : {}),
                ...(event.response.usage ? { usage: event.response.usage } : {}),
                ...(event.response.budgetUsage ? { budgetUsage: event.response.budgetUsage } : {}),
              },
              null,
              false,
              'completed',
            );
            return;
          }
          if (event.kind === 'error') {
            this.flushRunStreamCursor(row.run_id);
            // A host error message is this lane's free-text ORIGIN — classify the
            // typed kind here (a provider 429 is token strain, not machinery),
            // defaulting to 'runtime' for transport/host failures.
            const failureKind = classifyRunFailure(event.message);
            emitRootBus(
              rootRun('run.failed', {
                status: 'failed',
                summary: event.message,
                failureKind,
              }),
            );
            const settlement = this.registerTerminalSettlement(row.thread_id, {
              runId: row.run_id,
              requestId,
              status: 'failed',
              failureKind,
            });
            if (this.inFlightByThread.get(row.thread_id) === requestId) {
              this.inFlightByThread.delete(row.thread_id);
            }
            if (settlement.status === 'cancelled') return;
            settleReattached(null, new Error(event.message), false, 'failed');
          }
        };

        this.acceptingControlThreads.add(row.thread_id);
        this.controlReadyByThread.set(row.thread_id, requestId);
        this.inFlightByThread.set(row.thread_id, requestId);
        let reattachSucceeded = true;
        let reattachedSnapshot = snapshot;
        const durableReplayCursor = normalizeStreamCursor(observer.afterCursor);
        const terminalTailCursor =
          snapshot.terminal?.status === 'aborted'
            ? normalizeStreamCursor(snapshot.cursor)
            : Math.max(0, normalizeStreamCursor(snapshot.cursor) - 1);
        const retainedReplayFloor = Math.max(
          0,
          normalizeStreamCursor(snapshot.cursor) - normalizeStreamCursor(snapshot.buffered),
        );
        try {
          reattachedSnapshot = await this.invokeRuntimeCommand('agent_runtime_reattach', {
            requestId,
            // Running replay resumes from the cursor atomically committed with the
            // assistant checkpoint and fails closed if bounded history was lost.
            // A terminal stream's last buffered event is its authoritative Result
            // or Error. Replay from the durable checkpoint while it is retained;
            // otherwise fall back to that authoritative tail instead of failing a
            // completed run merely because older deltas were truncated.
            afterCursor: snapshot.running
              ? durableReplayCursor
              : durableReplayCursor >= retainedReplayFloor
                ? Math.min(durableReplayCursor, terminalTailCursor)
                : terminalTailCursor,
            onEvent,
          });
        } catch (err) {
          reattachSucceeded = false;
          if (terminalSettled) {
            // Result/Error may have been delivered successfully before the paired
            // StreamCursor transport failed. Never overwrite that business outcome
            // with a synthetic runtime failure; its settlement owns retry/release.
            console.warn('[desktop-agent-runtime] Pi terminal cursor delivery failed', {
              requestId,
              runId: row.run_id,
              err,
            });
            attachedRunIds.push(row.run_id);
            continue;
          }
          // A terminal snapshot already carries the authoritative business
          // outcome. If its Result/Error cannot cross the Channel, retain both
          // root row and stream for an idempotent retry; transport failure must
          // never rewrite completed/failed into a synthetic failure.
          if (!snapshot.running) {
            throw new ReattachSafetyError(err);
          }
          // A replay gap means this renderer can no longer observe or control the
          // surviving host safely. Abort the host before publishing the failed
          // controller state; otherwise Pi could keep running tools after the UI
          // has released ownership of the run.
          await this.abortUnsafeReattachHost(requestId, err);
          if (terminalSettled) {
            attachedRunIds.push(row.run_id);
            continue;
          }
          if (this.inFlightByThread.get(row.thread_id) === requestId) {
            this.inFlightByThread.delete(row.thread_id);
          }
          const reattachError =
            err instanceof Error ? err : new Error(String(err ?? 'Pi reattach failed'));
          const failureKind = classifyRunFailure(reattachError.message);
          this.registerTerminalSettlement(row.thread_id, {
            runId: row.run_id,
            requestId,
            status: 'failed',
            failureKind,
          });
          settleReattached(null, reattachError, false, 'failed');
          attachedRunIds.push(row.run_id);
          console.warn('[desktop-agent-runtime] reattach live Pi stream failed', {
            requestId,
            runId: row.run_id,
            err,
          });
        }
        if (!reattachSucceeded) continue;
        if (reattachedSnapshot.terminal?.status === 'aborted' && !terminalSettled) {
          emitRootBus(rootRun('run.cancelled', { status: 'cancelled' }));
          this.registerTerminalSettlement(row.thread_id, {
            runId: row.run_id,
            requestId,
            status: 'cancelled',
          });
          settleReattached(null, null, true, 'cancelled');
        }
        attachedRunIds.push(row.run_id);
        if (reattachedSnapshot.running && !terminalSettled) {
          // The host keeps the currently parked UI request and native queue in
          // memory. Ask it to re-emit those live facts after the new subscriber is
          // attached so the controller can resume ownership without replaying the
          // entire token stream.
          let ownershipError: Error | null = null;
          try {
            await this.invokeRuntimeCommand('agent_runtime_control', {
              requestId,
              action: 'reattach',
              controlId: null,
              runId: null,
              text: null,
              images: null,
            });
            let ready = false;
            let timeoutId: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([
              reattachReady.then(() => {
                ready = true;
              }),
              new Promise<void>((resolve) => {
                timeoutId = setTimeout(resolve, 2_000);
              }),
            ]);
            if (timeoutId) clearTimeout(timeoutId);
            if (!ready) {
              throw new Error(`Timed out waiting for Pi reattach readiness for ${requestId}.`);
            }
            await observer.onReady?.();
          } catch (error) {
            ownershipError =
              error instanceof Error
                ? error
                : new Error(String(error ?? 'Pi reattach ownership failed'));
          }
          if (ownershipError && !terminalSettled) {
            // A stream subscription without the host's ready ACK is not usable
            // ownership: parked UI and accepted controls may never be surfaced.
            // Confirm the retained host is terminal before publishing a failed
            // controller state so no invisible Pi process can keep using tools.
            await this.abortUnsafeReattachHost(requestId, ownershipError);
            if (!terminalSettled) {
              const failureKind = classifyRunFailure(ownershipError.message);
              this.registerTerminalSettlement(row.thread_id, {
                runId: row.run_id,
                requestId,
                status: 'failed',
                failureKind,
              });
              settleReattached(null, ownershipError, false, 'failed');
            }
            console.warn('[desktop-agent-runtime] Pi reattach ownership failed closed', {
              requestId,
              runId: row.run_id,
              error: ownershipError,
            });
          }
        }
      } catch (error) {
        if (error instanceof TerminalReattachClaimError) throw error.originalError;
        if (error instanceof ReattachDiscoveryError) throw error.originalError;
        if (error instanceof ReattachSafetyError) throw error.originalError;
        console.warn('[desktop-agent-runtime] skipped one live Pi reattach row', {
          runId: row.run_id,
          threadId: row.thread_id,
          error,
        });
      }
    }
    return attachedRunIds;
  }

  private async runPiTurn(
    input: DesktopAgentRunInput,
    commandName: 'agent_runtime_execute' | 'agent_runtime_resume',
    resumeSession?: { mode: 'open' | 'fresh'; sessionFile: string | null },
  ): Promise<DesktopAgentRunResult> {
    const admission = await this.ensureRunAdmission(input);
    if (this.pendingAbortThreads.delete(input.threadId)) {
      this.acceptingControlThreads.delete(input.threadId);
      this.rejectPendingControls(
        input.threadId,
        new Error('The Pi run was cancelled before it started.'),
      );
      throw new Error('The Pi run was cancelled before it started.');
    }
    const {
      runScope,
      requestId,
      projectId,
      project,
      permissionMode,
      runtimeContext,
      startedEvent,
    } = admission;
    let resolvedModel = admission.resolvedModel;
    let resolvedThinkingLevel = admission.resolvedThinkingLevel;
    const startedAtByTool = new Map<string, number>();
    let finalText = '';
    let reasoningText = '';
    let channelError: Error | null = null;

    // The renderer is the AgentRunEventNormalizer for the ROOT run: it already
    // sees every root fact as a legacy wire line (tool / uiRequest / result /
    // error), so it synthesizes the root's neutral agent.run stream here — the
    // SAME contract child runs arrive on from the host supervisor. The root's
    // runId IS its rootRunId and it has no parent/relation. Every user run gets
    // this stream (not only delegating ones), so a plain dev task drives the
    // office dramaturgy + run projection just like delegated work.
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

    let pendingMessageDelta: Extract<PiAgentHostEvent, { kind: 'messageDelta' }> | null = null;
    const onEvent = new Channel<PiAgentHostEvent>();
    onEvent.onmessage = (event) => {
      if (this.disposed) return;
      if (event.kind === 'streamCursor') {
        if (pendingMessageDelta) {
          const channel = pendingMessageDelta.channel === 'reasoning' ? 'reasoning' : 'content';
          if (channel === 'reasoning') reasoningText += pendingMessageDelta.delta;
          emitPiStreamChunk(
            this.companyId,
            input.threadId,
            pendingMessageDelta.delta,
            channel,
            runScope,
            event.cursor,
          );
          pendingMessageDelta = null;
        }
        this.queueRunStreamCursor(runScope.runId, runtimeContext, event.cursor);
        return;
      }
      if (event.kind === 'messageDelta') {
        pendingMessageDelta = event;
        return;
      }
      if (event.kind === 'started') {
        this.flushPendingControls(input.threadId, requestId);
        const actualModel = hostModelRef(event.model);
        if (actualModel && runtimeContext.model !== actualModel) {
          runtimeContext.model = actualModel;
          this.enqueuePersist(() =>
            this.repos.agentRuns.updateRuntimeContext(
              runScope.runId,
              JSON.stringify(runtimeContext),
            ),
          );
        }
        if (event.sessionFile) {
          this.enqueuePersist(() =>
            this.repos.agentRuns.updateStatus(runScope.runId, 'running', {
              sessionFile: event.sessionFile,
            }),
          );
        }
        return;
      }
      if (event.kind === 'lifecycle') {
        this.handleControlLifecycle(input.threadId, event.payload);
        runtimeEventBus.emit(
          agentLifecycleEvent(this.companyId, input.threadId, {
            requestId,
            runId: runScope.runId,
            event: event.event,
            data:
              event.payload && typeof event.payload === 'object'
                ? (event.payload as Record<string, unknown>)
                : {},
          }),
        );
        return;
      }
      if (event.kind === 'messageEnd' && event.text) {
        finalText = event.text;
        return;
      }
      if (event.kind === 'tool') {
        const startedAt = startedAtByTool.get(event.toolCallId) ?? Date.now();
        if (event.status === 'started') {
          startedAtByTool.set(event.toolCallId, startedAt);
        }
        const completedAt =
          event.status === 'completed' || event.status === 'failed' ? Date.now() : undefined;
        runtimeEventBus.emit(
          toolExecutionTelemetry(this.companyId, input.threadId, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            toolType: 'builtin',
            evidenceClass: 'sdk-native',
            threadId: input.threadId,
            nodeName: 'pi_agent',
            employeeId: input.employeeId ?? undefined,
            startedAt,
            completedAt,
            durationMs:
              event.durationMs ?? (completedAt ? Math.max(0, completedAt - startedAt) : undefined),
            status: toolStatus(event),
            detail: event.detail,
            errorType: event.status === 'failed' ? (event.detail ?? 'pi_tool_failed') : undefined,
            chatConversationKey: runScope.conversationKey,
            chatRunId: runScope.runId,
          }),
        );
        // Normalize the root's tool call onto the run stream (started → completed;
        // the transient `running` update has no agentRun counterpart).
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
        return;
      }
      if (event.kind === 'uiRequest') {
        // The agent paused mid-run to ask the user something (Ask mode). Surface
        // it to the UI carrying this run's requestId so the approval bar can
        // answer it back through agent_runtime_answer.
        runtimeEventBus.emit(
          agentUiRequestEvent(this.companyId, input.threadId, {
            requestId,
            runId: runScope.runId,
            id: event.id,
            method: event.method,
            title: event.title,
            message: event.message,
            options: event.options,
            placeholder: event.placeholder,
            prefill: event.prefill,
          }),
        );
        // A confirm prompt is an approval request — surface it on the run stream
        // so the office stages an approval beat (same contract as a child's).
        if (event.method === 'confirm') {
          emitRootBus(
            rootRun('approval.requested', {
              uiRequestId: event.id,
              title: event.title,
              message: event.message,
            }),
          );
        }
        return;
      }
      if (event.kind === 'agentRun') {
        if (event.runType === 'mcp.tool.called') {
          this.enqueuePersist(() => this.persistMcpToolCall(event, input.employeeId));
          return;
        }
        if (event.runType === 'workspace.lease.snapshot') {
          this.enqueuePersist(() => this.persistWorkspaceLeaseSnapshot(event, projectId));
          return;
        }
        // Mission-bridge signals (MS-005) ride the same `agentRun` wire kind but
        // are NOT run-tree dramaturgy events — they are verification signals for
        // the MissionRunController, not the AgentRunEvent union. Intercept them
        // here and fan them onto the bus on their own channel; never persist them
        // as agent_runs and never feed them to the office projection. The
        // deterministic evaluator over the real workspace is still the truth (§5)
        // — this is only the agent saying "criterion ready".
        if (event.runType === 'evaluation_submitted') {
          const p = (event.payload ?? {}) as {
            criterionId?: string;
            summary?: string;
            evidenceRefs?: string[];
          };
          if (typeof p.criterionId === 'string' && p.criterionId.trim()) {
            runtimeEventBus.emit(
              missionEvaluationSubmittedEvent(this.companyId, event.threadId, {
                runId: event.runId,
                rootRunId: event.rootRunId,
                criterionId: p.criterionId,
                summary: typeof p.summary === 'string' ? p.summary : '',
                evidenceRefs: Array.isArray(p.evidenceRefs)
                  ? p.evidenceRefs.filter((r): r is string => typeof r === 'string')
                  : [],
              }),
            );
          }
          return;
        }
        if (event.runType === 'mission_state_query') {
          // A read-only audit ping; nothing to persist or project. The host
          // already returned the context to the agent synchronously.
          return;
        }
        // A delegation run-tree event. Rebuild the neutral AgentRunEvent, fan it
        // onto the bus (run-tree projection + chat/office consume it), and persist
        // the run's start/finish to agent_runs.
        const agentEvt = {
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
          // An artifact-publish event: persist the deliverable row FIRST, then emit
          // the bus event — so the Outputs refetch only fires after the row exists.
          // (persistArtifact reads + hashes the file and inserts; it emits the bus
          // event itself on a successful insert.)
          this.enqueuePersist(() => this.persistArtifact(agentEvt, projectId));
        } else {
          runtimeEventBus.emit(agentRunEvent(this.companyId, agentEvt));
          this.enqueuePersist(() => this.persistAgentRun(agentEvt));
        }
        return;
      }
      if (event.kind === 'result') {
        finalText = event.response.text || finalText;
        this.flushRunStreamCursor(runScope.runId);
        return;
      }
      if (event.kind === 'error') {
        this.flushRunStreamCursor(runScope.runId);
        channelError = new Error(event.message);
      }
    };

    // Admission already committed the root ahead of both the visible boss message
    // and any paid/tool-capable host work. Re-check Stop immediately before invoke.
    if (this.pendingAbortThreads.delete(input.threadId)) {
      this.acceptingControlThreads.delete(input.threadId);
      this.rejectPendingControls(
        input.threadId,
        new Error('The Pi run was cancelled before it started.'),
      );
      throw new Error('The Pi run was cancelled before it started.');
    }
    this.inFlightByThread.set(input.threadId, requestId);
    this.runIdentityByThread.set(input.threadId, { runId: runScope.runId, requestId });
    try {
      if (commandName === 'agent_runtime_resume') {
        // Only claim the durable row after every preflight above succeeded. From
        // this point onward the catch path reconciles any startup/host failure,
        // so a failed resume cannot strand a ghost `running` row.
        await this.repos.agentRuns.updateStatus(runScope.runId, 'running', {
          finishedAt: null,
        });
      }
      // The durable root row (including requestId) is the discovery anchor for
      // renderer reload. Commit it before any paid/tool-capable Pi work begins.
      // Resume reuses the run id, so refresh its context to the new host request.
      await this.persistAgentRun(startedEvent);
      if (commandName === 'agent_runtime_resume') {
        await this.repos.agentRuns.updateRuntimeContext(
          runScope.runId,
          JSON.stringify(runtimeContext),
        );
      }
      emitRootBus(startedEvent);

      // Resolve, in one DB pass, the acting employee's persona (forwarded as Pi's
      // `appendSystemPrompt`) plus the delegation roster. If this fails, the run
      // fails visibly instead of silently becoming a base Pi run with no employee
      // identity. MCP scope remains a separate safe degradation below.
      const { systemPromptAppend, skillPaths, runtimeSelection, roster } =
        await buildDelegationContext(this.repos, this.companyId, input.employeeId, {
          model: resolvedModel,
          thinkingLevel: resolvedThinkingLevel,
        });
      // A resume stays on its persisted Pi session selection. A new employee-owned
      // run resolves the latest employee binding at send time, so Personnel and
      // TeamDock changes apply without restarting the desktop app.
      if (commandName === 'agent_runtime_execute' && input.employeeId) {
        resolvedModel = runtimeSelection.model;
        resolvedThinkingLevel = runtimeSelection.thinkingLevel;
        runtimeContext.model = resolvedModel ?? null;
        runtimeContext.thinkingLevel = resolvedThinkingLevel ?? null;
        this.enqueuePersist(() =>
          this.repos.agentRuns.updateRuntimeContext(runScope.runId, JSON.stringify(runtimeContext)),
        );
      }
      const mcpTools = await buildMcpScope(
        this.repos,
        this.companyId,
        input.employeeId,
        projectId,
      ).catch(() => []);

      if (this.abortedRequests.has(requestId)) {
        throw new Error('The Pi run was cancelled before its host started.');
      }

      const commandResponse = (await invokeCommand(commandName, {
        req: {
          requestId,
          text: input.text,
          images: input.images ? [...input.images] : null,
          companyId: this.companyId,
          threadId: input.threadId,
          projectId,
          projectVerifyCommand: project?.verify_command ?? undefined,
          projectVerifyMaxAttempts: project?.verify_max_attempts ?? undefined,
          projectVerifyTokenBudget: project?.verify_token_budget ?? undefined,
          employeeId: input.employeeId,
          model: resolvedModel,
          permissionMode,
          // Like `model`: forward only an explicit override, else `undefined` so
          // the host omits it and Pi resolves its own default/session level
          // rather than Offisim pinning every run to `medium`.
          thinkingLevel: resolvedThinkingLevel,
          resumeMode: resumeSession?.mode,
          resumeSessionFile: resumeSession?.sessionFile,
          systemPromptAppend: systemPromptAppend ?? undefined,
          skillPaths,
          // Delegation scope: the root run id lets the host stamp child agentRun
          // events; the roster tells it who can be delegated to. Empty roster →
          // the host registers no delegate tool.
          rootRunId: runScope.runId,
          roster,
          // Mission scope (MS-005): present only on a mission attempt. When set,
          // the host registers the mission-bridge tools; the bridge's events ride
          // this run's rootRunId so the MissionRunController correlates them to the
          // attempt. Undefined on a plain chat — host registers no mission bridge.
          missionContextJson: input.missionContextJson?.trim() || undefined,
          mcpTools,
          directDelegation: input.directDelegation,
          ...(input.delegationLimits !== undefined
            ? { delegationLimits: input.delegationLimits }
            : {}),
        },
        onEvent,
      })) as PiAgentHostResponse;
      // Root session's own usage — folded into the root agent_runs row by
      // reconcileRoot (children come from their own rows). Only in scope in this
      // try-branch; the catch branch's invoke threw before returning.
      const rootUsage = commandResponse.usage;
      this.flushRunStreamCursor(runScope.runId);
      if (commandResponse.reasoning && !reasoningText.trim()) {
        runtimeEventBus.emit(
          llmStreamChunk(
            this.companyId,
            input.threadId,
            'pi_agent',
            commandResponse.reasoning,
            'reasoning',
            runScope,
          ),
        );
      }
      finalText = commandResponse.text || finalText;
      if (channelError) throw channelError;
      const reasoning = (commandResponse.reasoning || reasoningText).trim();
      // A Rust abort resolves the invoke with empty text (not an error), so
      // classify the terminal from the aborted-set: cancelled, not completed.
      if (this.abortedRequests.has(requestId)) {
        emitRootBus(rootRun('run.cancelled', { status: 'cancelled' }));
        this.registerTerminalSettlement(input.threadId, {
          runId: runScope.runId,
          requestId,
          status: 'cancelled',
          usage: rootUsage,
        });
      } else {
        emitRootBus(
          rootRun('run.completed', {
            status: 'completed',
            ...(finalText ? { summary: finalText } : {}),
            ...(rootUsage ? { usage: rootUsage } : {}),
          }),
        );
        this.registerTerminalSettlement(input.threadId, {
          runId: runScope.runId,
          requestId,
          status: 'completed',
          usage: rootUsage,
        });
      }
      await this.persistQueue.drain();
      if (!input.deferTerminalSettlement) {
        await this.settleRun(
          input.threadId,
          this.abortedRequests.has(requestId) ? 'cancelled' : 'completed',
        );
      }
      return {
        text: finalText,
        ...(reasoning ? { reasoning } : {}),
        ...(rootUsage ? { usage: rootUsage } : {}),
        ...(commandResponse.budgetUsage ? { budgetUsage: commandResponse.budgetUsage } : {}),
      };
    } catch (err) {
      // A thrown invoke / channel error is a failure unless the user aborted —
      // abort wins (it can surface as a throw on some teardown paths).
      const aborted = this.abortedRequests.has(requestId);
      const status = aborted ? 'cancelled' : 'failed';
      const message = err instanceof Error ? err.message : String(err);
      // A thrown invoke / channel error carries this lane's origin free text —
      // classify the typed kind from it (provider messages surface here too);
      // a cancel never carries a failureKind.
      const failureKind = aborted ? undefined : classifyRunFailure(message);
      this.flushRunStreamCursor(runScope.runId);
      emitRootBus(
        aborted
          ? rootRun('run.cancelled', { status, summary: message })
          : rootRun('run.failed', { status, summary: message, failureKind }),
      );
      // rootUsage isn't in scope here — the invoke threw before returning it, so
      // there is no root usage to fold in. reconcileRoot still sums any children.
      this.registerTerminalSettlement(input.threadId, {
        runId: runScope.runId,
        requestId,
        status,
        failureKind,
      });
      await this.persistQueue.drain();
      if (!input.deferTerminalSettlement) {
        await this.settleRun(input.threadId, status);
      }
      throw err;
    } finally {
      this.pendingAbortThreads.delete(input.threadId);
      this.acceptingControlThreads.delete(input.threadId);
      this.controlReadyByThread.delete(input.threadId);
      this.rejectPendingControls(
        input.threadId,
        new Error('The Pi run ended before the queued message could be delivered.'),
      );
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
  private async reconcileRoot(
    rootRunId: string,
    status: 'completed' | 'failed' | 'cancelled',
    rootUsage?: AgentRunUsage,
    failureKind?: RunFailureKind,
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
    // Child reconciliation must finish before the root terminal marker. If one
    // child write fails, the root remains discoverable as running and the retained
    // stream can replay the same idempotent settlement on the next renderer.
    await Promise.all(dangling.map((id) => repo.updateStatus(id, 'cancelled', { finishedAt })));
    await persistRunCostAndNotify({
      persist: () =>
        repo.updateStatus(rootRunId, status, {
          finishedAt,
          usageJson,
          // The root's typed failure cause is only meaningful on a failed
          // terminal; completed/cancelled roots never write one.
          ...(status === 'failed' ? { failureKind: failureKind ?? null } : {}),
        }),
      eventSink: runtimeEventBus,
      companyId: this.companyId,
      threadId: root?.thread_id ?? '',
      runId: rootRunId,
    });
  }

  /** Persist a run lifecycle to agent_runs. Delegation events use the serialized
   *  queue, which contains failures; the root start awaits this method directly
   *  so no paid/tool-capable run starts without its durable discovery row. */
  private async persistAgentRun(evt: AgentRunEvent): Promise<void> {
    const repo = this.repos.agentRuns;
    if (evt.type === 'run.started') {
      const payload = evt.payload as AgentRunStartedPayload;
      // Insert-if-absent: a resume replays run.started for an existing run; the
      // existing row (already flipped interrupted→running with partial usage by
      // the resume lane) must be left untouched, not re-created or clobbered.
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
  private async persistArtifact(evt: AgentRunEvent, projectId: string | null): Promise<void> {
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
    // Read the file through the sandboxed workspace command. A workspace-jail
    // violation or a missing file rejects here → no row, no bus event.
    let content: string;
    try {
      content = (await invokeCommand('project_read_file', { path, projectId })) as string;
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

  async abort(threadId: string): Promise<void> {
    let identity = this.runIdentityByThread.get(threadId);
    const admission = this.admissionsByThread.get(threadId);
    if (!identity && admission) {
      this.pendingAbortThreads.add(threadId);
      try {
        await admission.promise;
      } catch {
        // Admission observed the pending Stop and created no durable row/host.
        this.pendingAbortThreads.delete(threadId);
        return;
      }
      identity = this.runIdentityByThread.get(threadId);
    }
    const liveRequestId = this.inFlightByThread.get(threadId);
    const requestId = liveRequestId ?? identity?.requestId;
    if (!requestId) {
      if (this.acceptingControlThreads.has(threadId)) this.pendingAbortThreads.add(threadId);
      return;
    }
    // Mark before invoking: a Rust abort resolves execute()'s invoke with empty
    // text, and the flag is how execute() knows to classify the terminal as
    // cancelled rather than completed.
    const abortWasAlreadyAcknowledged = this.abortedRequests.has(requestId);
    this.abortedRequests.add(requestId);
    if (!liveRequestId) {
      if (identity) this.registerTerminalSettlement(threadId, { ...identity, status: 'cancelled' });
      return;
    }
    let terminalSnapshot: PiRunStreamSnapshot | null;
    try {
      await this.invokeRuntimeCommand('agent_runtime_abort', { requestId });
    } catch (error) {
      try {
        terminalSnapshot = await this.invokeRuntimeCommand('agent_runtime_stream_snapshot', {
          requestId,
        });
      } catch (snapshotError) {
        if (!abortWasAlreadyAcknowledged) this.abortedRequests.delete(requestId);
        if (this.inFlightByThread.get(threadId) === requestId) {
          this.controlReadyByThread.set(threadId, requestId);
          this.acceptingControlThreads.add(threadId);
        }
        throw new AggregateError(
          [error, snapshotError],
          `Could not confirm whether Pi request ${requestId} stopped.`,
        );
      }
      if (terminalSnapshot?.terminal?.status !== 'aborted') {
        if (!abortWasAlreadyAcknowledged) this.abortedRequests.delete(requestId);
        if (terminalSnapshot?.running && this.inFlightByThread.get(threadId) === requestId) {
          this.controlReadyByThread.set(threadId, requestId);
          this.acceptingControlThreads.add(threadId);
        }
        throw error;
      }
      if (terminalSnapshot?.terminal?.status === 'aborted') {
        this.controlReadyByThread.delete(threadId);
        this.rejectPendingControls(
          threadId,
          new Error('The queued message was cancelled with the run.'),
        );
        const unsettledIdentity = this.runIdentityByThread.get(threadId);
        if (unsettledIdentity) {
          this.registerTerminalSettlement(threadId, {
            ...unsettledIdentity,
            status: 'cancelled',
          });
        }
        return;
      }
      throw error;
    }
    // Rust synchronously accepted the cancellation token. There is no safe
    // timeout rollback from this point: a slow child may unwind after any local
    // deadline and must still classify as cancelled. Keep controller ownership
    // and duplicate-submit blocking until the retained stream proves terminal.
    terminalSnapshot = await this.waitForTerminalStream(requestId, 'confirmed-stop');
    if (terminalSnapshot?.terminal?.status !== 'aborted') {
      if (!abortWasAlreadyAcknowledged) this.abortedRequests.delete(requestId);
      if (terminalSnapshot?.running && this.inFlightByThread.get(threadId) === requestId) {
        this.controlReadyByThread.set(threadId, requestId);
        this.acceptingControlThreads.add(threadId);
      }
      throw new Error(
        `Pi request ${requestId} reached ${terminalSnapshot?.terminal?.status ?? 'an unknown terminal state'} before Stop was acknowledged.`,
      );
    }
    this.controlReadyByThread.delete(threadId);
    this.rejectPendingControls(
      threadId,
      new Error('The queued message was cancelled with the run.'),
    );
    const unsettledIdentity = this.runIdentityByThread.get(threadId);
    if (unsettledIdentity) {
      this.registerTerminalSettlement(threadId, {
        ...unsettledIdentity,
        status: 'cancelled',
      });
    }
  }

  abortChild(threadId: string, runId: string): void {
    const requestId = this.inFlightByThread.get(threadId);
    if (!requestId) return;
    void invokeCommand('agent_runtime_control', { requestId, action: 'stopChild', runId }).catch(
      (err: unknown) => console.warn('[desktop-agent-runtime] child stop failed', { runId, err }),
    );
  }

  async answerUiRequest(answer: AgentUiAnswer): Promise<void> {
    await invokeCommand('agent_runtime_answer', {
      requestId: answer.requestId,
      id: answer.id,
      confirmed: answer.confirmed,
      value: answer.value,
      cancelled: answer.cancelled,
    });
  }

  async dispose(): Promise<void> {
    // Renderer dispose is a detach boundary, not a user cancel. Explicit Stop
    // still calls abort(threadId); unmount/reload must leave the Rust host alive
    // so a fresh renderer can `agent_runtime_reattach` by the persisted requestId.
    this.disposed = true;
    this.inFlightByThread.clear();
    this.controlReadyByThread.clear();
    this.acceptingControlThreads.clear();
    this.pendingAbortThreads.clear();
    for (const threadId of this.pendingControlsByThread.keys()) {
      this.rejectPendingControls(threadId, new Error('The renderer detached before delivery.'));
    }
  }
}

const runtimeCache = new Map<string, Promise<DesktopAgentRuntime>>();

async function assembleRuntime(companyId: string): Promise<DesktopAgentRuntime> {
  const repos = await getRepos();
  for (const required of ['threads', 'chatThreads', 'projects'] as const) {
    if (!repos[required]) {
      throw new Error(`Cannot start Agent runtime: repos.${required} is unavailable.`);
    }
  }
  const runtime = new DesktopPiAgentRuntime(companyId, repos);
  return runtime;
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
