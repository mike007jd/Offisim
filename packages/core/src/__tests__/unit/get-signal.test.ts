import { describe, expect, it } from 'vitest';
import { getConfigSignal } from '../../utils/get-signal.js';

describe('getConfigSignal', () => {
  it('returns the AbortSignal when present in config.configurable', () => {
    const controller = new AbortController();
    const config = { configurable: { signal: controller.signal } };
    expect(getConfigSignal(config)).toBe(controller.signal);
  });

  it('returns undefined when config is an empty object', () => {
    expect(getConfigSignal({})).toBeUndefined();
  });

  it('returns undefined when configurable is missing', () => {
    expect(getConfigSignal({ tags: [] })).toBeUndefined();
  });

  it('returns undefined when signal key is absent from configurable', () => {
    const config = { configurable: { runtimeCtx: {} } };
    expect(getConfigSignal(config)).toBeUndefined();
  });

  it('returns undefined when configurable is null', () => {
    const config = { configurable: null as unknown as Record<string, unknown> };
    expect(getConfigSignal(config)).toBeUndefined();
  });
});
