import type { LlmProvider } from '@offisim/shared-types';
import { AnthropicAdapter } from './anthropic-adapter.js';
import type { LlmGateway } from './gateway.js';
import { OpenAiAdapter } from './openai-adapter.js';
import type { RetryConfig } from './retry.js';
import type { SubscriptionAdapterOptions } from './subscription-adapter.js';

// [provider-trace] module-local apiKey fingerprint for boss-scope 401 diagnostic.
// Remove together with all `[provider-trace/*]` console.debug sites in clean-up step.
function fpShort(key: string | undefined): string {
  if (!key) return '(none)';
  if (key.length < 8) return '(too-short)';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

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
  /** Subscription-mode (ACP) options — command path, args, env */
  subscription?: SubscriptionAdapterOptions;
}

export function shouldRejectSubscriptionInRenderer(
  hasWindow: boolean,
  dangerouslyAllowBrowser?: boolean,
): boolean {
  return hasWindow && !dangerouslyAllowBrowser;
}

/**
 * Create an LlmGateway instance from a provider config.
 *
 * Inspired by Vercel AI SDK's `createOpenAICompatible` factory pattern.
 * All OpenAI-compatible endpoints (OpenRouter, Kimi, Gemini, Ollama, etc.)
 * use `provider: 'openai-compat'` with their respective `baseURL`.
 */
export function createGateway(config: GatewayConfig): LlmGateway {
  console.debug('[provider-trace/createGateway]', {
    provider: config.provider,
    baseURL: config.baseURL ?? '(undefined)',
    hasApiKey: !!config.apiKey,
    apiKeyFp: fpShort(config.apiKey),
  });
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicAdapter(config.apiKey, {
        baseURL: config.baseURL,
        defaultHeaders: config.defaultHeaders,
        retryConfig: config.retryConfig,
        dangerouslyAllowBrowser: config.dangerouslyAllowBrowser,
      });
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
    case 'subscription': {
      if (
        shouldRejectSubscriptionInRenderer(
          typeof globalThis.window !== 'undefined',
          config.dangerouslyAllowBrowser,
        )
      ) {
        throw new Error(
          'Provider "subscription" requires Node.js (child_process) and cannot run in the browser. ' +
            'Use assertBrowserProviderAllowed() to guard before calling createGateway().',
        );
      }
      // Dynamic require — keeps node:child_process out of browser bundles.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      type SubscriptionModule = typeof import('./subscription-adapter.js');
      let subscriptionModule: SubscriptionModule;
      try {
        subscriptionModule = require('./subscription-adapter.js');
      } catch {
        // In direct TypeScript execution, the .ts path exists before build output.
        subscriptionModule = require('./subscription-adapter.ts') as SubscriptionModule;
      }
      const { SubscriptionAdapter } = subscriptionModule;
      return new SubscriptionAdapter(config.subscription);
    }
    default:
      throw new Error(`Unknown provider: ${config.provider as string}`);
  }
}
