import { createMiddleware } from 'hono/factory';
import type { PlatformEnv } from '../types.js';

export const requestId = createMiddleware<PlatformEnv>(async (c, next) => {
  const id = c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  await next();
});
