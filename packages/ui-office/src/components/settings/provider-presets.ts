import type { ProviderConfig } from '../../lib/provider-config';

export interface ProviderPreset {
  label: string;
  defaults: Partial<ProviderConfig>;
  /** Provider always returns thinking/reasoning blocks that consume max_tokens budget. */
  hasThinking?: boolean;
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
  minimax: {
    label: 'MiniMax',
    defaults: {
      provider: 'anthropic',
      baseURL: 'https://api.minimax.io/anthropic',
      model: 'MiniMax-M2.7-highspeed',
    },
    hasThinking: true,
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
  lmstudio: {
    label: 'LM Studio (Local)',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'http://localhost:1234/v1',
      model: 'qwen/qwen3.5-9b',
      apiKey: 'lm-studio',
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
