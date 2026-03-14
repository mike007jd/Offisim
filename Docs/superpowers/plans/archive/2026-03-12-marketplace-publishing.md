# Marketplace & Publishing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the full marketplace website, platform API, publishing workflow, and registry client for AICS 1.0 — enabling asset discovery, creator publishing, and link-install from market to local runtime.

**Architecture:** Five parallel-safe chunks: (A) Platform API foundation + registry-client types, (B) Core API endpoints, (C) Marketplace website pages, (D) Publishing workflow, (E) Link Install protocol. Chunks A→B are sequential; C depends on A; D depends on B; E depends on A+C.

**Tech Stack:** TypeScript, Hono (platform API), Next.js 15 App Router (market), Drizzle ORM (PostgreSQL), Tailwind CSS, Lucide icons, Vitest, Zod

---

## File Structure

### New Files — Chunk A (Foundation)
- `apps/platform/src/db.ts`
- `apps/platform/src/middleware/error-handler.ts`
- `apps/platform/src/middleware/auth.ts`
- `apps/platform/src/middleware/request-id.ts`
- `apps/platform/src/routes/health.ts`
- `apps/platform/src/types.ts`
- `packages/registry-client/src/types.ts`
- `packages/registry-client/src/client.ts`
- `packages/registry-client/src/errors.ts`
- `packages/registry-client/src/__tests__/client.test.ts`

### New Files — Chunk B (Core API)
- `apps/platform/src/routes/market.ts`
- `apps/platform/src/routes/creators.ts`
- `apps/platform/src/routes/reviews.ts`
- `apps/platform/src/services/search.ts`
- `apps/platform/src/__tests__/market.test.ts`
- `apps/platform/src/__tests__/reviews.test.ts`

### New Files — Chunk C (Market Pages)
- `apps/market/src/lib/registry.ts`
- `apps/market/src/lib/format.ts`
- `apps/market/src/app/globals.css`
- `apps/market/src/app/search/page.tsx`
- `apps/market/src/app/listing/[slug]/page.tsx`
- `apps/market/src/app/creator/[handle]/page.tsx`
- `apps/market/src/components/ListingCard.tsx`
- `apps/market/src/components/RiskBadge.tsx`
- `apps/market/src/components/KindIcon.tsx`
- `apps/market/src/components/RatingStars.tsx`
- `apps/market/src/components/InstallButton.tsx`
- `apps/market/src/components/SearchFilters.tsx`
- `apps/market/src/components/CreatorBadge.tsx`
- `apps/market/src/components/VersionTable.tsx`
- `apps/market/src/components/ReviewList.tsx`
- `apps/market/src/components/PermissionsPanel.tsx`
- `apps/market/tailwind.config.ts`
- `apps/market/postcss.config.mjs`

### New Files — Chunk D (Publishing)
- `apps/platform/src/routes/publish.ts`
- `apps/platform/src/services/moderation.ts`
- `apps/platform/src/services/validation.ts`
- `apps/platform/src/__tests__/publish.test.ts`

### New Files — Chunk E (Link Install)
- `apps/market/src/components/InstallModal.tsx`
- `apps/desktop/src-tauri/src/deep_link.rs` (modify existing or create)

### Modified Files
- `apps/platform/src/index.ts` — mount route groups, middleware, DB
- `apps/platform/package.json` — add zod, drizzle-kit, pg deps
- `apps/market/src/app/layout.tsx` — add Tailwind, metadata, nav
- `apps/market/src/app/page.tsx` — replace placeholder with catalog
- `apps/market/package.json` — add tailwindcss, lucide-react
- `packages/registry-client/src/index.ts` — replace stub with real exports
- `packages/registry-client/package.json` — add zod dep

---

## Chunk A: Platform API Foundation + Registry Client Types

> **Depends on:** nothing
> **Parallel with:** nothing (foundation chunk)
> **Estimated effort:** medium

This chunk establishes the platform API skeleton (middleware, DB, error handling) and the registry-client type definitions + client implementation.

### Task A.1: Platform DB Connection

**Files:**
- Create: `apps/platform/src/db.ts`
- Modify: `apps/platform/package.json`

- [ ] **Step 1: Add PostgreSQL dependencies**

Add to `apps/platform/package.json` dependencies:
```json
{
  "drizzle-orm": "^0.39.0",
  "postgres": "^3.4.0",
  "zod": "^3.24.0"
}
```
Add to devDependencies:
```json
{
  "drizzle-kit": "^0.30.0",
  "vitest": "^3.0.0",
  "@types/node": "25.3.5"
}
```

Run: `cd apps/platform && pnpm install`

- [ ] **Step 2: Create DB connection module**

```typescript
// apps/platform/src/db.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@aics/db-platform';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/aics_platform';

const queryClient = postgres(DATABASE_URL);
export const db = drizzle(queryClient, { schema });
export type PlatformDb = typeof db;
```

- [ ] **Step 3: Verify typecheck**

Run: `cd apps/platform && pnpm typecheck`

### Task A.2: Platform Middleware Stack

**Files:**
- Create: `apps/platform/src/middleware/error-handler.ts`
- Create: `apps/platform/src/middleware/auth.ts`
- Create: `apps/platform/src/middleware/request-id.ts`
- Create: `apps/platform/src/types.ts`

- [ ] **Step 1: Create platform types**

```typescript
// apps/platform/src/types.ts
import type { PlatformDb } from './db.js';

/** Hono env bindings for all platform routes */
export interface PlatformEnv {
  Variables: {
    db: PlatformDb;
    requestId: string;
    userId?: string;
    userEmail?: string;
  };
}
```

- [ ] **Step 2: Create request ID middleware**

```typescript
// apps/platform/src/middleware/request-id.ts
import { createMiddleware } from 'hono/factory';
import type { PlatformEnv } from '../types.js';

export const requestId = createMiddleware<PlatformEnv>(async (c, next) => {
  const id = c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  await next();
});
```

- [ ] **Step 3: Create error handler middleware**

```typescript
// apps/platform/src/middleware/error-handler.ts
import type { ErrorHandler } from 'hono';
import type { PlatformEnv } from '../types.js';

export const errorHandler: ErrorHandler<PlatformEnv> = (err, c) => {
  console.error(`[${c.get('requestId')}] Unhandled error:`, err);

  const status = 'status' in err && typeof err.status === 'number' ? err.status : 500;
  return c.json(
    {
      error: {
        code: status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        message: status === 500 ? 'Internal server error' : err.message,
      },
    },
    status as any,
  );
};
```

- [ ] **Step 4: Create auth middleware**

```typescript
// apps/platform/src/middleware/auth.ts
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { PlatformEnv } from '../types.js';

/**
 * Optional auth: extracts user info from Bearer token if present.
 * For 1.0 dev mode, accepts a simple JSON payload in base64 (header.payload.sig).
 * Production should use proper JWT validation.
 */
export const optionalAuth = createMiddleware<PlatformEnv>(async (c, next) => {
  const authHeader = c.req.header('authorization');
  if (authHeader?.startsWith('Bearer ')) {
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
```

- [ ] **Step 5: Verify typecheck**

Run: `cd apps/platform && pnpm typecheck`

### Task A.3: Wire Platform App Skeleton

**Files:**
- Modify: `apps/platform/src/index.ts`
- Create: `apps/platform/src/routes/health.ts`

- [ ] **Step 1: Extract health route**

```typescript
// apps/platform/src/routes/health.ts
import { Hono } from 'hono';
import type { PlatformEnv } from '../types.js';

const health = new Hono<PlatformEnv>();

health.get('/health', (c) => c.json({ status: 'ok' }));

export { health };
```

- [ ] **Step 2: Rewrite index.ts with middleware and route mounting**

```typescript
// apps/platform/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import type { PlatformEnv } from './types.js';
import { db } from './db.js';
import { requestId } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import { optionalAuth } from './middleware/auth.js';
import { health } from './routes/health.js';

const app = new Hono<PlatformEnv>();

// Global middleware
app.use('*', cors({ origin: '*' })); // Tighten in production
app.use('*', requestId);
app.use('*', async (c, next) => {
  c.set('db', db);
  await next();
});
app.use('*', optionalAuth);
app.onError(errorHandler);

// Routes
app.route('/', health);
// Chunk B will add: app.route('/v1/market', market);
// Chunk B will add: app.route('/v1', reviews);
// Chunk D will add: app.route('/v1/publish', publish);

const port = parseInt(process.env.PORT ?? '4100', 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`AICS Platform API listening on :${port}`);
});

export default app;
export { app };
```

- [ ] **Step 3: Verify typecheck and build**

Run: `cd apps/platform && pnpm typecheck && pnpm build`

### Task A.4: Registry Client Types

**Files:**
- Create: `packages/registry-client/src/types.ts`
- Create: `packages/registry-client/src/errors.ts`

- [ ] **Step 1: Define all API response types**

