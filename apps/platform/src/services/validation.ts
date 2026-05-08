/**
 * Manifest validation service for the publishing workflow.
 * Uses @offisim/asset-schema for canonical manifest semantics.
 */

import {
  validateManifest as validateCanonicalManifest,
  type PackageManifest,
} from '@offisim/asset-schema';
import { decodeRegistryArtifactBase64, MAX_ARTIFACT_BYTES } from './artifacts.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: PackageManifest;
  artifact?: {
    sha256: string;
    manifest_sha256: string;
    publisher_sha256: string;
    platform_sha256: string;
    size_bytes: number;
    manifest_size_bytes: number;
    publisher_size_bytes: number;
    platform_size_bytes: number;
    external_url: string | null;
    external_url_fetch_enabled: boolean;
    storage_backend: 'registry_object';
    registry_bytes_base64: string;
  };
}

type ManifestWarningsShape = {
  previews?: {
    readme_path?: unknown;
  };
  package?: {
    summary?: unknown;
  };
};

const SHA256_REGEX = /^[a-f0-9]{64}$/i;
type ArtifactInput = {
  external_url?: string;
  sha256?: string;
  size_bytes?: number;
  storage_backend?: string;
  bytes_base64?: string;
};

export function validateManifest(
  json: unknown,
  artifact?: ArtifactInput,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!json || typeof json !== 'object') {
    return { valid: false, errors: ['Manifest must be a JSON object'], warnings: [] };
  }

  const result = validateCanonicalManifest(json);
  if (!result.valid) {
    errors.push(
      ...(result.errors ?? []).map((issue) => `${issue.path}: ${issue.message}`),
    );
  }

  // Warnings (advisory only — not schema errors)
  const manifest = json as ManifestWarningsShape;
  if (!manifest.previews?.readme_path) warnings.push('No readme_path in previews');
  if (!manifest.package?.summary)
    warnings.push('No package.summary — recommended for marketplace display');

  const typed = errors.length === 0 ? (json as PackageManifest) : undefined;
  const artifactResult = typed ? validateArtifact(typed, artifact) : null;
  if (artifactResult?.errors.length) errors.push(...artifactResult.errors);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    ...(typed ? { manifest: typed } : {}),
    ...(artifactResult?.artifact ? { artifact: artifactResult.artifact } : {}),
  };
}

function validateArtifact(
  manifest: PackageManifest,
  artifact?: ArtifactInput,
): {
  errors: string[];
  artifact?: {
    sha256: string;
    manifest_sha256: string;
    publisher_sha256: string;
    platform_sha256: string;
    size_bytes: number;
    manifest_size_bytes: number;
    publisher_size_bytes: number;
    platform_size_bytes: number;
    external_url: string | null;
    external_url_fetch_enabled: boolean;
    storage_backend: 'registry_object';
    registry_bytes_base64: string;
  };
} {
  const errors: string[] = [];
  const manifestSha = manifest.integrity.package_sha256.trim().toLowerCase();
  const publisherSha = artifact?.sha256?.trim().toLowerCase();
  const publisherSize = artifact?.size_bytes;
  if (!publisherSha || !SHA256_REGEX.test(publisherSha)) {
    errors.push('artifact.sha256 must be 64 hex');
  }
  if (!SHA256_REGEX.test(manifestSha)) {
    errors.push('manifest.integrity.package_sha256 must be 64 hex');
  }
  if (!Number.isInteger(publisherSize) || !publisherSize || publisherSize <= 0) {
    errors.push('artifact.size_bytes must be a positive integer');
  } else if (publisherSize > MAX_ARTIFACT_BYTES) {
    errors.push(`artifact.size_bytes exceeds ${MAX_ARTIFACT_BYTES} byte maximum`);
  }

  const externalUrl = artifact?.external_url ?? manifest.distribution?.source_url ?? null;
  if (externalUrl) {
    const externalUrlErrors = validateExternalArtifactUrl(externalUrl);
    errors.push(...externalUrlErrors);
    errors.push('external_url publishing is disabled until SSRF-safe fetch binding is available');
  }

  if (artifact?.storage_backend && artifact.storage_backend !== 'registry_object') {
    errors.push('artifact.storage_backend must be registry_object for 1.0 publish approval');
  }

  const registryBytesBase64 = artifact?.bytes_base64?.trim();
  let platformSha: string | null = null;
  let platformSize: number | null = null;
  if (!registryBytesBase64) {
    errors.push('artifact.bytes_base64 is required so the platform can compute artifact sha256');
  } else {
    try {
      const decoded = decodeRegistryArtifactBase64(registryBytesBase64);
      platformSha = decoded.sha256;
      platformSize = decoded.size_bytes;
      if (publisherSha && platformSha !== publisherSha) {
        errors.push('platform-computed artifact sha256 must match artifact.sha256');
      }
      if (platformSize !== publisherSize) {
        errors.push('platform-computed artifact size must match artifact.size_bytes');
      }
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'artifact.bytes_base64 is invalid');
    }
  }

  if (
    errors.length > 0 ||
    !Number.isInteger(publisherSize) ||
    !platformSha ||
    !platformSize ||
    !registryBytesBase64
  ) {
    return { errors };
  }
  const expectedSha = publisherSha as string;
  const expectedSize = publisherSize as number;
  return {
    errors,
    artifact: {
      sha256: platformSha,
      manifest_sha256: manifestSha,
      publisher_sha256: expectedSha,
      platform_sha256: platformSha,
      size_bytes: platformSize,
      manifest_size_bytes: manifest.distribution?.artifact_size_bytes ?? platformSize,
      publisher_size_bytes: expectedSize,
      platform_size_bytes: platformSize,
      external_url: externalUrl,
      external_url_fetch_enabled: false,
      storage_backend: 'registry_object',
      registry_bytes_base64: registryBytesBase64,
    },
  };
}

function validateExternalArtifactUrl(raw: string): string[] {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return ['external artifact URL must use https'];
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.localhost')
    ) {
      return ['external artifact URL cannot target localhost'];
    }
    if (/^(10\.|127\.|169\.254\.|192\.168\.)/u.test(host)) {
      return ['external artifact URL cannot target private or metadata IP'];
    }
    if (/^172\.(1[6-9]|2\d|3[0-1])\./u.test(host)) {
      return ['external artifact URL cannot target private IP'];
    }
    return [];
  } catch {
    return ['external artifact URL is invalid'];
  }
}
