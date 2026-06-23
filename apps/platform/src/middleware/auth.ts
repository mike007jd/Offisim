import { apiTokens, creators, users } from '@offisim/db-platform';
import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { auth } from '../auth.js';
import type { PlatformDb } from '../db.js';
import { sha256 } from '../lib/crypto.js';
import type { PlatformEnv } from '../types.js';

/**
 * Auth Middleware — Better Auth session + API token validation.
 *
 * Priority:
 * 1. Bearer token with `offisim_` prefix → validate against api_tokens table (SHA-256 hash)
 * 2. Better Auth session (cookie or Bearer token via bearer plugin)
 * 3. Unauthenticated — request continues without userId/userEmail
 */

const API_TOKEN_SCOPES = ['publish:write', 'install:receipt', 'reviews:write'] as const;
export const MAX_API_TOKEN_EXPIRY_DAYS = 365;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

const API_TOKEN_SCOPE_SET = new Set<string>(API_TOKEN_SCOPES);

export function normalizeApiTokenScopes(value: unknown): ApiTokenScope[] {
  if (!Array.isArray(value)) return [];
  const scopes: ApiTokenScope[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    if (!API_TOKEN_SCOPE_SET.has(item)) continue;
    const scope = item as ApiTokenScope;
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  return scopes;
}

export function parseApiTokenScopes(value: unknown): ApiTokenScope[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new HTTPException(400, { message: 'scopes must be an array' });
  }
  const scopes: ApiTokenScope[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !API_TOKEN_SCOPE_SET.has(item)) {
      throw new HTTPException(400, { message: 'scopes contains an unsupported API token scope' });
    }
    const scope = item as ApiTokenScope;
    if (!scopes.includes(scope)) scopes.push(scope);
  }
  return scopes;
}

export function parseApiTokenExpiryDays(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_API_TOKEN_EXPIRY_DAYS
  ) {
    throw new HTTPException(400, {
      message: `expires_in_days must be an integer between 1 and ${MAX_API_TOKEN_EXPIRY_DAYS}`,
    });
  }
  return value;
}

/**
 * Outcome of validating an `offisim_`-prefixed bearer token. Splitting the
 * decision out of the middleware (a) makes the 401/503/anonymous matrix unit
 * testable without a live Better Auth + Postgres, and (b) lets the middleware
 * STOP swallowing a present-but-invalid token (or a DB outage during validation)
 * into an anonymous success — see PL1. `no-linked-user` preserves the prior
 * behavior of degrading to anonymous when a valid token has no Offisim user.
 */
type ApiTokenAuthResult =
  | {
      kind: 'authenticated';
      userId: string;
      userEmail: string;
      scopes: ApiTokenScope[];
      tokenId: string;
    }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'no-linked-user' }
  | { kind: 'backend-error' };

async function resolveApiTokenAuth(
  db: PlatformDb,
  rawToken: string,
): Promise<ApiTokenAuthResult> {
  let tokenRow: typeof apiTokens.$inferSelect | undefined;
  try {
    const hash = await sha256(rawToken);
    [tokenRow] = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.token_hash, hash))
      .limit(1);
  } catch {
    // The lookup itself failed (DB unavailable) — do not degrade to anonymous.
    return { kind: 'backend-error' };
  }
  // A token was presented but matches no issued row → invalid, not anonymous.
  if (!tokenRow) return { kind: 'invalid' };
  if (tokenRow.expires_at && tokenRow.expires_at < new Date()) return { kind: 'expired' };

  let offisimUser: typeof users.$inferSelect | undefined;
  try {
    [offisimUser] = await db
      .select()
      .from(users)
      .where(eq(users.ba_user_id, tokenRow.user_id))
      .limit(1);
  } catch {
    return { kind: 'backend-error' };
  }
  if (!offisimUser) return { kind: 'no-linked-user' };
  return {
    kind: 'authenticated',
    userId: offisimUser.user_id,
    userEmail: offisimUser.email,
    scopes: normalizeApiTokenScopes(tokenRow.scopes),
    tokenId: tokenRow.token_id,
  };
}

