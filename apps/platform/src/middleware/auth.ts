import { createMiddleware } from 'hono/factory';
import { eq } from 'drizzle-orm';
import { apiTokens, users } from '@aics/db-platform';
import { auth } from '../auth.js';
import { sha256 } from '../lib/crypto.js';
import type { PlatformEnv } from '../types.js';

/**
 * Auth Middleware — Better Auth session + API token validation.
 *
 * Priority:
 * 1. Bearer token with `aics_` prefix → validate against api_tokens table (SHA-256 hash)
 * 2. Better Auth session (cookie or Bearer token via bearer plugin)
 * 3. Unauthenticated — request continues without userId/userEmail
 */

export const optionalAuth = createMiddleware<PlatformEnv>(async (c, next) => {
  const authHeader = c.req.header('authorization');

  // 1. Check for API token (aics_ prefix)
  if (authHeader?.startsWith('Bearer aics_')) {
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

        // Look up the linked AICS user
        const [aicsUser] = await db
          .select()
          .from(users)
          .where(eq(users.ba_user_id, tokenRow.user_id))
          .limit(1);

        if (aicsUser) {
          c.set('userId', aicsUser.user_id);
          c.set('userEmail', aicsUser.email);
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
      // Look up the linked AICS user by ba_user_id
      const db = c.get('db');
      const [aicsUser] = await db
        .select()
        .from(users)
        .where(eq(users.ba_user_id, session.user.id))
        .limit(1);

      if (aicsUser) {
        c.set('userId', aicsUser.user_id);
        c.set('userEmail', aicsUser.email);
      } else {
        // Auto-create AICS user if not linked yet (first login after migration)
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
            // Link existing AICS user to Better Auth user
            await db
              .update(users)
              .set({ ba_user_id: session.user.id })
              .where(eq(users.user_id, existingByEmail.user_id));

            c.set('userId', existingByEmail.user_id);
            c.set('userEmail', existingByEmail.email);
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
