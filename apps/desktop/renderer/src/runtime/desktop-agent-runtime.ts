import { buildDelegationContext, buildMcpScope } from '@/data/employee-persona.js';
import {
  type TaskWorkspaceBindingClaim,
  type TaskWorkspaceBindingProjection,
  invokeCommand,
  parseTaskWorkspaceBindingProjection,
} from '@/lib/tauri-commands.js';
import { requireProjectWorkspaceForRun } from '@/runtime/require-project-workspace.js';
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
  type TurnExecutionProvenance,
  assertSameExecutionAccount,
  requireTurnExecutionProvenance,
} from './execution-provenance.js';
import {
  MISSION_EVALUATION_SUBMITTED_EVENT,
  type MissionEvaluationSubmittedPayload,
} from './mission/mission-events.js';
import { readPiModelOverride } from './pi-agent-config.js';
import type { PiAgentHostEvent, PiAgentHostResponse } from './pi-runtime-driver.js';
import { persistRunStartIfAbsent } from './recovery/persist-run-idempotency.js';
import {
  PI_HOST_PROTOCOL_VERSION,
  describeWorkspaceResumeCompatibility,
  resolveAgentRunProjectId,
} from './recovery/reconcile-interrupted-runs.js';
import { aggregateSubtreeUsage } from './recovery/usage-aggregation.js';
import {
  acceptWorkspaceBinding,
  canConsumeWorkspaceEvent,
  createWorkspaceBindingGate,
  rejectWorkspaceBinding,
} from './workspace-binding-stream-gate.js';

const PI_SDK_VERSION = '0.79.8';

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
   * Ephemeral capability for the exact workspace selected by the backend for
   * this Turn. Callers may pass it back only to binding-scoped commands; it is
   * never persisted, logged, or reconstructed from the current Project row.
   */
  workspaceBindingClaim: TaskWorkspaceBindingClaim;
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
}

export type { AiBillingMode, TurnExecutionProvenance } from './execution-provenance.js';

export interface IsolatedTextJobInput {
  jobId: string;
  text: string;
  systemPrompt: string;
  sourceProvenance: TurnExecutionProvenance;
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
  requestId: string;
  id: string;
  confirmed?: boolean;
  value?: string;
  cancelled?: boolean;
}

export interface DesktopAgentRuntime {
  execute(input: DesktopAgentRunInput): Promise<DesktopAgentRunResult>;
  generateText(input: IsolatedTextJobInput): Promise<IsolatedTextJobResult>;
  resume(runId: string): Promise<DesktopAgentRunResult>;
  abort(threadId: string): void;
  abortChild(threadId: string, runId: string): void;
  /** Deliver the user's answer to a mid-run `agent.ui.request` back to the host. */
  answerUiRequest(answer: AgentUiAnswer): Promise<void>;
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

function hostModelRef(
  model: Extract<PiAgentHostEvent, { kind: 'started' }>['model'],
): string | null {
  if (!model?.id) return null;
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

interface PersistedRunContext {
  requestId?: string | null;
  streamCursor?: number | null;
  workspaceBinding: TaskWorkspaceBindingProjection | null;
  runtime: 'pi-agent';
  piSdkVersion: string;
  wireProtocolVersion: number;
  model: string | null;
  provenance: TurnExecutionProvenance | null;
  permissionMode: string;
  thinkingLevel: string | null;
  projectId: string | null;
  createdAt: string;
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

function parseRunContext(raw: string | null | undefined): Partial<PersistedRunContext> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      requestId: typeof parsed.requestId === 'string' ? parsed.requestId : null,
      streamCursor: typeof parsed.streamCursor === 'number' ? parsed.streamCursor : null,
      workspaceBinding: parseTaskWorkspaceBindingProjection(parsed.workspaceBinding),
      runtime: parsed.runtime === 'pi-agent' ? 'pi-agent' : undefined,
      piSdkVersion: typeof parsed.piSdkVersion === 'string' ? parsed.piSdkVersion : undefined,
      wireProtocolVersion:
        typeof parsed.wireProtocolVersion === 'number' ? parsed.wireProtocolVersion : undefined,
      model: typeof parsed.model === 'string' ? parsed.model : null,
      provenance:
        parsed.provenance && typeof parsed.provenance === 'object'
          ? (parsed.provenance as TurnExecutionProvenance)
          : null,
      permissionMode: typeof parsed.permissionMode === 'string' ? parsed.permissionMode : undefined,
      thinkingLevel: typeof parsed.thinkingLevel === 'string' ? parsed.thinkingLevel : null,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : null,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
    };
  } catch {
    return null;
  }
}

