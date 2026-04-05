import { describe, expect, it } from 'vitest';
import { AnthropicAdapter } from '../../llm/anthropic-adapter.js';
import { createGateway, shouldRejectSubscriptionInRenderer } from '../../llm/gateway-factory.js';
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
    expect(() => createGateway({ provider: 'openai-compat', apiKey: 'sk-test' })).toThrow(
      'baseURL',
    );
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

  it('passes dangerouslyAllowBrowser to anthropic adapter', () => {
    const gw = createGateway({
      provider: 'anthropic',
      apiKey: 'sk-test',
      dangerouslyAllowBrowser: true,
    });
    expect(gw).toBeInstanceOf(AnthropicAdapter);
    // Access the internal client to verify the flag was passed
    // biome-ignore lint/suspicious/noExplicitAny: test-only introspection
    const client = (gw as any).client;
    expect(client).toBeDefined();
  });

  it('passes defaultHeaders through + injects browser-compat headers for third-party endpoints', () => {
    const gw = createGateway({
      provider: 'anthropic',
      apiKey: 'sk-test',
      baseURL: 'https://api.minimax.io/anthropic',
      defaultHeaders: { 'X-LLM-Base-URL': 'https://api.minimax.io/anthropic' },
    });

    // biome-ignore lint/suspicious/noExplicitAny: test-only introspection
    const headers = (gw as any).client?._options?.defaultHeaders;
    // User-supplied headers pass through.
    expect(headers?.['X-LLM-Base-URL']).toBe('https://api.minimax.io/anthropic');
    // Third-party Anthropic-compat endpoints trigger browser-CORS-friendly
    // overrides: Bearer auth + null-deletion of x-api-key, anthropic-version,
    // and all x-stainless-* telemetry headers.
    expect(headers?.Authorization).toBe('Bearer sk-test');
    expect(headers?.['x-api-key']).toBeNull();
    expect(headers?.['anthropic-version']).toBeNull();
    expect(headers?.['X-Stainless-OS']).toBeNull();
  });

  it('does not inject browser-compat headers for Anthropic official endpoint', () => {
    const gw = createGateway({
      provider: 'anthropic',
      apiKey: 'sk-test',
      // baseURL omitted → SDK uses api.anthropic.com default
    });

    // biome-ignore lint/suspicious/noExplicitAny: test-only introspection
    const headers = (gw as any).client?._options?.defaultHeaders;
    expect(headers?.Authorization).toBeUndefined();
    expect(headers?.['x-api-key']).toBeUndefined();
  });

  it('allows subscription in a trusted desktop renderer', () => {
    expect(shouldRejectSubscriptionInRenderer(true, true)).toBe(false);
  });

  it('still rejects subscription in an untrusted browser renderer', () => {
    expect(shouldRejectSubscriptionInRenderer(true, false)).toBe(true);
    expect(shouldRejectSubscriptionInRenderer(true, undefined)).toBe(true);
    expect(shouldRejectSubscriptionInRenderer(false, false)).toBe(false);
  });
});
