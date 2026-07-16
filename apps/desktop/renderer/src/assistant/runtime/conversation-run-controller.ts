import {
  loadPersistedChatMessagesByIdsWithRepositories,
  persistChatMessage,
} from '@/data/chat-message-events.js';
import {
  claimSemanticTitleJob,
  generateSemanticThreadTitle,
} from '@/data/semantic-thread-title.js';
import { appendThreadMessageEvent } from '@/data/thread-message-events.js';
import type { ChatMessage, ChatToolCall, RunError, StagedAttachment } from '@/data/types.js';
import {
  AGENT_UI_REQUEST_EVENT,
  AGENT_UI_REQUEST_RESOLVED_EVENT,
  AgentTerminalCheckpointError,
  type AgentUiRequestPayload,
  type AgentUiRequestResolvedPayload,
  type DesktopAgentRuntime,
  type DirectDelegationInput,
  LIVE_CONVERSATION_TERMINAL_EVENT,
  type LiveConversationTerminalPayload,
  type LiveRunReattachResult,
  type TurnExecutionProvenance,
  getDesktopAgentRuntime,
} from '@/runtime/desktop-agent-runtime.js';
import { missionRunManager } from '@/runtime/mission/mission-run-manager.js';
import { getRepos, runtimeEventBus } from '@/runtime/repos.js';
import {
  type ThreadRunLease,
  conversationThreadLifecycle,
} from '@/runtime/thread-lifecycle-guard.js';
import {
  type AgentRunRow,
  type EventBus,
  type FreshSessionConversationProjection,
  type RuntimeRepositories,
  decodeFreshSessionContext,
} from '@offisim/core/browser';
import {
  type ToolRichDetail,
  mergeToolRichDetail,
  parseToolRichDetail,
} from '@offisim/shared-types';
import type {
  AgentRunEvent,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
  RunFailureKind,
  RuntimeEvent,
  ToolExecutionTelemetryPayload,
  WorkKind,
  WorkspaceProvenance,
} from '@offisim/shared-types';
import { formatWorkspaceProvenance } from '../presentation/workspace-provenance.js';
import {
  buildRunError,
  displayAttachmentsFromStaged,
  materializeChatTurn,
  newDraftId,
  upsertChatToolCall,
} from './desktop-chat-runtime.js';

const CHECKPOINT_INTERVAL_MS = 3_000;
const ACTIVE_PHASES = new Set<ConversationRunPhase>(['preparing', 'running', 'awaiting-approval']);
const WORK_KINDS = new Set<WorkKind>([
  'plan',
  'research',
  'design',
  'implement',
  'review',
  'test',
  'compute',
  'publish',
  'present',
  'coordinate',
]);
const FAILURE_KINDS = new Set<RunFailureKind>([
  'token',
  'budget',
  'permission',
  'context',
  'runtime',
  'tool',
]);

export type ConversationRunPhase =
  | 'idle'
  | 'preparing'
  | 'running'
  | 'awaiting-approval'
  | 'completed'
  | 'interrupted'
  | 'failed';

interface RunToolActivity {
  id: string;
  tool: string;
  state: 'running' | 'done' | 'error';
  detail?: string;
  richDetail?: ToolRichDetail;
  workspaceProvenance?: WorkspaceProvenance;
  durationMs?: number;
}

/** A delegation in this run's tree — a teammate's child run. `runId` is the
 *  child's id; `parentRunId` is who delegated it (the root's attemptId for a
 *  direct child, or another child's runId for a nested delegation), so the strip
 *  can render the tree. The child grafts under this run because its `rootRunId`
 *  equals this run's `attemptId`. */
interface RunDelegation {
  runId: string;
  parentRunId: string | null;
  employeeId: string | null;
  objective: string;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  summary?: string;
  /** Work semantics from the run's scope fields (absent = unclassified). */
  readonly workKind?: WorkKind;
  /** Typed failure cause copied from a failed terminal payload; never set on
   *  done/cancelled delegations. */
  readonly failureKind?: RunFailureKind;
}

export interface PendingApproval {
  engineId: string;
  threadId: string;
  attemptId: string;
  hostRequestId: string;
  uiRequestId: string;
  method: string;
  title: string;
  message?: string;
  questions?: readonly PendingUserInputQuestion[];
  autoResolutionMs?: number;
  // 'live' — the host is awaiting this answer now. 'stale' — restored after a
  // restart (host gone; re-presented, not directly answerable). 'expired' — a
  // restored request older than STALE_APPROVAL_EXPIRY_MS (too old to act on,
  // dismiss only).
  state: 'live' | 'stale' | 'expired';
  createdAt: number;
}

interface PendingUserInputOption {
  label: string;
  description?: string;
}

export interface PendingUserInputQuestion {
  id: string;
  header: string;
  question: string;
  options: readonly PendingUserInputOption[];
  isOther: boolean;
  isSecret: boolean;
}

export type StructuredUserInputAnswers = Readonly<
  Record<string, { readonly answers: readonly string[] }>
>;

/** A restored UI request older than this is `expired` (dismiss-only), not just
 *  `stale`. The host that would consume the answer is long gone; after a day the
 *  request is surfaced as expired so the user discards rather than waits on it. */
const STALE_APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseUserInputQuestions(params: unknown): {
  questions: readonly PendingUserInputQuestion[];
  autoResolutionMs?: number;
} | null {
  if (!isRecord(params) || !Array.isArray(params.questions)) return null;
  if (params.questions.length < 1 || params.questions.length > 3) return null;
  const ids = new Set<string>();
  const questions: PendingUserInputQuestion[] = [];
  for (const raw of params.questions) {
    if (!isRecord(raw)) return null;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const header = typeof raw.header === 'string' ? raw.header.trim() : '';
    const question = typeof raw.question === 'string' ? raw.question.trim() : '';
    if (!id || ids.has(id) || !header || !question) return null;
    ids.add(id);
    const rawOptions = raw.options == null ? [] : raw.options;
    if (!Array.isArray(rawOptions) || rawOptions.length > 3) return null;
    const options: PendingUserInputOption[] = [];
    for (const rawOption of rawOptions) {
      if (!isRecord(rawOption)) return null;
      const label = typeof rawOption.label === 'string' ? rawOption.label.trim() : '';
      if (!label) return null;
      options.push({
        label,
        ...(typeof rawOption.description === 'string' && rawOption.description.trim()
          ? { description: rawOption.description.trim() }
          : {}),
      });
    }
    questions.push({
      id,
      header,
      question,
      options,
      isOther: raw.isOther === true,
      isSecret: raw.isSecret === true,
    });
  }
  const autoResolutionMs =
    typeof params.autoResolutionMs === 'number' &&
    Number.isFinite(params.autoResolutionMs) &&
    params.autoResolutionMs >= 60_000 &&
    params.autoResolutionMs <= 240_000
      ? params.autoResolutionMs
      : undefined;
  return { questions, ...(autoResolutionMs ? { autoResolutionMs } : {}) };
}

function interactionEngineId(payload: { source?: string; engineId?: unknown }): string | null {
  if (payload.source === 'pi-ui-request') return 'api';
  if (payload.source !== 'agent-ui-request') return null;
  return typeof payload.engineId === 'string' && payload.engineId.trim()
    ? payload.engineId.trim()
    : null;
}

function isSupportedUiRequest(method: string, questions?: readonly PendingUserInputQuestion[]) {
  return method === 'confirm' || (method === 'requestUserInput' && Boolean(questions?.length));
}

export function normalizeStructuredAnswers(
  questions: readonly PendingUserInputQuestion[],
  raw: StructuredUserInputAnswers | undefined,
): StructuredUserInputAnswers | null {
  if (!raw || Object.keys(raw).length !== questions.length) return null;
  const normalized: Record<string, { answers: readonly string[] }> = {};
  for (const question of questions) {
    const values = raw[question.id]?.answers;
    if (!Array.isArray(values) || values.length !== 1 || typeof values[0] !== 'string') return null;
    const value = question.isSecret ? values[0] : values[0].trim();
    if (!value.trim()) return null;
    const optionLabels = question.options.map((option) => option.label);
    if (optionLabels.length && !optionLabels.includes(value) && !question.isOther) return null;
    normalized[question.id] = { answers: [value] };
  }
  return normalized;
}

export interface ConversationRunSnapshot {
  threadId: string;
  companyId: string | null;
  projectId: string | null;
  attemptId: string | null;
  phase: ConversationRunPhase;
  employeeId: string | null;
  source: 'office' | 'workspace' | null;
  liveMessages: readonly ChatMessage[];
  activity: readonly RunToolActivity[];
  activityTotal: number;
  delegations: readonly RunDelegation[];
  approval: PendingApproval | null;
  error: RunError | null;
}

export interface ConversationRunsSnapshot {
  runs: readonly ConversationRunSnapshot[];
  activeRuns: readonly ConversationRunSnapshot[];
  pendingApprovals: readonly PendingApproval[];
}

export interface SubmitConversationRun {
  companyId: string;
  projectId: string | null;
  threadId: string;
  employeeId: string | null;
  text: string;
  stagedAttachments: readonly StagedAttachment[];
  model?: string;
  permissionMode?: string;
  thinkingLevel?: string;
  source: 'office' | 'workspace';
  persistMessage?: (message: ChatMessage) => Promise<void>;
  /** Called once the user turn is durably persisted. Composer drafts must only
   *  be consumed at this boundary so materialization/DB failures keep them. */
  onMessagePersisted?: () => void;
  /** Refreshes conversation-list projections after a background semantic title
   * wins its conditional write. The title job itself never depends on React. */
  onThreadTitleUpdated?: () => void;
  /**
   * PR-10: a Loop-backed turn. When present, this turn does NOT run a plain chat
   * agent. The hand-off is deliberately two-phase: materialize durable Loop/Mission
   * records first, persist the visible user message second, and only then start the
   * paid Mission. A failed message write compensates the prepared records; a failed
   * start retains the already-linked ready Mission and retries that exact hand-off.
   */
  loopExecution?: {
    materialize: (messageId: string) => Promise<PreparedLoopExecution>;
  };
  directDelegation?: DirectDelegationInput;
}

interface PreparedLoopExecution {
  start: (transferredThreadRun?: ThreadRunLease, signal?: AbortSignal) => Promise<void>;
  compensate: () => Promise<void>;
}

export interface ConversationRunHandle {
  threadId: string;
  attemptId: string;
  userMessageId: string;
}

export interface AnswerApprovalInput {
  threadId: string;
  attemptId: string;
  hostRequestId: string;
  uiRequestId: string;
  confirmed?: boolean;
  value?: string;
  answers?: StructuredUserInputAnswers;
  cancelled?: boolean;
}

type MaterializeTurn = (input: {
  text: string;
  companyId: string | null;
  threadId: string;
  staged: readonly StagedAttachment[];
}) => Promise<{ promptText: string; attachments: ChatMessage['attachments'] }>;

interface ConversationRunControllerDeps {
  eventBus: EventBus;
  runtimeFactory: (companyId: string) => Promise<DesktopAgentRuntime>;
  reposFactory: () => Promise<RuntimeRepositories>;
  materializeTurn: MaterializeTurn;
  persistMessage: typeof persistChatMessage;
  loadMessagesByIds: typeof loadPersistedChatMessagesByIdsWithRepositories;
  appendEvent: typeof appendThreadMessageEvent;
  now: () => number;
  randomUUID: () => string;
  /** Renderer-owned Mission loops share chat threads but not Conversation UI.
   * Their roots must never be hydrated, reattached, or aborted as chat runs. */
  isMissionThreadRunning: (threadId: string) => boolean;
}

