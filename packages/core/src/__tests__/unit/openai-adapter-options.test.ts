import { describe, expect, it } from 'vitest';
import { OpenAiAdapter } from '../../llm/openai-adapter.js';

describe('OpenAiAdapter options', () => {
  it('constructs without options (backward compat)', () => {
    const adapter = new OpenAiAdapter('sk-test');
    expect(adapter).toBeDefined();
  });

  it('constructs with baseURL for compat endpoint', () => {
    const adapter = new OpenAiAdapter('sk-test', {
      baseURL: 'https://openrouter.ai/api/v1',
    });
    expect(adapter).toBeDefined();
  });

  it('constructs with all options', () => {
    const adapter = new OpenAiAdapter('sk-test', {
      baseURL: 'https://api.kimi.com/coding/v1',
      defaultHeaders: { 'X-Custom': 'value' },
      retryConfig: { maxRetries: 1, baseDelayMs: 100, maxDelayMs: 500 },
    });
    expect(adapter).toBeDefined();
  });
});
