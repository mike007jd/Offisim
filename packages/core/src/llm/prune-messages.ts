import type { LlmMessage } from './gateway.js';

const MAX_LLM_CONTEXT_MESSAGES = 50;

export interface PruneLlmMessagesOptions {
  maxNonSystemMessages?: number;
  synopsisMessage?: LlmMessage | null;
  toolResultKeepRecent?: number;
  toolResultMaxContentChars?: number;
}

interface ResolvedPruneOptions {
  maxNonSystemMessages: number;
  synopsisMessage: LlmMessage | null;
  toolResultKeepRecent: number;
  toolResultMaxContentChars: number;
}

function resolveOptions(maxOrOptions: number | PruneLlmMessagesOptions): ResolvedPruneOptions {
  return typeof maxOrOptions === 'number'
    ? {
        maxNonSystemMessages: maxOrOptions,
        synopsisMessage: null,
        toolResultKeepRecent: 0,
        toolResultMaxContentChars: 0,
      }
    : {
        maxNonSystemMessages: maxOrOptions.maxNonSystemMessages ?? MAX_LLM_CONTEXT_MESSAGES,
        synopsisMessage: maxOrOptions.synopsisMessage ?? null,
        toolResultKeepRecent: Math.max(0, maxOrOptions.toolResultKeepRecent ?? 0),
        toolResultMaxContentChars: Math.max(0, maxOrOptions.toolResultMaxContentChars ?? 0),
      };
}

function makeCompactedToolResultContent(originalLength: number): string {
  return `[tool result compacted: ${originalLength} chars omitted]`;
}

/**
 * Drop leading orphan `tool` messages from a message window. After a tail-slice
 * the front may hold tool_results whose owning assistant `tool_use` was cut off;
 * providers (e.g. Anthropic) reject those orphans with a 400, and an orphan
 * tool_result carries no meaning without its call — so advancing the cut to the
 * first non-`tool` message (rather than walking backwards and blowing the
 * budget) keeps the window self-contained.
 */
export function dropLeadingOrphanToolResults(
  messages: readonly LlmMessage[],
): readonly LlmMessage[] {
  let start = 0;
  while (start < messages.length && messages[start]?.role === 'tool') start += 1;
  return start === 0 ? messages : messages.slice(start);
}

export function compactToolResultMessages(
  messages: readonly LlmMessage[],
  options: Pick<ResolvedPruneOptions, 'toolResultKeepRecent' | 'toolResultMaxContentChars'>,
): readonly LlmMessage[] {
  if (options.toolResultMaxContentChars <= 0) return messages;

  const toolIndices = messages.flatMap((message, index) =>
    message.role === 'tool' ? [index] : [],
  );
  if (toolIndices.length <= options.toolResultKeepRecent) return messages;

  const compactBefore = toolIndices.length - options.toolResultKeepRecent;
  let compacted: LlmMessage[] | null = null;

  for (let i = 0; i < compactBefore; i++) {
    const messageIndex = toolIndices[i];
    if (messageIndex == null) continue;

    const message = messages[messageIndex];
    if (!message || message.content.length <= options.toolResultMaxContentChars) continue;

    compacted ??= [...messages];
    compacted[messageIndex] = {
      ...message,
      content: makeCompactedToolResultContent(message.content.length),
    };
  }

  return compacted ?? messages;
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
  const options = resolveOptions(maxOrOptions);
  const compactedMessages = compactToolResultMessages(messages, options);

  const system: LlmMessage[] = [];
  const nonSystem: LlmMessage[] = [];
  for (const m of compactedMessages) {
    if (m.role === 'system') system.push(m);
    else nonSystem.push(m);
  }

  if (nonSystem.length <= options.maxNonSystemMessages && !options.synopsisMessage) {
    return compactedMessages;
  }

  const mergedSystem = options.synopsisMessage ? [...system, options.synopsisMessage] : system;
  if (nonSystem.length <= options.maxNonSystemMessages) {
    return [...mergedSystem, ...nonSystem];
  }
  if (options.maxNonSystemMessages <= 0) {
    return mergedSystem;
  }

  // Tail-slice to the budget, then drop leading orphan tool_results (see
  // dropLeadingOrphanToolResults). A tail-slice cannot orphan a `tool_use` —
  // results always follow their assistant, so the slice's end never severs them.
  const sliced = dropLeadingOrphanToolResults(nonSystem.slice(-options.maxNonSystemMessages));
  return [...mergedSystem, ...sliced];
}