interface RetryRecord {
  input: SubmitConversationRun;
  userMessage: ChatMessage;
  assistantMessageId: string;
  promptText: string;
  messagePersisted: boolean;
  clearRestoredApproval: boolean;
  pendingLoopHandoff: PendingLoopHandoff | null;
}

interface PendingLoopHandoff {
  prepared: PreparedLoopExecution;
  messagePersisted: boolean;
}

interface NativeSessionRecovery {
  mode: 'fresh';
  sourceRunId: string;
}

interface ActiveRun {
  input: SubmitConversationRun;
  threadId: string;
  attemptId: string;
  userMessage: ChatMessage;
  assistantMessageId: string;
  assistantMessage: ChatMessage | null;
  promptText: string | null;
  contentText: string;
  reasoningText: string;
  toolCalls: ChatToolCall[];
  workspaceProvenance: WorkspaceProvenance | null;
  activity: RunToolActivity[];
  activityTotal: number;
  delegations: RunDelegation[];
  runtime: DesktopAgentRuntime | null;
  stopped: boolean;
  lastCheckpointAt: number;
  firstCheckpointWritten: boolean;
  messagePersistedNotified: boolean;
  clearRestoredApproval: boolean;
  pendingLoopHandoff: PendingLoopHandoff | null;
  nativeSessionRecovery: NativeSessionRecovery | null;
  reattached: boolean;
  hostConnected: boolean;
  terminalizing: boolean;
  executionAbortController: AbortController | null;
  threadRunLease: ThreadRunLease | null;
  resolveReattachSettlement: (() => void) | null;
  unsubscribers: Array<() => void>;
}

type LiveRunHydrationResult = 'hydrated' | 'owned_elsewhere' | 'projection_missing';

function parseConversationProjection(raw: string | null): {
  userMessageId: string;
  assistantMessageId: string;
  source: 'office' | 'workspace';
  model?: string;
  permissionMode?: string;
  thinkingLevel?: string;
} | null {
  if (!raw) return null;
  try {
    const context = JSON.parse(raw) as Record<string, unknown>;
    const projection = context.conversationProjection as Record<string, unknown> | undefined;
    if (
      !projection ||
      typeof projection.userMessageId !== 'string' ||
      !projection.userMessageId.trim() ||
      typeof projection.assistantMessageId !== 'string' ||
      !projection.assistantMessageId.trim() ||
      (projection.source !== 'office' && projection.source !== 'workspace')
    ) {
      return null;
    }
    return {
      userMessageId: projection.userMessageId,
      assistantMessageId: projection.assistantMessageId,
      source: projection.source,
      ...(typeof context.model === 'string' && context.model.trim()
        ? { model: context.model }
        : {}),
      ...(typeof context.permissionMode === 'string' && context.permissionMode.trim()
        ? { permissionMode: context.permissionMode }
        : {}),
      ...(typeof context.thinkingLevel === 'string' && context.thinkingLevel.trim()
        ? { thinkingLevel: context.thinkingLevel }
        : {}),
    };
  } catch {
    return null;
  }
}

interface DurableFreshSessionSource {
  row: AgentRunRow;
  projection: FreshSessionConversationProjection;
  projectId: string | null;
}

function durableFreshSessionSource(row: AgentRunRow): DurableFreshSessionSource | null {
  const context = decodeFreshSessionContext(row);
  if (!context) return null;
  return {
    row,
    projection: context.projection,
    projectId: row.project_id ?? context.projectId,
  };
}

function defaultSnapshot(threadId: string): ConversationRunSnapshot {
  return {
    threadId,
    companyId: null,
    projectId: null,
    attemptId: null,
    phase: 'idle',
    employeeId: null,
    source: null,
    liveMessages: [],
    activity: [],
    activityTotal: 0,
    delegations: [],
    approval: null,
    error: null,
  };
}

export function isConversationRunActive(phase: ConversationRunPhase): boolean {
  return ACTIVE_PHASES.has(phase);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error');
}

function terminalToolState(
  status: ToolExecutionTelemetryPayload['status'],
): 'done' | 'error' | null {
  if (status === 'completed') return 'done';
  if (status === 'error') return 'error';
  return null;
}

