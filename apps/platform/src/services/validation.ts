/**
 * Manifest validation service for the publishing workflow.
 * Validates package manifest JSON against AICS schema rules.
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const VALID_KINDS = ['employee', 'skill', 'sop', 'company_template', 'office_layout', 'bundle'];
const VALID_RISK_CLASSES = ['data_asset', 'logic_asset', 'privileged_asset'];
const VALID_ENVIRONMENTS = ['desktop', 'docker', 'web_limited'];

export function validateManifest(json: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!json || typeof json !== 'object') {
    return { valid: false, errors: ['Manifest must be a JSON object'], warnings: [] };
  }

  const manifest = json as Record<string, any>;

  // Required top-level fields
  if (!manifest.spec_version) errors.push('Missing spec_version');
  if (!manifest.package) errors.push('Missing package section');
  if (!manifest.compatibility) errors.push('Missing compatibility section');
  if (!manifest.requirements) errors.push('Missing requirements section');
  if (!manifest.permissions) errors.push('Missing permissions section');
  if (!manifest.assets || !Array.isArray(manifest.assets)) errors.push('Missing or invalid assets array');
  if (!manifest.integrity) errors.push('Missing integrity section');

  // Package fields
  if (manifest.package) {
    if (!manifest.package.id) errors.push('Missing package.id');
    if (!manifest.package.kind || !VALID_KINDS.includes(manifest.package.kind)) {
      errors.push(`Invalid package.kind: ${manifest.package.kind}`);
    }
    if (!manifest.package.version) errors.push('Missing package.version');
    if (!manifest.package.title) errors.push('Missing package.title');
    if (!manifest.package.license) errors.push('Missing package.license');
  }

  // Compatibility
  if (manifest.compatibility) {
    if (!manifest.compatibility.runtime_range) errors.push('Missing compatibility.runtime_range');
    if (!manifest.compatibility.schema_version) errors.push('Missing compatibility.schema_version');
    if (!Array.isArray(manifest.compatibility.supported_environments)) {
      errors.push('Missing compatibility.supported_environments');
    } else {
      for (const env of manifest.compatibility.supported_environments) {
        if (!VALID_ENVIRONMENTS.includes(env)) {
          errors.push(`Invalid environment: ${env}`);
        }
      }
    }
  }

  // Permissions
  if (manifest.permissions) {
    if (!manifest.permissions.risk_class || !VALID_RISK_CLASSES.includes(manifest.permissions.risk_class)) {
      errors.push(`Invalid permissions.risk_class: ${manifest.permissions.risk_class}`);
    }
    if (typeof manifest.permissions.declares_secrets !== 'boolean') {
      errors.push('permissions.declares_secrets must be boolean');
    }
  }

  // Integrity
  if (manifest.integrity) {
    if (!manifest.integrity.package_sha256) errors.push('Missing integrity.package_sha256');
  }

  // Warnings
  if (!manifest.previews?.readme_path) warnings.push('No readme_path in previews');
  if (!manifest.package?.summary) warnings.push('No package.summary — recommended for marketplace display');

  return { valid: errors.length === 0, errors, warnings };
}
