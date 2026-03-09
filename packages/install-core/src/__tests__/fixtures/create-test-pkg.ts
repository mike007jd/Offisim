/**
 * Test fixture helper — creates a valid .aicspkg ZIP archive in memory.
 *
 * Uses fflate.zipSync to produce a Uint8Array that extractPackage can consume.
 * The manifest is based on the valid-manifest.json fixture from @aics/asset-schema
 * with adjustments for hashes (they will be computed at runtime, not checked here).
 */

import { zipSync } from 'fflate';
import type { PackageManifest } from '@aics/asset-schema';

/**
 * A minimal valid manifest for testing purposes.
 * Hashes are placeholder values (64-char hex) — integrity tests should compute
 * real hashes and override the integrity section when needed.
 */
export const TEST_MANIFEST: PackageManifest = {
  spec_version: '1.0.0',
  package: {
    id: 'aics.employee.test-writer',
    kind: 'employee',
    version: '1.0.0',
    title: 'Test Writer',
    summary: 'A test employee package.',
    license: 'MIT',
    publisher: {
      creator_handle: 'testuser',
      display_name: 'Test User',
    },
  },
  compatibility: {
    runtime_range: '>=1.0 <2.0',
    schema_version: '2026-03',
    supported_environments: ['desktop', 'docker'],
  },
  requirements: {
    required_capabilities: ['chat'],
    required_mcps: [],
    recommended_models: [
      {
        profile: 'reasoning-heavy',
        reason: 'for complex tasks',
        provider_hints: ['openai', 'anthropic'],
      },
      {
        profile: 'cheap-draft',
        reason: 'for bulk work',
      },
    ],
  },
  permissions: {
    risk_class: 'logic_asset',
    declares_secrets: false,
    filesystem_scope: 'workspace',
    network_scope: 'none',
  },
  assets: [
    {
      asset_id: 'test-writer-default',
      kind: 'employee',
      path: 'assets/employee.test-writer.json',
      entrypoint: 'default',
      default_enabled: true,
      recommended_models: ['reasoning-heavy', 'cheap-draft'],
    },
  ],
  distribution: {
    source_url: 'https://market.example/packages/test-writer-1.0.0.aicspkg',
    mirror_policy: 'registry_or_external',
    artifact_size_bytes: 4096,
  },
  integrity: {
    package_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    files: [
      {
        path: 'assets/employee.test-writer.json',
        sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    ],
  },
  previews: {
    readme_path: 'README.md',
  },
};

/** Asset file content used in test packages. */
export const TEST_ASSET_CONTENT = JSON.stringify({
  name: 'Test Writer',
  role: 'writer',
  description: 'A test employee for unit tests.',
});

/**
 * Create a valid .aicspkg ZIP archive from the test manifest.
 *
 * @param manifestOverride - partial overrides merged shallowly onto TEST_MANIFEST
 * @param extraFiles - additional files to include in the ZIP beyond manifest.json and the default asset
 * @param omitManifest - if true, do not include manifest.json (for error testing)
 */
export function createTestPkg(options: {
  manifestOverride?: Partial<PackageManifest>;
  extraFiles?: Record<string, string | Uint8Array>;
  omitManifest?: boolean;
} = {}): Uint8Array {
  const manifest = { ...TEST_MANIFEST, ...options.manifestOverride };

  const zipEntries: Record<string, Uint8Array> = {};

  // Add manifest.json unless explicitly omitted
  if (!options.omitManifest) {
    zipEntries['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
  }

  // Add the default asset file
  zipEntries['assets/employee.test-writer.json'] = new TextEncoder().encode(TEST_ASSET_CONTENT);

  // Add a README
  zipEntries['README.md'] = new TextEncoder().encode('# Test Writer\n\nA test package.\n');

  // Add any extra files
  if (options.extraFiles) {
    for (const [path, content] of Object.entries(options.extraFiles)) {
      zipEntries[path] = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    }
  }

  return zipSync(zipEntries);
}

/**
 * Compute SHA-256 hex of Uint8Array (for test assertions).
 */
export async function computeSha256(data: Uint8Array): Promise<string> {
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
