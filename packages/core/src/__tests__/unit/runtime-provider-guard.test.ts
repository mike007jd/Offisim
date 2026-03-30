/**
 * Guard test: Production runtime must reject vendor-direct providers.
 * See CLAUDE.md — AI Runtime Policy.
 */
import { describe, expect, it } from 'vitest';
import { isProductionProvider } from '@offisim/shared-types';
import type { LlmProvider } from '@offisim/shared-types';

describe('AI Runtime Policy — provider classification', () => {
  it('subscription is a production provider', () => {
    expect(isProductionProvider('subscription')).toBe(true);
  });

  it.each(['openai', 'anthropic', 'openai-compat'] as LlmProvider[])(
    '%s is NOT a production provider',
    (provider) => {
      expect(isProductionProvider(provider)).toBe(false);
    },
  );

  it('type system distinguishes SelfDeveloped from AdapterOnly', () => {
    // This test documents the type contract — if the union changes,
    // this file must be reviewed against AI Runtime Policy.
    const selfDeveloped: LlmProvider = 'subscription';
    const adapterOnly: LlmProvider = 'openai';
    expect(isProductionProvider(selfDeveloped)).toBe(true);
    expect(isProductionProvider(adapterOnly)).toBe(false);
  });
});
