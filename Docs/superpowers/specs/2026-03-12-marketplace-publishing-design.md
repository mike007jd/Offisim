# Marketplace & Publishing Design Spec

> **Version:** 1.0-draft
> **Date:** 2026-03-12
> **Status:** Design spec — not yet implemented
> **Scope:** apps/market, apps/platform, packages/registry-client, packages/ui-market

---

## 1. Problem Statement

AICS has a complete local runtime (orchestration kernel, office scene, install pipeline, desktop shell) but no functioning marketplace or publishing workflow. The four missing pieces for 1.0:

1. **Marketplace Website** (apps/market) — currently just a placeholder `<h1>`
2. **Platform API** (apps/platform) — currently just a `/health` endpoint
3. **Publishing Workflow** — no publish draft editor, no moderation, no submit flow
4. **Registry Client** (packages/registry-client) — currently an empty stub

Without these, users cannot discover assets, creators cannot publish, and the install pipeline has no registry to resolve packages from.

## 2. Guiding Principles

From PROJECT_CONSTITUTION and PRD:

1. **Listing != Package != Installed Instance** — three distinct lifecycle objects, never collapsed
2. **Marketplace is a registry + trust surface**, not an execution plane
3. **Packages are declarative** — no install hooks, no secrets, no shell execution
4. **Public reads are unauthenticated** — browsing, search, detail pages require no login
5. **Desktop is the 1.0 reference environment** for install flows
6. **Model choice belongs to the user** — marketplace displays recommendations, never enforces
7. **Trust-oriented visual language** — clean, readable, HTML-first (per DESIGN_RULES)

## 3. System Architecture

```
┌──────────────────────────────────────────────────────────┐
│  apps/market (Next.js SSR)                                │
│  ├── Catalog / Search page                                │
│  ├── Listing detail page                                  │
│  ├── Creator profile page                                 │
│  └── Static pages (about, guidelines)                     │
│       │                                                   │
│       │ uses @aics/registry-client (fetch)                │
│       ▼                                                   │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  apps/platform (Hono API)                           │  │
│  │  ├── GET /v1/market/search                          │  │
│  │  ├── GET /v1/market/listings/:id                    │  │
│  │  ├── GET /v1/market/listings/:id/versions           │  │
│  │  ├── GET /v1/market/listings/:id/reviews            │  │
│  │  ├── GET /v1/market/creators/:handle                │  │
│  │  ├── POST /v1/publish/drafts                        │  │
│  │  ├── PUT  /v1/publish/drafts/:id/manifest           │  │
│  │  ├── POST /v1/publish/submit                        │  │
│  │  ├── POST /v1/reviews                               │  │
│  │  └── GET  /v1/me/library                            │  │
│  │       │                                             │  │
│  │       │ drizzle-orm                                 │  │
│  │       ▼                                             │  │
│  │  @aics/db-platform (PostgreSQL)                     │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  apps/web + apps/desktop (local runtime)                  │
│  ├── uses @aics/registry-client to resolve packages       │
│  ├── uses @aics/install-core to install                   │
│  └── Link Install: aics:// deep link → resolve → install  │
└──────────────────────────────────────────────────────────┘
```

### 3.1 Data Flow

**Public read path (unauthenticated):**
```
Browser → apps/market (SSR) → registry-client.searchListings() → platform API → db-platform → response
```

**Link Install path:**
```
Market detail page → "Install" button → aics://install?listing_id=X&version=Y
  → Desktop: deep link → Tauri handler → install-core resolve → review → confirm → install
  → Web: fallback to URL import or show "open in desktop" prompt
```

**Publish path (authenticated):**
```
apps/web (creator dashboard) → registry-client.createDraft() → platform API → db-platform
  → creator edits manifest → putDraftManifest()
  → creator submits → submitPublishDraft() → moderation job created
  → moderator approves → listing goes live
```

## 4. Platform API Design

### 4.1 Route Structure

The platform API follows the OpenAPI spec at `Docs/02_contracts_and_schemas/aics_openapi.yaml`. All endpoints live under Hono route groups:

