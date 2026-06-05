/**
 * Manifest loader — extract and validate .offisimpkg ZIP archives.
 *
 * Uses fflate for ZIP decompression and crypto.subtle for SHA-256 hashing.
 * Validation delegates to @offisim/asset-schema's parseManifest (JSON Schema).
 */

import { parseManifest } from '@offisim/asset-schema';
import { sha256Hex } from './hash.js';
import { ZipBombError, safeUnzipSync } from './safe-unzip.js';
import type { ExtractedPackage } from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MANIFEST_FILENAME = 'manifest.json';

// zip-bomb defence: caps are now enforced by `safeUnzipSync`, which streams the
// inflate and trips BEFORE allocating the gigabytes — unlike the old
// `unzipSync` + post-hoc size check, where the OOM had already happened by the
// time the check ran. Package archives can legitimately bundle multiple assets,
// so we allow a larger decompressed budget than the shared default.
const MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_COUNT = 1000;

/**
 * Extract a `.offisimpkg` ZIP archive, locate and validate `manifest.json`,
 * and compute integrity hashes.
 *
 * @throws {Error} If the archive is corrupt, manifest.json is missing, the
 *   manifest fails JSON Schema validation, or the archive trips a zip-bomb cap.
 */
export async function extractPackage(archiveBytes: Uint8Array): Promise<ExtractedPackage> {
  // 1. Decompress ZIP with streaming bomb caps.
  let entries: Record<string, Uint8Array>;
  try {
    entries = safeUnzipSync(archiveBytes, {
      maxCompressedBytes: MAX_COMPRESSED_BYTES,
      maxDecompressedBytes: MAX_DECOMPRESSED_BYTES,
      maxEntryBytes: MAX_ENTRY_BYTES,
      maxEntryCount: MAX_ENTRY_COUNT,
    });
  } catch (err) {
    if (err instanceof ZipBombError) throw err;
    throw new Error(
      `Failed to decompress archive: ${err instanceof Error ? err.message : String(err)}`,
    );
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
