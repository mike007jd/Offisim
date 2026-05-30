import type { BaseMessage } from '@langchain/core/messages';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import {
  executionAborted,
  executionResumed,
  graphNodeExited,
  workspaceStalenessDetected,
} from '../events/event-factories.js';
import { parseCompactBaseline } from '../graph/state.js';
import type {
  MeetingInterrupt,
  MeetingInterruptType,
  OffisimGraphState,
  RunScope,
} from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { generateId } from '../utils/generate-id.js';
import { NodeSummaryService } from './node-summary-service.js';
import type {
  WorkspaceStalenessResult,
  WorkspaceStalenessService,
} from './workspace-staleness-service.js';

/**
 * Thin orchestration wrapper around `graph.stream()`.
 *
 * Replaces direct `graph.invoke()` calls with streaming execution that
 * emits `graph.node.exited` events via EventBus as each node completes.
 *
 * The compiled graph is passed in so OrchestrationService remains
 * independent of graph construction (important for testability).
 *
 * Phase 3 may add `executeStream()` returning `AsyncIterable<GraphStreamEvent>`
 * for direct UI consumption.
 */
/** Max queued execute() calls per thread before rejecting. */
const MAX_QUEUE_DEPTH = 3;

/**
 * LangGraph super-step budget for a full graph run.
 *
 * LangGraph's default is 25, which a legitimate multi-step plan or a 10-turn
 * meeting blows past — producing a spurious `GraphRecursionError` mid-run. We
 * raise it to a value that covers the worst-case *legitimate* path while still
 * acting as a real stuck-loop guard (NOT an absurd number that hides genuine
 * cycles).
 *
 * Worst-case legitimate plan/dispatch path (the dominant case):
 *   - framing nodes (boss → manager → pm_planner → boss_summary)         ≈ 4
 *   - per plan step batch: step_dispatcher(1) + employee fan-out
 *     (one self-loop per pending assignment, ~8) + handoffs
 *     (MAX_HANDOFF_COUNT=3) + step_advance(1)                            ≈ 13
 *   - over a generous ~24-step plan                                      ≈ 312
 *   - global replans (MAX_REPLAN_COUNT=3, ~2 super-steps each)           ≈ 6
 *   - re-dispatch cycles for newly-unblocked dependent steps             (margin)
 *
 * Worst-case meeting path: meeting_start + MAX_TURNS(10) participant turns +
 * up to 10 injects + resume/end + boss_summary ≈ 25 — well under this budget.
 *
 * 400 leaves headroom over the plan estimate while staying far below a value
 * that would let a genuine infinite cycle run unbounded.
 */
const GRAPH_RECURSION_LIMIT = 400;

function normalizeRetryableErrorMessage(message: string): string {
  return message.replace(/^\[Error Handler\]\s*/, '').trim();
}

function extractErrorHandlerMessage(messages: BaseMessage[] | undefined): string | null {
  if (!Array.isArray(messages)) return null;
  const latestRetryableMessage = [...messages]
    .reverse()
    .find(
      (message) =>
        message?._getType() === 'ai' &&
        typeof message.content === 'string' &&
        message.content.startsWith('[Error Handler]'),
    );
  return latestRetryableMessage && typeof latestRetryableMessage.content === 'string'
    ? latestRetryableMessage.content
    : null;
}

function isRecursionLimitError(error: Error): boolean {
  const text = `${error.name}: ${error.message}`.toLowerCase();
  return text.includes('recursion') && text.includes('limit');
}

export interface SerializedExecutionState {
  threadId: string;
  companyId: string;
  checkpointId: string | null;
  entryMode: OffisimGraphState['entryMode'];
  currentStepIndex: number;
  completedStepIndices: number[];
  dispatchedStepIndices: number[];
  pendingAssignmentsCount: number;
  messageCount: number;
  meetingId: string | null;
  routeDecision: OffisimGraphState['routeDecision'];
  hasTaskPlan: boolean;
  taskPlanSummary: string | null;
}

