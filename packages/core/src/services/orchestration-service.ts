import type { BaseMessage } from '@langchain/core/messages';
import { graphNodeExited } from '../events/event-factories.js';
import type { OffisimGraphState, MeetingInterrupt, MeetingInterruptType } from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';

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

  constructor(
    private graph: {
      stream: (
        input: Record<string, unknown>,
        config: Record<string, unknown>,
      ) => Promise<AsyncIterable<Record<string, unknown>>>;
    },
    private runtimeCtx: RuntimeContext,
  ) {}

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
  async resumeMeeting(meetingId: string, messages: BaseMessage[]): Promise<OffisimGraphState> {
    return this.execute({
      entryMode: 'meeting',
      messages,
      meetingId,
      meetingInterrupt: { type: null }, // null type = resume
    });
  }

  /**
   * End a paused meeting.
   * Re-invokes the graph with the paused meeting's ID and an end signal.
   */
  async endPausedMeeting(meetingId: string, messages: BaseMessage[]): Promise<OffisimGraphState> {
    return this.execute({
      entryMode: 'meeting',
      messages,
      meetingId,
      meetingInterrupt: { type: 'end' },
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

    try {
      for await (const update of stream) {
        if (input.signal.aborted) break;
        for (const [nodeName, nodeOutput] of Object.entries(update)) {
          lastNodeName = nodeName;
          this.runtimeCtx.eventBus.emit(
            graphNodeExited(this.runtimeCtx.companyId, threadId, nodeName),
          );
          // Merge node output, accumulating messages to match graph.invoke() behavior
          const delta = nodeOutput as Partial<OffisimGraphState>;
          if (delta.messages) {
            finalState = {
              ...finalState,
              ...delta,
              messages: [...(finalState.messages ?? []), ...delta.messages],
            };
          } else {
            finalState = { ...finalState, ...delta };
          }
        }
      }
    } catch (error) {
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

    return finalState as OffisimGraphState;
  }
}