```typescript
// packages/registry-client/src/types.ts
// Types derived from aics_openapi.yaml schemas

import type { AssetKind, RiskClass, SupportedEnvironment } from '@aics/asset-schema';

// ── Search ──

export interface SearchParams {
  q?: string;
  kind?: AssetKind;
  risk_class?: RiskClass;
  tag?: string;
  sort?: 'relevance' | 'newest' | 'updated' | 'rating' | 'installs';
  page?: number;
  per_page?: number;
}

export interface SearchResponse {
  items: ListingSummary[];
  page: number;
  per_page: number;
  total: number;
}

// ── Listing ──

export interface CreatorSummary {
  creator_id: string;
  handle: string;
  display_name: string;
  verification_state: 'unverified' | 'verified' | 'trusted';
}

export interface PreviewRef {
  kind: 'icon' | 'image' | 'video' | 'readme';
  url: string;
  alt?: string;
}

export interface ListingSummary {
  listing_id: string;
  slug: string;
  kind: AssetKind;
  title: string;
  summary: string;
  creator: CreatorSummary;
  status: 'listed' | 'hidden' | 'retired';
  latest_version: string;
  rating: number;
  install_count: number;
  tags?: string[];
  preview?: PreviewRef;
}

export interface VersionSummary {
  package_id: string;
  version: string;
  runtime_range: string;
  schema_version: string;
  environments: SupportedEnvironment[];
  risk_class: RiskClass;
  published_at?: string;
  changelog?: string;
}

export interface RequirementsSummary {
  required_capabilities?: string[];
  required_mcps?: string[];
  recommended_models?: RecommendedModel[];
}

export interface RecommendedModel {
  profile: string;
  reason?: string;
  provider_hints?: string[];
}

export interface PermissionSummary {
  risk_class?: RiskClass;
  declares_secrets?: boolean;
  filesystem_scope?: 'none' | 'workspace' | 'project' | 'custom_path';
  network_scope?: 'none' | 'limited' | 'unrestricted';
}

export interface LineageSummary {
  origin_package_id?: string;
  forked_from_version?: string;
  derivative_of?: string[];
}

export interface ListingDetail extends ListingSummary {
  description: string;
  version: VersionSummary;
  requirements: RequirementsSummary;
  permissions: PermissionSummary;
  lineage?: LineageSummary;
  previews?: PreviewRef[];
}

// ── Versions ──

export interface VersionListResponse {
  listing_id: string;
  versions: VersionSummary[];
}

// ── Reviews ──

export interface Review {
  review_id: string;
  listing_id: string;
  user_id?: string;
  rating: number;
  title?: string;
  body?: string;
  moderation_state: 'visible' | 'hidden' | 'flagged';
  created_at: string;
  updated_at: string;
}

export interface ReviewListResponse {
  listing_id: string;
  reviews: Review[];
}

export interface CreateReviewRequest {
  listing_id: string;
  rating: number;
  title?: string;
  body?: string;
}

// ── Publish ──

export interface PublishDraft {
  draft_id: string;
  creator_id: string;
  listing_id?: string | null;
  artifact_id?: string | null;
  manifest_json?: Record<string, unknown>;
  validation_state: 'unknown' | 'valid' | 'invalid';
  validation_report?: Record<string, unknown>;
  status: 'draft' | 'validated' | 'submitted' | 'rejected';
  created_at: string;
  updated_at: string;
}

export interface CreateDraftRequest {
  kind: AssetKind;
  listing_id?: string | null;
  title: string;
  summary?: string;
  artifact_upload_mode?: 'registry_object' | 'external_url';
}

export interface PutDraftManifestRequest {
  manifest_json: Record<string, unknown>;
  artifact?: {
    storage_backend?: 'registry_object' | 'external_url' | 'github_release' | 'npm';
    external_url?: string;
    sha256?: string;
    size_bytes?: number;
  };
}

export interface PublishSubmitRequest {
  draft_id: string;
  submit_message?: string;
}

export interface SubmitResponse {
  draft_id: string;
  moderation_job_id: string;
  status: 'queued' | 'pending_review';
}

// ── Library ──

export interface LibraryItem {
  listing: ListingSummary;
  version: VersionSummary;
  saved_at: string;
  install_receipt_id?: string | null;
}

export interface LibraryParams {
  kind?: AssetKind;
  installed?: boolean;
}

export interface LibraryResponse {
  items: LibraryItem[];
}

// ── Creator Profile (extension beyond OpenAPI — needed for market pages) ──

export interface CreatorProfile extends CreatorSummary {
  bio?: string;
  website_url?: string;
  created_at: string;
  listings: ListingSummary[];
}
```

- [ ] **Step 2: Create error types**

```typescript
// packages/registry-client/src/errors.ts
export class RegistryApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'RegistryApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd packages/registry-client && pnpm typecheck`

### Task A.5: Registry Client Implementation

**Files:**
- Create: `packages/registry-client/src/client.ts`
- Modify: `packages/registry-client/src/index.ts`
- Create: `packages/registry-client/src/__tests__/client.test.ts`

- [ ] **Step 1: Implement the client**

```typescript
// packages/registry-client/src/client.ts
import { RegistryApiError } from './errors.js';
import type {
  SearchParams,
  SearchResponse,
  ListingDetail,
  VersionListResponse,
  ReviewListResponse,
  CreatorProfile,
  CreateDraftRequest,
  PublishDraft,
  PutDraftManifestRequest,
  PublishSubmitRequest,
  SubmitResponse,
  CreateReviewRequest,
  Review,
  LibraryParams,
  LibraryResponse,
} from './types.js';

export interface RegistryClientConfig {
  baseUrl: string;
  authToken?: string;
  fetch?: typeof globalThis.fetch;
}

export class RegistryClient {
  private readonly baseUrl: string;
  private readonly authToken?: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(config: RegistryClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.authToken = config.authToken;
    this.fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
  }

  // ── Public reads ──

  async searchListings(params: SearchParams = {}): Promise<SearchResponse> {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.kind) qs.set('kind', params.kind);
    if (params.risk_class) qs.set('risk_class', params.risk_class);
    if (params.tag) qs.set('tag', params.tag);
    if (params.sort) qs.set('sort', params.sort);
    if (params.page) qs.set('page', String(params.page));
    if (params.per_page) qs.set('per_page', String(params.per_page));
    return this.get<SearchResponse>(`/v1/market/search?${qs}`);
  }

  async getListingDetail(listingId: string): Promise<ListingDetail> {
    return this.get<ListingDetail>(`/v1/market/listings/${listingId}`);
  }

  async getListingBySlug(slug: string): Promise<ListingDetail> {
    return this.get<ListingDetail>(`/v1/market/listings/by-slug/${slug}`);
  }

  async listListingVersions(listingId: string): Promise<VersionListResponse> {
    return this.get<VersionListResponse>(`/v1/market/listings/${listingId}/versions`);
  }

  async listListingReviews(listingId: string): Promise<ReviewListResponse> {
    return this.get<ReviewListResponse>(`/v1/market/listings/${listingId}/reviews`);
  }

  async getCreatorProfile(handle: string): Promise<CreatorProfile> {
    return this.get<CreatorProfile>(`/v1/market/creators/${handle}`);
  }

  // ── Authenticated endpoints ──

  async createPublishDraft(req: CreateDraftRequest): Promise<PublishDraft> {
    return this.post<PublishDraft>('/v1/publish/drafts', req);
  }

  async putDraftManifest(draftId: string, req: PutDraftManifestRequest): Promise<PublishDraft> {
    return this.put<PublishDraft>(`/v1/publish/drafts/${draftId}/manifest`, req);
  }

  async submitPublishDraft(req: PublishSubmitRequest): Promise<SubmitResponse> {
    return this.post<SubmitResponse>('/v1/publish/submit', req);
  }

  async upsertReview(req: CreateReviewRequest): Promise<Review> {
    return this.post<Review>('/v1/reviews', req);
  }

  async getMyLibrary(params?: LibraryParams): Promise<LibraryResponse> {
    const qs = new URLSearchParams();
    if (params?.kind) qs.set('kind', params.kind);
    if (params?.installed !== undefined) qs.set('installed', String(params.installed));
    const query = qs.toString();
    return this.get<LibraryResponse>(`/v1/me/library${query ? `?${query}` : ''}`);
  }

  // ── Internal ──

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.authToken) h['Authorization'] = `Bearer ${this.authToken}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await this.fetch(url, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({ error: { code: 'UNKNOWN', message: res.statusText } }));
      const err = errorBody?.error ?? { code: 'UNKNOWN', message: res.statusText };
      throw new RegistryApiError(res.status, err.code, err.message, err.details);
    }

    return res.json() as Promise<T>;
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }
}
```

- [ ] **Step 2: Update index.ts exports**

```typescript
// packages/registry-client/src/index.ts
export { RegistryClient } from './client.js';
export type { RegistryClientConfig } from './client.js';
export { RegistryApiError } from './errors.js';
export type * from './types.js';
```

- [ ] **Step 3: Write client tests**

```typescript
// packages/registry-client/src/__tests__/client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { RegistryClient } from '../client.js';
import { RegistryApiError } from '../errors.js';

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

describe('RegistryClient', () => {
  const BASE = 'https://api.test';

  it('searchListings sends correct query params', async () => {
    const fetchMock = mockFetch(200, { items: [], page: 1, per_page: 20, total: 0 });
    const client = new RegistryClient({ baseUrl: BASE, fetch: fetchMock });

    const result = await client.searchListings({ q: 'coder', kind: 'employee', page: 2 });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/market/search?'),
      expect.objectContaining({ method: 'GET' }),
    );
    const calledUrl = (fetchMock as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('q=coder');
    expect(calledUrl).toContain('kind=employee');
    expect(calledUrl).toContain('page=2');
    expect(result.total).toBe(0);
  });

  it('getListingDetail fetches by ID', async () => {
    const detail = { listing_id: 'abc', title: 'Test' };
    const fetchMock = mockFetch(200, detail);
    const client = new RegistryClient({ baseUrl: BASE, fetch: fetchMock });

    const result = await client.getListingDetail('abc');
    expect(result.listing_id).toBe('abc');
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/v1/market/listings/abc`,
      expect.any(Object),
    );
  });

  it('includes auth header when token provided', async () => {
    const fetchMock = mockFetch(200, { items: [] });
    const client = new RegistryClient({ baseUrl: BASE, authToken: 'tok123', fetch: fetchMock });

    await client.getMyLibrary();
    const headers = (fetchMock as any).mock.calls[0][1].headers;
    expect(headers['Authorization']).toBe('Bearer tok123');
  });

  it('throws RegistryApiError on non-2xx', async () => {
    const fetchMock = mockFetch(404, { error: { code: 'NOT_FOUND', message: 'Listing not found' } });
    const client = new RegistryClient({ baseUrl: BASE, fetch: fetchMock });

    await expect(client.getListingDetail('missing')).rejects.toThrow(RegistryApiError);
    await expect(client.getListingDetail('missing')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('createPublishDraft sends POST with body', async () => {
    const draft = { draft_id: 'd1', status: 'draft' };
    const fetchMock = mockFetch(201, draft);
    const client = new RegistryClient({ baseUrl: BASE, authToken: 'tok', fetch: fetchMock });

    await client.createPublishDraft({ kind: 'employee', title: 'My Agent' });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/v1/publish/drafts`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"kind":"employee"'),
      }),
    );
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd packages/registry-client && pnpm test`

- [ ] **Step 5: Build registry-client**

Run: `cd packages/registry-client && pnpm build`

### Chunk A Validation

Run:
```bash
cd packages/registry-client && pnpm typecheck && pnpm test && pnpm build
cd apps/platform && pnpm typecheck && pnpm build
```

---

## Chunk B: Core API Endpoints

> **Depends on:** Chunk A
> **Parallel with:** Chunk C can start once A is done
> **Estimated effort:** large

### Task B.1: Search & Listing Endpoints

**Files:**
- Create: `apps/platform/src/routes/market.ts`
- Create: `apps/platform/src/services/search.ts`

- [ ] **Step 1: Create search service**

```typescript
// apps/platform/src/services/search.ts
import { eq, ilike, or, desc, asc, sql, and, inArray } from 'drizzle-orm';
import { listings, creators, packageVersions, listingTags } from '@aics/db-platform';
import type { PlatformDb } from '../db.js';

export interface SearchFilters {
  q?: string;
  kind?: string;
  risk_class?: string;
  tag?: string;
  sort?: string;
  page?: number;
  per_page?: number;
}

export async function searchListings(db: PlatformDb, filters: SearchFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.min(50, Math.max(1, filters.per_page ?? 20));
  const offset = (page - 1) * perPage;

  const conditions = [eq(listings.status, 'listed')];

  if (filters.kind) {
    conditions.push(eq(listings.kind, filters.kind));
  }

  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(
      or(
        ilike(listings.title, pattern),
        ilike(listings.summary, pattern),
      )!,
    );
  }

  // Tag filter requires subquery
  if (filters.tag) {
    const taggedIds = db
      .select({ listing_id: listingTags.listing_id })
      .from(listingTags)
      .where(eq(listingTags.tag, filters.tag));
    conditions.push(inArray(listings.listing_id, taggedIds));
  }

  const where = and(...conditions);

  // Sort
  let orderBy;
  switch (filters.sort) {
    case 'newest':
      orderBy = desc(listings.created_at);
      break;
    case 'updated':
      orderBy = desc(listings.updated_at);
      break;
    case 'rating':
      orderBy = desc(listings.rating_avg);
      break;
    case 'installs':
      orderBy = desc(listings.install_count);
      break;
    case 'relevance':
    default:
      // Simple relevance score: rating * ln(installs + 1)
      orderBy = desc(
        sql`${listings.rating_avg} * ln(${listings.install_count} + 1)`,
      );
      break;
  }

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(listings)
      .innerJoin(creators, eq(listings.creator_id, creators.creator_id))
      .where(where)
      .orderBy(orderBy)
      .limit(perPage)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(listings)
      .where(where),
  ]);

  const total = countResult[0]?.count ?? 0;

  return { items, page, per_page: perPage, total };
}
```

- [ ] **Step 2: Create market routes**

```typescript
// apps/platform/src/routes/market.ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, and, desc } from 'drizzle-orm';
import { listings, creators, packageVersions, reviews, listingTags, listingPreviews } from '@aics/db-platform';
import type { PlatformEnv } from '../types.js';
import { searchListings } from '../services/search.js';

