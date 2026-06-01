import { creators, listingTags, listings, packageVersions } from '@offisim/db-platform';
import { and, desc, eq, exists, inArray, or, sql } from 'drizzle-orm';
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

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function searchListings(db: PlatformDb, filters: SearchFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const perPage = Math.min(100, Math.max(1, filters.per_page ?? 20));
  const offset = (page - 1) * perPage;
  const q = filters.q?.trim() ?? '';

  const conditions = [eq(listings.status, 'listed')];

  if (filters.kind) {
    conditions.push(eq(listings.kind, filters.kind));
  }

  if (filters.risk_class) {
    conditions.push(
      exists(
        db
          .select({ x: sql`1` })
          .from(packageVersions)
          .where(
            and(
              eq(packageVersions.listing_id, listings.listing_id),
              eq(packageVersions.risk_class, filters.risk_class),
            ),
          ),
      ),
    );
  }

  if (q) {
    const pattern = `%${escapeLikePattern(q)}%`;
    const textSearch = or(
      sql`${listings.title} ILIKE ${pattern} ESCAPE '\\'`,
      sql`${listings.slug} ILIKE ${pattern} ESCAPE '\\'`,
      sql`${listings.summary} ILIKE ${pattern} ESCAPE '\\'`,
      sql`${creators.display_name} ILIKE ${pattern} ESCAPE '\\'`,
    );

    if (textSearch) {
      conditions.push(textSearch);
    }
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
  const socialProofScore = sql`coalesce(${listings.rating_avg}, 0) * ln(greatest(${listings.install_count}, 0) + 1)`;
  const newnessFloor = sql`greatest(0, 1 - (extract(epoch from (now() - ${listings.updated_at})) / 2592000.0))`;
  const textBoost = q
    ? sql`CASE
        WHEN ${listings.title} ILIKE ${escapeLikePattern(q)} ESCAPE '\\' THEN 100
        WHEN ${listings.title} ILIKE ${`${escapeLikePattern(q)}%`} ESCAPE '\\' THEN 40
        WHEN ${listings.slug} ILIKE ${`${escapeLikePattern(q)}%`} ESCAPE '\\' THEN 25
        ELSE 0
      END`
    : sql`0`;
  const relevanceOrder = desc(sql`${textBoost} + ${socialProofScore} + ${newnessFloor}`);
  let orderBy = relevanceOrder;
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
    default:
      // Simple relevance score: rating * ln(installs + 1)
      orderBy = relevanceOrder;
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
    // Only JOIN creators in the count query when WHERE references creators columns (q filter)
    filters.q
      ? db
          .select({ count: sql<number>`count(*)::int` })
          .from(listings)
          .innerJoin(creators, eq(listings.creator_id, creators.creator_id))
          .where(where)
      : db.select({ count: sql<number>`count(*)::int` }).from(listings).where(where),
  ]);

  const total = countResult[0]?.count ?? 0;

  return { items, page, per_page: perPage, total };
}