| Group | Prefix | Auth | Purpose |
|-------|--------|------|---------|
| Market Public | `/v1/market/` | None | Search, listing detail, versions, reviews, creator profiles |
| Creator Publish | `/v1/publish/` | Bearer/Session | Draft CRUD, manifest upload, submit for review |
| User Library | `/v1/me/` | Bearer/Session | Personal library, install receipts |
| Reviews | `/v1/reviews` | Bearer/Session | Create/update reviews |

### 4.2 Middleware Stack

```
Hono app
  ├── CORS middleware (configurable origins)
  ├── Request ID middleware (X-Request-Id header)
  ├── Error handler middleware (uniform ErrorResponse shape)
  ├── Auth middleware (optional, extracts user from Bearer JWT / session cookie)
  │   └── requireAuth() guard for protected routes
  ├── Rate limiter (per-IP for public, per-user for authenticated)
  └── Route groups
```

### 4.3 Database Access Pattern

- Use `drizzle-orm` with `drizzle-orm/pg-core` (already in db-platform)
- Platform API creates a single `drizzle()` instance at startup
- Pass db instance to route handlers via Hono context (`c.var.db`)
- No repository abstraction layer for 1.0 — direct Drizzle queries in route handlers
  - Rationale: platform API is a thin CRUD layer; adding repositories would be premature abstraction
  - Service functions for complex operations (publish submit, moderation)

### 4.4 Auth Strategy (1.0 Minimal)

For 1.0, auth is deliberately minimal:
- **JWT Bearer tokens** issued by an external auth provider (placeholder: self-signed JWTs for dev)
- **Session cookies** as alternative for browser-based flows
- Auth middleware extracts `{ user_id, email }` from token
- Creator identity linked via `users` → `creators` table join
- No OAuth provider integration in 1.0 scope — that's a platform-operations concern
- Dev mode: seed users and creators, use dev JWT for testing

### 4.5 Search Implementation

1.0 search is PostgreSQL `ILIKE` + tag filtering (not full-text search):
- Query matches against `listings.title`, `listings.summary`, `creators.display_name`
- Filter by `kind`, `risk_class`, `tag`
- Sort: `newest` (created_at DESC), `updated` (updated_at DESC), `rating` (rating_avg DESC), `installs` (install_count DESC), `relevance` (default = rating_avg * ln(install_count + 1) DESC)
- Pagination: offset-based with `page` and `per_page`

Future: PostgreSQL full-text search with `tsvector` / `GIN` index when data volume justifies it.

## 5. Marketplace Website Design

### 5.1 Page Structure

| Route | Page | Data Source | SSR Strategy |
|-------|------|-------------|-------------|
| `/` | Home / Featured catalog | `searchListings(sort=installs)` | SSR with revalidation |
| `/search` | Search results + filters | `searchListings(q, kind, tag, sort)` | SSR with searchParams |
| `/listing/[slug]` | Listing detail | `getListingDetail(id)` + `listVersions` + `listReviews` | SSR |
| `/creator/[handle]` | Creator profile | `getCreatorProfile(handle)` + their listings | SSR |
| `/about` | About / guidelines | Static | Static |

### 5.2 Visual Language

Per DESIGN_RULES "Marketplace visual rules":

- **Trust surface first** — asset title, creator, risk class, compatibility, installability must be scannable
- **Sober, comparable cards** — not marketing hero art
- **Creator identity and provenance visually clear**
- **Documentation-like readability** over visual novelty
- **HTML-first, text-readable** for SEO

Concrete tokens:
- Content width: 1200px max (standard surface)
- Card gap: 16-24px
- Typography: system-ui stack, semantic heading scale
- Colors: semantic roles from design system (no per-page palettes)
- Icons: Lucide, 16-20px for metadata, 24px for actions
- Radius: `md` for cards, `sm` for badges
- Shadow: `card` level only

### 5.3 Card Component Design

**ListingCard** (used in search results and catalog grids):
```
┌─────────────────────────────────┐
│  [Icon] Title               ★ 4.2  │
│  @creator_handle · employee       │
│  Summary text truncated to 2...   │
│  ─────────────────────────────── │
│  v1.2.0 · desktop · data_asset   │
│  128 installs                     │
└─────────────────────────────────┘
```

