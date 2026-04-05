import { createMiddleware } from 'hono/factory';
import type { PlatformEnv } from '../types.js';

const SAFE_REQUEST_ID = /^[\w-]{1,128}$/;

export const requestId = createMiddleware<PlatformEnv>(async (c, next) => {
  const clientId = c.req.header('x-request-id');
  const id = clientId && SAFE_REQUEST_ID.test(clientId) ? clientId : crypto.randomUUID();
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  await next();
});
