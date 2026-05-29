/**
 * Publishing workflow routes.
 * Handles draft creation, manifest upload, validation, submission,
 * and auto-moderation for the Offisim marketplace.
 */

import type { PackageManifest } from '@offisim/asset-schema';
import { creators, moderationJobs, packageVersions, publishDrafts } from '@offisim/db-platform';
import { and, desc, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { readJsonBodyWithLimit, readPlatformJsonBody } from '../lib/body-limit.js';
import {
  getRequiredCreatorId,
  requireAuth,
  requireCreator,
  requireApiTokenScope,
} from '../middleware/auth.js';
import { publishRateLimit } from '../middleware/rate-limit.js';
import {
  DraftCreateSchema,
  ManifestUploadSchema,
  SubmitDraftSchema,
  VALID_KINDS,
} from '../schemas/index.js';
import { MAX_ARTIFACT_BYTES } from '../services/artifacts.js';
import { processModerationJob } from '../services/moderation.js';
import { assertListingOwnedByCreator } from '../services/publish-ownership.js';
import { validateManifest } from '../services/validation.js';
import type { PlatformEnv } from '../types.js';

const publish = new Hono<PlatformEnv>();
const MAX_PUBLISH_MANIFEST_BODY_BYTES = Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4 + 1024 * 1024;
const ACTIVE_DRAFT_KIND_SET = new Set<string>(VALID_KINDS);

function isActiveDraftKind(kind: string): boolean {
  return ACTIVE_DRAFT_KIND_SET.has(kind);
}

function retiredDraftKindResponse(c: Context<PlatformEnv>, kind: string) {
  return c.json(
    {
      error: {
        code: 'RETIRED_DRAFT_KIND',
        message: `Draft kind "${kind}" is retired and cannot be published.`,
      },
    },
    410,
  );
}

// All publish routes require auth and are rate-limited
publish.use('/*', publishRateLimit);
publish.use('/*', requireAuth);
publish.use('/*', requireApiTokenScope('publish:write'));

// GET /v1/publish/me — registered before requireCreator because non-creators get { creator: null }
publish.get('/me', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId');

  if (!userId) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }

  const [creator] = await db.select().from(creators).where(eq(creators.user_id, userId)).limit(1);

  if (!creator) {
    return c.json({ creator: null });
  }

  return c.json({
    creator: {
      creator_id: creator.creator_id,
      handle: creator.handle,
      display_name: creator.display_name,
      bio: creator.bio,
      website_url: creator.website_url,
      verification_state: creator.verification_state,
      created_at: creator.created_at.toISOString(),
    },
  });
});

// Draft and submit routes require a creator profile
publish.use('/drafts/*', requireCreator);
publish.use('/submit', requireCreator);

// POST /v1/publish/drafts — create a new draft
publish.post('/drafts', async (c) => {
  const db = c.get('db');
  const creatorId = getRequiredCreatorId(c);
  const body = DraftCreateSchema.parse(await readPlatformJsonBody(c));
  if (body.listing_id) {
    await assertListingOwnedByCreator(db, body.listing_id, creatorId);
  }

  const rows = await db
    .insert(publishDrafts)
    .values({
      creator_id: creatorId,
      listing_id: body.listing_id ?? null,
      kind: body.kind,
      title: body.title,
      summary: body.summary ?? null,
      status: 'draft',
      validation_state: 'unknown',
    })
    .returning();
  const [draft] = rows;

  if (!draft) {
    throw new HTTPException(500, { message: 'Failed to create draft' });
  }

  return c.json(
    {
      draft_id: draft.draft_id,
      creator_id: draft.creator_id,
      listing_id: draft.listing_id,
      status: draft.status,
      validation_state: draft.validation_state,
      created_at: draft.created_at.toISOString(),
      updated_at: draft.updated_at.toISOString(),
    },
    201,
  );
});

// GET /v1/publish/drafts — list my drafts
publish.get('/drafts', async (c) => {
  const db = c.get('db');
  const creatorId = getRequiredCreatorId(c);
  const statusFilter = c.req.query('status') as
    | 'draft'
    | 'validated'
    | 'submitted'
    | 'approved'
    | 'rejected'
    | undefined;

  const whereClause = statusFilter
    ? and(eq(publishDrafts.creator_id, creatorId), eq(publishDrafts.status, statusFilter))
    : eq(publishDrafts.creator_id, creatorId);

  const drafts = await db
    .select()
    .from(publishDrafts)
    .where(whereClause)
    .orderBy(desc(publishDrafts.updated_at));
  const activeDrafts = drafts.filter((d) => isActiveDraftKind(d.kind));

  return c.json({
    drafts: activeDrafts.map((d) => ({
      draft_id: d.draft_id,
      creator_id: d.creator_id,
      listing_id: d.listing_id,
      kind: d.kind,
      title: d.title,
      summary: d.summary,
      status: d.status,
      validation_state: d.validation_state,
      created_at: d.created_at.toISOString(),
      updated_at: d.updated_at.toISOString(),
    })),
  });
});

