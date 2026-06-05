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
import { sha256Hex } from './hash.js';

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
  readonly materializerPayload?: Readonly<Record<string, unknown>>;
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
  if (!input.assetPath.startsWith('assets/')) {
    throw new Error(`Package asset path '${input.assetPath}' must start with 'assets/'.`);
  }

  const readmeBytes = encodeText(buildReadme(input));
  const assetBytes: ExportedFiles = {
    [input.assetPath]: coerceBytes(input.assetBody),
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
        path: input.assetPath,
        default_enabled: true,
      },
    ],
    integrity: {
      package_sha256: '0'.repeat(64),
      files: integrityFiles,
    },
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
