import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const MAX_BASE64_CHARS = Math.ceil(MAX_ARTIFACT_BYTES / 3) * 4 + 4;

export interface DecodedArtifact {
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly size_bytes: number;
}

export function decodeRegistryArtifactBase64(raw: string): DecodedArtifact {
  const normalized = raw.trim();
  if (!normalized) {
    throw new Error('artifact.bytes_base64 is required for registry object upload');
  }
  if (normalized.length > MAX_BASE64_CHARS) {
    throw new Error(`artifact.bytes_base64 exceeds ${MAX_ARTIFACT_BYTES} byte maximum`);
  }
  if (!BASE64_REGEX.test(normalized)) {
    throw new Error('artifact.bytes_base64 must be valid base64');
  }

  const buffer = Buffer.from(normalized, 'base64');
  if (buffer.byteLength <= 0) {
    throw new Error('artifact.bytes_base64 decoded to an empty artifact');
  }
  if (buffer.byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error(`artifact bytes exceed ${MAX_ARTIFACT_BYTES} byte maximum`);
  }

  return {
    bytes: new Uint8Array(buffer),
    sha256: sha256Hex(buffer),
    size_bytes: buffer.byteLength,
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function persistRegistryArtifact(
  packageVersionId: string,
  bytesBase64: string,
): Promise<DecodedArtifact> {
  const decoded = decodeRegistryArtifactBase64(bytesBase64);
  const dir = registryArtifactDir();
  await mkdir(dir, { recursive: true });
  const finalPath = registryArtifactPath(packageVersionId);
  const tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmpPath, decoded.bytes);
  await rename(tmpPath, finalPath);
  return decoded;
}

export async function getRegistryArtifact(
  packageVersionId: string,
): Promise<DecodedArtifact | undefined> {
  try {
    const bytes = await readFile(registryArtifactPath(packageVersionId));
    return {
      bytes: new Uint8Array(bytes),
      sha256: sha256Hex(bytes),
      size_bytes: bytes.byteLength,
    };
  } catch {
    return undefined;
  }
}

export function registryArtifactPublicUrl(packageVersionId: string): string {
  const publicUrl =
    process.env.PLATFORM_PUBLIC_URL ??
    process.env.OFFISIM_PLATFORM_PUBLIC_URL ??
    `http://localhost:${process.env.PORT ?? '4100'}`;
  return `${publicUrl.replace(/\/$/u, '')}/v1/install/artifacts/${encodeURIComponent(packageVersionId)}`;
}

function registryArtifactPath(packageVersionId: string): string {
  return join(registryArtifactDir(), `${safeFileName(packageVersionId)}.offisimpkg`);
}

function registryArtifactDir(): string {
  return (
    process.env.OFFISIM_REGISTRY_ARTIFACT_DIR ??
    join(process.cwd(), '.offisim-platform', 'artifacts')
  );
}

function safeFileName(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._-]/gu, '_');
}