/**
 * PL2 — decide whether a Better Auth session may bind to a pre-existing Offisim
 * `users` row found by email. Adopting an UNLINKED row (`ba_user_id` null, e.g.
 * the official-seed account or any legacy email) requires a verified email; else
 * an attacker could register the seed/known address (email+password sign-ups are
 * unverified by default) and take the account over. Re-linking the SAME ba user
 * is idempotent; a row already linked to a DIFFERENT ba user is never overwritten.
 */
export type EmailAdoptionDecision = 'link' | 'refuse';

export function decideEmailAdoption(
  existing: { ba_user_id: string | null },
  sessionUser: { id: string; emailVerified?: boolean | null },
): EmailAdoptionDecision {
  if (existing.ba_user_id) {
    return existing.ba_user_id === sessionUser.id ? 'link' : 'refuse';
  }
  return sessionUser.emailVerified ? 'link' : 'refuse';
}

// PL1: a credentialed request whose auth backend threw (token lookup or session
// store unavailable) gets 503 — never a silent degrade to anonymous success.
function authBackendUnavailable(c: Context<PlatformEnv>) {
  return c.json(
    {
      error: {
        code: 'AUTH_BACKEND_UNAVAILABLE',
        message: 'Authentication backend is unavailable. Please retry.',
      },
    },
    503,
  );
}

export const optionalAuth = createMiddleware<PlatformEnv>(async (c, next) => {
  const authHeader = c.req.header('authorization');

  // 1. Check for API token (offisim_ prefix)
  if (authHeader?.startsWith('Bearer offisim_')) {
    const rawToken = authHeader.slice(7); // remove "Bearer "
    const db = c.get('db');
    const result = await resolveApiTokenAuth(db, rawToken);
    switch (result.kind) {
      case 'backend-error':
        return authBackendUnavailable(c);
      case 'invalid':
        return c.json(
          { error: { code: 'INVALID_TOKEN', message: 'API token is invalid.' } },
          401,
        );
      case 'expired':
        return c.json(
          { error: { code: 'TOKEN_EXPIRED', message: 'API token is expired.' } },
          401,
        );
      case 'authenticated':
        c.set('userId', result.userId);
        c.set('userEmail', result.userEmail);
        c.set('authKind', 'api-token');
        c.set('apiTokenScopes', result.scopes);
        // Update last_used_at (fire-and-forget)
        db.update(apiTokens)
          .set({ last_used_at: new Date() })
          .where(eq(apiTokens.token_id, result.tokenId))
          .then(() => {})
          .catch(() => {});
        break;
      case 'no-linked-user':
        // Token is valid but maps to no Offisim user — continue anonymous.
        break;
    }
    await next();
    return;
  }

  // 2. Better Auth session (cookie-based or bearer token)
  let session: Awaited<ReturnType<typeof auth.api.getSession>>;
  try {
    session = await auth.api.getSession({ headers: c.req.raw.headers });
  } catch {
    // The auth backend threw (e.g. session store unavailable) — surface 503
    // instead of silently degrading a credentialed request to anonymous (PL1).
    return authBackendUnavailable(c);
  }

  if (session?.user) {
    try {
      // Look up the linked Offisim user by ba_user_id
      const db = c.get('db');
      const [offisimUser] = await db
        .select()
        .from(users)
        .where(eq(users.ba_user_id, session.user.id))
        .limit(1);

      if (offisimUser) {
        c.set('userId', offisimUser.user_id);
        c.set('userEmail', offisimUser.email);
        c.set('authKind', 'session');
      } else {
        // Auto-create Offisim user if not linked yet (first login after migration)
        try {
          const [created] = await db
            .insert(users)
            .values({
              email: session.user.email,
              display_name: session.user.name,
              avatar_url: session.user.image ?? null,
              auth_provider: 'better-auth',
              auth_subject: session.user.id,
              ba_user_id: session.user.id,
            })
            .returning({ user_id: users.user_id });

          if (created) {
            c.set('userId', created.user_id);
            c.set('userEmail', session.user.email);
            c.set('authKind', 'session');
          }
        } catch {
          // May fail on unique constraint if email already exists —
          // try linking existing user by email
          const [existingByEmail] = await db
            .select()
            .from(users)
            .where(eq(users.email, session.user.email))
            .limit(1);

          if (existingByEmail) {
            if (decideEmailAdoption(existingByEmail, session.user) === 'refuse') {
              // Linked elsewhere, or an unverified attempt to adopt an unlinked
              // account — refuse to bind (PL2).
              c.set('authLinkConflict', true);
            } else {
              // Link existing Offisim user to Better Auth user
              await db
                .update(users)
                .set({ ba_user_id: session.user.id })
                .where(eq(users.user_id, existingByEmail.user_id));

              c.set('userId', existingByEmail.user_id);
              c.set('userEmail', existingByEmail.email);
              c.set('authKind', 'session');
            }
          }
        }
      }
    } catch {
      // Infra error while resolving/linking the session's Offisim user (the
      // expected insert-on-conflict is handled by the inner catch above, so this
      // only fires on a genuine DB failure). Surface 503 rather than silently
      // dropping a valid session to anonymous (PL1; consistent with the platform
      // "DB error → 503" convention and the api-token branch).
      return authBackendUnavailable(c);
    }
  }

  await next();
});

