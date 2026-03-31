import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../middleware/error-handler.js';
import type { PlatformEnv } from '../types.js';

function createApp(error: unknown) {
  const app = new Hono<PlatformEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', 'test-error-req');
    await next();
  });
  app.get('/boom', () => {
    throw error;
  });
  app.onError(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('maps postgres auth failures wrapped by drizzle to 503', async () => {
    const err = new Error('Failed query');
    err.cause = { code: '28P01', name: 'PostgresError' };
    const app = createApp(err);

    const res = await app.request('/boom');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable',
      },
    });
  });

  it('maps socket-level connection failures to 503', async () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const app = createApp(err);

    const res = await app.request('/boom');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable',
      },
    });
  });
});
