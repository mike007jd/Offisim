import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { _resetRateLimitStore, rateLimit } from '../middleware/rate-limit.js';
import type { PlatformEnv } from '../types.js';

afterEach(() => {
  _resetRateLimitStore();
});

function createApp(maxTokens: number, refillRate: number) {
  const app = new Hono<PlatformEnv>();
  const limiter = rateLimit({ maxTokens, refillRate, label: 'test' });
  app.use('*', limiter);
  app.get('/test', (c) => c.json({ ok: true }));
  return app;
}

describe('Rate Limit Middleware', () => {
  it('allows requests under the limit', async () => {
    const app = createApp(5, 5 / 60);

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('4');
  });

  it('allows requests up to the limit', async () => {
    const app = createApp(3, 3 / 60);

    // First 3 requests should pass
    for (let i = 0; i < 3; i++) {
      const res = await app.request('/test');
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 when limit is exceeded', async () => {
    const app = createApp(2, 2 / 60);

    // Exhaust tokens
    await app.request('/test');
    await app.request('/test');

    // Third request should be rate limited
    const res = await app.request('/test');
    expect(res.status).toBe(429);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.retry_after).toBeGreaterThan(0);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('includes rate limit headers in all responses', async () => {
    const app = createApp(10, 10 / 60);

    const res = await app.request('/test');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('9');
  });

  it('separates rate limits by client IP (X-Forwarded-For)', async () => {
    const app = createApp(1, 1 / 60);

    // Client A exhausts their limit
    const resA1 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '1.1.1.1' },
    });
    expect(resA1.status).toBe(200);

    const resA2 = await app.request('/test', {
      headers: { 'X-Forwarded-For': '1.1.1.1' },
    });
    expect(resA2.status).toBe(429);

    // Client B should still have their limit
    const resB = await app.request('/test', {
      headers: { 'X-Forwarded-For': '2.2.2.2' },
    });
    expect(resB.status).toBe(200);
  });

  it('refills tokens over time', async () => {
    const app = createApp(1, 1000); // Very high refill rate for testing

    // Exhaust
    await app.request('/test');

    // Wait a tiny bit for refill (1000 tokens/sec = 1 token per ms)
    await new Promise((r) => setTimeout(r, 10));

    // Should be allowed again
    const res = await app.request('/test');
    expect(res.status).toBe(200);
  });
});
