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
