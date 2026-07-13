import { persistChatMessage } from '@/data/chat-message-events.js';
import { appendThreadMessageEvent } from '@/data/thread-message-events.js';
import type { ChatMessage, ChatToolCall, RunError, StagedAttachment } from '@/data/types.js';
import {
  AGENT_UI_REQUEST_EVENT,
  type AgentUiRequestPayload,
  type DesktopAgentRuntime,
  type DirectDelegationInput,
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
  // 'live' — the host is awaiting this answer now. 'stale' — restored after a
  // restart (host gone; re-presented, not directly answerable). 'expired' — a
  // restored request older than STALE_APPROVAL_EXPIRY_MS (too old to act on,
  // dismiss only). 'unsupported' — a Pi UI primitive Offisim can't render.
  state: 'live' | 'stale' | 'expired' | 'unsupported';
  createdAt: number;
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
}) => Promise<{ promptText: string; attachments: ChatMessage['attachments'] }>;

interface ConversationRunControllerDeps {
  eventBus: EventBus;
  runtimeFactory: (companyId: string) => Promise<DesktopAgentRuntime>;
  reposFactory: () => Promise<RuntimeRepositories>;
  materializeTurn: MaterializeTurn;
  persistMessage: typeof persistChatMessage;
  appendEvent: typeof appendThreadMessageEvent;
  now: () => number;
  randomUUID: () => string;
}

interface RetryRecord {
  input: SubmitConversationRun;
  userMessage: ChatMessage;
  promptText: string;
  pendingLoopHandoff: PendingLoopHandoff | null;
}

interface PendingLoopHandoff {
  prepared: PreparedLoopExecution;
  messagePersisted: boolean;
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
  activity: RunToolActivity[];
  activityTotal: number;
  delegations: RunDelegation[];
  runtime: DesktopAgentRuntime | null;
  stopped: boolean;
  lastCheckpointAt: number;
  firstCheckpointWritten: boolean;
  messagePersistedNotified: boolean;
  pendingLoopHandoff: PendingLoopHandoff | null;
  unsubscribers: Array<() => void>;
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
  // A1 (by design): in-flight run/snapshot/retry state is intentionally
  // IN-MEMORY and per-session. Only completed messages are persisted (and loaded
  // deterministically — see chat-message-events.ts P1). A reload abandons any
  // in-flight run rather than resuming it; the Messenger surface reflects this
  // live state, it is not a separately-persisted run store. Persisting active-run
  // state was considered and accepted-as-is (no durable consumer needs it).
  private readonly snapshots = new Map<string, ConversationRunSnapshot>();
  private readonly idleSnapshots = new Map<string, ConversationRunSnapshot>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly mutationLocks = new Set<string>();
  private readonly retryRecords = new Map<string, RetryRecord>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly globalListeners = new Set<() => void>();
  private globalSnapshot: ConversationRunsSnapshot | null = null;
  private hydrationByCompany = new Set<string>();

  constructor(private readonly deps: ConversationRunControllerDeps) {}

  async submit(input: SubmitConversationRun): Promise<ConversationRunHandle> {
    const trimmed = input.text.trim();
    if (!trimmed) throw new Error('Cannot submit an empty conversation run.');
    if (this.mutationLocks.has(input.threadId))
      throw new ConversationRunMutationLockedError(input.threadId);
    if (this.activeRuns.has(input.threadId))
      throw new ConversationRunAlreadyActiveError(input.threadId);

    // A restored approval belongs to the abandoned pre-restart turn. It stays
    // dismiss-only and must never attach itself to this fresh run.
    const restoredApproval = this.currentSnapshot(input.threadId).approval;

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
    const run = this.beginRun({ ...input, text: trimmed }, attemptId, userMessage, null);
    if (!restoredApproval || restoredApproval.state === 'live') {
      void this.runAttempt(run);
    } else {
      // Claim the thread synchronously above, then remove the abandoned row
      // before runtime start so cleanup cannot delete a newly persisted live
      // approval. Historical cleanup is best-effort and cannot block the turn.
      void this.deps
        .reposFactory()
        .then((repos) => repos.activeInteractions?.deleteByThread(input.threadId))
        .catch((error: unknown) => {
          console.warn('[conversation-run] stale approval cleanup failed', {
            threadId: input.threadId,
            error,
          });
        })
        .then(() => {
          if (this.isActiveRun(run)) return this.runAttempt(run);
        });
    }
    return { threadId: input.threadId, attemptId, userMessageId: userMessage.id };
  }