export class OrchestrationService {
  /**
   * Per-thread execution lock.
   * Instance-level (not static) — each OrchestrationService owns its locks,
   * preventing cross-company leakage when multiple services exist.
   */
  private readonly threadLocks = new Map<string, Promise<unknown>>();
  private readonly threadQueueDepth = new Map<string, number>();

  /**
   * Per-thread AbortControllers — prep for Task 7 abort/stop support.
   * Keyed by threadId. abortExecution(threadId) signals the running call.
   *
   * `runScope` is captured alongside the controller so `abortExecution` can
   * stamp the aborted event with the chat run scope of the in-flight execution.
   */
  private readonly currentAborts = new Map<
    string,
    { controller: AbortController; runScope: RunScope | null }
  >();

  /**
   * Cache of thread ids whose `graph_threads` row is known to exist this process
   * lifetime. `ensureExecutionThread` short-circuits on a hit so a long-lived
   * chat does not pay a `repos.threads.findById` roundtrip per turn.
   */
  private readonly ensuredThreads = new Set<string>();

  private readonly workspaceStalenessService: WorkspaceStalenessService | null;
  private readonly checkpointSaver: Pick<BaseCheckpointSaver, 'getTuple'> | null;

  constructor(
    private graph: {
      stream: (
        input: Record<string, unknown>,
        config: Record<string, unknown>,
      ) => Promise<AsyncIterable<Record<string, unknown>>>;
    },
    private runtimeCtx: RuntimeContext,
    options?: {
      workspaceStalenessService?: WorkspaceStalenessService | null;
      checkpointSaver?: Pick<BaseCheckpointSaver, 'getTuple'> | null;
    },
  ) {
    this.workspaceStalenessService = options?.workspaceStalenessService ?? null;
    this.checkpointSaver = options?.checkpointSaver ?? null;
  }

  /**
   * Abort the currently-running execution on the given thread.
   * No-op if no execution is in progress for that thread. Emits
   * `execution.aborted` via EventBus so scene orchestrator + other
   * consumers can return to idle.
   */
  abortExecution(threadId: string): void {
    const entry = this.currentAborts.get(threadId);
    if (!entry) return;
    entry.controller.abort();
    this.runtimeCtx.eventBus.emit(
      executionAborted(this.runtimeCtx.companyId, threadId, 'user', entry.runScope),
    );
  }

  /**
   * Send a meeting interrupt command.
   * This sets the interrupt on the RuntimeContext's meetingInterruptBox,
   * which will be picked up by the participantTurnNode after its current
   * LLM call completes. The meetingTurnCheck then routes accordingly.
   *
   * - 'pause': pause the meeting, preserving state for later resume
   * - 'end': end the meeting immediately
   * - 'inject': inject a boss comment into the meeting transcript
   * - null: clear any pending interrupt for this thread (used for resume)
   *
   * Scoped by threadId so a command for one meeting can't be consumed by a
   * concurrent meeting on another thread.
   */
  interruptMeeting(threadId: string, type: MeetingInterruptType, bossComment?: string): void {
    const box = this.runtimeCtx.meetingInterruptBox;
    if (type) {
      box.pending.set(threadId, { type, bossComment });
    } else {
      box.pending.delete(threadId);
    }
  }

  /** Whether a meeting interrupt is pending for the given thread. */
  hasPendingInterrupt(threadId: string): boolean {
    return this.runtimeCtx.meetingInterruptBox.pending.has(threadId);
  }

  /**
   * Resume a paused meeting.
   * Re-invokes the graph with the paused meeting's ID and a resume signal.
   */
  async resumeMeeting(
    meetingId: string,
    messages: BaseMessage[],
    threadId?: string,
  ): Promise<OffisimGraphState> {
    return this.execute({
      entryMode: 'meeting',
      messages,
      meetingId,
      meetingInterrupt: { type: null }, // null type = resume
      threadId,
    });
  }

  /**
   * End a paused meeting.
   * Re-invokes the graph with the paused meeting's ID and an end signal.
   */
  async endPausedMeeting(
    meetingId: string,
    messages: BaseMessage[],
    threadId?: string,
  ): Promise<OffisimGraphState> {
    return this.execute({
      entryMode: 'meeting',
      messages,
      meetingId,
      meetingInterrupt: { type: 'end' },
      threadId,
    });
  }

