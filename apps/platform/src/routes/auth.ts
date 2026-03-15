import { creators, users, apiTokens } from '@aics/db-platform';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { sha256 } from '../lib/crypto.js';
import { requireAuth } from '../middleware/auth.js';
import type { PlatformEnv } from '../types.js';

const authRoute = new Hono<PlatformEnv>();

// POST /v1/auth/register-creator
// Requires authentication (Better Auth session or API token).
// Body: { handle: string; display_name: string; bio?: string }
authRoute.post('/register-creator', requireAuth, async (c) => {
  const body = await c.req.json<{ handle?: string; display_name?: string; bio?: string }>();
  const handle = body.handle?.trim();
  const displayName = body.display_name?.trim();
  const bio = body.bio?.trim() ?? null;

  if (!handle || !displayName) {
    throw new HTTPException(400, { message: 'handle and display_name are required' });
  }

  const db = c.get('db');
  const userId = c.get('userId')!;

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
 * Generate a random API token with aics_ prefix.
 */
function generateApiToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let token = 'aics_';
  const array = new Uint8Array(40);
  crypto.getRandomValues(array);
  for (const byte of array) {
    token += chars[byte % chars.length];
  }
  return token;
}

// POST /v1/auth/tokens — Create a new API token
authRoute.post('/tokens', requireAuth, async (c) => {
  const body = await c.req.json<{ name?: string; scopes?: string[]; expires_in_days?: number }>();
  const name = body.name?.trim();

  if (!name) {
    throw new HTTPException(400, { message: 'name is required' });
  }

  const db = c.get('db');
  const userId = c.get('userId')!;

  // Look up ba_user_id for the current user
  const [aicsUser] = await db
    .select()
    .from(users)
    .where(eq(users.user_id, userId))
    .limit(1);

  if (!aicsUser?.ba_user_id) {
    throw new HTTPException(400, { message: 'User is not linked to an auth account' });
  }

  const rawToken = generateApiToken();
  const hash = await sha256(rawToken);
  const prefix = rawToken.slice(0, 12); // "aics_" + 7 chars

  const expiresAt = body.expires_in_days
    ? new Date(Date.now() + body.expires_in_days * 24 * 60 * 60 * 1000)
    : null;

  const [created] = await db
    .insert(apiTokens)
    .values({
      user_id: aicsUser.ba_user_id,
      name,
      token_hash: hash,
      token_prefix: prefix,
      scopes: body.scopes ?? [],
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
authRoute.get('/tokens', requireAuth, async (c) => {
  const db = c.get('db');
  const userId = c.get('userId')!;

  const [aicsUser] = await db
    .select()
    .from(users)
    .where(eq(users.user_id, userId))
    .limit(1);

  if (!aicsUser?.ba_user_id) {
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
    .where(eq(apiTokens.user_id, aicsUser.ba_user_id));

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
authRoute.delete('/tokens/:tokenId', requireAuth, async (c) => {
  const tokenId = c.req.param('tokenId');
  const db = c.get('db');
  const userId = c.get('userId')!;

  const [aicsUser] = await db
    .select()
    .from(users)
    .where(eq(users.user_id, userId))
    .limit(1);

  if (!aicsUser?.ba_user_id) {
    throw new HTTPException(404, { message: 'Token not found' });
  }

  // Verify the token belongs to this user before deleting
  const [tokenRow] = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.token_id, tokenId))
    .limit(1);

  if (!tokenRow || tokenRow.user_id !== aicsUser.ba_user_id) {
    throw new HTTPException(404, { message: 'Token not found' });
  }

  await db.delete(apiTokens).where(eq(apiTokens.token_id, tokenId));

  return c.json({ deleted: true });
});

export { authRoute };