function normalizeStreamCursor(cursor: unknown): number {
  return Number.isSafeInteger(cursor) && Number(cursor) > 0 ? Number(cursor) : 0;
}

class DesktopPiAgentRuntime implements DesktopAgentRuntime {
  private readonly inFlightByThread = new Map<string, string>();
  // Request ids the user aborted. A Rust-side abort kills the host and resolves
  // the invoke with empty text (not an error), so execute() consults this to
  // classify the root run's terminal as cancelled rather than completed/failed.
  private readonly abortedRequests = new Set<string>();
  // Serializes agent-run persistence in event order, catches failures at each
  // task boundary, and coalesces high-frequency stream cursors per run.
  private readonly persistQueue = new AgentRunPersistenceQueue();

  constructor(
    private readonly companyId: string,
    private readonly repos: RuntimeRepositories,
  ) {}

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

  async execute(input: DesktopAgentRunInput): Promise<DesktopAgentRunResult> {
    return this.runPiTurn(input, 'agent_runtime_execute');
  }

  async generateText(input: IsolatedTextJobInput): Promise<IsolatedTextJobResult> {
    if (input.sourceProvenance.engineId !== 'pi-agent') {
      throw new Error(
        `Pi adapter cannot run an isolated job for engine ${input.sourceProvenance.engineId}.`,
      );
    }
    const requestId = input.jobId.trim();
    if (!requestId || !input.text.trim() || !input.systemPrompt.trim()) {
      throw new Error('Isolated text job requires jobId, text, and systemPrompt.');
    }
    const onEvent = new Channel<PiAgentHostEvent>();
    const onAbort = () => {
      void invokeCommand('agent_runtime_abort', { requestId }).catch(() => undefined);
    };
    if (input.signal) {
      if (input.signal.aborted) onAbort();
      else input.signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
      const response = (await invokeCommand('agent_runtime_enhance', {
        req: {
          requestId,
          text: input.text,
          systemPrompt: input.systemPrompt,
          model: input.sourceProvenance.modelId,
          thinkingLevel: input.thinkingLevel,
          sourceProvenance: input.sourceProvenance,
        },
        onEvent,
      })) as PiAgentHostResponse;
      const provenance = requireTurnExecutionProvenance(response.provenance, requestId);
      assertSameExecutionAccount(input.sourceProvenance, provenance);
      return {
        text: response.text,
        provenance,
        ...(response.usage ? { usage: response.usage } : {}),
      };
    } finally {
      input.signal?.removeEventListener('abort', onAbort);
    }
  }

