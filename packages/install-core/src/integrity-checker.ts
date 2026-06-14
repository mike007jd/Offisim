/**
 * Integrity checker — verify package and per-file hashes.
 *
 * Compares computed hashes from ExtractedPackage against:
 * 1. An optional expectedHash (e.g. from registry metadata)
 * 2. Per-file hashes declared in manifest.integrity.files
 */

import { sha256Hex } from './hash.js';
import type { ExtractedPackage, IntegrityResult } from './types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify the integrity of an extracted package.
 *
 * @param extracted - The extracted package with computed hashes and files.
 * @param expectedHash - Optional externally-expected package hash (e.g. from registry).
 * @returns IntegrityResult indicating validity and any errors found.
 */
export async function checkIntegrity(
  extracted: ExtractedPackage,
  expectedHash?: string,
): Promise<IntegrityResult> {
  let packageHashMatch = true;

  // 1. Verify package hash against external expectation
  // Compare case-insensitively: `extracted.packageHash` is lowercase hex, but a
  // registry-supplied `expectedHash` may be upper/mixed case — a case-sensitive
  // `!==` would false-flag a genuine match as tampering.
  if (expectedHash !== undefined) {
    if (extracted.packageHash !== expectedHash.toLowerCase()) {
      packageHashMatch = false;
    }
  }

  const declaredFiles = extracted.manifest.integrity.files;
  const fileHashErrors = declaredFiles
    ? (
        await Promise.all(
          declaredFiles.map(async (entry) => {
            const fileData = extracted.files.get(entry.path);
            if (!fileData) return entry.path;
            const actualHash = await sha256Hex(fileData);
            return actualHash === entry.sha256.toLowerCase() ? null : entry.path;
          }),
        )
      ).filter((path): path is string => path !== null)
    : [];

  const valid = packageHashMatch && fileHashErrors.length === 0;

  return {
    valid,
    packageHashMatch,
    fileHashErrors,
  };
}
