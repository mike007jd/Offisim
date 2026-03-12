import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { PlatformEnv } from '../types.js';

/**
 * Optional auth: extracts user info from Bearer token if present.
 * For 1.0 dev mode, accepts a simple JSON payload in base64 (header.payload.sig).
 * Production should use proper JWT validation.
 */
export const optionalAuth = createMiddleware<PlatformEnv>(async (c, next) => {
  const authHeader = c.req.header('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      // Dev mode: base64-decode the payload segment of a JWT-like token
      const payloadB64 = token.split('.')[1];
      if (payloadB64) {
        const payload = JSON.parse(atob(payloadB64));
        if (payload.sub) c.set('userId', payload.sub);
        if (payload.email) c.set('userEmail', payload.email);
      }
    } catch {
      // Invalid token format — ignore, treat as unauthenticated
    }
  }
  await next();
});

/**
 * Required auth guard — returns 401 if no user extracted.
 */
export const requireAuth = createMiddleware<PlatformEnv>(async (c, next) => {
  if (!c.get('userId')) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  await next();
});