const market = new Hono<PlatformEnv>();

// GET /v1/market/search
market.get('/search', async (c) => {
  const db = c.get('db');
  const params = {
    q: c.req.query('q'),
    kind: c.req.query('kind'),
    risk_class: c.req.query('risk_class'),
    tag: c.req.query('tag'),
    sort: c.req.query('sort'),
    page: c.req.query('page') ? parseInt(c.req.query('page')!, 10) : undefined,
    per_page: c.req.query('per_page') ? parseInt(c.req.query('per_page')!, 10) : undefined,
  };

  const result = await searchListings(db, params);

  // Transform joined rows into ListingSummary shape
  const items = await Promise.all(
    result.items.map(async (row) => {
      const listing = row.listings;
      const creator = row.creators;

      // Get latest version
      const [latestVersion] = await db
        .select()
        .from(packageVersions)
        .where(and(eq(packageVersions.listing_id, listing.listing_id), eq(packageVersions.status, 'active')))
        .orderBy(desc(packageVersions.published_at))
        .limit(1);

      // Get tags
      const tags = await db
        .select({ tag: listingTags.tag })
        .from(listingTags)
        .where(eq(listingTags.listing_id, listing.listing_id));

      return {
        listing_id: listing.listing_id,
        slug: listing.slug,
        kind: listing.kind,
        title: listing.title,
        summary: listing.summary ?? '',
        creator: {
          creator_id: creator.creator_id,
          handle: creator.handle,
          display_name: creator.display_name,
          verification_state: creator.verification_state,
        },
        status: listing.status,
        latest_version: latestVersion?.version ?? '0.0.0',
        rating: listing.rating_avg ?? 0,
        install_count: listing.install_count ?? 0,
        tags: tags.map((t) => t.tag),
      };
    }),
  );

  return c.json({
    items,
    page: result.page,
    per_page: result.per_page,
    total: result.total,
  });
});

// GET /v1/market/listings/:listingId
market.get('/listings/:listingId', async (c) => {
  const db = c.get('db');
  const listingId = c.req.param('listingId');

  const [row] = await db
    .select()
    .from(listings)
    .innerJoin(creators, eq(listings.creator_id, creators.creator_id))
    .where(eq(listings.listing_id, listingId))
    .limit(1);

  if (!row) throw new HTTPException(404, { message: 'Listing not found' });

  const listing = row.listings;
  const creator = row.creators;

  // Latest active version
  const [latestVersion] = await db
    .select()
    .from(packageVersions)
    .where(and(eq(packageVersions.listing_id, listingId), eq(packageVersions.status, 'active')))
    .orderBy(desc(packageVersions.published_at))
    .limit(1);

  // Tags
  const tags = await db
    .select({ tag: listingTags.tag })
    .from(listingTags)
    .where(eq(listingTags.listing_id, listingId));

  // Previews
  const previews = await db
    .select()
    .from(listingPreviews)
    .where(eq(listingPreviews.listing_id, listingId))
    .orderBy(listingPreviews.sort_order);

  const manifest = latestVersion?.manifest_json as Record<string, any> | undefined;

  return c.json({
    listing_id: listing.listing_id,
    slug: listing.slug,
    kind: listing.kind,
    title: listing.title,
    summary: listing.summary ?? '',
    description: listing.description ?? '',
    creator: {
      creator_id: creator.creator_id,
      handle: creator.handle,
      display_name: creator.display_name,
      verification_state: creator.verification_state,
    },
    status: listing.status,
    latest_version: latestVersion?.version ?? '0.0.0',
    rating: listing.rating_avg ?? 0,
    install_count: listing.install_count ?? 0,
    tags: tags.map((t) => t.tag),
    version: latestVersion
      ? {
          package_id: latestVersion.package_id,
          version: latestVersion.version,
          runtime_range: latestVersion.runtime_range,
          schema_version: latestVersion.schema_version,
          environments: latestVersion.environments,
          risk_class: latestVersion.risk_class,
          published_at: latestVersion.published_at.toISOString(),
          changelog: latestVersion.changelog,
        }
      : undefined,
    requirements: {
      required_capabilities: manifest?.requirements?.required_capabilities ?? [],
      required_mcps: manifest?.requirements?.required_mcps ?? [],
      recommended_models: manifest?.requirements?.recommended_models ?? [],
    },
    permissions: {
      risk_class: manifest?.permissions?.risk_class ?? latestVersion?.risk_class,
      declares_secrets: manifest?.permissions?.declares_secrets ?? false,
      filesystem_scope: manifest?.permissions?.filesystem_scope ?? 'none',
      network_scope: manifest?.permissions?.network_scope ?? 'none',
    },
    lineage: manifest?.lineage ?? undefined,
    previews: previews.map((p) => ({
      kind: p.kind,
      url: p.url,
      alt: p.alt_text,
    })),
  });
});

// GET /v1/market/listings/:listingId/versions
market.get('/listings/:listingId/versions', async (c) => {
  const db = c.get('db');
  const listingId = c.req.param('listingId');

  // Verify listing exists
  const [listing] = await db
    .select({ listing_id: listings.listing_id })
    .from(listings)
    .where(eq(listings.listing_id, listingId))
    .limit(1);

  if (!listing) throw new HTTPException(404, { message: 'Listing not found' });

  const versions = await db
    .select()
    .from(packageVersions)
    .where(and(eq(packageVersions.listing_id, listingId), eq(packageVersions.status, 'active')))
    .orderBy(desc(packageVersions.published_at));

  return c.json({
    listing_id: listingId,
    versions: versions.map((v) => ({
      package_id: v.package_id,
      version: v.version,
      runtime_range: v.runtime_range,
      schema_version: v.schema_version,
      environments: v.environments,
      risk_class: v.risk_class,
      published_at: v.published_at.toISOString(),
      changelog: v.changelog,
    })),
  });
});

// GET /v1/market/listings/:listingId/reviews
market.get('/listings/:listingId/reviews', async (c) => {
  const db = c.get('db');
  const listingId = c.req.param('listingId');

  const [listing] = await db
    .select({ listing_id: listings.listing_id })
    .from(listings)
    .where(eq(listings.listing_id, listingId))
    .limit(1);

  if (!listing) throw new HTTPException(404, { message: 'Listing not found' });

  const reviewRows = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.listing_id, listingId), eq(reviews.moderation_state, 'visible')))
    .orderBy(desc(reviews.created_at));

  return c.json({
    listing_id: listingId,
    reviews: reviewRows.map((r) => ({
      review_id: r.review_id,
      listing_id: r.listing_id,
      user_id: r.user_id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      moderation_state: r.moderation_state,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    })),
  });
});

export { market };
```

- [ ] **Step 3: Mount market routes in index.ts**

Add to `apps/platform/src/index.ts`:
```typescript
import { market } from './routes/market.js';
// ...
app.route('/v1/market', market);
```

- [ ] **Step 4: Verify typecheck**

Run: `cd apps/platform && pnpm typecheck`

### Task B.2: Creator Profile Endpoint

**Files:**
- Create: `apps/platform/src/routes/creators.ts`

- [ ] **Step 1: Create creators route**

```typescript
// apps/platform/src/routes/creators.ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, desc } from 'drizzle-orm';
import { creators, listings } from '@aics/db-platform';
import type { PlatformEnv } from '../types.js';

const creatorsRoute = new Hono<PlatformEnv>();

// GET /v1/market/creators/:handle
creatorsRoute.get('/:handle', async (c) => {
  const db = c.get('db');
  const handle = c.req.param('handle');

  const [creator] = await db
    .select()
    .from(creators)
    .where(eq(creators.handle, handle))
    .limit(1);

  if (!creator) throw new HTTPException(404, { message: 'Creator not found' });

  const creatorListings = await db
    .select()
    .from(listings)
    .where(eq(listings.creator_id, creator.creator_id))
    .orderBy(desc(listings.updated_at));

  return c.json({
    creator_id: creator.creator_id,
    handle: creator.handle,
    display_name: creator.display_name,
    verification_state: creator.verification_state,
    bio: creator.bio,
    website_url: creator.website_url,
    created_at: creator.created_at.toISOString(),
    listings: creatorListings.map((l) => ({
      listing_id: l.listing_id,
      slug: l.slug,
      kind: l.kind,
      title: l.title,
      summary: l.summary ?? '',
      status: l.status,
      rating: l.rating_avg ?? 0,
      install_count: l.install_count ?? 0,
    })),
  });
});

