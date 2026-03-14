import { users, creators } from '@aics/db-platform';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth } from '../middleware/auth.js';
import type { PlatformEnv } from '../types.js';

const DEV_SECRET = process.env.AICS_JWT_SECRET ?? 'aics-dev-secret';

/**
 * Encode a JWT payload as a dev-mode token (HS256 header + base64url payload + dummy sig).
 * This matches the existing dev auth middleware which base64-decodes payload.split('.')[1].
 */
function makeDevJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const body = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  // Dummy signature — dev middleware does not verify signatures
  const sig = btoa(DEV_SECRET).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.${sig}`;
}

const authRoute = new Hono<PlatformEnv>();

// POST /v1/auth/dev-login
// Body: { email: string; display_name: string }
// Creates user in DB if not exists, returns a dev JWT token.
authRoute.post('/dev-login', async (c) => {
  const body = await c.req.json<{ email?: string; display_name?: string }>();
  const email = body.email?.trim();
  const displayName = body.display_name?.trim();

  if (!email || !displayName) {
    throw new HTTPException(400, { message: 'email and display_name are required' });
  }

  const db = c.get('db');

  // Upsert: look up by email, create if not found
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  let userId: string;
  if (existing) {
    userId = existing.user_id;
  } else {
    const [created] = await db
      .insert(users)
      .values({
        email,
        display_name: displayName,
        auth_provider: 'dev',
        auth_subject: email,
      })
      .returning({ user_id: users.user_id });

    if (!created) {
      throw new HTTPException(500, { message: 'Failed to create user' });
    }
    userId = created.user_id;
  }

  const token = makeDevJwt({
    sub: userId,
    email,
    display_name: displayName,
    iat: Math.floor(Date.now() / 1000),
  });

  return c.json({ token, user_id: userId, email, display_name: displayName });
});

// POST /v1/auth/register-creator
// Requires Bearer token (auth middleware extracts userId).
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

export { authRoute };