function detailFromTelemetry(payload: ToolExecutionTelemetryPayload): string | undefined {
  if (payload.errorType) return payload.errorType;
  if (payload.workspaceProvenance) {
    return formatWorkspaceProvenance(payload.workspaceProvenance) ?? undefined;
  }
  // `nodeName` is execution telemetry, not product identity. The current API
  // adapter still emits the historical `pi_agent` node internally, but ordinary
  // activity UI must stay engine-neutral while diagnostics keep the raw event.
  const productNodeName =
    payload.nodeName === 'pi_agent' || payload.nodeName === 'agent_runtime'
      ? undefined
      : payload.nodeName;
  const productToolType = payload.toolType === 'builtin' ? 'Built-in' : payload.toolType;
  const parts = [payload.serverName, productNodeName, productToolType].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function eventThreadId(
  event: RuntimeEvent<unknown>,
  payload: Record<string, unknown>,
): string | null {
  return (
    (typeof payload.chatThreadId === 'string' && payload.chatThreadId) ||
    (typeof payload.threadId === 'string' && payload.threadId) ||
    event.threadId ||
    null
  );
}

function eventRunId(payload: Record<string, unknown>): string | null {
  return (
    (typeof payload.chatRunId === 'string' && payload.chatRunId) ||
    (typeof payload.runId === 'string' && payload.runId) ||
    null
  );
}

function stripToolCalls(message: ChatMessage): ChatMessage {
  const { toolCalls: _toolCalls, ...rest } = message;
  return rest;
}

function restoreDelegation(row: AgentRunRow): RunDelegation | null {
  if (row.run_id === row.root_run_id) return null;
  const workKind = WORK_KINDS.has(row.work_kind as WorkKind)
    ? (row.work_kind as WorkKind)
    : undefined;
  const failureKind = FAILURE_KINDS.has(row.failure_kind as RunFailureKind)
    ? (row.failure_kind as RunFailureKind)
    : undefined;
  const state: RunDelegation['state'] =
    row.status === 'running'
      ? 'running'
      : row.status === 'completed'
        ? 'done'
        : row.status === 'failed'
          ? 'failed'
          : 'cancelled';
  return {
    runId: row.run_id,
    parentRunId: row.parent_run_id,
    employeeId: row.employee_id,
    objective: row.objective ?? '',
    state,
    ...(workKind ? { workKind } : {}),
    ...(row.status === 'failed' && failureKind ? { failureKind } : {}),
  };
}

/**
 * Fields that the global snapshot (employee run states, pending approvals, run
 * pills) projects from. `liveMessages` is intentionally excluded: it churns on
 * every streamed token, but no global consumer reads it, so skipping global
 * notification on text-only updates keeps the office scene from re-rendering
 * per token.
 */
function globalFieldsChanged(
  prev: ConversationRunSnapshot,
  next: ConversationRunSnapshot,
): boolean {
  return (
    prev.companyId !== next.companyId ||
    prev.projectId !== next.projectId ||
    prev.attemptId !== next.attemptId ||
    prev.phase !== next.phase ||
    prev.employeeId !== next.employeeId ||
    prev.source !== next.source ||
    prev.activity !== next.activity ||
    prev.activityTotal !== next.activityTotal ||
    // Delegation start/stop must re-notify the global snapshot: the office
    // workload projection derives activeCount / dominant from delegations, so a
    // child run starting or finishing has to invalidate it or the x2/x3 badge
    // and parallel actor lighting go stale.
    prev.delegations !== next.delegations ||
    prev.approval !== next.approval ||
    prev.error !== next.error
  );
}

export class ConversationRunAlreadyActiveError extends Error {
  constructor(threadId: string) {
    super(`Conversation ${threadId} already has an active run.`);
    this.name = 'ConversationRunAlreadyActiveError';
  }
}

export class ConversationRunMutationLockedError extends Error {
  constructor(threadId: string) {
    super(`Conversation ${threadId} is being changed and cannot start a run.`);
    this.name = 'ConversationRunMutationLockedError';
  }
}

export class ConversationRunController {
  // Presentation state is in memory, while its recovery identity is durable:
  // agent_runs.runtime_context_json owns the native request + message projection
  // refs. The production runtime atomically couples assistant checkpoints to its
  // replay cursor; the controller only owns fallback checkpoints for test/custom
  // gateways that do not expose that capability. On renderer reload the startup
  // barrier rebuilds this map and subscriptions before stale-run reconciliation.
  private readonly snapshots = new Map<string, ConversationRunSnapshot>();
  private readonly idleSnapshots = new Map<string, ConversationRunSnapshot>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly mutationLocks = new Set<string>();
  private readonly retryRecords = new Map<string, RetryRecord>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly globalListeners = new Set<() => void>();
  private globalSnapshot: ConversationRunsSnapshot | null = null;
  private hydrationByCompany = new Set<string>();
  private readonly liveBootstrapByCompany = new Map<string, Promise<LiveRunReattachResult>>();

  constructor(private readonly deps: ConversationRunControllerDeps) {}

  async submit(input: SubmitConversationRun): Promise<ConversationRunHandle> {
    const trimmed = input.text.trim();
    if (!trimmed) throw new Error('Cannot submit an empty conversation run.');
    if (this.mutationLocks.has(input.threadId))
      throw new ConversationRunMutationLockedError(input.threadId);
    if (this.activeRuns.has(input.threadId))
      throw new ConversationRunAlreadyActiveError(input.threadId);

    // A restored approval belongs to the abandoned pre-restart turn. It may be
    // shown as dismiss-only history, but it cannot block or attach itself to a
    // new turn. The cleanup runs as retryable preflight after beginRun has
    // synchronously claimed the thread, preserving duplicate-submit atomicity.
    const restoredApproval = this.currentSnapshot(input.threadId).approval;
    const clearRestoredApproval = restoredApproval !== null && restoredApproval.state !== 'live';

    const attemptId = `attempt-${this.deps.randomUUID()}`;
    const userMessage: ChatMessage = {
      id: newDraftId('boss'),
      threadId: input.threadId,
      author: 'boss',
      employeeId: null,
      body: trimmed,
      at: this.deps.now(),
      attachments: displayAttachmentsFromStaged(input.stagedAttachments),
      status: 'complete',
    };
    const run = this.beginRun(
      { ...input, text: trimmed },
      attemptId,
      userMessage,
      null,
      clearRestoredApproval,
    );
    this.trackRunTask(run, this.runAttempt(run));
    return { threadId: input.threadId, attemptId, userMessageId: userMessage.id };
  }

  async retry(threadId: string, attemptId: string): Promise<ConversationRunHandle> {
    if (this.mutationLocks.has(threadId)) throw new ConversationRunMutationLockedError(threadId);
    if (this.activeRuns.has(threadId)) throw new ConversationRunAlreadyActiveError(threadId);
    const record = this.retryRecords.get(attemptId);
    if (!record || record.input.threadId !== threadId) throw new Error('Cannot retry this run.');

    const nextAttemptId = `attempt-${this.deps.randomUUID()}`;
    const run = this.beginRun(
      record.input,
      nextAttemptId,
      record.userMessage,
      record.promptText,
      record.clearRestoredApproval,
    );
    run.messagePersistedNotified = record.messagePersisted;
    run.pendingLoopHandoff = record.pendingLoopHandoff;
    if (record.pendingLoopHandoff) {
      this.trackRunTask(run, this.resumeLoopHandoff(run, record.pendingLoopHandoff));
    } else if (record.input.loopExecution || !record.messagePersisted) {
      // Materialization/message persistence failed and compensation succeeded, so
      // retrying from preflight is safe. A durable user message skips this path,
      // so model failures still retry only the paid execute attempt.
      this.trackRunTask(run, this.runAttempt(run));
    } else {
      this.trackRunTask(run, this.executeAttempt(run));
    }
    return { threadId, attemptId: nextAttemptId, userMessageId: record.userMessage.id };
  }

  private async latestFreshSessionSource(
    companyId: string,
    threadId: string,
    sourceRunId: string,
    expectedUserMessageId: string,
    expectedAssistantMessageId: string,
  ): Promise<DurableFreshSessionSource | null> {
    const repos = await this.deps.reposFactory();
    const latest = await repos.agentRuns.findFreshSessionSource(companyId, threadId, sourceRunId);
    if (!latest) return null;
    const source = durableFreshSessionSource(latest);
    if (
      !source ||
      source.projection.userMessageId !== expectedUserMessageId ||
      source.projection.assistantMessageId !== expectedAssistantMessageId
    ) {
      return null;
    }
    return source;
  }

  async startFreshSession(threadId: string, sourceRunId: string): Promise<ConversationRunHandle> {
    // Claim the thread synchronously, before the first DB await. This closes the
    // double-click and concurrent Submit window while validating durable Fresh
    // authority. The release -> beginRun handoff below is synchronous, so no
    // second JS task can enter between the mutation lease and run lease.
    let releaseMutation = this.acquireMutationLock(threadId);
    if (!releaseMutation) {
      if (this.activeRuns.has(threadId)) throw new ConversationRunAlreadyActiveError(threadId);
      throw new ConversationRunMutationLockedError(threadId);
    }
    try {
      const record = this.retryRecords.get(sourceRunId);
      if (!record || record.input.threadId !== threadId || record.input.loopExecution) {
        throw new Error('This fresh-session recovery is no longer available.');
      }
      const source = await this.latestFreshSessionSource(
        record.input.companyId,
        threadId,
        sourceRunId,
        record.userMessage.id,
        record.assistantMessageId,
      );
      if (!source || source.projectId !== record.input.projectId) {
        throw new Error('A newer Turn replaced this fresh-session recovery action.');
      }
      const nextAttemptId = `attempt-${this.deps.randomUUID()}`;
      releaseMutation();
      releaseMutation = null;
      const run = this.beginRun(
        record.input,
        nextAttemptId,
        record.userMessage,
        record.promptText,
        record.clearRestoredApproval,
        { mode: 'fresh', sourceRunId },
      );
      run.messagePersistedNotified = record.messagePersisted;
      this.trackRunTask(run, this.executeAttempt(run));
      return { threadId, attemptId: nextAttemptId, userMessageId: record.userMessage.id };
    } finally {
      releaseMutation?.();
    }
  }

  private freshSessionRunError(
    threadId: string,
    attemptId: string,
    technicalDetail: string,
  ): RunError {
    return {
      ...buildRunError(technicalDetail),
      message: 'The saved work session for this Conversation is unavailable.',
      recoveryAction: {
        label: 'Start fresh session',
        run: () => {
          this.dismissError(threadId);
          void this.startFreshSession(threadId, attemptId).catch((error: unknown) => {
            // A duplicate action or concurrent caller must never overwrite the
            // snapshot owned by a newly-started attempt (or the mutation lease
            // that is about to become one).
            if (
              this.mutationLocks.has(threadId) ||
              this.activeRuns.has(threadId) ||
              this.currentSnapshot(threadId).attemptId !== attemptId
            ) {
              return;
            }
            this.patchSnapshot(threadId, {
              phase: 'failed',
              error: {
                ...buildRunError(safeErrorMessage(error)),
                message: 'Fresh-session recovery is no longer available.',
              },
            });
          });
        },
      },
    };
  }

  private beginRun(
    input: SubmitConversationRun,
    attemptId: string,
    userMessage: ChatMessage,
    promptText: string | null,
    clearRestoredApproval: boolean,
    nativeSessionRecovery: NativeSessionRecovery | null = null,
  ): ActiveRun {
    const threadRunLease = conversationThreadLifecycle.beginRun(input.threadId);
    if (!threadRunLease) throw new ConversationRunAlreadyActiveError(input.threadId);
    const run: ActiveRun = {
      input,
      threadId: input.threadId,
      attemptId,
      userMessage,
      assistantMessageId: newDraftId('assistant'),
      assistantMessage: null,
      promptText,
      contentText: '',
      reasoningText: '',
      toolCalls: [],
      workspaceProvenance: null,
      activity: [],
      activityTotal: 0,
      delegations: [],
      runtime: null,
      stopped: false,
      lastCheckpointAt: 0,
      firstCheckpointWritten: false,
      messagePersistedNotified: false,
      clearRestoredApproval,
      pendingLoopHandoff: null,
      nativeSessionRecovery,
      reattached: false,
      hostConnected: false,
      terminalizing: false,
      executionAbortController: null,
      threadRunLease,
      resolveReattachSettlement: null,
      unsubscribers: [],
    };
    this.activeRuns.set(input.threadId, run);
    this.setSnapshot(input.threadId, {
      threadId: input.threadId,
      companyId: input.companyId,
      projectId: input.projectId,
      attemptId,
      phase: 'preparing',
      employeeId: input.employeeId,
      source: input.source,
      liveMessages: [userMessage],
      activity: [],
      activityTotal: 0,
      delegations: [],
      approval: null,
      error: null,
    });
    return run;
  }

  stop(threadId: string): void {
    void this.stopAndWait(threadId).catch((error: unknown) => {
      console.warn('[conversation-run] stop cleanup failed', { threadId, error });
    });
  }

  isActive(threadId: string): boolean {
    return this.activeRuns.has(threadId);
  }

  acquireMutationLock(threadId: string): (() => void) | null {
    const releaseLifecycle = conversationThreadLifecycle.acquireMutation(threadId);
    if (!releaseLifecycle) return null;
    if (this.activeRuns.has(threadId) || this.mutationLocks.has(threadId)) {
      releaseLifecycle();
      return null;
    }
    this.mutationLocks.add(threadId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.mutationLocks.delete(threadId);
      releaseLifecycle();
    };
  }

  async stopAndWait(threadId: string): Promise<void> {
    const run = this.activeRuns.get(threadId);
    if (!run) return;
    if (run.stopped) return;
    run.stopped = true;
    // Stop is already the user's terminal intent. Retain the partial prose but
    // retire every live tool projection immediately; native cleanup may finish
    // a moment later and must not leave the visible Conversation claiming that
    // a command is still running in the meantime.
    if (run.assistantMessage) {
      run.assistantMessage = {
        ...stripToolCalls(run.assistantMessage),
        status: 'interrupted',
      };
    }
    run.executionAbortController?.abort();
    if (!run.reattached) this.unsubscribeRun(run);
    run.runtime?.abort(threadId);
    this.patchSnapshot(threadId, {
      attemptId: run.attemptId,
      phase: 'interrupted',
      employeeId: run.input.employeeId,
      source: run.input.source,
      liveMessages: run.assistantMessage
        ? [run.userMessage, run.assistantMessage]
        : [run.userMessage],
      approval: null,
      activity: run.activity,
      activityTotal: run.activityTotal,
    });
    this.saveRetryRecord(run);
  }

  stopChild(threadId: string, runId: string): void {
    this.activeRuns.get(threadId)?.runtime?.abortChild(threadId, runId);
  }

  async answerApproval(input: AnswerApprovalInput): Promise<void> {
    const run = this.activeRuns.get(input.threadId);
    const snapshot = this.currentSnapshot(input.threadId);
    const approval = snapshot.approval;
    if (
      !run ||
      !approval ||
      approval.state !== 'live' ||
      approval.attemptId !== input.attemptId ||
      approval.hostRequestId !== input.hostRequestId ||
      approval.uiRequestId !== input.uiRequestId
    ) {
      // Never log the input object: request-user-input may contain secret answers.
      console.warn('[conversation-run] ignored stale interaction answer');
      return;
    }

    if (!isSupportedUiRequest(approval.method, approval.questions)) {
      console.warn('[conversation-run] ignored unsupported interaction answer');
      return;
    }
    if (!run.runtime) throw new Error('Cannot answer approval before runtime is attached.');
    const answers =
      approval.method === 'requestUserInput' && !input.cancelled
        ? normalizeStructuredAnswers(approval.questions ?? [], input.answers)
        : undefined;
    if (approval.method === 'requestUserInput' && !input.cancelled && !answers) {
      throw new Error('Every requested answer must be completed before submitting.');
    }
    await run.runtime.answerUiRequest({
      runId: input.attemptId,
      requestId: input.hostRequestId,
      id: input.uiRequestId,
      confirmed: input.confirmed,
      value: input.value,
      ...(answers ? { answers } : {}),
      cancelled: input.cancelled,
    });
    // The host has already received the answer, so this approval can never be
    // re-answered. Clearing the local snapshot must therefore happen even if the
    // DB write below throws — otherwise the pending banner stays stuck while the
    // run continues, splitting host and local state. Clear in `finally`.
    try {
      await this.resolveActiveInteraction(
        run,
        approval,
        input.cancelled ? 'cancelled' : 'resolved',
        approval.method === 'requestUserInput'
          ? {
              submitted: !input.cancelled,
              cancelled: input.cancelled === true,
              questionIds: approval.questions?.map((question) => question.id) ?? [],
            }
          : {
              confirmed: input.confirmed,
              value: input.value,
              cancelled: input.cancelled,
            },
      );
    } finally {
      this.setSnapshot(input.threadId, {
        ...this.currentSnapshot(input.threadId),
        phase: 'running',
        approval: null,
      });
    }
  }

  async dismissApproval(threadId: string): Promise<void> {
    const snapshot = this.currentSnapshot(threadId);
    const approval = snapshot.approval;
    if (!approval) return;
    const repos = await this.deps.reposFactory();
    await repos.activeInteractions?.deleteByThread(threadId);
    this.setSnapshot(threadId, { ...snapshot, approval: null, phase: 'interrupted' });
  }

  dismissError(threadId: string): void {
    const snapshot = this.currentSnapshot(threadId);
    if (!snapshot.error) return;
    this.setSnapshot(threadId, { ...snapshot, error: null });
  }

  async hydrateStaleApprovals(companyId: string): Promise<void> {
    if (this.hydrationByCompany.has(companyId)) return;
    this.hydrationByCompany.add(companyId);
    // Hydration reads the DB, which can fail transiently (repos not ready, query
    // error). If it throws, drop the company key so a later call re-attempts —
    // leaving the key set would permanently block re-hydration for this company.
    try {
      const bootstrap = await this.bootstrapLiveRuns(companyId);
      if (!bootstrap.complete) {
        throw new Error('Live-run bootstrap is incomplete; approval hydration must retry.');
      }
      const repos = await this.deps.reposFactory();
      const rows = (await repos.activeInteractions?.findByCompany(companyId)) ?? [];
      for (const row of rows) {
        if (this.activeRuns.has(row.thread_id)) continue;
        let payload: Partial<PendingApproval> & { source?: string } = {};
        try {
          payload = JSON.parse(row.payload_json ?? '{}');
        } catch {
          payload = {};
        }
        const engineId = interactionEngineId(payload);
        if (!engineId) continue;
        const parsedInput =
          payload.method === 'requestUserInput'
            ? parseUserInputQuestions({
                questions: payload.questions,
                autoResolutionMs: payload.autoResolutionMs,
              })
            : null;
        const method = String(payload.method ?? 'confirm');
        if (!isSupportedUiRequest(method, parsedInput?.questions)) continue;
        const createdAt = Date.parse(row.created_at) || this.deps.now();
        // A restored request past the expiry window can no longer be acted on.
        const expired = this.deps.now() - createdAt > STALE_APPROVAL_EXPIRY_MS;
        const approval: PendingApproval = {
          engineId,
          threadId: row.thread_id,
          attemptId: String(payload.attemptId ?? row.interaction_id),
          hostRequestId: String(payload.hostRequestId ?? ''),
          uiRequestId: String(payload.uiRequestId ?? row.interaction_id),
          method,
          title: String(payload.title ?? 'Approval needed'),
          message: typeof payload.message === 'string' ? payload.message : undefined,
          ...(parsedInput?.questions ? { questions: parsedInput.questions } : {}),
          ...(parsedInput?.autoResolutionMs
            ? { autoResolutionMs: parsedInput.autoResolutionMs }
            : {}),
          state: expired ? 'expired' : 'stale',
          createdAt,
        };
        this.patchSnapshot(row.thread_id, {
          companyId,
          // The host that owned this request is gone. Keep the request as a
          // dismiss-only historical notice, never as a live run phase.
          phase: 'interrupted',
          attemptId: approval.attemptId,
          approval,
        });
      }
    } catch (error) {
      this.hydrationByCompany.delete(companyId);
      throw error;
    }
  }

  async hydrateFreshSessionAction(companyId: string, threadId: string): Promise<void> {
    if (!threadId || this.activeRuns.has(threadId) || this.mutationLocks.has(threadId)) return;
    const repos = await this.deps.reposFactory();
    const latest = await repos.agentRuns.findLatestFreshSessionCandidate(companyId, threadId);
    if (!latest) return;
    const source = durableFreshSessionSource(latest);
    if (!source) return;
    const messages = await this.deps.loadMessagesByIds({
      repos,
      threadId,
      messageIds: [source.projection.userMessageId, source.projection.assistantMessageId],
    });
    // Message hydration yields to the event loop. A newer Turn may start and
    // even finish during that await, so re-read the exact durable authority
    // before publishing the old Fresh snapshot. There is no await between
    // this check and the snapshot write.
    const currentRow = await repos.agentRuns.findFreshSessionSource(
      companyId,
      threadId,
      latest.run_id,
    );
    const current = currentRow ? durableFreshSessionSource(currentRow) : null;
    if (
      !current ||
      current.projection.userMessageId !== source.projection.userMessageId ||
      current.projection.assistantMessageId !== source.projection.assistantMessageId ||
      this.activeRuns.has(threadId) ||
      this.mutationLocks.has(threadId)
    ) {
      return;
    }
    const userMessage = messages.find(
      (message) =>
        message.id === current.projection.userMessageId &&
        message.threadId === threadId &&
        message.author === 'boss',
    );
    if (!userMessage) return;
    const assistantMessage = messages.find(
      (message) =>
        message.id === current.projection.assistantMessageId &&
        message.threadId === threadId &&
        message.attemptId === current.row.run_id,
    );
    const input: SubmitConversationRun = {
      companyId,
      projectId: current.projectId,
      threadId,
      employeeId: current.row.employee_id,
      text: userMessage.body,
      stagedAttachments: [],
      source: current.projection.source,
      ...(current.projection.model ? { model: current.projection.model } : {}),
      ...(current.projection.permissionMode
        ? { permissionMode: current.projection.permissionMode }
        : {}),
      ...(current.projection.thinkingLevel
        ? { thinkingLevel: current.projection.thinkingLevel }
        : {}),
    };
    this.retryRecords.set(current.row.run_id, {
      input,
      userMessage,
      assistantMessageId: current.projection.assistantMessageId,
      promptText: current.row.objective?.trim() || userMessage.body,
      messagePersisted: true,
      clearRestoredApproval: false,
      pendingLoopHandoff: null,
    });
    this.setSnapshot(threadId, {
      threadId,
      companyId,
      projectId: current.projectId,
      attemptId: current.row.run_id,
      phase: 'failed',
      employeeId: current.row.employee_id,
      source: current.projection.source,
      liveMessages: assistantMessage ? [userMessage, assistantMessage] : [userMessage],
      activity: [],
      activityTotal: 0,
      delegations: [],
      approval: null,
      error: this.freshSessionRunError(
        threadId,
        current.row.run_id,
        'The previous Turn could not open its saved native work session.',
      ),
    });
  }

  async resumeInterruptedRun(companyId: string, runId: string): Promise<void> {
    const repos = await this.deps.reposFactory();
    const row = await repos.agentRuns.findById(runId);
    if (
      !row ||
      row.company_id !== companyId ||
      row.run_id !== row.root_run_id ||
      row.status !== 'interrupted'
    ) {
      throw new Error('Interrupted run is no longer available to resume.');
    }
    if (this.activeRuns.has(row.thread_id)) {
      throw new ConversationRunAlreadyActiveError(row.thread_id);
    }
    const runtime = await this.deps.runtimeFactory(companyId);
    const hydration = await this.hydrateLiveRun(row, runtime, repos);
    if (hydration === 'owned_elsewhere') {
      throw new ConversationRunAlreadyActiveError(row.thread_id);
    }
    if (hydration === 'projection_missing') {
      throw new Error('Interrupted run has no durable Conversation message projection.');
    }
    const run = this.activeRuns.get(row.thread_id);
    if (!run || run.attemptId !== row.run_id) {
      throw new Error('Interrupted run projection could not be restored.');
    }
    run.reattached = false;
    run.hostConnected = true;
    run.executionAbortController = new AbortController();
    this.patchSnapshot(run.threadId, { phase: 'preparing', approval: null, error: null });
    try {
      const response = await runtime.resume(runId, run.executionAbortController.signal);
      if (!this.isActiveRun(run) || run.stopped) return;
      const reasoning = (response.reasoning || run.reasoningText).trim();
      const assistant: ChatMessage = {
        id: run.assistantMessageId,
        threadId: run.threadId,
        author: 'employee',
        employeeId: run.input.employeeId,
        body: response.text,
        ...(reasoning ? { reasoning } : {}),
        at: run.assistantMessage?.at ?? this.deps.now(),
        replyToMessageId: run.userMessage.id,
        attemptId: run.attemptId,
        status: 'complete',
        ...(run.workspaceProvenance ? { workspaceProvenance: run.workspaceProvenance } : {}),
      };
      run.assistantMessage = assistant;
      if (!this.isActiveRun(run) || run.stopped) return;
      if (!response.conversationTerminalCommitted) {
        await this.persistRunMessage(run, assistant);
      }
      if (!this.isActiveRun(run) || run.stopped) return;
      this.cleanupRun(run);
      this.activeRuns.delete(run.threadId);
      this.patchSnapshot(run.threadId, {
        phase: 'completed',
        approval: null,
        liveMessages: [run.userMessage, assistant],
        activity: run.activity,
        activityTotal: run.activityTotal,
      });
      if (response.provenance && assistant.body.trim()) {
        void this.runTitleJob(run, response.provenance).catch((error: unknown) => {
          console.warn('[conversation-run] resumed semantic-title generation failed', {
            threadId: run.threadId,
            error,
          });
        });
      }
    } catch (error) {
      if (run.stopped && error instanceof Error && error.name === 'AbortError') return;
      if (error instanceof AgentTerminalCheckpointError) {
        await this.interruptAfterTerminalCheckpointFailure(run, error);
        return;
      }
      // Exact Resume can fail before Rust claims the interrupted root. Read the
      // durable row back before choosing recovery UI: if it is still
      // interrupted, no work was re-dispatched and a generic Retry would be a
      // false action. Keep the recovery card authoritative instead.
      const durable = await repos.agentRuns.findById(runId);
      if (
        durable?.company_id === companyId &&
        durable.thread_id === run.threadId &&
        durable.run_id === durable.root_run_id &&
        durable.status === 'interrupted'
      ) {
        this.cleanupRun(run);
        this.activeRuns.delete(run.threadId);
        this.patchSnapshot(run.threadId, {
          phase: 'interrupted',
          approval: null,
          liveMessages: run.assistantMessage
            ? [run.userMessage, run.assistantMessage]
            : [run.userMessage],
          error: {
            ...buildRunError(safeErrorMessage(error)),
            message: 'This task could not resume safely.',
          },
        });
        throw error;
      }
      await this.failRun(run, error);
      throw error;
    } finally {
      run.executionAbortController = null;
      if (run.stopped) {
        await this.settleStoppedRun(run);
      } else {
        this.cleanupRun(run);
      }
      if (this.activeRuns.get(run.threadId)?.attemptId === run.attemptId && !run.stopped) {
        this.activeRuns.delete(run.threadId);
      }
    }
  }

  /**
   * Rebuild controllable live-run projections and subscribe them to the native
   * host before startup recovery is allowed to classify any DB row as stale.
   */
  async bootstrapLiveRuns(companyId: string): Promise<LiveRunReattachResult> {
    const cached = this.liveBootstrapByCompany.get(companyId);
    if (cached) return cached;
    const promise = this.runLiveBootstrap(companyId).catch((error) => {
      this.liveBootstrapByCompany.delete(companyId);
      throw error;
    });
    this.liveBootstrapByCompany.set(companyId, promise);
    const result = await promise;
    if (!result.complete) this.liveBootstrapByCompany.delete(companyId);
    return result;
  }

  private async runLiveBootstrap(companyId: string): Promise<LiveRunReattachResult> {
    const repos = await this.deps.reposFactory();
    const running = await repos.agentRuns.findByStatus(companyId, ['running']);
    const roots = running.filter((row) => row.run_id === row.root_run_id);
    const runningRootIds = new Set(roots.map((row) => row.run_id));
    const orphanRootRunIds = new Set(
      running
        .filter((row) => row.run_id !== row.root_run_id && !runningRootIds.has(row.root_run_id))
        .map((row) => row.root_run_id),
    );
    if (roots.length === 0) {
      return {
        protectedRootRunIds: new Set(),
        handledRootRunIds: new Set(),
        confirmedMissingRootRunIds: orphanRootRunIds,
        complete: true,
      };
    }

    const alreadyProtected = new Set(
      roots
        .filter((row) => this.deps.isMissionThreadRunning(row.thread_id))
        .map((row) => row.run_id),
    );
    const conversationRoots = roots.filter((row) => !alreadyProtected.has(row.run_id));
    if (conversationRoots.length === 0) {
      return {
        protectedRootRunIds: alreadyProtected,
        handledRootRunIds: alreadyProtected,
        confirmedMissingRootRunIds: orphanRootRunIds,
        complete: true,
      };
    }

    const runtime = await this.deps.runtimeFactory(companyId);
    const candidateRootRunIds = new Set<string>();
    const projectionMissing = new Set<string>();
    for (const row of conversationRoots) {
      const current = this.activeRuns.get(row.thread_id);
      if (current?.attemptId === row.run_id) {
        if (!current.reattached || current.hostConnected) alreadyProtected.add(row.run_id);
        else {
          this.ensureReattachSettlement(current);
          candidateRootRunIds.add(row.run_id);
        }
        continue;
      }
      const hydration = await this.hydrateLiveRun(row, runtime, repos);
      if (hydration === 'hydrated') {
        const hydratedRun = this.activeRuns.get(row.thread_id);
        if (hydratedRun?.attemptId === row.run_id) this.ensureReattachSettlement(hydratedRun);
        candidateRootRunIds.add(row.run_id);
      } else if (hydration === 'owned_elsewhere') {
        alreadyProtected.add(row.run_id);
      } else {
        projectionMissing.add(row.run_id);
        candidateRootRunIds.add(row.run_id);
      }
    }

    if (!runtime.reattachLiveRuns) {
      return {
        protectedRootRunIds: new Set(roots.map((row) => row.run_id)),
        handledRootRunIds: alreadyProtected,
        confirmedMissingRootRunIds: new Set(),
        complete: false,
      };
    }

    let result: LiveRunReattachResult;
    try {
      result = await runtime.reattachLiveRuns(candidateRootRunIds);
    } catch (error) {
      console.warn('[conversation-run] live host reattach bootstrap failed', {
        companyId,
        error,
      });
      return {
        protectedRootRunIds: new Set(roots.map((row) => row.run_id)),
        handledRootRunIds: alreadyProtected,
        confirmedMissingRootRunIds: new Set(),
        complete: false,
      };
    }

    const protectedRootRunIds = new Set([...alreadyProtected, ...result.protectedRootRunIds]);
    const handledRootRunIds = new Set([...alreadyProtected, ...result.handledRootRunIds]);
    for (const runId of result.handledRootRunIds) {
      const row = roots.find((candidate) => candidate.run_id === runId);
      const run = row ? this.activeRuns.get(row.thread_id) : null;
      if (run?.attemptId === runId) {
        run.hostConnected = true;
        await this.restoreLiveApproval(repos, run);
      }
    }
    for (const row of conversationRoots) {
      if (protectedRootRunIds.has(row.run_id)) continue;
      const run = this.activeRuns.get(row.thread_id);
      if (run?.attemptId !== row.run_id || !run.reattached) continue;
      this.cleanupRun(run);
      run.resolveReattachSettlement?.();
      run.resolveReattachSettlement = null;
      this.activeRuns.delete(row.thread_id);
      this.globalSnapshot = null;
    }

    // Fresh rows always carry the projection ref. A malformed prelaunch row is
    // never allowed to become an invisible background run: stop any host that
    // was found, protect it from stale reconciliation for this pass, and retry
    // bootstrap until the terminal stream is durably observed.
    for (const row of conversationRoots) {
      if (!projectionMissing.has(row.run_id) || !handledRootRunIds.has(row.run_id)) continue;
      runtime.abort(row.thread_id);
      protectedRootRunIds.add(row.run_id);
    }

    return {
      protectedRootRunIds,
      handledRootRunIds,
      confirmedMissingRootRunIds: new Set([
        ...result.confirmedMissingRootRunIds,
        ...orphanRootRunIds,
      ]),
      complete: result.complete && projectionMissing.size === 0,
    };
  }

  private async hydrateLiveRun(
    row: AgentRunRow,
    runtime: DesktopAgentRuntime,
    repos: RuntimeRepositories,
  ): Promise<LiveRunHydrationResult> {
    const projection = parseConversationProjection(row.runtime_context_json);
    if (!projection) return 'projection_missing';
    const threadRunLease = conversationThreadLifecycle.beginRun(row.thread_id);
    if (!threadRunLease) return 'owned_elsewhere';
    let hydrated = false;
    try {
      const [messages, subtree] = await Promise.all([
        this.deps.loadMessagesByIds({
          repos,
          threadId: row.thread_id,
          messageIds: [projection.userMessageId, projection.assistantMessageId],
        }),
        repos.agentRuns.findByRoot(row.run_id),
      ]);
      const delegations = subtree
        .map(restoreDelegation)
        .filter((delegation): delegation is RunDelegation => delegation !== null);
      const persistedUser = messages.find((message) => message.id === projection.userMessageId);
      const userMessage: ChatMessage = persistedUser ?? {
        id: projection.userMessageId,
        threadId: row.thread_id,
        author: 'boss',
        employeeId: null,
        body: row.objective ?? '',
        at: Date.parse(row.started_at) || this.deps.now(),
        attachments: [],
        status: 'complete',
      };
      const persistedAssistant = messages.find(
        (message) => message.id === projection.assistantMessageId,
      );
      const assistantMessage: ChatMessage | null = persistedAssistant
        ? { ...persistedAssistant, status: 'streaming' }
        : null;
      const input: SubmitConversationRun = {
        companyId: row.company_id,
        projectId: row.project_id,
        threadId: row.thread_id,
        employeeId: row.employee_id,
        text: row.objective ?? userMessage.body,
        stagedAttachments: [],
        source: projection.source,
        model: projection.model,
        permissionMode: projection.permissionMode,
        thinkingLevel: projection.thinkingLevel,
      };
      const run: ActiveRun = {
        input,
        threadId: row.thread_id,
        attemptId: row.run_id,
        userMessage,
        assistantMessageId: projection.assistantMessageId,
        assistantMessage,
        promptText: row.objective ?? userMessage.body,
        contentText: assistantMessage?.body ?? '',
        reasoningText: assistantMessage?.reasoning ?? '',
        toolCalls: [],
        workspaceProvenance: assistantMessage?.workspaceProvenance ?? null,
        activity: [],
        activityTotal: 0,
        delegations,
        runtime,
        stopped: false,
        lastCheckpointAt: 0,
        firstCheckpointWritten: assistantMessage !== null,
        messagePersistedNotified: true,
        clearRestoredApproval: false,
        pendingLoopHandoff: null,
        nativeSessionRecovery: null,
        reattached: true,
        hostConnected: false,
        terminalizing: false,
        executionAbortController: null,
        threadRunLease,
        resolveReattachSettlement: null,
        unsubscribers: [],
      };
      run.unsubscribers = this.subscribeRuntimeEvents(run);
      this.activeRuns.set(row.thread_id, run);
      this.setSnapshot(row.thread_id, {
        threadId: row.thread_id,
        companyId: row.company_id,
        projectId: row.project_id,
        attemptId: row.run_id,
        phase: 'running',
        employeeId: row.employee_id,
        source: projection.source,
        liveMessages: assistantMessage ? [userMessage, assistantMessage] : [userMessage],
        activity: [],
        activityTotal: 0,
        delegations,
        approval: null,
        error: null,
      });
      hydrated = true;
      return 'hydrated';
    } finally {
      if (!hydrated) threadRunLease.release();
    }
  }

  private async restoreLiveApproval(repos: RuntimeRepositories, run: ActiveRun): Promise<void> {
    if (!this.isActiveRun(run)) return;
    const row = await repos.activeInteractions?.findByThread(run.threadId);
    if (!row || !this.isActiveRun(run)) return;
    let payload: Partial<PendingApproval> & { source?: string };
    try {
      payload = JSON.parse(row.payload_json ?? '{}') as Partial<PendingApproval> & {
        source?: string;
      };
    } catch {
      return;
    }
    const engineId = interactionEngineId(payload);
    const parsedInput =
      payload.method === 'requestUserInput'
        ? parseUserInputQuestions({
            questions: payload.questions,
            autoResolutionMs: payload.autoResolutionMs,
          })
        : null;
    const method = typeof payload.method === 'string' ? payload.method : 'confirm';
    if (
      !engineId ||
      !isSupportedUiRequest(method, parsedInput?.questions) ||
      payload.attemptId !== run.attemptId ||
      typeof payload.hostRequestId !== 'string' ||
      !payload.hostRequestId.trim() ||
      typeof payload.uiRequestId !== 'string' ||
      !payload.uiRequestId.trim()
    ) {
      return;
    }
    const approval: PendingApproval = {
      engineId,
      threadId: run.threadId,
      attemptId: run.attemptId,
      hostRequestId: payload.hostRequestId,
      uiRequestId: payload.uiRequestId,
      method,
      title: typeof payload.title === 'string' ? payload.title : 'Approval needed',
      message: typeof payload.message === 'string' ? payload.message : undefined,
      ...(parsedInput?.questions ? { questions: parsedInput.questions } : {}),
      ...(parsedInput?.autoResolutionMs
        ? { autoResolutionMs: parsedInput.autoResolutionMs }
        : {}),
      state: 'live',
      createdAt: Date.parse(row.created_at) || this.deps.now(),
    };
    this.patchSnapshot(run.threadId, {
      phase: 'awaiting-approval',
      approval,
    });
  }

  getSnapshot(threadId: string): ConversationRunSnapshot {
    return this.currentSnapshot(threadId);
  }

  subscribe(threadId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(threadId) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(threadId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(threadId);
    };
  }

  getGlobalSnapshot(): ConversationRunsSnapshot {
    if (this.globalSnapshot) return this.globalSnapshot;
    const runs = [...this.snapshots.values()];
    this.globalSnapshot = {
      runs,
      // `phase` is a presentation snapshot, not proof that a controllable run
      // exists. The in-memory controller map is the live truth; intersecting it
      // with active phases keeps terminal snapshots out without allowing DB
      // hydration to manufacture Stop/workload/scene state.
      activeRuns: runs.filter(
        (run) => this.activeRuns.has(run.threadId) && isConversationRunActive(run.phase),
      ),
      pendingApprovals: runs
        .map((run) => run.approval)
        .filter((a): a is PendingApproval => a !== null),
    };
    return this.globalSnapshot;
  }

  subscribeGlobal(listener: () => void): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  private async runAttempt(run: ActiveRun): Promise<void> {
    try {
      if (run.clearRestoredApproval) {
        const repos = await this.deps.reposFactory();
        await repos.activeInteractions?.deleteByThread(run.threadId);
        run.clearRestoredApproval = false;
      }
      const materialized = await this.deps.materializeTurn({
        text: run.input.text,
        companyId: run.input.companyId,
        threadId: run.threadId,
        staged: run.input.stagedAttachments,
      });
      if (!this.isActiveRun(run)) return;
      run.promptText = materialized.promptText;
      run.userMessage = {
        ...run.userMessage,
        attachments: materialized.attachments?.length ? materialized.attachments : undefined,
      };

      // Loop-backed turn: prepare durable records, persist the visible message,
      // then start the paid Mission. No Pi work exists before the message boundary.
      if (run.input.loopExecution) {
        const prepared = await run.input.loopExecution.materialize(run.userMessage.id);
        if (!this.isActiveRun(run) || run.stopped) {
          // Stop won while materialization was pending. Remove the prepared rows;
          // if compensation fails, retain this exact preparation as the retry
          // target so no later retry can duplicate it.
          try {
            await prepared.compensate();
          } catch (compensationError) {
            run.pendingLoopHandoff = { prepared, messagePersisted: false };
            this.saveRetryRecord(run);
            console.warn('[conversation-run] stopped Loop compensation failed', {
              threadId: run.threadId,
              compensationError,
            });
          }
          return;
        }
        try {
          this.patchSnapshot(run.threadId, { liveMessages: [run.userMessage] });
          await this.persistRunMessage(run, run.userMessage);
        } catch (persistError) {
          try {
            await prepared.compensate();
          } catch (compensationError) {
            // Compensation is atomic in production. If its storage transaction
            // nevertheless fails, retain this exact ready Mission as the retry
            // target; never materialize a second one and never start it yet.
            run.pendingLoopHandoff = { prepared, messagePersisted: false };
            throw new AggregateError(
              [persistError, compensationError],
              'Loop message persistence and materialization compensation both failed.',
            );
          }
          throw persistError;
        }
        this.notifyMessagePersisted(run);
        const handoff = { prepared, messagePersisted: true } satisfies PendingLoopHandoff;
        run.pendingLoopHandoff = handoff;
        if (!this.isActiveRun(run) || run.stopped) {
          // The message is durable: retain the linked ready Mission and rewrite
          // the stop-time retry record to start this exact preparation.
          this.saveRetryRecord(run);
          return;
        }
        await this.resumeLoopHandoff(run, handoff);
        return;
      }

      this.patchSnapshot(run.threadId, { liveMessages: [run.userMessage] });
      await this.persistRunMessage(run, run.userMessage);
      this.notifyMessagePersisted(run);
      if (!this.isActiveRun(run) || run.stopped) {
        // Stop may win while the user message is becoming durable. Preserve
        // that durability in the retry record without starting paid work or
        // reviving the interrupted presentation state.
        this.saveRetryRecord(run);
        return;
      }
      this.saveRetryRecord(run);
      await this.executeAttempt(run);
    } catch (error) {
      await this.failRun(run, error);
    }
  }

  private async resumeLoopHandoff(run: ActiveRun, handoff: PendingLoopHandoff): Promise<void> {
    let transferredThreadRun: ThreadRunLease | null = null;
    try {
      if (!handoff.messagePersisted) {
        if (!this.isActiveRun(run) || run.stopped) return;
        this.patchSnapshot(run.threadId, { liveMessages: [run.userMessage] });
        await this.persistRunMessage(run, run.userMessage);
        this.notifyMessagePersisted(run);
        handoff.messagePersisted = true;
      }
      if (!this.isActiveRun(run) || run.stopped) {
        run.pendingLoopHandoff = handoff;
        this.saveRetryRecord(run);
        return;
      }
      transferredThreadRun = run.threadRunLease?.transfer() ?? null;
      if (!transferredThreadRun) {
        throw new Error('The conversation run lease is no longer active.');
      }
      run.threadRunLease = null;
      run.executionAbortController = new AbortController();
      try {
        await handoff.prepared.start(transferredThreadRun, run.executionAbortController.signal);
      } catch (error) {
        // A failed receiver must not strand the transferred exclusive slot.
        // MissionRunManager also releases on assembly failure; release is
        // idempotent so this closes custom/test hand-offs as well.
        transferredThreadRun.release();
        throw error;
      }
      run.pendingLoopHandoff = null;
      if (!this.isActiveRun(run) || run.stopped) {
        // The Mission accepted the launch before Stop won. Retry must create a
        // new Mission from the original Loop input, never reuse this now-aborted
        // Mission hand-off.
        this.saveRetryRecord(run);
        return;
      }
      this.cleanupRun(run);
      this.activeRuns.delete(run.threadId);
      this.patchSnapshot(run.threadId, {
        phase: 'completed',
        approval: null,
        liveMessages: [run.userMessage],
      });
    } catch (error) {
      run.pendingLoopHandoff = handoff;
      await this.failRun(run, error);
    } finally {
      run.executionAbortController = null;
    }
  }

  private async executeAttempt(run: ActiveRun): Promise<void> {
    try {
      if (!this.isActiveRun(run) || run.stopped) return;
      this.patchSnapshot(run.threadId, { phase: 'running' });
      run.runtime = await this.deps.runtimeFactory(run.input.companyId);
      if (!this.isActiveRun(run)) return;
      if (run.stopped) {
        run.runtime.abort(run.threadId);
        return;
      }
      run.unsubscribers = this.subscribeRuntimeEvents(run);
      run.executionAbortController = new AbortController();
      const response = await run.runtime.execute(
        {
          text: run.promptText ?? run.input.text,
          threadId: run.threadId,
          employeeId: run.input.employeeId,
          projectId: run.input.projectId,
          model: run.input.model,
          permissionMode: run.input.permissionMode,
          thinkingLevel: run.input.thinkingLevel,
          runId: run.attemptId,
          conversationProjection: {
            userMessageId: run.userMessage.id,
            assistantMessageId: run.assistantMessageId,
            source: run.input.source,
          },
          ...(run.nativeSessionRecovery
            ? {
                nativeSessionMode: run.nativeSessionRecovery.mode,
                nativeSessionResetSourceRunId: run.nativeSessionRecovery.sourceRunId,
              }
            : {}),
          directDelegation: run.input.directDelegation,
        },
        run.executionAbortController.signal,
      );
      if (!this.isActiveRun(run) || run.stopped) return;
      const reasoning = (response.reasoning || run.reasoningText).trim();
      const assistant: ChatMessage = {
        id: run.assistantMessageId,
        threadId: run.threadId,
        author: 'employee',
        employeeId: run.input.employeeId,
        body: response.text,
        ...(reasoning ? { reasoning } : {}),
        at: run.assistantMessage?.at ?? this.deps.now(),
        replyToMessageId: run.userMessage.id,
        attemptId: run.attemptId,
        status: 'complete',
        ...(run.workspaceProvenance ? { workspaceProvenance: run.workspaceProvenance } : {}),
      };
      run.assistantMessage = assistant;
      if (!response.conversationTerminalCommitted) {
        await this.persistRunMessage(run, assistant);
      }
      // Stop may win while the final durable write is in flight. The later
      // completion must not resurrect a run that stopAndWait already retired.
      if (!this.isActiveRun(run) || run.stopped) return;
      this.cleanupRun(run);
      this.activeRuns.delete(run.threadId);
      this.patchSnapshot(run.threadId, {
        phase: 'completed',
        approval: null,
        liveMessages: [run.userMessage, assistant],
        activity: run.activity,
        activityTotal: run.activityTotal,
      });
      if (response.provenance && assistant.body.trim() && run.runtime) {
        void this.runTitleJob(run, response.provenance).catch((error: unknown) => {
          console.warn('[conversation-run] semantic-title generation failed', {
            threadId: run.threadId,
            error,
          });
        });
      }
    } catch (error) {
      if (error instanceof AgentTerminalCheckpointError) {
        await this.interruptAfterTerminalCheckpointFailure(run, error);
        return;
      }
      await this.failRun(run, error);
    } finally {
      run.executionAbortController = null;
      if (!run.stopped) this.cleanupRun(run);
      if (this.activeRuns.get(run.threadId)?.attemptId === run.attemptId && !run.stopped) {
        this.activeRuns.delete(run.threadId);
      }
    }
  }

  private async runTitleJob(
    run: ActiveRun,
    sourceProvenance: TurnExecutionProvenance,
  ): Promise<void> {
    if (!run.runtime) return;
    const repos = await this.deps.reposFactory();
    const job = await claimSemanticTitleJob({
      repos,
      threadId: run.threadId,
      sourceProvenance,
    });
    if (!job) return;
    const title = await generateSemanticThreadTitle({
      repos,
      runtime: run.runtime,
      job,
      firstUserText: run.input.text,
      firstAssistantText: run.assistantMessage?.body ?? '',
    });
    if (!title) return;
    run.input.onThreadTitleUpdated?.();
  }

  private subscribeRuntimeEvents(run: ActiveRun): Array<() => void> {
    const offStream = this.deps.eventBus.on('llm.stream.chunk', (event) => {
      if (run.stopped) return;
      const payload = event.payload as Record<string, unknown>;
      if (!this.matchesRun(event, payload, run)) return;
      const content = typeof payload.content === 'string' ? payload.content : '';
      if (!content) return;
      const channel = payload.channel === 'reasoning' ? 'reasoning' : 'content';
      if (channel === 'reasoning') run.reasoningText += content;
      else run.contentText += content;
      this.upsertAssistantDraft(run);
      void this.maybeCheckpoint(run).catch((err: unknown) => {
        console.warn('[conversation-run] checkpoint failed', { threadId: run.threadId, err });
      });
    });

    const offTool = this.deps.eventBus.on('tool.execution.telemetry', (event) => {
      if (run.stopped) return;
      const payload = event.payload as ToolExecutionTelemetryPayload;
      if (
        !payload?.toolName ||
        !this.matchesRun(event, payload as unknown as Record<string, unknown>, run)
      ) {
        return;
      }
      this.noteTool(run, payload);
    });

    const offUi = this.deps.eventBus.on(AGENT_UI_REQUEST_EVENT, (event) => {
      if (run.stopped) return;
      const payload = event.payload as AgentUiRequestPayload;
      if (!payload?.requestId || !payload.id) return;
      if (!this.matchesRun(event, payload as unknown as Record<string, unknown>, run)) return;
      void this.handleUiRequest(run, payload).catch((err: unknown) => {
        console.warn('[conversation-run] UI request handling failed', {
          threadId: run.threadId,
          err,
        });
      });
    });

    const offUiResolved = this.deps.eventBus.on(AGENT_UI_REQUEST_RESOLVED_EVENT, (event) => {
      if (run.stopped) return;
      const payload = event.payload as AgentUiRequestResolvedPayload;
      if (!payload?.requestId || !payload.id || payload.runId !== run.attemptId) return;
      if (event.threadId !== run.threadId) return;
      void this.handleUiRequestResolved(run, payload).catch((err: unknown) => {
        console.warn('[conversation-run] interaction resolution cleanup failed', {
          threadId: run.threadId,
          err,
        });
      });
    });

    const offLiveTerminal = this.deps.eventBus.on(LIVE_CONVERSATION_TERMINAL_EVENT, (event) => {
      const payload = event.payload as LiveConversationTerminalPayload;
      if (!run.reattached || payload?.runId !== run.attemptId || event.threadId !== run.threadId) {
        return;
      }
      this.finalizeReattachedRun(run, payload);
    });

    // Delegation run-tree events graft onto this run when the child's rootRunId
    // equals this run's attemptId (the agentRun envelope carries the child runId
    // in payload.runId, not the root, so matchesRun's attemptId check won't fit).
    // The root now emits its OWN agent.run stream (runId === attemptId) so the
    // office/projection see it; skip those here — the root is not a delegation of
    // itself, it's the tree root the delegations hang under.
    const offAgentRun = this.deps.eventBus.on('agent.run', (event) => {
      if (run.stopped) return;
      const payload = event.payload as AgentRunEvent;
      if (payload?.rootRunId !== run.attemptId || payload.threadId !== run.threadId) return;
      if (payload.runId === run.attemptId) return;
      this.noteDelegation(run, payload);
    });

    return [offStream, offTool, offUi, offUiResolved, offLiveTerminal, offAgentRun];
  }

  private finalizeReattachedRun(run: ActiveRun, terminal: LiveConversationTerminalPayload): void {
    if (!this.isActiveRun(run) || run.terminalizing) return;
    run.terminalizing = true;
    if (run.stopped) {
      run.resolveReattachSettlement?.();
      run.resolveReattachSettlement = null;
      return;
    }
    const content = terminal.text.trim();
    if (content) run.contentText = content;
    if (terminal.reasoning?.trim()) run.reasoningText = terminal.reasoning.trim();
    const body = run.contentText.trim();
    const reasoning = run.reasoningText.trim();
    const status =
      terminal.status === 'completed'
        ? ('complete' as const)
        : terminal.status === 'failed'
          ? ('failed' as const)
          : ('interrupted' as const);
    const assistant: ChatMessage | null =
      body || reasoning || run.workspaceProvenance
        ? {
            id: run.assistantMessageId,
            threadId: run.threadId,
            author: 'employee',
            employeeId: run.input.employeeId,
            body,
            ...(reasoning ? { reasoning } : {}),
            at: run.assistantMessage?.at ?? this.deps.now(),
            replyToMessageId: run.userMessage.id,
            attemptId: run.attemptId,
            status,
            ...(run.workspaceProvenance ? { workspaceProvenance: run.workspaceProvenance } : {}),
          }
        : null;
    run.assistantMessage = assistant;
    this.cleanupRun(run);
    this.activeRuns.delete(run.threadId);
    run.resolveReattachSettlement?.();
    run.resolveReattachSettlement = null;

    if (terminal.status === 'failed') {
      this.saveRetryRecord(run);
      const technicalDetail = terminal.error?.trim() || 'Agent runtime failed.';
      const runError: RunError = {
        ...buildRunError(technicalDetail),
        retry: () => {
          this.dismissError(run.threadId);
          void this.retry(run.threadId, run.attemptId).catch((error: unknown) => {
            console.warn('[conversation-run] reattached retry failed', {
              threadId: run.threadId,
              error,
            });
          });
        },
      };
      this.patchSnapshot(run.threadId, {
        phase: 'failed',
        approval: null,
        liveMessages: assistant ? [run.userMessage, assistant] : [run.userMessage],
        error: runError,
      });
      return;
    }

    if (terminal.status === 'cancelled') this.saveRetryRecord(run);
    this.patchSnapshot(run.threadId, {
      phase: terminal.status === 'completed' ? 'completed' : 'interrupted',
      approval: null,
      liveMessages: assistant ? [run.userMessage, assistant] : [run.userMessage],
      error: null,
    });
    if (terminal.status === 'completed' && terminal.provenance && assistant?.body.trim()) {
      void this.runTitleJob(run, terminal.provenance).catch((error: unknown) => {
        console.warn('[conversation-run] reattached semantic-title generation failed', {
          threadId: run.threadId,
          error,
        });
      });
    }
  }

  private noteDelegation(run: ActiveRun, evt: AgentRunEvent): void {
    const existing = run.delegations.find((d) => d.runId === evt.runId);
    if (evt.type === 'run.started') {
      if (existing) return;
      const payload = evt.payload as AgentRunStartedPayload;
      run.delegations = [
        ...run.delegations,
        {
          runId: evt.runId,
          parentRunId: evt.parentRunId ?? null,
          employeeId: evt.employeeId ?? null,
          objective: payload.objective,
          state: 'running',
          ...(evt.workKind ? { workKind: evt.workKind } : {}),
        },
      ];
    } else if (
      evt.type === 'run.completed' ||
      evt.type === 'run.failed' ||
      evt.type === 'run.cancelled'
    ) {
      const payload = evt.payload as AgentRunFinishedPayload;
      const state =
        evt.type === 'run.completed' ? 'done' : evt.type === 'run.failed' ? 'failed' : 'cancelled';
      // The typed failure cause only rides a failed terminal's payload.
      const failureKind = evt.type === 'run.failed' ? payload.failureKind : undefined;
      run.delegations = existing
        ? run.delegations.map((d) =>
            d.runId === evt.runId
              ? {
                  ...d,
                  state,
                  summary: payload.summary,
                  ...(failureKind ? { failureKind } : {}),
                }
              : d,
          )
        : [
            ...run.delegations,
            {
              runId: evt.runId,
              parentRunId: evt.parentRunId ?? null,
              employeeId: evt.employeeId ?? null,
              objective: '',
              state,
              summary: payload.summary,
              ...(evt.workKind ? { workKind: evt.workKind } : {}),
              ...(failureKind ? { failureKind } : {}),
            },
          ];
    } else {
      // tool.* / run.delta — not tracked at delegation-card granularity in Phase 1.
      return;
    }
    this.patchSnapshot(run.threadId, { delegations: run.delegations });
  }

  private matchesRun(
    event: RuntimeEvent<unknown>,
    payload: Record<string, unknown>,
    run: ActiveRun,
  ): boolean {
    return eventThreadId(event, payload) === run.threadId && eventRunId(payload) === run.attemptId;
  }

  private upsertAssistantDraft(run: ActiveRun): void {
    const reasoning = run.reasoningText;
    const assistant: ChatMessage = {
      id: run.assistantMessageId,
      threadId: run.threadId,
      author: 'employee',
      employeeId: run.input.employeeId,
      body: run.contentText,
      ...(reasoning ? { reasoning } : {}),
      ...(run.toolCalls.length ? { toolCalls: [...run.toolCalls] } : {}),
      at: run.assistantMessage?.at ?? this.deps.now(),
      replyToMessageId: run.userMessage.id,
      attemptId: run.attemptId,
      status: 'streaming',
      ...(run.workspaceProvenance ? { workspaceProvenance: run.workspaceProvenance } : {}),
    };
    run.assistantMessage = assistant;
    this.patchSnapshot(run.threadId, (current) => ({
      phase: current.phase === 'awaiting-approval' ? 'awaiting-approval' : 'running',
      liveMessages: [run.userMessage, assistant],
    }));
  }

  private async maybeCheckpoint(run: ActiveRun): Promise<void> {
    if (!run.assistantMessage || run.runtime?.ownsConversationProjectionPersistence) return;
    const now = this.deps.now();
    if (!run.firstCheckpointWritten || now - run.lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) {
      run.firstCheckpointWritten = true;
      run.lastCheckpointAt = now;
      await this.persistRunMessage(run, stripToolCalls(run.assistantMessage));
    }
  }

  private noteTool(run: ActiveRun, payload: ToolExecutionTelemetryPayload): void {
    if (!payload.toolCallId) return;
    if (payload.workspaceProvenance) run.workspaceProvenance = payload.workspaceProvenance;
    const status =
      payload.status === 'started'
        ? 'running'
        : payload.status === 'completed'
          ? 'completed'
          : 'failed';
    run.toolCalls = upsertChatToolCall(run.toolCalls, {
      id: payload.toolCallId,
      name: payload.toolName,
      status,
      durationMs: payload.durationMs,
    });
    const terminal = terminalToolState(payload.status);
    if (payload.status === 'started') {
      run.activityTotal += 1;
      run.activity = [
        ...run.activity,
        {
          id: payload.toolCallId,
          tool: payload.toolName,
          state: 'running' as const,
          detail: detailFromTelemetry(payload),
          workspaceProvenance: payload.workspaceProvenance,
          richDetail: parseToolRichDetail(payload.toolName, payload.detail),
        },
      ].slice(-12);
    } else if (terminal) {
      run.activity = run.activity.map((entry) =>
        entry.id === payload.toolCallId
          ? {
              ...entry,
              state: terminal,
              detail: detailFromTelemetry(payload) ?? entry.detail,
              workspaceProvenance: payload.workspaceProvenance ?? entry.workspaceProvenance,
              richDetail: mergeToolRichDetail(
                entry.richDetail,
                parseToolRichDetail(payload.toolName, payload.detail),
              ),
              durationMs: payload.durationMs,
            }
          : entry,
      );
      void this.appendToolActivity(run, payload, terminal).catch((err: unknown) => {
        console.warn('[conversation-run] tool activity persist failed', {
          threadId: run.threadId,
          err,
        });
      });
    }
    this.upsertAssistantDraft(run);
    this.patchSnapshot(run.threadId, {
      activity: run.activity,
      activityTotal: run.activityTotal,
    });
  }

  private async handleUiRequestResolved(
    run: ActiveRun,
    resolution: AgentUiRequestResolvedPayload,
  ): Promise<void> {
    const approval = this.currentSnapshot(run.threadId).approval;
    if (
      !approval ||
      approval.attemptId !== run.attemptId ||
      approval.hostRequestId !== resolution.requestId ||
      approval.uiRequestId !== resolution.id
    ) {
      return;
    }
    const repos = await this.deps.reposFactory();
    await repos.activeInteractions?.deleteByThread(run.threadId);
    const snapshot = this.currentSnapshot(run.threadId);
    if (snapshot.approval?.uiRequestId !== resolution.id) return;
    this.setSnapshot(run.threadId, { ...snapshot, phase: 'running', approval: null });
  }

  private async handleUiRequest(run: ActiveRun, request: AgentUiRequestPayload): Promise<void> {
    const parsedInput =
      request.method === 'requestUserInput' ? parseUserInputQuestions(request.params) : null;
    if (!isSupportedUiRequest(request.method, parsedInput?.questions)) {
      await run.runtime?.answerUiRequest({
        runId: run.attemptId,
        requestId: request.requestId,
        id: request.id,
        cancelled: true,
      });
      return;
    }
    const approval: PendingApproval = {
      engineId: request.engineId,
      threadId: run.threadId,
      attemptId: run.attemptId,
      hostRequestId: request.requestId,
      uiRequestId: request.id,
      method: request.method,
      title: request.title,
      message: request.message,
      ...(parsedInput?.questions ? { questions: parsedInput.questions } : {}),
      ...(parsedInput?.autoResolutionMs
        ? { autoResolutionMs: parsedInput.autoResolutionMs }
        : {}),
      state: 'live',
      createdAt: this.deps.now(),
    };
    this.patchSnapshot(run.threadId, { phase: 'awaiting-approval', approval });
    try {
      await this.upsertActiveInteraction(run, approval);
    } catch (err) {
      console.warn('[conversation-run] active approval persist failed', {
        threadId: run.threadId,
        uiRequestId: approval.uiRequestId,
        err,
      });
    }
    if (run.assistantMessage && !run.runtime?.ownsConversationProjectionPersistence)
      await this.persistRunMessage(run, stripToolCalls(run.assistantMessage));
  }

  private async failRun(run: ActiveRun, error: unknown): Promise<void> {
    if (!this.isActiveRun(run) || run.stopped) return;
    const messageText = safeErrorMessage(error);
    this.cleanupRun(run);
    this.activeRuns.delete(run.threadId);
    let messages: ChatMessage[] = [run.userMessage];
    if (
      run.assistantMessage &&
      (run.assistantMessage.body.trim() || run.assistantMessage.reasoning?.trim())
    ) {
      const failed = { ...stripToolCalls(run.assistantMessage), status: 'failed' as const };
      run.assistantMessage = failed;
      if (!run.runtime?.ownsConversationProjectionPersistence) {
        await this.persistRunMessage(run, failed).catch((err: unknown) => {
          console.warn('[conversation-run] failed to persist failed snapshot', {
            threadId: run.threadId,
            err,
          });
        });
      }
      messages = [run.userMessage, failed];
    }
    this.saveRetryRecord(run);
    const { threadId, attemptId } = run;
    let freshSessionSource: DurableFreshSessionSource | null = null;
    try {
      freshSessionSource = await this.latestFreshSessionSource(
        run.input.companyId,
        threadId,
        attemptId,
        run.userMessage.id,
        run.assistantMessageId,
      );
    } catch (lookupError) {
      console.warn('[conversation-run] fresh-session recovery lookup failed', {
        threadId,
        attemptId,
        lookupError,
      });
    }
    const runError: RunError = freshSessionSource
      ? this.freshSessionRunError(threadId, attemptId, messageText)
      : {
          ...buildRunError(messageText),
          retry: () => {
            this.dismissError(threadId);
            void this.retry(threadId, attemptId).catch((err: unknown) => {
              console.warn('[conversation-run] retry failed', { threadId, err });
            });
          },
        };
    this.patchSnapshot(run.threadId, {
      phase: 'failed',
      approval: null,
      liveMessages: messages,
      activity: run.activity,
      activityTotal: run.activityTotal,
      error: runError,
    });
  }

  private async interruptAfterTerminalCheckpointFailure(
    run: ActiveRun,
    error: AgentTerminalCheckpointError,
  ): Promise<void> {
    if (!this.isActiveRun(run) || run.stopped) return;
    // The host already reached a terminal state, but SQLite did not. Keep this
    // projection subscribed and reclassify it as a reattached run so the same
    // native terminal snapshot can finish the atomic checkpoint without ever
    // dispatching the user's task again.
    run.reattached = true;
    run.hostConnected = false;
    const messages: ChatMessage[] = [run.userMessage];
    if (
      run.assistantMessage &&
      (run.assistantMessage.body.trim() || run.assistantMessage.reasoning?.trim())
    ) {
      const interrupted = {
        ...stripToolCalls(run.assistantMessage),
        status: 'interrupted' as const,
      };
      run.assistantMessage = interrupted;
      messages.push(interrupted);
    }
    this.patchSnapshot(run.threadId, {
      phase: 'interrupted',
      approval: null,
      liveMessages: messages,
      activity: run.activity,
      activityTotal: run.activityTotal,
      error: {
        ...buildRunError(error.message),
        message: 'Run finished; saving its final state needs recovery.',
      },
    });

    while (this.isActiveRun(run) && !run.stopped) {
      try {
        await run.runtime?.reattachLiveRuns?.(new Set([run.attemptId]));
        if (!this.isActiveRun(run)) return;
      } catch (recoveryError) {
        console.warn('[conversation-run] terminal checkpoint recovery failed', {
          threadId: run.threadId,
          runId: run.attemptId,
          recoveryError,
        });
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
    }
  }

  private async persistRunMessage(run: ActiveRun, message: ChatMessage): Promise<void> {
    if (run.input.persistMessage) {
      await run.input.persistMessage(message);
      return;
    }
    await this.deps.persistMessage({
      message,
      companyId: run.input.companyId,
      projectId: run.input.projectId,
    });
  }

  private notifyMessagePersisted(run: ActiveRun): void {
    if (run.messagePersistedNotified) return;
    run.messagePersistedNotified = true;
    try {
      run.input.onMessagePersisted?.();
    } catch (error) {
      console.warn('[conversation-run] persisted-message callback failed', {
        threadId: run.threadId,
        error,
      });
    }
  }

  private async appendToolActivity(
    run: ActiveRun,
    payload: ToolExecutionTelemetryPayload,
    state: 'done' | 'error',
  ): Promise<void> {
    await this.deps.appendEvent({
      eventType: 'conversation.run.tool',
      threadId: run.threadId,
      companyId: run.input.companyId,
      projectId: run.input.projectId,
      agentName: payload.nodeName?.trim() || 'agent-runtime',
      createdAt: new Date(this.deps.now()),
      payload: {
        attemptId: run.attemptId,
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        status: state === 'done' ? 'completed' : 'failed',
        detail: detailFromTelemetry(payload),
        durationMs: payload.durationMs,
        threadId: run.threadId,
        employeeId: run.input.employeeId,
      },
    });
  }

  private async upsertActiveInteraction(run: ActiveRun, approval: PendingApproval): Promise<void> {
    const repos = await this.deps.reposFactory();
    await repos.activeInteractions?.upsert({
      thread_id: run.threadId,
      company_id: run.input.companyId,
      interaction_id: approval.uiRequestId,
      kind: 'agent_question',
      interaction_mode: 'human_in_loop',
      request_json: JSON.stringify({
        interactionId: approval.uiRequestId,
        threadId: run.threadId,
        companyId: run.input.companyId,
        kind: 'agent_question',
        severity: 'normal',
        title: approval.title,
        prompt: approval.message ?? approval.title,
        options:
          approval.method === 'confirm'
            ? [
                { id: 'reject', label: 'Reject' },
                { id: 'approve', label: 'Approve', recommended: true },
              ]
            : [],
        questions: approval.questions,
        allowFreeformResponse: approval.method === 'requestUserInput',
        createdAt: approval.createdAt,
      }),
      payload_json: JSON.stringify({
        source: 'agent-ui-request',
        engineId: approval.engineId,
        attemptId: approval.attemptId,
        hostRequestId: approval.hostRequestId,
        uiRequestId: approval.uiRequestId,
        method: approval.method,
        title: approval.title,
        message: approval.message,
        questions: approval.questions,
        autoResolutionMs: approval.autoResolutionMs,
        state: approval.state,
      }),
      created_at: new Date(approval.createdAt).toISOString(),
      updated_at: new Date(this.deps.now()).toISOString(),
    });
  }

  private async resolveActiveInteraction(
    run: ActiveRun,
    approval: PendingApproval,
    status: 'resolved' | 'cancelled' | 'superseded',
    response: Record<string, unknown>,
  ): Promise<void> {
    const repos = await this.deps.reposFactory();
    const now = new Date(this.deps.now()).toISOString();
    await repos.interactionHistory?.create({
      history_id: `hist-${this.deps.randomUUID()}`,
      interaction_id: approval.uiRequestId,
      thread_id: run.threadId,
      company_id: run.input.companyId,
      kind: 'agent_question',
      interaction_mode: 'human_in_loop',
      status,
      selected_option_id:
        approval.method === 'confirm'
          ? response.confirmed === true
            ? 'approve'
            : response.confirmed === false
              ? 'reject'
              : null
          : null,
      freeform_response:
        approval.method === 'confirm' && typeof response.value === 'string'
          ? response.value
          : null,
      request_json: JSON.stringify(approval),
      response_json: JSON.stringify(response),
      payload_json: JSON.stringify({
        source: 'agent-ui-request',
        engineId: approval.engineId,
        attemptId: run.attemptId,
      }),
      created_at: new Date(approval.createdAt).toISOString(),
      resolved_at: now,
    });
    await repos.activeInteractions?.deleteByThread(run.threadId);
  }

  private cleanupRun(run: ActiveRun): void {
    this.unsubscribeRun(run);
    run.threadRunLease?.release();
    run.threadRunLease = null;
  }

  private unsubscribeRun(run: ActiveRun): void {
    for (const unsubscribe of run.unsubscribers.splice(0)) unsubscribe();
  }

  private ensureReattachSettlement(run: ActiveRun): void {
    if (!run.reattached || run.resolveReattachSettlement) return;
    let resolveSettlement!: () => void;
    const settlement = new Promise<void>((resolve) => {
      resolveSettlement = resolve;
    });
    run.resolveReattachSettlement = resolveSettlement;
    this.trackRunTask(run, settlement);
  }

  private trackRunTask(run: ActiveRun, task: Promise<void>): void {
    void task
      .finally(() => this.settleStoppedRun(run))
      .catch((error: unknown) => {
        console.warn('[conversation-run] detached run task failed', {
          threadId: run.threadId,
          attemptId: run.attemptId,
          error,
        });
      });
  }

  private async settleStoppedRun(run: ActiveRun): Promise<void> {
    if (!run.stopped || this.activeRuns.get(run.threadId)?.attemptId !== run.attemptId) return;
    try {
      if (run.assistantMessage && !run.runtime?.ownsConversationProjectionPersistence) {
        const interrupted = {
          ...stripToolCalls(run.assistantMessage),
          status: 'interrupted' as const,
        };
        run.assistantMessage = interrupted;
        await this.persistRunMessage(run, interrupted);
      }
    } finally {
      this.cleanupRun(run);
      this.activeRuns.delete(run.threadId);
      this.globalSnapshot = null;
    }
  }

  private isActiveRun(run: ActiveRun): boolean {
    return this.activeRuns.get(run.threadId)?.attemptId === run.attemptId;
  }

  private saveRetryRecord(run: ActiveRun): void {
    // A prepared hand-off must retry the exact same Mission, so strip its factory.
    // Before preparation (or after successful compensation), preserving the
    // factory is safe: the retry starts from a clean materialization boundary.
    const retryInput = run.pendingLoopHandoff
      ? (({ loopExecution: _loopExecution, ...input }) => input)(run.input)
      : run.input;
    this.retryRecords.set(run.attemptId, {
      input: retryInput,
      userMessage: run.userMessage,
      assistantMessageId: run.assistantMessageId,
      promptText: run.promptText ?? run.input.text,
      messagePersisted: run.messagePersistedNotified,
      clearRestoredApproval: run.clearRestoredApproval,
      pendingLoopHandoff: run.pendingLoopHandoff,
    });
  }

  private currentSnapshot(threadId: string): ConversationRunSnapshot {
    const snapshot = this.snapshots.get(threadId);
    if (snapshot) return snapshot;
    let idleSnapshot = this.idleSnapshots.get(threadId);
    if (!idleSnapshot) {
      idleSnapshot = defaultSnapshot(threadId);
      this.idleSnapshots.set(threadId, idleSnapshot);
    }
    return idleSnapshot;
  }

  private patchSnapshot(
    threadId: string,
    patch:
      | Partial<ConversationRunSnapshot>
      | ((current: ConversationRunSnapshot) => Partial<ConversationRunSnapshot>),
  ): void {
    const current = this.currentSnapshot(threadId);
    const next = typeof patch === 'function' ? patch(current) : patch;
    this.setSnapshot(threadId, { ...current, ...next });
  }

  private setSnapshot(threadId: string, snapshot: ConversationRunSnapshot): void {
    const previous = this.snapshots.get(threadId);
    this.idleSnapshots.delete(threadId);
    this.snapshots.set(threadId, snapshot);
    for (const listener of this.listeners.get(threadId) ?? []) listener();
    // Skip global notification on token-only updates: no global consumer reads
    // `liveMessages`, so re-deriving the global snapshot per streamed token would
    // re-render the office scene / run pills for nothing.
    if (!previous || globalFieldsChanged(previous, snapshot)) {
      this.globalSnapshot = null;
      for (const listener of this.globalListeners) listener();
    }
  }
}

export function createConversationRunController(
  deps: Partial<ConversationRunControllerDeps> = {},
): ConversationRunController {
  return new ConversationRunController({
    eventBus: deps.eventBus ?? runtimeEventBus,
    runtimeFactory: deps.runtimeFactory ?? getDesktopAgentRuntime,
    reposFactory: deps.reposFactory ?? getRepos,
    materializeTurn: deps.materializeTurn ?? materializeChatTurn,
    persistMessage: deps.persistMessage ?? persistChatMessage,
    loadMessagesByIds: deps.loadMessagesByIds ?? loadPersistedChatMessagesByIdsWithRepositories,
    appendEvent: deps.appendEvent ?? appendThreadMessageEvent,
    now: deps.now ?? (() => Date.now()),
    randomUUID: deps.randomUUID ?? (() => crypto.randomUUID()),
    isMissionThreadRunning:
      deps.isMissionThreadRunning ?? ((threadId) => missionRunManager.isThreadRunning(threadId)),
  });
}

export const conversationRunController = createConversationRunController();
