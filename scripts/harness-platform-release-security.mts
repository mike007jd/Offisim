import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { createHash, webcrypto } from 'node:crypto';
import { unzipSync } from '../packages/ui-office/node_modules/fflate/esm/index.mjs';
import { Hono } from '../apps/platform/node_modules/hono/dist/index.js';
import { publish } from '../apps/platform/src/routes/publish.js';
import { assertListingOwnedByCreator } from '../apps/platform/src/services/publish-ownership.js';
import { validateManifest } from '../apps/platform/src/services/validation.js';
import { buildSkillPackage } from '../packages/ui-office/src/lib/export-to-manifest.ts';

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

type Row = { listing_id: string; creator_id: string };

class ListingOwnershipDb {
  constructor(private readonly rows: readonly Row[]) {}

  select() {
    return {
      from: () => ({
        where: () => ({
          limit: async () => this.rows.map((row) => ({ listing_id: row.listing_id })),
        }),
      }),
    };
  }
}

function hasHttpStatus(err: unknown, status: number): boolean {
  return Boolean(err && typeof err === 'object' && 'status' in err && err.status === status);
}

async function expectAllowed() {
  const db = new ListingOwnershipDb([
    {
      listing_id: '11111111-1111-4111-8111-111111111111',
      creator_id: 'creator-a',
    },
  ]);
  await assertListingOwnedByCreator(
    db as never,
    '11111111-1111-4111-8111-111111111111',
    'creator-a',
  );
}

async function expectCrossCreatorBlocked() {
  const db = new ListingOwnershipDb([]);
  try {
    await assertListingOwnedByCreator(
      db as never,
      '11111111-1111-4111-8111-111111111111',
      'creator-b',
    );
  } catch (err) {
    if (hasHttpStatus(err, 403)) return;
    throw err;
  }
  throw new Error('cross-creator listing takeover was not blocked');
}

async function expectInvalidListingIdBlocked() {
  const db = new ListingOwnershipDb([]);
  try {
    await assertListingOwnedByCreator(db as never, 'not-a-uuid', 'creator-a');
  } catch (err) {
    if (hasHttpStatus(err, 400)) return;
    throw err;
  }
  throw new Error('invalid listing id was not blocked');
}

await expectAllowed();
await expectCrossCreatorBlocked();
await expectInvalidListingIdBlocked();
expectCanonicalSchemaRejection();
await expectPublishedManifestMatchesArchive();
expectArtifactShaIndependentFromManifestHashAccepted();
expectArtifactMismatchBlocked();
expectExternalArtifactFailClosed();
expectRedirectToMetadataFailClosed();
expectPrivateIpArtifactBlocked();
expectSizeCapBlocked();
expectDuplicatePackageVersionSubmitGuard();

const ownershipSource = readFileSync(
  new URL('../apps/platform/src/services/publish-ownership.ts', import.meta.url),
  'utf8',
);
if (!ownershipSource.includes('eq(listings.creator_id, creatorId)')) {
  throw new Error('listing ownership query does not bind creator_id to creatorId');
}

const seedBuilderSource = readFileSync(
  new URL('../apps/platform/src/seed/package-builder.ts', import.meta.url),
  'utf8',
);
const officialSeedSource = readFileSync(
  new URL('../apps/platform/src/seed/official-seed.ts', import.meta.url),
  'utf8',
);
if (!seedBuilderSource.includes("seed: { source: 'offisim-official' }")) {
  throw new Error('official seeded package source marker is missing');
}
if (!officialSeedSource.includes('setSeededArtifact(')) {
  throw new Error('official seeded artifacts are not pinned to platform-owned storage');
}

const migrationSource = readFileSync(
  new URL(
    '../packages/db-platform/migrations/0001_release_security_marketplace_constraints.sql',
    import.meta.url,
  ),
  'utf8',
);
if (!migrationSource.includes('package_versions_listing_package_version_unique')) {
  throw new Error('duplicate package version conflict constraint is missing');
}

function expectCanonicalSchemaRejection() {
  const result = validateManifest({ not_manifest: true });
  if (result.valid) {
    throw new Error('canonical schema rejection did not block malformed manifest');
  }
}

async function expectPublishedManifestMatchesArchive() {
  const bundle = await buildSkillPackage(
    {
      skill: {
        id: 'skill-release-security-harness',
        slug: 'release-security-harness',
        name: 'Release Security Harness',
        description: 'Harness skill package',
        scope: 'company',
        version: '0.1.0',
      } as never,
      skillMd: [
        '---',
        'name: release-security-harness',
        'description: Harness skill package',
        '---',
        '# Release Security Harness',
      ].join('\n'),
    },
    {
      title: 'Release Security Harness',
      summary: 'Harness package',
      description: 'Harness package',
      version: '0.1.0',
      tags: ['security'],
      license: 'MIT',
      riskClass: 'data_asset',
    },
  );
  const archivedManifestBytes = unzipSync(bundle.archiveBytes)['manifest.json'];
  if (!archivedManifestBytes) {
    throw new Error('published archive did not include manifest.json');
  }
  const archivedManifest = JSON.parse(new TextDecoder().decode(archivedManifestBytes));
  assert.deepEqual(archivedManifest, bundle.manifest);
  assert.equal(bundle.artifactSizeBytes, bundle.archiveBytes.byteLength);
  assert.equal(bundle.artifactSha256, sha256Hex(bundle.archiveBytes));
  assert.notEqual(bundle.artifactSha256, bundle.manifest.integrity.package_sha256);
}