Key data points always visible:
1. Title + kind icon
2. Creator handle (linked)
3. Summary (2-line clamp)
4. Latest version + environments + risk class
5. Rating + install count

### 5.4 Listing Detail Page

Sections (top to bottom):
1. **Header**: Title, kind badge, creator (linked), rating stars + count
2. **Install bar**: Version selector, environment badges, "Install" button (primary CTA)
3. **Description**: Markdown-rendered long description
4. **Requirements**: Required capabilities, MCPs, recommended models
5. **Permissions**: Risk class banner, filesystem scope, network scope, secret declarations
6. **Lineage**: Fork origin chain (if applicable)
7. **Versions**: Version history table with changelog
8. **Reviews**: Rating distribution + review list
9. **Previews**: Screenshots/images gallery (if available)

### 5.5 Install Button Behavior

The "Install" button on the marketplace is NOT a direct install action. It triggers the **Link Install protocol**:

1. Button generates a URL: `aics://install?listing_id=X&version=Y`
2. On desktop: deep link opens Tauri app → install review flow
3. On web: shows modal with options:
   - "Open in Desktop App" (preferred)
   - "Copy install link"
   - "Download package file" (if artifact_url available)

This maintains the separation: marketplace is discovery surface, runtime is execution surface.

## 6. Registry Client Design

### 6.1 Interface

`@aics/registry-client` provides a typed, fetch-based client for the platform API. It has zero framework dependencies and works in both Next.js SSR and browser contexts.

```typescript
interface RegistryClientConfig {
  baseUrl: string;        // e.g., "https://api.aics.market"
  authToken?: string;     // Bearer token for authenticated endpoints
  fetch?: typeof fetch;   // Injectable fetch for testing
}

interface RegistryClient {
  // Public reads (no auth required)
  searchListings(params: SearchParams): Promise<SearchResponse>;
  getListingDetail(listingId: string): Promise<ListingDetail>;
  getListingBySlug(slug: string): Promise<ListingDetail>;
  listListingVersions(listingId: string): Promise<VersionListResponse>;
  listListingReviews(listingId: string): Promise<ReviewListResponse>;
  getCreatorProfile(handle: string): Promise<CreatorProfile>;

  // Authenticated endpoints
  createPublishDraft(req: CreateDraftRequest): Promise<PublishDraft>;
  putDraftManifest(draftId: string, req: PutDraftManifestRequest): Promise<PublishDraft>;
  submitPublishDraft(req: PublishSubmitRequest): Promise<SubmitResponse>;
  upsertReview(req: CreateReviewRequest): Promise<Review>;
  getMyLibrary(params?: LibraryParams): Promise<LibraryResponse>;
}
```

### 6.2 Type Re-exports

The client re-exports all API types (SearchResponse, ListingDetail, etc.) so consumers don't need to import from multiple packages. Types are derived from the OpenAPI schema shapes defined in the spec.

### 6.3 Error Handling

```typescript
class RegistryApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
}
```

All non-2xx responses throw `RegistryApiError` with structured error info from the API's `ErrorResponse` shape.

## 7. Publishing Workflow Design

### 7.1 Flow Overview

```
Creator opens publish UI → Creates draft → Edits manifest → Validates → Submits
  → Platform creates moderation job → (auto-check or manual review)
  → Approved → Listing goes live (or new version added to existing listing)
  → Rejected → Creator notified with reasons
```

### 7.2 Draft States

```
draft → validated → submitted → [approved → listed] | [rejected → draft]
```

- **draft**: Creator is editing, manifest not yet validated
- **validated**: Manifest passes schema validation + integrity checks
- **submitted**: Sent to moderation queue
- **approved**: Moderation passed, listing created/updated (terminal)
- **rejected**: Moderation failed, creator can revise and resubmit

### 7.3 Validation Requirements

Before a draft can be submitted:
1. Manifest JSON must pass `@aics/asset-schema` validation
2. `spec_version` must match current supported version
3. Package `kind` must be a recognized `AssetKind`
4. `integrity.package_sha256` must be present
5. `compatibility.runtime_range` must be a valid semver range
6. `permissions.risk_class` must be declared
7. No `declares_secrets: true` with actual secret values in manifest
8. Artifact must be reachable (URL validation or registry object exists)

