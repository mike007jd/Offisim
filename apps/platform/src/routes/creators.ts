import { creators, listings, packageVersions } from '@offisim/db-platform';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { PlatformEnv } from '../types.js';

const creatorsRoute = new Hono<PlatformEnv>();

// GET /v1/market/creators/:handle
creatorsRoute.get('/:handle', async (c) => {
  const db = c.get('db');
  const handle = c.req.param('handle');

  const [creator] = await db.select().from(creators).where(eq(creators.handle, handle)).limit(1);

  if (!creator) throw new HTTPException(404, { message: 'Creator not found' });

  const creatorListings = await db
    .select()
    .from(listings)
    .where(eq(listings.creator_id, creator.creator_id))
    .orderBy(desc(listings.updated_at));

  // Batch fetch latest active versions for all listings
  const listingIds = creatorListings.map((l) => l.listing_id);
  const allVersions =
    listingIds.length > 0
      ? await db
          .select()
          .from(packageVersions)
          .where(
            and(
              inArray(packageVersions.listing_id, listingIds),
              eq(packageVersions.status, 'active'),
            ),
          )
          .orderBy(desc(packageVersions.published_at))
      : [];

  const versionMap = new Map<string, string>();
  for (const v of allVersions) {
    if (!versionMap.has(v.listing_id)) {
      versionMap.set(v.listing_id, v.version);
    }
  }

  const creatorSummary = {
    creator_id: creator.creator_id,
    handle: creator.handle,
    display_name: creator.display_name,
    verification_state: creator.verification_state,
  };

  return c.json({
    ...creatorSummary,
    bio: creator.bio,
    website_url: creator.website_url,
    created_at: creator.created_at.toISOString(),
    listings: creatorListings.map((l) => ({
      listing_id: l.listing_id,
      slug: l.slug,
      kind: l.kind,
      title: l.title,
      summary: l.summary ?? '',
      creator: creatorSummary,
      status: l.status,
      latest_version: versionMap.get(l.listing_id) ?? '0.0.0',
      rating: l.rating_avg ?? 0,
      install_count: l.install_count ?? 0,
    })),
  });
});

export { creatorsRoute };
