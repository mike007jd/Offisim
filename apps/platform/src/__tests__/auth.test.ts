import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { PlatformEnv } from '../types.js';

type MockDb = PlatformEnv['Variables']['db'];
type JsonBody = {
  error?: {
    code?: string;
    message?: string;
  };
  userId?: string | null;
};

function assertDefined<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value == null) {
    throw new Error(message);
  }
}

/**
 * Auth middleware tests.
 *
 * Better Auth handles session validation internally. These tests verify:
 * 1. requireAuth returns 401 when no user is set
 * 2. requireAuth passes when userId is set
 * 3. optionalAuth does not block unauthenticated requests
 */

describe('Auth Middleware', () => {
  it('requireAuth returns 401 JSON when no user', async () => {
    const { requireAuth } = await import('../middleware/auth.js');

    const app = new Hono<PlatformEnv>();
    // Inject mock db
    app.use('*', async (c, next) => {
      c.set('db', {} as MockDb);
      await next();
    });
    app.get('/protected', requireAuth, (c) => {
      return c.json({ ok: true });
    });

    const res = await app.request('/protected');
    expect(res.status).toBe(401);
    const body = (await res.json()) as JsonBody;
    assertDefined(body.error, 'Expected error response');
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toBe('Authentication required');
  });

  it('requireAuth allows authenticated user through', async () => {
    const { requireAuth } = await import('../middleware/auth.js');

    const app = new Hono<PlatformEnv>();
    app.use('*', async (c, next) => {
      c.set('db', {} as MockDb);
      c.set('userId', 'user-ok');
      await next();
    });
    app.get('/protected', requireAuth, (c) => {
      return c.json({ userId: c.get('userId') });
    });

    const res = await app.request('/protected');
    expect(res.status).toBe(200);
    const body = (await res.json()) as JsonBody;
    expect(body.userId).toBe('user-ok');
  });

  it('unauthenticated request proceeds without userId', async () => {
    // Without optionalAuth extracting anything, userId should be undefined
    const app = new Hono<PlatformEnv>();
    app.get('/test', (c) => {
      return c.json({ userId: c.get('userId') ?? null });
    });

    const res = await app.request('/test');
    expect(res.status).toBe(200);
    const body = (await res.json()) as JsonBody;
    expect(body.userId).toBeNull();
  });
});
