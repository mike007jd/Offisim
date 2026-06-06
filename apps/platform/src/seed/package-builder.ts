import { buildPackageArtifact } from '@offisim/install-core';
import type { OfficialSeedPayload, SeedBuildResult } from './types.js';

/**
 * Build a seeded .offisimpkg archive from a payload through install-core's
 * canonical artifact builder. Platform keeps only seed-shape adaptation here;
 * package byte layout, manifest validation, zip writing, and hashing all stay
 * in one implementation.
 */
export async function buildSeedArtifact(payload: OfficialSeedPayload): Promise<SeedBuildResult> {
  const primaryAssetEntry = Object.keys(payload.assetFiles)[0];
  if (!primaryAssetEntry) {
    throw new Error(`Seed payload '${payload.slug}' has no assets/* files`);
  }
  if (!primaryAssetEntry.startsWith('assets/')) {
    throw new Error(
      `Seed payload '${payload.slug}' has primary asset path '${primaryAssetEntry}' — must start with 'assets/'`,
    );
  }
  const { [primaryAssetEntry]: assetBody, ...extraFiles } = payload.assetFiles;
  if (!assetBody) {
    throw new Error(`Seed payload '${payload.slug}' has empty primary asset body`);
  }

  const built = await buildPackageArtifact({
    packageId: payload.package_id,
    assetId: payload.asset_id,
    kind: payload.kind,
    title: payload.title,
    summary: payload.summary,
    description: payload.description,
    version: payload.version,
    license: 'MIT',
    publisher: {
      creatorHandle: 'offisim',
      displayName: 'Offisim',
    },
    runtimeRange: payload.runtime_range,
    schemaVersion: payload.schema_version,
    supportedEnvironments: payload.supported_environments,
    riskClass: payload.risk_class,
    filesystemScope: payload.filesystem_scope,
    networkScope: payload.network_scope,
    tags: payload.tags,
    requiredCapabilities: payload.requirements?.required_capabilities ?? [],
    requiredMcps: payload.requirements?.required_mcps ?? [],
    recommendedModels: payload.requirements?.recommended_models,
    lineage: payload.lineage
      ? {
          originPackageId: payload.lineage.origin_package_id,
          forkedFromVersion: payload.lineage.forked_from_version,
          derivativeOf: payload.lineage.derivative_of,
        }
      : undefined,
    assetPath: primaryAssetEntry,
    assetBody,
    extraFiles,
    customManifest: {
      seed: { source: 'offisim-official' },
      ...payload.customManifest,
    },
  });

  return {
    payload,
    manifest: built.manifest,
    zipBytes: built.zipBytes,
    packageSha256: built.packageSha256,
    sizeBytes: built.sizeBytes,
  };
}
