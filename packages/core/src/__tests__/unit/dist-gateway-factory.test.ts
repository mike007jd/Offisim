import { describe, expect, it } from 'vitest';
// @ts-ignore -- validated against built dist output after package compilation
import { createGateway } from '../../../dist/llm/gateway-factory.js';

describe('dist createGateway', () => {
  it('passes custom baseURL through to anthropic-compatible gateways', () => {
    const gw = createGateway({
      provider: 'anthropic',
      apiKey: 'sk-test',
      baseURL: 'https://api.minimax.io/anthropic',
      dangerouslyAllowBrowser: true,
    });

    // biome-ignore lint/suspicious/noExplicitAny: runtime contract verification
    const client = (gw as any).client;
    expect(client?.baseURL).toBe('https://api.minimax.io/anthropic');
  });
});
