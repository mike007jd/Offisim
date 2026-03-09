import type { LlmProvider } from '@aics/shared-types';
import { AnthropicAdapter } from './anthropic-adapter.js';
import type { LlmGateway } from './gateway.js';
import { OpenAiAdapter } from './openai-adapter.js';
import type { RetryConfig } from './retry.js';

export interface GatewayConfig {
  provider: LlmProvider;
  apiKey: string;
  /** Required for 'openai-compat' provider */
  baseURL?: string;
  /** Extra headers for compat endpoints (e.g. HTTP-Referer for OpenRouter) */
  defaultHeaders?: Record<string, string>;
  /** Override default retry behaviour (3 retries, 1-30 s exponential backoff) */
  retryConfig?: RetryConfig;
  /** Allow browser-side API calls (required for apps/web and Tauri desktop) */
  dangerouslyAllowBrowser?: boolean;
}

/**
 * Create an LlmGateway instance from a provider config.
 *
 * Inspired by Vercel AI SDK's `createOpenAICompatible` factory pattern.
 * All OpenAI-compatible endpoints (OpenRouter, Kimi, Gemini, Ollama, etc.)
 * use `provider: 'openai-compat'` with their respective `baseURL`.
 */
export function createGateway(config: GatewayConfig): LlmGateway {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicAdapter(config.apiKey, { retryConfig: config.retryConfig });
    case 'openai':
      return new OpenAiAdapter(config.apiKey, {
        retryConfig: config.retryConfig,
        dangerouslyAllowBrowser: config.dangerouslyAllowBrowser,
      });
    case 'openai-compat':
      if (!config.baseURL) {
        throw new Error("'openai-compat' provider requires a baseURL");
      }
      return new OpenAiAdapter(config.apiKey, {
        baseURL: config.baseURL,
        defaultHeaders: config.defaultHeaders,
        retryConfig: config.retryConfig,
        dangerouslyAllowBrowser: config.dangerouslyAllowBrowser,
      });
    default:
      throw new Error(`Unknown provider: ${config.provider as string}`);
  }
}
