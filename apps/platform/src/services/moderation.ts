/**
 * Auto-moderation service for the publishing workflow.
 * 1.0: validates manifest and auto-approves if valid.
 * Future: queue for human review, AI-assisted checks.
 */

import type { PackageManifest } from '@offisim/asset-schema';
import {
  listingTags,
  listings,
  moderationJobs,
  packageLineage,
  packageVersions,
  publishDrafts,
} from '@offisim/db-platform';
import { and, eq } from 'drizzle-orm';
import type { PlatformDb } from '../db.js';
import {
  persistRegistryArtifact,
  registryArtifactPublicUrl,
  removeRegistryArtifact,
} from './artifacts.js';

export async function processModerationJob(db: PlatformDb, jobId: string): Promise<void> {
  const [job] = await db
    .select()
    .from(moderationJobs)
    .where(
      and(
        eq(moderationJobs.job_id, jobId),
        eq(moderationJobs.status, 'pending'),
        eq(moderationJobs.target_type, 'publish_draft'),
        eq(moderationJobs.job_kind, 'publish_review'),
      ),
    )
    .limit(1);

  if (!job) return;
  const pendingJobPredicate = and(
    eq(moderationJobs.job_id, jobId),
    eq(moderationJobs.status, 'pending'),
  );

  const [draft] = await db
    .select()
    .from(publishDrafts)
    .where(and(eq(publishDrafts.draft_id, job.target_id), eq(publishDrafts.status, 'submitted')))
    .limit(1);

  if (!draft) {
    await db
      .update(moderationJobs)
      .set({
        status: 'completed',
        result: { outcome: 'rejected', reason: 'Draft not found' },
        completed_at: new Date(),
      })
      .where(pendingJobPredicate);
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
      .where(pendingJobPredicate);

    await db
      .update(publishDrafts)
      .set({ status: 'rejected', updated_at: new Date() })
      .where(and(eq(publishDrafts.draft_id, draft.draft_id), eq(publishDrafts.status, 'submitted')));
    return;
  }

  const manifest = draft.manifest_json as PackageManifest;
  const artifact = extractArtifactValidation(draft.validation_report);
  if (!artifact) {
    await db
      .update(moderationJobs)
      .set({
        status: 'completed',
        result: { outcome: 'rejected', reason: 'Artifact integrity metadata missing' },
        completed_at: new Date(),
      })
      .where(pendingJobPredicate);
    await db
      .update(publishDrafts)
      .set({ status: 'rejected', updated_at: new Date() })
      .where(and(eq(publishDrafts.draft_id, draft.draft_id), eq(publishDrafts.status, 'submitted')));
    return;
  }

  // Validate lineage BEFORE creating any records — reject early on dangling references
  const lineage = manifest.lineage as
    | { origin_listing_id?: string; origin_package_id?: string; forked_from_version?: string }
    | undefined;
  if (lineage?.origin_listing_id) {
    const [originListing] = await db
      .select({ listing_id: listings.listing_id })
      .from(listings)
      .where(and(eq(listings.listing_id, lineage.origin_listing_id), eq(listings.status, 'listed')))
      .limit(1);
    if (!originListing) {
      await db
        .update(moderationJobs)
        .set({
          status: 'completed',
          result: { outcome: 'rejected', reason: 'Lineage origin_listing_id is not public' },
          completed_at: new Date(),
        })
        .where(pendingJobPredicate);
      await db
        .update(publishDrafts)
        .set({ status: 'rejected', updated_at: new Date() })
        .where(and(eq(publishDrafts.draft_id, draft.draft_id), eq(publishDrafts.status, 'submitted')));
      return;
    }
  }

  // FS-after-DB sequencing:
  //   1. tx commits all DB rows (listing / packageVersions(artifact_url=null) /
  //      lineage / tags / draft.approved / job.completed)
  //   2. post-commit: write artifact bytes to disk
  //   3. post-commit: update packageVersions.artifact_url to public URL
  //   4. on any post-commit failure: hard-delete the row, revert draft,
  //      mark job rejected, best-effort unlink the FS file
  //
  // The version id flows out of the tx callback for cleanup to use.
  let committedVersionId: string;
  try {
    committedVersionId = await db.transaction(async (tx) => {
      // Create or update listing
      let listingId = draft.listing_id;
      if (!listingId) {
        // New listing
        const slug = generateSlug(draft.title);
        const newListingRows = await tx
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
        const updatedListings = await tx
          .update(listings)
          .set({
            title: draft.title,
            summary: draft.summary,
            updated_at: new Date(),
          })
          .where(and(eq(listings.listing_id, listingId), eq(listings.creator_id, draft.creator_id)))
          .returning({ listing_id: listings.listing_id });
        if (updatedListings.length === 0) {
          throw new Error('Listing ownership check failed during moderation');
        }
      }

      // Create package version
      const versionRows = await tx
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
          artifact_url: null,
          artifact_sha256: artifact.sha256,
          artifact_size_bytes: artifact.size_bytes,
          changelog: manifest.package.summary,
          status: 'active',
        })
        .returning();
      const [version] = versionRows;

      if (!version) {
        throw new Error('Failed to create package version');
      }

      const versionId = version.package_version_id;
      // Defer FS write until after tx commit. versionId returns to caller
      // for the post-commit phases below.

      // Write lineage record if manifest contains lineage info
      if (lineage?.origin_listing_id || lineage?.origin_package_id) {
        await tx.insert(packageLineage).values({
          package_version_id: versionId,
          origin_listing_id: lineage.origin_listing_id ?? null,
          origin_package_id: lineage.origin_package_id ?? null,
          forked_from_version: lineage.forked_from_version ?? null,
        });
      }

      // Update tags (batch insert, capped at 20)
      const tags: string[] = (manifest.package.tags ?? []).slice(0, 20);
      if (Array.isArray(tags) && tags.length > 0) {
        await tx
          .insert(listingTags)
          .values(tags.map((tag) => ({ listing_id: listingId, tag })))
          .onConflictDoNothing();
      }

      // Mark draft as approved, job as completed
      const approvedDraftRows = await tx
        .update(publishDrafts)
        .set({ status: 'approved', listing_id: listingId, updated_at: new Date() })
        .where(
          and(
            eq(publishDrafts.draft_id, draft.draft_id),
            eq(publishDrafts.creator_id, draft.creator_id),
            eq(publishDrafts.status, 'submitted'),
          ),
        )
        .returning({ draft_id: publishDrafts.draft_id });
      if (approvedDraftRows.length === 0) {
        throw new Error('Draft state changed during moderation approval');
      }

      await tx
        .update(moderationJobs)
        .set({
          status: 'completed',
          result: { outcome: 'approved', listing_id: listingId },
          completed_at: new Date(),
        })
        .where(pendingJobPredicate);
      return versionId;
    });
  } catch (err) {
    if (!isDuplicatePackageVersionDbError(err)) {
      throw err;
    }
    await db
      .update(moderationJobs)
      .set({
        status: 'completed',
        result: {
          outcome: 'rejected',
          code: 'duplicate_package_version',
          reason: 'Duplicate package version for this listing',
        },
        completed_at: new Date(),
      })
      .where(pendingJobPredicate);
    await db
      .update(publishDrafts)
      .set({ status: 'draft', updated_at: new Date() })
      .where(and(eq(publishDrafts.draft_id, draft.draft_id), eq(publishDrafts.status, 'submitted')));
    return;
  }

  // Phase 3: persist artifact bytes to disk now that DB is committed.
  // Phase 4: stamp the public URL onto packageVersions in a second DB write.
  try {
    const persistedArtifact = await persistRegistryArtifact(
      committedVersionId,
      artifact.registry_bytes_base64,
    );
    if (
      persistedArtifact.sha256 !== artifact.sha256 ||
      persistedArtifact.size_bytes !== artifact.size_bytes
    ) {
      throw new Error('Artifact metadata changed before persistence');
    }
    const artifactUrl = registryArtifactPublicUrl(committedVersionId);
    await db
      .update(packageVersions)
      .set({ artifact_url: artifactUrl })
      .where(eq(packageVersions.package_version_id, committedVersionId));
  } catch (fsErr) {
    // Compensating rollback: delete the version row, revert draft state,
    // mark moderation job rejected, best-effort unlink any partial FS file.
    await removeRegistryArtifact(committedVersionId);
    try {
      await db
        .delete(packageVersions)
        .where(eq(packageVersions.package_version_id, committedVersionId));
    } catch {
      /* version cleanup is best-effort */
    }
    await db
      .update(publishDrafts)
      .set({ status: 'submitted', updated_at: new Date() })
      .where(eq(publishDrafts.draft_id, draft.draft_id));
    await db
      .update(moderationJobs)
      .set({
        status: 'completed',
        result: {
          outcome: 'rejected',
          code: 'artifact_persistence_failed',
          reason: fsErr instanceof Error ? fsErr.message : 'Failed to persist artifact bytes',
        },
        completed_at: new Date(),
      })
      .where(pendingJobPredicate);
    throw fsErr;
  }
}

