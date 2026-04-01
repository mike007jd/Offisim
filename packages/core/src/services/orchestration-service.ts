import type { BaseMessage } from '@langchain/core/messages';
import { graphNodeExited } from '../events/event-factories.js';
import type { MeetingInterrupt, MeetingInterruptType, OffisimGraphState } from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { NodeSummaryService } from './node-summary-service.js';
import type { WorkspaceStalenessService } from './workspace-staleness-service.js';

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
   */
  private readonly currentAborts = new Map<string, AbortController>();

  private readonly workspaceStalenessService: WorkspaceStalenessService | null;

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
    },
  ) {
    this.workspaceStalenessService = options?.workspaceStalenessService ?? null;
  }

  /**
   * Abort the currently-running execution on the given thread.
   * No-op if no execution is in progress for that thread.
   */
  abortExecution(threadId: string): void {
    this.currentAborts.get(threadId)?.abort();
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
   * - null: clear any pending interrupt (used for resume)
   */
  interruptMeeting(type: MeetingInterruptType, bossComment?: string): void {
    this.runtimeCtx.meetingInterruptBox.pending = type ? { type, bossComment } : null;
  }

  /** Check if there is a pending meeting interrupt. */
  get hasPendingInterrupt(): boolean {
    return this.runtimeCtx.meetingInterruptBox.pending !== null;
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

  async execute(input: {
    entryMode: OffisimGraphState['entryMode'];
    messages: BaseMessage[];
    targetEmployeeId?: string | null;
    meetingId?: string | null;
    meetingInterrupt?: MeetingInterrupt | null;
    /** Override runtimeCtx.threadId — useful when service is long-lived across multiple threads. */
    threadId?: string;
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

    // Create AbortController for this execution and register it
    const abort = new AbortController();
    this.currentAborts.set(threadId, abort);

    // Serialize concurrent calls on the same threadId
    const prev = this.threadLocks.get(threadId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    this.threadLocks.set(threadId, gate);
    try {
      await prev;
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

  private async _executeInner(input: {
    entryMode: OffisimGraphState['entryMode'];
    messages: BaseMessage[];
    targetEmployeeId?: string | null;
    meetingId?: string | null;
    meetingInterrupt?: MeetingInterrupt | null;
    threadId: string;
    signal: AbortSignal;
  }): Promise<OffisimGraphState> {
    const threadId = input.threadId;
    await this.checkWorkspaceStaleness(input.entryMode, threadId);

    const fullInput = {
      threadId,
      companyId: this.runtimeCtx.companyId,
      entryMode: input.entryMode,
      messages: input.messages,
      targetEmployeeId: input.targetEmployeeId ?? null,
      meetingId: input.meetingId ?? null,
      meetingInterrupt: input.meetingInterrupt ?? null,
    };

    const config = {
      configurable: {
        thread_id: threadId,
        runtimeCtx: this.runtimeCtx,
        signal: input.signal,
      },
    };

    let finalState: Partial<OffisimGraphState> = { ...fullInput };
    let lastNodeName: string | undefined;

    const stream = await this.graph.stream(fullInput, {
      ...config,
      streamMode: 'updates' as const,
    });
    const repos = this.runtimeCtx.repos;
    const nodeSummaryRepo = repos?.nodeSummaries;
    const llmCallRepo = repos?.llmCalls;
    const mcpAuditRepo = repos?.mcpAudit;
    const nodeSummaryService = nodeSummaryRepo ? new NodeSummaryService(nodeSummaryRepo) : null;
    let llmCallCount = llmCallRepo ? (await llmCallRepo.findByThread(threadId)).length : 0;
    let mcpAuditCount = mcpAuditRepo ? (await mcpAuditRepo.listByThread(threadId)).length : 0;
    const nodeEnteredAt = new Map<string, number>();
    const unsubscribeNodeEntered = this.runtimeCtx.eventBus.on('graph.node.entered', (event) => {
      if (event.threadId !== threadId) return;
      if (typeof event.payload?.nodeName === 'string') {
        nodeEnteredAt.set(event.payload.nodeName, event.timestamp);
      }
    });

    try {
      for await (const update of stream) {
        if (input.signal.aborted) break;
        for (const [nodeName, nodeOutput] of Object.entries(update)) {
          lastNodeName = nodeName;
          const previousState = finalState as Partial<OffisimGraphState>;
          const delta = nodeOutput as Partial<OffisimGraphState>;
          const nextState = delta.messages
            ? {
                ...previousState,
                ...delta,
                messages: [...(previousState.messages ?? []), ...delta.messages],
              }
            : { ...previousState, ...delta };
          finalState = nextState;

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
      const contextMsg = lastNodeName
        ? `Graph execution failed in node "${lastNodeName}": ${original.message}`
        : `Graph execution failed: ${original.message}`;
      const wrapped = new Error(contextMsg);
      wrapped.cause = original;
      throw wrapped;
    }

    unsubscribeNodeEntered();

    await this.workspaceStalenessService?.saveThreadBaseline(threadId, this.runtimeCtx.companyId);

    return finalState as OffisimGraphState;
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
    result: Awaited<ReturnType<WorkspaceStalenessService['checkThread']>>,
    severity: 'warn' | 'error',
  ): Promise<void> {
    await this.runtimeCtx.repos?.events?.insert({
      event_id: `evt-${threadId}-workspace-${Date.now()}`,
      company_id: this.runtimeCtx.companyId,
      thread_id: threadId,
      event_type: 'workspace.staleness.detected',
      severity,
      payload_json: JSON.stringify(result),
      created_at: new Date().toISOString(),
    });
  }
}
