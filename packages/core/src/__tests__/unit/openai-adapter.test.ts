import { describe, expect, it, vi } from 'vitest';
import type { LlmRequest } from '../../llm/gateway.js';
import { OpenAiAdapter } from '../../llm/openai-adapter.js';

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

  it('captures reasoning_content from OpenAI-compatible chat responses', async () => {
    const compatAdapter = new OpenAiAdapter('test-api-key', {
      baseURL: 'https://api.moonshot.cn/v1',
    });
    const mockedCreate = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: 'Visible answer',
            reasoning_content: 'Hidden chain of thought',
            tool_calls: undefined,
          },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 9 },
    });
    (compatAdapter as unknown as { client: { chat: { completions: { create: typeof mockedCreate } } } })
      .client.chat.completions.create = mockedCreate;

    const response = await compatAdapter.chat({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'kimi-k2.5',
    });

    expect(response.content).toBe('Visible answer');
    expect(response.reasoningContent).toBe('Hidden chain of thought');
  });

  it('streams reasoning_content separately for OpenAI-compatible providers', async () => {
    const compatAdapter = new OpenAiAdapter('test-api-key', {
      baseURL: 'https://api.z.ai/api/paas/v4',
    });
    const mockedCreate = vi.fn().mockResolvedValue(
      (async function* () {
        yield {
          choices: [{ delta: { reasoning_content: 'Need to inspect context' } }],
        };
        yield {
          choices: [{ delta: { content: 'Visible answer' } }],
        };
        yield {
          choices: [{ delta: {} }],
          usage: { prompt_tokens: 10, completion_tokens: 6 },
        };
      })(),
    );
    (compatAdapter as unknown as { client: { chat: { completions: { create: typeof mockedCreate } } } })
      .client.chat.completions.create = mockedCreate;

    const chunks = [];
    for await (const chunk of compatAdapter.chatStream({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'glm-5.1',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { reasoning: 'Need to inspect context', done: false },
      { content: 'Visible answer', done: false },
      { done: true, toolCalls: undefined, usage: { inputTokens: 10, outputTokens: 6 } },
    ]);
  });
});
