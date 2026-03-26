import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ProviderConfig,
  clearProviderConfig,
  loadProviderConfig,
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
      },
    };

    saveProviderConfig(config);

    expect(localStorage.getItem('aics-provider-config')).toContain('"apiKey":"sk-browser"');
    expect(localStorage.getItem('aics-provider-config')).toContain('"runtimePolicy"');
    expect(loadProviderConfig()).toMatchObject({
      provider: 'openai',
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
      },
    });
  });

  it('strips api keys from persisted desktop config', () => {
    setTauriMode(true);
    const config: ProviderConfig = {
      provider: 'openai',
      apiKey: 'sk-desktop',
      model: 'gpt-4o-mini',
      baseURL: 'https://api.openai.com/v1',
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

    expect(localStorage.getItem('aics-provider-config')).not.toContain('sk-desktop');
    expect(loadProviderConfig()).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseURL: 'https://api.openai.com/v1',
      runtimePolicy: {
        executionMode: 'browser-limited',
        modelPolicy: {
          default: {
            provider: 'openai',
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
      },
    });
  });

  it('upgrades legacy provider configs with runtime policy defaults on load', () => {
    localStorage.setItem(
      'aics-provider-config',
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

  it('clears persisted config', () => {
    saveProviderConfig({
      provider: 'openai',
      apiKey: 'sk-any',
      model: 'gpt-4o-mini',
    });

    clearProviderConfig();

    expect(loadProviderConfig()).toBeNull();
  });
});
