import type { PackageManifest, RiskClass } from '@offisim/asset-schema';
import type { EmployeeRow } from '@offisim/core/browser';
import { zipSync } from 'fflate';

export interface PublishMeta {
  readonly title: string;
  readonly summary: string;
  readonly description: string;
  readonly version: string;
  readonly tags: readonly string[];
  readonly license: string;
  readonly riskClass: RiskClass;
  readonly filesystemScope?: 'none' | 'workspace' | 'project' | 'custom_path';
  readonly networkScope?: 'none' | 'limited' | 'unrestricted';
  readonly creatorHandle?: string;
  readonly creatorDisplayName?: string;
  readonly artifactUrl?: string;
}

export interface PackageExportBundle {
  readonly fileName: string;
  readonly manifest: PackageManifest;
  readonly archiveBytes: Uint8Array;
}

type ExportedFiles = Record<string, Uint8Array>;

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'package';
}

function encodeJson(data: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(data, null, 2));
}

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await globalThis.crypto.subtle.digest(
    'SHA-256',
    data as Uint8Array<ArrayBuffer>,
  );
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function buildIntegrityFiles(
  files: ExportedFiles,
): Promise<Array<{ path: string; sha256: string }>> {
  const entries = await Promise.all(
    Object.entries(files).map(async ([path, bytes]) => ({
      path,
      sha256: await sha256Hex(bytes),
    })),
  );

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function buildBaseManifest(
  kind: PackageManifest['package']['kind'],
  packageId: string,
  meta: PublishMeta,
  assets: PackageManifest['assets'],
  custom: Record<string, unknown>,
  integrityFiles: Array<{ path: string; sha256: string }>,
): PackageManifest {
  return {
    spec_version: '1.0.0',
    package: {
      id: packageId,
      kind,
      version: meta.version.trim() || '0.1.0',
      title: meta.title.trim(),
      summary: meta.summary.trim(),
      license: meta.license.trim() || 'UNLICENSED',
      tags: meta.tags,
      publisher:
        meta.creatorHandle || meta.creatorDisplayName
          ? {
              ...(meta.creatorHandle ? { creator_handle: meta.creatorHandle } : {}),
              ...(meta.creatorDisplayName ? { display_name: meta.creatorDisplayName } : {}),
            }
          : undefined,
    },
    compatibility: {
      runtime_range: '>=1.0 <2.0',
      schema_version: '2026-03',
      supported_environments: ['desktop', 'web_limited'],
    },
    requirements: {
      required_capabilities: [],
      required_mcps: [],
    },
    permissions: {
      risk_class: meta.riskClass,
      declares_secrets: false,
      filesystem_scope: meta.filesystemScope ?? 'workspace',
      network_scope: meta.networkScope ?? 'none',
    },
    assets,
    distribution: meta.artifactUrl
      ? {
          source_url: meta.artifactUrl,
          mirror_policy: 'external_only',
        }
      : undefined,
    integrity: {
      package_sha256: '0'.repeat(64),
      files: integrityFiles,
    },
    previews: {
      readme_path: 'README.md',
    },
    custom,
  };
}

function buildReadme(meta: PublishMeta): string {
  const description = meta.description.trim() || meta.summary.trim();
  return `# ${meta.title.trim()}\n\n${description}\n`;
}

function buildEmployeeFiles(employee: EmployeeRow, slug: string, meta: PublishMeta): ExportedFiles {
  return {
    [`assets/employee.${slug}.json`]: encodeJson({
      employee_id: employee.employee_id,
      name: employee.name,
      role_slug: employee.role_slug,
      persona_json: employee.persona_json,
      config_json: employee.config_json,
      workstation_id: employee.workstation_id,
    }),
    'README.md': encodeText(buildReadme(meta)),
  };
}

export async function buildEmployeePackage(
  employee: EmployeeRow,
  meta: PublishMeta,
): Promise<PackageExportBundle> {
  const slug = slugify(`${employee.name}-${employee.role_slug}`);
  const files = buildEmployeeFiles(employee, slug, meta);
  const integrityFiles = await buildIntegrityFiles(files);
  const manifest = buildBaseManifest(
    'employee',
    `offisim.employee.${slug}`,
    meta,
    [
      {
        asset_id: slug,
        kind: 'employee',
        path: `assets/employee.${slug}.json`,
        default_enabled: true,
      },
    ],
    { marketplace_export_kind: 'employee', employee_role_slug: employee.role_slug },
    integrityFiles,
  );
  return {
    fileName: `${slug}-${manifest.package.version}.offisimpkg`,
    manifest,
    archiveBytes: zipSync({
      ...files,
      'manifest.json': encodeJson(manifest),
    }),
  };
}