function expectArtifactShaIndependentFromManifestHashAccepted() {
  const bytes = new TextEncoder().encode('trusted package bytes');
  const artifactSha = sha256Hex(bytes);
  const manifestSha = '0'.repeat(64);
  const result = validateManifest(validManifest(manifestSha, bytes.byteLength), {
    storage_backend: 'registry_object',
    sha256: artifactSha,
    size_bytes: bytes.byteLength,
    bytes_base64: Buffer.from(bytes).toString('base64'),
  });
  if (!result.valid) {
    throw new Error(`artifact metadata decoupled from manifest hash was rejected: ${result.errors.join('; ')}`);
  }
  if (result.artifact?.sha256 !== artifactSha) {
    throw new Error('platform artifact sha was not recorded from artifact bytes');
  }
  if (result.artifact?.manifest_sha256 !== manifestSha) {
    throw new Error('manifest sha metadata was not preserved separately');
  }
}

function expectArtifactMismatchBlocked() {
  const bytes = new TextEncoder().encode('trusted package bytes');
  const sha = sha256Hex(bytes);
  const mismatchedBytesBase64 = Buffer.from('tampered package bytes').toString('base64');
  const result = validateManifest(validManifest(sha, bytes.byteLength), {
    storage_backend: 'registry_object',
    sha256: sha,
    size_bytes: bytes.byteLength,
    bytes_base64: mismatchedBytesBase64,
  });
  if (result.valid) {
    throw new Error('platform-computed artifact mismatch was not blocked');
  }
  if (!result.errors.some((error) => error.includes('platform-computed artifact sha256'))) {
    throw new Error('artifact mismatch did not report platform-computed sha failure');
  }
}

function expectExternalArtifactFailClosed() {
  const bytes = new TextEncoder().encode('trusted package bytes');
  const sha = sha256Hex(bytes);
  const result = validateManifest(validManifest(sha, bytes.byteLength), {
    storage_backend: 'registry_object',
    sha256: sha,
    size_bytes: bytes.byteLength,
    external_url: 'https://example.com/pkg.offisimpkg',
    bytes_base64: Buffer.from(bytes).toString('base64'),
  });
  if (result.valid) {
    throw new Error('external_url publish path did not fail closed');
  }
  if (!result.errors.some((error) => error.includes('external_url publishing is disabled'))) {
    throw new Error(
      'external_url rejection did not explain fail-closed registry upload requirement',
    );
  }
}

function expectRedirectToMetadataFailClosed() {
  const bytes = new TextEncoder().encode('trusted package bytes');
  const sha = sha256Hex(bytes);
  const result = validateManifest(validManifest(sha, bytes.byteLength), {
    storage_backend: 'registry_object',
    sha256: sha,
    size_bytes: bytes.byteLength,
    external_url: 'https://example.com/redirect-to-metadata',
    bytes_base64: Buffer.from(bytes).toString('base64'),
  });
  if (!result.errors.some((error) => error.includes('external_url publishing is disabled'))) {
    throw new Error('redirect-capable external artifact path did not fail closed before fetch');
  }
}

function expectPrivateIpArtifactBlocked() {
  const bytes = new TextEncoder().encode('trusted package bytes');
  const sha = sha256Hex(bytes);
  const result = validateManifest(validManifest(sha, bytes.byteLength), {
    storage_backend: 'registry_object',
    sha256: sha,
    size_bytes: bytes.byteLength,
    external_url: 'https://169.254.169.254/latest/meta-data',
    bytes_base64: Buffer.from(bytes).toString('base64'),
  });
  if (!result.errors.some((error) => error.includes('private or metadata IP'))) {
    throw new Error('metadata/private IP artifact URL was not rejected');
  }
}

function expectSizeCapBlocked() {
  const bytes = new TextEncoder().encode('trusted package bytes');
  const sha = sha256Hex(bytes);
  const result = validateManifest(validManifest(sha, 50 * 1024 * 1024 + 1), {
    storage_backend: 'registry_object',
    sha256: sha,
    size_bytes: 50 * 1024 * 1024 + 1,
    bytes_base64: Buffer.from(bytes).toString('base64'),
  });
  if (!result.errors.some((error) => error.includes('byte maximum'))) {
    throw new Error('artifact size cap was not enforced');
  }
}

