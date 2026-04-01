import { type LlmProvider, isProductionProvider } from '@offisim/shared-types';

export function assertBrowserProviderAllowed(provider: LlmProvider, isDev: boolean): void {
  if (provider === 'subscription') {
    throw new Error(
      'Provider "subscription" requires Node.js (child_process) and is only available in the desktop app. ' +
        'In browser, use an HTTP-based provider for development/testing.',
    );
  }

  if (!isDev && !isProductionProvider(provider)) {
    throw new Error(
      `Provider "${provider}" is not allowed in production runtime. Only self-developed transport adapters are valid production providers. In development mode, vendor adapters are available for testing.`,
    );
  }
}
