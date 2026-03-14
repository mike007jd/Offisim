# Plan A: Platform Security Hardening

> **For agentic workers:** Use superpowers:executing-plans to implement. Steps use checkbox syntax for tracking.
> **File ownership:** This plan ONLY touches `apps/platform/src/`. No other app or package.

**Goal:** Fix all P0/P1 security and data integrity issues in the platform API.

**Tech Stack:** Hono, Drizzle ORM, PostgreSQL, Zod, TypeScript

---

## Task 1: JWT Validation Fix

**Files:**
- Modify: `apps/platform/src/middleware/auth.ts` (57 lines)
- Modify: `apps/platform/package.json` (add `jose` dependency)

**Spec:**
Current state: `atob()` base64 decode without signature verification (line 37). Non-dev mode skips parsing entirely instead of rejecting.

Fix requirements:
- Install `jose` library for JWKS-based JWT verification
- In dev mode (`AICS_AUTH_MODE=dev`): keep current atob() decode behavior with a loud console.warn
- In non-dev mode: verify JWT signature using `jose.jwtVerify()` with configurable JWKS endpoint or shared secret
- Add `exp` claim validation (reject expired tokens)
- Return 401 immediately if verification fails (don't silently skip)
- Add `AICS_JWT_SECRET` env var for HMAC signing in staging environments

- [ ] Step 1: Install `jose` as dependency in apps/platform
- [ ] Step 2: Rewrite `optionalAuth` middleware with dual-mode validation
- [ ] Step 3: Add token expiry check
- [ ] Step 4: Update `requireAuth` to return proper 401 JSON response
- [ ] Step 5: Add tests for auth middleware (valid token, expired, invalid sig, missing, dev-mode)
- [ ] Step 6: Commit

---

## Task 2: CORS Whitelist + Environment Guard

**Files:**
- Modify: `apps/platform/src/index.ts` (55 lines, lines 21-23)

**Spec:**
Current: `corsOrigins` defaults to `['*']` when `CORS_ORIGINS` env is empty.

Fix:
- If `NODE_ENV === 'production'` and `CORS_ORIGINS` is empty, throw startup error (refuse to start with wildcard CORS in production)
- In development: allow `['http://localhost:3000', 'http://localhost:5173', 'http://localhost:1420']` as default
- Parse `CORS_ORIGINS` as comma-separated whitelist
- Add `credentials: true` to CORS config
- Log active CORS origins on startup

- [ ] Step 1: Add environment-aware CORS defaults with production guard
- [ ] Step 2: Add startup validation log
- [ ] Step 3: Commit

---

## Task 3: Rate Limiting Middleware

**Files:**
- Create: `apps/platform/src/middleware/rate-limit.ts`
- Modify: `apps/platform/src/index.ts` (add middleware)
- Modify: `apps/platform/src/routes/auth.ts` (apply to login)
- Modify: `apps/platform/src/routes/publish.ts` (apply to publish endpoints)
- Modify: `apps/platform/src/routes/install.ts` (apply to receipt endpoint)

**Spec:**
Simple in-memory rate limiter (no Redis needed for 1.0):
- Token bucket algorithm per IP
- Default: 100 req/min for general API
- Strict: 10 req/min for auth endpoints, 20 req/min for publish endpoints
- Return 429 with `Retry-After` header
- Use `Map<string, { tokens: number, lastRefill: number }>` with periodic cleanup (every 5 min)

- [ ] Step 1: Create rate-limit middleware with configurable limits
- [ ] Step 2: Apply strict limits to auth routes
- [ ] Step 3: Apply strict limits to publish routes
- [ ] Step 4: Apply standard limits to install receipt
- [ ] Step 5: Tests for rate limiting (under limit, at limit, over limit, reset)
- [ ] Step 6: Commit

---

## Task 4: Install Count Atomicity Fix

**Files:**
- Modify: `apps/platform/src/routes/install.ts` (lines 38-55)

**Spec:**
Current: Two separate DB operations (insert receipt + update listing count) without transaction. Concurrent requests can cause count drift.

Fix:
- Wrap receipt insert + count update in a Drizzle transaction (`db.transaction()`)
- Use `ON CONFLICT (user_id, listing_id, package_version_id) DO NOTHING` and check `rowCount` to avoid double-counting
- Only increment `install_count` if the receipt was actually inserted (not a duplicate)
- Return `{ status: 'recorded' | 'already_exists' }` to the client

- [ ] Step 1: Refactor to use db.transaction()
- [ ] Step 2: Add conflict check on receipt insert
- [ ] Step 3: Conditional count increment
- [ ] Step 4: Tests for idempotency (double submit same receipt)
- [ ] Step 5: Commit

---

## Task 5: Search Pagination Bounds + Schema Hardening

**Files:**
- Modify: `apps/platform/src/routes/market.ts` (lines 20-28)
- Modify: `apps/platform/src/schemas/index.ts` (remove `.passthrough()`)

**Spec:**

Pagination:
- Clamp `page` to [1, 10000], default 1
- Clamp `per_page` to [1, 100], default 20
- Use Zod `.coerce.number().int().min(1).max(N).default(D)` for both
- Add `SearchParamsSchema` to schemas/index.ts

Schema hardening:
- Remove `.passthrough()` from `ManifestSchema` (lines 120, 128, 141) — use `.strict()` or explicit `.omit()/.pick()`
- Add UUID format validation to `listing_id` and `package_version_id` in `InstallReceiptSchema`

- [ ] Step 1: Create SearchParamsSchema with bounded pagination
- [ ] Step 2: Apply to search endpoint
- [ ] Step 3: Remove .passthrough() from ManifestSchema, replace with explicit fields
- [ ] Step 4: Add UUID validation to InstallReceiptSchema
- [ ] Step 5: Tests for edge cases (page=0, per_page=999, negative values)
- [ ] Step 6: Commit

---

## Verification

- [ ] All existing platform tests still pass
- [ ] New tests cover: auth validation, rate limiting, pagination bounds, receipt idempotency
- [ ] `pnpm run typecheck` passes for apps/platform
- [ ] `pnpm run build` passes for apps/platform
- [ ] Manual smoke test: start platform, hit /v1/market/search with edge-case params
