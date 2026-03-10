import { describe, expect, it, vi } from 'vitest';
import type { LlmStreamChunk } from '../../llm/gateway.js';
import { teeStream } from '../../llm/stream-tee.js';

async function* mockStream(chunks: LlmStreamChunk[]): AsyncIterable<LlmStreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe('teeStream', () => {
  it('accumulates content from all chunks', async () => {
    const stream = mockStream([
      { content: 'Hello ', done: false },
      { content: 'world', done: false },
      { done: true, usage: { inputTokens: 10, outputTokens: 5 } },
    ]);

    const result = await teeStream(stream, () => {});
    expect(result.fullContent).toBe('Hello world');
  });

  it('captures usage from final chunk', async () => {
    const stream = mockStream([
      { content: 'Hi', done: false },
      { done: true, usage: { inputTokens: 20, outputTokens: 10 } },
    ]);

    const result = await teeStream(stream, () => {});
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
  });

  it('calls onChunk for every chunk', async () => {
    const onChunk = vi.fn();
    const stream = mockStream([
      { content: 'a', done: false },
      { content: 'b', done: false },
      { done: true, usage: { inputTokens: 1, outputTokens: 1 } },
    ]);

    await teeStream(stream, onChunk);
    expect(onChunk).toHaveBeenCalledTimes(3);
  });

  it('collects tool calls', async () => {
    const stream = mockStream([
      { toolCalls: [{ id: 'tc-1', name: 'search', arguments: {} }], done: false },
      { done: true, usage: { inputTokens: 1, outputTokens: 1 } },
    ]);

    const result = await teeStream(stream, () => {});
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.name).toBe('search');
  });

  it('returns zero usage when stream has no usage chunk', async () => {
    const stream = mockStream([{ content: 'hi', done: true }]);
    const result = await teeStream(stream, () => {});
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
