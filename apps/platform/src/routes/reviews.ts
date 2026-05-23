import { creators, listings, reviews } from '@offisim/db-platform';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { readPlatformJsonBody } from '../lib/body-limit.js';
import { requireAuth, requireScope } from '../middleware/auth.js';
import { ReviewCreateSchema } from '../schemas/index.js';
import type { PlatformEnv } from '../types.js';

const reviewsRoute = new Hono<PlatformEnv>();

// POST /v1/reviews — create or update a review
reviewsRoute.post('/', requireAuth, requireScope('reviews:write'), async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');

  if (!userId) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  const body = ReviewCreateSchema.parse(await readPlatformJsonBody(c));

  const result = await db.transaction(async (tx) => {
    // Verify listing exists and check ownership inside the write transaction.
    const [listing] = await tx
      .select({
        listing_id: listings.listing_id,
        user_id: creators.user_id,
      })
      .from(listings)
      .innerJoin(creators, eq(listings.creator_id, creators.creator_id))
      .where(and(eq(listings.listing_id, body.listing_id), eq(listings.status, 'listed')))
      .limit(1);

    if (!listing) throw new HTTPException(404, { message: 'Listing not available for review' });

    // Block self-review
    if (listing.user_id === userId) {
      throw new HTTPException(403, { message: 'Cannot review your own listing' });
    }

    // Upsert: check if user already reviewed this listing
    const [existing] = await tx
      .select()
      .from(reviews)
      .where(and(eq(reviews.listing_id, body.listing_id), eq(reviews.user_id, userId)))
      .limit(1);

    let review: typeof existing;
    if (existing) {
      [review] = await tx
        .update(reviews)
        .set({
          rating: body.rating,
          title: body.title ?? null,
          body: body.body ?? null,
          updated_at: new Date(),
        })
        .where(
          and(
            eq(reviews.review_id, existing.review_id),
            eq(reviews.listing_id, body.listing_id),
            eq(reviews.user_id, userId),
          ),
        )
        .returning();
    } else {
      [review] = await tx
        .insert(reviews)
        .values({
          listing_id: body.listing_id,
          user_id: userId,
          rating: body.rating,
          title: body.title ?? null,
          body: body.body ?? null,
          moderation_state: 'visible',
        })
        .returning();
    }

    if (!review) throw new HTTPException(500, { message: 'Failed to create/update review' });

    const [agg] = await tx
      .select({
        avg: sql<number>`avg(rating)::real`,
        count: sql<number>`count(*)::int`,
      })
      .from(reviews)
      .where(and(eq(reviews.listing_id, body.listing_id), eq(reviews.moderation_state, 'visible')));

    const listingRows = await tx
      .update(listings)
      .set({
        rating_avg: agg?.avg ?? 0,
        rating_count: agg?.count ?? 0,
        updated_at: new Date(),
      })
      .where(and(eq(listings.listing_id, body.listing_id), eq(listings.status, 'listed')))
      .returning({ listing_id: listings.listing_id });

    if (listingRows.length === 0) {
      throw new HTTPException(409, { message: 'Listing state changed before review write' });
    }

    return { review, status: existing ? (200 as const) : (201 as const) };
  });

  return c.json(
    {
      review_id: result.review.review_id,
      listing_id: result.review.listing_id,
      user_id: result.review.user_id,
      rating: result.review.rating,
      title: result.review.title,
      body: result.review.body,
      moderation_state: result.review.moderation_state,
      created_at: result.review.created_at.toISOString(),
      updated_at: result.review.updated_at.toISOString(),
    },
    result.status,
  );
});

export { reviewsRoute };
