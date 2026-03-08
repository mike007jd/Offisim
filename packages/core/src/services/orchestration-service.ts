import type { BaseMessage } from '@langchain/core/messages';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import type { AicsGraphState } from '../graph/state.js';
import { graphNodeExited } from '../events/event-factories.js';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private graph: { stream: (input: any, config: any) => Promise<AsyncIterable<Record<string, any>>> },
    private runtimeCtx: RuntimeContext,
  ) {}

  async execute(input: {
    entryMode: AicsGraphState['entryMode'];
    messages: BaseMessage[];
  }): Promise<AicsGraphState> {
    const fullInput = {
      threadId: this.runtimeCtx.threadId,
      companyId: this.runtimeCtx.companyId,
      ...input,
    };

    const config = {
      configurable: {
        thread_id: this.runtimeCtx.threadId,
        runtimeCtx: this.runtimeCtx,
      },
    };

    let finalState: Partial<AicsGraphState> = { ...fullInput };

    const stream = await this.graph.stream(fullInput, {
      ...config,
      streamMode: 'updates' as const,
    });

    for await (const update of stream) {
      for (const [nodeName, nodeOutput] of Object.entries(update)) {
        this.runtimeCtx.eventBus.emit(
          graphNodeExited(
            this.runtimeCtx.companyId,
            this.runtimeCtx.threadId,
            nodeName,
          ),
        );
        // Merge node output into accumulated state
        finalState = { ...finalState, ...(nodeOutput as Partial<AicsGraphState>) };
      }
    }

    return finalState as AicsGraphState;
  }
}
