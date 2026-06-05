import {
  creators,
  listingPreviews,
  listingTags,
  listings,
  moderationFlags,
  packageLineage,
  packageVersions,
  reviews,
} from '@offisim/db-platform';
import { type SQL, and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { PlatformDb } from '../db.js';
import { readPlatformJsonBody } from '../lib/body-limit.js';
import {
  getRequiredCreatorId,
  requireApiTokenScope,
  requireAuth,
  requireCreator,
  requireSessionAuth,
} from '../middleware/auth.js';
import {
  ListingStatusPatchSchema,
  ReportCreateSchema,
  SearchParamsSchema,
} from '../schemas/index.js';
import { searchListings } from '../services/search.js';
import type { PlatformEnv } from '../types.js';

const market = new Hono<PlatformEnv>();

// ── Visibility guard — only return 'listed' listings to public endpoints ──

async function getVisibleListing(db: PlatformDb, condition: SQL) {
  const [row] = await db
    .select()
    .from(listings)
    .innerJoin(creators, eq(listings.creator_id, creators.creator_id))
    .where(and(eq(listings.status, 'listed'), condition))
    .limit(1);
  return row;
}

async function requireVisibleListingById(db: PlatformDb, listingId: string) {
  const row = await getVisibleListing(db, eq(listings.listing_id, listingId));
  if (!row) throw new HTTPException(404, { message: 'Listing not found' });
  return row;
}

// ── Shared listing detail builder (used by both by-id and by-slug routes) ──

type ListingRow = typeof listings.$inferSelect;
type CreatorRow = typeof creators.$inferSelect;

async function buildListingDetail(db: PlatformDb, listing: ListingRow, creator: CreatorRow) {
  const listingId = listing.listing_id;

  const [latestVersion] = await db
    .select()
    .from(packageVersions)
    .where(and(eq(packageVersions.listing_id, listingId), eq(packageVersions.status, 'active')))
    .orderBy(desc(packageVersions.published_at))
    .limit(1);

  const tags = await db
    .select({ tag: listingTags.tag })
    .from(listingTags)
    .where(eq(listingTags.listing_id, listingId));

  const previews = await db
    .select()
    .from(listingPreviews)
    .where(eq(listingPreviews.listing_id, listingId))
    .orderBy(listingPreviews.sort_order);

  // G/I9 defence-in-depth: pull only the public sub-tree of the stored
  // manifest. Even though `buildListingDetail` reads only requirements /
  // permissions / lineage today, future fields added to the response should
  // never accidentally leak `manifest.custom` (which may carry full asset
  // bodies in legacy seed payloads).
  const manifest = publicManifestView(latestVersion?.manifest_json);

  return {
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
          package_version_id: latestVersion.package_version_id,
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
      required_capabilities:
        (manifest?.requirements as Record<string, unknown>)?.required_capabilities ?? [],
      required_mcps: (manifest?.requirements as Record<string, unknown>)?.required_mcps ?? [],
      recommended_models:
        (manifest?.requirements as Record<string, unknown>)?.recommended_models ?? [],
    },
    permissions: {
      risk_class:
        (manifest?.permissions as Record<string, unknown>)?.risk_class ?? latestVersion?.risk_class,
      declares_secrets:
        (manifest?.permissions as Record<string, unknown>)?.declares_secrets ?? false,
      filesystem_scope:
        (manifest?.permissions as Record<string, unknown>)?.filesystem_scope ?? 'none',
      network_scope: (manifest?.permissions as Record<string, unknown>)?.network_scope ?? 'none',
    },
    lineage: publicLineage(manifest?.lineage),
    previews: previews.map((p) => ({
      kind: normalizePreviewKind(p.kind),
      url: p.url,
      alt: p.alt_text,
    })),
  };
}

function normalizePreviewKind(kind: string): 'icon' | 'image' | 'video' | 'readme' {
  if (kind === 'icon' || kind === 'image' || kind === 'video' || kind === 'readme') {
    return kind;
  }
  return 'image';
}

