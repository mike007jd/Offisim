import { loadPersistedChatMessages, persistChatMessage } from '@/data/chat-message-events.js';
import { appendThreadMessageEvent } from '@/data/thread-message-events.js';
import type { ChatMessage, ChatToolCall, RunError, StagedAttachment } from '@/data/types.js';
import {
  AGENT_LIFECYCLE_EVENT,
  AGENT_UI_REQUEST_EVENT,
  type AgentLifecyclePayload,
  type AgentPromptImage,
  type AgentQueueBehavior,
  type AgentUiRequestPayload,
  type DesktopAgentRunInput,
  type DesktopAgentRunResult,
  type DesktopAgentRuntime,
  type DirectDelegationInput,
  type ReattachedAgentRun,
  getDesktopAgentRuntime,
} from '@/runtime/desktop-agent-runtime.js';
import { getRepos, runtimeEventBus } from '@/runtime/repos.js';
import { conversationThreadLifecycle } from '@/runtime/thread-lifecycle-guard.js';
import type { EventBus, RuntimeRepositories } from '@offisim/core/browser';
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
} from '@offisim/shared-types';
import {
  buildRunError,
  displayAttachmentsFromStaged,
  materializeChatTurn,
  newDraftId,
  rehydratePersistedChatTurn,
  upsertChatToolCall,
} from './desktop-chat-runtime.js';

const CHECKPOINT_INTERVAL_MS = 3_000;
const ACTIVE_PHASES = new Set<ConversationRunPhase>(['preparing', 'running', 'awaiting-approval']);

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
  threadId: string;
  attemptId: string;
  hostRequestId: string;
  uiRequestId: string;
  method: string;
  title: string;
  message?: string;
  options?: readonly string[];
  placeholder?: string;
  prefill?: string;
  // 'live' — the host is awaiting this answer now. 'stale' — restored after a
  // restart (host gone; re-presented, not directly answerable). 'expired' — a
  // restored request older than STALE_APPROVAL_EXPIRY_MS (too old to act on,
  // dismiss only). 'unsupported' — a Pi UI primitive Offisim can't render.
  state: 'live' | 'stale' | 'expired' | 'unsupported';
  createdAt: number;
}

export interface RunRuntimeStatus {
  message: string | null;
  contextPercent: number | null;
  steeringQueued: number;
  followUpQueued: number;
}

/** A restored UI request older than this is `expired` (dismiss-only), not just
 *  `stale`. The host that would consume the answer is long gone; after a day the
 *  request is surfaced as expired so the user discards rather than waits on it. */
const STALE_APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000;

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
  runtimeStatus: RunRuntimeStatus;
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
  start: () => Promise<void>;
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
  cancelled?: boolean;
}

type MaterializeTurn = (input: {
  text: string;
  companyId: string | null;
  threadId: string;
  staged: readonly StagedAttachment[];
}) => Promise<{
  promptText: string;
  attachments: ChatMessage['attachments'];
  images: AgentPromptImage[];
}>;

type RehydrateTurn = (input: {
  text: string;
  attachments: readonly NonNullable<ChatMessage['attachments']>[number][];
}) => Promise<{
  promptText: string;
  attachments: ChatMessage['attachments'];
  images: AgentPromptImage[];
}>;

interface ConversationRunControllerDeps {
  eventBus: EventBus;
  runtimeFactory: (companyId: string) => Promise<DesktopAgentRuntime>;
  reposFactory: () => Promise<RuntimeRepositories>;
  materializeTurn: MaterializeTurn;
  rehydrateTurn: RehydrateTurn;
  persistMessage: typeof persistChatMessage;
  loadMessages: typeof loadPersistedChatMessages;
  appendEvent: typeof appendThreadMessageEvent;
  now: () => number;
  randomUUID: () => string;
}

interface RetryRecord {
  input: SubmitConversationRun;
  userMessage: ChatMessage;
  userMessages: ChatMessage[];
  priorMessages: ChatMessage[];
  promptText: string;
  images: AgentPromptImage[];
  queuedTurns: QueuedTurn[];
  pendingLoopHandoff: PendingLoopHandoff | null;
}

interface PendingLoopHandoff {
  prepared: PreparedLoopExecution;
  messagePersisted: boolean;
}

interface QueuedTurn {
  promptText: string;
  images: AgentPromptImage[];
  behavior: AgentQueueBehavior;
  userMessageId: string;
  delivering: boolean;
  delivered: boolean;
  failed: boolean;
  /** Pi removed this accepted turn from its native queue and began processing it. */
  consumed: boolean;
  onDelivered?: () => void;
}

interface ActiveRun {
  input: SubmitConversationRun;
  threadId: string;
  attemptId: string;
  userMessage: ChatMessage;
  userMessages: ChatMessage[];
  /** Terminal/partial messages from an interrupted attempt retained when a
   * durable Resume starts a new assistant response under the same run id. */
  priorMessages: ChatMessage[];
  assistantMessageId: string;
  assistantMessage: ChatMessage | null;
  promptText: string | null;
  images: AgentPromptImage[];
  queuedTurns: QueuedTurn[];
  queueChain: Promise<void>;
  contentText: string;
  reasoningText: string;
  streamCursor: number;
  toolCalls: ChatToolCall[];
  activity: RunToolActivity[];
  activityTotal: number;
  delegations: RunDelegation[];
  runtimeStatus: RunRuntimeStatus;
  runtime: DesktopAgentRuntime | null;
  stopped: boolean;
  terminalCommitStarted: boolean;
  terminalTask: Promise<void> | null;
  terminalOutcome:
    | { kind: 'completed'; response: DesktopAgentRunResult }
    | { kind: 'failed'; error: unknown }
    | null;
  lastCheckpointAt: number;
  firstCheckpointWritten: boolean;
  messagePersistedNotified: boolean;
  pendingLoopHandoff: PendingLoopHandoff | null;
  unsubscribers: Array<() => void>;
}

function visibleRunMessages(run: ActiveRun, assistant = run.assistantMessage): ChatMessage[] {
  return assistant
    ? [...run.userMessages, ...run.priorMessages, assistant]
    : [...run.userMessages, ...run.priorMessages];
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
    runtimeStatus: emptyRuntimeStatus(),
    approval: null,
    error: null,
  };
}

