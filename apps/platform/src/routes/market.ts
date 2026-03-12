import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { listings, creators, packageVersions, reviews, listingTags, listingPreviews } from '@aics/db-platform';
import type { PlatformEnv } from '../types.js';
import { searchListings } from '../services/search.js';

const market = new Hono<PlatformEnv>();

// GET /v1/market/search
market.get('/search', async (c) => {
  const db = c.get('db');
  const params = {
    q: c.req.query('q'),
    kind: c.req.query('kind'),
    risk_class: c.req.query('risk_class'),
    tag: c.req.query('tag'),
    sort: c.req.query('sort'),
    page: c.req.query('page') ? parseInt(c.req.query('page')!, 10) : undefined,
    per_page: c.req.query('per_page') ? parseInt(c.req.query('per_page')!, 10) : undefined,
  };

  const result = await searchListings(db, params);

  // Collect all listing IDs for batch queries (avoids N+1)
  const listingIds = result.items.map((row) => row.listings.listing_id);

  // Batch fetch latest active versions and tags in 2 queries instead of 2N
  const [allVersions, allTags] = listingIds.length > 0
    ? await Promise.all([
        db
          .select()
          .from(packageVersions)
          .where(and(inArray(packageVersions.listing_id, listingIds), eq(packageVersions.status, 'active')))
          .orderBy(desc(packageVersions.published_at)),
        db
          .select({ listing_id: listingTags.listing_id, tag: listingTags.tag })
          .from(listingTags)
          .where(inArray(listingTags.listing_id, listingIds)),
      ])
    : [[], []];

  // Build lookup maps — for versions, keep only the first (latest) per listing
  const versionMap = new Map<string, (typeof allVersions)[number]>();
  for (const v of allVersions) {
    if (!versionMap.has(v.listing_id)) {
      versionMap.set(v.listing_id, v);
    }
  }

  const tagMap = new Map<string, string[]>();
  for (const t of allTags) {
    const arr = tagMap.get(t.listing_id);
    if (arr) {
      arr.push(t.tag);
    } else {
      tagMap.set(t.listing_id, [t.tag]);
    }
  }

  // Transform joined rows into ListingSummary shape (pure in-memory lookups)
  const items = result.items.map((row) => {
    const listing = row.listings;
    const creator = row.creators;
    const latestVersion = versionMap.get(listing.listing_id);

    return {
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
      latest_version: latestVersion?.version ?? '0.0.0',
      rating: listing.rating_avg ?? 0,
      install_count: listing.install_count ?? 0,
      tags: tagMap.get(listing.listing_id) ?? [],
    };
  });

  return c.json({
    items,
    page: result.page,
    per_page: result.per_page,
    total: result.total,
  });
});

// GET /v1/market/listings/:listingId
market.get('/listings/:listingId', async (c) => {
  const db = c.get('db');
  const listingId = c.req.param('listingId');

  const [row] = await db
    .select()
    .from(listings)
    .innerJoin(creators, eq(listings.creator_id, creators.creator_id))
    .where(eq(listings.listing_id, listingId))
    .limit(1);

  if (!row) throw new HTTPException(404, { message: 'Listing not found' });

  const listing = row.listings;
  const creator = row.creators;

  // Latest active version
  const [latestVersion] = await db
    .select()
    .from(packageVersions)
    .where(and(eq(packageVersions.listing_id, listingId), eq(packageVersions.status, 'active')))
    .orderBy(desc(packageVersions.published_at))
    .limit(1);

  // Tags
  const tags = await db
    .select({ tag: listingTags.tag })
    .from(listingTags)
    .where(eq(listingTags.listing_id, listingId));

  // Previews
  const previews = await db
    .select()
    .from(listingPreviews)
    .where(eq(listingPreviews.listing_id, listingId))
    .orderBy(listingPreviews.sort_order);

  const manifest = latestVersion?.manifest_json as Record<string, unknown> | undefined;

  return c.json({
    listing_id: listing.listing_id,
    slug: listing.slug,
    kind: listing.kind,
    title: listing.title,
    summary: listing.summary ?? '',
    description: listing.description ?? '',
    creator: {
      creator_id: creator.creator_id,
      handle: creator.handle,
      display_name: creator.display_name,
      verification_state: creator.verification_state,
    },
    status: listing.status,
    latest_version: latestVersion?.version ?? '0.0.0',
    rating: listing.rating_avg ?? 0,
    install_count: listing.install_count ?? 0,
    tags: tags.map((t) => t.tag),
    version: latestVersion
      ? {
          package_id: latestVersion.package_id,
          version: latestVersion.version,
          runtime_range: latestVersion.runtime_range,
          schema_version: latestVersion.schema_version,
          environments: latestVersion.environments,
          risk_class: latestVersion.risk_class,
          published_at: latestVersion.published_at.toISOString(),
          changelog: latestVersion.changelog,
        }
      : undefined,
    requirements: {
      required_capabilities: (manifest?.requirements as Record<string, unknown>)?.required_capabilities ?? [],
      required_mcps: (manifest?.requirements as Record<string, unknown>)?.required_mcps ?? [],
      recommended_models: (manifest?.requirements as Record<string, unknown>)?.recommended_models ?? [],
    },
    permissions: {
      risk_class: (manifest?.permissions as Record<string, unknown>)?.risk_class ?? latestVersion?.risk_class,
      declares_secrets: (manifest?.permissions as Record<string, unknown>)?.declares_secrets ?? false,
      filesystem_scope: (manifest?.permissions as Record<string, unknown>)?.filesystem_scope ?? 'none',
      network_scope: (manifest?.permissions as Record<string, unknown>)?.network_scope ?? 'none',
    },
    lineage: manifest?.lineage ?? undefined,
    previews: previews.map((p) => ({
      kind: p.kind,
      url: p.url,
      alt: p.alt_text,
    })),
  });
});