  async getLatestCheckpointState(threadId: string): Promise<OffisimGraphState | null> {
    const tuple = await this.getLatestCheckpointTuple(threadId);
    if (!tuple) return null;
    return tuple.checkpoint.channel_values as OffisimGraphState;
  }

  async resumePlan(
    threadId: string,
    opts?: {
      fromStepIndex?: number;
      updatedPlan?: OffisimGraphState['taskPlan'];
      skipCompletedSteps?: boolean;
    },
  ): Promise<OffisimGraphState> {
    const restored = await this.getLatestCheckpointState(threadId);
    if (!restored) {
      throw new Error(`No checkpoint state found for thread "${threadId}".`);
    }

    const thread = this.runtimeCtx.repos?.threads
      ? await this.runtimeCtx.repos.threads.findById(threadId)
      : null;
    const activeCompactBaseline = parseCompactBaseline(thread?.compact_baseline_json ?? null);
    const resumeState = this.buildResumeState(
      activeCompactBaseline ? { ...restored, compactBaseline: activeCompactBaseline } : restored,
      {
        threadId,
        updatedPlan: opts?.updatedPlan,
        fromStepIndex: opts?.fromStepIndex,
        skipCompletedSteps: opts?.skipCompletedSteps,
      },
    );

    if (typeof opts?.fromStepIndex === 'number') {
      await this.runtimeCtx.fileHistoryService?.restoreThreadToStep(threadId, opts.fromStepIndex);
    }

    this.runtimeCtx.eventBus.emit(
      executionResumed(this.runtimeCtx.companyId, threadId, {
        threadId,
        currentStepIndex: resumeState.currentStepIndex ?? 0,
        completedStepCount: resumeState.completedStepIndices?.length ?? 0,
        rewoundFromStepIndex: opts?.fromStepIndex ?? null,
        skippedCompletedSteps: opts?.skipCompletedSteps ?? false,
        updatedPlan: opts?.updatedPlan != null,
      }),
    );

    return this.executeState(resumeState, threadId);
  }

  async serializeExecutionState(threadId: string): Promise<SerializedExecutionState | null> {
    const tuple = await this.getLatestCheckpointTuple(threadId);
    if (!tuple) return null;

    const state = tuple.checkpoint.channel_values as Partial<OffisimGraphState>;
    return {
      threadId,
      companyId: state.companyId ?? this.runtimeCtx.companyId,
      checkpointId:
        typeof tuple.config?.configurable?.checkpoint_id === 'string'
          ? tuple.config.configurable.checkpoint_id
          : null,
      entryMode: (state.entryMode ?? 'background_sync') as OffisimGraphState['entryMode'],
      currentStepIndex: state.currentStepIndex ?? 0,
      completedStepIndices: [...(state.completedStepIndices ?? [])],
      dispatchedStepIndices: [...(state.dispatchedStepIndices ?? [])],
      pendingAssignmentsCount: state.pendingAssignments?.length ?? 0,
      messageCount: state.messages?.length ?? 0,
      meetingId: state.meetingId ?? null,
      routeDecision: state.routeDecision ?? null,
      hasTaskPlan: Boolean(state.taskPlan),
      taskPlanSummary: state.taskPlan?.summary ?? null,
    };
  }

