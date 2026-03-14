import * as jose from 'jose';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { PlatformEnv } from '../types.js';

// We need to test auth middleware in isolation. Since the module reads env vars
// at import time, we use dynamic imports with env manipulation.

function makeDevToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'none' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

// ── Dev mode tests (default) ──

describe('Auth Middleware (dev mode)', () => {
  it('extracts user from dev token', async () => {
    // Default AICS_AUTH_MODE is 'dev' — import should work
    const { optionalAuth } = await import('../middleware/auth.js');

    const app = new Hono<PlatformEnv>();
    app.use('*', optionalAuth);
    app.get('/test', (c) => {
      return c.json({ userId: c.get('userId'), email: c.get('userEmail') });
    });

    const token = makeDevToken({ sub: 'user-123', email: 'test@example.com' });
    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.userId).toBe('user-123');
    expect(body.email).toBe('test@example.com');
  });

  it('treats request as unauthenticated when no token', async () => {
    const { optionalAuth } = await import('../middleware/auth.js');

    const app = new Hono<PlatformEnv>();
    app.use('*', optionalAuth);
    app.get('/test', (c) => {
      return c.json({ userId: c.get('userId') ?? null });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.userId).toBeNull();
  });

  it('treats invalid token format as unauthenticated', async () => {
    const { optionalAuth } = await import('../middleware/auth.js');

    const app = new Hono<PlatformEnv>();
    app.use('*', optionalAuth);
    app.get('/test', (c) => {
      return c.json({ userId: c.get('userId') ?? null });
    });

    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer not-a-jwt' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.userId).toBeNull();
  });

  it('allows expired tokens in dev mode (with warning)', async () => {
    const { optionalAuth } = await import('../middleware/auth.js');

    const app = new Hono<PlatformEnv>();
    app.use('*', optionalAuth);
    app.get('/test', (c) => {
      return c.json({ userId: c.get('userId') ?? null });
    });

    // Token expired 1 hour ago
    const expiredToken = makeDevToken({
      sub: 'user-expired',
      exp: Math.floor(Date.now() / 1000) - 3600,
    });

    const res = await app.request('/test', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // In dev mode, expired tokens are still allowed
    expect(body.userId).toBe('user-expired');
  });

  it('requireAuth returns 401 JSON when no user', async () => {
    const { optionalAuth, requireAuth } = await import('../middleware/auth.js');

    const app = new Hono<PlatformEnv>();
    app.use('*', optionalAuth);
    app.get('/protected', requireAuth, (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/protected');
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Authentication required');
  });

  it('requireAuth allows authenticated user through', async () => {
    const { optionalAuth, requireAuth } = await import('../middleware/auth.js');

    const app = new Hono<PlatformEnv>();
    app.use('*', optionalAuth);
    app.get('/protected', requireAuth, (c) => {
      return c.json({ userId: c.get('userId') });
    });

    const token = makeDevToken({ sub: 'user-ok' });
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.userId).toBe('user-ok');
  });
});

// ── JWT signature verification tests ──

describe('JWT verification logic', () => {
  it('jose.jwtVerify rejects expired tokens', async () => {
    const secret = new TextEncoder().encode('test-secret-at-least-32-bytes-long!');

    // Create a token that expired 1 hour ago
    const token = await new jose.SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secret);

    await expect(jose.jwtVerify(token, secret)).rejects.toThrow();
  });

  it('jose.jwtVerify accepts valid tokens', async () => {
    const secret = new TextEncoder().encode('test-secret-at-least-32-bytes-long!');

    const token = await new jose.SignJWT({ sub: 'user-1', email: 'u@test.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(secret);

    const { payload } = await jose.jwtVerify(token, secret);
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('u@test.com');
  });

  it('jose.jwtVerify rejects tampered tokens', async () => {
    const secret1 = new TextEncoder().encode('secret-one-at-least-32-bytes!!!');
    const secret2 = new TextEncoder().encode('secret-two-at-least-32-bytes!!!');

    const token = await new jose.SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('1h')
      .sign(secret1);

    // Verify with wrong secret should fail
    await expect(jose.jwtVerify(token, secret2)).rejects.toThrow();
  });
});
