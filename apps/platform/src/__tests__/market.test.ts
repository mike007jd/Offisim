import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { PlatformEnv } from '../types.js';
import { market } from '../routes/market.js';
import { creatorsRoute } from '../routes/creators.js';

// ── Helpers ──

const LISTING_ID = '11111111-1111-1111-1111-111111111111';
const CREATOR_ID = '22222222-2222-2222-2222-222222222222';

const fakeListing = {
  listing_id: LISTING_ID,
  creator_id: CREATOR_ID,
  slug: 'test-listing',
  kind: 'employee',
  title: 'Test Listing',
  summary: 'A summary',
  description: 'Full description',
  status: 'listed',
  rating_avg: 4.5,
  rating_count: 10,
  install_count: 100,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-15'),
};

const fakeCreator = {
  creator_id: CREATOR_ID,
  user_id: '33333333-3333-3333-3333-333333333333',
  handle: 'testcreator',
  display_name: 'Test Creator',
  bio: 'A bio',
  website_url: 'https://example.com',
  verification_state: 'verified',
  created_at: new Date('2025-12-01'),
  updated_at: new Date('2025-12-15'),
};

const fakeVersion = {
  package_version_id: '44444444-4444-4444-4444-444444444444',
  listing_id: LISTING_ID,
  package_id: 'com.test.listing',
  version: '1.0.0',
  manifest_json: {
    requirements: { required_capabilities: [], required_mcps: [], recommended_models: [] },
    permissions: { risk_class: 'sandboxed', declares_secrets: false, filesystem_scope: 'none', network_scope: 'none' },
  },
  runtime_range: '>=1.0.0',
  schema_version: '1.0',
  environments: ['desktop', 'web_limited'],
  risk_class: 'sandboxed',
  artifact_url: null,
  artifact_sha256: null,
  artifact_size_bytes: null,
  changelog: 'Initial release',
  status: 'active',
  published_at: new Date('2026-01-10'),
};

const fakeReview = {
  review_id: '55555555-5555-5555-5555-555555555555',
  listing_id: LISTING_ID,
  user_id: '66666666-6666-6666-6666-666666666666',
  rating: 5,
  title: 'Great package',
  body: 'Works perfectly',
  moderation_state: 'visible',
  created_at: new Date('2026-02-01'),
  updated_at: new Date('2026-02-01'),
};

/**
 * Creates a chainable query builder mock.
 * Each chained method returns itself so you can do .select().from().where().orderBy().limit().
 * The final await resolves to `resolveValue`.
 */