/**
 * Allow-list manifest fields that may be served to public API callers. This
 * deliberately omits `custom` (where seed payloads historically embedded
 * `skill_md_content` and other asset bodies), `assetFiles`, and any other
 * non-metadata sub-tree. G/I9 — defence-in-depth so future response code
 * can't accidentally surface a private field.
 */
function publicManifestView(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ['requirements', 'permissions', 'lineage', 'package', 'assets'] as const) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

function publicLineage(lineage: unknown) {
  if (!lineage || typeof lineage !== 'object') return undefined;
  const raw = lineage as Record<string, unknown>;
  const visible: Record<string, unknown> = {};
  if (typeof raw.origin_package_id === 'string' && raw.origin_package_id.trim()) {
    visible.origin_package_id = raw.origin_package_id;
  }
  if (typeof raw.forked_from_version === 'string' && raw.forked_from_version.trim()) {
    visible.forked_from_version = raw.forked_from_version;
  }
  if (Array.isArray(raw.derivative_of)) {
    visible.derivative_of = raw.derivative_of.filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0,
    );
  }
  return Object.keys(visible).length > 0 ? visible : undefined;
}

// ── Allowed status transitions for creators ──
const ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  listed: ['hidden', 'retired'],
  hidden: ['listed', 'retired'],
};

