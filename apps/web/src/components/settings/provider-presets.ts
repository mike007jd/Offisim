import type { ProviderConfig } from '../../lib/provider-config';

export interface ProviderPreset {
  label: string;
  defaults: Partial<ProviderConfig>;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  gemini: {
    label: 'Google Gemini',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
    },
  },
  openrouter: {
    label: 'OpenRouter',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'google/gemma-3-4b-it:free',
    },
  },
  kimi: {
    label: 'Kimi',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://api.kimi.com/coding/v1',
      model: 'kimi-for-coding',
      defaultHeaders: { 'User-Agent': 'claude-code/1.0.0' },
    },
  },
  openai: {
    label: 'OpenAI',
    defaults: {
      provider: 'openai',
      model: 'gpt-4o-mini',
    },
  },
  anthropic: {
    label: 'Anthropic',
    defaults: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    },
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    defaults: {
      provider: 'openai-compat',
      model: '',
    },
  },
};