export { creatorsRoute };
```

- [ ] **Step 2: Mount creators under market group**

Add to `apps/platform/src/index.ts`:
```typescript
import { creatorsRoute } from './routes/creators.js';
// Mount under market group:
app.route('/v1/market/creators', creatorsRoute);
```

### Task B.3: Reviews Endpoint

**Files:**
- Create: `apps/platform/src/routes/reviews.ts`

- [ ] **Step 1: Create reviews route**

```typescript
// apps/platform/src/routes/reviews.ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, and, sql } from 'drizzle-orm';
import { reviews, listings } from '@aics/db-platform';
import { requireAuth } from '../middleware/auth.js';
import type { PlatformEnv } from '../types.js';

const reviewsRoute = new Hono<PlatformEnv>();

// POST /v1/reviews — create or update a review
reviewsRoute.post('/', requireAuth, async (c) => {
  const db = c.get('db');
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    listing_id: string;
    rating: number;
    title?: string;
    body?: string;
  }>();

  // Validate rating range
  if (!body.listing_id || !body.rating || body.rating < 1 || body.rating > 5) {
    throw new HTTPException(400, { message: 'listing_id and rating (1-5) are required' });
  }

  // Verify listing exists
  const [listing] = await db
    .select({ listing_id: listings.listing_id })
    .from(listings)
    .where(eq(listings.listing_id, body.listing_id))
    .limit(1);

  if (!listing) throw new HTTPException(404, { message: 'Listing not found' });

  // Upsert: check if user already reviewed this listing
  const [existing] = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.listing_id, body.listing_id), eq(reviews.user_id, userId)))
    .limit(1);

  let review;
  if (existing) {
    // Update existing review
    [review] = await db
      .update(reviews)
      .set({
        rating: body.rating,
        title: body.title ?? null,
        body: body.body ?? null,
        updated_at: new Date(),
      })
      .where(eq(reviews.review_id, existing.review_id))
      .returning();
  } else {
    // Create new review
    [review] = await db
      .insert(reviews)
      .values({
        listing_id: body.listing_id,
        user_id: userId,
        rating: body.rating,
        title: body.title ?? null,
        body: body.body ?? null,
      })
      .returning();
  }

  // Update listing rating aggregates
  const [agg] = await db
    .select({
      avg: sql<number>`avg(rating)::real`,
      count: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(and(eq(reviews.listing_id, body.listing_id), eq(reviews.moderation_state, 'visible')));

  await db
    .update(listings)
    .set({
      rating_avg: agg?.avg ?? 0,
      rating_count: agg?.count ?? 0,
      updated_at: new Date(),
    })
    .where(eq(listings.listing_id, body.listing_id));

  return c.json(
    {
      review_id: review.review_id,
      listing_id: review.listing_id,
      user_id: review.user_id,
      rating: review.rating,
      title: review.title,
      body: review.body,
      moderation_state: review.moderation_state,
      created_at: review.created_at.toISOString(),
      updated_at: review.updated_at.toISOString(),
    },
    existing ? 200 : 201,
  );
});

export { reviewsRoute };
```

- [ ] **Step 2: Mount reviews route**

Add to `apps/platform/src/index.ts`:
```typescript
import { reviewsRoute } from './routes/reviews.js';
app.route('/v1/reviews', reviewsRoute);
```

### Task B.4: User Library Endpoint

- [ ] **Step 1: Add to market.ts or create separate route**

Add to `apps/platform/src/routes/market.ts` (or create `routes/library.ts`):

```typescript
// In a new file apps/platform/src/routes/library.ts
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { userLibrary, listings, packageVersions, creators } from '@aics/db-platform';
import { requireAuth } from '../middleware/auth.js';
import type { PlatformEnv } from '../types.js';

const library = new Hono<PlatformEnv>();

library.get('/library', requireAuth, async (c) => {
  const db = c.get('db');
  const userId = c.get('userId')!;
  const kindFilter = c.req.query('kind');

  let query = db
    .select()
    .from(userLibrary)
    .innerJoin(listings, eq(userLibrary.listing_id, listings.listing_id))
    .innerJoin(creators, eq(listings.creator_id, creators.creator_id))
    .where(eq(userLibrary.user_id, userId));

  const rows = await query;

  const items = await Promise.all(
    rows
      .filter((row) => !kindFilter || row.listings.kind === kindFilter)
      .map(async (row) => {
        const [version] = await db
          .select()
          .from(packageVersions)
          .where(
            row.user_library.package_version_id
              ? eq(packageVersions.package_version_id, row.user_library.package_version_id)
              : eq(packageVersions.listing_id, row.listings.listing_id),
          )
          .limit(1);

        return {
          listing: {
            listing_id: row.listings.listing_id,
            slug: row.listings.slug,
            kind: row.listings.kind,
            title: row.listings.title,
            summary: row.listings.summary ?? '',
            creator: {
              creator_id: row.creators.creator_id,
              handle: row.creators.handle,
              display_name: row.creators.display_name,
              verification_state: row.creators.verification_state,
            },
            status: row.listings.status,
            latest_version: version?.version ?? '0.0.0',
            rating: row.listings.rating_avg ?? 0,
            install_count: row.listings.install_count ?? 0,
          },
          version: version
            ? {
                package_id: version.package_id,
                version: version.version,
                runtime_range: version.runtime_range,
                schema_version: version.schema_version,
                environments: version.environments,
                risk_class: version.risk_class,
              }
            : undefined,
          saved_at: row.user_library.saved_at.toISOString(),
          install_receipt_id: row.user_library.install_receipt_id,
        };
      }),
  );

  return c.json({ items });
});

export { library };
```

- [ ] **Step 2: Mount library route**

Add to `apps/platform/src/index.ts`:
```typescript
import { library } from './routes/library.js';
app.route('/v1/me', library);
```

### Task B.5: Platform API Tests

**Files:**
- Create: `apps/platform/src/__tests__/market.test.ts`

- [ ] **Step 1: Write integration tests using Hono test helper**

```typescript
// apps/platform/src/__tests__/market.test.ts
import { describe, it, expect } from 'vitest';
import { app } from '../index.js';

// Note: these tests require a running PostgreSQL with seed data.
// For unit tests, mock the DB. For integration, use a test database.
// This file provides the test structure; actual DB setup is a task for CI.