function extractArtifactValidation(report: unknown): {
  sha256: string;
  size_bytes: number;
  external_url: string | null;
  registry_bytes_base64: string;
} | null {
  if (!report || typeof report !== 'object') return null;
  const artifact = (report as { artifact?: unknown }).artifact;
  if (!artifact || typeof artifact !== 'object') return null;
  const raw = artifact as Record<string, unknown>;
  if (typeof raw.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.sha256)) return null;
  if (raw.publisher_sha256 !== raw.sha256) return null;
  if (raw.platform_sha256 !== raw.sha256) return null;
  if (!Number.isInteger(raw.size_bytes) || Number(raw.size_bytes) <= 0) return null;
  if (raw.publisher_size_bytes !== raw.size_bytes) return null;
  if (raw.platform_size_bytes !== raw.size_bytes) return null;
  if (
    raw.manifest_sha256 !== undefined &&
    (typeof raw.manifest_sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(raw.manifest_sha256))
  ) {
    return null;
  }
  if (
    raw.manifest_size_bytes !== undefined &&
    (!Number.isInteger(raw.manifest_size_bytes) || Number(raw.manifest_size_bytes) <= 0)
  ) {
    return null;
  }
  if (typeof raw.registry_bytes_base64 !== 'string' || !raw.registry_bytes_base64.trim())
    return null;
  return {
    sha256: raw.sha256.toLowerCase(),
    size_bytes: Number(raw.size_bytes),
    external_url: typeof raw.external_url === 'string' ? raw.external_url : null,
    registry_bytes_base64: raw.registry_bytes_base64,
  };
}

function isDuplicatePackageVersionDbError(err: unknown): boolean {
  const queue: unknown[] = [err];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    const raw = current as Record<string, unknown>;
    if (
      raw.code === '23505' &&
      String(raw.constraint ?? '').includes('package_versions_listing_package_version_unique')
    ) {
      return true;
    }
    if (raw.cause) queue.push(raw.cause);
  }
  return false;
}

function generateSlug(title: string): string {
  return `${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)}-${crypto.randomUUID().slice(0, 12)}`;
}
