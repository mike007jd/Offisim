import { createHash } from 'node:crypto';
import type { PackageManifest } from '@offisim/asset-schema';
import { validateManifest } from '@offisim/asset-schema';
import { zipSync } from 'fflate';
import type { OfficialSeedPayload, SeedBuildResult } from './types.js';

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function encodeJson(data: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(data, null, 2)}\n`);
}

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function buildReadme(payload: OfficialSeedPayload): string {
  return `# ${payload.title}\n\n${payload.description.trim() || payload.summary}\n`;
}

type ExportedFiles = Record<string, Uint8Array>;

function coerceBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? encodeText(value) : value;
}

/**
 * Build a seeded .offisimpkg archive from a payload. Contents are
 * deterministic — file bodies come from the payload directly and `fflate`
 * compresses the same inputs identically (timestamps inside the zip are
 * ignored by the installer's integrity checker, which verifies per-file
 * SHA-256 of uncompressed bytes from `manifest.integrity.files`).
 */
export function buildSeedArtifact(payload: OfficialSeedPayload): SeedBuildResult {
  const readmeBytes = encodeText(buildReadme(payload));
  const assetBytes: ExportedFiles = {};
  for (const [path, body] of Object.entries(payload.assetFiles)) {
    if (!path.startsWith('assets/')) {
      throw new Error(
        `Seed payload '${payload.slug}' has asset path '${path}' — must start with 'assets/'`,
      );
    }
    assetBytes[path] = coerceBytes(body);
  }

  const integrityInputs: ExportedFiles = {
    'README.md': readmeBytes,
    ...assetBytes,
  };

  const integrityFiles = Object.entries(integrityInputs)
    .map(([path, bytes]) => ({ path, sha256: sha256Hex(bytes) }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const primaryAssetEntry = Object.keys(assetBytes)[0];
  if (!primaryAssetEntry) {
    throw new Error(`Seed payload '${payload.slug}' has no assets/* files`);
  }

  const manifest: PackageManifest = {
    spec_version: '1.0.0',
    package: {
      id: payload.package_id,
      kind: payload.kind,
      version: payload.version,
      title: payload.title,
      summary: payload.summary,
      license: 'MIT',
      publisher: {
        creator_handle: 'offisim',
        display_name: 'Offisim',
      },
      tags: payload.tags,
    },
    compatibility: {
      runtime_range: payload.runtime_range,
      schema_version: payload.schema_version,
      supported_environments: payload.supported_environments,
    },
    requirements: {
      required_capabilities: [],
      required_mcps: [],
    },
    permissions: {
      risk_class: payload.risk_class,
      declares_secrets: false,
      filesystem_scope: payload.filesystem_scope,
      network_scope: payload.network_scope,
    },
    assets: [
      {
        asset_id: payload.asset_id,
        kind: payload.kind,
        path: primaryAssetEntry,
        default_enabled: true,
      },
    ],
    integrity: {
      package_sha256: '0'.repeat(64),
      files: integrityFiles,
    },
    previews: {
      readme_path: 'README.md',
    },
    custom: {
      marketplace_export_kind: payload.kind,
      seed: { source: 'offisim-official' },
      ...payload.customManifest,
    },
  };

  const validation = validateManifest(manifest);
  if (!validation.valid) {
    const detail = validation.errors?.map((e) => `${e.path}: ${e.message}`).join('; ') ?? 'unknown';
    throw new Error(`Seed manifest for '${payload.slug}' failed validation: ${detail}`);
  }

  const manifestBytes = encodeJson(manifest);
  const zipBytes = zipSync({
    'manifest.json': manifestBytes,
    'README.md': readmeBytes,
    ...assetBytes,
  });

  return {
    payload,
    manifest,
    zipBytes,
    packageSha256: sha256Hex(zipBytes),
    sizeBytes: zipBytes.byteLength,
  };
}
