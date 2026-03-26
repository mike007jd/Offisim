import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../middleware/error-handler.js';
import { _resetRateLimitStore } from '../middleware/rate-limit.js';
import { installRoute } from '../routes/install.js';
import type { PlatformEnv } from '../types.js';

type MockDb = PlatformEnv['Variables']['db'];

type InstallReceiptResponse =
  | {
      install_receipt_id: string;
      listing_id: string;
      package_version_id: string;
      status: 'recorded' | 'already_exists';
    }
  | {
      error: {
        code: string;
        message: string;
        details?: {
          message: string;
        }[];
      };
    };

type DownloadResponse =
  | {
      package_version_id: string;
      artifact_url: string;
      artifact_sha256: string | null;
      artifact_size_bytes: number | null;
    }
  | {
      error: {
        code: string;
        message: string;
      };
    };

function assertDefined<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value == null) {
    throw new Error(message);
  }
}

// ── Helpers ──

const LISTING_ID = '11111111-1111-1111-1111-111111111111';
const VERSION_ID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

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

/**
 * Creates a mock DB that supports both direct queries and transactions.
 */
function createMockDb(results: unknown[][]) {
  let callIndex = 0;
  const handler: ProxyHandler<object> = {
    get(_target: unknown, prop: string) {
      if (prop === 'select' || prop === 'insert' || prop === 'update' || prop === 'delete') {
        const idx = callIndex++;
        const resolveValue = results[idx] ?? [];
        return vi.fn(() => createChainableMock(resolveValue));
      }
      if (prop === 'transaction') {
        // transaction(async (tx) => ...) — tx uses the same mock
        return vi.fn(async (cb: (tx: MockDb) => Promise<unknown>) => {
          return cb(new Proxy({}, handler) as MockDb);
        });
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
    // Inject authenticated user directly for tests
    if (userId) {
      c.set('userId', userId);
      c.set('userEmail', 'test@example.com');
    }
    await next();
  });
  app.onError(errorHandler);
  app.route('/v1/install', installRoute);
  return app;
}

// ── Tests ──

describe('Install Route', () => {
  // Reset rate limiter state between tests
  afterEach(() => {
    _resetRateLimitStore();
  });

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
      const app = createApp(mockDb, USER_ID);

      const res = await app.request('/v1/install/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: LISTING_ID }),
      });

      expect(res.status).toBe(400);
    });

    it('validates install_source enum', async () => {
      const mockDb = createMockDb([]);
      const app = createApp(mockDb, USER_ID);

      const res = await app.request('/v1/install/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: LISTING_ID,
          package_version_id: VERSION_ID,
          install_source: 'invalid',
        }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as InstallReceiptResponse;
      if (!('error' in body)) {
        throw new Error('Expected validation error response');
      }
      assertDefined(body.error.details, 'Expected validation error details');
      const firstDetail = body.error.details[0];
      assertDefined(firstDetail, 'Expected validation error details');
      expect(firstDetail.message).toContain('install_source');
    });

    it('creates receipt and returns recorded status for new install', async () => {
      const mockDb = createMockDb([
        [{ install_receipt_id: `rcpt_${USER_ID}_${LISTING_ID}_${VERSION_ID}` }],
        [],
      ]);
      const app = createApp(mockDb, USER_ID);

      const res = await app.request('/v1/install/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: LISTING_ID,
          package_version_id: VERSION_ID,
          install_source: 'registry',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as InstallReceiptResponse;
      if ('error' in body) {
        throw new Error('Expected success response');
      }
      expect(body.install_receipt_id).toContain(USER_ID);
      expect(body.listing_id).toBe(LISTING_ID);
      expect(body.package_version_id).toBe(VERSION_ID);
      expect(body.status).toBe('recorded');
    });

    it('returns already_exists for duplicate receipt (idempotent)', async () => {
      const mockDb = createMockDb([[]]);
      const app = createApp(mockDb, USER_ID);

      const res = await app.request('/v1/install/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: LISTING_ID,
          package_version_id: VERSION_ID,
          install_source: 'registry',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as InstallReceiptResponse;
      if ('error' in body) {
        throw new Error('Expected success response');
      }
      expect(body.status).toBe('already_exists');
    });
  });

  describe('GET /v1/install/download/:versionId', () => {
    it('returns 404 for non-existent version', async () => {
      const mockDb = createMockDb([[]]);
      const app = createApp(mockDb);

      const res = await app.request(`/v1/install/download/${VERSION_ID}`);

      expect(res.status).toBe(404);
      const body = (await res.json()) as DownloadResponse;
      if (!('error' in body)) {
        throw new Error('Expected error response');
      }
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
      const body = (await res.json()) as DownloadResponse;
      if (!('error' in body)) {
        throw new Error('Expected error response');
      }
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
      const body = (await res.json()) as DownloadResponse;
      if ('error' in body) {
        throw new Error('Expected success response');
      }
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

      const res = await app.request(`/v1/install/download/${VERSION_ID}`);
      expect(res.status).toBe(200);
    });
  });
});
