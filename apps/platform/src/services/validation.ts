/**
 * Manifest validation service for the publishing workflow.
 * Uses Zod ManifestSchema for structural validation,
 * maps errors to stable human-readable messages.
 */

import { ManifestSchema } from '../schemas/index.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

type ManifestWarningsShape = {
  previews?: {
    readme_path?: unknown;
  };
  package?: {
    summary?: unknown;
  };
};

/** Map top-level required field paths to legacy error messages */
const TOP_LEVEL_LABELS: Record<string, string> = {
  spec_version: 'Missing spec_version',
  package: 'Missing package section',
  compatibility: 'Missing compatibility section',
  requirements: 'Missing requirements section',
  permissions: 'Missing permissions section',
  assets: 'Missing or invalid assets array',
  integrity: 'Missing integrity section',
};

export function validateManifest(json: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!json || typeof json !== 'object') {
    return { valid: false, errors: ['Manifest must be a JSON object'], warnings: [] };
  }

  const result = ManifestSchema.safeParse(json);

  if (!result.success) {
    for (const issue of result.error.errors) {
      const pathKey = issue.path[0] as string;

      // Top-level "Required" → use readable label
      if (issue.path.length === 1 && issue.message === 'Required' && TOP_LEVEL_LABELS[pathKey]) {
        errors.push(TOP_LEVEL_LABELS[pathKey]);
      } else {
        // Custom messages from schema errorMaps / .min() / .boolean() are already correct
        errors.push(issue.message);
      }
    }
  }

  // Warnings (advisory only — not schema errors)
  const manifest = json as ManifestWarningsShape;
  if (!manifest.previews?.readme_path) warnings.push('No readme_path in previews');
  if (!manifest.package?.summary)
    warnings.push('No package.summary — recommended for marketplace display');

  return { valid: errors.length === 0, errors, warnings };
}
