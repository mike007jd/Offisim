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

import { installReceipts, listings, packageVersions } from '@offisim/db-platform';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { readPlatformJsonBody } from '../lib/body-limit.js';
import { requireAuth, requireScope } from '../middleware/auth.js';
import { installRateLimit } from '../middleware/rate-limit.js';
import { InstallReceiptSchema } from '../schemas/index.js';
import { getSeededArtifact } from '../seed/artifact-store.js';
import { getRegistryArtifact } from '../services/artifacts.js';
import type { PlatformDb } from '../db.js';
import type { PlatformEnv } from '../types.js';

const installRoute = new Hono<PlatformEnv>();

/**
 * POST /v1/install/receipts — Record an install receipt.
 *
 * Called by the local runtime after a successful install to:
 * 1. Create an install_receipt record (idempotent via ON CONFLICT DO NOTHING)
 * 2. Increment the listing's install_count ONLY if the receipt was actually inserted
 *
 * Uses a transaction to guarantee atomicity — no count drift on concurrent requests.
 */
installRoute.post(
  '/receipts',
  installRateLimit,
  requireAuth,
  requireScope('install:receipt'),
  async (c) => {
    const db = c.get('db');
    const userId = c.get('userId');

    if (!userId) {
      throw new HTTPException(401, { message: 'Unauthorized' });
    }
    const body = InstallReceiptSchema.parse(await readPlatformJsonBody(c));

    // Generate a receipt ID (deterministic for idempotency: user + listing + version)
    const receiptId = `rcpt_${userId}_${body.listing_id}_${body.package_version_id}`;

    // Use transaction to guarantee atomicity of receipt insert + count increment
    const result = await db.transaction(async (tx) => {
      // Verify version belongs to the claimed listing
      const [validVersion] = await tx
        .select({ package_version_id: packageVersions.package_version_id })
        .from(packageVersions)
        .innerJoin(listings, eq(packageVersions.listing_id, listings.listing_id))
        .where(
          and(
            eq(packageVersions.package_version_id, body.package_version_id),
            eq(packageVersions.listing_id, body.listing_id),
            eq(packageVersions.status, 'active'),
            eq(listings.status, 'listed'),
          ),
        )
        .limit(1);

      if (!validVersion) {
        throw new HTTPException(404, {
          message: 'Package version is not available for install',
        });
      }

      // Upsert receipt — ON CONFLICT DO NOTHING returns 0 rows if duplicate
      const inserted = await tx
        .insert(installReceipts)
        .values({
          install_receipt_id: receiptId,
          user_id: userId,
          listing_id: body.listing_id,
          package_version_id: body.package_version_id,
          install_source: body.install_source,
        })
        .onConflictDoNothing()
        .returning({ install_receipt_id: installReceipts.install_receipt_id });

      if (inserted.length > 0) {
        // Receipt was actually inserted (not a duplicate) — increment count
        const installCountRows = await tx
          .update(listings)
          .set({
            install_count: sql`COALESCE(${listings.install_count}, 0) + 1`,
          })
          .where(and(eq(listings.listing_id, body.listing_id), eq(listings.status, 'listed')))
          .returning({ listing_id: listings.listing_id });

        if (installCountRows.length === 0) {
          throw new HTTPException(409, { message: 'Listing state changed before receipt recording' });
        }

        return 'recorded' as const;
      }

      // Duplicate receipt — no count increment
      return 'already_exists' as const;
    });

    return c.json({
      install_receipt_id: receiptId,
      listing_id: body.listing_id,
      package_version_id: body.package_version_id,
      status: result,
    });
  },
);

/**
 * GET /v1/install/download/:versionId — Get artifact download URL.
 *
 * Returns the artifact URL + SHA256 for the given package version.
 * The local runtime uses this to download the .offisimpkg file.
 * No auth required — artifacts are public (same as npm/crates.io).
 */
installRoute.get('/download/:versionId', async (c) => {
  const db = c.get('db');
  const versionId = c.req.param('versionId');

  const version = await getVisiblePackageVersionById(db, versionId);

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

/**
 * GET /v1/install/artifacts/:versionId — Serve in-memory seeded artifact bytes.
 *
 * Offisim official listings are materialized as `.offisimpkg` zip bytes at
 * platform boot and kept in an in-memory store (see `seed/artifact-store.ts`).
 * This route streams those bytes so the Market install flow can fetch them
 * without any external hosting. Returns 404 for versions that were not
 * seeded (e.g. user-published listings — they should use their own external
 * `artifact_url`).
 */
installRoute.get('/artifacts/:versionId', async (c) => {
  const db = c.get('db');
  const versionId = c.req.param('versionId');
  const version = await getVisiblePackageVersionById(db, versionId);
  if (!version) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Package version not found' } }, 404);
  }
  const artifact = getSeededArtifact(versionId) ?? (await getRegistryArtifact(versionId));
  if (!artifact) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'No platform artifact for this version' } },
      404,
    );
  }
  // Cast to Uint8Array<ArrayBuffer> — WHATWG Response accepts Uint8Array at
  // runtime; the DOM typings in Node's lib.d.ts don't expose BodyInit.
  const body = artifact.bytes as unknown as ReadableStream | ArrayBuffer;
  const artifactSize = 'size' in artifact ? artifact.size : artifact.size_bytes;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(artifactSize),
      'Cache-Control': 'no-store',
    },
  });
});

async function getVisiblePackageVersionById(db: PlatformDb, versionId: string) {
  const [version] = await db
    .select({
      package_version_id: packageVersions.package_version_id,
      artifact_url: packageVersions.artifact_url,
      artifact_sha256: packageVersions.artifact_sha256,
      artifact_size_bytes: packageVersions.artifact_size_bytes,
    })
    .from(packageVersions)
    .innerJoin(listings, eq(packageVersions.listing_id, listings.listing_id))
    .where(
      and(
        eq(packageVersions.package_version_id, versionId),
        eq(packageVersions.status, 'active'),
        eq(listings.status, 'listed'),
      ),
    )
    .limit(1);
  return version;
}

export { installRoute };
