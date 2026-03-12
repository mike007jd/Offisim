/**
 * Publishing workflow routes.
 * Handles draft creation, manifest upload, validation, submission,
 * and auto-moderation for the AICS marketplace.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { eq, and, desc } from 'drizzle-orm';
import { publishDrafts, creators, moderationJobs } from '@aics/db-platform';
import { requireAuth } from '../middleware/auth.js';
import { validateManifest } from '../services/validation.js';
import { processModerationJob } from '../services/moderation.js';
import type { PlatformEnv } from '../types.js';

const publish = new Hono<PlatformEnv>();

// All publish routes require auth
publish.use('/*', requireAuth);

// POST /v1/publish/drafts — create a new draft
publish.post('/drafts', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId')!;
  const body = await c.req.json<{
    kind: string;
    listing_id?: string;
    title: string;
    summary?: string;
  }>();

  if (!body.kind || !body.title) {
    throw new HTTPException(400, { message: 'kind and title are required' });
  }

  // Get creator for this user
  const [creator] = await db
    .select()
    .from(creators)
    .where(eq(creators.user_id, userId))
    .limit(1);

  if (!creator) {
    throw new HTTPException(403, { message: 'User is not a registered creator. Create a creator profile first.' });
  }

  const rows = await db
    .insert(publishDrafts)
    .values({
      creator_id: creator.creator_id,
      listing_id: body.listing_id ?? null,
      kind: body.kind,
      title: body.title,
      summary: body.summary ?? null,
      status: 'draft',
      validation_state: 'unknown',
    })
    .returning();
  const draft = rows[0]!;

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
  const userId = c.get('userId')!;

  const [creator] = await db
    .select()
    .from(creators)
    .where(eq(creators.user_id, userId))
    .limit(1);

  if (!creator) {
    throw new HTTPException(403, { message: 'Not a creator' });
  }

  const drafts = await db
    .select()
    .from(publishDrafts)
    .where(eq(publishDrafts.creator_id, creator.creator_id))
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
  const userId = c.get('userId')!;
  const draftId = c.req.param('draftId');

  const [creator] = await db
    .select()
    .from(creators)
    .where(eq(creators.user_id, userId))
    .limit(1);

  if (!creator) throw new HTTPException(403, { message: 'Not a creator' });

  const [draft] = await db
    .select()
    .from(publishDrafts)
    .where(and(eq(publishDrafts.draft_id, draftId), eq(publishDrafts.creator_id, creator.creator_id)))
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

// PUT /v1/publish/drafts/:draftId/manifest — attach manifest to draft
publish.put('/drafts/:draftId/manifest', async (c) => {
  const db = c.get('db');
  const userId = c.get('userId')!;
  const draftId = c.req.param('draftId');
  const body = await c.req.json<{
    manifest_json: Record<string, unknown>;
    artifact?: {
      external_url?: string;
      sha256?: string;
      size_bytes?: number;
    };
  }>();

  // Verify draft exists and belongs to this user's creator
  const [creator] = await db.select().from(creators).where(eq(creators.user_id, userId)).limit(1);
  if (!creator) throw new HTTPException(403, { message: 'Not a creator' });

  const [draft] = await db
    .select()
    .from(publishDrafts)
    .where(and(eq(publishDrafts.draft_id, draftId), eq(publishDrafts.creator_id, creator.creator_id)))
    .limit(1);

  if (!draft) throw new HTTPException(404, { message: 'Draft not found' });
  if (draft.status === 'submitted') throw new HTTPException(400, { message: 'Draft already submitted' });

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
  const updated = updateRows[0]!;

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
  const userId = c.get('userId')!;
  const body = await c.req.json<{ draft_id: string; submit_message?: string }>();

  if (!body.draft_id) throw new HTTPException(400, { message: 'draft_id is required' });

  const [creator] = await db.select().from(creators).where(eq(creators.user_id, userId)).limit(1);
  if (!creator) throw new HTTPException(403, { message: 'Not a creator' });

  const [draft] = await db
    .select()
    .from(publishDrafts)
    .where(and(eq(publishDrafts.draft_id, body.draft_id), eq(publishDrafts.creator_id, creator.creator_id)))
    .limit(1);

  if (!draft) throw new HTTPException(404, { message: 'Draft not found' });
  if (draft.status === 'submitted') throw new HTTPException(400, { message: 'Draft already submitted' });
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
  const job = jobRows[0]!;

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
