import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, and, sql } from 'drizzle-orm';
import { reviews, listings } from '@aics/db-platform';
import { requireAuth } from '../middleware/auth.js';
import { ReviewCreateSchema } from '../schemas/index.js';
import type { PlatformEnv } from '../types.js';

const reviewsRoute = new Hono<PlatformEnv>();

// POST /v1/reviews — create or update a review
reviewsRoute.post('/', requireAuth, async (c) => {
  const db = c.get('db');
  const userId = c.get('userId')!;
  const body = ReviewCreateSchema.parse(await c.req.json());

  // Verify listing exists
  const [listing] = await db
    .select({ listing_id: listings.listing_id })
    .from(listings)
    .where(eq(listings.listing_id, body.listing_id))
    .limit(1);

  if (!listing) throw new HTTPException(404, { message: 'Listing not found' });

  // Upsert: check if user already reviewed this listing
  const [existing] = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.listing_id, body.listing_id), eq(reviews.user_id, userId)))
    .limit(1);

  let review: typeof existing;
  if (existing) {
    // Update existing review
    [review] = await db
      .update(reviews)
      .set({
        rating: body.rating,
        title: body.title ?? null,
        body: body.body ?? null,
        updated_at: new Date(),
      })
      .where(eq(reviews.review_id, existing.review_id))
      .returning();
  } else {
    // Create new review
    [review] = await db
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

  // Update listing rating aggregates
  const [agg] = await db
    .select({
      avg: sql<number>`avg(rating)::real`,
      count: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(and(eq(reviews.listing_id, body.listing_id), eq(reviews.moderation_state, 'visible')));

  await db
    .update(listings)
    .set({
      rating_avg: agg?.avg ?? 0,
      rating_count: agg?.count ?? 0,
      updated_at: new Date(),
    })
    .where(eq(listings.listing_id, body.listing_id));

  return c.json(
    {
      review_id: review.review_id,
      listing_id: review.listing_id,
      user_id: review.user_id,
      rating: review.rating,
      title: review.title,
      body: review.body,
      moderation_state: review.moderation_state,
      created_at: review.created_at.toISOString(),
      updated_at: review.updated_at.toISOString(),
    },
    existing ? 200 : 201,
  );
});

export { reviewsRoute };
