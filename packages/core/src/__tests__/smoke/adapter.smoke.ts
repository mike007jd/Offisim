import { describe, it, expect } from 'vitest';
import { AnthropicAdapter } from '../../llm/anthropic-adapter.js';
import { OpenAiAdapter } from '../../llm/openai-adapter.js';

const HAS_ANTHROPIC_KEY = !!process.env.ANTHROPIC_API_KEY;
const HAS_OPENAI_KEY = !!process.env.OPENAI_API_KEY;

describe.skipIf(!HAS_ANTHROPIC_KEY)('AnthropicAdapter smoke (live API)', () => {
  it('chat: sends request and receives valid response', async () => {
    const adapter = new AnthropicAdapter(process.env.ANTHROPIC_API_KEY!);
    const response = await adapter.chat({
      messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
      model: 'claude-sonnet-4-20250514',
      maxTokens: 32,
    });
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.usage.inputTokens).toBeGreaterThan(0);
    expect(response.usage.outputTokens).toBeGreaterThan(0);
    expect(response.toolCalls).toEqual([]);
  }, 30000);

  it('chatStream: yields chunks with final usage', async () => {
    const adapter = new AnthropicAdapter(process.env.ANTHROPIC_API_KEY!);
    const chunks: any[] = [];

    for await (const chunk of adapter.chatStream({
      messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
      model: 'claude-sonnet-4-20250514',
      maxTokens: 32,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(1);
    const contentChunks = chunks.filter(c => c.content);
    expect(contentChunks.length).toBeGreaterThan(0);

    const finalChunk = chunks.at(-1);
    expect(finalChunk.done).toBe(true);
    expect(finalChunk.usage).toBeDefined();
    expect(finalChunk.usage.inputTokens).toBeGreaterThan(0);
  }, 30000);
});

describe.skipIf(!HAS_OPENAI_KEY)('OpenAiAdapter smoke (live API)', () => {
  it('chat: sends request and receives valid response', async () => {
    const adapter = new OpenAiAdapter(process.env.OPENAI_API_KEY!);
    const response = await adapter.chat({
      messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
      model: 'gpt-4o-mini',
      maxTokens: 32,
    });
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.usage.inputTokens).toBeGreaterThan(0);
  }, 30000);

  it('chatStream: yields chunks with final usage', async () => {
    const adapter = new OpenAiAdapter(process.env.OPENAI_API_KEY!);
    const chunks: any[] = [];

    for await (const chunk of adapter.chatStream({
      messages: [{ role: 'user', content: 'Say "hello" and nothing else.' }],
      model: 'gpt-4o-mini',
      maxTokens: 32,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(1);
    const finalChunk = chunks.at(-1);
    expect(finalChunk.done).toBe(true);
  }, 30000);
});
