import { persistChatMessage } from '@/data/chat-message-events.js';
import { appendThreadMessageEvent } from '@/data/thread-message-events.js';
import type { ChatMessage, ChatToolCall, RunError, StagedAttachment } from '@/data/types.js';
import {
  AGENT_UI_REQUEST_EVENT,
  type AgentUiRequestPayload,
  type DesktopAgentRuntime,
  getDesktopAgentRuntime,
} from '@/runtime/desktop-agent-runtime.js';
import { getRepos, runtimeEventBus } from '@/runtime/repos.js';
import type { EventBus, RuntimeRepositories } from '@offisim/core/browser';
import type {
  AgentRunEvent,
  AgentRunFinishedPayload,
  AgentRunStartedPayload,
  RuntimeEvent,
  ToolExecutionTelemetryPayload,
} from '@offisim/shared-types';
import {
  buildRunError,
  displayAttachmentsFromStaged,
  materializeChatTurn,
  newDraftId,
  upsertChatToolCall,
} from './desktop-chat-runtime.js';

const CHECKPOINT_INTERVAL_MS = 3_000;
const ACTIVE_PHASES = new Set<ConversationRunPhase>([
  'preparing',
  'running',
  'awaiting-approval',
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
}

export interface PendingApproval {
  threadId: string;
  attemptId: string;
  hostRequestId: string;
  uiRequestId: string;
  method: string;
  title: string;
  message?: string;
  state: 'live' | 'stale' | 'unsupported';
  createdAt: number;
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

export class ConversationRunController {
  private readonly snapshots = new Map<string, ConversationRunSnapshot>();
  private readonly idleSnapshots = new Map<string, ConversationRunSnapshot>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly retryRecords = new Map<string, RetryRecord>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly globalListeners = new Set<() => void>();
  private globalSnapshot: ConversationRunsSnapshot | null = null;
  private hydrationByCompany = new Set<string>();

  constructor(private readonly deps: ConversationRunControllerDeps) {}

  async submit(input: SubmitConversationRun): Promise<ConversationRunHandle> {
    const trimmed = input.text.trim();
    if (!trimmed) throw new Error('Cannot submit an empty conversation run.');
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
      status: 'complete',
    };
    const run = this.beginRun({ ...input, text: trimmed }, attemptId, userMessage, null);
    void this.runAttempt(run);
    return { threadId: input.threadId, attemptId, userMessageId: userMessage.id };
  }

  async retry(threadId: string, attemptId: string): Promise<ConversationRunHandle> {
    if (this.activeRuns.has(threadId)) throw new ConversationRunAlreadyActiveError(threadId);
    const record = this.retryRecords.get(attemptId);
    if (!record || record.input.threadId !== threadId) throw new Error('Cannot retry this run.');

    const nextAttemptId = `attempt-${this.deps.randomUUID()}`;
    const run = this.beginRun(record.input, nextAttemptId, record.userMessage, record.promptText);
    void this.executeAttempt(run);
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
    const run = this.activeRuns.get(threadId);
    if (!run) return;
    run.stopped = true;
    this.cleanupRun(run);
    this.activeRuns.delete(threadId);
    if (run.assistantMessage) {
      const interrupted = {
        ...stripToolCalls(run.assistantMessage),
        status: 'interrupted' as const,
      };
      run.assistantMessage = interrupted;
      void this.persistRunMessage(run, interrupted).catch((err: unknown) => {
        console.warn('[conversation-run] failed to persist interrupted snapshot', {
          threadId,
          err,
        });
      });
    }
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
    await this.resolveActiveInteraction(run, approval, input.cancelled ? 'cancelled' : 'resolved', {
      confirmed: input.confirmed,
      value: input.value,
      cancelled: input.cancelled,
    });
    this.setSnapshot(input.threadId, {
      ...snapshot,
      phase: 'running',
      approval: null,
    });
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
    const repos = await this.deps.reposFactory();
    const rows = (await repos.activeInteractions?.findByCompany(companyId)) ?? [];
    for (const row of rows) {
      let payload: Partial<PendingApproval> & { source?: string } = {};
      try {
        payload = JSON.parse(row.payload_json ?? '{}');
      } catch {
        payload = {};
      }
      if (payload.source !== 'pi-ui-request') continue;
      const approval: PendingApproval = {
        threadId: row.thread_id,
        attemptId: String(payload.attemptId ?? row.interaction_id),
        hostRequestId: String(payload.hostRequestId ?? ''),
        uiRequestId: String(payload.uiRequestId ?? row.interaction_id),
        method: String(payload.method ?? 'confirm'),
        title: String(payload.title ?? 'Approval needed'),
        message: typeof payload.message === 'string' ? payload.message : undefined,
        state: 'stale',
        createdAt: Date.parse(row.created_at) || this.deps.now(),
      };
      this.patchSnapshot(row.thread_id, {
        companyId,
        phase: 'awaiting-approval',
        attemptId: approval.attemptId,
        approval,
      });
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
      this.patchSnapshot(run.threadId, { liveMessages: [run.userMessage] });
      await this.persistRunMessage(run, run.userMessage);
      this.saveRetryRecord(run);
      await this.executeAttempt(run);
    } catch (error) {
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
    const offAgentRun = this.deps.eventBus.on('agent.run', (event) => {
      const payload = event.payload as AgentRunEvent;
      if (payload?.rootRunId !== run.attemptId || payload.threadId !== run.threadId) return;
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
      run.delegations = existing
        ? run.delegations.map((d) =>
            d.runId === evt.runId ? { ...d, state, summary: payload.summary } : d,
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
        },
      ].slice(-12);
    } else if (terminal) {
      run.activity = run.activity.map((entry) =>
        entry.id === payload.toolCallId
          ? {
              ...entry,
              state: terminal,
              detail: detailFromTelemetry(payload) ?? entry.detail,
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
    await this.upsertActiveInteraction(run, approval);
    this.patchSnapshot(run.threadId, { phase: 'awaiting-approval', approval });
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
    this.retryRecords.set(run.attemptId, {
      input: run.input,
      userMessage: run.userMessage,
      promptText: run.promptText ?? run.input.text,
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
