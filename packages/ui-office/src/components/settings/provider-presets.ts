import type { LlmProvider } from '@offisim/shared-types';
import { isProductionProvider } from '@offisim/shared-types';
import type { ProviderConfig } from '../../lib/provider-config';

export interface ProviderPreset {
  label: string;
  defaults: Partial<ProviderConfig>;
  /** Provider always returns thinking/reasoning blocks that consume max_tokens budget. */
  hasThinking?: boolean;
  /**
   * If true, this preset uses a vendor-direct adapter and is only available in
   * dev/test mode. Production UI must not display these presets.
   */
  devOnly?: boolean;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  // ---------------------------------------------------------------------------
  // Production presets — self-developed transport adapters
  // ---------------------------------------------------------------------------
  subscription: {
    label: '订阅制 (Subscription)',
    defaults: {
      provider: 'subscription',
      model: 'default',
      apiKey: '',
      acpCommand: 'claude',
      acpArgs: ['acp'],
    },
  },

  // ---------------------------------------------------------------------------
  // Dev-only presets — vendor-direct adapters for testing / development
  // ---------------------------------------------------------------------------
  gemini: {
    label: 'Google Gemini',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
    },
    hasThinking: true,
    devOnly: true,
  },
  deepseek: {
    label: 'DeepSeek',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-reasoner',
    },
    hasThinking: true,
    devOnly: true,
  },
  minimax: {
    label: 'MiniMax',
    defaults: {
      provider: 'anthropic',
      baseURL: 'https://api.minimax.io/anthropic',
      model: 'MiniMax-M2.7-highspeed',
    },
    hasThinking: true,
    devOnly: true,
  },
  openrouter: {
    label: 'OpenRouter',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'google/gemma-3-4b-it:free',
    },
    devOnly: true,
  },
  kimi: {
    label: 'Kimi',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://api.kimi.com/coding/v1',
      model: 'kimi-for-coding',
      defaultHeaders: { 'User-Agent': 'claude-code/1.0.0' },
    },
    hasThinking: true,
    devOnly: true,
  },
  openai: {
    label: 'OpenAI',
    defaults: {
      provider: 'openai',
      model: 'gpt-4o-mini',
    },
    devOnly: true,
  },
  anthropic: {
    label: 'Anthropic',
    defaults: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    },
    devOnly: true,
  },
  lmstudio: {
    label: 'LM Studio (Local)',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'http://localhost:1234/v1',
      model: 'qwen/qwen3.5-9b',
      apiKey: 'lm-studio',
    },
    devOnly: true,
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    defaults: {
      provider: 'openai-compat',
      model: '',
    },
    devOnly: true,
  },
};

/** Presets whose provider is allowed in production — pre-computed, stable reference. */
export const PRODUCTION_PRESETS: Record<string, ProviderPreset> = Object.fromEntries(
  Object.entries(PROVIDER_PRESETS).filter(
    ([_, preset]) => preset.defaults.provider && isProductionProvider(preset.defaults.provider as LlmProvider),
  ),
);

/** @deprecated Use PRODUCTION_PRESETS instead. */
export const getProductionPresets = (): Record<string, ProviderPreset> => PRODUCTION_PRESETS;

/** Check if a provider string is a production-allowed provider. Re-exported for UI convenience. */
export { isProductionProvider };
export type { LlmProvider };
