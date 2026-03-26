import { describe, expect, it, vi } from 'vitest';
import { LlmError } from '../../errors.js';
import { type RetryConfig, withRetry } from '../../llm/retry.js';

const FAST_CONFIG: RetryConfig = { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 };

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, FAST_CONFIG, () => true);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new LlmError('rate limited', 'anthropic', 429))
      .mockResolvedValue('ok');
    const result = await withRetry(fn, FAST_CONFIG, (e) => e instanceof LlmError && e.recoverable);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new LlmError('bad request', 'anthropic', 400));
    await expect(
      withRetry(fn, FAST_CONFIG, (e) => e instanceof LlmError && e.recoverable),
    ).rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new LlmError('server error', 'anthropic', 500));
    await expect(
      withRetry(fn, FAST_CONFIG, (e) => e instanceof LlmError && e.recoverable),
    ).rejects.toThrow('server error');
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it('applies exponential backoff with jitter', async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    // biome-ignore lint/suspicious/noExplicitAny: setTimeout mock signature override
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any, ms?: number) => {
      delays.push(ms ?? 0);
      return originalSetTimeout(fn, 0); // run immediately for test speed
    });

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new LlmError('err', 'anthropic', 429))
      .mockRejectedValueOnce(new LlmError('err', 'anthropic', 429))
      .mockResolvedValue('ok');

    await withRetry(fn, { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5000 }, () => true);

    expect(delays.length).toBe(2);
    // First delay should be around 100ms (with jitter)
    expect(delays[0]).toBeGreaterThanOrEqual(50);
    expect(delays[0]).toBeLessThanOrEqual(200);
    // Second delay should be larger (exponential)
    const firstDelay = delays[0];
    const secondDelay = delays[1];
    expect(firstDelay).toBeDefined();
    expect(secondDelay).toBeDefined();
    if (firstDelay === undefined || secondDelay === undefined) {
      throw new Error('Expected retry delays to be recorded');
    }
    expect(secondDelay).toBeGreaterThan(firstDelay);

    vi.restoreAllMocks();
  });
});
