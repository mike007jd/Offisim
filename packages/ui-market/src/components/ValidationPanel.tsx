'use client';

// Simple inline manifest validation — intentionally does NOT import @aics/asset-schema
// to avoid pulling in AJV and Node-only dependencies into the browser bundle.

interface CheckResult {
  label: string;
  pass: boolean;
  message?: string;
}

function getField(obj: Record<string, unknown>, ...path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

const VALID_KINDS = ['employee', 'skill', 'sop', 'company_template', 'office_layout', 'bundle'];
const VALID_RISK_CLASSES = ['data_asset', 'logic_asset', 'privileged_asset'];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isValidSemverRange(v: unknown): boolean {
  if (!isNonEmptyString(v)) return false;
  // Accept simple patterns: plain semver, >= / <= / ^ / ~ ranges, * wildcard
  return /^[>=<^~*\s\d\.|x]+$/.test(v.trim());
}

function runChecks(manifest: Record<string, unknown>): CheckResult[] {
  return [
    {
      label: 'spec_version is present',
      pass: isNonEmptyString(manifest.spec_version),
      message: 'manifest.spec_version must be a non-empty string',
    },
    {
      label: 'package.id is present',
      pass: isNonEmptyString(getField(manifest, 'package', 'id')),
      message: 'manifest.package.id must be a non-empty string',
    },
    {
      label: 'package.kind is valid',
      pass: VALID_KINDS.includes(String(getField(manifest, 'package', 'kind') ?? '')),
      message: `manifest.package.kind must be one of: ${VALID_KINDS.join(', ')}`,
    },
    {
      label: 'package.title is present',
      pass: isNonEmptyString(getField(manifest, 'package', 'title')),
      message: 'manifest.package.title must be a non-empty string',
    },
    {
      label: 'package.version is present',
      pass: isNonEmptyString(getField(manifest, 'package', 'version')),
      message: 'manifest.package.version must be a non-empty string',
    },
    {
      label: 'package.license is present',
      pass: isNonEmptyString(getField(manifest, 'package', 'license')),
      message: 'manifest.package.license must be a non-empty string',
    },
    {
      label: 'compatibility.runtime_range is a valid semver range',
      pass: isValidSemverRange(getField(manifest, 'compatibility', 'runtime_range')),
      message: 'manifest.compatibility.runtime_range must be a valid semver range (e.g. >=0.1.0)',
    },
    {
      label: 'compatibility.supported_environments is declared',
      pass:
        Array.isArray(getField(manifest, 'compatibility', 'supported_environments')) &&
        (getField(manifest, 'compatibility', 'supported_environments') as unknown[]).length > 0,
      message: 'manifest.compatibility.supported_environments must have at least one entry',
    },
    {
      label: 'permissions.risk_class is declared',
      pass: VALID_RISK_CLASSES.includes(
        String(getField(manifest, 'permissions', 'risk_class') ?? ''),
      ),
      message: `manifest.permissions.risk_class must be one of: ${VALID_RISK_CLASSES.join(', ')}`,
    },
    {
      label: 'permissions.filesystem_scope is declared',
      pass: isNonEmptyString(getField(manifest, 'permissions', 'filesystem_scope')),
      message: 'manifest.permissions.filesystem_scope must be set',
    },
    {
      label: 'permissions.network_scope is declared',
      pass: isNonEmptyString(getField(manifest, 'permissions', 'network_scope')),
      message: 'manifest.permissions.network_scope must be set',
    },
    {
      label: 'integrity.package_sha256 is present',
      pass: isNonEmptyString(getField(manifest, 'integrity', 'package_sha256')),
      message: 'manifest.integrity.package_sha256 must be a non-empty string',
    },
    {
      label: 'No embedded secrets detected',
      // Check for common secret-like keys in the top-level manifest
      pass: !JSON.stringify(manifest)
        .toLowerCase()
        .match(/"(api_key|secret|password|token|private_key)"\s*:/),
      message: 'Manifest appears to contain embedded secrets. Remove all secrets before publishing.',
    },
  ];
}

export interface ValidationPanelProps {
  manifest: Record<string, unknown>;
}

export function ValidationPanel({ manifest }: ValidationPanelProps) {
  const checks = runChecks(manifest);
  const failCount = checks.filter((c) => !c.pass).length;
  const allPass = failCount === 0;

  return (
    <div className="space-y-4">
      {/* Overall status */}
      <div
        className={`rounded-md px-4 py-3 text-sm font-medium ${
          allPass
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}
      >
        {allPass ? 'Ready to submit — all checks passed.' : `${failCount} issue${failCount !== 1 ? 's' : ''} found. Fix before submitting.`}
      </div>

      {/* Check list */}
      <ul className="space-y-2">
        {checks.map((check) => (
          <li key={check.label} className="flex items-start gap-2 text-sm">
            <span
              className={`mt-0.5 flex-shrink-0 text-base leading-none ${check.pass ? 'text-green-500' : 'text-red-500'}`}
              aria-hidden="true"
            >
              {check.pass ? '✓' : '✗'}
            </span>
            <span className={check.pass ? 'text-gray-700' : 'text-gray-900 font-medium'}>
              {check.label}
              {!check.pass && check.message && (
                <span className="ml-1 font-normal text-red-600">— {check.message}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Re-export so callers can run validation imperatively */
export function validateManifestClient(manifest: Record<string, unknown>): {
  valid: boolean;
  failCount: number;
} {
  const checks = runChecks(manifest);
  const failCount = checks.filter((c) => !c.pass).length;
  return { valid: failCount === 0, failCount };
}
