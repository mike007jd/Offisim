import type { RunnableConfig } from '@langchain/core/runnables';

/**
 * Extract AbortSignal from LangGraph config.configurable.
 * OrchestrationService injects this via the `signal` key so all nodes
 * can pass it through to LLM calls for cancellation support.
 */
export function getConfigSignal(config: RunnableConfig): AbortSignal | undefined {
  return (config.configurable as { signal?: AbortSignal } | undefined)?.signal;
}
