import { apiTokens, creators, users } from '@offisim/db-platform';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { readPlatformJsonBody } from '../lib/body-limit.js';
import { sha256 } from '../lib/crypto.js';
import {
  parseApiTokenExpiryDays,
  parseApiTokenScopes,
  requireAuth,
  requireSessionAuth,
} from '../middleware/auth.js';
import { RegisterCreatorSchema } from '../schemas/index.js';
import type { PlatformEnv } from '../types.js';

const authRoute = new Hono<PlatformEnv>();

// POST /v1/auth/register-creator
// Requires an authenticated browser session.
// Body: { handle: string; display_name: string; bio?: string }
authRoute.post('/register-creator', requireAuth, requireSessionAuth, async (c) => {
  const body = RegisterCreatorSchema.parse(await readPlatformJsonBody(c));
  const handle = body.handle;
  const displayName = body.display_name;
  const bio = body.bio?.trim() ?? null;

  const db = c.get('db');
  const userId = c.get('userId');

  if (!userId) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }

  // Check for handle uniqueness
  const [existingHandle] = await db
    .select()
    .from(creators)
    .where(eq(creators.handle, handle))
    .limit(1);

  if (existingHandle) {
    throw new HTTPException(409, { message: 'Handle is already taken' });
  }

  // Check user doesn't already have a creator profile
  const [existingCreator] = await db
    .select()
    .from(creators)
    .where(eq(creators.user_id, userId))
    .limit(1);

  if (existingCreator) {
    throw new HTTPException(409, { message: 'User already has a creator profile' });
  }

  const [created] = await db
    .insert(creators)
    .values({
      user_id: userId,
      handle,
      display_name: displayName,
      bio,
    })
    .returning();

  if (!created) {
    throw new HTTPException(500, { message: 'Failed to create creator profile' });
  }

  return c.json({
    creator_id: created.creator_id,
    user_id: created.user_id,
    handle: created.handle,
    display_name: created.display_name,
    bio: created.bio,
    verification_state: created.verification_state,
    created_at: created.created_at.toISOString(),
  });
});

// ── API Token Management ──

/**
 * Generate a random API token with offisim_ prefix.
 */
function generateApiToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = 'offisim_';
  const array = new Uint8Array(40);
  crypto.getRandomValues(array);
  for (const byte of array) {
    token += chars[byte % chars.length];
  }
  return token;
}

// POST /v1/auth/tokens — Create a new API token
authRoute.post('/tokens', requireAuth, requireSessionAuth, async (c) => {
  const body = (await readPlatformJsonBody(c)) as {
    name?: unknown;
    scopes?: unknown;
    expires_in_days?: unknown;
  };
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  if (!name) {
    throw new HTTPException(400, { message: 'name is required' });
  }
  const scopes = parseApiTokenScopes(body.scopes);
  const expiresInDays = parseApiTokenExpiryDays(body.expires_in_days);

  const db = c.get('db');
  const userId = c.get('userId');

  if (!userId) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }

  // Look up ba_user_id for the current user
  const [offisimUser] = await db.select().from(users).where(eq(users.user_id, userId)).limit(1);

  if (!offisimUser?.ba_user_id) {
    throw new HTTPException(400, { message: 'User is not linked to an auth account' });
  }

  const rawToken = generateApiToken();
  const hash = await sha256(rawToken);
  const prefix = rawToken.slice(0, 15); // "offisim_" + 7 chars

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const [created] = await db
    .insert(apiTokens)
    .values({
      user_id: offisimUser.ba_user_id,
      name,
      token_hash: hash,
      token_prefix: prefix,
      scopes,
      expires_at: expiresAt,
    })
    .returning();

  if (!created) {
    throw new HTTPException(500, { message: 'Failed to create API token' });
  }

  // Return the raw token ONCE — it cannot be retrieved again
  return c.json({
    token_id: created.token_id,
    name: created.name,
    token: rawToken, // shown only once
    token_prefix: created.token_prefix,
    scopes: created.scopes,
    expires_at: created.expires_at?.toISOString() ?? null,
    created_at: created.created_at.toISOString(),
  });
});

// GET /v1/auth/tokens — List API tokens for current user (no raw tokens)
authRoute.get('/tokens', requireAuth, requireSessionAuth, async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');

  if (!userId) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }

  const [offisimUser] = await db.select().from(users).where(eq(users.user_id, userId)).limit(1);

  if (!offisimUser?.ba_user_id) {
    return c.json({ tokens: [] });
  }

  const tokens = await db
    .select({
      token_id: apiTokens.token_id,
      name: apiTokens.name,
      token_prefix: apiTokens.token_prefix,
      scopes: apiTokens.scopes,
      last_used_at: apiTokens.last_used_at,
      expires_at: apiTokens.expires_at,
      created_at: apiTokens.created_at,
    })
    .from(apiTokens)
    .where(eq(apiTokens.user_id, offisimUser.ba_user_id));

  return c.json({
    tokens: tokens.map((t) => ({
      ...t,
      last_used_at: t.last_used_at?.toISOString() ?? null,
      expires_at: t.expires_at?.toISOString() ?? null,
      created_at: t.created_at.toISOString(),
    })),
  });
});

// DELETE /v1/auth/tokens/:tokenId — Revoke an API token
authRoute.delete('/tokens/:tokenId', requireAuth, requireSessionAuth, async (c) => {
  const tokenId = c.req.param('tokenId');
  const db = c.get('db');
  const userId = c.get('userId');

  if (!userId) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }

  const [offisimUser] = await db.select().from(users).where(eq(users.user_id, userId)).limit(1);

  if (!offisimUser?.ba_user_id) {
    throw new HTTPException(404, { message: 'Token not found' });
  }

  // Verify the token belongs to this user before deleting
  const [tokenRow] = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.token_id, tokenId))
    .limit(1);

  if (!tokenRow || tokenRow.user_id !== offisimUser.ba_user_id) {
    throw new HTTPException(404, { message: 'Token not found' });
  }

  const deletedRows = await db
    .delete(apiTokens)
    .where(and(eq(apiTokens.token_id, tokenId), eq(apiTokens.user_id, offisimUser.ba_user_id)))
    .returning({ token_id: apiTokens.token_id });

  if (deletedRows.length === 0) {
    throw new HTTPException(409, { message: 'Token state changed before deletion' });
  }

  return c.json({ deleted: true });
});

export { authRoute };
