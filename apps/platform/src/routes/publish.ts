/**
 * Publishing workflow routes.
 * Handles draft creation, manifest upload, validation, submission,
 * and auto-moderation for the Offisim marketplace.
 */

import { creators, moderationJobs, publishDrafts } from '@offisim/db-platform';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getRequiredCreatorId, requireAuth, requireCreator } from '../middleware/auth.js';
import { publishRateLimit } from '../middleware/rate-limit.js';
import { DraftCreateSchema, ManifestUploadSchema, SubmitDraftSchema } from '../schemas/index.js';
import { processModerationJob } from '../services/moderation.js';
import { validateManifest } from '../services/validation.js';
import type { PlatformEnv } from '../types.js';

const publish = new Hono<PlatformEnv>();

// All publish routes require auth and are rate-limited
publish.use('/*', publishRateLimit);
publish.use('/*', requireAuth);

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
  const body = DraftCreateSchema.parse(await c.req.json());

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

  return c.json({
    drafts: drafts.map((d) => ({
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

  await db.delete(publishDrafts).where(eq(publishDrafts.draft_id, draftId));

  return c.json({ deleted: true, draft_id: draftId });
});

// PUT /v1/publish/drafts/:draftId/manifest — attach manifest to draft
publish.put('/drafts/:draftId/manifest', async (c) => {
  const db = c.get('db');
  const creatorId = getRequiredCreatorId(c);
  const draftId = c.req.param('draftId');
  const body = ManifestUploadSchema.parse(await c.req.json());

  const [draft] = await db
    .select()
    .from(publishDrafts)
    .where(and(eq(publishDrafts.draft_id, draftId), eq(publishDrafts.creator_id, creatorId)))
    .limit(1);

  if (!draft) throw new HTTPException(404, { message: 'Draft not found' });
  if (draft.status === 'submitted')
    throw new HTTPException(400, { message: 'Draft already submitted' });

  // Validate manifest
  const validation = validateManifest(body.manifest_json);

  const updateRows = await db
    .update(publishDrafts)
    .set({
      manifest_json: body.manifest_json,
      artifact_id: body.artifact?.external_url ?? null,
      validation_state: validation.valid ? 'valid' : 'invalid',
      validation_report: { errors: validation.errors, warnings: validation.warnings },
      status: 'draft',
      updated_at: new Date(),
    })
    .where(eq(publishDrafts.draft_id, draftId))
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
  const body = SubmitDraftSchema.parse(await c.req.json());

  const [draft] = await db
    .select()
    .from(publishDrafts)
    .where(and(eq(publishDrafts.draft_id, body.draft_id), eq(publishDrafts.creator_id, creatorId)))
    .limit(1);

  if (!draft) throw new HTTPException(404, { message: 'Draft not found' });
  if (draft.status === 'submitted')
    throw new HTTPException(400, { message: 'Draft already submitted' });
  if (draft.validation_state !== 'valid') {
    throw new HTTPException(400, { message: 'Draft manifest must be valid before submission' });
  }

  // Update draft status
  await db
    .update(publishDrafts)
    .set({ status: 'submitted', updated_at: new Date() })
    .where(eq(publishDrafts.draft_id, draft.draft_id));

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

  return c.json(
    {
      draft_id: draft.draft_id,
      moderation_job_id: job.job_id,
      status: updatedJob?.status === 'completed' ? 'queued' : 'pending_review',
    },
    202,
  );
});

export { publish };
