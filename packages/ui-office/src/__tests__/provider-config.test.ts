import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ProviderConfig,
  clearProviderConfig,
  loadProviderConfig,
  resolveEffectiveRuntimePolicy,
  saveProviderConfig,
} from '../lib/provider-config';

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

describe('provider-config', () => {
  beforeEach(() => {
    localStorage.clear();
    setTauriMode(false);
  });

  afterEach(() => {
    localStorage.clear();
    setTauriMode(false);
    vi.restoreAllMocks();
  });

  it('persists api keys in browser mode', () => {
    const config: ProviderConfig = {
      provider: 'openai',
      providerVariantId: 'openai-default',
      vendor: 'openai',
      region: 'shared',
      compatibility: 'native',
      surface: 'general',
      apiKey: 'sk-browser',
      model: 'gpt-4o-mini',
      runtimePolicy: {
        executionMode: 'desktop-trusted',
        summarization: {
          enabled: true,
          triggerTokens: 42_000,
          keepRecentMessages: 20,
        },
        memory: {
          enabled: true,
          injectionEnabled: false,
          maxFacts: 24,
          factConfidenceThreshold: 0.8,
        },
        toolSearch: {
          enabled: false,
        },
        toolPermissions: {
          enabled: true,
          defaultBehavior: 'deny',
          rules: [{ pattern: 'mcp:fs-server:*', behavior: 'ask' }],
        },
      },
    };

    saveProviderConfig(config);

    expect(localStorage.getItem('offisim-provider-config')).toContain('"apiKey":"sk-browser"');
    expect(localStorage.getItem('offisim-provider-config')).toContain('"runtimePolicy"');
    expect(loadProviderConfig()).toMatchObject({
      provider: 'openai',
      providerVariantId: 'openai-default',
      vendor: 'openai',
      region: 'shared',
      compatibility: 'native',
      surface: 'general',
      apiKey: 'sk-browser',
      model: 'gpt-4o-mini',
      runtimePolicy: {
        executionMode: 'desktop-trusted',
        modelPolicy: {
          default: {
            provider: 'openai',
            model: 'gpt-4o-mini',
          },
        },
        summarization: {
          enabled: true,
          triggerTokens: 42_000,
          keepRecentMessages: 20,
        },
        memory: {
          enabled: true,
          injectionEnabled: false,
          maxFacts: 24,
          factConfidenceThreshold: 0.8,
        },
        toolSearch: {
          enabled: false,
        },
        toolPermissions: {
          enabled: true,
          defaultBehavior: 'deny',
          rules: [{ pattern: 'mcp:fs-server:*', behavior: 'ask' }],
        },
      },
    });
  });

  it('strips api keys from persisted desktop config', () => {
    setTauriMode(true);
    const config: ProviderConfig = {
      provider: 'subscription',
      providerVariantId: 'subscription',
      vendor: 'offisim',
      region: 'local',
      compatibility: 'native',
      surface: 'desktop-subscription',
      apiKey: 'sk-desktop',
      model: 'gpt-4o-mini',
      runtimePolicy: {
        executionMode: 'browser-limited',
        summarization: {
          enabled: false,
          triggerTokens: 25_000,
          keepRecentMessages: 12,
        },
        memory: {
          enabled: true,
          injectionEnabled: true,
          maxFacts: 12,
          factConfidenceThreshold: 0.9,
        },
        toolSearch: {
          enabled: true,
        },
      },
    };

    saveProviderConfig(config);

    expect(localStorage.getItem('offisim-provider-config')).not.toContain('sk-desktop');
    expect(loadProviderConfig()).toMatchObject({
      provider: 'subscription',
      providerVariantId: 'subscription',
      vendor: 'offisim',
      region: 'local',
      compatibility: 'native',
      surface: 'desktop-subscription',
      model: 'gpt-4o-mini',
      runtimePolicy: {
        executionMode: 'browser-limited',
        modelPolicy: {
          default: {
            provider: 'subscription',
            model: 'gpt-4o-mini',
          },
        },
        summarization: {
          enabled: false,
          triggerTokens: 25_000,
          keepRecentMessages: 12,
        },
        memory: {
          enabled: true,
          injectionEnabled: true,
          maxFacts: 12,
          factConfidenceThreshold: 0.9,
        },
        toolSearch: {
          enabled: true,
        },
        toolPermissions: {
          enabled: true,
          defaultBehavior: 'allow',
          rules: [],
        },
      },
    });
  });

  it('normalizes runtime tool permissions for legacy and partial configs', () => {
    localStorage.setItem(
      'offisim-provider-config',
      JSON.stringify({
        provider: 'openai',
        model: 'gpt-4o-mini',
        runtimePolicy: {
          toolPermissions: {
            defaultBehavior: 'deny',
            rules: [
              { pattern: 'mcp:github:*', behavior: 'ask' },
              { pattern: '', behavior: 'allow' },
              { pattern: 'bad', behavior: 'nope' },
            ],
          },
        },
      }),
    );

    expect(loadProviderConfig()?.runtimePolicy?.toolPermissions).toEqual({
      enabled: true,
      defaultBehavior: 'deny',
      rules: [{ pattern: 'mcp:github:*', behavior: 'ask' }],
    });
  });

  it('allows vendor-direct providers on desktop', () => {
    setTauriMode(true);
    saveProviderConfig({
      provider: 'openai',
      providerVariantId: 'openai-default',
      vendor: 'openai',
      region: 'shared',
      compatibility: 'native',
      surface: 'general',
      apiKey: 'sk-desktop',
      model: 'gpt-4o-mini',
    });

    expect(loadProviderConfig()).toMatchObject({
      provider: 'openai',
      providerVariantId: 'openai-default',
      vendor: 'openai',
      region: 'shared',
      compatibility: 'native',
      surface: 'general',
      model: 'gpt-4o-mini',
      runtimePolicy: {
        executionMode: 'auto',
        modelPolicy: {
          default: {
            provider: 'openai',
            model: 'gpt-4o-mini',
          },
        },
      },
    });
  });

  it('returns null for subscription provider in browser mode', () => {
    saveProviderConfig({
      provider: 'subscription',
      providerVariantId: 'subscription',
      vendor: 'offisim',
      region: 'local',
      compatibility: 'native',
      surface: 'desktop-subscription',
      apiKey: 'sk-browser',
      model: 'default',
    });

    expect(loadProviderConfig()).toBeNull();
  });

  it('upgrades legacy provider configs with runtime policy defaults on load', () => {
    localStorage.setItem(
      'offisim-provider-config',
      JSON.stringify({
        provider: 'openai',
        model: 'gpt-4o-mini',
      }),
    );

    expect(loadProviderConfig()).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      runtimePolicy: {
        executionMode: 'auto',
        modelPolicy: {
          default: {
            provider: 'openai',
            model: 'gpt-4o-mini',
          },
        },
        summarization: {
          enabled: true,
          triggerTokens: 60_000,
          keepRecentMessages: 30,
        },
        memory: {
          enabled: true,
          injectionEnabled: true,
          maxFacts: 50,
          factConfidenceThreshold: 0.7,
        },
        toolSearch: {
          enabled: true,
        },
      },
    });
  });

  it('preserves provider metadata for anthropic-compatible vendor presets', () => {
    saveProviderConfig({
      provider: 'anthropic',
      providerVariantId: 'zai-shared-anthropic-coding',
      vendor: 'zai',
      region: 'shared',
      compatibility: 'anthropic-compatible',
      surface: 'coding-plan',
      capabilities: {
        streaming: true,
        thinking: true,
        toolCalls: true,
        toolStreaming: false,
        codingPlan: true,
      },
      apiKey: 'sk-zai',
      model: 'GLM-4.7',
      baseURL: 'https://api.z.ai/api/anthropic',
    });

    expect(loadProviderConfig()).toMatchObject({
      provider: 'anthropic',
      providerVariantId: 'zai-shared-anthropic-coding',
      vendor: 'zai',
      region: 'shared',
      compatibility: 'anthropic-compatible',
      surface: 'coding-plan',
      capabilities: {
        streaming: true,
        thinking: true,
        toolCalls: true,
        toolStreaming: false,
        codingPlan: true,
      },
      model: 'GLM-4.7',
      baseURL: 'https://api.z.ai/api/anthropic',
    });
  });

  it('clears persisted config', () => {
    saveProviderConfig({
      provider: 'openai',
      apiKey: 'sk-any',
      model: 'gpt-4o-mini',
    });

    clearProviderConfig();

    expect(loadProviderConfig()).toBeNull();
  });

  it('resolves execution mode against the actual runtime environment', () => {
    expect(
      resolveEffectiveRuntimePolicy(
        {
          executionMode: 'auto',
        },
        'openai',
        'gpt-4o-mini',
        { tauri: false },
      ).executionMode,
    ).toBe('browser-limited');

    expect(
      resolveEffectiveRuntimePolicy(
        {
          executionMode: 'auto',
        },
        'openai',
        'gpt-4o-mini',
        { tauri: true },
      ).executionMode,
    ).toBe('desktop-trusted');

    expect(
      resolveEffectiveRuntimePolicy(
        {
          executionMode: 'browser-limited',
        },
        'openai',
        'gpt-4o-mini',
        { tauri: true },
      ).executionMode,
    ).toBe('browser-limited');
  });
});
