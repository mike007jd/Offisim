import type { LlmProvider } from '@offisim/shared-types';
import type {
  ProviderCapabilities,
  ProviderCompatibility,
  ProviderConfig,
  ProviderRegion,
  ProviderSurface,
  ProviderVendor,
} from '../../lib/provider-config';

export interface ProviderPreset {
  label: string;
  vendor: ProviderVendor;
  region: ProviderRegion;
  compatibility: ProviderCompatibility;
  surface: ProviderSurface;
  defaults: Partial<ProviderConfig>;
  capabilities: ProviderCapabilities;
  recommendedModels?: string[];
  hasThinking?: boolean;
}

function createCapabilities(overrides: Partial<ProviderCapabilities>): ProviderCapabilities {
  return {
    streaming: true,
    thinking: false,
    toolCalls: false,
    toolStreaming: false,
    codingPlan: false,
    ...overrides,
  };
}

function createPreset(
  label: string,
  metadata: {
    vendor: ProviderVendor;
    region: ProviderRegion;
    compatibility: ProviderCompatibility;
    surface: ProviderSurface;
    defaults: Partial<ProviderConfig> & { provider: LlmProvider };
    capabilities: ProviderCapabilities;
    recommendedModels?: string[];
  },
): ProviderPreset {
  return {
    label,
    ...metadata,
    defaults: {
      ...metadata.defaults,
      vendor: metadata.vendor,
      region: metadata.region,
      compatibility: metadata.compatibility,
      surface: metadata.surface,
      capabilities: metadata.capabilities,
    },
    hasThinking: metadata.capabilities.thinking,
  };
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  subscription: createPreset('Subscription', {
    vendor: 'offisim',
    region: 'local',
    compatibility: 'native',
    surface: 'desktop-subscription',
    defaults: {
      provider: 'subscription',
      model: 'default',
      apiKey: '',
      acpCommand: 'claude',
      acpArgs: ['acp'],
    },
    capabilities: createCapabilities({
      toolCalls: true,
    }),
  }),
  'minimax-intl-anthropic-coding': createPreset('MiniMax Intl · Claude Code', {
    vendor: 'minimax',
    region: 'intl',
    compatibility: 'anthropic-compatible',
    surface: 'coding-plan',
    defaults: {
      provider: 'anthropic',
      baseURL: 'https://api.minimax.io/anthropic',
      model: 'MiniMax-M2.7',
    },
    capabilities: createCapabilities({
      thinking: true,
      toolCalls: true,
      codingPlan: true,
    }),
    recommendedModels: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
  }),
  'minimax-cn-anthropic-coding': createPreset('MiniMax CN · Claude Code', {
    vendor: 'minimax',
    region: 'cn',
    compatibility: 'anthropic-compatible',
    surface: 'coding-plan',
    defaults: {
      provider: 'anthropic',
      baseURL: 'https://api.minimaxi.com/anthropic',
      model: 'MiniMax-M2.7',
    },
    capabilities: createCapabilities({
      thinking: true,
      toolCalls: true,
      codingPlan: true,
    }),
    recommendedModels: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
  }),
  'kimi-cn-anthropic-coding': createPreset('Kimi CN · Claude Code', {
    vendor: 'kimi',
    region: 'cn',
    compatibility: 'anthropic-compatible',
    surface: 'coding-plan',
    defaults: {
      provider: 'anthropic',
      baseURL: 'https://api.moonshot.cn/anthropic',
      model: 'kimi-k2.5',
    },
    capabilities: createCapabilities({
      thinking: true,
      toolCalls: true,
      codingPlan: true,
    }),
    recommendedModels: ['kimi-k2.5', 'kimi-k2-thinking'],
  }),
  'kimi-cn-openai-general': createPreset('Kimi CN · General API', {
    vendor: 'kimi',
    region: 'cn',
    compatibility: 'openai-compatible',
    surface: 'general',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://api.moonshot.cn/v1',
      model: 'kimi-k2.5',
    },
    capabilities: createCapabilities({
      thinking: true,
      toolCalls: true,
    }),
    recommendedModels: ['kimi-k2.5', 'kimi-k2-thinking'],
  }),
  'kimi-intl-openai-general': createPreset('Kimi Intl · General API', {
    vendor: 'kimi',
    region: 'intl',
    compatibility: 'openai-compatible',
    surface: 'general',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://api.moonshot.ai/v1',
      model: 'kimi-k2.5',
    },
    capabilities: createCapabilities({
      thinking: true,
      toolCalls: true,
    }),
    recommendedModels: ['kimi-k2.5', 'kimi-k2-thinking'],
  }),
  'zai-shared-anthropic-coding': createPreset('Z.AI · Claude Code', {
    vendor: 'zai',
    region: 'shared',
    compatibility: 'anthropic-compatible',
    surface: 'coding-plan',
    defaults: {
      provider: 'anthropic',
      baseURL: 'https://api.z.ai/api/anthropic',
      model: 'GLM-4.7',
    },
    capabilities: createCapabilities({
      thinking: true,
      toolCalls: true,
      codingPlan: true,
    }),
    recommendedModels: ['GLM-4.7', 'GLM-4.5-Air'],
  }),
  'zai-shared-openai-general': createPreset('Z.AI · General API', {
    vendor: 'zai',
    region: 'shared',
    compatibility: 'openai-compatible',
    surface: 'general',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://api.z.ai/api/paas/v4',
      model: 'glm-4.5-air',
    },
    capabilities: createCapabilities({
      thinking: true,
      toolCalls: true,
    }),
    recommendedModels: ['glm-4.5-air', 'glm-4.5v'],
  }),
  'zai-shared-openai-coding': createPreset('Z.AI · Coding API', {
    vendor: 'zai',
    region: 'shared',
    compatibility: 'openai-compatible',
    surface: 'coding-plan',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://api.z.ai/api/coding/paas/v4',
      model: 'glm-5.1',
    },
    capabilities: createCapabilities({
      thinking: true,
      toolCalls: true,
      codingPlan: true,
    }),
    recommendedModels: ['glm-5.1', 'glm-5'],
  }),
  'gemini-openai-general': createPreset('Google Gemini', {
    vendor: 'google',
    region: 'shared',
    compatibility: 'openai-compatible',
    surface: 'general',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
    },
    capabilities: createCapabilities({
      thinking: true,
      toolCalls: true,
    }),
  }),
  'deepseek-openai-general': createPreset('DeepSeek', {
    vendor: 'deepseek',
    region: 'shared',
    compatibility: 'openai-compatible',
    surface: 'general',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-reasoner',
    },
    capabilities: createCapabilities({
      thinking: true,
      toolCalls: true,
    }),
  }),
  'openrouter-openai-general': createPreset('OpenRouter', {
    vendor: 'openrouter',
    region: 'shared',
    compatibility: 'openai-compatible',
    surface: 'general',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'https://openrouter.ai/api/v1',
      model: 'google/gemma-3-4b-it:free',
    },
    capabilities: createCapabilities({
      toolCalls: true,
    }),
  }),
  'openai-default': createPreset('OpenAI', {
    vendor: 'openai',
    region: 'shared',
    compatibility: 'native',
    surface: 'general',
    defaults: {
      provider: 'openai',
      model: 'gpt-4o-mini',
    },
    capabilities: createCapabilities({
      toolCalls: true,
    }),
  }),
  'anthropic-default': createPreset('Anthropic', {
    vendor: 'anthropic',
    region: 'shared',
    compatibility: 'native',
    surface: 'general',
    defaults: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
    },
    capabilities: createCapabilities({
      thinking: true,
      toolCalls: true,
    }),
  }),
  lmstudio: createPreset('LM Studio (Local)', {
    vendor: 'lmstudio',
    region: 'local',
    compatibility: 'openai-compatible',
    surface: 'general',
    defaults: {
      provider: 'openai-compat',
      baseURL: 'http://localhost:1234/v1',
      model: 'qwen/qwen3.5-9b',
      apiKey: 'lm-studio',
    },
    capabilities: createCapabilities({}),
  }),
  custom: createPreset('Custom (OpenAI-compatible)', {
    vendor: 'custom',
    region: 'shared',
    compatibility: 'openai-compatible',
    surface: 'general',
    defaults: {
      provider: 'openai-compat',
      model: '',
    },
    capabilities: createCapabilities({}),
  }),
};

/** Default preset key when no config is saved. */
export const DEFAULT_PRESET_KEY = 'minimax-intl-anthropic-coding';

export function getProviderPreset(key: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS[key];
}

export function findProviderPresetKeyByConfig(
  config: Partial<ProviderConfig> | null,
): string | null {
  if (!config) return null;

  if (config.providerVariantId && PROVIDER_PRESETS[config.providerVariantId]) {
    return config.providerVariantId;
  }

  const match = Object.entries(PROVIDER_PRESETS).find(([, preset]) => {
    return (
      preset.defaults.provider === config.provider &&
      preset.defaults.baseURL === config.baseURL &&
      (config.surface ? preset.surface === config.surface : true)
    );
  });

  return match?.[0] ?? null;
}

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
}): string {
  return options.tauri ? 'subscription' : DEFAULT_PRESET_KEY;
}

export type { LlmProvider };
