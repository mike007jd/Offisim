import type { PackageManifest } from './manifest.types.js';
// Precompiled standalone validator — generated at build time by
// `scripts/generate-validator.mjs`. Importing the standalone artifact keeps
// `ajv.compile()` (which uses `new Function`) off the runtime path, so Tauri's
// release CSP `script-src 'self'` does not block execution with unsafe-eval.
import validate from './schema/manifest-validator.generated.js';

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors?: readonly { message: string; path: string }[];
}

// NOTE: validateFormats=false is baked into the generator so "format" stays as
// metadata and noisy "unknown format: uri" warnings for distribution.source_url
// are suppressed. URI protocol safety is enforced at the consumption site
// (useInstallFlow.ts) which validates https:/http: before fetching, preventing
// javascript: / file: / data: URL injection.

export function validateManifest(data: unknown): ValidationResult {
  const valid = validate(data);
  if (valid) {
    return { valid: true };
  }
  return {
    valid: false,
    errors: (validate.errors ?? []).map((e) => ({
      message: e.message ?? 'unknown error',
      path: e.instancePath || '/',
    })),
  };
}

/** Type-narrowing helper: returns typed manifest if valid, throws otherwise */
export function parseManifest(data: unknown): PackageManifest {
  const result = validateManifest(data);
  if (!result.valid) {
    throw new Error(
      `Invalid manifest:\n${result.errors?.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
    );
  }
  return data as PackageManifest;
}
