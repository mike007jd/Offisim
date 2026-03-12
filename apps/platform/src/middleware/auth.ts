import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { PlatformEnv } from '../types.js';

/**
 * SECURITY: The dev-mode auth below does NOT verify JWT signatures — it trusts
 * the base64-decoded payload blindly. This is acceptable ONLY when
 * AICS_AUTH_MODE=dev (the default for local development).
 *
 * In production, replace this middleware with real JWT validation (e.g. jose /
 * jsonwebtoken with JWKS). Never deploy with AICS_AUTH_MODE=dev.
 */

const authMode = process.env.AICS_AUTH_MODE ?? 'dev';
if (authMode !== 'dev') {
  console.warn(
    `[auth] AICS_AUTH_MODE="${authMode}" but the current auth middleware only supports dev-mode ` +
      `JWT parsing (no signature verification). Refusing to use insecure dev auth in non-dev mode. ` +
      `Implement proper JWT validation before deploying.`,
  );
}

export const optionalAuth = createMiddleware<PlatformEnv>(async (c, next) => {
  const authHeader = c.req.header('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    // Only perform dev-mode (unverified) JWT parsing when explicitly in dev mode
    if (authMode !== 'dev') {
      // In non-dev mode, skip unverified parsing entirely — treat as unauthenticated
      // until a real JWT validator is wired in.
      await next();
      return;
    }

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
