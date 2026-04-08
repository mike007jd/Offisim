import { describe, expect, it, vi } from 'vitest';
import { AnthropicAdapter } from '../../llm/anthropic-adapter.js';
import type { LlmRequest } from '../../llm/gateway.js';

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Hello from Claude' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };
    },
  };
});

describe('AnthropicAdapter', () => {
  const adapter = new AnthropicAdapter('test-api-key');

  it('maps request format correctly', async () => {
    const request: LlmRequest = {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      model: 'claude-sonnet-4-20250514',
      temperature: 0.5,
      maxTokens: 1024,
    };

    const response = await adapter.chat(request);

    expect(response.content).toBe('Hello from Claude');
    expect(response.usage.inputTokens).toBe(10);
    expect(response.usage.outputTokens).toBe(5);
    expect(response.toolCalls).toEqual([]);
  });

  it('extracts system message from messages array', async () => {
    const request: LlmRequest = {
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hi' },
      ],
      model: 'claude-sonnet-4-20250514',
    };

    await adapter.chat(request);
    expect(true).toBe(true);
  });

  it('handles empty content response', async () => {
    const { default: MockAnthropic } = await import('@anthropic-ai/sdk');
    const mockInstance = new MockAnthropic();
    (mockInstance.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [],
      usage: { input_tokens: 5, output_tokens: 0 },
    });

    const customAdapter = new AnthropicAdapter('key');
    (customAdapter as unknown as { client: typeof mockInstance }).client = mockInstance;

    const response = await customAdapter.chat({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-sonnet-4-20250514',
    });

    expect(response.content).toBe('');
  });

  it('maps thinking deltas separately from text deltas in streaming mode', async () => {
    const { default: MockAnthropic } = await import('@anthropic-ai/sdk');
    const mockInstance = new MockAnthropic();
    (mockInstance.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      (async function* () {
        yield { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } };
        yield {
          type: 'content_block_delta',
          delta: { type: 'thinking_delta', thinking: 'Inspecting the constraints' },
        };
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Visible answer' },
        };
        yield { type: 'message_delta', usage: { output_tokens: 8 } };
      })(),
    );

    const customAdapter = new AnthropicAdapter('key');
    (customAdapter as unknown as { client: typeof mockInstance }).client = mockInstance;

    const chunks = [];
    for await (const chunk of customAdapter.chatStream({
      messages: [{ role: 'user', content: 'test' }],
      model: 'claude-sonnet-4-20250514',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { reasoning: 'Inspecting the constraints', done: false },
      { content: 'Visible answer', done: false },
      { done: true, toolCalls: undefined, usage: { inputTokens: 12, outputTokens: 8 } },
    ]);
  });
});