function emptyRuntimeStatus(): RunRuntimeStatus {
  return {
    message: null,
    contextPercent: null,
    steeringQueued: 0,
    followUpQueued: 0,
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

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function detailFromTelemetry(payload: ToolExecutionTelemetryPayload): string | undefined {
  if (payload.errorType) return payload.errorType;
  const parts = [payload.serverName, payload.nodeName, payload.toolType].filter(Boolean);
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
    prev.runtimeStatus !== next.runtimeStatus ||
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
  // Live UI state stays in memory, while the Rust-owned Pi stream survives a
  // renderer reload. Bootstrap adopts that stream before recovery classification
  // so a reload neither duplicates nor prematurely interrupts paid work.
  private readonly snapshots = new Map<string, ConversationRunSnapshot>();
  private readonly idleSnapshots = new Map<string, ConversationRunSnapshot>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly stopOperations = new Map<string, Promise<void>>();
  private readonly mutationLocks = new Set<string>();
  private readonly retryRecords = new Map<string, RetryRecord>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly globalListeners = new Set<() => void>();
  private globalSnapshot: ConversationRunsSnapshot | null = null;
  private hydrationByCompany = new Set<string>();
  private readonly runtimeHydrationByCompany = new Map<string, Promise<ReadonlySet<string>>>();

  constructor(private readonly deps: ConversationRunControllerDeps) {}

  async hydrateRuntimeState(companyId: string): Promise<ReadonlySet<string>> {
    const existing = this.runtimeHydrationByCompany.get(companyId);
    if (existing) return existing;
    const hydration = (async () => {
      const runtime = await this.deps.runtimeFactory(companyId);
      if (!runtime.reattachLiveRuns) return new Set<string>();
      const attached = await runtime.reattachLiveRuns(async (descriptor) => {
        const run = await this.adoptReattachedRun(descriptor, runtime);
        if (!run) return null;
        return {
          afterCursor: run.streamCursor,
          onReady: () => this.flushQueuedTurns(run),
          onResult: (result) => this.completeRun(run, result),
          onError: (error) => this.failRun(run, error),
          onCancelled: () => this.stopAndWait(run.threadId),
        };
      });
      return new Set(attached);
    })().catch((error) => {
      this.runtimeHydrationByCompany.delete(companyId);
      throw error;
    });
    this.runtimeHydrationByCompany.set(companyId, hydration);
    return hydration;
  }

  private async adoptReattachedRun(
    descriptor: ReattachedAgentRun,
    runtime: DesktopAgentRuntime,
    mode: 'reattach' | 'resume' = 'reattach',
  ): Promise<ActiveRun | null> {
    const existing = this.activeRuns.get(descriptor.threadId);
    if (existing) {
      return existing.attemptId === descriptor.runId && existing.runtime === runtime
        ? existing
        : null;
    }
    const messages = await this.deps.loadMessages(descriptor.threadId);
    const startedAt = Date.parse(descriptor.startedAt) || this.deps.now();
    const userMessages = messages
      .filter((message) => message.author === 'boss' && message.attemptId === descriptor.runId)
      .sort((a, b) => a.at - b.at);
    const userMessage =
      userMessages.find((message) => !message.queueState) ??
      ({
        id: `reattached-${descriptor.runId}`,
        threadId: descriptor.threadId,
        author: 'boss',
        employeeId: null,
        body: descriptor.objective,
        at: startedAt,
        attemptId: descriptor.runId,
        status: 'complete',
      } satisfies ChatMessage);
    const queuedMessages = userMessages.filter((message) => Boolean(message.queueState));
    const currentUsers = [userMessage, ...queuedMessages].sort((a, b) => a.at - b.at);
    const rootMaterialized = await this.deps.rehydrateTurn({
      text: userMessage.body,
      attachments: userMessage.attachments ?? [],
    });
    const checkpoint = messages
      .filter((message) => message.author !== 'boss' && message.attemptId === descriptor.runId)
      .at(-1);
    const queuedTurns: QueuedTurn[] = await Promise.all(
      queuedMessages.map(async (message) => {
        const materialized = await this.deps.rehydrateTurn({
          text: message.body,
          attachments: message.attachments ?? [],
        });
        const state = message.queueState ?? 'pending';
        const consumed = state === 'consumed';
        return {
          promptText: materialized.promptText,
          images: materialized.images,
          behavior: message.queueBehavior ?? 'followUp',
          userMessageId: message.id,
          delivering: false,
          // A dead host cannot still own accepted-but-unconsumed controls. A
          // durable Resume opens a new host and redelivers every unconsumed turn
          // exactly once; a live reattach preserves the existing host admission.
          delivered: mode === 'resume' ? consumed : state === 'accepted' || consumed,
          failed: mode === 'resume' ? false : state === 'failed',
          consumed,
        };
      }),
    );
    const claimedWhileLoading = this.activeRuns.get(descriptor.threadId);
    if (claimedWhileLoading) {
      return claimedWhileLoading.attemptId === descriptor.runId &&
        claimedWhileLoading.runtime === runtime
        ? claimedWhileLoading
        : null;
    }
    const interruptedCheckpoint =
      mode === 'resume' && checkpoint ? { ...checkpoint, status: 'interrupted' as const } : null;
    const run = this.beginRun(
      {
        companyId: descriptor.companyId,
        projectId: descriptor.projectId,
        threadId: descriptor.threadId,
        employeeId: descriptor.employeeId,
        text: rootMaterialized.promptText,
        stagedAttachments: [],
        source: 'office',
        model: descriptor.model,
        permissionMode: descriptor.permissionMode,
        thinkingLevel: descriptor.thinkingLevel,
      },
      descriptor.runId,
      userMessage,
      rootMaterialized.promptText,
      rootMaterialized.images,
      {
        userMessages: currentUsers,
        priorMessages: interruptedCheckpoint ? [interruptedCheckpoint] : [],
        queuedTurns,
        preserveDeliveryState: true,
      },
    );
    run.runtime = runtime;
    if (checkpoint && mode === 'reattach') {
      run.assistantMessageId = checkpoint.id;
      run.assistantMessage = { ...checkpoint, status: 'streaming' };
      run.streamCursor = finiteCount(checkpoint.streamCursor);
      run.contentText = run.streamCursor > 0 ? checkpoint.body : '';
      run.reasoningText = run.streamCursor > 0 ? (checkpoint.reasoning ?? '') : '';
      run.firstCheckpointWritten = true;
    }
    if (interruptedCheckpoint) {
      try {
        await this.persistRunMessage(run, interruptedCheckpoint);
      } catch (error) {
        this.activeRuns.delete(run.threadId);
        this.snapshots.delete(run.threadId);
        throw error;
      }
    }
    run.unsubscribers = this.subscribeRuntimeEvents(run);
    this.patchSnapshot(run.threadId, {
      phase: 'running',
      liveMessages: visibleRunMessages(run),
    });
    return run;
  }

  async submit(input: SubmitConversationRun): Promise<ConversationRunHandle> {
    await this.hydrateRuntimeState(input.companyId);
    const hasAttachedFile = input.stagedAttachments.some(
      (attachment) => attachment.status === 'attached',
    );
    const trimmed = input.text.trim() || (hasAttachedFile ? 'Review the attached files.' : '');
    if (!trimmed) throw new Error('Cannot submit an empty conversation run.');
    if (this.mutationLocks.has(input.threadId))
      throw new ConversationRunMutationLockedError(input.threadId);
    if (this.activeRuns.has(input.threadId))
      throw new ConversationRunAlreadyActiveError(input.threadId);

    const attemptId = `attempt-${this.deps.randomUUID()}`;
    const userMessage: ChatMessage = {
      id: newDraftId('boss'),
      threadId: input.threadId,
      author: 'boss',
      employeeId: null,
      body: trimmed,
      at: this.deps.now(),
      attachments: displayAttachmentsFromStaged(input.stagedAttachments),
      attemptId,
      status: 'complete',
    };
    const run = this.beginRun({ ...input, text: trimmed }, attemptId, userMessage, null, []);
    void this.runAttempt(run);
    return { threadId: input.threadId, attemptId, userMessageId: userMessage.id };
  }

  /** Claim an interrupted durable root before starting its replacement host.
   * This keeps streaming, approvals, Stop, queue replay, and final ChatMessage
   * persistence under the same controller ownership as an ordinary submit. */
  async resumeInterrupted(companyId: string, runId: string): Promise<ConversationRunHandle> {
    await this.hydrateRuntimeState(companyId);
    const repos = await this.deps.reposFactory();
    const row = await repos.agentRuns.findById(runId);
    if (!row || row.company_id !== companyId || row.status !== 'interrupted') {
      throw new Error('Interrupted run is no longer available for this company.');
    }
    if (this.mutationLocks.has(row.thread_id)) {
      throw new ConversationRunMutationLockedError(row.thread_id);
    }
    if (this.activeRuns.has(row.thread_id)) {
      throw new ConversationRunAlreadyActiveError(row.thread_id);
    }
    let context: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.runtime_context_json ?? '{}');
      if (parsed && typeof parsed === 'object') context = parsed as Record<string, unknown>;
    } catch {
      context = {};
    }
    const textValue = (key: string) =>
      typeof context[key] === 'string' && context[key].trim()
        ? (context[key] as string).trim()
        : undefined;
    const runtime = await this.deps.runtimeFactory(companyId);
    const descriptor: ReattachedAgentRun = {
      requestId: `resume-${runId}`,
      runId,
      companyId,
      threadId: row.thread_id,
      employeeId: row.employee_id,
      projectId: row.project_id ?? textValue('projectId') ?? null,
      objective: row.objective || 'Continue the interrupted task.',
      startedAt: row.started_at,
      model: textValue('model'),
      permissionMode: textValue('permissionMode'),
      thinkingLevel: textValue('thinkingLevel'),
    };
    const run = await this.adoptReattachedRun(descriptor, runtime, 'resume');
    if (!run) throw new ConversationRunAlreadyActiveError(row.thread_id);
    void this.runResumeAttempt(run);
    return {
      threadId: run.threadId,
      attemptId: run.attemptId,
      userMessageId: run.userMessage.id,
    };
  }

  async enqueue(
    input: SubmitConversationRun,
    behavior: AgentQueueBehavior,
  ): Promise<ConversationRunHandle> {
    await this.hydrateRuntimeState(input.companyId);
    const run = this.activeRuns.get(input.threadId);
    if (!run || run.stopped) throw new Error('This conversation no longer has an active run.');
    if (input.loopExecution) {
      throw new Error(
        'A Loop starts a separate run and cannot be queued inside the active Pi turn.',
      );
    }

    let handle: ConversationRunHandle | null = null;
    const operation = run.queueChain
      .catch(() => {})
      .then(async () => {
        if (!this.isActiveRun(run) || run.stopped) {
          throw new Error('The active run ended before this message could be queued.');
        }
        const hasAttachedFile = input.stagedAttachments.some(
          (attachment) => attachment.status === 'attached',
        );
        const text = input.text.trim() || (hasAttachedFile ? 'Review the attached files.' : '');
        if (!text) throw new Error('Cannot queue an empty message.');
        const materialized = await this.deps.materializeTurn({
          text,
          companyId: input.companyId,
          threadId: input.threadId,
          staged: input.stagedAttachments,
        });
        if (!this.isActiveRun(run) || run.stopped) {
          throw new Error('The active run ended before this message could be queued.');
        }
        const userMessage: ChatMessage = {
          id: newDraftId('boss'),
          threadId: input.threadId,
          author: 'boss',
          employeeId: null,
          body: text,
          at: this.deps.now(),
          attachments: materialized.attachments?.length ? materialized.attachments : undefined,
          attemptId: run.attemptId,
          queueBehavior: behavior,
          queueState: 'pending',
          status: 'complete',
        };
        await this.persistInputMessage(input, userMessage);
        const queuedTurn: QueuedTurn = {
          promptText: materialized.promptText,
          images: materialized.images,
          behavior,
          userMessageId: userMessage.id,
          delivering: false,
          delivered: false,
          failed: false,
          consumed: false,
          onDelivered: input.onMessagePersisted,
        };
        run.userMessages = [...run.userMessages, userMessage];
        run.queuedTurns.push(queuedTurn);
        this.patchSnapshot(run.threadId, {
          liveMessages: visibleRunMessages(run),
        });
        if (run.runtime) await this.deliverQueuedTurn(run, queuedTurn);
        handle = {
          threadId: input.threadId,
          attemptId: run.attemptId,
          userMessageId: userMessage.id,
        };
      });
    run.queueChain = operation;
    await operation;
    if (!handle) throw new Error('The queued message was not accepted.');
    return handle;
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
      record.images,
      {
        userMessages: record.userMessages,
        priorMessages: record.priorMessages,
        queuedTurns: record.queuedTurns,
      },
    );
    run.pendingLoopHandoff = record.pendingLoopHandoff;
    if (record.pendingLoopHandoff) {
      void this.resumeLoopHandoff(run, record.pendingLoopHandoff);
    } else if (record.input.loopExecution) {
      // Materialization/message persistence failed and compensation succeeded, so
      // retrying the full two-phase hand-off is safe and cannot duplicate a Mission.
      void this.runAttempt(run);
    } else {
      void this.executeAttempt(run);
    }
    return { threadId, attemptId: nextAttemptId, userMessageId: record.userMessage.id };
  }

  private beginRun(
    input: SubmitConversationRun,
    attemptId: string,
    userMessage: ChatMessage,
    promptText: string | null,
    images: AgentPromptImage[],
    restored?: {
      userMessages: ChatMessage[];
      priorMessages?: ChatMessage[];
      queuedTurns: QueuedTurn[];
      preserveDeliveryState?: boolean;
    },
  ): ActiveRun {
    const userMessages = (restored?.userMessages ?? [userMessage]).map((message) => ({
      ...message,
      status: message.author === 'boss' ? ('complete' as const) : message.status,
    }));
    const run: ActiveRun = {
      input,
      threadId: input.threadId,
      attemptId,
      userMessage,
      userMessages,
      priorMessages: (restored?.priorMessages ?? []).map((message) => ({ ...message })),
      assistantMessageId: newDraftId('assistant'),
      assistantMessage: null,
      promptText,
      images,
      queuedTurns: (restored?.queuedTurns ?? []).map((turn) => ({
        ...turn,
        images: [...turn.images],
        delivering: false,
        delivered: restored?.preserveDeliveryState ? turn.delivered : turn.consumed,
        failed: restored?.preserveDeliveryState ? turn.failed : false,
        consumed: turn.consumed,
      })),
      queueChain: Promise.resolve(),
      contentText: '',
      reasoningText: '',
      streamCursor: 0,
      toolCalls: [],
      activity: [],
      activityTotal: 0,
      delegations: [],
      runtimeStatus: emptyRuntimeStatus(),
      runtime: null,
      stopped: false,
      terminalCommitStarted: false,
      terminalTask: null,
      terminalOutcome: null,
      lastCheckpointAt: 0,
      firstCheckpointWritten: false,
      messagePersistedNotified: false,
      pendingLoopHandoff: null,
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
      liveMessages: userMessages,
      activity: [],
      activityTotal: 0,
      delegations: [],
      runtimeStatus: emptyRuntimeStatus(),
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

  stopAndWait(threadId: string): Promise<void> {
    const existing = this.stopOperations.get(threadId);
    if (existing) return existing;
    // Publish Stop ownership before runtime.abort can synchronously surface a
    // retained Result/Error. Terminal observers can then await this exact
    // arbitration instead of acknowledging persistence before the transcript.
    const operation = Promise.resolve().then(() => this.performStopAndWait(threadId));
    this.stopOperations.set(threadId, operation);
    void operation.then(
      () => {
        if (this.stopOperations.get(threadId) === operation) {
          this.stopOperations.delete(threadId);
        }
      },
      () => {
        if (this.stopOperations.get(threadId) === operation) {
          this.stopOperations.delete(threadId);
        }
      },
    );
    return operation;
  }

  private async performStopAndWait(threadId: string): Promise<void> {
    const run = this.activeRuns.get(threadId);
    if (!run) return;
    // Once root settlement has started, that durable commit is the linearization
    // point: let it finish. Before that point Stop marks the run immediately so
    // an in-progress Result/Error observer yields after its current awaited write.
    if (run.terminalCommitStarted) {
      await run.terminalTask?.catch(() => {});
      if (!this.isActiveRun(run)) return;
    }
    const approval = this.currentSnapshot(threadId).approval;
    run.stopped = true;
    try {
      await run.runtime?.abort(threadId);
    } catch (error) {
      // The host may still be running tools. Restore normal event ownership and
      // let an already-delivered terminal callback finish; do not mutate the
      // transcript, interaction row, or root marker on an unacknowledged Stop.
      run.stopped = false;
      await this.resumeTerminalOutcome(run).catch((terminalError: unknown) => {
        console.warn('[conversation-run] terminal callback retry after Stop failure failed', {
          threadId,
          terminalError,
        });
      });
      throw error;
    }
    await run.terminalTask?.catch(() => {});
    let persistenceError: unknown = null;
    if (approval) {
      try {
        await this.resolveActiveInteraction(run, approval, 'cancelled', {
          cancelled: true,
          reason: 'run-stopped',
        });
      } catch (error) {
        try {
          const repos = await this.deps.reposFactory();
          await repos.activeInteractions?.deleteByThread(threadId);
        } catch (deleteError) {
          persistenceError ??= new AggregateError(
            [error, deleteError],
            'Stopped approval cleanup failed.',
          );
          console.warn('[conversation-run] stopped approval cleanup failed', {
            threadId,
            error,
            deleteError,
          });
        }
      }
    } else {
      try {
        const repos = await this.deps.reposFactory();
        await repos.activeInteractions?.deleteByThread(threadId);
      } catch (error) {
        persistenceError = error;
      }
    }
    if (!persistenceError) this.patchSnapshot(threadId, { approval: null });
    if (run.assistantMessage) {
      const interrupted = {
        ...stripToolCalls(run.assistantMessage),
        status: 'interrupted' as const,
      };
      run.assistantMessage = interrupted;
      try {
        await this.persistRunMessage(run, interrupted);
      } catch (error) {
        persistenceError ??= error;
      }
    }
    if (!persistenceError) {
      try {
        await run.runtime?.settleRun(threadId, 'cancelled');
      } catch (error) {
        persistenceError = error;
      }
    }
    if (persistenceError) throw persistenceError;
    this.cleanupRun(run);
    this.activeRuns.delete(threadId);
    this.patchSnapshot(threadId, {
      attemptId: run.attemptId,
      phase: 'interrupted',
      employeeId: run.input.employeeId,
      source: run.input.source,
      liveMessages: visibleRunMessages(run),
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
      console.warn('[conversation-run] ignored stale approval answer', input);
      return;
    }

    if (!run.runtime) throw new Error('Cannot answer approval before runtime is attached.');
    await run.runtime.answerUiRequest({
      requestId: input.hostRequestId,
      id: input.uiRequestId,
      confirmed: input.confirmed,
      value: input.value,
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
        {
          confirmed: input.confirmed,
          value: input.value,
          cancelled: input.cancelled,
        },
      );
    } finally {
      const current = this.currentSnapshot(input.threadId);
      if (
        current.approval?.attemptId === approval.attemptId &&
        current.approval.uiRequestId === approval.uiRequestId
      ) {
        this.setSnapshot(input.threadId, {
          ...current,
          phase: 'running',
          approval: null,
        });
      }
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
        if (payload.source !== 'pi-ui-request') continue;
        const createdAt = Date.parse(row.created_at) || this.deps.now();
        // A restored request past the expiry window can no longer be acted on.
        const expired = this.deps.now() - createdAt > STALE_APPROVAL_EXPIRY_MS;
        const approval: PendingApproval = {
          threadId: row.thread_id,
          attemptId: String(payload.attemptId ?? row.interaction_id),
          hostRequestId: String(payload.hostRequestId ?? ''),
          uiRequestId: String(payload.uiRequestId ?? row.interaction_id),
          method: String(payload.method ?? 'confirm'),
          title: String(payload.title ?? 'Approval needed'),
          message: typeof payload.message === 'string' ? payload.message : undefined,
          options: Array.isArray(payload.options)
            ? payload.options.filter((option): option is string => typeof option === 'string')
            : undefined,
          placeholder: typeof payload.placeholder === 'string' ? payload.placeholder : undefined,
          prefill: typeof payload.prefill === 'string' ? payload.prefill : undefined,
          state: expired ? 'expired' : 'stale',
          createdAt,
        };
        this.patchSnapshot(row.thread_id, {
          companyId,
          phase: 'awaiting-approval',
          attemptId: approval.attemptId,
          approval,
        });
      }
    } catch (error) {
      this.hydrationByCompany.delete(companyId);
      throw error;
    }
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
      activeRuns: runs.filter((run) => isConversationRunActive(run.phase)),
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

  private runtimeInput(run: ActiveRun): DesktopAgentRunInput {
    return {
      text: run.promptText ?? run.input.text,
      images: run.images,
      threadId: run.threadId,
      employeeId: run.input.employeeId,
      projectId: run.input.projectId,
      model: run.input.model,
      permissionMode: run.input.permissionMode,
      thinkingLevel: run.input.thinkingLevel,
      runId: run.attemptId,
      deferTerminalSettlement: true,
      directDelegation: run.input.directDelegation,
    };
  }

  private async runAttempt(run: ActiveRun): Promise<void> {
    try {
      const materialized = await this.deps.materializeTurn({
        text: run.input.text,
        companyId: run.input.companyId,
        threadId: run.threadId,
        staged: run.input.stagedAttachments,
      });
      if (!this.isActiveRun(run)) return;
      run.promptText = materialized.promptText;
      run.images = materialized.images;
      run.userMessage = {
        ...run.userMessage,
        attachments: materialized.attachments?.length ? materialized.attachments : undefined,
      };
      run.userMessages = [run.userMessage];

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

      run.runtime = await this.deps.runtimeFactory(run.input.companyId);
      if (!this.isActiveRun(run) || run.stopped) return;
      await run.runtime.admitRun(this.runtimeInput(run));
      if (!this.isActiveRun(run) || run.stopped) return;
      this.patchSnapshot(run.threadId, { liveMessages: [run.userMessage] });
      await this.persistRunMessage(run, run.userMessage);
      this.notifyMessagePersisted(run);
      this.saveRetryRecord(run);
      await this.executeAttempt(run);
    } catch (error) {
      await this.failRun(run, error).catch((settlementError: unknown) => {
        console.warn('[conversation-run] terminal failure settlement retained for reload', {
          threadId: run.threadId,
          settlementError,
        });
      });
    }
  }

  private async resumeLoopHandoff(run: ActiveRun, handoff: PendingLoopHandoff): Promise<void> {
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
      await handoff.prepared.start();
      run.pendingLoopHandoff = null;
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
    }
  }

  private async executeAttempt(run: ActiveRun): Promise<void> {
    try {
      this.patchSnapshot(run.threadId, { phase: 'running' });
      run.runtime ??= await this.deps.runtimeFactory(run.input.companyId);
      if (!this.isActiveRun(run)) return;
      if (run.stopped) {
        void run.runtime.abort(run.threadId);
        return;
      }
      run.unsubscribers = this.subscribeRuntimeEvents(run);
      const responsePromise = run.runtime.execute(this.runtimeInput(run));
      // Queue delivery can fail before the root invoke settles. Attach a handler
      // immediately so a fast root rejection never becomes an unhandled promise
      // while the controller is still draining pre-start queued turns.
      void responsePromise.catch(() => {});
      await this.flushQueuedTurns(run);
      const response = await responsePromise;
      await this.completeRun(run, response);
    } catch (error) {
      await this.failRun(run, error).catch((settlementError: unknown) => {
        console.warn('[conversation-run] terminal settlement retained for reload', {
          threadId: run.threadId,
          settlementError,
        });
      });
    } finally {
      if (!this.isActiveRun(run)) this.cleanupRun(run);
    }
  }

  private async runResumeAttempt(run: ActiveRun): Promise<void> {
    try {
      if (!run.runtime) throw new Error('Cannot resume before the Pi runtime is attached.');
      const responsePromise = run.runtime.resume(run.attemptId, {
        text: run.promptText ?? run.input.text,
        images: run.images,
        threadId: run.threadId,
      });
      void responsePromise.catch(() => {});
      await this.flushQueuedTurns(run);
      const response = await responsePromise;
      await this.completeRun(run, response);
    } catch (error) {
      await this.failRun(run, error).catch((settlementError: unknown) => {
        console.warn('[conversation-run] resumed terminal settlement retained for reload', {
          threadId: run.threadId,
          settlementError,
        });
      });
    } finally {
      if (!this.isActiveRun(run)) this.cleanupRun(run);
    }
  }

  private async completeRun(run: ActiveRun, response: DesktopAgentRunResult): Promise<void> {
    if (!this.isActiveRun(run)) return;
    run.terminalOutcome = { kind: 'completed', response };
    if (run.stopped) {
      await this.stopOperations.get(run.threadId)?.catch(() => {});
      if (!this.isActiveRun(run) || run.stopped) return;
    }
    return this.runTerminalTask(run, () => this.performCompleteRun(run, response));
  }

  private async performCompleteRun(run: ActiveRun, response: DesktopAgentRunResult): Promise<void> {
    if (!this.canFinalizeRun(run)) return;
    const reasoning = (response.reasoning || run.reasoningText).trim();
    const responseText = response.text.trim() || run.contentText.trim();
    const deliveredQueuedMessageIds = new Set(
      run.queuedTurns
        .filter((turn) => turn.delivered && !turn.failed)
        .map((turn) => turn.userMessageId),
    );
    const replyTo =
      [...run.userMessages]
        .reverse()
        .find(
          (message) =>
            message.id === run.userMessage.id || deliveredQueuedMessageIds.has(message.id),
        ) ?? run.userMessage;
    const assistant: ChatMessage = {
      id: run.assistantMessageId,
      threadId: run.threadId,
      author: 'employee',
      employeeId: run.input.employeeId,
      body: responseText,
      ...(reasoning ? { reasoning } : {}),
      at: run.assistantMessage?.at ?? this.deps.now(),
      replyToMessageId: replyTo.id,
      attemptId: run.attemptId,
      ...(run.streamCursor > 0 ? { streamCursor: run.streamCursor } : {}),
      status: 'complete',
    };
    run.assistantMessage = assistant;
    await this.persistRunMessage(run, assistant);
    if (!this.canFinalizeRun(run)) return;
    await this.clearTerminalInteraction(run);
    if (!this.canFinalizeRun(run)) return;
    run.terminalCommitStarted = true;
    try {
      await run.runtime?.settleRun(run.threadId, 'completed');
    } catch (error) {
      run.terminalCommitStarted = false;
      throw error;
    }
    this.cleanupRun(run);
    this.activeRuns.delete(run.threadId);
    this.patchSnapshot(run.threadId, {
      phase: 'completed',
      approval: null,
      liveMessages: visibleRunMessages(run, assistant),
      activity: run.activity,
      activityTotal: run.activityTotal,
    });
  }

  private async flushQueuedTurns(run: ActiveRun): Promise<void> {
    for (const turn of run.queuedTurns) {
      await this.deliverQueuedTurn(run, turn).catch((error: unknown) => {
        console.warn('[conversation-run] queued-message delivery failed', {
          threadId: run.threadId,
          error,
        });
        run.runtimeStatus = { ...run.runtimeStatus, message: 'Queued instruction failed' };
        this.patchSnapshot(run.threadId, { runtimeStatus: run.runtimeStatus });
      });
    }
  }

  private async deliverQueuedTurn(run: ActiveRun, turn: QueuedTurn) {
    if (turn.delivered || turn.delivering || turn.failed || !run.runtime) return;
    turn.delivering = true;
    try {
      await run.runtime.queueMessage(run.threadId, {
        id: turn.userMessageId,
        text: turn.promptText,
        images: turn.images,
        behavior: turn.behavior,
      });
      turn.delivered = true;
      turn.failed = false;
      // A restarted host can answer the redelivery with durable `consumed`
      // directly. Its lifecycle event settles queueMessage and marks the turn
      // before this continuation resumes; never regress that terminal fact to
      // accepted just because the ACK promise completed.
      if (!turn.consumed) {
        await this.persistQueuedTurnState(run, turn, 'accepted').catch((error: unknown) => {
          console.warn('[conversation-run] failed to persist queued-message delivery', {
            threadId: run.threadId,
            error,
          });
        });
      }
      const onDelivered = turn.onDelivered;
      turn.onDelivered = undefined;
      try {
        onDelivered?.();
      } catch (error) {
        console.warn('[conversation-run] queued-message callback failed', {
          threadId: run.threadId,
          error,
        });
      }
    } catch (error) {
      turn.delivered = false;
      turn.failed = true;
      await this.persistQueuedTurnState(run, turn, 'failed').catch((persistError: unknown) => {
        console.warn('[conversation-run] failed to persist queued-message failure', {
          threadId: run.threadId,
          error: persistError,
        });
      });
      throw error;
    } finally {
      turn.delivering = false;
      this.patchSnapshot(run.threadId, {
        liveMessages: visibleRunMessages(run),
      });
    }
  }

  private async persistQueuedTurnState(
    run: ActiveRun,
    turn: QueuedTurn,
    queueState: NonNullable<ChatMessage['queueState']>,
  ): Promise<void> {
    const current = run.userMessages.find((message) => message.id === turn.userMessageId);
    if (!current || current.queueState === queueState) return;
    const next: ChatMessage = {
      ...current,
      queueState,
      status: queueState === 'failed' ? 'failed' : 'complete',
    };
    run.userMessages = run.userMessages.map((message) => (message.id === next.id ? next : message));
    await this.persistRunMessage(run, next);
  }

  private subscribeRuntimeEvents(run: ActiveRun): Array<() => void> {
    const offStream = this.deps.eventBus.on('llm.stream.chunk', (event) => {
      const payload = event.payload as Record<string, unknown>;
      if (!this.matchesRun(event, payload, run)) return;
      const content = typeof payload.content === 'string' ? payload.content : '';
      if (!content) return;
      run.streamCursor = Math.max(run.streamCursor, finiteCount(payload.streamCursor));
      const channel = payload.channel === 'reasoning' ? 'reasoning' : 'content';
      if (channel === 'reasoning') run.reasoningText += content;
      else run.contentText += content;
      this.upsertAssistantDraft(run);
      void this.maybeCheckpoint(run).catch((err: unknown) => {
        console.warn('[conversation-run] checkpoint failed', { threadId: run.threadId, err });
      });
    });

    const offTool = this.deps.eventBus.on('tool.execution.telemetry', (event) => {
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

    const offLifecycle = this.deps.eventBus.on(AGENT_LIFECYCLE_EVENT, (event) => {
      const payload = event.payload as AgentLifecyclePayload;
      if (
        !payload?.event ||
        !this.matchesRun(event, payload as unknown as Record<string, unknown>, run)
      ) {
        return;
      }
      this.noteLifecycle(run, payload);
    });

    // Delegation run-tree events graft onto this run when the child's rootRunId
    // equals this run's attemptId (the agentRun envelope carries the child runId
    // in payload.runId, not the root, so matchesRun's attemptId check won't fit).
    // The root now emits its OWN agent.run stream (runId === attemptId) so the
    // office/projection see it; skip those here — the root is not a delegation of
    // itself, it's the tree root the delegations hang under.
    const offAgentRun = this.deps.eventBus.on('agent.run', (event) => {
      const payload = event.payload as AgentRunEvent;
      if (payload?.rootRunId !== run.attemptId || payload.threadId !== run.threadId) return;
      if (payload.runId === run.attemptId) return;
      this.noteDelegation(run, payload);
    });

    return [offStream, offTool, offUi, offLifecycle, offAgentRun];
  }

  private noteLifecycle(run: ActiveRun, payload: AgentLifecyclePayload): void {
    const data = payload.data ?? {};
    if (payload.event === 'ui' && data.state === 'cancelled') {
      const approval = this.currentSnapshot(run.threadId).approval;
      if (approval && approval.uiRequestId === data.uiRequestId) {
        this.patchSnapshot(run.threadId, { phase: 'running', approval: null });
        void this.resolveActiveInteraction(run, approval, 'cancelled', {
          cancelled: true,
          reason: data.reason,
        }).catch((error: unknown) => {
          console.warn('[conversation-run] host-cancelled interaction persist failed', {
            threadId: run.threadId,
            error,
          });
        });
      }
      return;
    }
    let next = run.runtimeStatus;
    if (payload.event === 'queue') {
      const steeringQueued = finiteCount(data.steeringCount);
      const followUpQueued = finiteCount(data.followUpCount);
      const total = steeringQueued + followUpQueued;
      next = {
        ...next,
        steeringQueued,
        followUpQueued,
        message:
          total > 0
            ? `${steeringQueued ? `${steeringQueued} correction${steeringQueued === 1 ? '' : 's'}` : ''}${steeringQueued && followUpQueued ? ' · ' : ''}${followUpQueued ? `${followUpQueued} follow-up${followUpQueued === 1 ? '' : 's'}` : ''} queued`
            : null,
      };
    } else if (payload.event === 'context') {
      const percent =
        typeof data.percent === 'number' && Number.isFinite(data.percent)
          ? Math.max(0, Math.min(100, data.percent))
          : null;
      next = { ...next, contextPercent: percent };
    } else if (payload.event === 'compaction') {
      next = {
        ...next,
        message:
          data.state === 'started'
            ? 'Compacting context'
            : data.errorMessage
              ? 'Context compaction failed'
              : null,
      };
    } else if (payload.event === 'retry') {
      const attempt = finiteCount(data.attempt);
      const maxAttempts = finiteCount(data.maxAttempts);
      next = {
        ...next,
        message:
          data.state === 'started'
            ? `Retrying ${attempt || 1}${maxAttempts ? `/${maxAttempts}` : ''}`
            : data.success === false
              ? 'Retry failed'
              : null,
      };
    } else if (payload.event === 'control') {
      const controlId = typeof data.controlId === 'string' ? data.controlId : '';
      const turn = controlId
        ? run.queuedTurns.find((candidate) => candidate.userMessageId === controlId)
        : undefined;
      if (turn && data.state === 'consumed') {
        turn.consumed = true;
        turn.delivered = true;
        turn.failed = false;
        void this.persistQueuedTurnState(run, turn, 'consumed').catch((error: unknown) => {
          console.warn('[conversation-run] failed to persist consumed queued message', {
            threadId: run.threadId,
            error,
          });
        });
      } else if (turn && data.state === 'accepted' && !turn.consumed) {
        turn.consumed = false;
        turn.delivered = true;
        turn.failed = false;
        if (data.action === 'steer' || data.action === 'followUp') turn.behavior = data.action;
        void this.persistQueuedTurnState(run, turn, 'accepted').catch((error: unknown) => {
          console.warn('[conversation-run] failed to persist accepted queued message', {
            threadId: run.threadId,
            error,
          });
        });
      } else if (turn && !turn.consumed && (data.state === 'failed' || data.state === 'rejected')) {
        turn.delivered = false;
        turn.failed = true;
        void this.persistQueuedTurnState(run, turn, 'failed').catch((error: unknown) => {
          console.warn('[conversation-run] failed to persist rejected queued message', {
            threadId: run.threadId,
            error,
          });
        });
      }
      if (data.state === 'failed' || data.state === 'rejected') {
        next = { ...next, message: 'Queued instruction failed' };
      }
    }
    if (next === run.runtimeStatus) return;
    run.runtimeStatus = next;
    this.patchSnapshot(run.threadId, { runtimeStatus: next });
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
      replyToMessageId: (run.userMessages.at(-1) ?? run.userMessage).id,
      attemptId: run.attemptId,
      ...(run.streamCursor > 0 ? { streamCursor: run.streamCursor } : {}),
      status: 'streaming',
    };
    run.assistantMessage = assistant;
    this.patchSnapshot(run.threadId, (current) => ({
      phase: current.phase === 'awaiting-approval' ? 'awaiting-approval' : 'running',
      liveMessages: visibleRunMessages(run, assistant),
    }));
  }

  private async maybeCheckpoint(run: ActiveRun): Promise<void> {
    if (!run.assistantMessage) return;
    const now = this.deps.now();
    if (!run.firstCheckpointWritten || now - run.lastCheckpointAt >= CHECKPOINT_INTERVAL_MS) {
      run.firstCheckpointWritten = true;
      run.lastCheckpointAt = now;
      await this.persistRunMessage(run, stripToolCalls(run.assistantMessage));
    }
  }

  private noteTool(run: ActiveRun, payload: ToolExecutionTelemetryPayload): void {
    if (!payload.toolCallId) return;
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

  private async handleUiRequest(run: ActiveRun, request: AgentUiRequestPayload): Promise<void> {
    const approval: PendingApproval = {
      threadId: run.threadId,
      attemptId: run.attemptId,
      hostRequestId: request.requestId,
      uiRequestId: request.id,
      method: request.method,
      title: request.title,
      message: request.message,
      options: request.options,
      placeholder: request.placeholder,
      prefill: request.prefill,
      state: ['confirm', 'select', 'input', 'editor'].includes(request.method)
        ? 'live'
        : 'unsupported',
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
    if (run.assistantMessage)
      await this.persistRunMessage(run, stripToolCalls(run.assistantMessage));
    if (approval.state === 'unsupported' && run.runtime) {
      await run.runtime.answerUiRequest({
        requestId: request.requestId,
        id: request.id,
        cancelled: true,
      });
      await this.resolveActiveInteraction(run, approval, 'cancelled', {
        cancelled: true,
        unsupported: true,
      });
      const current = this.currentSnapshot(run.threadId);
      if (
        current.approval?.attemptId === approval.attemptId &&
        current.approval.uiRequestId === approval.uiRequestId
      ) {
        this.setSnapshot(run.threadId, { ...current, phase: 'running', approval: null });
      }
    }
  }

  private async failRun(run: ActiveRun, error: unknown): Promise<void> {
    if (!this.isActiveRun(run)) return;
    run.terminalOutcome = { kind: 'failed', error };
    if (run.stopped) {
      await this.stopOperations.get(run.threadId)?.catch(() => {});
      if (!this.isActiveRun(run) || run.stopped) return;
    }
    return this.runTerminalTask(run, () => this.performFailRun(run, error));
  }

  private async performFailRun(run: ActiveRun, error: unknown): Promise<void> {
    if (!this.canFinalizeRun(run)) return;
    const messageText = safeErrorMessage(error);
    let messages: ChatMessage[] = visibleRunMessages(run, null);
    if (
      run.assistantMessage &&
      (run.assistantMessage.body.trim() || run.assistantMessage.reasoning?.trim())
    ) {
      const failed = { ...stripToolCalls(run.assistantMessage), status: 'failed' as const };
      run.assistantMessage = failed;
      await this.persistRunMessage(run, failed);
      if (!this.canFinalizeRun(run)) return;
      messages = visibleRunMessages(run, failed);
    }
    await this.clearTerminalInteraction(run);
    if (!this.canFinalizeRun(run)) return;
    run.terminalCommitStarted = true;
    try {
      await run.runtime?.settleRun(run.threadId, 'failed');
    } catch (settlementError) {
      run.terminalCommitStarted = false;
      throw settlementError;
    }
    this.cleanupRun(run);
    this.activeRuns.delete(run.threadId);
    this.saveRetryRecord(run);
    const { threadId, attemptId } = run;
    const runError: RunError = {
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

  private runTerminalTask(run: ActiveRun, operation: () => Promise<void>): Promise<void> {
    const existing = run.terminalTask;
    if (existing) return existing;
    const task = operation();
    run.terminalTask = task;
    void task.then(
      () => {
        if (run.terminalTask === task) run.terminalTask = null;
      },
      () => {
        if (run.terminalTask === task) run.terminalTask = null;
      },
    );
    return task;
  }

  private async resumeTerminalOutcome(run: ActiveRun): Promise<void> {
    const activeTask = run.terminalTask;
    if (activeTask) await activeTask.catch(() => {});
    if (!this.isActiveRun(run) || run.stopped || run.terminalTask) return;
    const outcome = run.terminalOutcome;
    if (!outcome) return;
    if (outcome.kind === 'completed') {
      await this.completeRun(run, outcome.response);
      return;
    }
    await this.failRun(run, outcome.error);
  }

  private canFinalizeRun(run: ActiveRun): boolean {
    return this.isActiveRun(run) && !run.stopped;
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

  private async clearTerminalInteraction(run: ActiveRun): Promise<void> {
    const repos = await this.deps.reposFactory();
    await repos.activeInteractions?.deleteByThread(run.threadId);
  }

  private async persistInputMessage(
    input: SubmitConversationRun,
    message: ChatMessage,
  ): Promise<void> {
    if (input.persistMessage) {
      await input.persistMessage(message);
      return;
    }
    await this.deps.persistMessage({
      message,
      companyId: input.companyId,
      projectId: input.projectId,
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
      agentName: 'pi-agent',
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
        options: [
          ...(approval.method === 'confirm'
            ? [
                { id: 'reject', label: 'Reject' },
                { id: 'approve', label: 'Approve', recommended: true },
              ]
            : (approval.options ?? []).map((option) => ({ id: option, label: option }))),
        ],
        allowFreeformResponse: approval.method === 'input' || approval.method === 'editor',
        createdAt: approval.createdAt,
      }),
      payload_json: JSON.stringify({
        source: 'pi-ui-request',
        attemptId: approval.attemptId,
        hostRequestId: approval.hostRequestId,
        uiRequestId: approval.uiRequestId,
        method: approval.method,
        title: approval.title,
        message: approval.message,
        options: approval.options,
        placeholder: approval.placeholder,
        prefill: approval.prefill,
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
        approval.method === 'select' && typeof response.value === 'string'
          ? response.value
          : response.confirmed === true
            ? 'approve'
            : response.confirmed === false
              ? 'reject'
              : null,
      freeform_response:
        (approval.method === 'input' || approval.method === 'editor') &&
        typeof response.value === 'string'
          ? response.value
          : null,
      request_json: JSON.stringify(approval),
      response_json: JSON.stringify(response),
      payload_json: JSON.stringify({ source: 'pi-ui-request', attemptId: run.attemptId }),
      created_at: new Date(approval.createdAt).toISOString(),
      resolved_at: now,
    });
    await repos.activeInteractions?.deleteByThread(run.threadId);
    // Pi may emit the next FIFO prompt as soon as it consumes this answer. If
    // that newer interaction won the thread row before our delete completed,
    // restore it from the authoritative live snapshot instead of orphaning Pi.
    const nextApproval = this.currentSnapshot(run.threadId).approval;
    if (
      nextApproval?.state === 'live' &&
      (nextApproval.attemptId !== approval.attemptId ||
        nextApproval.uiRequestId !== approval.uiRequestId)
    ) {
      await this.upsertActiveInteraction(run, nextApproval);
    }
  }

  private cleanupRun(run: ActiveRun): void {
    for (const unsubscribe of run.unsubscribers.splice(0)) unsubscribe();
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
      userMessages: run.userMessages.map((message) => ({ ...message })),
      priorMessages: run.priorMessages.map((message) => ({ ...message })),
      promptText: run.promptText ?? run.input.text,
      images: [...run.images],
      queuedTurns: run.queuedTurns.map((turn) => ({
        ...turn,
        images: [...turn.images],
        delivering: false,
        delivered: turn.consumed,
        failed: false,
        consumed: turn.consumed,
      })),
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
    rehydrateTurn: deps.rehydrateTurn ?? rehydratePersistedChatTurn,
    persistMessage: deps.persistMessage ?? persistChatMessage,
    loadMessages: deps.loadMessages ?? loadPersistedChatMessages,
    appendEvent: deps.appendEvent ?? appendThreadMessageEvent,
    now: deps.now ?? (() => Date.now()),
    randomUUID: deps.randomUUID ?? (() => crypto.randomUUID()),
  });
}

export const conversationRunController = createConversationRunController();
