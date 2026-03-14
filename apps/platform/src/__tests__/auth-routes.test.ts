import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { optionalAuth } from '../middleware/auth.js';
import { errorHandler } from '../middleware/error-handler.js';
import { authRoute } from '../routes/auth.js';
import type { PlatformEnv } from '../types.js';

// ── Helpers ──

const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CREATOR_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const fakeUser = {
  user_id: USER_ID,
  email: 'dev@example.com',
  display_name: 'Dev User',
  avatar_url: null,
  auth_provider: 'dev',
  auth_subject: 'dev@example.com',
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
};

const fakeCreator = {
  creator_id: CREATOR_ID,
  user_id: USER_ID,
  handle: 'devuser',
  display_name: 'Dev User',
  bio: null,
  website_url: null,
  verification_state: 'unverified',
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
};

/**
 * Creates a chainable query builder mock.
 * Each chained method returns itself so you can do .select().from().where().limit()...
 * The final await resolves to `resolveValue`.
 */
function createChainableMock(resolveValue: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const handler = {
    get(_target: unknown, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => resolve(resolveValue);
      }
      if (!chain[prop]) {
        chain[prop] = vi.fn(() => new Proxy({}, handler));
      }
      return chain[prop];
    },
  };
  return new Proxy({}, handler);
}

function createMockDb(results: unknown[][]) {
  let callIndex = 0;
  const handler = {
    get(_target: unknown, prop: string) {
      if (prop === 'select' || prop === 'insert' || prop === 'update' || prop === 'delete') {
        const idx = callIndex++;
        const resolveValue = results[idx] ?? [];
        return vi.fn(() => createChainableMock(resolveValue));
      }
      return vi.fn();
    },
  };
  return new Proxy({}, handler) as any;
}

function createApp(mockDb: any, userId?: string) {
  const app = new Hono<PlatformEnv>();
  app.use('*', async (c, next) => {
    c.set('db', mockDb);
    c.set('requestId', 'test-req-id');
    await next();
  });
  // Simulate the optionalAuth middleware extracting user from JWT
  app.use('*', optionalAuth);
  // Allow tests to inject a pre-authenticated userId for protected routes
  if (userId) {
    app.use('*', async (c, next) => {
      c.set('userId', userId);
      await next();
    });
  }
  app.route('/v1/auth', authRoute);
  app.onError(errorHandler);
  return app;
}

// ── Tests ──

describe('Auth Routes', () => {
  describe('POST /v1/auth/dev-login', () => {
    it('creates a new user and returns a JWT token', async () => {
      // DB calls: 1. select existing user (not found) 2. insert new user (returning user_id)
      const mockDb = createMockDb([
        [], // no existing user found
        [{ user_id: USER_ID }], // insert returning
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'dev@example.com', display_name: 'Dev User' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body).toHaveProperty('token');
      expect(typeof body.token).toBe('string');
      expect(body.token.split('.').length).toBe(3); // valid JWT structure
      expect(body.user_id).toBe(USER_ID);
      expect(body.email).toBe('dev@example.com');
      expect(body.display_name).toBe('Dev User');
    });

    it('returns the same user on repeat login (user already exists)', async () => {
      // DB calls: 1. select existing user (found) — no insert
      const mockDb = createMockDb([
        [fakeUser], // existing user found
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'dev@example.com', display_name: 'Dev User' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.user_id).toBe(USER_ID);
      expect(body.email).toBe('dev@example.com');
      // Token should include the existing user_id as sub
      const payload = JSON.parse(atob(body.token.split('.')[1]));
      expect(payload.sub).toBe(USER_ID);
    });

    it('returns 400 when email is missing', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: 'Dev User' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when display_name is missing', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'dev@example.com' }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /v1/auth/register-creator', () => {
    it('returns 401 when no auth token is provided', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/auth/register-creator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'devuser', display_name: 'Dev User' }),
      });

      expect(res.status).toBe(401);
    });

    it('creates a creator profile for an authenticated user', async () => {
      // DB calls: 1. check handle uniqueness (not found) 2. check existing creator (not found) 3. insert creator
      const mockDb = createMockDb([
        [], // no existing handle
        [], // no existing creator for this user
        [fakeCreator], // insert returning
      ]);
      const app = createApp(mockDb, USER_ID);

      const res = await app.request('/v1/auth/register-creator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'devuser', display_name: 'Dev User', bio: 'A dev bio' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.handle).toBe('devuser');
      expect(body.display_name).toBe('Dev User');
      expect(body.creator_id).toBe(CREATOR_ID);
      expect(body.user_id).toBe(USER_ID);
      expect(body.verification_state).toBe('unverified');
    });

    it('returns 409 when handle is already taken', async () => {
      // DB calls: 1. check handle uniqueness (found)
      const mockDb = createMockDb([
        [fakeCreator], // handle already exists
      ]);
      const app = createApp(mockDb, USER_ID);

      const res = await app.request('/v1/auth/register-creator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'devuser', display_name: 'Dev User' }),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as any;
      expect(body.error.message).toMatch(/taken/i);
    });

    it('returns 409 when user already has a creator profile', async () => {
      // DB calls: 1. check handle uniqueness (not found) 2. check existing creator (found)
      const mockDb = createMockDb([
        [], // handle not taken
        [fakeCreator], // user already has creator profile
      ]);
      const app = createApp(mockDb, USER_ID);

      const res = await app.request('/v1/auth/register-creator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: 'newhandle', display_name: 'Dev User' }),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as any;
      expect(body.error.message).toMatch(/already has a creator/i);
    });

    it('returns 400 when handle is missing', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb, USER_ID);

      const res = await app.request('/v1/auth/register-creator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: 'Dev User' }),
      });

      expect(res.status).toBe(400);
    });
  });
});
