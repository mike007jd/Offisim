import type { LlmMessage } from './gateway.js';

const MAX_LLM_CONTEXT_MESSAGES = 50;

export interface PruneLlmMessagesOptions {
  maxNonSystemMessages?: number;
  synopsisMessage?: LlmMessage | null;
}

/**
 * Prune message array for LLM calls. Keeps all system messages (always first)
 * plus the last N non-system messages.
 * Applied at LLM call layer, not graph state — graph retains full history.
 */
export function pruneLlmMessages(
  messages: readonly LlmMessage[],
  maxOrOptions: number | PruneLlmMessagesOptions = MAX_LLM_CONTEXT_MESSAGES,
): readonly LlmMessage[] {
  const options =
    typeof maxOrOptions === 'number'
      ? { maxNonSystemMessages: maxOrOptions, synopsisMessage: null }
      : {
          maxNonSystemMessages: maxOrOptions.maxNonSystemMessages ?? MAX_LLM_CONTEXT_MESSAGES,
          synopsisMessage: maxOrOptions.synopsisMessage ?? null,
        };

  const system: LlmMessage[] = [];
  const nonSystem: LlmMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') system.push(m);
    else nonSystem.push(m);
  }

  if (nonSystem.length <= options.maxNonSystemMessages && !options.synopsisMessage) {
    return messages;
  }

  const mergedSystem = options.synopsisMessage ? [...system, options.synopsisMessage] : system;
  if (nonSystem.length <= options.maxNonSystemMessages) {
    return [...mergedSystem, ...nonSystem];
  }

  return [...mergedSystem, ...nonSystem.slice(-options.maxNonSystemMessages)];
}
