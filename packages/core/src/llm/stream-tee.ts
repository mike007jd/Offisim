import { Logger } from '../services/logger.js';
import type { LlmStreamChunk, LlmUsage, ToolCallResult } from './gateway.js';

const logger = new Logger('llm');

export interface TeeResult {
  fullContent: string;
  fullReasoning: string;
  toolCalls: ToolCallResult[];
  usage: LlmUsage;
}

export async function teeStream(
  stream: AsyncIterable<LlmStreamChunk>,
  onChunk: (chunk: LlmStreamChunk) => void,
): Promise<TeeResult> {
  let fullContent = '';
  let fullReasoning = '';
  let usage: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  const toolCalls: ToolCallResult[] = [];

  for await (const chunk of stream) {
    try {
      onChunk(chunk);
    } catch (err) {
      logger.error('teeStream onChunk error', err);
    }
    if (chunk.content) fullContent += chunk.content;
    if (chunk.reasoning) fullReasoning += chunk.reasoning;
    if (chunk.toolCalls) toolCalls.push(...chunk.toolCalls);
    if (chunk.usage) usage = chunk.usage;
  }

  return { fullContent, fullReasoning, toolCalls, usage };
}
