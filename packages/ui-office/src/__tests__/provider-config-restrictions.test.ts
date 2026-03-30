/**
 * Guard test: Production UI must not expose vendor-direct providers.
 * See CLAUDE.md — AI Runtime Policy.
 */
import { describe, expect, it } from 'vitest';
import { isProductionProvider } from '@offisim/shared-types';
import { PROVIDER_PRESETS, getProductionPresets } from '../components/settings/provider-presets';

describe('AI Runtime Policy — provider config restrictions', () => {
  it('getProductionPresets() only returns self-developed providers', () => {
    const production = getProductionPresets();
    for (const [key, preset] of Object.entries(production)) {
      const provider = preset.defaults.provider;
      expect(
        provider ? isProductionProvider(provider) : true,
      ).toBe(true);
      expect(preset.devOnly).toBeFalsy();
    }
    expect(Object.keys(production).length).toBeGreaterThan(0);
  });

  it('vendor-direct presets are marked devOnly', () => {
    const vendorDirect = ['openai', 'anthropic', 'gemini', 'deepseek', 'openrouter', 'kimi', 'lmstudio'];
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

  it('createDesktopProviderGateway is not exported from desktop-provider-secrets', async () => {
    const mod = await import('../lib/desktop-provider-secrets') as Record<string, unknown>;
    expect(mod.createDesktopProviderGateway).toBeUndefined();
  });
});