// GET /v1/publish/drafts/:draftId — get draft status
publish.get('/drafts/:draftId', async (c) => {
  const db = c.get('db');
  const creatorId = getRequiredCreatorId(c);
  const draftId = c.req.param('draftId');

  const [draft] = await db
    .select()
    .from(publishDrafts)
    .where(and(eq(publishDrafts.draft_id, draftId), eq(publishDrafts.creator_id, creatorId)))
    .limit(1);

  if (!draft) throw new HTTPException(404, { message: 'Draft not found' });
  if (!isActiveDraftKind(draft.kind)) {
    return retiredDraftKindResponse(c, draft.kind);
  }

  return c.json({
    draft_id: draft.draft_id,
    creator_id: draft.creator_id,
    listing_id: draft.listing_id,
    kind: draft.kind,
    title: draft.title,
    summary: draft.summary,
    status: draft.status,
    validation_state: draft.validation_state,
    validation_report: draft.validation_report,
    manifest_json: draft.manifest_json,
    created_at: draft.created_at.toISOString(),
    updated_at: draft.updated_at.toISOString(),
  });
});

// DELETE /v1/publish/drafts/:draftId — delete a draft (only non-submitted drafts)
publish.delete('/drafts/:draftId', async (c) => {
  const db = c.get('db');
  const creatorId = getRequiredCreatorId(c);
  const draftId = c.req.param('draftId');

  const [draft] = await db
    .select()
    .from(publishDrafts)
    .where(and(eq(publishDrafts.draft_id, draftId), eq(publishDrafts.creator_id, creatorId)))
    .limit(1);

  if (!draft) throw new HTTPException(404, { message: 'Draft not found' });

  if (draft.status === 'submitted' || draft.status === 'approved') {
    throw new HTTPException(400, {
      message: `Cannot delete a draft with status "${draft.status}". Only drafts in "draft", "validated", or "rejected" status can be deleted.`,
    });
  }

  const deletedRows = await db
    .delete(publishDrafts)
    .where(
      and(
        eq(publishDrafts.draft_id, draftId),
        eq(publishDrafts.creator_id, creatorId),
        eq(publishDrafts.status, draft.status),
      ),
    )
    .returning({ draft_id: publishDrafts.draft_id });

  if (deletedRows.length === 0) {
    throw new HTTPException(409, { message: 'Draft state changed before deletion' });
  }

  return c.json({ deleted: true, draft_id: draftId });
});

// PUT /v1/publish/drafts/:draftId/manifest — attach manifest to draft
publish.put('/drafts/:draftId/manifest', async (c) => {
  const db = c.get('db');
  const creatorId = getRequiredCreatorId(c);
  const draftId = c.req.param('draftId');
  const body = ManifestUploadSchema.parse(
    await readJsonBodyWithLimit(c, MAX_PUBLISH_MANIFEST_BODY_BYTES),
  );

  const [draft] = await db
    .select()
    .from(publishDrafts)
    .where(and(eq(publishDrafts.draft_id, draftId), eq(publishDrafts.creator_id, creatorId)))
    .limit(1);

  if (!draft) throw new HTTPException(404, { message: 'Draft not found' });
  if (!isActiveDraftKind(draft.kind)) {
    return retiredDraftKindResponse(c, draft.kind);
  }
  if (draft.status === 'submitted' || draft.status === 'approved') {
    throw new HTTPException(400, {
      message: `Cannot update a draft with status "${draft.status}". Only drafts in "draft", "validated", or "rejected" status can be updated.`,
    });
  }
  if (draft.listing_id) {
    await assertListingOwnedByCreator(db, draft.listing_id, creatorId);
  }

  // Validate manifest
  const validation = validateManifest(body.manifest_json, body.artifact);

  const updateRows = await db
    .update(publishDrafts)
    .set({
      manifest_json: body.manifest_json,
      artifact_id: body.artifact?.external_url ?? null,
      validation_state: validation.valid ? 'valid' : 'invalid',
      validation_report: {
        errors: validation.errors,
        warnings: validation.warnings,
        artifact: validation.artifact ?? null,
      },
      status: 'draft',
      updated_at: new Date(),
    })
    .where(
      and(
        eq(publishDrafts.draft_id, draftId),
        eq(publishDrafts.creator_id, creatorId),
        eq(publishDrafts.status, draft.status),
      ),
    )
    .returning();
  const [updated] = updateRows;

  if (!updated) {
    throw new HTTPException(500, { message: 'Failed to update draft' });
  }

  if (!validation.valid) {
    return c.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Manifest validation failed',
          details: { errors: validation.errors, warnings: validation.warnings },
        },
      },
      400,
    );
  }

  return c.json({
    draft_id: updated.draft_id,
    creator_id: updated.creator_id,
    listing_id: updated.listing_id,
    validation_state: updated.validation_state,
    validation_report: updated.validation_report,
    status: updated.status,
    created_at: updated.created_at.toISOString(),
    updated_at: updated.updated_at.toISOString(),
  });
});

