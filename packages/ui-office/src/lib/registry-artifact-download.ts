import type { ArtifactDownloadInfo } from '@offisim/registry-client';

export const REGISTRY_ARTIFACT_MAX_BYTES = 50 * 1024 * 1024;
export const REGISTRY_ARTIFACT_TIMEOUT_MS = 30_000;

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
export interface RegistryArtifactDownloadOptions {
  trustedOrigins?: readonly string[];
}

export async function downloadRegistryArtifact(
  downloadInfo: ArtifactDownloadInfo,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch.bind(globalThis),
  options: RegistryArtifactDownloadOptions = {},
): Promise<Blob> {
  const url = parseRegistryArtifactUrl(downloadInfo.artifact_url, options.trustedOrigins);
  const expectedSize = normalizeExpectedArtifactSize(downloadInfo.artifact_size_bytes);
  if (expectedSize !== null && expectedSize > REGISTRY_ARTIFACT_MAX_BYTES) {
    throw new Error(`Package exceeds maximum allowed size of ${formatBytes(REGISTRY_ARTIFACT_MAX_BYTES)}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REGISTRY_ARTIFACT_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      redirect: 'manual',
      signal: controller.signal,
    });

    if (REDIRECT_STATUS_CODES.has(response.status)) {
      throw new Error('Package download redirects are not allowed');
    }
    if (!response.ok) {
      throw new Error(`Failed to download package: ${response.statusText}`);
    }

    return await readArtifactBlobWithLimit(response, expectedSize);
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseRegistryArtifactUrl(rawUrl: string, trustedOrigins: readonly string[] = []): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid artifact URL');
  }

  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new Error(`Unsafe artifact URL protocol: ${url.protocol}`);
  }
  if (isTrustedOrigin(url, trustedOrigins)) {
    return url;
  }
  throw new Error('External artifact URL must be served by the trusted registry origin');
}

function isTrustedOrigin(url: URL, trustedOrigins: readonly string[]): boolean {
  return trustedOrigins.some((origin) => {
    try {
      return new URL(origin).origin === url.origin;
    } catch {
      return false;
    }
  });
}

function normalizeExpectedArtifactSize(size: number | null): number | null {
  if (size === null) return null;
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('Invalid artifact size metadata');
  }
  return size;
}

async function readArtifactBlobWithLimit(
  response: Response,
  expectedSize: number | null,
): Promise<Blob> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const parsed = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsed)) {
      validateArtifactSize(parsed, expectedSize);
    }
  }

  if (!response.body) {
    throw new Error('Package download response did not expose a readable stream');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      validateArtifactSize(total, expectedSize, { partial: true });
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  validateArtifactSize(total, expectedSize);
  return new Blob(chunks.map(toArrayBuffer), { type: 'application/octet-stream' });
}

function validateArtifactSize(
  size: number,
  expectedSize: number | null,
  options?: { partial?: boolean },
): void {
  if (size > REGISTRY_ARTIFACT_MAX_BYTES) {
    throw new Error(`Package exceeds maximum allowed size of ${formatBytes(REGISTRY_ARTIFACT_MAX_BYTES)}`);
  }
  if (expectedSize !== null && size > expectedSize) {
    throw new Error('Package download exceeded declared artifact size');
  }
  if (!options?.partial && expectedSize !== null && size !== expectedSize) {
    throw new Error('Package download size does not match artifact metadata');
  }
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function toArrayBuffer(chunk: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(chunk.byteLength);
  copy.set(chunk);
  return copy.buffer;
}
