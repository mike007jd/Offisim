import { AIMessage } from '@langchain/core/messages';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { AicsGraphState } from '../graph/state.js';
import type { RuntimeContext } from '../runtime/runtime-context.js';

/**
 * Boss summary node — produces the final summary after employee work
 * or after an error handler. Marks the graph as completed.
 */
export async function bossSummaryNode(
  state: AicsGraphState,
  config: RunnableConfig,
): Promise<Partial<AicsGraphState>> {
  const runtimeCtx = (config.configurable as { runtimeCtx: RuntimeContext }).runtimeCtx;

  // If there's already a direct reply from boss, just mark completed
  if (state.routeDecision === 'direct_reply') {
    return { completed: true };
  }

  // Collect employee results from messages
  const employeeResults = state.messages
    .filter((m) => m._getType() === 'ai')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .filter((c) => c.startsWith('['));

  if (employeeResults.length === 0) {
    return {
      completed: true,
      messages: [new AIMessage({ content: 'Task processing complete.' })],
    };
  }

  // For Phase 2.0, produce a simple summary without extra LLM call
  const summary = employeeResults.length === 1
    ? employeeResults[0]!
    : `Team completed ${employeeResults.length} tasks:\n${employeeResults.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;

  // Update thread status
  if (runtimeCtx) {
    await runtimeCtx.repos.threads.updateStatus(state.threadId, 'completed');
  }

  return {
    completed: true,
    messages: [new AIMessage({ content: summary })],
  };
}