// GET /v1/market/listings/by-slug/:slug
market.get('/listings/by-slug/:slug', async (c) => {
  const db = c.get('db');
  const slug = c.req.param('slug');

  const [row] = await db
    .select()
    .from(listings)
    .innerJoin(creators, eq(listings.creator_id, creators.creator_id))
    .where(eq(listings.slug, slug))
    .limit(1);

  if (!row) throw new HTTPException(404, { message: 'Listing not found' });

  const listing = row.listings;
  const creator = row.creators;
  const listingId = listing.listing_id;

  // Latest active version
  const [latestVersion] = await db
    .select()
    .from(packageVersions)
    .where(and(eq(packageVersions.listing_id, listingId), eq(packageVersions.status, 'active')))
    .orderBy(desc(packageVersions.published_at))
    .limit(1);

  // Tags
  const tags = await db
    .select({ tag: listingTags.tag })
    .from(listingTags)
    .where(eq(listingTags.listing_id, listingId));

  // Previews
  const previews = await db
    .select()
    .from(listingPreviews)
    .where(eq(listingPreviews.listing_id, listingId))
    .orderBy(listingPreviews.sort_order);

  const manifest = latestVersion?.manifest_json as Record<string, unknown> | undefined;

  return c.json({
    listing_id: listing.listing_id,
    slug: listing.slug,
    kind: listing.kind,
    title: listing.title,
    summary: listing.summary ?? '',
    description: listing.description ?? '',
    creator: {
      creator_id: creator.creator_id,
      handle: creator.handle,
      display_name: creator.display_name,
      verification_state: creator.verification_state,
    },
    status: listing.status,
    latest_version: latestVersion?.version ?? '0.0.0',
    rating: listing.rating_avg ?? 0,
    install_count: listing.install_count ?? 0,
    tags: tags.map((t) => t.tag),
    version: latestVersion
      ? {
          package_id: latestVersion.package_id,
          version: latestVersion.version,
          runtime_range: latestVersion.runtime_range,
          schema_version: latestVersion.schema_version,
          environments: latestVersion.environments,
          risk_class: latestVersion.risk_class,
          published_at: latestVersion.published_at.toISOString(),
          changelog: latestVersion.changelog,
        }
      : undefined,
    requirements: {
      required_capabilities: (manifest?.requirements as Record<string, unknown>)?.required_capabilities ?? [],
      required_mcps: (manifest?.requirements as Record<string, unknown>)?.required_mcps ?? [],
      recommended_models: (manifest?.requirements as Record<string, unknown>)?.recommended_models ?? [],
    },
    permissions: {
      risk_class: (manifest?.permissions as Record<string, unknown>)?.risk_class ?? latestVersion?.risk_class,
      declares_secrets: (manifest?.permissions as Record<string, unknown>)?.declares_secrets ?? false,
      filesystem_scope: (manifest?.permissions as Record<string, unknown>)?.filesystem_scope ?? 'none',
      network_scope: (manifest?.permissions as Record<string, unknown>)?.network_scope ?? 'none',
    },
    lineage: manifest?.lineage ?? undefined,
    previews: previews.map((p) => ({
      kind: p.kind,
      url: p.url,
      alt: p.alt_text,
    })),
  });
});

// GET /v1/market/listings/:listingId/versions
market.get('/listings/:listingId/versions', async (c) => {
  const db = c.get('db');
  const listingId = c.req.param('listingId');

  // Verify listing exists
  const [listing] = await db
    .select({ listing_id: listings.listing_id })
    .from(listings)
    .where(eq(listings.listing_id, listingId))
    .limit(1);

  if (!listing) throw new HTTPException(404, { message: 'Listing not found' });

  const versions = await db
    .select()
    .from(packageVersions)
    .where(and(eq(packageVersions.listing_id, listingId), eq(packageVersions.status, 'active')))
    .orderBy(desc(packageVersions.published_at));

  return c.json({
    listing_id: listingId,
    versions: versions.map((v) => ({
      package_id: v.package_id,
      version: v.version,
      runtime_range: v.runtime_range,
      schema_version: v.schema_version,
      environments: v.environments,
      risk_class: v.risk_class,
      published_at: v.published_at.toISOString(),
      changelog: v.changelog,
    })),
  });
});

// GET /v1/market/listings/:listingId/reviews
market.get('/listings/:listingId/reviews', async (c) => {
  const db = c.get('db');
  const listingId = c.req.param('listingId');

  const [listing] = await db
    .select({ listing_id: listings.listing_id })
    .from(listings)
    .where(eq(listings.listing_id, listingId))
    .limit(1);

  if (!listing) throw new HTTPException(404, { message: 'Listing not found' });

  const reviewRows = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.listing_id, listingId), eq(reviews.moderation_state, 'visible')))
    .orderBy(desc(reviews.created_at));

  return c.json({
    listing_id: listingId,
    reviews: reviewRows.map((r) => ({
      review_id: r.review_id,
      listing_id: r.listing_id,
      user_id: r.user_id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      moderation_state: r.moderation_state,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    })),
  });
});

export { market };
