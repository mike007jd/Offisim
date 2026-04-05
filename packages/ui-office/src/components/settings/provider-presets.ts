import type { LlmProvider } from '@offisim/shared-types';
import type { ProviderConfig } from '../../lib/provider-config';

export interface ProviderPreset {
  label: string;
  defaults: Partial<ProviderConfig>;
  /** Provider always returns thinking/reasoning blocks that consume max_tokens budget. */
  hasThinking?: boolean;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  subscription: {
    label: 'Subscription',
    defaults: {
      provider: 'subscription',
      model: 'default',
      apiKey: '',
      acpCommand: 'claude',
      acpArgs: ['acp'],
    },
  },
  gemini: {
    label: 'Google Gemini',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
    },
    hasThinking: true,
  },
  deepseek: {
    label: 'DeepSeek',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-reasoner',
    },
    hasThinking: true,
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
    hasThinking: true,
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

/** Default preset key when no config is saved. */
export const DEFAULT_PRESET_KEY = 'minimax';

/**
 * Returns the presets available in the current environment.
 *
 * `subscription` requires Node.js (`claude acp` via `node:child_process`) and is only
 * available in the desktop build — browser callers see it filtered out.
 */
export function getAvailableProviderPresets(options: {
  tauri: boolean;
}): Record<string, ProviderPreset> {
  if (options.tauri) return PROVIDER_PRESETS;
  return Object.fromEntries(
    Object.entries(PROVIDER_PRESETS).filter(([key]) => key !== 'subscription'),
  );
}

export function getDefaultProviderPresetKey(options: {
  tauri: boolean;
}): keyof typeof PROVIDER_PRESETS {
  return options.tauri ? 'subscription' : DEFAULT_PRESET_KEY;
}

export type { LlmProvider };