async function expectDuplicateSubmitReturns409BeforeModerationJob() {
  const listingId = '11111111-1111-4111-8111-111111111111';
  const draftId = '22222222-2222-4222-8222-222222222222';
  const creatorId = '33333333-3333-4333-8333-333333333333';
  const db = new DuplicateSubmitDb({
    listingId,
    draftId,
    creatorId,
    packageId: 'offisim.skill.release-security-harness',
    version: '0.1.0',
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('db', db as never);
    c.set('userId', 'user-a');
    c.set('authKind', 'session');
    await next();
  });
  app.route('/v1/publish', publish);

  const response = await app.request('/v1/publish/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ draft_id: draftId }),
  });
  const body = (await response.json()) as { error?: { code?: string } };
  if (response.status !== 409 || body.error?.code !== 'DUPLICATE_PACKAGE_VERSION') {
    throw new Error(`duplicate submit returned ${response.status} ${JSON.stringify(body)}`);
  }
  if (db.moderationJobInserts !== 0) {
    throw new Error('duplicate submit created a moderation job before returning 409');
  }
}

class DuplicateSubmitDb {
  moderationJobInserts = 0;
  private selectCount = 0;

  constructor(
    private readonly fixture: {
      listingId: string;
      draftId: string;
      creatorId: string;
      packageId: string;
      version: string;
    },
  ) {}

  select() {
    return {
      from: () => ({
        where: () => ({
          limit: async () => {
            this.selectCount += 1;
            return this.rowsForSelect(this.selectCount);
          },
        }),
      }),
    };
  }

  insert() {
    this.moderationJobInserts += 1;
    return {
      values: () => ({
        returning: async () => {
          throw new Error('duplicate submit should not insert rows');
        },
      }),
    };
  }

  rowsForSelect(selectCount: number) {
    if (selectCount === 1) return [{ creator_id: this.fixture.creatorId }];
    if (selectCount === 2) {
      return [
        {
          draft_id: this.fixture.draftId,
          creator_id: this.fixture.creatorId,
          listing_id: this.fixture.listingId,
          status: 'draft',
          validation_state: 'valid',
          manifest_json: {
            package: {
              id: this.fixture.packageId,
              version: this.fixture.version,
            },
          },
        },
      ];
    }
    if (selectCount === 3) return [{ listing_id: this.fixture.listingId }];
    if (selectCount === 4) return [{ package_version_id: 'existing-version' }];
    return [];
  }
}

await expectDuplicateSubmitReturns409BeforeModerationJob();
console.log('Platform release security harness passed.');

function expectDuplicatePackageVersionSubmitGuard() {
  const publishSource = readFileSync(
    new URL('../apps/platform/src/routes/publish.ts', import.meta.url),
    'utf8',
  );
  const moderationSource = readFileSync(
    new URL('../apps/platform/src/services/moderation.ts', import.meta.url),
    'utf8',
  );
  const duplicatePrecheckIndex = publishSource.indexOf('const [existingVersion]');
  const jobInsertIndex = publishSource.indexOf('.insert(moderationJobs)');
  if (
    duplicatePrecheckIndex === -1 ||
    jobInsertIndex === -1 ||
    duplicatePrecheckIndex > jobInsertIndex
  ) {
    throw new Error(
      'duplicate package version submit path does not fail before creating a moderation job',
    );
  }
  const requiredPublishPhrases = [
    'eq(packageVersions.listing_id, draft.listing_id)',
    'eq(packageVersions.package_id, manifest.package.id)',
    'eq(packageVersions.version, manifest.package.version)',
    'return duplicatePackageVersionResponse(c);',
  ];
  for (const phrase of requiredPublishPhrases) {
    if (!publishSource.includes(phrase)) {
      throw new Error(`duplicate package version submit guard missing "${phrase}"`);
    }
  }
  const requiredModerationPhrases = [
    "code: 'duplicate_package_version'",
    'package_versions_listing_package_version_unique',
    ".set({ status: 'draft', updated_at: new Date() })",
  ];
  for (const phrase of requiredModerationPhrases) {
    if (!moderationSource.includes(phrase)) {
      throw new Error(`duplicate package version moderation guard missing "${phrase}"`);
    }
  }
}

function validManifest(packageSha256: string, artifactSizeBytes: number) {
  return {
    spec_version: '1.0.0',
    package: {
      id: 'offisim.skill.release-security-harness',
      kind: 'skill',
      version: '0.1.0',
      title: 'Release Security Harness',
      summary: 'Harness package',
      license: 'MIT',
    },
    compatibility: {
      runtime_range: '>=1.0 <2.0',
      schema_version: '2026-03',
      supported_environments: ['desktop'],
    },
    requirements: {
      required_capabilities: [],
      required_mcps: [],
    },
    permissions: {
      risk_class: 'data_asset',
      declares_secrets: false,
      filesystem_scope: 'workspace',
      network_scope: 'none',
    },
    assets: [
      {
        asset_id: 'release-security-harness',
        kind: 'skill',
        path: 'assets/skills/release-security-harness/SKILL.md',
        default_enabled: true,
      },
    ],
    distribution: {
      mirror_policy: 'registry_only',
      artifact_size_bytes: artifactSizeBytes,
    },
    integrity: {
      package_sha256: packageSha256,
      files: [
        {
          path: 'assets/skills/release-security-harness/SKILL.md',
          sha256: sha256Hex(new TextEncoder().encode('skill')),
        },
      ],
    },
    previews: {
      readme_path: 'README.md',
    },
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