// GET /v1/market/search
market.get('/search', async (c) => {
  const db = c.get('db');
  const rawParams = {
    q: c.req.query('q'),
    kind: c.req.query('kind'),
    risk_class: c.req.query('risk_class'),
    tag: c.req.query('tag'),
    sort: c.req.query('sort'),
    page: c.req.query('page'),
    per_page: c.req.query('per_page'),
  };

  // Validate and clamp pagination params via Zod schema
  const params = SearchParamsSchema.parse(rawParams);

  const result = await searchListings(db, params);

  // Collect all listing IDs for batch queries (avoids N+1)
  const listingIds = result.items.map((row) => row.listings.listing_id);

  // Batch fetch latest active versions, tags, and first preview per listing
  const [allVersions, allTags, allPreviews] =
    listingIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(packageVersions)
            .where(
              and(
                inArray(packageVersions.listing_id, listingIds),
                eq(packageVersions.status, 'active'),
              ),
            )
            .orderBy(desc(packageVersions.published_at)),
          db
            .select({ listing_id: listingTags.listing_id, tag: listingTags.tag })
            .from(listingTags)
            .where(inArray(listingTags.listing_id, listingIds)),
          db
            .select()
            .from(listingPreviews)
            .where(inArray(listingPreviews.listing_id, listingIds))
            .orderBy(listingPreviews.sort_order),
        ])
      : [[], [], []];

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

  const previewsMap = new Map<
    string,
    Array<{ kind: 'icon' | 'image' | 'video' | 'readme'; url: string; alt: string | null }>
  >();
  for (const p of allPreviews) {
    const preview = {
      kind: normalizePreviewKind(p.kind),
      url: p.url,
      alt: p.alt_text,
    };
    const previews = previewsMap.get(p.listing_id);
    if (previews) {
      previews.push(preview);
    } else {
      previewsMap.set(p.listing_id, [preview]);
    }
  }

  // Transform joined rows into ListingSummary shape (pure in-memory lookups).
  // First preview per listing is just the head of previewsMap (same allPreviews
  // order), so no second pass is needed.
  const items = result.items.map((row) => {
    const listing = row.listings;
    const creator = row.creators;
    const latestVersion = versionMap.get(listing.listing_id);
    const preview = previewsMap.get(listing.listing_id)?.[0];
    const manifest = publicManifestView(latestVersion?.manifest_json);

    return {
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
      ...(latestVersion ? { package_id: latestVersion.package_id } : {}),
      latest_version: latestVersion?.version ?? '0.0.0',
      ...(latestVersion
        ? {
            version: {
              package_id: latestVersion.package_id,
              package_version_id: latestVersion.package_version_id,
              version: latestVersion.version,
              runtime_range: latestVersion.runtime_range,
              schema_version: latestVersion.schema_version,
              environments: latestVersion.environments,
              risk_class: latestVersion.risk_class,
              published_at: latestVersion.published_at.toISOString(),
              changelog: latestVersion.changelog,
            },
            artifact: {
              package_version_id: latestVersion.package_version_id,
              artifact_url: latestVersion.artifact_url,
              artifact_sha256: latestVersion.artifact_sha256,
              artifact_size_bytes: latestVersion.artifact_size_bytes,
            },
          }
        : {}),
      rating: listing.rating_avg ?? 0,
      install_count: listing.install_count ?? 0,
      tags: tagMap.get(listing.listing_id) ?? [],
      requirements: {
        required_capabilities:
          (manifest?.requirements as Record<string, unknown>)?.required_capabilities ?? [],
        required_mcps: (manifest?.requirements as Record<string, unknown>)?.required_mcps ?? [],
        recommended_models:
          (manifest?.requirements as Record<string, unknown>)?.recommended_models ?? [],
      },
      permissions: {
        risk_class:
          (manifest?.permissions as Record<string, unknown>)?.risk_class ??
          latestVersion?.risk_class,
        declares_secrets:
          (manifest?.permissions as Record<string, unknown>)?.declares_secrets ?? false,
        filesystem_scope:
          (manifest?.permissions as Record<string, unknown>)?.filesystem_scope ?? 'none',
        network_scope: (manifest?.permissions as Record<string, unknown>)?.network_scope ?? 'none',
      },
      lineage: publicLineage(manifest?.lineage),
      ...(preview ? { preview } : {}),
      previews: previewsMap.get(listing.listing_id) ?? [],
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

  const row = await getVisibleListing(db, eq(listings.listing_id, listingId));
  if (!row) throw new HTTPException(404, { message: 'Listing not found' });
  return c.json(await buildListingDetail(db, row.listings, row.creators));
});

// GET /v1/market/listings/by-slug/:slug
market.get('/listings/by-slug/:slug', async (c) => {
  const db = c.get('db');
  const slug = c.req.param('slug');

  const row = await getVisibleListing(db, eq(listings.slug, slug));
  if (!row) throw new HTTPException(404, { message: 'Listing not found' });
  return c.json(await buildListingDetail(db, row.listings, row.creators));
});

// GET /v1/market/listings/:listingId/versions
market.get('/listings/:listingId/versions', async (c) => {
  const db = c.get('db');
  const listingId = c.req.param('listingId');

  await requireVisibleListingById(db, listingId);

  const versions = await db
    .select()
    .from(packageVersions)
    .where(and(eq(packageVersions.listing_id, listingId), eq(packageVersions.status, 'active')))
    .orderBy(desc(packageVersions.published_at));

  return c.json({
    listing_id: listingId,
    versions: versions.map((v) => ({
      package_id: v.package_id,
      package_version_id: v.package_version_id,
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

  await requireVisibleListingById(db, listingId);

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

// POST /v1/market/listings/:listingId/reports — report a listing
market.post('/listings/:listingId/reports', requireAuth, requireSessionAuth, async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');

  if (!userId) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  const listingId = c.req.param('listingId');
  const body = ReportCreateSchema.parse(await readPlatformJsonBody(c));

  await requireVisibleListingById(db, listingId);

  // Check for existing report from this user on this listing (rate limit: 1 per user per listing)
  const [existing] = await db
    .select({ flag_id: moderationFlags.flag_id })
    .from(moderationFlags)
    .where(
      and(
        eq(moderationFlags.target_type, 'listing'),
        eq(moderationFlags.target_id, listingId),
        eq(moderationFlags.reporter_user_id, userId),
      ),
    )
    .limit(1);

  if (existing) {
    throw new HTTPException(409, { message: 'You have already reported this listing' });
  }

  const rows = await db
    .insert(moderationFlags)
    .values({
      target_type: 'listing',
      target_id: listingId,
      reporter_user_id: userId,
      reason: body.reason,
      details: body.details ?? null,
      status: 'open',
    })
    .returning();
  const [flag] = rows;

  if (!flag) {
    throw new HTTPException(500, { message: 'Failed to create report' });
  }
  return c.json(
    {
      flag_id: flag.flag_id,
      target_type: flag.target_type,
      target_id: flag.target_id,
      reason: flag.reason,
      status: flag.status,
      created_at: flag.created_at.toISOString(),
    },
    201,
  );
});

// GET /v1/market/listings/:listingId/forks — listings that forked from this one
market.get('/listings/:listingId/forks', async (c) => {
  const db = c.get('db');
  const listingId = c.req.param('listingId');

  await requireVisibleListingById(db, listingId);

  // Find all package versions whose lineage points to this listing
  const lineageRows = await db
    .select({
      lineage_id: packageLineage.lineage_id,
      package_version_id: packageLineage.package_version_id,
      forked_from_version: packageLineage.forked_from_version,
    })
    .from(packageLineage)
    .where(eq(packageLineage.origin_listing_id, listingId));

  if (lineageRows.length === 0) {
    return c.json({ forks: [] });
  }

  // Get the corresponding listings via packageVersions
  const versionIds = lineageRows.map((r) => r.package_version_id);
  const forkVersions = await db
    .select()
    .from(packageVersions)
    .innerJoin(listings, eq(packageVersions.listing_id, listings.listing_id))
    .innerJoin(creators, eq(listings.creator_id, creators.creator_id))
    .where(
      and(
        inArray(packageVersions.package_version_id, versionIds),
        eq(packageVersions.status, 'active'),
        eq(listings.status, 'listed'),
      ),
    );

  const forks = forkVersions.map((row) => ({
    listingId: row.listings.listing_id,
    title: row.listings.title,
    slug: row.listings.slug,
    creatorHandle: row.creators.handle,
    version: row.package_versions.version,
    forkedAt: row.package_versions.published_at.toISOString(),
  }));

  return c.json({ forks });
});

// GET /v1/market/listings/:listingId/lineage — full lineage chain (ancestors + descendants)
market.get('/listings/:listingId/lineage', async (c) => {
  const db = c.get('db');
  const listingId = c.req.param('listingId');

  await requireVisibleListingById(db, listingId);

  // Ancestors: recursive CTE walks origin_listing_id chain upward (max 10 levels)
  const ancestorRows = await db.execute<{
    listing_id: string;
    title: string;
    slug: string;
    depth: number;
  }>(sql`
    WITH RECURSIVE lineage_chain AS (
      SELECT pl.origin_listing_id, 1 AS depth
      FROM ${packageLineage} pl
      INNER JOIN ${packageVersions} pv ON pl.package_version_id = pv.package_version_id
      WHERE pv.listing_id = ${listingId}
      LIMIT 1

      UNION ALL

      SELECT pl2.origin_listing_id, lc.depth + 1
      FROM lineage_chain lc
      INNER JOIN ${packageVersions} pv2 ON pv2.listing_id = lc.origin_listing_id
      INNER JOIN ${packageLineage} pl2 ON pl2.package_version_id = pv2.package_version_id
      WHERE lc.depth < 10 AND lc.origin_listing_id IS NOT NULL
    )
    SELECT l.listing_id, l.title, l.slug, lc.depth
    FROM lineage_chain lc
    INNER JOIN ${listings} l ON l.listing_id = lc.origin_listing_id
    WHERE lc.origin_listing_id IS NOT NULL AND l.status = 'listed'
    ORDER BY lc.depth
  `);

  // Deduplicate ancestors (CTE does not prevent cycles in data)
  const seenIds = new Set<string>();
  const dedupedAncestors = ancestorRows.filter((r) => {
    if (seenIds.has(r.listing_id)) return false;
    seenIds.add(r.listing_id);
    return true;
  });

  const ancestorIds = dedupedAncestors.map((r) => r.listing_id);
  const ancestorVersionMap = new Map<string, string>();
  if (ancestorIds.length > 0) {
    const versionRows = await db.execute<{ listing_id: string; version: string }>(sql`
      SELECT DISTINCT ON (pv.listing_id) pv.listing_id, pv.version
      FROM ${packageVersions} pv
      WHERE pv.listing_id = ANY(${ancestorIds}) AND pv.status = 'active'
      ORDER BY pv.listing_id, pv.published_at DESC
    `);
    for (const vr of versionRows) {
      ancestorVersionMap.set(vr.listing_id, vr.version);
    }
  }

  const ancestors = dedupedAncestors.map((r) => ({
    listingId: r.listing_id,
    title: r.title,
    slug: r.slug,
    version: ancestorVersionMap.get(r.listing_id) ?? '0.0.0',
  }));

  // Descendants: find all listings whose lineage points to this listing (1 level)
  const lineageRows = await db
    .select({ package_version_id: packageLineage.package_version_id })
    .from(packageLineage)
    .where(eq(packageLineage.origin_listing_id, listingId));

  const descendants: Array<{ listingId: string; title: string; slug: string; version: string }> =
    [];

  if (lineageRows.length > 0) {
    const versionIds = lineageRows.map((r) => r.package_version_id);
    const descRows = await db
      .select()
      .from(packageVersions)
      .innerJoin(listings, eq(packageVersions.listing_id, listings.listing_id))
      .where(
        and(
          inArray(packageVersions.package_version_id, versionIds),
          eq(packageVersions.status, 'active'),
          eq(listings.status, 'listed'),
        ),
      );

    for (const row of descRows) {
      descendants.push({
        listingId: row.listings.listing_id,
        title: row.listings.title,
        slug: row.listings.slug,
        version: row.package_versions.version,
      });
    }
  }

  return c.json({ ancestors, descendants });
});

// PATCH /v1/market/listings/:listingId/status — creator status management
market.patch(
  '/listings/:listingId/status',
  requireAuth,
  requireApiTokenScope('publish:write'),
  requireCreator,
  async (c) => {
    const db = c.get('db');
    const creatorId = getRequiredCreatorId(c);
    const { listingId } = c.req.param();
    const body = ListingStatusPatchSchema.parse(await readPlatformJsonBody(c));

    // Verify ownership: listing must belong to this creator
    const [listing] = await db
      .select({
        listing_id: listings.listing_id,
        creator_id: listings.creator_id,
        status: listings.status,
      })
      .from(listings)
      .where(eq(listings.listing_id, listingId))
      .limit(1);

    if (!listing) {
      throw new HTTPException(404, { message: 'Listing not found' });
    }

    if (creatorId !== listing.creator_id) {
      throw new HTTPException(403, {
        message: 'Only the listing creator can change listing status',
      });
    }

    // Validate state transition
    const allowed = ALLOWED_TRANSITIONS[listing.status];
    if (!allowed || !allowed.includes(body.status)) {
      throw new HTTPException(400, {
        message: `Cannot transition from '${listing.status}' to '${body.status}'. Allowed: ${allowed?.join(', ') ?? 'none'}`,
      });
    }

    const updatedRows = await db
      .update(listings)
      .set({ status: body.status, updated_at: new Date() })
      .where(
        and(
          eq(listings.listing_id, listingId),
          eq(listings.creator_id, creatorId),
          eq(listings.status, listing.status),
        ),
      )
      .returning({ listing_id: listings.listing_id });

    if (updatedRows.length === 0) {
      throw new HTTPException(409, { message: 'Listing state changed before status update' });
    }

    return c.json({ ok: true, listing_id: listingId, status: body.status });
  },
);

export { market };
