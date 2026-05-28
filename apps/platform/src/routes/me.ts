import { creators, listings, packageVersions, userLibrary } from '@offisim/db-platform';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAuth, requireSessionAuth } from '../middleware/auth.js';
import type { PlatformEnv } from '../types.js';

const meRoute = new Hono<PlatformEnv>();

// GET /v1/me/library — returns the authenticated user's saved/installed packages
meRoute.get('/library', requireAuth, requireSessionAuth, async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');

  if (!userId) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  const kindFilter = c.req.query('kind');

  // Fetch user library entries
  const libraryRows = await db
    .select()
    .from(userLibrary)
    .where(eq(userLibrary.user_id, userId))
    .orderBy(desc(userLibrary.saved_at));

  if (libraryRows.length === 0) {
    return c.json({ items: [] });
  }

  const listingIds = libraryRows.map((r) => r.listing_id);

  // Batch fetch listings with creators, and versions
  const [listingRows, allVersions] = await Promise.all([
    db
      .select()
      .from(listings)
      .innerJoin(creators, eq(listings.creator_id, creators.creator_id))
      // OWASP API3:2023 data-exposure: never surface unlisted / retired /
      // delisted entries through the user-facing library. status='listed' is
      // the only state visible to clients.
      .where(and(inArray(listings.listing_id, listingIds), eq(listings.status, 'listed'))),
    db
      .select()
      .from(packageVersions)
      .where(
        and(inArray(packageVersions.listing_id, listingIds), eq(packageVersions.status, 'active')),
      )
      .orderBy(desc(packageVersions.published_at)),
  ]);

  // Build lookup maps
  const listingMap = new Map<string, (typeof listingRows)[number]>();
  for (const row of listingRows) {
    listingMap.set(row.listings.listing_id, row);
  }

  const versionMap = new Map<string, (typeof allVersions)[number]>();
  for (const v of allVersions) {
    if (!versionMap.has(v.listing_id)) {
      versionMap.set(v.listing_id, v);
    }
  }

  // Also build a map by package_version_id for pinned versions
  const versionByIdMap = new Map<string, (typeof allVersions)[number]>();
  for (const v of allVersions) {
    versionByIdMap.set(v.package_version_id, v);
  }

  const items = libraryRows
    .map((libRow) => {
      const row = listingMap.get(libRow.listing_id);
      if (!row) return null;

      const listing = row.listings;
      const creator = row.creators;

      // Apply kind filter if specified
      if (kindFilter && listing.kind !== kindFilter) return null;

      // Use pinned version if available, otherwise latest
      const pinnedVersion = libRow.package_version_id
        ? versionByIdMap.get(libRow.package_version_id)
        : undefined;
      const version = pinnedVersion ?? versionMap.get(listing.listing_id);

      return {
        listing: {
          listing_id: listing.listing_id,
          slug: listing.slug,
          kind: listing.kind,
          title: listing.title,
          summary: listing.summary ?? '',
          creator: {
            creator_id: creator.creator_id,
            handle: creator.handle,
            display_name: creator.display_name,
            verification_state: creator.verification_state,
          },
          status: listing.status,
          latest_version: versionMap.get(listing.listing_id)?.version ?? '0.0.0',
          rating: listing.rating_avg ?? 0,
          install_count: listing.install_count ?? 0,
        },
        version: version
          ? {
              package_id: version.package_id,
              version: version.version,
              runtime_range: version.runtime_range,
              schema_version: version.schema_version,
              environments: version.environments,
              risk_class: version.risk_class,
              published_at: version.published_at.toISOString(),
              changelog: version.changelog,
            }
          : {
              package_id: '',
              version: '0.0.0',
              runtime_range: '*',
              schema_version: '1',
              environments: [],
              risk_class: 'safe',
            },
        saved_at: libRow.saved_at.toISOString(),
        install_receipt_id: libRow.install_receipt_id ?? null,
      };
    })
    .filter(Boolean);

  return c.json({ items });
});

export { meRoute };
