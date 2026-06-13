import type { CompactBaselineState } from './compact-baseline.js';
import type { LlmRequest, LlmResponse } from '../../llm/gateway.js';

type LlmMessage = LlmRequest['messages'][number];
const encoder = new TextEncoder();

// Collapse whitespace and trim an LLM summary response, returning null when the
// model produced nothing usable. Shared by the synopsis and full-compact paths.
export function normalizeSummary(response: LlmResponse): string | null {
  const summary = response.content.replace(/\s+/g, ' ').trim();
  return summary.length > 0 ? summary : null;
}

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

// Cheap char/byte heuristic — intentionally not a real tokenizer. It is a fast,
// dependency-free upper-bound pre-gate; the authoritative window-derived trigger
// uses the provider's reported prompt usage, so this only needs to be a safe
// over-estimate, never an exact count.
//
// `estimateTokens` applies a 4/3 safety factor on top of the per-text estimate
// so the aggregate over-counts rather than under-counts (under-counting would
// let an oversized request slip past the pre-gate).
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

// English-ish text averages ~4 chars/token; CJK text is closer to ~1.5
// chars/token (each ideograph is roughly its own token), so a pure length/4
// estimate badly under-counts CJK-heavy content. We take the max of length/4,
// a CJK-aware term that counts CJK codepoints near 1 token each (non-CJK chars
// still amortized at /4), and the UTF-8 byte length /4 as a further floor for
// other multi-byte content. Max keeps it a safe over-estimate for any mix.
function estimateTextTokens(text: string): number {
  if (!text) return 0;
  const cjkChars = countCjkChars(text);
  const nonCjkChars = [...text].length - cjkChars;
  const cjkAwareEstimate = cjkChars + nonCjkChars / 4;
  return Math.ceil(
    Math.max(text.length / 4, cjkAwareEstimate, encoder.encode(text).byteLength / 4),
  );
}

// Han ideographs (incl. extensions / compatibility), Hiragana, and Katakana —
// the scripts whose codepoints map roughly one-to-one onto tokens.
const CJK_RANGE = /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u;

function countCjkChars(text: string): number {
  let count = 0;
  for (const char of text) {
    if (CJK_RANGE.test(char)) count += 1;
  }
  return count;
}
