import type { BaseMessage } from '@langchain/core/messages';
import { graphNodeExited } from '../events/event-factories.js';
import type { AicsGraphState } from '../graph/state.js';
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
export class OrchestrationService {
  constructor(
    private graph: {
      stream: (
        input: Record<string, unknown>,
        config: Record<string, unknown>,
      ) => Promise<AsyncIterable<Record<string, unknown>>>;
    },
    private runtimeCtx: RuntimeContext,
  ) {}

  async execute(input: {
    entryMode: AicsGraphState['entryMode'];
    messages: BaseMessage[];
    targetEmployeeId?: string | null;
  }): Promise<AicsGraphState> {
    const fullInput = {
      threadId: this.runtimeCtx.threadId,
      companyId: this.runtimeCtx.companyId,
      targetEmployeeId: input.targetEmployeeId ?? null,
      ...input,
    };

    const config = {
      configurable: {
        thread_id: this.runtimeCtx.threadId,
        runtimeCtx: this.runtimeCtx,
      },
    };

    let finalState: Partial<AicsGraphState> = { ...fullInput };
    let lastNodeName: string | undefined;

    const stream = await this.graph.stream(fullInput, {
      ...config,
      streamMode: 'updates' as const,
    });

    try {
      for await (const update of stream) {
        for (const [nodeName, nodeOutput] of Object.entries(update)) {
          lastNodeName = nodeName;
          this.runtimeCtx.eventBus.emit(
            graphNodeExited(this.runtimeCtx.companyId, this.runtimeCtx.threadId, nodeName),
          );
          // Merge node output, accumulating messages to match graph.invoke() behavior
          const delta = nodeOutput as Partial<AicsGraphState>;
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
      const original = error instanceof Error ? error : new Error(String(error));
      const contextMsg = lastNodeName
        ? `Graph execution failed in node "${lastNodeName}": ${original.message}`
        : `Graph execution failed: ${original.message}`;
      const wrapped = new Error(contextMsg);
      wrapped.cause = original;
      throw wrapped;
    }

    return finalState as AicsGraphState;
  }
}
