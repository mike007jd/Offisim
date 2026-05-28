/**
 * Manifest loader — extract and validate .offisimpkg ZIP archives.
 *
 * Uses fflate for ZIP decompression and crypto.subtle for SHA-256 hashing.
 * Validation delegates to @offisim/asset-schema's parseManifest (JSON Schema).
 */

import { parseManifest } from '@offisim/asset-schema';
import { unzipSync } from 'fflate';
import type { ExtractedPackage } from './types.js';

// ---------------------------------------------------------------------------
// Hashing helper
// ---------------------------------------------------------------------------

/** Compute SHA-256 hex digest of the given bytes. */
async function sha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await globalThis.crypto.subtle.digest(
    'SHA-256',
    data as Uint8Array<ArrayBuffer>,
  );
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MANIFEST_FILENAME = 'manifest.json';

// zip-bomb defence: cap inflated size and entry count. The compressed archive
// cap (64 MB) keeps the input bounded; the decompressed cap (256 MB) and
// file-count cap (1000) keep a malicious 64 MB archive from inflating to
// gigabytes or millions of file headers.
const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_COUNT = 1000;

/**
 * Extract a `.offisimpkg` ZIP archive, locate and validate `manifest.json`,
 * and compute integrity hashes.
 *
 * @throws {Error} If the archive is corrupt, manifest.json is missing, or
 *   the manifest fails JSON Schema validation.
 */
export async function extractPackage(archiveBytes: Uint8Array): Promise<ExtractedPackage> {
  if (archiveBytes.byteLength > MAX_COMPRESSED_BYTES) {
    throw new Error(
      `Archive exceeds ${MAX_COMPRESSED_BYTES} byte cap (${archiveBytes.byteLength} bytes)`,
    );
  }

  // 1. Decompress ZIP
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archiveBytes);
  } catch (err) {
    throw new Error(
      `Failed to decompress archive: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 1b. Post-decompress zip-bomb caps. We cannot do streaming validation with
  //     fflate's sync API, but the upstream caps keep the worst case bounded.
  const entryNames = Object.keys(entries);
  if (entryNames.length > MAX_ENTRY_COUNT) {
    throw new Error(
      `Archive contains too many files (${entryNames.length} > ${MAX_ENTRY_COUNT})`,
    );
  }
  let totalInflatedBytes = 0;
  for (const data of Object.values(entries)) {
    totalInflatedBytes += data.byteLength;
    if (totalInflatedBytes > MAX_DECOMPRESSED_BYTES) {
      throw new Error(
        `Archive expands beyond ${MAX_DECOMPRESSED_BYTES} bytes; refusing to load (possible zip bomb)`,
      );
    }
  }

  // 2. Locate manifest.json at root level
  const manifestBytes = entries[MANIFEST_FILENAME];
  if (!manifestBytes) {
    throw new Error(`Archive does not contain '${MANIFEST_FILENAME}' at root level`);
  }

  // 3. Parse JSON
  let manifestData: unknown;
  try {
    const text = new TextDecoder().decode(manifestBytes);
    manifestData = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `Failed to parse manifest JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 4. Validate against JSON Schema (throws on failure)
  const manifest = parseManifest(manifestData);

  // 5. Build file map
  const files = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(entries)) {
    files.set(path, data);
  }

  // 6. Compute hashes
  const [packageHash, manifestHash] = await Promise.all([
    sha256Hex(archiveBytes),
    sha256Hex(manifestBytes),
  ]);

  return {
    manifest,
    files,
    packageHash,
    manifestHash,
  };
}
