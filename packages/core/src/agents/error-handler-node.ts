import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { AicsGraphState } from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';
import { graphNodeEntered } from '../events/event-factories.js';

export async function errorHandlerNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  // Announce node entry (best-effort — error handler must not throw)
  const runtimeCtx = (config.configurable as { runtimeCtx?: RuntimeContext })?.runtimeCtx;
  if (runtimeCtx) {
    runtimeCtx.eventBus.emit(
      graphNodeEntered(runtimeCtx.companyId, state.threadId, 'error_handler'),
    );
  }

  const reason = state.interruptReason ?? 'An unknown error occurred';

  return {
    completed: true,
    interruptReason: null,
    messages: [
      new AIMessage({
        content: `[Error Handler] The workflow encountered an issue: ${reason}. The task has been stopped.`,
      }),
    ],
  };
}
