import type { LlmMessage } from './gateway.js';

const MAX_LLM_CONTEXT_MESSAGES = 50;

/**
 * Prune message array for LLM calls. Keeps all system messages (always first)
 * plus the last N non-system messages.
 * Applied at LLM call layer, not graph state — graph retains full history.
 */
export function pruneLlmMessages(
  messages: readonly LlmMessage[],
  max = MAX_LLM_CONTEXT_MESSAGES,
): readonly LlmMessage[] {
  const system = messages.filter((m) => m.role === 'system');
  const nonSystem = messages.filter((m) => m.role !== 'system');
  if (nonSystem.length <= max) return messages;
  return [...system, ...nonSystem.slice(-max)];
}