describe('Platform API - Market Routes', () => {
  it('GET /health returns ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  // Integration tests (require DB) — skip in CI without DB
  describe.skipIf(!process.env.DATABASE_URL)('with database', () => {
    it('GET /v1/market/search returns paginated results', async () => {
      const res = await app.request('/v1/market/search?per_page=5');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('items');
      expect(body).toHaveProperty('page');
      expect(body).toHaveProperty('total');
    });

    it('GET /v1/market/listings/:id returns 404 for missing', async () => {
      const res = await app.request('/v1/market/listings/00000000-0000-0000-0000-000000000000');
      expect(res.status).toBe(404);
    });
  });
});
```

- [ ] **Step 2: Verify typecheck**

Run: `cd apps/platform && pnpm typecheck`

### Chunk B Validation

Run:
```bash
cd apps/platform && pnpm typecheck && pnpm build
```

---

## Chunk C: Marketplace Website Pages

> **Depends on:** Chunk A (registry-client types)
> **Parallel with:** Chunk B (API endpoints — market pages can use mock data initially)
> **Estimated effort:** large

### Task C.1: Tailwind + Global Styles Setup

**Files:**
- Modify: `apps/market/package.json`
- Create: `apps/market/tailwind.config.ts`
- Create: `apps/market/postcss.config.mjs`
- Create: `apps/market/src/app/globals.css`
- Modify: `apps/market/src/app/layout.tsx`

- [ ] **Step 1: Add dependencies**

Add to `apps/market/package.json`:
```json
{
  "dependencies": {
    "lucide-react": "^0.468.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.0.0",
    "tailwindcss": "^4.0.0"
  }
}
```

Run: `cd apps/market && pnpm install`

- [ ] **Step 2: Create PostCSS config**

```javascript
// apps/market/postcss.config.mjs
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

- [ ] **Step 3: Create Tailwind config**

```typescript
// apps/market/tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      maxWidth: {
        content: '1200px',
        reading: '800px',
      },
      colors: {
        surface: {
          DEFAULT: 'var(--surface)',
          elevated: 'var(--surface-elevated)',
        },
      },
    },
  },
};

export default config;
```

- [ ] **Step 4: Create globals.css**

```css
/* apps/market/src/app/globals.css */
@import 'tailwindcss';

:root {
  --surface: #ffffff;
  --surface-elevated: #f8f9fa;
  --border: #e2e8f0;
  --muted: #64748b;
  --accent: #2563eb;
  --success: #16a34a;
  --warning: #d97706;
  --destructive: #dc2626;
}

body {
  font-family: system-ui, -apple-system, sans-serif;
  color: #0f172a;
  background: var(--surface);
}
```

- [ ] **Step 5: Update layout.tsx**

```tsx
// apps/market/src/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    template: '%s — AICS Talent Market',
    default: 'AICS Talent Market — Discover AI Company Assets',
  },
  description: 'Browse, discover, and install AI company employees, skills, SOPs, and templates for AI Company Simulator.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white antialiased">
        <header className="border-b border-gray-200">
          <nav className="mx-auto flex max-w-content items-center justify-between px-6 py-4">
            <a href="/" className="text-lg font-semibold text-gray-900">
              AICS Talent Market
            </a>
            <div className="flex items-center gap-6">
              <a href="/search" className="text-sm text-gray-600 hover:text-gray-900">
                Browse
              </a>
              <a href="/about" className="text-sm text-gray-600 hover:text-gray-900">
                About
              </a>
            </div>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="mt-16 border-t border-gray-200 py-8">
          <div className="mx-auto max-w-content px-6 text-center text-sm text-gray-500">
            AI Company Simulator — Open Source Runtime + Talent Market
          </div>
        </footer>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Verify build**

Run: `cd apps/market && pnpm build`

### Task C.2: Registry Client Helper

**Files:**
- Create: `apps/market/src/lib/registry.ts`
- Create: `apps/market/src/lib/format.ts`

- [ ] **Step 1: Create server-side registry client instance**

```typescript
// apps/market/src/lib/registry.ts
import { RegistryClient } from '@aics/registry-client';

const PLATFORM_API_URL = process.env.PLATFORM_API_URL ?? 'http://localhost:4100';

export function getRegistryClient() {
  return new RegistryClient({ baseUrl: PLATFORM_API_URL });
}
```

- [ ] **Step 2: Create formatting helpers**

```typescript
// apps/market/src/lib/format.ts
export function formatInstallCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

export function formatRating(rating: number): string {
  return rating.toFixed(1);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function kindLabel(kind: string): string {
  const labels: Record<string, string> = {
    employee: 'Employee',
    skill: 'Skill',
    sop: 'SOP',
    company_template: 'Template',
    office_layout: 'Layout',
    bundle: 'Bundle',
  };
  return labels[kind] ?? kind;
}

export function riskLabel(risk: string): string {
  const labels: Record<string, string> = {
    data_asset: 'Data Only',
    logic_asset: 'Logic',
    privileged_asset: 'Privileged',
  };
  return labels[risk] ?? risk;
}
```

### Task C.3: Shared Components

**Files:**
- Create: `apps/market/src/components/ListingCard.tsx`
- Create: `apps/market/src/components/RiskBadge.tsx`
- Create: `apps/market/src/components/KindIcon.tsx`
- Create: `apps/market/src/components/RatingStars.tsx`
- Create: `apps/market/src/components/CreatorBadge.tsx`

- [ ] **Step 1: Create KindIcon component**

```tsx
// apps/market/src/components/KindIcon.tsx
import { User, Zap, GitBranch, Building2, LayoutGrid, Package } from 'lucide-react';

const icons: Record<string, typeof User> = {
  employee: User,
  skill: Zap,
  sop: GitBranch,
  company_template: Building2,
  office_layout: LayoutGrid,
  bundle: Package,
};

export function KindIcon({ kind, size = 16 }: { kind: string; size?: number }) {
  const Icon = icons[kind] ?? Package;
  return <Icon size={size} className="text-gray-500" />;
}
```

- [ ] **Step 2: Create RiskBadge component**

```tsx
// apps/market/src/components/RiskBadge.tsx
import { riskLabel } from '../lib/format';

const colors: Record<string, string> = {
  data_asset: 'bg-green-50 text-green-700 border-green-200',
  logic_asset: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  privileged_asset: 'bg-red-50 text-red-700 border-red-200',
};

export function RiskBadge({ risk }: { risk: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium border ${colors[risk] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>
      {riskLabel(risk)}
    </span>
  );
}
```

- [ ] **Step 3: Create RatingStars component**

```tsx
// apps/market/src/components/RatingStars.tsx
import { Star } from 'lucide-react';

export function RatingStars({ rating, count }: { rating: number; count?: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm">
      <Star size={14} className="fill-yellow-400 text-yellow-400" />
      <span className="font-medium">{rating.toFixed(1)}</span>
      {count !== undefined && <span className="text-gray-400">({count})</span>}
    </span>
  );
}
```

- [ ] **Step 4: Create CreatorBadge component**

```tsx
// apps/market/src/components/CreatorBadge.tsx
import { ShieldCheck } from 'lucide-react';

interface Props {
  handle: string;
  display_name: string;
  verification_state: string;
}

export function CreatorBadge({ handle, display_name, verification_state }: Props) {
  return (
    <a href={`/creator/${handle}`} className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
      <span>@{handle}</span>
      {verification_state === 'verified' && (
        <ShieldCheck size={14} className="text-blue-500" aria-label="Verified creator" />
      )}
      {verification_state === 'trusted' && (
        <ShieldCheck size={14} className="text-green-500" aria-label="Trusted creator" />
      )}
    </a>
  );
}
```

- [ ] **Step 5: Create ListingCard component**

```tsx
// apps/market/src/components/ListingCard.tsx
import type { ListingSummary } from '@aics/registry-client';
import { KindIcon } from './KindIcon';
import { RiskBadge } from './RiskBadge';
import { RatingStars } from './RatingStars';
import { CreatorBadge } from './CreatorBadge';
import { formatInstallCount, kindLabel } from '../lib/format';

export function ListingCard({ listing }: { listing: ListingSummary }) {
  return (
    <a
      href={`/listing/${listing.slug}`}
      className="block rounded-lg border border-gray-200 p-4 transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <KindIcon kind={listing.kind} size={18} />
          <h3 className="font-semibold text-gray-900 line-clamp-1">{listing.title}</h3>
        </div>
        <RatingStars rating={listing.rating} />
      </div>

      <div className="mt-1">
        <CreatorBadge
          handle={listing.creator.handle}
          display_name={listing.creator.display_name}
          verification_state={listing.creator.verification_state}
        />
        <span className="mx-1.5 text-gray-300">·</span>
        <span className="text-xs text-gray-500">{kindLabel(listing.kind)}</span>
      </div>

      <p className="mt-2 text-sm text-gray-600 line-clamp-2">{listing.summary}</p>

      <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
        <span>v{listing.latest_version}</span>
        <span className="text-gray-300">·</span>
        <span>{formatInstallCount(listing.install_count)} installs</span>
        {listing.tags && listing.tags.length > 0 && (
          <>
            <span className="text-gray-300">·</span>
            {listing.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded bg-gray-100 px-1.5 py-0.5">
                {tag}
              </span>
            ))}
          </>
        )}
      </div>
    </a>
  );
}
```

### Task C.4: Home Page (Catalog)

**Files:**
- Modify: `apps/market/src/app/page.tsx`

- [ ] **Step 1: Implement home page with featured listings**

```tsx
// apps/market/src/app/page.tsx
import { getRegistryClient } from '../lib/registry';
import { ListingCard } from '../components/ListingCard';

export default async function Home() {
  let listings;
  try {
    const client = getRegistryClient();
    const result = await client.searchListings({ sort: 'installs', per_page: 12 });
    listings = result.items;
  } catch {
    listings = [];
  }

  return (
    <div className="mx-auto max-w-content px-6 py-8">
      <section className="mb-12">
        <h1 className="text-2xl font-bold text-gray-900">Discover AI Company Assets</h1>
        <p className="mt-2 text-gray-600">
          Browse employees, skills, SOPs, and templates for your AI company.
        </p>
      </section>

      {listings.length > 0 ? (
        <section>
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Popular</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <ListingCard key={listing.listing_id} listing={listing} />
            ))}
          </div>
          <div className="mt-6 text-center">
            <a
              href="/search"
              className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Browse all assets
            </a>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-gray-200 py-12 text-center">
          <p className="text-gray-500">No listings available yet. Check back soon.</p>
        </section>
      )}
    </div>
  );
}
```

### Task C.5: Search Page

**Files:**
- Create: `apps/market/src/app/search/page.tsx`
- Create: `apps/market/src/components/SearchFilters.tsx`

- [ ] **Step 1: Create SearchFilters component**

```tsx
// apps/market/src/components/SearchFilters.tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { kindLabel } from '../lib/format';

const KINDS = ['employee', 'skill', 'sop', 'company_template', 'office_layout', 'bundle'] as const;
const SORTS = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'newest', label: 'Newest' },
  { value: 'rating', label: 'Top Rated' },
  { value: 'installs', label: 'Most Installed' },
] as const;

