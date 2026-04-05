import Ajv2020 from 'ajv/dist/2020.js';
import type { PackageManifest } from './manifest.types.js';
import schema from './schema/manifest-1.0.0.json' with { type: 'json' };

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors?: readonly { message: string; path: string }[];
}

// NOTE: validateFormats=false keeps "format" as metadata and suppresses noisy
// "unknown format: uri" warnings for distribution.source_url in local/dev usage.
// URI protocol safety is enforced at the consumption site (useInstallFlow.ts)
// which validates that artifact URLs use only https: or http: protocols
// before fetching, preventing javascript: / file: / data: URL injection.
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(schema);

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