// POST /v1/publish/submit — submit draft for review
publish.post('/submit', async (c) => {
  const db = c.get('db');
  const creatorId = getRequiredCreatorId(c);
  const body = SubmitDraftSchema.parse(await readPlatformJsonBody(c));

  const [draft] = await db
    .select()
    .from(publishDrafts)
    .where(and(eq(publishDrafts.draft_id, body.draft_id), eq(publishDrafts.creator_id, creatorId)))
    .limit(1);

  if (!draft) throw new HTTPException(404, { message: 'Draft not found' });
  if (!isActiveDraftKind(draft.kind)) {
    return retiredDraftKindResponse(c, draft.kind);
  }
  if (draft.status === 'submitted')
    throw new HTTPException(400, { message: 'Draft already submitted' });
  if (draft.validation_state !== 'valid') {
    throw new HTTPException(400, { message: 'Draft manifest must be valid before submission' });
  }
  if (draft.listing_id) {
    await assertListingOwnedByCreator(db, draft.listing_id, creatorId);
    const manifest = draft.manifest_json as PackageManifest;
    const [existingVersion] = await db
      .select({ package_version_id: packageVersions.package_version_id })
      .from(packageVersions)
      .where(
        and(
          eq(packageVersions.listing_id, draft.listing_id),
          eq(packageVersions.package_id, manifest.package.id),
          eq(packageVersions.version, manifest.package.version),
        ),
      )
      .limit(1);
    if (existingVersion) {
      return duplicatePackageVersionResponse(c);
    }
  }

  // Update draft status
  const submittedRows = await db
    .update(publishDrafts)
    .set({ status: 'submitted', updated_at: new Date() })
    .where(
      and(
        eq(publishDrafts.draft_id, draft.draft_id),
        eq(publishDrafts.creator_id, creatorId),
        eq(publishDrafts.status, draft.status),
        eq(publishDrafts.validation_state, 'valid'),
      ),
    )
    .returning({ draft_id: publishDrafts.draft_id });

  if (submittedRows.length === 0) {
    throw new HTTPException(409, { message: 'Draft state changed before submission' });
  }

  // Create moderation job
  const jobRows = await db
    .insert(moderationJobs)
    .values({
      target_type: 'publish_draft',
      target_id: draft.draft_id,
      job_kind: 'publish_review',
      status: 'pending',
    })
    .returning();
  const [job] = jobRows;

  if (!job) {
    throw new HTTPException(500, { message: 'Failed to create moderation job' });
  }

  // 1.0: auto-process moderation (synchronous for simplicity)
  await processModerationJob(db, job.job_id);

  // Re-fetch job for response
  const [updatedJob] = await db
    .select()
    .from(moderationJobs)
    .where(eq(moderationJobs.job_id, job.job_id))
    .limit(1);

  if (isDuplicatePackageVersionRejection(updatedJob?.result)) {
    return duplicatePackageVersionResponse(c);
  }

  return c.json(
    {
      draft_id: draft.draft_id,
      moderation_job_id: job.job_id,
      status: updatedJob?.status === 'completed' ? 'queued' : 'pending_review',
    },
    202,
  );
});

function duplicatePackageVersionResponse(c: Context<PlatformEnv>) {
  return c.json(
    {
      error: {
        code: 'DUPLICATE_PACKAGE_VERSION',
        message: 'This listing already has an active package with the same package id and version.',
      },
    },
    409,
  );
}

function isDuplicatePackageVersionRejection(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const raw = result as Record<string, unknown>;
  return raw.outcome === 'rejected' && raw.code === 'duplicate_package_version';
}

export { publish };
