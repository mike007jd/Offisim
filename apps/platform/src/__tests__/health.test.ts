import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../middleware/error-handler.js';
import { health } from '../routes/health.js';
import type { PlatformEnv } from '../types.js';

type MockDb = PlatformEnv['Variables']['db'];

function createApp(mockDb: MockDb) {
  const app = new Hono<PlatformEnv>();
  app.use('*', async (c, next) => {
    c.set('db', mockDb);
    c.set('requestId', 'test-health-req');
    await next();
  });
  app.route('/', health);
  app.onError(errorHandler);
  return app;
}

describe('Health Route', () => {
  it('returns ok when the database probe succeeds', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    } as unknown as MockDb;
    const app = createApp(mockDb);

    const res = await app.request('/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  it('returns degraded when the database probe fails', async () => {
    const mockDb = {
      execute: vi.fn().mockRejectedValue(new Error('db down')),
    } as unknown as MockDb;
    const app = createApp(mockDb);

    const res = await app.request('/health');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'degraded', db: 'unreachable' });
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });
});
