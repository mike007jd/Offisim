import { describe, expect, it } from 'vitest';
import { assertBrowserProviderAllowed } from './browser-provider-guard';

describe('browser runtime provider guard', () => {
  it('rejects subscription in browser with a desktop-only error', () => {
    expect(() => assertBrowserProviderAllowed('subscription')).toThrow(/desktop app/i);
  });

  it('allows HTTP-based providers in the browser', () => {
    expect(() => assertBrowserProviderAllowed('anthropic')).not.toThrow();
    expect(() => assertBrowserProviderAllowed('openai')).not.toThrow();
    expect(() => assertBrowserProviderAllowed('openai-compat')).not.toThrow();
  });
});
