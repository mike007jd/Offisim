import { describe, expect, it, vi } from 'vitest';
import { OpenAiAdapter } from '../../llm/openai-adapter.js';
import type { LlmRequest } from '../../llm/gateway.js';

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: 'Hello from GPT', tool_calls: undefined } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
        },
      };
    },
  };
});

describe('OpenAiAdapter', () => {
  const adapter = new OpenAiAdapter('test-api-key');

  it('maps request format and returns response', async () => {
    const request: LlmRequest = {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello' },
      ],
      model: 'gpt-4o',
      temperature: 0.5,
      maxTokens: 1024,
    };

    const response = await adapter.chat(request);

    expect(response.content).toBe('Hello from GPT');
    expect(response.usage.inputTokens).toBe(10);
    expect(response.usage.outputTokens).toBe(5);
    expect(response.toolCalls).toEqual([]);
  });

  it('passes system messages through directly', async () => {
    const request: LlmRequest = {
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hi' },
      ],
      model: 'gpt-4o',
    };

    const response = await adapter.chat(request);
    expect(response.content).toBeDefined();
  });
});
