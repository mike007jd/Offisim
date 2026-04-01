import { isProductionProvider } from '@offisim/shared-types';
/**
 * Guard test: Production UI must not expose vendor-direct providers.
 * See CLAUDE.md — AI Runtime Policy.
 */
import { describe, expect, it } from 'vitest';
import {
  BROWSER_DEV_DEFAULT_PRESET_KEY,
  BROWSER_DEV_PRESETS,
  BROWSER_PROD_PRESETS,
  PROVIDER_PRESETS,
  getAvailableProviderPresets,
  getDefaultProviderPresetKey,
  getProductionPresets,
} from '../components/settings/provider-presets';

describe('AI Runtime Policy — provider config restrictions', () => {
  it('getProductionPresets() only returns self-developed providers', () => {
    const production = getProductionPresets();
    for (const [, preset] of Object.entries(production)) {
      const provider = preset.defaults.provider;
      expect(provider ? isProductionProvider(provider) : true).toBe(true);
      expect(preset.devOnly).toBeFalsy();
    }
    expect(Object.keys(production).length).toBeGreaterThan(0);
  });

  it('vendor-direct presets are marked devOnly', () => {
    const vendorDirect = [
      'openai',
      'anthropic',
      'gemini',
      'deepseek',
      'openrouter',
      'kimi',
      'lmstudio',
    ];
    for (const key of vendorDirect) {
      const preset = PROVIDER_PRESETS[key];
      if (preset) {
        expect(preset.devOnly).toBe(true);
      }
    }
  });

  it('subscription preset is NOT devOnly', () => {
    expect(PROVIDER_PRESETS.subscription.devOnly).toBeFalsy();
  });

  it('browser dev presets exclude desktop-only subscription', () => {
    expect(BROWSER_DEV_PRESETS.subscription).toBeUndefined();
    expect(BROWSER_DEV_PRESETS.minimax).toBeDefined();
  });

  it('browser dev catalog and default preset are vendor-adapter only', () => {
    const browserDevPresets = getAvailableProviderPresets({ dev: true, tauri: false });
    expect(browserDevPresets.subscription).toBeUndefined();
    expect(getDefaultProviderPresetKey({ dev: true, tauri: false })).toBe(
      BROWSER_DEV_DEFAULT_PRESET_KEY,
    );
  });

  it('browser production exposes no provider presets and no default preset', () => {
    expect(BROWSER_PROD_PRESETS).toEqual({});
    expect(getAvailableProviderPresets({ dev: false, tauri: false })).toEqual({});
    expect(getDefaultProviderPresetKey({ dev: false, tauri: false })).toBeNull();
  });

  it('createDesktopProviderGateway is not exported from desktop-provider-secrets', async () => {
    const mod = (await import('../lib/desktop-provider-secrets')) as Record<string, unknown>;
    expect(mod.createDesktopProviderGateway).toBeUndefined();
  });
});
