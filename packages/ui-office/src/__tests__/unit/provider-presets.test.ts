import { describe, expect, it } from 'vitest';
import type { ProviderConfig } from '../../lib/provider-config';
import {
  DEFAULT_PRESET_KEY,
  findProviderPresetKeyByConfig,
  getAvailableProviderPresets,
  getProviderPreset,
} from '../../components/settings/provider-presets';

describe('provider preset registry', () => {
  it('defaults web users to MiniMax anthropic-compatible coding surface', () => {
    const preset = getProviderPreset(DEFAULT_PRESET_KEY);

    expect(DEFAULT_PRESET_KEY).toBe('minimax-intl-anthropic-coding');
    expect(preset?.vendor).toBe('minimax');
    expect(preset?.region).toBe('intl');
    expect(preset?.compatibility).toBe('anthropic-compatible');
    expect(preset?.surface).toBe('coding-plan');
    expect(preset?.defaults.provider).toBe('anthropic');
    expect(preset?.defaults.baseURL).toBe('https://api.minimax.io/anthropic');
  });

  it('offers Anthropic-compatible Claude Code surfaces for official Chinese providers', () => {
    const presets = getAvailableProviderPresets({ tauri: false });

    expect(presets['minimax-cn-anthropic-coding']).toMatchObject({
      vendor: 'minimax',
      region: 'cn',
      compatibility: 'anthropic-compatible',
      surface: 'coding-plan',
      hasThinking: true,
      defaults: {
        provider: 'anthropic',
        baseURL: 'https://api.minimaxi.com/anthropic',
      },
      capabilities: {
        thinking: true,
      },
    });
    expect(presets['kimi-cn-anthropic-coding']).toMatchObject({
      vendor: 'kimi',
      region: 'cn',
      compatibility: 'anthropic-compatible',
      surface: 'coding-plan',
      hasThinking: true,
      defaults: {
        provider: 'anthropic',
        baseURL: 'https://api.moonshot.cn/anthropic',
      },
      capabilities: {
        thinking: true,
      },
    });
    expect(presets['zai-shared-anthropic-coding']).toMatchObject({
      vendor: 'zai',
      region: 'shared',
      compatibility: 'anthropic-compatible',
      surface: 'coding-plan',
      hasThinking: true,
      defaults: {
        provider: 'anthropic',
        baseURL: 'https://api.z.ai/api/anthropic',
      },
      capabilities: {
        thinking: true,
      },
    });
  });

  it('keeps separate general and coding OpenAI-compatible surfaces where providers document both', () => {
    const kimiIntl = getProviderPreset('kimi-intl-openai-general');
    const zaiCoding = getProviderPreset('zai-shared-openai-coding');

    expect(kimiIntl?.defaults.baseURL).toBe('https://api.moonshot.ai/v1');
    expect(kimiIntl?.surface).toBe('general');
    expect(kimiIntl?.defaults.provider).toBe('openai-compat');

    expect(zaiCoding?.defaults.baseURL).toBe('https://api.z.ai/api/coding/paas/v4');
    expect(zaiCoding?.surface).toBe('coding-plan');
    expect(zaiCoding?.compatibility).toBe('openai-compatible');
  });

  it('prefers saved provider variant ids when resolving presets from config', () => {
    const config: ProviderConfig = {
      provider: 'anthropic',
      providerVariantId: 'kimi-cn-anthropic-coding',
      vendor: 'kimi',
      region: 'cn',
      compatibility: 'anthropic-compatible',
      surface: 'coding-plan',
      model: 'kimi-k2.5',
      baseURL: 'https://api.moonshot.cn/anthropic',
    };

    expect(findProviderPresetKeyByConfig(config)).toBe('kimi-cn-anthropic-coding');
  });
});
