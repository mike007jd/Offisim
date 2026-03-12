import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { PlatformEnv } from '../types.js';
import { reviewsRoute } from '../routes/reviews.js';
import { optionalAuth } from '../middleware/auth.js';
import { errorHandler } from '../middleware/error-handler.js';

// ── Helpers ──

const LISTING_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const REVIEW_ID = '55555555-5555-5555-5555-555555555555';

const fakeNewReview = {
  review_id: REVIEW_ID,
  listing_id: LISTING_ID,
  user_id: USER_ID,
  rating: 4,
  title: 'Good',
  body: 'Nice package',
  moderation_state: 'visible',
  created_at: new Date('2026-03-01'),
  updated_at: new Date('2026-03-01'),
};

/** Creates a Proxy-based chainable mock (same pattern as market.test.ts) */
function createChainableMock(resolveValue: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const handler: ProxyHandler<object> = {
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
  const handler: ProxyHandler<object> = {
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

/** Helper to create a dev-mode JWT token for testing */
function makeDevToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'none' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

function createApp(mockDb: any) {
  const app = new Hono<PlatformEnv>();
  app.use('*', async (c, next) => {
    c.set('db', mockDb);
    c.set('requestId', 'test-req-id');
    await next();
  });
  app.use('*', optionalAuth);
  app.onError(errorHandler);
  app.route('/v1/reviews', reviewsRoute);
  return app;
}

// ── Tests ──

describe('Reviews Route', () => {
  describe('POST /v1/reviews', () => {
    it('requires authentication', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: LISTING_ID, rating: 4 }),
      });

      expect(res.status).toBe(401);
    });

    it('validates rating range', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb);
      const token = makeDevToken({ sub: USER_ID, email: 'test@test.com' });

      const res = await app.request('/v1/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ listing_id: LISTING_ID, rating: 6 }),
      });

      expect(res.status).toBe(400);
    });

    it('validates rating is present', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb);
      const token = makeDevToken({ sub: USER_ID, email: 'test@test.com' });

      const res = await app.request('/v1/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ listing_id: LISTING_ID }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent listing', async () => {
      const mockDb = createMockDb([
        [], // listing lookup returns empty
      ]);
      const app = createApp(mockDb);
      const token = makeDevToken({ sub: USER_ID, email: 'test@test.com' });

      const res = await app.request('/v1/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ listing_id: '00000000-0000-0000-0000-000000000000', rating: 4 }),
      });

      expect(res.status).toBe(404);
    });

    it('creates a new review (201)', async () => {
      const mockDb = createMockDb([
        // 1. listing exists check
        [{ listing_id: LISTING_ID }],
        // 2. existing review check (none found)
        [],
        // 3. insert returns new review
        [fakeNewReview],
        // 4. aggregate query
        [{ avg: 4.0, count: 1 }],
        // 5. update listing aggregates
        [],
      ]);
      const app = createApp(mockDb);
      const token = makeDevToken({ sub: USER_ID, email: 'test@test.com' });

      const res = await app.request('/v1/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          listing_id: LISTING_ID,
          rating: 4,
          title: 'Good',
          body: 'Nice package',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json() as any;
      expect(json.review_id).toBe(REVIEW_ID);
      expect(json.rating).toBe(4);
    });

    it('updates existing review (200)', async () => {
      const existingReview = { ...fakeNewReview, rating: 3 };
      const updatedReview = { ...fakeNewReview, rating: 5, updated_at: new Date('2026-03-10') };

      const mockDb = createMockDb([
        // 1. listing exists check
        [{ listing_id: LISTING_ID }],
        // 2. existing review check (found)
        [existingReview],
        // 3. update returns updated review
        [updatedReview],
        // 4. aggregate query
        [{ avg: 5.0, count: 1 }],
        // 5. update listing aggregates
        [],
      ]);
      const app = createApp(mockDb);
      const token = makeDevToken({ sub: USER_ID, email: 'test@test.com' });

      const res = await app.request('/v1/reviews', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          listing_id: LISTING_ID,
          rating: 5,
          title: 'Great',
          body: 'Updated review',
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.rating).toBe(5);
    });
  });
});
