import { describe, expect, it } from 'vitest';
import type { LlmStreamChunk } from '../../llm/gateway.js';
import { MockLlmGateway } from '../helpers/mock-gateway.js';

describe('MockLlmGateway.chatStream', () => {
  it('yields chunks and final usage', async () => {
    const gateway = new MockLlmGateway();
    gateway.pushStreamResponse({
      content: 'hello world',
      usage: { inputTokens: 5, outputTokens: 2 },
    });

    const chunks: LlmStreamChunk[] = [];
    for await (const chunk of gateway.chatStream({ messages: [], model: 'test' })) {
      chunks.push(chunk);
    }

    const contentChunks = chunks.filter((c) => c.content);
    expect(contentChunks.length).toBeGreaterThan(0);

    const finalChunk = chunks.at(-1);
    expect(finalChunk?.done).toBe(true);
    expect(finalChunk?.usage).toBeDefined();
    expect(finalChunk?.usage?.inputTokens).toBe(5);
  });
});