  async resume(runId: string): Promise<DesktopAgentRunResult> {
    const repo = this.repos.agentRuns;
    const row = await repo.findById(runId);
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
    if (compatibility.status !== 'same') {
      throw new Error(
        `Cannot resume Agent runtime run: ${describeWorkspaceResumeCompatibility(compatibility) ?? 'The original Project folder no longer matches this run.'}`,
      );
    }
    return this.runPiTurn(
      {
        text: `Continue the interrupted task from its saved agent session.\n\nOriginal objective:\n${
          row.objective || 'Untitled run'
        }`,
        threadId: row.thread_id,
        employeeId: row.employee_id,
        projectId,
        runId: row.run_id,
        permissionMode: savedPermissionMode
          ? savedPermissionMode
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
      workspaceBinding,
    );
  }

  async reattachLiveRuns(): Promise<void> {
    const repo = this.repos.agentRuns;
    const rows = await repo.findByStatus(this.companyId, ['running']).catch(() => []);
    for (const row of rows) {
      if (row.parent_run_id) continue;
      const context = parseRunContext(row.runtime_context_json);
      const runtimeContext: Partial<PersistedRunContext> = context ?? {};
      const requestId =
        typeof context?.requestId === 'string' && context.requestId.trim()
          ? context.requestId.trim()
          : null;
      if (!requestId) continue;
      const snapshot = await invokeCommand('agent_runtime_stream_snapshot', {
        requestId,
      }).catch(() => null);
      // Terminal streams remain replayable until the host TTL expires. A renderer
      // can disconnect after the host finishes but before SQLite receives the
      // Result, so `running: false` must still reattach and reconcile that result.
      if (!snapshot) continue;

      const projectId = resolveAgentRunProjectId(row);
      const expectedAccess = row.access === 'read' || row.access === 'write' ? row.access : null;
      const runScope = piRunScope(projectId, row.thread_id, row.employee_id, row.run_id);
      const startedAtByTool = new Map<string, number>();
      let workspaceBindingGate = createWorkspaceBindingGate<TaskWorkspaceBindingClaim>();
      let bindingFailurePersisted = false;
      let bindingAbortPromise: Promise<void> | null = null;
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
      const abortRejectedBinding = (): Promise<void> => {
        if (!bindingAbortPromise) {
          bindingAbortPromise = invokeCommand('agent_runtime_abort', { requestId }).catch(
            (err: unknown) => {
              console.warn('[desktop-agent-runtime] rejected reattach abort failed', {
                requestId,
                err,
              });
            },
          );
        }
        return bindingAbortPromise;
      };
      const failReattachedBinding = (message: string): void => {
        if (bindingFailurePersisted) return;
        bindingFailurePersisted = true;
        void abortRejectedBinding();
        this.flushRunStreamCursor(row.run_id);
        emitRootBus(
          rootRun('run.failed', { status: 'failed', summary: message, failureKind: 'runtime' }),
        );
        this.enqueuePersist(() => this.reconcileRoot(row.run_id, 'failed', undefined, 'runtime'));
        if (this.inFlightByThread.get(row.thread_id) === requestId) {
          this.inFlightByThread.delete(row.thread_id);
        }
      };
      const consumeEvent = (
        event: PiAgentHostEvent,
        consumptionPolicy: 'bound-required' | 'terminal-reconcile',
      ): void => {
        if (event.kind === 'streamCursor') {
          this.queueRunStreamCursor(row.run_id, runtimeContext, event.cursor);
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
            workspaceBindingGate.status !== 'bound' ||
            isSameWorkspaceBindingClaim(workspaceBindingGate.claim, event);
          workspaceBindingGate = acceptWorkspaceBinding(
            workspaceBindingGate,
            event,
            matchesExpectedTurn,
            matchesBoundClaim,
          );
          if (workspaceBindingGate.status === 'rejected') {
            const message = 'Backend returned a workspace binding for a different Turn.';
            console.warn('[desktop-agent-runtime] rejected mismatched workspace binding', {
              runId: row.run_id,
              historyId: event.historyId,
            });
            failReattachedBinding(message);
            return;
          }
          runtimeContext.workspaceBinding = projectWorkspaceBinding(event);
          this.enqueuePersist(() =>
            this.repos.agentRuns.updateRuntimeContext(row.run_id, JSON.stringify(runtimeContext)),
          );
          return;
        }
        if (!canConsumeWorkspaceEvent(workspaceBindingGate, event.kind, consumptionPolicy)) {
          if (consumptionPolicy === 'bound-required' && workspaceBindingGate.status === 'pending') {
            workspaceBindingGate =
              rejectWorkspaceBinding<TaskWorkspaceBindingClaim>(workspaceBindingGate);
            failReattachedBinding(
              `Backend emitted ${event.kind} before binding the reattached task workspace.`,
            );
          }
          return;
        }
        if (event.kind === 'started') {
          const actualModel = hostModelRef(event.model);
          if (actualModel && runtimeContext.model !== actualModel) {
            runtimeContext.model = actualModel;
            this.enqueuePersist(() =>
              this.repos.agentRuns.updateRuntimeContext(row.run_id, JSON.stringify(runtimeContext)),
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
        if (event.kind === 'messageDelta' && event.delta) {
          const channel = event.channel === 'reasoning' ? 'reasoning' : 'content';
          runtimeEventBus.emit(
            llmStreamChunk(
              this.companyId,
              row.thread_id,
              'pi_agent',
              event.delta,
              channel,
              runScope,
            ),
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
              errorType: event.status === 'failed' ? (event.detail ?? 'pi_tool_failed') : undefined,
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
            this.enqueuePersist(() => this.persistArtifact(agentEvt, workspaceBindingGate.claim));
          } else {
            runtimeEventBus.emit(agentRunEvent(this.companyId, agentEvt));
            this.enqueuePersist(() => this.persistAgentRun(agentEvt));
          }
          return;
        }
        if (event.kind === 'result') {
          let provenance: TurnExecutionProvenance;
          try {
            provenance = requireTurnExecutionProvenance(event.response.provenance, row.run_id);
          } catch (error) {
            const summary = error instanceof Error ? error.message : String(error);
            this.flushRunStreamCursor(row.run_id);
            emitRootBus(
              rootRun('run.failed', { status: 'failed', summary, failureKind: 'runtime' }),
            );
            this.enqueuePersist(() =>
              this.reconcileRoot(row.run_id, 'failed', undefined, 'runtime'),
            );
            if (this.inFlightByThread.get(row.thread_id) === requestId) {
              this.inFlightByThread.delete(row.thread_id);
            }
            return;
          }
          runtimeContext.provenance = provenance;
          runtimeContext.model = provenance.modelId;
          this.enqueuePersist(() =>
            this.repos.agentRuns.updateRuntimeContext(row.run_id, JSON.stringify(runtimeContext)),
          );
          this.flushRunStreamCursor(row.run_id);
          emitRootBus(
            rootRun('run.completed', {
              status: 'completed',
              ...(event.response.text ? { summary: event.response.text } : {}),
              ...(event.response.usage ? { usage: event.response.usage } : {}),
            }),
          );
          this.enqueuePersist(() =>
            this.reconcileRoot(row.run_id, 'completed', event.response.usage),
          );
          if (this.inFlightByThread.get(row.thread_id) === requestId) {
            this.inFlightByThread.delete(row.thread_id);
          }
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
          this.enqueuePersist(() =>
            this.reconcileRoot(row.run_id, 'failed', undefined, failureKind),
          );
          if (this.inFlightByThread.get(row.thread_id) === requestId) {
            this.inFlightByThread.delete(row.thread_id);
          }
        }
      };

      let consumptionPolicy: 'bound-required' | 'terminal-reconcile' | null = null;
      const bufferedEvents: PiAgentHostEvent[] = [];
      let bufferedBindingGate = createWorkspaceBindingGate<TaskWorkspaceBindingClaim>();
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
        }
        bufferedEvents.push(event);
      };

      this.inFlightByThread.set(row.thread_id, requestId);
      try {
        const reattachSnapshot = await invokeCommand('agent_runtime_reattach', {
          requestId,
          afterCursor: normalizeStreamCursor(runtimeContext.streamCursor),
          onEvent,
        });
        if (bindingFailurePersisted) {
          if (bindingAbortPromise) await bindingAbortPromise;
          bufferedEvents.length = 0;
          continue;
        }
        consumptionPolicy =
          reattachSnapshot.running || bufferedBindingGate.status === 'bound'
            ? 'bound-required'
            : 'terminal-reconcile';
        for (const event of bufferedEvents) consumeEvent(event, consumptionPolicy);
        bufferedEvents.length = 0;
      } catch (err: unknown) {
        if (bindingAbortPromise) await bindingAbortPromise;
        if (this.inFlightByThread.get(row.thread_id) === requestId) {
          this.inFlightByThread.delete(row.thread_id);
        }
        console.warn('[desktop-agent-runtime] reattach live Pi stream failed', {
          requestId,
          runId: row.run_id,
          err,
        });
      }
    }
  }

  private async runPiTurn(
    input: DesktopAgentRunInput,
    commandName: 'agent_runtime_execute' | 'agent_runtime_resume',
    resumeWorkspaceBinding?: TaskWorkspaceBindingProjection,
  ): Promise<DesktopAgentRunResult> {
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
    const runScope = piRunScope(projectId, input.threadId, input.employeeId, input.runId);
    const requestId = newRequestId('pi-agent');
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
    const permissionMode = input.permissionMode?.trim() || resolveThreadMode(input.threadId);
    const rootAccess: 'read' | 'write' = permissionMode === 'plan' ? 'read' : 'write';
    let resolvedModel = input.model?.trim() || readPiModelOverride() || undefined;
    let resolvedThinkingLevel =
      input.thinkingLevel?.trim() || resolveThreadThinkingOverride(input.threadId);
    const runtimeContext: PersistedRunContext = {
      requestId,
      streamCursor: 0,
      workspaceBinding:
        commandName === 'agent_runtime_resume' ? (resumeWorkspaceBinding ?? null) : null,
      runtime: 'pi-agent',
      piSdkVersion: PI_SDK_VERSION,
      wireProtocolVersion: PI_HOST_PROTOCOL_VERSION,
      model: resolvedModel ?? null,
      provenance: null,
      permissionMode,
      thinkingLevel: resolvedThinkingLevel ?? null,
      projectId,
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

    let rootRunOpened = false;
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

    let workspaceBindingGate = createWorkspaceBindingGate<TaskWorkspaceBindingClaim>();
    let bindingAbortPromise: Promise<void> | null = null;
    const abortRejectedBinding = (): Promise<void> => {
      if (!bindingAbortPromise) {
        bindingAbortPromise = invokeCommand('agent_runtime_abort', { requestId }).catch(
          (err: unknown) => {
            console.warn('[desktop-agent-runtime] rejected workspace binding abort failed', {
              requestId,
              err,
            });
          },
        );
      }
      return bindingAbortPromise;
    };
    const onEvent = new Channel<PiAgentHostEvent>();
    onEvent.onmessage = (event) => {
      if (event.kind === 'streamCursor') {
        this.queueRunStreamCursor(runScope.runId, runtimeContext, event.cursor);
        return;
      }
      if (event.kind === 'workspaceBound') {
        const matchesExpectedTurn = bindingMatchesRun(event, {
          companyId: this.companyId,
          projectId,
          threadId: input.threadId,
          turnId: runScope.runId,
          requestId,
          access: rootAccess,
        });
        const matchesBoundClaim =
          workspaceBindingGate.status !== 'bound' ||
          isSameWorkspaceBindingClaim(workspaceBindingGate.claim, event);
        workspaceBindingGate = acceptWorkspaceBinding(
          workspaceBindingGate,
          event,
          matchesExpectedTurn,
          matchesBoundClaim,
        );
        if (workspaceBindingGate.status === 'rejected') {
          channelError ??= new Error('Backend returned a workspace binding for a different Turn.');
          void abortRejectedBinding();
          return;
        }
        runtimeContext.workspaceBinding = projectWorkspaceBinding(event);
        openRootRun();
        this.enqueuePersist(() =>
          this.repos.agentRuns.updateRuntimeContext(runScope.runId, JSON.stringify(runtimeContext)),
        );
        return;
      }
      if (!canConsumeWorkspaceEvent(workspaceBindingGate, event.kind, 'bound-required')) {
        if (workspaceBindingGate.status === 'pending') {
          workspaceBindingGate =
            rejectWorkspaceBinding<TaskWorkspaceBindingClaim>(workspaceBindingGate);
          channelError = new Error(
            `Backend emitted ${event.kind} before binding the task workspace.`,
          );
          void abortRejectedBinding();
        }
        return;
      }
      if (event.kind === 'started') {
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
      if (event.kind === 'messageDelta' && event.delta) {
        const channel = event.channel === 'reasoning' ? 'reasoning' : 'content';
        if (channel === 'reasoning') {
          reasoningText += event.delta;
        }
        runtimeEventBus.emit(
          llmStreamChunk(
            this.companyId,
            input.threadId,
            'pi_agent',
            event.delta,
            channel,
            runScope,
          ),
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
          this.enqueuePersist(() => this.persistArtifact(agentEvt, workspaceBindingGate.claim));
        } else {
          runtimeEventBus.emit(agentRunEvent(this.companyId, agentEvt));
          this.enqueuePersist(() => this.persistAgentRun(agentEvt));
        }
        return;
      }
      if (event.kind === 'result') {
        finalText = event.response.text || finalText;
        try {
          const provenance = requireTurnExecutionProvenance(
            event.response.provenance,
            runScope.runId,
          );
          runtimeContext.provenance = provenance;
          runtimeContext.model = provenance.modelId;
          this.enqueuePersist(() =>
            this.repos.agentRuns.updateRuntimeContext(
              runScope.runId,
              JSON.stringify(runtimeContext),
            ),
          );
        } catch (error) {
          channelError = error instanceof Error ? error : new Error(String(error));
          return;
        }
        this.flushRunStreamCursor(runScope.runId);
        this.enqueuePersist(() =>
          this.reconcileRoot(runScope.runId, 'completed', event.response.usage),
        );
        return;
      }
      if (event.kind === 'error') {
        this.flushRunStreamCursor(runScope.runId);
        channelError = new Error(event.message);
      }
    };

    // A new run must exist before child events can reference it. Resume already
    // has a durable interrupted row, so it stays untouched until workspaceBound
    // proves backend authority revalidation succeeded.
    if (commandName === 'agent_runtime_execute') openRootRun();

    this.inFlightByThread.set(input.threadId, requestId);
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

      const commandResponse = (await invokeCommand(commandName, {
        req: {
          requestId,
          text: input.text,
          companyId: this.companyId,
          threadId: input.threadId,
          projectId,
          employeeId: input.employeeId,
          model: resolvedModel,
          permissionMode,
          // Like `model`: forward only an explicit override, else `undefined` so
          // the host omits it and Pi resolves its own default/session level
          // rather than Offisim pinning every run to `medium`.
          thinkingLevel: resolvedThinkingLevel,
          systemPromptAppend: systemPromptAppend ?? undefined,
          skillPaths,
          // Delegation scope: the root run id lets the host stamp child agentRun
          // events; the roster tells it who can be delegated to. Empty roster →
          // the host registers no delegate tool.
          rootRunId: runScope.runId,
          ...(commandName === 'agent_runtime_resume'
            ? { workspaceBindingHistoryId: resumeWorkspaceBinding?.historyId }
            : {}),
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
      if (channelError) throw channelError;
      if (!workspaceBindingGate.claim) {
        throw new Error('Backend completed the Turn without a task workspace binding claim.');
      }
      // Root session's own usage — folded into the root agent_runs row by
      // reconcileRoot (children come from their own rows). Only in scope in this
      // try-branch; the catch branch's invoke threw before returning.
      const rootUsage = commandResponse.usage;
      const provenance = requireTurnExecutionProvenance(commandResponse.provenance, runScope.runId);
      if (runtimeContext.provenance?.runId !== provenance.runId) {
        runtimeContext.provenance = provenance;
        runtimeContext.model = provenance.modelId;
        this.enqueuePersist(() =>
          this.repos.agentRuns.updateRuntimeContext(runScope.runId, JSON.stringify(runtimeContext)),
        );
      }
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
      const reasoning = (commandResponse.reasoning || reasoningText).trim();
      // A Rust abort resolves the invoke with empty text (not an error), so
      // classify the terminal from the aborted-set: cancelled, not completed.
      if (this.abortedRequests.has(requestId)) {
        emitRootBus(rootRun('run.cancelled', { status: 'cancelled' }));
        this.enqueuePersist(() => this.reconcileRoot(runScope.runId, 'cancelled', rootUsage));
      } else {
        emitRootBus(
          rootRun('run.completed', {
            status: 'completed',
            ...(finalText ? { summary: finalText } : {}),
            ...(rootUsage ? { usage: rootUsage } : {}),
          }),
        );
        this.enqueuePersist(() => this.reconcileRoot(runScope.runId, 'completed', rootUsage));
      }
      await this.persistQueue.drain();
      return {
        text: finalText,
        workspaceBindingClaim: workspaceBindingGate.claim,
        ...(reasoning ? { reasoning } : {}),
        ...(rootUsage ? { usage: rootUsage } : {}),
        provenance,
        ...(commandResponse.budgetUsage ? { budgetUsage: commandResponse.budgetUsage } : {}),
      };
    } catch (err) {
      if (bindingAbortPromise) await bindingAbortPromise;
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
      this.enqueuePersist(() => this.reconcileRoot(runScope.runId, status, undefined, failureKind));
      await this.persistQueue.drain();
      throw err;
    } finally {
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
  private async reconcileRoot(
    rootRunId: string,
    status: 'completed' | 'failed' | 'cancelled',
    rootUsage?: AgentRunUsage,
    failureKind?: RunFailureKind,
  ): Promise<void> {
    const repo = this.repos.agentRuns;
    const finishedAt = new Date().toISOString();
    try {
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
      await persistRunCostAndNotify({
        persist: async () => {
          await Promise.all([
            repo.updateStatus(rootRunId, status, {
              finishedAt,
              usageJson,
              // The root's typed failure cause is only meaningful on a failed
              // terminal; completed/cancelled roots never write one.
              ...(status === 'failed' ? { failureKind: failureKind ?? null } : {}),
            }),
            ...dangling.map((id) => repo.updateStatus(id, 'cancelled', { finishedAt })),
          ]);
        },
        eventSink: runtimeEventBus,
        companyId: this.companyId,
        threadId: root?.thread_id ?? '',
        runId: rootRunId,
      });
    } catch (err) {
      console.warn('[desktop-agent-runtime] finalize root agent_run failed', { rootRunId, err });
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
    void invokeCommand('agent_runtime_abort', { requestId }).catch((err: unknown) => {
      console.warn('[desktop-agent-runtime] Pi abort failed', { threadId, err });
    });
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
    this.inFlightByThread.clear();
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
  await runtime.reattachLiveRuns().catch((err) => {
    console.warn('[desktop-agent-runtime] live run reattach bootstrap failed', { companyId, err });
  });
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