### 7.4 Moderation (1.0 Minimal)

For 1.0, moderation is a lightweight gating mechanism:
- Auto-check: manifest validation + known-bad pattern scan
- Status: `pending` → `approved` | `rejected`
- No human moderator queue UI in 1.0 — admin uses direct DB or API
- Future: moderation dashboard, AI-assisted review, community flagging workflow

### 7.5 Version Updates

Publishing a new version to an existing listing:
1. Creator creates draft with `listing_id` pointing to existing listing
2. Draft manifest has incremented `version`
3. Same validation + submit + moderation flow
4. On approval: new `package_versions` row created, `listings.updated_at` bumped

### 7.6 Delist / Unpublish

- Creator can set listing `status` to `hidden` (still resolvable by ID, not in search)
- Creator can set listing `status` to `retired` (not resolvable, shows "no longer available")
- Platform admin can force-hide or retire listings via moderation

## 8. Link Install Protocol

### 8.1 URI Scheme

```
aics://install?listing_id={uuid}&version={semver}
```

Optional parameters:
- `source=registry` (default) or `source=url&url={encoded_url}`
- `package_id={string}` (alternative to listing_id for direct package reference)

### 8.2 Desktop Flow

1. Tauri registers `aics://` protocol handler
2. On deep link activation: parse parameters
3. Call `registry-client.getListingDetail()` to fetch metadata
4. Show install review UI (from existing install-core flow)
5. User confirms → `install-core` resolves, checks, materializes
6. Success → asset appears in local company

### 8.3 Web Fallback

Web cannot handle `aics://` deep links natively. The marketplace "Install" button:
1. First tries `window.open('aics://...')` with a timeout
2. If desktop app doesn't respond, shows fallback modal
3. Fallback options: copy link, download .aicspkg, or "Get Desktop App" CTA

## 9. Non-Functional Requirements

### 9.1 Performance

- Market SSR pages: TTFB < 500ms (Next.js edge-compatible)
- Search API: p95 < 200ms for simple queries
- Detail page API: p95 < 100ms

### 9.2 SEO

- All public pages SSR-rendered with proper `<title>`, `<meta description>`, Open Graph tags
- Listing pages: structured data (JSON-LD) for rich search results
- Clean URLs: `/listing/{slug}`, `/creator/{handle}`
- Sitemap generation for listings and creators

### 9.3 Security

- Public endpoints: rate-limited per IP
- Authenticated endpoints: rate-limited per user
- Input validation on all API parameters (Zod schemas)
- SQL injection prevention via Drizzle parameterized queries
- XSS prevention: no raw HTML rendering of user content
- CSRF: SameSite cookies for session auth

### 9.4 Accessibility

- Semantic HTML throughout marketplace pages
- Keyboard navigable cards and controls
- Sufficient contrast ratios
- Focus-visible states on all interactive elements
- Screen reader friendly card structure

## 10. Out of Scope for 1.0

- OAuth provider integration (GitHub, Google login)
- Payment / transaction / monetization flows
- AI-assisted moderation queue
- Full-text search (PostgreSQL tsvector)
- Image/artifact upload to registry object storage
- Creator analytics dashboard
- Notification system (email, in-app)
- Bundle dependency resolution in install
- Community flagging workflow UI

## 11. Open Questions

1. **Auth provider for 1.0**: Do we use a self-hosted auth service or integrate with an external provider? Current plan: dev-mode JWT for initial implementation, defer real auth to a separate chunk.

2. **Artifact storage**: 1.0 uses `external_url` for artifact distribution (GitHub releases, npm). Do we need registry-hosted object storage for 1.0? Current plan: no, defer to post-1.0.

3. **Search relevance**: The `relevance` sort uses a simple formula. Should we invest in PostgreSQL full-text search for 1.0? Current plan: no, ILIKE is sufficient for initial catalog size.

4. **Creator onboarding**: How does a user become a creator? Current plan: any authenticated user can create a creator profile via API. No approval gate for 1.0.
