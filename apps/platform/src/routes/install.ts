/**
 * Install-support routes for the platform API.
 *
 * These are NOT the local-scope install endpoints (resolve, file-import, etc.)
 * which live in the local runtime (desktop/web via install-core).
 *
 * Platform provides:
 * 1. POST /receipts — record a successful install, increment listing install_count
 * 2. GET /download/:versionId — redirect to artifact download URL
 */

import { installReceipts, listings, packageVersions } from '@aics/db-platform';
import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { installRateLimit } from '../middleware/rate-limit.js';
import { InstallReceiptSchema } from '../schemas/index.js';
import type { PlatformEnv } from '../types.js';

const installRoute = new Hono<PlatformEnv>();

/**
 * POST /v1/install/receipts — Record an install receipt.
 *
 * Called by the local runtime after a successful install to:
 * 1. Create an install_receipt record
 * 2. Increment the listing's install_count
 * 3. Link the receipt to the user's library entry (if exists)
 */
installRoute.post('/receipts', installRateLimit, requireAuth, async (c) => {
  const db = c.get('db');
  const userId = c.get('userId')!;
  const body = InstallReceiptSchema.parse(await c.req.json());

  // Generate a receipt ID (deterministic for idempotency: user + listing + version)
  const receiptId = `rcpt_${userId}_${body.listing_id}_${body.package_version_id}`;

  // Upsert receipt (idempotent — re-installing same version is a no-op)
  await db
    .insert(installReceipts)
    .values({
      install_receipt_id: receiptId,
      user_id: userId,
      listing_id: body.listing_id,
      package_version_id: body.package_version_id,
      install_source: body.install_source,
    })
    .onConflictDoNothing();

  // Increment install_count on the listing
  await db
    .update(listings)
    .set({
      install_count: sql`COALESCE(${listings.install_count}, 0) + 1`,
    })
    .where(eq(listings.listing_id, body.listing_id));

  return c.json({
    install_receipt_id: receiptId,
    listing_id: body.listing_id,
    package_version_id: body.package_version_id,
  });
});

/**
 * GET /v1/install/download/:versionId — Get artifact download URL.
 *
 * Returns the artifact URL + SHA256 for the given package version.
 * The local runtime uses this to download the .aicspkg file.
 * No auth required — artifacts are public (same as npm/crates.io).
 */
installRoute.get('/download/:versionId', async (c) => {
  const db = c.get('db');
  const versionId = c.req.param('versionId');

  const [version] = await db
    .select({
      package_version_id: packageVersions.package_version_id,
      artifact_url: packageVersions.artifact_url,
      artifact_sha256: packageVersions.artifact_sha256,
      artifact_size_bytes: packageVersions.artifact_size_bytes,
    })
    .from(packageVersions)
    .where(eq(packageVersions.package_version_id, versionId))
    .limit(1);

  if (!version) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Package version not found' } }, 404);
  }

  if (!version.artifact_url) {
    return c.json(
      { error: { code: 'NO_ARTIFACT', message: 'No artifact available for this version' } },
      404,
    );
  }

  return c.json({
    package_version_id: version.package_version_id,
    artifact_url: version.artifact_url,
    artifact_sha256: version.artifact_sha256,
    artifact_size_bytes: version.artifact_size_bytes,
  });
});

export { installRoute };
