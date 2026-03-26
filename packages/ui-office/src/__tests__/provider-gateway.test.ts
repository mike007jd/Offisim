import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as desktopProviderSecrets from '../lib/desktop-provider-secrets';
import type { ProviderConfig } from '../lib/provider-config';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

function setTauriMode(enabled: boolean) {
  if (enabled) {
    Object.defineProperty(window, '__TAURI__', {
      value: {},
      configurable: true,
    });
    return;
  }

  Reflect.deleteProperty(window, '__TAURI__');
}

describe('createDesktopProviderGateway', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setTauriMode(true);
  });

  it('routes desktop chat calls through provider_chat', async () => {
    const mod = desktopProviderSecrets as Record<string, unknown>;
    expect(typeof mod.createDesktopProviderGateway).toBe('function');

    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockResolvedValueOnce({
      content: 'hello from rust',
      toolCalls: [],
      usage: { inputTokens: 12, outputTokens: 4 },
    });

    const gateway = (
      mod.createDesktopProviderGateway as (config: ProviderConfig) => {
        chat: (request: unknown) => Promise<unknown>;
      }
    )({
      provider: 'openai',
      model: 'gpt-5.4',
      baseURL: 'https://api.openai.com/v1',
    });

    const request = {
      messages: [{ role: 'user', content: 'hi' }],
      model: 'gpt-5.4',
      temperature: 0.2,
      maxTokens: 256,
    };

    await expect(gateway.chat(request)).resolves.toEqual({
      content: 'hello from rust',
      toolCalls: [],
      usage: { inputTokens: 12, outputTokens: 4 },
    });

    expect(invoke).toHaveBeenCalledWith('provider_chat', {
      request: {
        provider: 'openai',
        baseURL: 'https://api.openai.com/v1',
        defaultHeaders: undefined,
        llmRequest: request,
      },
    });
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).not.toContain(
      'provider_secret_get',
    );
  });
});
