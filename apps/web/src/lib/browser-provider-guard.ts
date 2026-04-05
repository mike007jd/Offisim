import type { LlmProvider } from '@offisim/shared-types';

/**
 * The `subscription` adapter runs `claude acp` via `node:child_process`
 * and cannot execute in a browser renderer. All other providers are
 * BYO-key adapters and are allowed in both browser and desktop.
 */
export function assertBrowserProviderAllowed(provider: LlmProvider): void {
  if (provider === 'subscription') {
    throw new Error(
      'Provider "subscription" requires Node.js (child_process) and is only available in the desktop app. ' +
        'Use an HTTP-based provider (OpenAI, Anthropic, MiniMax, OpenAI-compat) in the browser.',
    );
  }
}