function createChainableMock(resolveValue: unknown) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const handler = {
    get(_target: unknown, prop: string) {
      if (prop === 'then') {
        // Make it thenable — resolves with the value
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

/**
 * Builds a mock PlatformDb that routes queries to predefined results.
 * The mock uses a call counter to return different results for sequential queries.
 */
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

function createApp(mockDb: any) {
  const app = new Hono<PlatformEnv>();
  app.use('*', async (c, next) => {
    c.set('db', mockDb);
    c.set('requestId', 'test-req-id');
    await next();
  });
  app.route('/v1/market', market);
  app.route('/v1/market/creators', creatorsRoute);
  return app;
}

// ── Tests ──

describe('Market Routes', () => {
  describe('GET /v1/market/search', () => {
    it('returns paginated results', async () => {
      // searchListings does 2 queries: items + count
      // Then for each item: latestVersion query + tags query
      const mockDb = createMockDb([
        // 1. items query (innerJoin result)
        [{ listings: fakeListing, creators: fakeCreator }],
        // 2. count query
        [{ count: 1 }],
        // 3. latestVersion for item[0]
        [fakeVersion],
        // 4. tags for item[0]
        [{ tag: 'automation' }],
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/market/search?per_page=5');
      expect(res.status).toBe(200);

      const body = await res.json() as any;
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('page', 1);
      expect(body).toHaveProperty('per_page', 5);
      expect(body).toHaveProperty('total', 1);
      expect(body.items).toHaveLength(1);
      expect(body.items[0].title).toBe('Test Listing');
      expect(body.items[0].tags).toEqual(['automation']);
      expect(body.items[0].creator.handle).toBe('testcreator');
    });

    it('returns empty results', async () => {
      const mockDb = createMockDb([
        [], // items
        [{ count: 0 }], // count
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/market/search');
      expect(res.status).toBe(200);

      const body = await res.json() as any;
      expect(body.items).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('clamps per_page to max 50', async () => {
      const mockDb = createMockDb([
        [],
        [{ count: 0 }],
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/market/search?per_page=999');
      expect(res.status).toBe(200);

      const body = await res.json() as any;
      expect(body.per_page).toBe(50);
    });

    it('clamps per_page to min 1', async () => {
      const mockDb = createMockDb([
        [],
        [{ count: 0 }],
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/market/search?per_page=0');
      expect(res.status).toBe(200);

      const body = await res.json() as any;
      expect(body.per_page).toBe(1);
    });
  });

  describe('GET /v1/market/listings/:listingId', () => {
    it('returns listing detail', async () => {
      const mockDb = createMockDb([
        // 1. listing + creator join
        [{ listings: fakeListing, creators: fakeCreator }],
        // 2. latestVersion
        [fakeVersion],
        // 3. tags
        [{ tag: 'productivity' }],
        // 4. previews
        [{ kind: 'screenshot', url: 'https://img.test/1.png', alt_text: 'Screenshot', sort_order: 0 }],
      ]);
      const app = createApp(mockDb);

      const res = await app.request(`/v1/market/listings/${LISTING_ID}`);
      expect(res.status).toBe(200);

      const body = await res.json() as any;
      expect(body.listing_id).toBe(LISTING_ID);
      expect(body.title).toBe('Test Listing');
      expect(body.creator.handle).toBe('testcreator');
      expect(body.version?.version).toBe('1.0.0');
      expect(body.tags).toEqual(['productivity']);
      expect(body.previews).toHaveLength(1);
      expect(body.previews[0].kind).toBe('screenshot');
    });

    it('returns 404 for non-existent listing', async () => {
      const mockDb = createMockDb([
        [], // no listing found
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/market/listings/00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /v1/market/listings/:listingId/versions', () => {
    it('returns versions for a listing', async () => {
      const mockDb = createMockDb([
        // 1. listing exists check
        [{ listing_id: LISTING_ID }],
        // 2. versions
        [fakeVersion],
      ]);
      const app = createApp(mockDb);

      const res = await app.request(`/v1/market/listings/${LISTING_ID}/versions`);
      expect(res.status).toBe(200);

      const body = await res.json() as any;
      expect(body.listing_id).toBe(LISTING_ID);
      expect(body.versions).toHaveLength(1);
      expect(body.versions[0].version).toBe('1.0.0');
      expect(body.versions[0].risk_class).toBe('sandboxed');
    });

    it('returns 404 for non-existent listing', async () => {
      const mockDb = createMockDb([
        [], // no listing
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/market/listings/00000000-0000-0000-0000-000000000000/versions');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /v1/market/listings/:listingId/reviews', () => {
    it('returns reviews for a listing', async () => {
      const mockDb = createMockDb([
        // 1. listing exists check
        [{ listing_id: LISTING_ID }],
        // 2. reviews
        [fakeReview],
      ]);
      const app = createApp(mockDb);

      const res = await app.request(`/v1/market/listings/${LISTING_ID}/reviews`);
      expect(res.status).toBe(200);

      const body = await res.json() as any;
      expect(body.listing_id).toBe(LISTING_ID);
      expect(body.reviews).toHaveLength(1);
      expect(body.reviews[0].rating).toBe(5);
      expect(body.reviews[0].title).toBe('Great package');
    });

    it('returns 404 for non-existent listing', async () => {
      const mockDb = createMockDb([
        [],
      ]);
      const app = createApp(mockDb);

      const res = await app.request(`/v1/market/listings/00000000-0000-0000-0000-000000000000/reviews`);
      expect(res.status).toBe(404);
    });
  });
});

describe('Creators Route', () => {
  describe('GET /v1/market/creators/:handle', () => {
    it('returns creator profile with listings', async () => {
      const mockDb = createMockDb([
        // 1. creator lookup
        [fakeCreator],
        // 2. creator's listings
        [fakeListing],
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/market/creators/testcreator');
      expect(res.status).toBe(200);

      const body = await res.json() as any;
      expect(body.handle).toBe('testcreator');
      expect(body.display_name).toBe('Test Creator');
      expect(body.verification_state).toBe('verified');
      expect(body.listings).toHaveLength(1);
      expect(body.listings[0].title).toBe('Test Listing');
    });

    it('returns 404 for non-existent creator', async () => {
      const mockDb = createMockDb([
        [], // no creator
      ]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/market/creators/nonexistent');
      expect(res.status).toBe(404);
    });
  });
});
