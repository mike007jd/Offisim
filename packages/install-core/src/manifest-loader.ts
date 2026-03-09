/**
 * Manifest loader — extract and validate .aicspkg ZIP archives.
 *
 * Uses fflate for ZIP decompression and crypto.subtle for SHA-256 hashing.
 * Validation delegates to @aics/asset-schema's parseManifest (JSON Schema).
 */

import { unzipSync } from 'fflate';
import { parseManifest } from '@aics/asset-schema';
import type { ExtractedPackage } from './types.js';

// ---------------------------------------------------------------------------
// Hashing helper
// ---------------------------------------------------------------------------

/** Compute SHA-256 hex digest of the given bytes. */
async function sha256Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MANIFEST_FILENAME = 'manifest.json';

/**
 * Extract a `.aicspkg` ZIP archive, locate and validate `manifest.json`,
 * and compute integrity hashes.
 *
 * @throws {Error} If the archive is corrupt, manifest.json is missing, or
 *   the manifest fails JSON Schema validation.
 */
export async function extractPackage(archiveBytes: Uint8Array): Promise<ExtractedPackage> {
  // 1. Decompress ZIP
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(archiveBytes);
  } catch (err) {
    throw new Error(`Failed to decompress archive: ${err instanceof Error ? err.message : String(err)}`);
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
    throw new Error(`Failed to parse manifest JSON: ${err instanceof Error ? err.message : String(err)}`);
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
