import { eq, ilike, or, desc, sql, and, inArray } from 'drizzle-orm';
import { listings, creators, listingTags } from '@aics/db-platform';
import type { PlatformDb } from '../db.js';

export interface SearchFilters {
  q?: string;
  kind?: string;
  risk_class?: string;
  tag?: string;
  sort?: string;
  page?: number;
  per_page?: number;
}

export async function searchListings(db: PlatformDb, filters: SearchFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.min(50, Math.max(1, filters.per_page ?? 20));
  const offset = (page - 1) * perPage;

  const conditions = [eq(listings.status, 'listed')];

  if (filters.kind) {
    conditions.push(eq(listings.kind, filters.kind));
  }

  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(
      or(
        ilike(listings.title, pattern),
        ilike(listings.summary, pattern),
      )!,
    );
  }

  // Tag filter requires subquery
  if (filters.tag) {
    const taggedIds = db
      .select({ listing_id: listingTags.listing_id })
      .from(listingTags)
      .where(eq(listingTags.tag, filters.tag));
    conditions.push(inArray(listings.listing_id, taggedIds));
  }

  const where = and(...conditions);

  // Sort
  let orderBy;
  switch (filters.sort) {
    case 'newest':
      orderBy = desc(listings.created_at);
      break;
    case 'updated':
      orderBy = desc(listings.updated_at);
      break;
    case 'rating':
      orderBy = desc(listings.rating_avg);
      break;
    case 'installs':
      orderBy = desc(listings.install_count);
      break;
    case 'relevance':
    default:
      // Simple relevance score: rating * ln(installs + 1)
      orderBy = desc(
        sql`${listings.rating_avg} * ln(${listings.install_count} + 1)`,
      );
      break;
  }

  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(listings)
      .innerJoin(creators, eq(listings.creator_id, creators.creator_id))
      .where(where)
      .orderBy(orderBy)
      .limit(perPage)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(listings)
      .where(where),
  ]);

  const total = countResult[0]?.count ?? 0;

  return { items, page, per_page: perPage, total };
}
