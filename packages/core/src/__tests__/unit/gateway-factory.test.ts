import { describe, it, expect } from 'vitest';
import { createGateway } from '../../llm/gateway-factory.js';
import { AnthropicAdapter } from '../../llm/anthropic-adapter.js';
import { OpenAiAdapter } from '../../llm/openai-adapter.js';

describe('createGateway', () => {
  it('creates AnthropicAdapter for anthropic provider', () => {
    const gw = createGateway({ provider: 'anthropic', apiKey: 'sk-test' });
    expect(gw).toBeInstanceOf(AnthropicAdapter);
  });

  it('creates OpenAiAdapter for openai provider', () => {
    const gw = createGateway({ provider: 'openai', apiKey: 'sk-test' });
    expect(gw).toBeInstanceOf(OpenAiAdapter);
  });

  it('creates OpenAiAdapter for openai-compat with baseURL', () => {
    const gw = createGateway({
      provider: 'openai-compat',
      apiKey: 'sk-test',
      baseURL: 'https://openrouter.ai/api/v1',
    });
    expect(gw).toBeInstanceOf(OpenAiAdapter);
  });

  it('throws when openai-compat has no baseURL', () => {
    expect(() =>
      createGateway({ provider: 'openai-compat', apiKey: 'sk-test' }),
    ).toThrow('baseURL');
  });

  it('passes defaultHeaders to openai-compat adapter', () => {
    const gw = createGateway({
      provider: 'openai-compat',
      apiKey: 'sk-test',
      baseURL: 'https://api.kimi.com/coding/v1',
      defaultHeaders: { 'X-Custom': 'test' },
    });
    expect(gw).toBeInstanceOf(OpenAiAdapter);
  });
});
