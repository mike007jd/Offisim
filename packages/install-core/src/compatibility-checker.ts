/**
 * Compatibility checker — verify a package manifest against the current runtime.
 *
 * Checks:
 * - runtime_range: manual semver-like range parsing (">=X.Y <Z.W")
 * - environment: supported_environments includes current environment
 * - schema_version: exact match required
 */

import type { PackageManifest } from '@aics/asset-schema';
import type { RuntimeEnvironment, CompatibilityResult, CompatibilityError } from './types.js';

// ---------------------------------------------------------------------------
// Version helpers (no semver library)
// ---------------------------------------------------------------------------

/** Parse a dotted version string like "1.2.3" into a number array [1, 2, 3]. */
function parseVersion(version: string): number[] {
  return version.split('.').map((s) => {
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`Invalid version segment: '${s}' in '${version}'`);
    }
    return n;
  });
}

/**
 * Compare two version tuples.
 * @returns -1 if a < b, 0 if equal, 1 if a > b
 */
export function compareVersions(a: number[], b: number[]): -1 | 0 | 1 {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

/** Parsed version range with optional gte and lt bounds. */
interface VersionRange {
  gte?: number[];
  lt?: number[];
}

/**
 * Parse a version range string like ">=1.0 <2.0" into bounds.
 *
 * Supports:
 * - ">=X.Y" (lower bound only)
 * - "<X.Y" (upper bound only)
 * - ">=X.Y <Z.W" (both bounds)
 * - ">=X.Y.Z <Z.W.A" (three-part versions)
 */
export function parseVersionRange(range: string): VersionRange {
  const result: VersionRange = {};
  const parts = range.trim().split(/\s+/);

  for (const part of parts) {
    if (part.startsWith('>=')) {
      result.gte = parseVersion(part.slice(2));
    } else if (part.startsWith('<')) {
      result.lt = parseVersion(part.slice(1));
    } else {
      throw new Error(`Unsupported version range operator in '${part}'`);
    }
  }

  return result;
}

/**
 * Check if a version satisfies a range.
 */
function satisfiesRange(version: number[], range: VersionRange): boolean {
  if (range.gte && compareVersions(version, range.gte) < 0) {
    return false;
  }
  if (range.lt && compareVersions(version, range.lt) >= 0) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a package manifest is compatible with the given runtime environment.
 */
export function checkCompatibility(
  manifest: PackageManifest,
  env: RuntimeEnvironment,
): CompatibilityResult {
  const errors: CompatibilityError[] = [];

  // 1. Check runtime_range
  try {
    const range = parseVersionRange(manifest.compatibility.runtime_range);
    const runtimeVer = parseVersion(env.runtimeVersion);
    if (!satisfiesRange(runtimeVer, range)) {
      errors.push({
        code: 'runtime_range',
        message: `Runtime version ${env.runtimeVersion} does not satisfy range '${manifest.compatibility.runtime_range}'`,
      });
    }
  } catch (err) {
    errors.push({
      code: 'runtime_range',
      message: `Failed to parse runtime range: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // 2. Check environment
  const supportedEnvs = manifest.compatibility.supported_environments;
  if (!supportedEnvs.includes(env.environment)) {
    errors.push({
      code: 'environment',
      message: `Environment '${env.environment}' is not supported. Supported: ${supportedEnvs.join(', ')}`,
    });
  }

  // 3. Check schema_version
  if (manifest.compatibility.schema_version !== env.schemaVersion) {
    errors.push({
      code: 'schema_version',
      message: `Schema version '${manifest.compatibility.schema_version}' does not match runtime '${env.schemaVersion}'`,
    });
  }

  return {
    compatible: errors.length === 0,
    errors,
  };
}
