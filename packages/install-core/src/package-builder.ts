import {
  type AssetKind,
  type FilesystemScope,
  MATERIALIZER_PAYLOADS_KEY,
  type NetworkScope,
  type PackageManifest,
  type RiskClass,
  type SupportedEnvironment,
  validateManifest,
} from '@offisim/asset-schema';
import { zipSync } from 'fflate';
import { manifestFileDigestAnchor, sha256Hex } from './hash.js';

export interface BuildPackageArtifactInput {
  readonly packageId: string;
  readonly assetId: string;
  readonly kind: AssetKind;
  readonly title: string;
  readonly summary: string;
  readonly description?: string;
  readonly version: string;
  readonly license: string;
  readonly tags: readonly string[];
  readonly publisher?: {
    readonly creatorHandle?: string;
    readonly displayName?: string;
  };
  readonly runtimeRange?: string;
  readonly schemaVersion?: string;
  readonly supportedEnvironments?: readonly SupportedEnvironment[];
  readonly riskClass: RiskClass;
  readonly filesystemScope: FilesystemScope;
  readonly networkScope: NetworkScope;
  readonly requiredCapabilities?: readonly string[];
  readonly requiredMcps?: readonly string[];
  readonly assetPath: string;
  readonly assetBody: string | Uint8Array;
  readonly extraFiles?: Readonly<Record<string, string | Uint8Array>>;
  readonly materializerPayload?: Readonly<Record<string, unknown>>;
  readonly recommendedModels?: readonly { readonly profile: string; readonly reason?: string }[];
  readonly lineage?: {
    readonly originPackageId?: string;
    readonly forkedFromVersion?: string;
    readonly derivativeOf?: readonly string[];
  };
  readonly customManifest?: Readonly<Record<string, unknown>>;
}

export interface BuiltPackageArtifact {
  readonly manifest: PackageManifest;
  readonly zipBytes: Uint8Array;
  readonly packageSha256: string;
  readonly sizeBytes: number;
}

type ExportedFiles = Record<string, Uint8Array>;

function encodeText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function encodeJson(data: unknown): Uint8Array {
  return encodeText(`${JSON.stringify(data, null, 2)}\n`);
}

function coerceBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? encodeText(value) : value;
}

function assertPackageArchivePath(
  path: string,
  label: string,
  allowedPrefixes: readonly string[],
): string {
  if (
    path.length === 0 ||
    path !== path.trim() ||
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[A-Za-z]:/.test(path) ||
    path.includes('\\')
  ) {
    throw new Error(`${label} '${path}' must be a relative POSIX archive path.`);
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`${label} '${path}' must not contain empty, '.', or '..' path segments.`);
  }
  if (!allowedPrefixes.some((prefix) => path.startsWith(prefix))) {
    throw new Error(`${label} '${path}' must start with ${allowedPrefixes.join(' or ')}.`);
  }
  return path;
}

function buildReadme(input: BuildPackageArtifactInput): string {
  const body = input.description?.trim() || input.summary.trim();
  return `# ${input.title}\n\n${body}\n`;
}

export function artifactBytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  if (typeof btoa === 'function') return btoa(binary);
  const bufferCtor = (
    globalThis as {
      Buffer?: { from(data: string, enc: string): { toString(enc: string): string } };
    }
  ).Buffer;
  if (bufferCtor) return bufferCtor.from(binary, 'binary').toString('base64');
  throw new Error('Package artifact base64 encoding is unavailable.');
}

