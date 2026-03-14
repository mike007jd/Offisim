import * as jose from 'jose';
import { createMiddleware } from 'hono/factory';
import type { PlatformEnv } from '../types.js';

/**
 * JWT Auth Middleware — dual-mode validation.
 *
 * - `AICS_AUTH_MODE=dev` (default): base64-decode JWT payload without signature
 *   verification. Logs a loud console.warn on every startup. Acceptable ONLY
 *   for local development.
 *
 * - Any other value (production / staging): verify JWT signature using either
 *   `AICS_JWT_SECRET` (HMAC HS256) or `AICS_JWKS_URL` (RS256 via JWKS).
 *   Rejects expired tokens. Returns 401 on any verification failure.
 */

const authMode = process.env.AICS_AUTH_MODE ?? 'dev';
const jwtSecret = process.env.AICS_JWT_SECRET;
const jwksUrl = process.env.AICS_JWKS_URL;

if (authMode === 'dev') {
  console.warn(
    '[auth] WARNING: Running in dev mode — JWT signatures are NOT verified. ' +
      'Do NOT deploy with AICS_AUTH_MODE=dev.',
  );
}

// Build JWKS remote key set lazily (only in non-dev mode with JWKS URL)
let jwks: ReturnType<typeof jose.createRemoteJWKSet> | undefined;
if (authMode !== 'dev' && jwksUrl) {
  jwks = jose.createRemoteJWKSet(new URL(jwksUrl));
}

// Build HMAC secret key (only in non-dev mode with shared secret)
let hmacSecret: Uint8Array | undefined;
if (authMode !== 'dev' && jwtSecret) {
  hmacSecret = new TextEncoder().encode(jwtSecret);
}

/**
 * Verify a JWT token in production mode.
 * Returns the payload on success, or null on failure.
 */
async function verifyToken(
  token: string,
): Promise<{ sub?: string; email?: string } | null> {
  try {
    if (hmacSecret) {
      const { payload } = await jose.jwtVerify(token, hmacSecret, {
        clockTolerance: 30, // 30 seconds leeway
      });
      return payload as { sub?: string; email?: string };
    }
    if (jwks) {
      const { payload } = await jose.jwtVerify(token, jwks, {
        clockTolerance: 30,
      });
      return payload as { sub?: string; email?: string };
    }
    // No verification method configured — reject
    console.error(
      '[auth] Non-dev mode but neither AICS_JWT_SECRET nor AICS_JWKS_URL is configured. ' +
        'All tokens will be rejected.',
    );
    return null;
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      // Specific: token has expired
      return null;
    }
    // Any other verification error (bad signature, malformed, etc.)
    return null;
  }
}

export const optionalAuth = createMiddleware<PlatformEnv>(async (c, next) => {
  const authHeader = c.req.header('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);

    if (authMode === 'dev') {
      // Dev mode: base64-decode the payload segment without signature verification
      try {
        const payloadB64 = token.split('.')[1];
        if (payloadB64) {
          const payload = JSON.parse(atob(payloadB64));
          if (payload.sub) c.set('userId', payload.sub);
          if (payload.email) c.set('userEmail', payload.email);

          // Check exp claim even in dev mode (best-effort)
          if (payload.exp && typeof payload.exp === 'number') {
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp < now) {
              // Expired in dev mode — warn but still allow (dev convenience)
              console.warn('[auth/dev] Token is expired — allowing anyway in dev mode');
            }
          }
        }
      } catch {
        // Invalid token format — treat as unauthenticated
      }
    } else {
      // Production / staging mode: verify JWT signature + expiry
      const payload = await verifyToken(token);
      if (payload) {
        if (payload.sub) c.set('userId', payload.sub);
        if (payload.email) c.set('userEmail', payload.email);
      }
      // If verification fails, request proceeds as unauthenticated
    }
  }
  await next();
});

/**
 * Required auth guard — returns 401 JSON if no user extracted.
 */
export const requireAuth = createMiddleware<PlatformEnv>(async (c, next) => {
  if (!c.get('userId')) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      },
      401,
    );
  }
  await next();
});
