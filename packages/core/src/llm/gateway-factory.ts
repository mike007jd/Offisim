import type { LlmProvider } from '@aics/shared-types';
import type { LlmGateway } from './gateway.js';
import { AnthropicAdapter } from './anthropic-adapter.js';
import { OpenAiAdapter } from './openai-adapter.js';

export interface GatewayConfig {
  provider: LlmProvider;
  apiKey: string;
  /** Required for 'openai-compat' provider */
  baseURL?: string;
  /** Extra headers for compat endpoints (e.g. HTTP-Referer for OpenRouter) */
  defaultHeaders?: Record<string, string>;
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
      return new AnthropicAdapter(config.apiKey);
    case 'openai':
      return new OpenAiAdapter(config.apiKey);
    case 'openai-compat':
      if (!config.baseURL) {
        throw new Error("'openai-compat' provider requires a baseURL");
      }
      return new OpenAiAdapter(config.apiKey, {
        baseURL: config.baseURL,
        defaultHeaders: config.defaultHeaders,
      });
    default:
      throw new Error(`Unknown provider: ${config.provider as string}`);
  }
}