export async function buildPackageArtifact(
  input: BuildPackageArtifactInput,
): Promise<BuiltPackageArtifact> {
  const assetPath = assertPackageArchivePath(input.assetPath, 'Package asset path', ['assets/']);
  const extraFiles: ExportedFiles = {};
  for (const [rawPath, body] of Object.entries(input.extraFiles ?? {})) {
    const path = assertPackageArchivePath(rawPath, 'Package extra file path', [
      'assets/',
      'previews/',
    ]);
    if (path === assetPath) {
      throw new Error(`Package extra file path '${path}' must not overwrite the primary asset.`);
    }
    extraFiles[path] = coerceBytes(body);
  }

  const readmeBytes = encodeText(buildReadme(input));
  const assetBytes: ExportedFiles = {
    [assetPath]: coerceBytes(input.assetBody),
    ...extraFiles,
  };
  const integrityInputs: ExportedFiles = {
    'README.md': readmeBytes,
    ...assetBytes,
  };

  const integrityFiles = (
    await Promise.all(
      Object.entries(integrityInputs).map(async ([path, bytes]) => ({
        path,
        sha256: await sha256Hex(bytes),
      })),
    )
  ).sort((a, b) => a.path.localeCompare(b.path));

  // Real content anchor over the declared file digests (see hash.ts). Replaces
  // the former all-zeros placeholder so `package_sha256` is a verifiable anchor.
  const packageContentAnchor = await manifestFileDigestAnchor(integrityFiles);

  const materializerPayloads = input.materializerPayload
    ? {
        [MATERIALIZER_PAYLOADS_KEY]: {
          [input.assetId]: input.materializerPayload,
        },
      }
    : {};

  const manifest: PackageManifest = {
    spec_version: '1.0.0',
    package: {
      id: input.packageId,
      kind: input.kind,
      version: input.version,
      title: input.title,
      summary: input.summary,
      license: input.license,
      publisher: {
        creator_handle: input.publisher?.creatorHandle,
        display_name: input.publisher?.displayName,
      },
      tags: [...input.tags],
    },
    compatibility: {
      runtime_range: input.runtimeRange ?? '>=0.1 <2.0',
      schema_version: input.schemaVersion ?? '2026-03',
      supported_environments: input.supportedEnvironments ?? ['desktop', 'web_limited'],
    },
    requirements: {
      required_capabilities: [...(input.requiredCapabilities ?? [])],
      required_mcps: [...(input.requiredMcps ?? [])],
      ...(input.recommendedModels
        ? {
            recommended_models: input.recommendedModels.map((model) => ({
              profile: model.profile,
              ...(model.reason ? { reason: model.reason } : {}),
            })),
          }
        : {}),
    },
    permissions: {
      risk_class: input.riskClass,
      declares_secrets: false,
      filesystem_scope: input.filesystemScope,
      network_scope: input.networkScope,
    },
    assets: [
      {
        asset_id: input.assetId,
        kind: input.kind,
        path: assetPath,
        default_enabled: true,
      },
    ],
    integrity: {
      package_sha256: packageContentAnchor,
      files: integrityFiles,
    },
    ...(input.lineage
      ? {
          lineage: {
            ...(input.lineage.originPackageId
              ? { origin_package_id: input.lineage.originPackageId }
              : {}),
            ...(input.lineage.forkedFromVersion
              ? { forked_from_version: input.lineage.forkedFromVersion }
              : {}),
            ...(input.lineage.derivativeOf
              ? { derivative_of: [...input.lineage.derivativeOf] }
              : {}),
          },
        }
      : {}),
    previews: {
      readme_path: 'README.md',
    },
    custom: {
      marketplace_export_kind: input.kind,
      ...materializerPayloads,
      ...input.customManifest,
    },
  };

  const validation = validateManifest(manifest);
  if (!validation.valid) {
    const detail = validation.errors?.map((e) => `${e.path}: ${e.message}`).join('; ') ?? 'unknown';
    throw new Error(`Package manifest failed validation: ${detail}`);
  }

  const zipBytes = zipSync({
    'manifest.json': encodeJson(manifest),
    'README.md': readmeBytes,
    ...assetBytes,
  });

  return {
    manifest,
    zipBytes,
    packageSha256: await sha256Hex(zipBytes),
    sizeBytes: zipBytes.byteLength,
  };
}
