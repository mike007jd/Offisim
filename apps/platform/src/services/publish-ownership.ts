import { listings } from '@offisim/db-platform';
import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { PlatformEnv } from '../types.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function assertListingOwnedByCreator(
  db: PlatformEnv['Variables']['db'],
  listingId: string,
  creatorId: string,
): Promise<void> {
  if (!UUID_REGEX.test(listingId)) {
    throw new HTTPException(400, { message: 'listing_id must be a valid UUID' });
  }
  const [listing] = await db
    .select({ listing_id: listings.listing_id })
    .from(listings)
    .where(and(eq(listings.listing_id, listingId), eq(listings.creator_id, creatorId)))
    .limit(1);
  if (!listing) {
    throw new HTTPException(403, { message: 'Listing does not belong to this creator' });
  }
}
