import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../middleware/error-handler.js';
import { authRoute } from '../routes/auth.js';
import type { PlatformEnv } from '../types.js';

type MockDb = PlatformEnv['Variables']['db'];

type RegisterCreatorResponse = {
  creator_id: string;
  user_id: string;
  handle: string;
  display_name: string;
  bio: string | null;
  verification_state: string;
  created_at: string;
};

type ErrorResponse = {
  error: {
    message: string;
  };
};

// ── Helpers ──

const USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CREATOR_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

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
  return new Proxy({}, handler) as MockDb;
}

function createApp(mockDb: MockDb, userId?: string) {
  const app = new Hono<PlatformEnv>();
  app.use('*', async (c, next) => {
    c.set('db', mockDb);
    c.set('requestId', 'test-req-id');
    await next();
  });
  // Inject authenticated user for protected route tests
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
  describe('POST /v1/auth/register-creator', () => {
    it('returns 401 when no auth is provided', async () => {
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
      const body = (await res.json()) as RegisterCreatorResponse;
      expect(body.handle).toBe('devuser');
      expect(body.display_name).toBe('Dev User');
      expect(body.creator_id).toBe(CREATOR_ID);
      expect(body.user_id).toBe(USER_ID);
      expect(body.verification_state).toBe('unverified');
    });

    it('returns 409 when handle is already taken', async () => {
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
      const body = (await res.json()) as ErrorResponse;
      expect(body.error.message).toMatch(/taken/i);
    });

    it('returns 409 when user already has a creator profile', async () => {
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
      const body = (await res.json()) as ErrorResponse;
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

  describe('API Token CRUD', () => {
    it('GET /v1/auth/tokens returns 401 when not authenticated', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/auth/tokens');
      expect(res.status).toBe(401);
    });

    it('POST /v1/auth/tokens returns 400 when name is missing', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb, USER_ID);

      const res = await app.request('/v1/auth/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });
  });
});
