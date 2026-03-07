import { describe, expect, it } from 'vitest';
import { ModelResolver } from '../../llm/model-resolver.js';
import type { ModelPolicyConfig } from '@aics/shared-types';

const DEFAULT_POLICY: ModelPolicyConfig = {
  default: {
    profileName: 'balanced',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.7,
    maxTokens: 4096,
  },
  overrides: {
    developer: {
      profileName: 'code-first',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      temperature: 0.3,
      maxTokens: 8192,
    },
  },
};

describe('ModelResolver', () => {
  it('resolves from employee preferred profile', () => {
    const resolver = new ModelResolver(DEFAULT_POLICY);
    const result = resolver.resolve({
      profileName: 'fast',
      provider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.5,
      maxTokens: 2048,
    });
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.temperature).toBe(0.5);
    expect(result.maxTokens).toBe(2048);
  });

  it('falls back to role override when no employee profile', () => {
    const resolver = new ModelResolver(DEFAULT_POLICY);
    const result = resolver.resolve(undefined, 'developer');
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.temperature).toBe(0.3);
    expect(result.maxTokens).toBe(8192);
  });

  it('falls back to company default when no match', () => {
    const resolver = new ModelResolver(DEFAULT_POLICY);
    const result = resolver.resolve(undefined, 'designer');
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-4-20250514');
    expect(result.temperature).toBe(0.7);
    expect(result.maxTokens).toBe(4096);
  });

  it('falls back to hardcoded default when policy is null', () => {
    const resolver = new ModelResolver(null);
    const result = resolver.resolve();
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBeDefined();
    expect(result.temperature).toBeGreaterThan(0);
    expect(result.maxTokens).toBeGreaterThan(0);
  });

  it('uses defaults for missing temperature/maxTokens in profile', () => {
    const resolver = new ModelResolver(DEFAULT_POLICY);
    const result = resolver.resolve({
      profileName: 'minimal',
      provider: 'openai',
      model: 'gpt-4o',
    });
    expect(result.temperature).toBe(0.7);
    expect(result.maxTokens).toBe(4096);
  });
});
