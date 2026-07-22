import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_API_TOKEN_EXPIRY_DAYS,
  decideEmailAdoption,
  normalizeApiTokenScopes,
  optionalAuth,
  parseApiTokenExpiryDays,
  parseApiTokenScopes,
  requireApiTokenScope,
  requireSessionAuth,
} from '../apps/platform/src/middleware/auth.js';
import { _resetRateLimitStore, rateLimit } from '../apps/platform/src/middleware/rate-limit.js';

type FakeResponse = { status: number; body: unknown };

function makeContext(input: {
  authKind?: string;
  scopes?: readonly string[];
  userId?: string;
  headers?: Record<string, string>;
}) {
  const values = new Map<string, unknown>();
  const responseHeaders = new Map<string, string>();
  const headers = new Map(
    Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
  if (input.authKind) values.set('authKind', input.authKind);
  if (input.scopes) values.set('apiTokenScopes', [...input.scopes]);
  if (input.userId) values.set('userId', input.userId);
  return {
    req: {
      header: (name: string) => headers.get(name.toLowerCase()),
    },
    get: (key: string) => values.get(key),
    set: (key: string, value: unknown) => values.set(key, value),
    header: (key: string, value: string) => responseHeaders.set(key, value),
    json: (body: unknown, status: number): FakeResponse => ({ body, status }),
  };
}

async function runMiddleware(
  middleware: (c: never, next: () => Promise<void>) => Promise<unknown>,
  context: ReturnType<typeof makeContext>,
) {
  let nextCalled = false;
  const response = await middleware(context as never, async () => {
    nextCalled = true;
  });
  return { nextCalled, response: response as FakeResponse | undefined };
}

// --- PL1: API-token 401 / 503 / anonymous matrix ---

type ApiTokenDbStep = { rows: unknown[] } | { throw: true };

// Minimal drizzle-shaped mock: select/from/where chains resolve at `.limit()`,
// consuming one planned step each; update/set/where supports the fire-and-forget
// last_used_at write. Only `optionalAuth`'s api-token branch touches this.
function makeApiTokenMockDb(plan: ApiTokenDbStep[]) {
  let i = 0;
  const builder: Record<string, unknown> = {};
  Object.assign(builder, {
    select: () => builder,
    from: () => builder,
    where: () => builder,
    update: () => builder,
    set: () => builder,
    limit: () => {
      const step = plan[i++];
      if (!step) return Promise.resolve([]);
      if ('throw' in step) return Promise.reject(new Error('platform db unavailable'));
      return Promise.resolve(step.rows);
    },
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable mock to exercise the bare-await write path
    then: (onF: (value: unknown) => unknown) => {
      onF?.(undefined);
      return builder;
    },
    catch: () => builder,
  });
  return builder;
}

function makeApiTokenContext(plan: ApiTokenDbStep[]) {
  const ctx = makeContext({ headers: { authorization: 'Bearer offisim_test-token' } });
  ctx.set('db', makeApiTokenMockDb(plan));
  return ctx;
}

const FUTURE = new Date(Date.now() + 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);
const VALID_TOKEN_ROW = {
  token_id: 't1',
  token_hash: 'hash',
  user_id: 'ba-1',
  scopes: ['publish:write'],
  expires_at: FUTURE,
};
const LINKED_USER_ROW = { user_id: 'u1', email: 'creator@example.test', ba_user_id: 'ba-1' };

async function expectApiTokenValidAuthenticates() {
  const ctx = makeApiTokenContext([{ rows: [VALID_TOKEN_ROW] }, { rows: [LINKED_USER_ROW] }]);
  const { nextCalled, response } = await runMiddleware(optionalAuth as never, ctx);
  if (!nextCalled || response) throw new Error('valid API token was not authenticated');
  if (ctx.get('userId') !== 'u1' || ctx.get('authKind') !== 'api-token') {
    throw new Error('valid API token did not populate auth context');
  }
}

async function expectApiTokenInvalidReturns401() {
  const ctx = makeApiTokenContext([{ rows: [] }]);
  const { nextCalled, response } = await runMiddleware(optionalAuth as never, ctx);
  if (nextCalled || response?.status !== 401) {
    throw new Error('present-but-invalid API token did not return 401');
  }
}

async function expectApiTokenExpiredReturns401() {
  const ctx = makeApiTokenContext([{ rows: [{ ...VALID_TOKEN_ROW, expires_at: PAST }] }]);
  const { nextCalled, response } = await runMiddleware(optionalAuth as never, ctx);
  if (nextCalled || response?.status !== 401) {
    throw new Error('expired API token did not return 401');
  }
}

async function expectApiTokenBackendErrorReturns503() {
  const ctx = makeApiTokenContext([{ throw: true }]);
  const { nextCalled, response } = await runMiddleware(optionalAuth as never, ctx);
  if (nextCalled || response?.status !== 503) {
    throw new Error('auth-backend exception did not return 503 (degraded to anonymous?)');
  }
}

// Note: the "absent credential → anonymous" leg of the matrix is the UNCHANGED
// session-null path; it is not re-tested here because exercising it through the
// middleware would invoke the real Better Auth `getSession` singleton (no DB in
// this harness). The api-token cases above all return inside the api-token branch
// before the session path, so they stay deterministic.

// --- PL2: email-adoption requires a verified email ---

function expectEmailAdoptionRequiresVerification() {
  // Unlinked account + unverified email → refuse (the seed-takeover vector).
  if (
    decideEmailAdoption({ ba_user_id: null }, { id: 'ba-x', emailVerified: false }) !== 'refuse'
  ) {
    throw new Error('unverified email was allowed to adopt an unlinked account');
  }
  if (
    decideEmailAdoption({ ba_user_id: null }, { id: 'ba-x', emailVerified: undefined }) !== 'refuse'
  ) {
    throw new Error('missing emailVerified was treated as verified');
  }
  // Unlinked account + verified email → link.
  if (decideEmailAdoption({ ba_user_id: null }, { id: 'ba-x', emailVerified: true }) !== 'link') {
    throw new Error('verified email was not allowed to adopt an unlinked account');
  }
  // Already linked to the SAME ba user → idempotent link.
  if (
    decideEmailAdoption({ ba_user_id: 'ba-x' }, { id: 'ba-x', emailVerified: false }) !== 'link'
  ) {
    throw new Error('idempotent re-link of the same ba user was refused');
  }
  // Linked to a DIFFERENT ba user → never overwrite.
  if (
    decideEmailAdoption({ ba_user_id: 'ba-other' }, { id: 'ba-x', emailVerified: true }) !==
    'refuse'
  ) {
    throw new Error('adoption overwrote an account linked to a different ba user');
  }
}

async function expectScopeDenied() {
  const { nextCalled, response } = await runMiddleware(
    requireApiTokenScope('publish:write') as never,
    makeContext({ authKind: 'api-token', scopes: ['reviews:write'] }),
  );
  if (nextCalled || response?.status !== 403) {
    throw new Error('API token without required scope was not denied');
  }
}

async function expectScopeAllowed() {
  const { nextCalled, response } = await runMiddleware(
    requireApiTokenScope('publish:write') as never,
    makeContext({ authKind: 'api-token', scopes: ['publish:write'] }),
  );
  if (!nextCalled || response) throw new Error('API token with required scope was not allowed');
}

async function expectTokenManagementRejectsApiTokenAuth() {
  const { nextCalled, response } = await runMiddleware(
    requireSessionAuth as never,
    makeContext({ authKind: 'api-token', scopes: ['reviews:write'], userId: 'user-1' }),
  );
  if (nextCalled || response?.status !== 403) {
    throw new Error('API token was allowed to manage API tokens');
  }
}

async function expectTokenManagementAllowsSessionAuth() {
  const { nextCalled, response } = await runMiddleware(
    requireSessionAuth as never,
    makeContext({ authKind: 'session', userId: 'user-1' }),
  );
  if (!nextCalled || response) {
    throw new Error('session auth was not allowed to manage API tokens');
  }
}

async function expectUnknownStoredScopesIgnored() {
  const scopes = normalizeApiTokenScopes([
    'publish:write',
    'admin:*',
    'reviews:write',
    'publish:write',
  ]);
  if (scopes.join(',') !== 'publish:write,reviews:write') {
    throw new Error('stored API token scopes were not normalized to the platform allowlist');
  }
}

function expectTokenCreationScopeValidation() {
  parseApiTokenScopes(['publish:write']);
  try {
    parseApiTokenScopes(['publish:write', 'admin:*']);
  } catch {
    return;
  }
  throw new Error('unsupported API token creation scope was accepted');
}

function expectTokenCreationExpiryValidation() {
  parseApiTokenExpiryDays(MAX_API_TOKEN_EXPIRY_DAYS);
  try {
    parseApiTokenExpiryDays(MAX_API_TOKEN_EXPIRY_DAYS + 1);
  } catch {
    return;
  }
  throw new Error('API token expiry above the maximum was accepted');
}

async function expectForwardedForIgnoredByDefault() {
  _resetRateLimitStore();
  const middleware = rateLimit({ maxTokens: 1, refillRate: 1, label: 'xff-default-harness' });
  const first = await runMiddleware(
    middleware as never,
    makeContext({ headers: { 'x-forwarded-for': '198.51.100.10' } }),
  );
  const second = await runMiddleware(
    middleware as never,
    makeContext({ headers: { 'x-forwarded-for': '198.51.100.11' } }),
  );
  if (!first.nextCalled || first.response) {
    throw new Error('rate limiter did not allow the first forwarded-header request');
  }
  if (second.nextCalled || second.response?.status !== 429) {
    throw new Error('rate limiter trusted spoofed X-Forwarded-For by default');
  }
}

function expectMigrationDriftFailure() {
  const dir = mkdtempSync(join(tmpdir(), 'offisim-platform-drift-'));
  try {
    const invalidBaseline = join(dir, 'schema.sql');
    writeFileSync(invalidBaseline, '-- intentionally stale platform baseline\n');
    try {
      execFileSync('node', ['scripts/check-platform-migration-drift.mjs'], {
        cwd: new URL('..', import.meta.url),
        env: {
          ...process.env,
          OFFISIM_PLATFORM_BASELINE_PATH: invalidBaseline,
        },
        stdio: 'pipe',
      });
    } catch {
      return;
    }
    throw new Error('platform schema drift check accepted a stale baseline');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function expectMarketplaceVisibilityGuards() {
  const root = new URL('..', import.meta.url);
  const marketSource = readFileSync(new URL('apps/platform/src/routes/market.ts', root), 'utf8');
  const installSource = readFileSync(new URL('apps/platform/src/routes/install.ts', root), 'utf8');
  const creatorsSource = readFileSync(
    new URL('apps/platform/src/routes/creators.ts', root),
    'utf8',
  );
  const reviewsSource = readFileSync(new URL('apps/platform/src/routes/reviews.ts', root), 'utf8');
  const marketRequired = [
    "market.post('/listings/:listingId/reports'",
    "market.get('/listings/:listingId/forks'",
    "market.get('/listings/:listingId/lineage'",
  ];
  for (const marker of marketRequired) {
    const start = marketSource.indexOf(marker);
    if (start < 0) throw new Error(`missing marketplace route marker: ${marker}`);
    const routeBody = marketSource.slice(start, marketSource.indexOf('\n});', start));
    if (!routeBody.includes('await requireVisibleListingById(db, listingId);')) {
      throw new Error(`${marker} does not require listed marketplace visibility`);
    }
  }
  if (!installSource.includes('async function getVisiblePackageVersionById')) {
    throw new Error('install routes do not centralize visible package version lookup');
  }
  const downloadStart = installSource.indexOf("installRoute.get('/download/:versionId'");
  const artifactStart = installSource.indexOf("installRoute.get('/artifacts/:versionId'");
  if (downloadStart < 0 || artifactStart < 0) {
    throw new Error('missing install download/artifact route markers');
  }
  const downloadRoute = installSource.slice(
    downloadStart,
    installSource.indexOf('\n});', downloadStart),
  );
  const artifactRoute = installSource.slice(
    artifactStart,
    installSource.indexOf('\n});', artifactStart),
  );
  if (!downloadRoute.includes('await getVisiblePackageVersionById(db, versionId)')) {
    throw new Error('install download route bypasses visible package version lookup');
  }
  if (!artifactRoute.includes('await getVisiblePackageVersionById(db, versionId)')) {
    throw new Error('install artifact route bypasses visible package version lookup');
  }
  const receiptStart = installSource.indexOf("installRoute.post(\n  '/receipts'");
  if (receiptStart < 0) {
    throw new Error('install receipt route is missing');
  }
  const receiptRoute = installSource.slice(
    receiptStart,
    installSource.indexOf("installRoute.get('/download/:versionId'", receiptStart),
  );
  for (const phrase of [
    "eq(packageVersions.status, 'active')",
    "eq(listings.status, 'listed')",
    'const installCountRows = await tx',
    'Listing state changed before receipt recording',
  ]) {
    if (!receiptRoute.includes(phrase)) {
      throw new Error(`install receipt visibility guard missing "${phrase}"`);
    }
  }
  const creatorListingsStart = creatorsSource.indexOf('const creatorListings = await db');
  if (creatorListingsStart < 0) {
    throw new Error('creator route listing query is missing');
  }
  const creatorListingsQuery = creatorsSource.slice(
    creatorListingsStart,
    creatorsSource.indexOf('const listingIds', creatorListingsStart),
  );
  if (
    !creatorListingsQuery.includes("eq(listings.status, 'listed')") ||
    !creatorListingsQuery.includes('eq(listings.creator_id, creator.creator_id)')
  ) {
    throw new Error('creator public route does not filter listings to listed status');
  }
  const reviewsListingStart = reviewsSource.indexOf('const [listing] = await tx');
  if (reviewsListingStart < 0) {
    throw new Error('review route listing guard is missing');
  }
  const reviewsListingQuery = reviewsSource.slice(
    reviewsListingStart,
    reviewsSource.indexOf('if (!listing)', reviewsListingStart),
  );
  if (
    !reviewsListingQuery.includes("eq(listings.status, 'listed')") ||
    !reviewsListingQuery.includes('eq(listings.listing_id, body.listing_id)')
  ) {
    throw new Error('review route allows writes against non-listed marketplace listings');
  }
  const reviewsRouteStart = reviewsSource.indexOf("reviewsRoute.post('/'");
  const reviewsRoute = reviewsSource.slice(reviewsRouteStart);
  for (const phrase of [
    'await db.transaction(async (tx)',
    'eq(reviews.review_id, existing.review_id)',
    'eq(reviews.listing_id, body.listing_id)',
    'eq(reviews.user_id, userId)',
    'const listingRows = await tx',
    'Listing state changed before review write',
  ]) {
    if (!reviewsRoute.includes(phrase)) {
      throw new Error(`review mutation boundary guard missing "${phrase}"`);
    }
  }
  const statusRouteStart = marketSource.indexOf("'/listings/:listingId/status'");
  if (statusRouteStart < 0) {
    throw new Error('market listing status route is missing');
  }
  const statusRoute = marketSource.slice(statusRouteStart);
  for (const phrase of [
    'const updatedRows = await db',
    'eq(listings.listing_id, listingId)',
    'eq(listings.creator_id, creatorId)',
    'eq(listings.status, listing.status)',
    'Listing state changed before status update',
  ]) {
    if (!statusRoute.includes(phrase)) {
      throw new Error(`market listing status mutation guard missing "${phrase}"`);
    }
  }
}

function expectTokenRevokeOwnershipBoundInDelete() {
  const authSource = readFileSync(
    new URL('../apps/platform/src/routes/auth.ts', import.meta.url),
    'utf8',
  );
  for (const route of [
    "authRoute.post('/register-creator', requireAuth, requireSessionAuth",
    "authRoute.post('/tokens', requireAuth, requireSessionAuth",
    "authRoute.get('/tokens', requireAuth, requireSessionAuth",
    "authRoute.delete('/tokens/:tokenId', requireAuth, requireSessionAuth",
  ]) {
    if (!authSource.includes(route)) {
      throw new Error(`API token management route is not session-only: ${route}`);
    }
  }
  const revokeStart = authSource.indexOf("authRoute.delete('/tokens/:tokenId'");
  if (revokeStart < 0) {
    throw new Error('API token revoke route is missing');
  }
  const revokeRoute = authSource.slice(
    revokeStart,
    authSource.indexOf('export { authRoute }', revokeStart),
  );
  const requiredPhrases = [
    'const deletedRows = await db',
    'eq(apiTokens.token_id, tokenId)',
    'eq(apiTokens.user_id, offisimUser.ba_user_id)',
    'Token state changed before deletion',
  ];
  for (const phrase of requiredPhrases) {
    if (!revokeRoute.includes(phrase)) {
      throw new Error(`API token revoke ownership guard missing "${phrase}"`);
    }
  }
}

function expectMarketplaceWriteRoutesHaveApiTokenBoundaries() {
  const marketSource = readFileSync(
    new URL('../apps/platform/src/routes/market.ts', import.meta.url),
    'utf8',
  );
  for (const route of [
    "market.post('/listings/:listingId/reports', requireAuth, requireSessionAuth",
    "market.patch(\n  '/listings/:listingId/status',\n  requireAuth,\n  requireApiTokenScope('publish:write'),\n  requireCreator",
  ]) {
    if (!marketSource.includes(route)) {
      throw new Error(`marketplace write route API-token boundary is missing: ${route}`);
    }
  }
}

function expectPrivateLibraryRouteIsSessionOnly() {
  const meSource = readFileSync(
    new URL('../apps/platform/src/routes/me.ts', import.meta.url),
    'utf8',
  );
  if (!meSource.includes("meRoute.get('/library', requireAuth, requireSessionAuth")) {
    throw new Error('private library route is not session-only');
  }
}

await expectApiTokenValidAuthenticates();
await expectApiTokenInvalidReturns401();
await expectApiTokenExpiredReturns401();
await expectApiTokenBackendErrorReturns503();
expectEmailAdoptionRequiresVerification();
await expectScopeDenied();
await expectScopeAllowed();
await expectTokenManagementRejectsApiTokenAuth();
await expectTokenManagementAllowsSessionAuth();
await expectUnknownStoredScopesIgnored();
expectTokenCreationScopeValidation();
expectTokenCreationExpiryValidation();
await expectForwardedForIgnoredByDefault();
expectMigrationDriftFailure();
expectMarketplaceVisibilityGuards();
expectTokenRevokeOwnershipBoundInDelete();
expectMarketplaceWriteRoutesHaveApiTokenBoundaries();
expectPrivateLibraryRouteIsSessionOnly();

console.log('Platform auth boundary harness passed.');
