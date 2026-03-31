import { describe, expect, it } from 'vitest';
import { assertBrowserProviderAllowed } from './browser-provider-guard';

describe('browser runtime provider guard', () => {
  it('rejects subscription in browser with a desktop-only error', () => {
    expect(() => assertBrowserProviderAllowed('subscription', true)).toThrow(/desktop app/i);
  });

  it('rejects vendor-direct providers in non-dev browser runtime', () => {
    expect(() => assertBrowserProviderAllowed('anthropic', false)).toThrow(
      /not allowed in production runtime/i,
    );
  });

  it('allows vendor-direct providers in browser dev mode', () => {
    expect(() => assertBrowserProviderAllowed('anthropic', true)).not.toThrow();
    expect(() => assertBrowserProviderAllowed('openai-compat', true)).not.toThrow();
  });
});