  async execute(input: {
    entryMode: OffisimGraphState['entryMode'];
    messages: BaseMessage[];
    targetEmployeeId?: string | null;
    meetingId?: string | null;
    meetingInterrupt?: MeetingInterrupt | null;
    /** Override runtimeCtx.threadId — useful when service is long-lived across multiple threads. */
    threadId?: string;
    /**
     * Active project id; written into `graph_threads.project_id` on first use
     * and into `OffisimGraphState.projectId`. Required by the Tauri
     * builtin-tool sandbox (`project_id → workspace_root`); also threaded into
     * `RunScope`-derived events so deliverables / activity can scope by
     * project. `null` for non-chat invocations (background_sync, install_flow).
     */
    projectId?: string | null;
    /**
     * Per-execution chat run scope. Set by `ChatPanel.handleSend` for user-initiated
     * chat turns. Background invocations (`background_sync`, `pm_heartbeat`) pass
     * `undefined` so chat-affecting events emit unscoped and the UI listener drops them.
     */
    runScope?: RunScope;
  }): Promise<OffisimGraphState> {
    const threadId = input.threadId ?? this.runtimeCtx.threadId;

    // Reject if queue is already too deep (prevents unbounded wait times)
    const depth = this.threadQueueDepth.get(threadId) ?? 0;
    if (depth >= MAX_QUEUE_DEPTH) {
      throw new Error(
        `Thread "${threadId}" has ${depth} queued requests — rejecting to prevent unbounded wait. Try again later.`,
      );
    }
    this.threadQueueDepth.set(threadId, depth + 1);

    // Create AbortController for this execution (registered after acquiring the lock
    // so abortExecution() always targets the *running* request, not a queued one)
    const abort = new AbortController();

    // Serialize concurrent calls on the same threadId
    const prev = this.threadLocks.get(threadId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    this.threadLocks.set(threadId, gate);
    try {
      await prev;
      this.currentAborts.set(threadId, {
        controller: abort,
        runScope: input.runScope ?? null,
      });
      return await this._executeInner({ ...input, threadId, signal: abort.signal });
    } finally {
      release?.();
      this.currentAborts.delete(threadId);
      const remaining = (this.threadQueueDepth.get(threadId) ?? 1) - 1;
      if (remaining <= 0) {
        this.threadQueueDepth.delete(threadId);
      } else {
        this.threadQueueDepth.set(threadId, remaining);
      }
      if (this.threadLocks.get(threadId) === gate) {
        this.threadLocks.delete(threadId);
      }
    }
  }

  private async executeState(
    state: Partial<OffisimGraphState>,
    threadId: string,
  ): Promise<OffisimGraphState> {
    const depth = this.threadQueueDepth.get(threadId) ?? 0;
    if (depth >= MAX_QUEUE_DEPTH) {
      throw new Error(
        `Thread "${threadId}" has ${depth} queued requests — rejecting to prevent unbounded wait. Try again later.`,
      );
    }
    this.threadQueueDepth.set(threadId, depth + 1);

    // Create AbortController for this execution (registered after acquiring the lock
    // so abortExecution() always targets the *running* request, not a queued one)
    const abort = new AbortController();

    const prev = this.threadLocks.get(threadId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    this.threadLocks.set(threadId, gate);
    try {
      await prev;
      this.currentAborts.set(threadId, { controller: abort, runScope: null });
      return await this._executeStateInner(state, threadId, abort.signal, null);
    } finally {
      release?.();
      this.currentAborts.delete(threadId);
      const remaining = (this.threadQueueDepth.get(threadId) ?? 1) - 1;
      if (remaining <= 0) {
        this.threadQueueDepth.delete(threadId);
      } else {
        this.threadQueueDepth.set(threadId, remaining);
      }
      if (this.threadLocks.get(threadId) === gate) {
        this.threadLocks.delete(threadId);
      }
    }
  }

  private async _executeInner(input: {
    entryMode: OffisimGraphState['entryMode'];
    messages: BaseMessage[];
    targetEmployeeId?: string | null;
    meetingId?: string | null;
    meetingInterrupt?: MeetingInterrupt | null;
    threadId: string;
    projectId?: string | null;
    signal: AbortSignal;
    runScope?: RunScope;
  }): Promise<OffisimGraphState> {
    const threadId = input.threadId;
    const projectId = input.projectId ?? null;
    await this.ensureExecutionThread(threadId, input.entryMode, projectId);
    const interactionMode = this.runtimeCtx.interactionService?.getMode();
    const fullInput: Partial<OffisimGraphState> = {
      threadId,
      companyId: this.runtimeCtx.companyId,
      entryMode: input.entryMode,
      messages: input.messages,
      targetEmployeeId: input.targetEmployeeId ?? null,
      meetingId: input.meetingId ?? null,
      meetingInterrupt: input.meetingInterrupt ?? null,
      ...(projectId ? { projectId } : {}),
      ...(input.runScope?.threadId ? { chatThreadId: input.runScope.threadId } : {}),
      ...(interactionMode ? { interactionMode } : {}),
    };
    return this._executeStateInner(fullInput, threadId, input.signal, input.runScope ?? null);
  }

  private async ensureExecutionThread(
    threadId: string,
    entryMode: OffisimGraphState['entryMode'],
    projectId: string | null,
  ): Promise<void> {
    if (this.ensuredThreads.has(threadId)) return;
    const existing = await this.runtimeCtx.repos.threads.findById(threadId);
    if (existing) {
      // Backfill project_id when an older row (or background_sync row) is
      // first hit by a chat turn — the workspace_root resolver in
      // `apps/desktop/renderer/src/lib/tauri-runtime.ts` only follows graph_threads.project_id.
      if (projectId && !existing.project_id) {
        await this.runtimeCtx.repos.threads.updateProject(threadId, projectId);
      }
      this.ensuredThreads.add(threadId);
      return;
    }
    await this.runtimeCtx.repos.threads.create({
      thread_id: threadId,
      company_id: this.runtimeCtx.companyId,
      entry_mode: entryMode,
      root_task_id: null,
      status: 'queued',
      project_id: projectId,
    });
    this.ensuredThreads.add(threadId);
  }

  private async _executeStateInner(
    state: Partial<OffisimGraphState>,
    threadId: string,
    signal: AbortSignal,
    runScope: RunScope | null,
  ): Promise<OffisimGraphState> {
    await this.checkWorkspaceStaleness(
      (state.entryMode ?? 'boss_chat') as OffisimGraphState['entryMode'],
      threadId,
    );

    const executionRuntimeCtx = this.runtimeContextForThread(threadId);
    const config = {
      configurable: {
        thread_id: threadId,
        runtimeCtx: executionRuntimeCtx,
        signal,
        ...(runScope ? { runScope } : {}),
      },
    };

    let finalState: Partial<OffisimGraphState> = { ...state };
    let lastNodeName: string | undefined;
    let errorHandlerMessage: string | null = null;

    const stream = await this.graph.stream(state as Record<string, unknown>, {
      ...config,
      streamMode: 'updates' as const,
      recursionLimit: GRAPH_RECURSION_LIMIT,
    });
    const repos = this.runtimeCtx.repos;
    const nodeSummaryRepo = repos?.nodeSummaries;
    const llmCallRepo = repos?.llmCalls;
    const mcpAuditRepo = repos?.mcpAudit;
    const nodeSummaryService = nodeSummaryRepo ? new NodeSummaryService(nodeSummaryRepo) : null;
    let llmCallCount = llmCallRepo ? (await llmCallRepo.findByThread(threadId)).length : 0;
    let mcpAuditCount = mcpAuditRepo ? (await mcpAuditRepo.listByThread(threadId)).length : 0;
    const nodeEnteredAt = new Map<string, number>();
    let stepDispatcherEntryCount = 0;
    const unsubscribeNodeEntered = this.runtimeCtx.eventBus.on('graph.node.entered', (event) => {
      if (event.threadId !== threadId) return;
      if (typeof event.payload?.nodeName === 'string') {
        nodeEnteredAt.set(event.payload.nodeName, event.timestamp);
        if (event.payload.nodeName === 'step_dispatcher') {
          stepDispatcherEntryCount += 1;
        }
      }
    });

    try {
      for await (const update of stream) {
        if (signal.aborted) break;
        for (const [nodeName, nodeOutput] of Object.entries(update)) {
          lastNodeName = nodeName;
          const previousState = finalState as Partial<OffisimGraphState>;
          const delta = nodeOutput as Partial<OffisimGraphState>;
          if (nodeName === 'error_handler') {
            errorHandlerMessage = extractErrorHandlerMessage(delta.messages) ?? errorHandlerMessage;
          }
          const nextState = delta.messages
            ? {
                ...previousState,
                ...delta,
                messages: [...(previousState.messages ?? []), ...delta.messages],
              }
            : { ...previousState, ...delta };
          finalState = nextState;

          // D/C3 deferred: this re-fetches the entire thread's llm_calls /
          // mcp_audit history on every node exit (O(nodes × calls)). The
          // correct fix is for each node to emit its own call IDs into
          // nodeSummaryService so we never re-scan the whole table — that
          // requires reworking the nodeSummaryService contract and every
          // node entry, which is its own follow-up change.
          const llmCalls = llmCallRepo ? await llmCallRepo.findByThread(threadId) : [];
          const newLlmCalls = llmCalls.slice(llmCallCount);
          llmCallCount = llmCalls.length;

          const mcpAudits = mcpAuditRepo ? await mcpAuditRepo.listByThread(threadId) : [];
          const newMcpAudits = mcpAudits.slice(mcpAuditCount);
          mcpAuditCount = mcpAudits.length;

          const enteredAt = nodeEnteredAt.get(nodeName) ?? Date.now();
          const durationMs = Math.max(0, Date.now() - enteredAt);

          if (nodeSummaryService) {
            await nodeSummaryService.recordNodeSummary({
              threadId,
              companyId: this.runtimeCtx.companyId,
              nodeName,
              preState: previousState,
              postState: nextState,
              nodeOutput: delta,
              llmCalls: newLlmCalls,
              mcpAudits: newMcpAudits,
              durationMs,
            });
          }

          this.runtimeCtx.eventBus.emit(
            graphNodeExited(this.runtimeCtx.companyId, threadId, nodeName),
          );
        }
      }
    } catch (error) {
      unsubscribeNodeEntered();
      if (error instanceof DOMException && error.name === 'AbortError') {
        return finalState as OffisimGraphState;
      }
      const original = error instanceof Error ? error : new Error(String(error));
      if (isRecursionLimitError(original)) {
        await this.emitDispatcherRecursionLimitDiagnostic(
          threadId,
          finalState as Partial<OffisimGraphState>,
          stepDispatcherEntryCount,
        );
      }
      const contextMsg = lastNodeName
        ? `Graph execution failed in node "${lastNodeName}": ${original.message}`
        : `Graph execution failed: ${original.message}`;
      throw new Error(contextMsg, { cause: original });
    }

    unsubscribeNodeEntered();

    await this.workspaceStalenessService?.saveThreadBaseline(threadId, this.runtimeCtx.companyId);

    if (errorHandlerMessage) {
      throw new Error(normalizeRetryableErrorMessage(errorHandlerMessage));
    }

    return finalState as OffisimGraphState;
  }

  private runtimeContextForThread(threadId: string): RuntimeContext {
    if (threadId === this.runtimeCtx.threadId) return this.runtimeCtx;
    return Object.freeze({
      ...this.runtimeCtx,
      threadId,
    });
  }

  private async getLatestCheckpointTuple(threadId: string) {
    if (!this.checkpointSaver) {
      throw new Error('Checkpoint saver is not configured for this orchestration runtime.');
    }
    return this.checkpointSaver.getTuple({
      configurable: { thread_id: threadId },
    });
  }

  private buildResumeState(
    restored: OffisimGraphState,
    opts: {
      threadId: string;
      updatedPlan?: OffisimGraphState['taskPlan'];
      fromStepIndex?: number;
      skipCompletedSteps?: boolean;
    },
  ): Partial<OffisimGraphState> {
    const plan = opts.updatedPlan ?? restored.taskPlan ?? null;
    const completedStepIndices = [...(restored.completedStepIndices ?? [])];
    const dispatchedStepIndices = [...(restored.dispatchedStepIndices ?? [])];
    const stepResults = [...(restored.stepResults ?? [])];
    const rewindStepIndex = typeof opts.fromStepIndex === 'number' ? opts.fromStepIndex : null;

    let currentStepIndex = restored.currentStepIndex ?? 0;
    if (rewindStepIndex !== null) {
      currentStepIndex = rewindStepIndex;
    } else if (opts.skipCompletedSteps && plan) {
      const completed = new Set(completedStepIndices);
      currentStepIndex =
        plan.steps.map((step) => step.stepIndex).find((index) => !completed.has(index)) ??
        currentStepIndex;
    }

    const prunedCompleted =
      rewindStepIndex !== null
        ? completedStepIndices.filter((index) => index < rewindStepIndex)
        : completedStepIndices;
    const prunedDispatched =
      rewindStepIndex !== null
        ? dispatchedStepIndices.filter((index) => index < rewindStepIndex)
        : dispatchedStepIndices;
    const prunedResults =
      rewindStepIndex !== null
        ? stepResults.filter((result) => result.stepIndex < rewindStepIndex)
        : stepResults;

    return {
      ...restored,
      threadId: opts.threadId,
      companyId: restored.companyId ?? this.runtimeCtx.companyId,
      entryMode: 'background_sync',
      taskPlan: plan,
      currentStepIndex,
      completedStepIndices: prunedCompleted,
      dispatchedStepIndices: prunedDispatched,
      stepResults: prunedResults,
      pendingAssignments: [],
      currentTaskRunId: null,
      currentEmployeeId: null,
      currentStepOutputs: [],
      routeDecision: null,
      interruptReason: null,
      meetingInterrupt: null,
      completed: false,
      handoffCount: 0,
      messages: restored.messages ?? [],
    };
  }

  private async emitDispatcherRecursionLimitDiagnostic(
    threadId: string,
    state: Partial<OffisimGraphState>,
    recursionDepth: number,
  ): Promise<void> {
    const plan = state.taskPlan ?? null;
    const completedSet = new Set(state.completedStepIndices ?? []);
    const payload = {
      planId: plan?.planId ?? null,
      stepCount: plan?.steps.length ?? 0,
      completedSteps: [...completedSet],
      pendingSteps:
        plan?.steps
          .map((step) => step.stepIndex)
          .filter((stepIndex) => !completedSet.has(stepIndex)) ?? [],
      recursionDepth,
    };
    this.runtimeCtx.eventBus.emit({
      type: 'plan.dispatcher.recursion_limit',
      entityId: plan?.planId ?? threadId,
      entityType: 'runtime',
      companyId: this.runtimeCtx.companyId,
      threadId,
      timestamp: Date.now(),
      payload,
    });
    await this.runtimeCtx.repos?.events?.insert({
      event_id: generateId('evt'),
      company_id: this.runtimeCtx.companyId,
      thread_id: threadId,
      event_type: 'plan.dispatcher.recursion_limit',
      severity: 'error',
      payload_json: JSON.stringify(payload),
      created_at: new Date().toISOString(),
    });
  }

  private async checkWorkspaceStaleness(
    entryMode: OffisimGraphState['entryMode'],
    threadId: string,
  ): Promise<void> {
    if (entryMode !== 'background_sync' || !this.workspaceStalenessService) return;

    const result = await this.workspaceStalenessService.checkThread(
      threadId,
      this.runtimeCtx.companyId,
    );
    if (result.status === 'block') {
      await this.recordWorkspaceStaleness(threadId, result, 'error');
      throw new Error(
        `Cannot resume thread "${threadId}" because the workspace changed (${result.reason}).`,
      );
    }
    if (result.status === 'warn') {
      await this.recordWorkspaceStaleness(threadId, result, 'warn');
    }
  }

  private async recordWorkspaceStaleness(
    threadId: string,
    result: WorkspaceStalenessResult,
    severity: 'warn' | 'error',
  ): Promise<void> {
    await this.runtimeCtx.repos?.events?.insert({
      event_id: generateId('evt'),
      company_id: this.runtimeCtx.companyId,
      thread_id: threadId,
      event_type: 'workspace.staleness.detected',
      severity,
      payload_json: JSON.stringify(result),
      created_at: new Date().toISOString(),
    });
    this.runtimeCtx.eventBus.emit(
      workspaceStalenessDetected(this.runtimeCtx.companyId, threadId, {
        status: result.status === 'clean' ? 'warn' : result.status,
        reason: result.reason,
        baselineGitHead: result.baseline?.gitHead ?? null,
        currentGitHead: result.current?.gitHead ?? null,
        baselineDirty: result.baseline?.dirty ?? null,
        currentDirty: result.current?.dirty ?? null,
        currentStatusLines: result.current?.statusLines ?? null,
      }),
    );
  }
}