  async retry(threadId: string, attemptId: string): Promise<ConversationRunHandle> {
    if (this.mutationLocks.has(threadId)) throw new ConversationRunMutationLockedError(threadId);
    if (this.activeRuns.has(threadId)) throw new ConversationRunAlreadyActiveError(threadId);
    const record = this.retryRecords.get(attemptId);
    if (!record || record.input.threadId !== threadId) throw new Error('Cannot retry this run.');

    const nextAttemptId = `attempt-${this.deps.randomUUID()}`;
    const run = this.beginRun(record.input, nextAttemptId, record.userMessage, record.promptText);
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
  ): ActiveRun {
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
      activity: [],
      activityTotal: 0,
      delegations: [],
      runtime: null,
      stopped: false,
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
    run.stopped = true;
    this.cleanupRun(run);
    const interrupted = run.assistantMessage
      ? {
          ...stripToolCalls(run.assistantMessage),
          status: 'interrupted' as const,
        }
      : null;
    if (interrupted) run.assistantMessage = interrupted;
    this.activeRuns.delete(threadId);
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
    run.runtime?.abort(threadId);
    let persistenceError: unknown = null;
    if (interrupted) {
      try {
        await this.persistRunMessage(run, interrupted);
      } catch (error) {
        persistenceError = error;
      }
    }
    this.saveRetryRecord(run);
    if (persistenceError) throw persistenceError;
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

    if (approval.method !== 'confirm') {
      console.warn('[conversation-run] ignored non-confirm approval answer', input);
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
      const repos = await this.deps.reposFactory();
      const rows = (await repos.activeInteractions?.findByCompany(companyId)) ?? [];
      for (const row of rows) {
        // Hydration is restart recovery for threads the controller has never
        // seen. Any in-memory attempt projection — live or terminal, created
        // before or during this query — is newer authority than the DB row.
        if (this.activeRuns.has(row.thread_id) || this.snapshots.get(row.thread_id)?.attemptId) {
          continue;
        }
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
          state: expired ? 'expired' : 'stale',
          createdAt,
        };
        this.patchSnapshot(row.thread_id, {
          companyId,
          // The owning host disappeared on restart. Keep this as a
          // dismiss-only historical notice, never as a controllable run.
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
      // A presentation phase alone cannot prove that Stop can reach a live
      // runtime. Intersect it with controller ownership.
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
      this.saveRetryRecord(run);
      await this.executeAttempt(run);
    } catch (error) {
      await this.failRun(run, error);
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
      run.runtime = await this.deps.runtimeFactory(run.input.companyId);
      if (!this.isActiveRun(run)) return;
      if (run.stopped) {
        run.runtime.abort(run.threadId);
        return;
      }
      run.unsubscribers = this.subscribeRuntimeEvents(run);
      const response = await run.runtime.execute({
        text: run.promptText ?? run.input.text,
        threadId: run.threadId,
        employeeId: run.input.employeeId,
        projectId: run.input.projectId,
        model: run.input.model,
        permissionMode: run.input.permissionMode,
        thinkingLevel: run.input.thinkingLevel,
        runId: run.attemptId,
        directDelegation: run.input.directDelegation,
      });
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
      };
      run.assistantMessage = assistant;
      await this.persistRunMessage(run, assistant);
      this.cleanupRun(run);
      this.activeRuns.delete(run.threadId);
      this.patchSnapshot(run.threadId, {
        phase: 'completed',
        approval: null,
        liveMessages: [run.userMessage, assistant],
        activity: run.activity,
        activityTotal: run.activityTotal,
      });
    } catch (error) {
      await this.failRun(run, error);
    } finally {
      this.cleanupRun(run);
      if (this.activeRuns.get(run.threadId)?.attemptId === run.attemptId && !run.stopped) {
        this.activeRuns.delete(run.threadId);
      }
    }
  }

  private subscribeRuntimeEvents(run: ActiveRun): Array<() => void> {
    const offStream = this.deps.eventBus.on('llm.stream.chunk', (event) => {
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

    return [offStream, offTool, offUi, offAgentRun];
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
    };
    run.assistantMessage = assistant;
    this.patchSnapshot(run.threadId, (current) => ({
      phase: current.phase === 'awaiting-approval' ? 'awaiting-approval' : 'running',
      liveMessages: [run.userMessage, assistant],
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
      state: request.method === 'confirm' ? 'live' : 'unsupported',
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
    if (request.method !== 'confirm' && run.runtime) {
      await run.runtime.answerUiRequest({
        requestId: request.requestId,
        id: request.id,
        cancelled: true,
      });
      await this.resolveActiveInteraction(run, approval, 'cancelled', {
        cancelled: true,
        unsupported: true,
      });
      this.patchSnapshot(run.threadId, { phase: 'running', approval: null });
    }
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
      await this.persistRunMessage(run, failed).catch((err: unknown) => {
        console.warn('[conversation-run] failed to persist failed snapshot', {
          threadId: run.threadId,
          err,
        });
      });
      messages = [run.userMessage, failed];
    }
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
          { id: 'reject', label: 'Reject' },
          { id: 'approve', label: 'Approve', recommended: true },
        ],
        allowFreeformResponse: false,
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
        response.confirmed === true ? 'approve' : response.confirmed === false ? 'reject' : null,
      freeform_response: typeof response.value === 'string' ? response.value : null,
      request_json: JSON.stringify(approval),
      response_json: JSON.stringify(response),
      payload_json: JSON.stringify({ source: 'pi-ui-request', attemptId: run.attemptId }),
      created_at: new Date(approval.createdAt).toISOString(),
      resolved_at: now,
    });
    await repos.activeInteractions?.deleteByThread(run.threadId);
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
      promptText: run.promptText ?? run.input.text,
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
    appendEvent: deps.appendEvent ?? appendThreadMessageEvent,
    now: deps.now ?? (() => Date.now()),
    randomUUID: deps.randomUUID ?? (() => crypto.randomUUID()),
  });
}

export const conversationRunController = createConversationRunController();
