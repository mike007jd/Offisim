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
    };

    saveProviderConfig(config);

    expect(localStorage.getItem('aics-provider-config')).toContain('"apiKey":"sk-browser"');
    expect(loadProviderConfig()).toEqual(config);
  });

  it('strips api keys from persisted desktop config', () => {
    setTauriMode(true);
    const config: ProviderConfig = {
      provider: 'openai',
      apiKey: 'sk-desktop',
      model: 'gpt-4o-mini',
      baseURL: 'https://api.openai.com/v1',
    };

    saveProviderConfig(config);

    expect(localStorage.getItem('aics-provider-config')).not.toContain('sk-desktop');
    expect(loadProviderConfig()).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
      baseURL: 'https://api.openai.com/v1',
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
