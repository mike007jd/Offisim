import { apiTokens, creators, users } from '@offisim/db-platform';
import { eq } from 'drizzle-orm';
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

export const API_TOKEN_SCOPES = ['publish:write', 'install:receipt', 'reviews:write'] as const;
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

export const optionalAuth = createMiddleware<PlatformEnv>(async (c, next) => {
  const authHeader = c.req.header('authorization');

  // 1. Check for API token (offisim_ prefix)
  if (authHeader?.startsWith('Bearer offisim_')) {
    const rawToken = authHeader.slice(7); // remove "Bearer "
    try {
      const hash = await sha256(rawToken);
      const db = c.get('db');
      const [tokenRow] = await db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.token_hash, hash))
        .limit(1);

      if (tokenRow) {
        // Check expiry
        if (tokenRow.expires_at && tokenRow.expires_at < new Date()) {
          // Expired token — treat as unauthenticated
          await next();
          return;
        }

        // Look up the linked Offisim user
        const [offisimUser] = await db
          .select()
          .from(users)
          .where(eq(users.ba_user_id, tokenRow.user_id))
          .limit(1);

        if (offisimUser) {
          c.set('userId', offisimUser.user_id);
          c.set('userEmail', offisimUser.email);
          c.set('authKind', 'api-token');
          c.set('apiTokenScopes', normalizeApiTokenScopes(tokenRow.scopes));
        }

        // Update last_used_at (fire-and-forget)
        db.update(apiTokens)
          .set({ last_used_at: new Date() })
          .where(eq(apiTokens.token_id, tokenRow.token_id))
          .then(() => {})
          .catch(() => {});
      }
    } catch {
      // Invalid token — treat as unauthenticated
    }
    await next();
    return;
  }

  // 2. Better Auth session (cookie-based or bearer token)
  try {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    if (session?.user) {
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
            if (existingByEmail.ba_user_id && existingByEmail.ba_user_id !== session.user.id) {
              // Email already linked to a different OAuth account — refuse to overwrite
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
    }
  } catch {
    // Session check failed — proceed as unauthenticated
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

export function getRequiredUserId(c: { get: (key: 'userId') => string | undefined }): string {
  const userId = c.get('userId');
  if (!userId) {
    throw new HTTPException(401, { message: 'Authentication required' });
  }
  return userId;
}

export function requireScope(scope: string) {
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

export const requireLocalRuntimeAccess = createMiddleware<PlatformEnv>(async (c, next) => {
  if (c.get('userId')) {
    await next();
    return;
  }
  const expected = process.env.OFFISIM_LOCAL_RUNTIME_TOKEN?.trim();
  const provided = c.req.header('x-offisim-local-runtime-token')?.trim();
  if (expected && provided && provided === expected) {
    await next();
    return;
  }
  return c.json(
    {
      error: {
        code: 'LOCAL_RUNTIME_AUTH_REQUIRED',
        message: 'Local runtime route requires a session or local runtime token.',
      },
    },
    401,
  );
});

// ---------------------------------------------------------------------------
// Creator middleware — ensures authenticated user has a creator profile
// ---------------------------------------------------------------------------

/** Find a creator's id by user_id. Shared between middleware and /me handler. */
export async function findCreatorIdByUserId(
  db: PlatformDb,
  userId: string,
): Promise<string | null> {
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
