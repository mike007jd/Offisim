import type { CompactBaselineState } from '../../graph/state.js';
import type { LlmRequest } from '../../llm/gateway.js';

type LlmMessage = LlmRequest['messages'][number];

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
    const contentTokens = Math.ceil(message.content.length / 4);
    const toolTokens = message.toolCalls
      ? Math.ceil(JSON.stringify(message.toolCalls).length / 4)
      : 0;
    return total + contentTokens + toolTokens;
  }, 0);
  return Math.ceil(rawEstimate * (4 / 3));
}
