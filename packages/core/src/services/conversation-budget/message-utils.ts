import type { CompactBaselineState } from '../../graph/state.js';
import type { LlmRequest } from '../../llm/gateway.js';

type LlmMessage = LlmRequest['messages'][number];
const encoder = new TextEncoder();

export function buildRequestMessages(
  systemMessages: readonly LlmMessage[],
  compactBaseline: CompactBaselineState | null,
  nonSystemMessages: readonly LlmMessage[],
  synopsisMessage?: LlmMessage | null,
): LlmRequest['messages'] {
  return [
    ...systemMessages,
    ...(compactBaseline
      ? [
          {
            role: 'system' as const,
            content: `## Compact baseline\n${compactBaseline.summaryText}`,
          },
        ]
      : []),
    ...(synopsisMessage ? [synopsisMessage] : []),
    ...nonSystemMessages,
  ];
}

export function estimateTokens(messages: readonly LlmMessage[]): number {
  const rawEstimate = messages.reduce((total, message) => {
    const contentTokens = estimateTextTokens(message.content);
    const toolTokens = message.toolCalls
      ? estimateTextTokens(JSON.stringify(message.toolCalls))
      : 0;
    return total + contentTokens + toolTokens;
  }, 0);
  return Math.ceil(rawEstimate * (4 / 3));
}

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(Math.max(text.length / 4, encoder.encode(text).byteLength / 4));
}
