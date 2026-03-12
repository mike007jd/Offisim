import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { optionalAuth } from '../middleware/auth.js';
import { errorHandler } from '../middleware/error-handler.js';
import { installRoute } from '../routes/install.js';
import type { PlatformEnv } from '../types.js';

// ── Helpers ──

const LISTING_ID = '11111111-1111-1111-1111-111111111111';
const VERSION_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

function makeDevToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'none' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

/** Creates a Proxy-based chainable mock */
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

function createApp(mockDb: any) {
  const app = new Hono<PlatformEnv>();
  app.use('*', async (c, next) => {
    c.set('db', mockDb);
    c.set('requestId', 'test-req-id');
    await next();
  });
  app.use('*', optionalAuth);
  app.onError(errorHandler);
  app.route('/v1/install', installRoute);
  return app;
}

const authHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${makeDevToken({ sub: USER_ID, email: 'test@example.com' })}`,
};

// ── Tests ──

describe('Install Route', () => {
  describe('POST /v1/install/receipts', () => {
    it('requires authentication', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/install/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: LISTING_ID,
          package_version_id: VERSION_ID,
          install_source: 'registry',
        }),
      });

      expect(res.status).toBe(401);
    });

    it('validates request body', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/install/receipts', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ listing_id: LISTING_ID }),
      });

      expect(res.status).toBe(400);
    });

    it('validates install_source enum', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/install/receipts', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          listing_id: LISTING_ID,
          package_version_id: VERSION_ID,
          install_source: 'invalid',
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as Record<string, any>;
      expect(body.error.details[0].message).toContain('install_source');
    });

    it('creates receipt and increments install_count', async () => {
      // insert receipt (no-op return), update listing count (no-op return)
      const mockDb = createMockDb([[], []]);
      const app = createApp(mockDb);

      const res = await app.request('/v1/install/receipts', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          listing_id: LISTING_ID,
          package_version_id: VERSION_ID,
          install_source: 'registry',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, any>;
      expect(body.install_receipt_id).toContain(USER_ID);
      expect(body.listing_id).toBe(LISTING_ID);
      expect(body.package_version_id).toBe(VERSION_ID);
    });
  });

  describe('GET /v1/install/download/:versionId', () => {
    it('returns 404 for non-existent version', async () => {
      const mockDb = createMockDb([[]]);
      const app = createApp(mockDb);

      const res = await app.request(`/v1/install/download/${VERSION_ID}`);

      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, any>;
      expect(body.error.code).toBe('NOT_FOUND');
    });

    it('returns 404 when no artifact URL', async () => {
      const mockDb = createMockDb([
        [
          {
            package_version_id: VERSION_ID,
            artifact_url: null,
            artifact_sha256: null,
            artifact_size_bytes: null,
          },
        ],
      ]);
      const app = createApp(mockDb);

      const res = await app.request(`/v1/install/download/${VERSION_ID}`);

      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, any>;
      expect(body.error.code).toBe('NO_ARTIFACT');
    });

    it('returns artifact info when available', async () => {
      const mockDb = createMockDb([
        [
          {
            package_version_id: VERSION_ID,
            artifact_url: 'https://cdn.example.com/pkg.aicspkg',
            artifact_sha256: 'abc123',
            artifact_size_bytes: 1024,
          },
        ],
      ]);
      const app = createApp(mockDb);

      const res = await app.request(`/v1/install/download/${VERSION_ID}`);

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, any>;
      expect(body.artifact_url).toBe('https://cdn.example.com/pkg.aicspkg');
      expect(body.artifact_sha256).toBe('abc123');
      expect(body.artifact_size_bytes).toBe(1024);
    });

    it('does not require authentication', async () => {
      const mockDb = createMockDb([
        [
          {
            package_version_id: VERSION_ID,
            artifact_url: 'https://cdn.example.com/pkg.aicspkg',
            artifact_sha256: 'abc123',
            artifact_size_bytes: 1024,
          },
        ],
      ]);
      const app = createApp(mockDb);

      // No auth headers
      const res = await app.request(`/v1/install/download/${VERSION_ID}`);
      expect(res.status).toBe(200);
    });
  });
});
