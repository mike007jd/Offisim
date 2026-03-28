/**
 * Auto-moderation service for the publishing workflow.
 * 1.0: validates manifest and auto-approves if valid.
 * Future: queue for human review, AI-assisted checks.
 */

import {
  listingTags,
  listings,
  moderationJobs,
  packageLineage,
  packageVersions,
  publishDrafts,
} from '@offisim/db-platform';
import { eq } from 'drizzle-orm';
import type { PlatformDb } from '../db.js';

export async function processModerationJob(db: PlatformDb, jobId: string): Promise<void> {
  const [job] = await db
    .select()
    .from(moderationJobs)
    .where(eq(moderationJobs.job_id, jobId))
    .limit(1);

  if (!job || job.status !== 'pending') return;

  const [draft] = await db
    .select()
    .from(publishDrafts)
    .where(eq(publishDrafts.draft_id, job.target_id))
    .limit(1);

  if (!draft) {
    await db
      .update(moderationJobs)
      .set({
        status: 'completed',
        result: { outcome: 'rejected', reason: 'Draft not found' },
        completed_at: new Date(),
      })
      .where(eq(moderationJobs.job_id, jobId));
    return;
  }

  // For 1.0: auto-approve if draft validation_state is 'valid'
  if (draft.validation_state !== 'valid') {
    await db
      .update(moderationJobs)
      .set({
        status: 'completed',
        result: { outcome: 'rejected', reason: 'Manifest not valid' },
        completed_at: new Date(),
      })
      .where(eq(moderationJobs.job_id, jobId));

    await db
      .update(publishDrafts)
      .set({ status: 'rejected', updated_at: new Date() })
      .where(eq(publishDrafts.draft_id, draft.draft_id));
    return;
  }

  const manifest = draft.manifest_json as DraftManifest;

  // Create or update listing
  let listingId = draft.listing_id;
  if (!listingId) {
    // New listing
    const slug = generateSlug(draft.title);
    const newListingRows = await db
      .insert(listings)
      .values({
        creator_id: draft.creator_id,
        slug,
        kind: draft.kind,
        title: draft.title,
        summary: draft.summary,
        description: manifest?.package?.summary ?? draft.summary,
        status: 'listed',
      })
      .returning();
    const [newListing] = newListingRows;

    if (!newListing) {
      throw new Error('Failed to create listing');
    }

    listingId = newListing.listing_id;
  } else {
    // Update existing listing
    await db
      .update(listings)
      .set({
        title: draft.title,
        summary: draft.summary,
        updated_at: new Date(),
      })
      .where(eq(listings.listing_id, listingId));
  }

  // Create package version
  const versionRows = await db
    .insert(packageVersions)
    .values({
      listing_id: listingId,
      package_id: manifest.package.id,
      version: manifest.package.version,
      manifest_json: manifest,
      runtime_range: manifest.compatibility.runtime_range,
      schema_version: manifest.compatibility.schema_version,
      environments: manifest.compatibility.supported_environments,
      risk_class: manifest.permissions.risk_class,
      artifact_url: draft.artifact_id ?? undefined,
      changelog: manifest.package.summary,
      status: 'active',
    })
    .returning();
  const [version] = versionRows;

  if (!version) {
    throw new Error('Failed to create package version');
  }

  const versionId = version.package_version_id;

  // Write lineage record if manifest contains lineage info
  const lineage = manifest.lineage as
    | { origin_listing_id?: string; origin_package_id?: string; forked_from_version?: string }
    | undefined;
  if (lineage?.origin_listing_id || lineage?.origin_package_id) {
    // Validate origin_listing_id exists if provided
    if (lineage.origin_listing_id) {
      const [originListing] = await db
        .select({ listing_id: listings.listing_id })
        .from(listings)
        .where(eq(listings.listing_id, lineage.origin_listing_id))
        .limit(1);
      if (!originListing) {
        // Reject — dangling lineage reference
        await db
          .update(moderationJobs)
          .set({
            status: 'completed',
            result: { outcome: 'rejected', reason: 'Lineage origin_listing_id does not exist' },
            completed_at: new Date(),
          })
          .where(eq(moderationJobs.job_id, jobId));
        await db
          .update(publishDrafts)
          .set({ status: 'rejected', updated_at: new Date() })
          .where(eq(publishDrafts.draft_id, draft.draft_id));
        return;
      }
    }

    await db.insert(packageLineage).values({
      package_version_id: versionId,
      origin_listing_id: lineage.origin_listing_id ?? null,
      origin_package_id: lineage.origin_package_id ?? null,
      forked_from_version: lineage.forked_from_version ?? null,
    });
  }

  // Update tags (batch insert)
  const tags: string[] = manifest.package.tags ?? [];
  if (Array.isArray(tags) && tags.length > 0) {
    await db
      .insert(listingTags)
      .values(tags.map((tag) => ({ listing_id: listingId, tag })))
      .onConflictDoNothing();
  }

  // Mark draft as approved, job as completed
  await db
    .update(publishDrafts)
    .set({ status: 'approved', listing_id: listingId, updated_at: new Date() })
    .where(eq(publishDrafts.draft_id, draft.draft_id));

  await db
    .update(moderationJobs)
    .set({
      status: 'completed',
      result: { outcome: 'approved', listing_id: listingId },
      completed_at: new Date(),
    })
    .where(eq(moderationJobs.job_id, jobId));
}

type DraftManifest = {
  package: {
    id: string;
    version: string;
    summary: string;
    tags?: string[];
  };
  compatibility: {
    runtime_range: string;
    schema_version: string;
    supported_environments: string[];
  };
  permissions: {
    risk_class: string;
  };
  lineage?: {
    origin_listing_id?: string;
    origin_package_id?: string;
    forked_from_version?: string;
  };
};

function generateSlug(title: string): string {
  return `${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)}-${Date.now().toString(36)}`;
}
