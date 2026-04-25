import {
  creators,
  listingPreviews,
  listingTags,
  listings,
  packageVersions,
  users,
} from '@offisim/db-platform';
import { and, eq } from 'drizzle-orm';
import type { PlatformDb } from '../db.js';
import { setSeededArtifact } from './artifact-store.js';
import { buildSeedArtifact } from './package-builder.js';
import { OFFICIAL_PAYLOADS } from './payloads/index.js';
import type { SeedBuildResult } from './types.js';

const OFFISIM_CREATOR_HANDLE = 'offisim';
const OFFISIM_DISPLAY_NAME = 'Offisim';
const OFFISIM_USER_EMAIL = 'official-seed@offisim.local';
const OFFISIM_USER_AUTH_PROVIDER = 'system';
const OFFISIM_USER_AUTH_SUBJECT = 'offisim-official-seed';

export interface SeedOptions {
  /**
   * Absolute base URL used to build `artifact_url` for seeded listings
   * (e.g. `http://localhost:4100`). The browser-side install flow fetches
   * from this URL directly, so it must be reachable by the Market UI.
   */
  readonly baseUrl: string;
}

function buildAll(): SeedBuildResult[] {
  const built: SeedBuildResult[] = [];
  for (const payload of OFFICIAL_PAYLOADS) {
    try {
      built.push(buildSeedArtifact(payload));
    } catch (err) {
      console.warn(
        `[seed] skipping payload '${payload.slug}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return built;
}

async function populateArtifactCacheForExistingCreator(
  db: PlatformDb,
  creatorId: string,
  built: readonly SeedBuildResult[],
): Promise<number> {
  let matched = 0;
  for (const entry of built) {
    const [listingRow] = await db
      .select({ listing_id: listings.listing_id })
      .from(listings)
      .where(and(eq(listings.creator_id, creatorId), eq(listings.slug, entry.payload.slug)))
      .limit(1);
    if (!listingRow) continue;

    const [versionRow] = await db
      .select({ package_version_id: packageVersions.package_version_id })
      .from(packageVersions)
      .where(
        and(
          eq(packageVersions.listing_id, listingRow.listing_id),
          eq(packageVersions.package_id, entry.payload.package_id),
          eq(packageVersions.version, entry.payload.version),
        ),
      )
      .limit(1);
    if (!versionRow) continue;

    setSeededArtifact(versionRow.package_version_id, entry.zipBytes);
    matched += 1;
  }
  return matched;
}

async function ensureOfficialUserId(db: PlatformDb): Promise<string> {
  const [existing] = await db
    .select({ user_id: users.user_id })
    .from(users)
    .where(eq(users.email, OFFISIM_USER_EMAIL))
    .limit(1);
  if (existing) return existing.user_id;

  const [created] = await db
    .insert(users)
    .values({
      email: OFFISIM_USER_EMAIL,
      display_name: OFFISIM_DISPLAY_NAME,
      auth_provider: OFFISIM_USER_AUTH_PROVIDER,
      auth_subject: OFFISIM_USER_AUTH_SUBJECT,
    })
    .returning({ user_id: users.user_id });
  if (!created) {
    throw new Error('Failed to insert official seed user row');
  }
  return created.user_id;
}

async function insertOneListing(
  tx: Parameters<Parameters<PlatformDb['transaction']>[0]>[0],
  creatorId: string,
  baseUrl: string,
  entry: SeedBuildResult,
): Promise<{ listing_id: string; package_version_id: string }> {
  const payload = entry.payload;

  const [listingRow] = await tx
    .insert(listings)
    .values({
      creator_id: creatorId,
      slug: payload.slug,
      kind: payload.kind,
      title: payload.title,
      summary: payload.summary,
      description: payload.description,
      status: 'listed',
    })
    .returning({ listing_id: listings.listing_id });
  if (!listingRow) {
    throw new Error(`Failed to insert listing for '${payload.slug}'`);
  }

  // Build artifact URL from a deterministic placeholder first, then update
  // after we know the generated package_version_id. Keeping it on the same
  // INSERT round-trip would require knowing the uuid ahead of time.
  const [versionRow] = await tx
    .insert(packageVersions)
    .values({
      listing_id: listingRow.listing_id,
      package_id: payload.package_id,
      version: payload.version,
      manifest_json: entry.manifest,
      runtime_range: payload.runtime_range,
      schema_version: payload.schema_version,
      environments: payload.supported_environments,
      risk_class: payload.risk_class,
      artifact_url: null,
      artifact_sha256: entry.packageSha256,
      artifact_size_bytes: entry.sizeBytes,
      status: 'active',
    })
    .returning({ package_version_id: packageVersions.package_version_id });
  if (!versionRow) {
    throw new Error(`Failed to insert version for '${payload.slug}'`);
  }

  await tx
    .update(packageVersions)
    .set({
      artifact_url: `${baseUrl}/v1/install/artifacts/${versionRow.package_version_id}`,
    })
    .where(eq(packageVersions.package_version_id, versionRow.package_version_id));

  for (const tag of payload.tags) {
    await tx.insert(listingTags).values({ listing_id: listingRow.listing_id, tag });
  }

  for (const [i, preview] of payload.previews.entries()) {
    await tx.insert(listingPreviews).values({
      listing_id: listingRow.listing_id,
      kind: preview.kind,
      url: preview.url,
      alt_text: preview.alt_text ?? null,
      sort_order: i,
    });
  }

  return { listing_id: listingRow.listing_id, package_version_id: versionRow.package_version_id };
}

/**
 * Ensure the Offisim official creator exists and one listing per AssetKind
 * is visible in Market. Idempotent on `creators.handle = 'offisim'` — if the
 * creator already exists, no rows are written; the artifact cache is still
 * rebuilt from current payloads so installs work after a restart.
 *
 * Fail-soft: any thrown error is logged and swallowed so platform startup
 * continues. The caller still sees successful startup even when the DB is
 * transiently unavailable.
 */
export async function seedOfficialResources(
  db: PlatformDb,
  options: SeedOptions,
): Promise<void> {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  try {
    const built = buildAll();
    if (built.length === 0) {
      console.warn('[seed] no valid payloads — nothing to seed');
      return;
    }

    const [existingCreator] = await db
      .select({ creator_id: creators.creator_id })
      .from(creators)
      .where(eq(creators.handle, OFFISIM_CREATOR_HANDLE))
      .limit(1);

    if (existingCreator) {
      const matched = await populateArtifactCacheForExistingCreator(
        db,
        existingCreator.creator_id,
        built,
      );
      console.log(
        `[seed] Offisim creator already exists — rebuilt in-memory artifacts for ${matched}/${built.length} seeded listings`,
      );
      return;
    }

    const userId = await ensureOfficialUserId(db);

    const inserted = await db.transaction(async (tx) => {
      const [creatorRow] = await tx
        .insert(creators)
        .values({
          user_id: userId,
          handle: OFFISIM_CREATOR_HANDLE,
          display_name: OFFISIM_DISPLAY_NAME,
          bio: 'Official Offisim sample content seeded at platform boot.',
          verification_state: 'verified',
        })
        .returning({ creator_id: creators.creator_id });
      if (!creatorRow) {
        throw new Error('Failed to insert Offisim creator row');
      }

      const perVersionId: Array<{ package_version_id: string; bytes: Uint8Array }> = [];
      for (const entry of built) {
        const { package_version_id } = await insertOneListing(
          tx,
          creatorRow.creator_id,
          baseUrl,
          entry,
        );
        perVersionId.push({ package_version_id, bytes: entry.zipBytes });
      }
      return perVersionId;
    });

    for (const row of inserted) {
      setSeededArtifact(row.package_version_id, row.bytes);
    }

    console.log(
      `[seed] inserted Offisim creator + ${inserted.length} official listings (kinds: ${built.map((b) => b.payload.kind).join(', ')})`,
    );
  } catch (err) {
    console.warn(
      '[seed] official seed batch failed — startup continuing:',
      err instanceof Error ? err.message : err,
    );
  }
}
