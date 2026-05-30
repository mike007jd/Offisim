import { Logger } from '../services/logger.js';
import type { LlmStreamChunk, LlmUsage, ToolCallResult } from './gateway.js';

const logger = new Logger('llm');

export interface TeeResult {
  fullContent: string;
  fullReasoning: string;
  toolCalls: ToolCallResult[];
  usage: LlmUsage;
  stopReason?: LlmStreamChunk['stopReason'];
}

export async function teeStream(
  stream: AsyncIterable<LlmStreamChunk>,
  onChunk: (chunk: LlmStreamChunk) => void,
): Promise<TeeResult> {
  let fullContent = '';
  let fullReasoning = '';
  let usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  const toolCalls: ToolCallResult[] = [];
  let stopReason: LlmStreamChunk['stopReason'];

  for await (const chunk of stream) {
    try {
      onChunk(chunk);
    } catch (err) {
      logger.error('teeStream onChunk error', err);
    }
    if (chunk.content) fullContent += chunk.content;
    if (chunk.reasoning) fullReasoning += chunk.reasoning;
    if (chunk.toolCalls) toolCalls.push(...chunk.toolCalls);
    if (chunk.usage) usage = mergeUsage(usage, chunk.usage);
    if (chunk.stopReason) stopReason = chunk.stopReason;
  }

  return { fullContent, fullReasoning, toolCalls, usage, stopReason };
}

/**
 * Adapters MUST emit one terminal usage object with cumulative token counts, but
 * a mid-call model switch (fallback) can produce multiple usage chunks. Take the
 * per-field max so a later chunk that omits or reports smaller counts never
 * silently zeroes a model's already-reported tokens. Optional cache fields are
 * only carried when at least one chunk reported them.
 */
function mergeUsage(prev: LlmUsage, next: LlmUsage): LlmUsage {
  const cacheRead = Math.max(prev.cacheReadInputTokens ?? 0, next.cacheReadInputTokens ?? 0);
  const cacheCreation = Math.max(
    prev.cacheCreationInputTokens ?? 0,
    next.cacheCreationInputTokens ?? 0,
  );
  return {
    inputTokens: Math.max(prev.inputTokens, next.inputTokens),
    outputTokens: Math.max(prev.outputTokens, next.outputTokens),
    ...(cacheRead > 0 ? { cacheReadInputTokens: cacheRead } : {}),
    ...(cacheCreation > 0 ? { cacheCreationInputTokens: cacheCreation } : {}),
  };
}