export function SearchFilters() {
  const router = useRouter();
  const params = useSearchParams();

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page'); // Reset pagination on filter change
    router.push(`/search?${next}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        className="rounded border border-gray-300 px-3 py-1.5 text-sm"
        value={params.get('kind') ?? ''}
        onChange={(e) => update('kind', e.target.value)}
        aria-label="Filter by kind"
      >
        <option value="">All Types</option>
        {KINDS.map((k) => (
          <option key={k} value={k}>{kindLabel(k)}</option>
        ))}
      </select>

      <select
        className="rounded border border-gray-300 px-3 py-1.5 text-sm"
        value={params.get('sort') ?? 'relevance'}
        onChange={(e) => update('sort', e.target.value)}
        aria-label="Sort by"
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Create search page**

```tsx
// apps/market/src/app/search/page.tsx
import type { Metadata } from 'next';
import { getRegistryClient } from '../../lib/registry';
import { ListingCard } from '../../components/ListingCard';
import { SearchFilters } from '../../components/SearchFilters';

interface Props {
  searchParams: Promise<Record<string, string | undefined>>;
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const params = await searchParams;
  const q = params.q;
  return {
    title: q ? `"${q}" — Search` : 'Browse Assets',
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const params = await searchParams;
  const client = getRegistryClient();

  let result;
  try {
    result = await client.searchListings({
      q: params.q,
      kind: params.kind as any,
      tag: params.tag,
      sort: (params.sort as any) ?? 'relevance',
      page: params.page ? parseInt(params.page, 10) : 1,
      per_page: 20,
    });
  } catch {
    result = { items: [], page: 1, per_page: 20, total: 0 };
  }

  const totalPages = Math.ceil(result.total / result.per_page);

  return (
    <div className="mx-auto max-w-content px-6 py-8">
      {/* Search bar */}
      <form method="get" action="/search" className="mb-6">
        <div className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Search employees, skills, SOPs..."
            className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            aria-label="Search assets"
          />
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Search
          </button>
        </div>
      </form>

      {/* Filters */}
      <div className="mb-6 flex items-center justify-between">
        <SearchFilters />
        <span className="text-sm text-gray-500">
          {result.total} {result.total === 1 ? 'result' : 'results'}
        </span>
      </div>

      {/* Results */}
      {result.items.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.items.map((listing) => (
              <ListingCard key={listing.listing_id} listing={listing} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav className="mt-8 flex justify-center gap-2" aria-label="Pagination">
              {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => i + 1).map((p) => {
                const qs = new URLSearchParams();
                if (params.q) qs.set('q', params.q);
                if (params.kind) qs.set('kind', params.kind);
                if (params.sort) qs.set('sort', params.sort);
                qs.set('page', String(p));
                return (
                  <a
                    key={p}
                    href={`/search?${qs}`}
                    className={`rounded px-3 py-1 text-sm ${
                      p === result.page
                        ? 'bg-blue-600 text-white'
                        : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {p}
                  </a>
                );
              })}
            </nav>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-gray-200 py-12 text-center">
          <p className="text-gray-500">No assets found matching your criteria.</p>
        </div>
      )}
    </div>
  );
}
```

### Task C.6: Listing Detail Page

**Files:**
- Create: `apps/market/src/app/listing/[slug]/page.tsx`
- Create: `apps/market/src/components/InstallButton.tsx`
- Create: `apps/market/src/components/VersionTable.tsx`
- Create: `apps/market/src/components/ReviewList.tsx`
- Create: `apps/market/src/components/PermissionsPanel.tsx`

- [ ] **Step 1: Create InstallButton component**

```tsx
// apps/market/src/components/InstallButton.tsx
'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';

interface Props {
  listingId: string;
  version: string;
}

export function InstallButton({ listingId, version }: Props) {
  const [showFallback, setShowFallback] = useState(false);

  function handleInstall() {
    const deepLink = `aics://install?listing_id=${listingId}&version=${encodeURIComponent(version)}`;
    // Try deep link
    window.location.href = deepLink;
    // Show fallback after a timeout if app didn't open
    setTimeout(() => setShowFallback(true), 2000);
  }

  return (
    <div>
      <button
        onClick={handleInstall}
        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
      >
        <Download size={16} />
        Install in AICS
      </button>

      {showFallback && (
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-4 text-sm">
          <p className="font-medium text-gray-900">Desktop app not detected</p>
          <p className="mt-1 text-gray-600">
            To install assets, you need the AICS Desktop app.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(
                  `aics://install?listing_id=${listingId}&version=${encodeURIComponent(version)}`,
                );
              }}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs hover:bg-white"
            >
              Copy install link
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create PermissionsPanel**

```tsx
// apps/market/src/components/PermissionsPanel.tsx
import { Shield, FolderOpen, Wifi, KeyRound } from 'lucide-react';
import type { PermissionSummary } from '@aics/registry-client';
import { RiskBadge } from './RiskBadge';

export function PermissionsPanel({ permissions }: { permissions: PermissionSummary }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Shield size={16} />
        Permissions
      </h3>
      <div className="space-y-2 text-sm">
        {permissions.risk_class && (
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Risk class:</span>
            <RiskBadge risk={permissions.risk_class} />
          </div>
        )}
        <div className="flex items-center gap-2">
          <FolderOpen size={14} className="text-gray-400" />
          <span className="text-gray-600">
            Filesystem: {permissions.filesystem_scope ?? 'none'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Wifi size={14} className="text-gray-400" />
          <span className="text-gray-600">
            Network: {permissions.network_scope ?? 'none'}
          </span>
        </div>
        {permissions.declares_secrets && (
          <div className="flex items-center gap-2 text-yellow-700">
            <KeyRound size={14} />
            <span>Requires secret bindings after install</span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create VersionTable**

```tsx
// apps/market/src/components/VersionTable.tsx
import type { VersionSummary } from '@aics/registry-client';
import { formatDate } from '../lib/format';
import { RiskBadge } from './RiskBadge';

export function VersionTable({ versions }: { versions: VersionSummary[] }) {
  if (versions.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-500">
            <th className="pb-2 font-medium">Version</th>
            <th className="pb-2 font-medium">Runtime</th>
            <th className="pb-2 font-medium">Environments</th>
            <th className="pb-2 font-medium">Risk</th>
            <th className="pb-2 font-medium">Published</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.version} className="border-b border-gray-100">
              <td className="py-2 font-mono text-xs">{v.version}</td>
              <td className="py-2 font-mono text-xs">{v.runtime_range}</td>
              <td className="py-2">
                <div className="flex gap-1">
                  {v.environments.map((env) => (
                    <span key={env} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">
                      {env}
                    </span>
                  ))}
                </div>
              </td>
              <td className="py-2">
                <RiskBadge risk={v.risk_class} />
              </td>
              <td className="py-2 text-gray-500">
                {v.published_at ? formatDate(v.published_at) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Create ReviewList**

```tsx
// apps/market/src/components/ReviewList.tsx
import type { Review } from '@aics/registry-client';
import { RatingStars } from './RatingStars';
import { formatDate } from '../lib/format';

export function ReviewList({ reviews }: { reviews: Review[] }) {
  if (reviews.length === 0) {
    return <p className="text-sm text-gray-500">No reviews yet.</p>;
  }

  return (
    <div className="space-y-4">
      {reviews.map((r) => (
        <div key={r.review_id} className="border-b border-gray-100 pb-4">
          <div className="flex items-center gap-2">
            <RatingStars rating={r.rating} />
            {r.title && <span className="font-medium text-gray-900">{r.title}</span>}
          </div>
          {r.body && <p className="mt-1 text-sm text-gray-600">{r.body}</p>}
          <p className="mt-1 text-xs text-gray-400">{formatDate(r.created_at)}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Create listing detail page**

```tsx
// apps/market/src/app/listing/[slug]/page.tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getRegistryClient } from '../../../lib/registry';
import { KindIcon } from '../../../components/KindIcon';
import { RatingStars } from '../../../components/RatingStars';
import { CreatorBadge } from '../../../components/CreatorBadge';
import { InstallButton } from '../../../components/InstallButton';
import { PermissionsPanel } from '../../../components/PermissionsPanel';
import { VersionTable } from '../../../components/VersionTable';
import { ReviewList } from '../../../components/ReviewList';
import { RiskBadge } from '../../../components/RiskBadge';
import { kindLabel, formatInstallCount } from '../../../lib/format';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const client = getRegistryClient();
    const listing = await client.getListingBySlug(slug);
    return {
      title: listing.title,
      description: listing.summary,
      openGraph: {
        title: `${listing.title} — AICS Talent Market`,
        description: listing.summary,
      },
    };
  } catch {
    return { title: 'Asset Not Found' };
  }
}

export default async function ListingPage({ params }: Props) {
  const { slug } = await params;
  const client = getRegistryClient();

  let listing;
  try {
    listing = await client.getListingBySlug(slug);
  } catch {
    notFound();
  }

  const [versionsData, reviewsData] = await Promise.all([
    client.listListingVersions(listing.listing_id).catch(() => ({ listing_id: listing.listing_id, versions: [] })),
    client.listListingReviews(listing.listing_id).catch(() => ({ listing_id: listing.listing_id, reviews: [] })),
  ]);

  return (
    <div className="mx-auto max-w-content px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <KindIcon kind={listing.kind} size={24} />
          <h1 className="text-2xl font-bold text-gray-900">{listing.title}</h1>
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
            {kindLabel(listing.kind)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-4">
          <CreatorBadge
            handle={listing.creator.handle}
            display_name={listing.creator.display_name}
            verification_state={listing.creator.verification_state}
          />
          <RatingStars rating={listing.rating} count={listing.install_count} />
          <span className="text-sm text-gray-500">
            {formatInstallCount(listing.install_count)} installs
          </span>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Install bar */}
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-mono text-xs text-gray-600">
                  v{listing.version?.version ?? listing.latest_version}
                </span>
                {listing.version && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="font-mono text-xs text-gray-600">
                      runtime {listing.version.runtime_range}
                    </span>
                    <span className="text-gray-300">·</span>
                    {listing.version.environments.map((env) => (
                      <span key={env} className="rounded bg-white px-1.5 py-0.5 text-xs border border-gray-200">
                        {env}
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
            <InstallButton
              listingId={listing.listing_id}
              version={listing.version?.version ?? listing.latest_version}
            />
          </div>

          {/* Description */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">Description</h2>
            <div className="prose prose-sm max-w-none text-gray-700">
              {listing.description || <p className="text-gray-400 italic">No description provided.</p>}
            </div>
          </section>

          {/* Requirements */}
          {listing.requirements && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-gray-900">Requirements</h2>
              <div className="space-y-2 text-sm">
                {listing.requirements.required_capabilities && listing.requirements.required_capabilities.length > 0 && (
                  <div>
                    <span className="font-medium text-gray-700">Capabilities: </span>
                    {listing.requirements.required_capabilities.join(', ')}
                  </div>
                )}
                {listing.requirements.required_mcps && listing.requirements.required_mcps.length > 0 && (
                  <div>
                    <span className="font-medium text-gray-700">Required MCPs: </span>
                    {listing.requirements.required_mcps.join(', ')}
                  </div>
                )}
                {listing.requirements.recommended_models && listing.requirements.recommended_models.length > 0 && (
                  <div>
                    <span className="font-medium text-gray-700">Recommended models: </span>
                    {listing.requirements.recommended_models.map((m) => m.profile).join(', ')}
                    <p className="mt-1 text-xs text-gray-400">
                      Model recommendations are suggestions only. Your local runtime determines the actual model used.
                    </p>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Lineage */}
          {listing.lineage && (listing.lineage.origin_package_id || listing.lineage.forked_from_version) && (
            <section>
              <h2 className="mb-3 text-lg font-semibold text-gray-900">Lineage</h2>
              <div className="text-sm text-gray-600">
                {listing.lineage.origin_package_id && (
                  <p>Derived from: <span className="font-mono text-xs">{listing.lineage.origin_package_id}</span></p>
                )}
                {listing.lineage.forked_from_version && (
                  <p>Forked from version: <span className="font-mono text-xs">{listing.lineage.forked_from_version}</span></p>
                )}
              </div>
            </section>
          )}

          {/* Versions */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">Versions</h2>
            <VersionTable versions={versionsData.versions} />
          </section>

          {/* Reviews */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-gray-900">Reviews</h2>
            <ReviewList reviews={reviewsData.reviews} />
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <PermissionsPanel permissions={listing.permissions} />

          {listing.tags && listing.tags.length > 0 && (
            <div className="rounded-lg border border-gray-200 p-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Tags</h3>
              <div className="flex flex-wrap gap-1">
                {listing.tags.map((tag) => (
                  <a
                    key={tag}
                    href={`/search?tag=${tag}`}
                    className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-200"
                  >
                    {tag}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

### Task C.7: Creator Profile Page

**Files:**
- Create: `apps/market/src/app/creator/[handle]/page.tsx`

- [ ] **Step 1: Create creator profile page**

```tsx
// apps/market/src/app/creator/[handle]/page.tsx
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getRegistryClient } from '../../../lib/registry';
import { ListingCard } from '../../../components/ListingCard';
import { ShieldCheck, Globe } from 'lucide-react';

interface Props {
  params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  try {
    const client = getRegistryClient();
    const creator = await client.getCreatorProfile(handle);
    return {
      title: `${creator.display_name} (@${creator.handle})`,
      description: creator.bio ?? `Creator profile for @${creator.handle}`,
    };
  } catch {
    return { title: 'Creator Not Found' };
  }
}

export default async function CreatorPage({ params }: Props) {
  const { handle } = await params;
  const client = getRegistryClient();

  let creator;
  try {
    creator = await client.getCreatorProfile(handle);
  } catch {
    notFound();
  }

  return (
    <div className="mx-auto max-w-content px-6 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{creator.display_name}</h1>
          {creator.verification_state === 'verified' && (
            <ShieldCheck size={20} className="text-blue-500" aria-label="Verified" />
          )}
          {creator.verification_state === 'trusted' && (
            <ShieldCheck size={20} className="text-green-500" aria-label="Trusted" />
          )}
        </div>
        <p className="mt-1 text-gray-500">@{creator.handle}</p>
        {creator.bio && <p className="mt-2 text-gray-700">{creator.bio}</p>}
        {creator.website_url && (
          <a
            href={creator.website_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
          >
            <Globe size={14} />
            {creator.website_url.replace(/^https?:\/\//, '')}
          </a>
        )}
      </div>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Published Assets ({creator.listings.length})
        </h2>
        {creator.listings.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {creator.listings.map((listing) => (
              <ListingCard key={listing.listing_id} listing={listing as any} />
            ))}
          </div>
        ) : (
          <p className="text-gray-500">No published assets yet.</p>
        )}
      </section>
    </div>
  );
}
```

### Chunk C Validation

Run:
```bash
cd apps/market && pnpm typecheck && pnpm build
```

---

## Chunk D: Publishing Workflow

> **Depends on:** Chunk B (platform API)
> **Parallel with:** Chunk C (market pages)
> **Estimated effort:** medium

### Task D.1: Publish Routes

**Files:**
- Create: `apps/platform/src/routes/publish.ts`
- Create: `apps/platform/src/services/validation.ts`
- Create: `apps/platform/src/services/moderation.ts`

- [ ] **Step 1: Create manifest validation service**

```typescript
// apps/platform/src/services/validation.ts
import type { PackageManifest } from '@aics/asset-schema';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_KINDS = ['employee', 'skill', 'sop', 'company_template', 'office_layout', 'bundle'];
const VALID_RISK_CLASSES = ['data_asset', 'logic_asset', 'privileged_asset'];
const VALID_ENVIRONMENTS = ['desktop', 'docker', 'web_limited'];

export function validateManifest(json: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!json || typeof json !== 'object') {
    return { valid: false, errors: ['Manifest must be a JSON object'], warnings: [] };
  }

  const manifest = json as Record<string, any>;

  // Required top-level fields
  if (!manifest.spec_version) errors.push('Missing spec_version');
  if (!manifest.package) errors.push('Missing package section');
  if (!manifest.compatibility) errors.push('Missing compatibility section');
  if (!manifest.requirements) errors.push('Missing requirements section');
  if (!manifest.permissions) errors.push('Missing permissions section');
  if (!manifest.assets || !Array.isArray(manifest.assets)) errors.push('Missing or invalid assets array');
  if (!manifest.integrity) errors.push('Missing integrity section');

  // Package fields
  if (manifest.package) {
    if (!manifest.package.id) errors.push('Missing package.id');
    if (!manifest.package.kind || !VALID_KINDS.includes(manifest.package.kind)) {
      errors.push(`Invalid package.kind: ${manifest.package.kind}`);
    }
    if (!manifest.package.version) errors.push('Missing package.version');
    if (!manifest.package.title) errors.push('Missing package.title');
    if (!manifest.package.license) errors.push('Missing package.license');
  }

  // Compatibility
  if (manifest.compatibility) {
    if (!manifest.compatibility.runtime_range) errors.push('Missing compatibility.runtime_range');
    if (!manifest.compatibility.schema_version) errors.push('Missing compatibility.schema_version');
    if (!Array.isArray(manifest.compatibility.supported_environments)) {
      errors.push('Missing compatibility.supported_environments');
    } else {
      for (const env of manifest.compatibility.supported_environments) {
        if (!VALID_ENVIRONMENTS.includes(env)) {
          errors.push(`Invalid environment: ${env}`);
        }
      }
    }
  }

  // Permissions
  if (manifest.permissions) {
    if (!manifest.permissions.risk_class || !VALID_RISK_CLASSES.includes(manifest.permissions.risk_class)) {
      errors.push(`Invalid permissions.risk_class: ${manifest.permissions.risk_class}`);
    }
    if (typeof manifest.permissions.declares_secrets !== 'boolean') {
      errors.push('permissions.declares_secrets must be boolean');
    }
  }

  // Integrity
  if (manifest.integrity) {
    if (!manifest.integrity.package_sha256) errors.push('Missing integrity.package_sha256');
  }

  // Warnings
  if (!manifest.previews?.readme_path) warnings.push('No readme_path in previews');
  if (!manifest.package?.summary) warnings.push('No package.summary — recommended for marketplace display');

  return { valid: errors.length === 0, errors, warnings };
}
```

- [ ] **Step 2: Create moderation service**

```typescript
// apps/platform/src/services/moderation.ts
import { eq, and } from 'drizzle-orm';
import {
  publishDrafts,
  moderationJobs,
  listings,
  packageVersions,
  listingTags,
} from '@aics/db-platform';
import type { PlatformDb } from '../db.js';

/**
 * 1.0 auto-moderation: validates manifest and auto-approves if valid.
 * Future: queue for human review, AI-assisted checks.
 */
export async function processModerationJob(db: PlatformDb, jobId: string): Promise<void> {
  const [job] = await db
    .select()
    .from(moderationJobs)
    .where(eq(moderationJobs.job_id, jobId))
    .limit(1);

  if (!job || job.status !== 'pending') return;

  const [draft] = await db
    .select()
    .from(publishDrafts)
    .where(eq(publishDrafts.draft_id, job.target_id))
    .limit(1);

  if (!draft) {
    await db
      .update(moderationJobs)
      .set({ status: 'completed', result: { outcome: 'rejected', reason: 'Draft not found' }, completed_at: new Date() })
      .where(eq(moderationJobs.job_id, jobId));
    return;
  }

  // For 1.0: auto-approve if draft validation_state is 'valid'
  if (draft.validation_state !== 'valid') {
    await db
      .update(moderationJobs)
      .set({ status: 'completed', result: { outcome: 'rejected', reason: 'Manifest not valid' }, completed_at: new Date() })
      .where(eq(moderationJobs.job_id, jobId));

    await db
      .update(publishDrafts)
      .set({ status: 'rejected', updated_at: new Date() })
      .where(eq(publishDrafts.draft_id, draft.draft_id));
    return;
  }

  const manifest = draft.manifest_json as Record<string, any>;

  // Create or update listing
  let listingId = draft.listing_id;
  if (!listingId) {
    // New listing
    const slug = generateSlug(draft.title);
    const [newListing] = await db
      .insert(listings)
      .values({
        creator_id: draft.creator_id,
        slug,
        kind: draft.kind,
        title: draft.title,
        summary: draft.summary,
        description: manifest?.package?.summary ?? draft.summary,
        status: 'listed',
      })
      .returning();
    listingId = newListing.listing_id;
  } else {
    // Update existing listing
    await db
      .update(listings)
      .set({
        title: draft.title,
        summary: draft.summary,
        updated_at: new Date(),
      })
      .where(eq(listings.listing_id, listingId));
  }

  // Create package version
  await db.insert(packageVersions).values({
    listing_id: listingId,
    package_id: manifest.package.id,
    version: manifest.package.version,
    manifest_json: manifest,
    runtime_range: manifest.compatibility.runtime_range,
    schema_version: manifest.compatibility.schema_version,
    environments: manifest.compatibility.supported_environments,
    risk_class: manifest.permissions.risk_class,
    artifact_url: draft.artifact_id ?? undefined,
    changelog: manifest.package.summary,
    status: 'active',
  });

  // Update tags
  if (manifest.package.tags && Array.isArray(manifest.package.tags)) {
    for (const tag of manifest.package.tags) {
      await db.insert(listingTags).values({ listing_id: listingId, tag }).onConflictDoNothing();
    }
  }

  // Mark draft as approved, job as completed
  await db
    .update(publishDrafts)
    .set({ status: 'submitted', listing_id: listingId, updated_at: new Date() })
    .where(eq(publishDrafts.draft_id, draft.draft_id));

  await db
    .update(moderationJobs)
    .set({ status: 'completed', result: { outcome: 'approved', listing_id: listingId }, completed_at: new Date() })
    .where(eq(moderationJobs.job_id, jobId));
}

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    + '-' + Date.now().toString(36);
}
```

- [ ] **Step 3: Create publish routes**

```typescript
// apps/platform/src/routes/publish.ts
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, and } from 'drizzle-orm';
import { publishDrafts, creators, moderationJobs } from '@aics/db-platform';
import { requireAuth } from '../middleware/auth.js';
import { validateManifest } from '../services/validation.js';
import { processModerationJob } from '../services/moderation.js';
import type { PlatformEnv } from '../types.js';

const publish = new Hono<PlatformEnv>();

// All publish routes require auth
publish.use('/*', requireAuth);

// POST /v1/publish/drafts — create a new draft
publish.post('/drafts', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    kind: string;
    listing_id?: string;
    title: string;
    summary?: string;
  }>();

  if (!body.kind || !body.title) {
    throw new HTTPException(400, { message: 'kind and title are required' });
  }

  // Get creator for this user
  const [creator] = await db
    .select()
    .from(creators)
    .where(eq(creators.user_id, userId))
    .limit(1);

  if (!creator) {
    throw new HTTPException(403, { message: 'User is not a registered creator. Create a creator profile first.' });
  }

  const [draft] = await db
    .insert(publishDrafts)
    .values({
      creator_id: creator.creator_id,
      listing_id: body.listing_id ?? null,
      kind: body.kind,
      title: body.title,
      summary: body.summary ?? null,
      status: 'draft',
      validation_state: 'unknown',
    })
    .returning();

  return c.json(
    {
      draft_id: draft.draft_id,
      creator_id: draft.creator_id,
      listing_id: draft.listing_id,
      status: draft.status,
      validation_state: draft.validation_state,
      created_at: draft.created_at.toISOString(),
      updated_at: draft.updated_at.toISOString(),
    },
    201,
  );
});

// PUT /v1/publish/drafts/:draftId/manifest — attach manifest to draft
publish.put('/drafts/:draftId/manifest', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId')!;
  const draftId = c.req.param('draftId');
  const body = await c.req.json<{
    manifest_json: Record<string, unknown>;
    artifact?: {
      external_url?: string;
      sha256?: string;
      size_bytes?: number;
    };
  }>();

  // Verify draft exists and belongs to this user's creator
  const [creator] = await db.select().from(creators).where(eq(creators.user_id, userId)).limit(1);
  if (!creator) throw new HTTPException(403, { message: 'Not a creator' });

  const [draft] = await db
    .select()
    .from(publishDrafts)
    .where(and(eq(publishDrafts.draft_id, draftId), eq(publishDrafts.creator_id, creator.creator_id)))
    .limit(1);

  if (!draft) throw new HTTPException(404, { message: 'Draft not found' });
  if (draft.status === 'submitted') throw new HTTPException(400, { message: 'Draft already submitted' });

  // Validate manifest
  const validation = validateManifest(body.manifest_json);

  const [updated] = await db
    .update(publishDrafts)
    .set({
      manifest_json: body.manifest_json,
      artifact_id: body.artifact?.external_url ?? null,
      validation_state: validation.valid ? 'valid' : 'invalid',
      validation_report: { errors: validation.errors, warnings: validation.warnings },
      status: 'draft',
      updated_at: new Date(),
    })
    .where(eq(publishDrafts.draft_id, draftId))
    .returning();

  if (!validation.valid) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Manifest validation failed',
          details: { errors: validation.errors, warnings: validation.warnings },
        },
      },
      400,
    );
  }

  return c.json({
    draft_id: updated.draft_id,
    creator_id: updated.creator_id,
    listing_id: updated.listing_id,
    validation_state: updated.validation_state,
    validation_report: updated.validation_report,
    status: updated.status,
    created_at: updated.created_at.toISOString(),
    updated_at: updated.updated_at.toISOString(),
  });
});

// POST /v1/publish/submit — submit draft for review
publish.post('/submit', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId')!;
  const body = await c.req.json<{ draft_id: string; submit_message?: string }>();

  if (!body.draft_id) throw new HTTPException(400, { message: 'draft_id is required' });

  const [creator] = await db.select().from(creators).where(eq(creators.user_id, userId)).limit(1);
  if (!creator) throw new HTTPException(403, { message: 'Not a creator' });

  const [draft] = await db
    .select()
    .from(publishDrafts)
    .where(and(eq(publishDrafts.draft_id, body.draft_id), eq(publishDrafts.creator_id, creator.creator_id)))
    .limit(1);

  if (!draft) throw new HTTPException(404, { message: 'Draft not found' });
  if (draft.status === 'submitted') throw new HTTPException(400, { message: 'Draft already submitted' });
  if (draft.validation_state !== 'valid') {
    throw new HTTPException(400, { message: 'Draft manifest must be valid before submission' });
  }

  // Update draft status
  await db
    .update(publishDrafts)
    .set({ status: 'submitted', updated_at: new Date() })
    .where(eq(publishDrafts.draft_id, draft.draft_id));

  // Create moderation job
  const [job] = await db
    .insert(moderationJobs)
    .values({
      target_type: 'publish_draft',
      target_id: draft.draft_id,
      job_kind: 'publish_review',
      status: 'pending',
    })
    .returning();

  // 1.0: auto-process moderation (synchronous for simplicity)
  await processModerationJob(db, job.job_id);

  // Re-fetch job for response
  const [updatedJob] = await db
    .select()
    .from(moderationJobs)
    .where(eq(moderationJobs.job_id, job.job_id))
    .limit(1);

  return c.json(
    {
      draft_id: draft.draft_id,
      moderation_job_id: job.job_id,
      status: updatedJob?.status === 'completed' ? 'queued' : 'pending_review',
    },
    202,
  );
});

export { publish };
```

- [ ] **Step 4: Mount publish routes in index.ts**

Add to `apps/platform/src/index.ts`:
```typescript
import { publish } from './routes/publish.js';
app.route('/v1/publish', publish);
```

- [ ] **Step 5: Verify typecheck**

Run: `cd apps/platform && pnpm typecheck`

### Task D.2: Publish Validation Tests

**Files:**
- Create: `apps/platform/src/__tests__/publish.test.ts`

- [ ] **Step 1: Write validation tests**

```typescript
// apps/platform/src/__tests__/publish.test.ts
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../services/validation.js';

describe('validateManifest', () => {
  const validManifest = {
    spec_version: '1.0',
    package: {
      id: 'test-employee-v1',
      kind: 'employee',
      version: '1.0.0',
      title: 'Test Employee',
      summary: 'A test employee',
      license: 'MIT',
    },
    compatibility: {
      runtime_range: '>=1.0.0',
      schema_version: '1.0',
      supported_environments: ['desktop'],
    },
    requirements: {
      required_capabilities: [],
      required_mcps: [],
    },
    permissions: {
      risk_class: 'data_asset',
      declares_secrets: false,
      filesystem_scope: 'none',
      network_scope: 'none',
    },
    assets: [{ asset_id: 'emp-1', kind: 'employee', path: './employee.json' }],
    integrity: {
      package_sha256: 'abc123def456',
    },
    previews: {
      readme_path: './README.md',
    },
  };

  it('accepts a valid manifest', () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing package section', () => {
    const { package: _, ...noPackage } = validManifest;
    const result = validateManifest(noPackage);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing package section');
  });

  it('rejects invalid kind', () => {
    const manifest = { ...validManifest, package: { ...validManifest.package, kind: 'invalid' } };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid package.kind'))).toBe(true);
  });

  it('rejects missing integrity hash', () => {
    const manifest = { ...validManifest, integrity: {} };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing integrity.package_sha256');
  });

  it('warns about missing readme', () => {
    const manifest = { ...validManifest, previews: {} };
    const result = validateManifest(manifest);
    expect(result.warnings).toContain('No readme_path in previews');
  });

  it('rejects non-object input', () => {
    const result = validateManifest('not an object');
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Add test script to platform package.json**

Add to `apps/platform/package.json` scripts:
```json
"test": "vitest run"
```

- [ ] **Step 3: Run tests**

Run: `cd apps/platform && pnpm test`

### Chunk D Validation

Run:
```bash
cd apps/platform && pnpm typecheck && pnpm test && pnpm build
```

---

## Chunk E: Link Install Protocol

> **Depends on:** Chunk A (registry-client), Chunk C (market pages)
> **Parallel with:** Chunk D (publishing)
> **Estimated effort:** small

### Task E.1: Install Modal Component

**Files:**
- Create: `apps/market/src/components/InstallModal.tsx`

This was already implemented inline in Task C.6 (InstallButton component). The InstallButton handles:
1. Deep link attempt via `aics://install?...`
2. Fallback UI after timeout
3. Copy-link option

- [ ] **Step 1: Verify InstallButton works in isolation**

The InstallButton component from Task C.6 already handles the full Link Install protocol for the marketplace side. No additional modal needed for 1.0.

### Task E.2: Desktop Deep Link Handler (Tauri)

**Files:**
- Modify: `apps/desktop/src-tauri/src/lib.rs` (or dedicated module)

- [ ] **Step 1: Register aics:// protocol in Tauri config**

Add to `apps/desktop/src-tauri/tauri.conf.json`:
```json
{
  "plugins": {
    "deep-link": {
      "mobile": [],
      "desktop": {
        "schemes": ["aics"]
      }
    }
  }
}
```

- [ ] **Step 2: Add deep-link plugin dependency**

Add to `apps/desktop/src-tauri/Cargo.toml`:
```toml
tauri-plugin-deep-link = "2"
```

- [ ] **Step 3: Handle deep link in Rust**

```rust
// In apps/desktop/src-tauri/src/lib.rs — add to the builder chain:
// .plugin(tauri_plugin_deep_link::init())
// .setup(|app| {
//     #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
//     {
//         use tauri_plugin_deep_link::DeepLinkExt;
//         app.deep_link().register_all()?;
//     }
//     app.deep_link().on_open_url(|event| {
//         // event.urls() contains the deep link URLs
//         // Parse aics://install?listing_id=X&version=Y
//         // Emit to webview via app.emit("deep-link-install", payload)
//     });
//     Ok(())
// })
```

Note: The exact Rust implementation depends on the current state of `lib.rs`. The key contract is:
- Parse `aics://install?listing_id=X&version=Y` from the deep link URL
- Emit a Tauri event `deep-link-install` with `{ listing_id, version }` payload to the webview
- The webview (apps/web) listens for this event and triggers the install review flow

- [ ] **Step 4: Handle deep link event in webview**

Add listener in `apps/web` (location TBD based on existing app structure):
```typescript
// Conceptual — wire into existing Tauri event system
import { listen } from '@tauri-apps/api/event';

listen<{ listing_id: string; version: string }>('deep-link-install', async (event) => {
  const { listing_id, version } = event.payload;
  // Trigger install review flow using install-core
  // This connects to the existing install pipeline
});
```

### Chunk E Validation

Run:
```bash
cd apps/desktop/src-tauri && cargo check
cd apps/market && pnpm typecheck && pnpm build
```

---

## Cross-Chunk Validation

After all chunks are complete, run the full validation:

```bash
# Registry client
cd packages/registry-client && pnpm typecheck && pnpm test && pnpm build

# Platform API
cd apps/platform && pnpm typecheck && pnpm test && pnpm build

# Market website
cd apps/market && pnpm typecheck && pnpm build

# Desktop (if deep link changes were made)
cd apps/desktop/src-tauri && cargo check

# Verify no cross-package regressions
pnpm -r typecheck
pnpm -r build
```

---

## Dependency Graph

```
Chunk A ──→ Chunk B ──→ Chunk D
  │
  └──────→ Chunk C ──→ Chunk E
```

- A is the foundation, must be done first
- B and C can run in parallel after A
- D depends on B (API endpoints exist)
- E depends on A and C (registry-client + market pages exist)

## Risk Notes

1. **PostgreSQL dependency**: Platform API needs a running PostgreSQL. For development, use Docker Compose or a local Postgres instance. A `docker-compose.yml` for local dev should be added.

2. **Auth is minimal**: 1.0 uses dev JWTs. Real auth (OAuth, etc.) is deferred. This means publish/review endpoints work in dev but are not production-secure.

3. **No artifact hosting**: 1.0 uses `external_url` for artifact distribution. Creators must host their own packages (GitHub releases, etc.). Registry-hosted storage is deferred.

4. **Search is ILIKE-based**: Adequate for initial catalog size (<1000 listings). Full-text search upgrade path is straightforward (PostgreSQL tsvector + GIN).

5. **Auto-moderation**: 1.0 auto-approves valid manifests. No human moderation queue. This is acceptable for a trusted early creator community but needs a moderation dashboard before public launch.
