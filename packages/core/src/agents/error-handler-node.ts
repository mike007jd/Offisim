import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { AicsGraphState } from '../graph/state.js';

export async function errorHandlerNode(
  state: AicsGraphState,
  _config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
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