/**
 * Required auth guard — returns 401 JSON if no user extracted.
 */
export const requireAuth = createMiddleware<PlatformEnv>(async (c, next) => {
  if (c.get('authLinkConflict')) {
    return c.json(
      {
        error: {
          code: 'AUTH_LINK_CONFLICT',
          message: 'Email already linked to another account',
        },
      },
      401,
    );
  }
  if (!c.get('userId')) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      },
      401,
    );
  }
  await next();
});

export const requireSessionAuth = createMiddleware<PlatformEnv>(async (c, next) => {
  if (c.get('authKind') !== 'session') {
    return c.json(
      {
        error: {
          code: 'SESSION_AUTH_REQUIRED',
          message: 'This route requires an authenticated browser session.',
        },
      },
      403,
    );
  }
  await next();
});

/**
 * Restrict an API-TOKEN-authenticated request to tokens carrying `scope`.
 *
 * IMPORTANT — this is NOT a general authorization gate. It only inspects
 * api-token auth: session/cookie auth (authKind !== 'api-token') passes through
 * UNCHECKED by design (interactive users are gated by `requireAuth` /
 * `requireCreator` / per-resource ownership instead). Renamed from the
 * ambiguous `requireScope` so call sites can't mistake it for "this route
 * requires <scope> for everyone" — it does not. Always pair it with
 * `requireAuth` (and ownership checks where a resource is addressed by id).
 */
export function requireApiTokenScope(scope: string) {
  return createMiddleware<PlatformEnv>(async (c, next) => {
    if (c.get('authKind') !== 'api-token') {
      await next();
      return;
    }
    const scopes = normalizeApiTokenScopes(c.get('apiTokenScopes'));
    if (!scopes.some((tokenScope) => tokenScope === scope)) {
      return c.json(
        {
          error: {
            code: 'FORBIDDEN_SCOPE',
            message: `API token requires scope: ${scope}`,
          },
        },
        403,
      );
    }
    await next();
  });
}

// ---------------------------------------------------------------------------
// Creator middleware — ensures authenticated user has a creator profile
// ---------------------------------------------------------------------------

/** Find a creator's id by user_id. Shared between middleware and /me handler. */
async function findCreatorIdByUserId(db: PlatformDb, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ creator_id: creators.creator_id })
    .from(creators)
    .where(eq(creators.user_id, userId))
    .limit(1);
  return row?.creator_id ?? null;
}

/**
 * Ensure the authenticated user has a creator profile.
 * Sets `creatorId` in context. Must be chained AFTER `requireAuth`.
 */
export const requireCreator = createMiddleware<PlatformEnv>(async (c, next) => {
  const userId = c.get('userId');
  if (!userId) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  const creatorId = await findCreatorIdByUserId(c.get('db'), userId);
  if (!creatorId) {
    throw new HTTPException(403, {
      message: 'User is not a registered creator. Create a creator profile first.',
    });
  }
  c.set('creatorId', creatorId);
  await next();
});

export function getRequiredCreatorId(c: { get: (key: 'creatorId') => string | undefined }): string {
  const creatorId = c.get('creatorId');
  if (!creatorId) {
    throw new HTTPException(403, { message: 'Creator profile required' });
  }
  return creatorId;
}
