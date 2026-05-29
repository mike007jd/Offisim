/**
 * Integrity checker — verify package and per-file hashes.
 *
 * Compares computed hashes from ExtractedPackage against:
 * 1. An optional expectedHash (e.g. from registry metadata)
 * 2. Per-file hashes declared in manifest.integrity.files
 */

import type { ExtractedPackage, IntegrityResult } from './types.js';

// ---------------------------------------------------------------------------
// Hashing helper
// ---------------------------------------------------------------------------

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
  const fileHashErrors: string[] = [];
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

  // 2. Verify per-file hashes from manifest.integrity.files
  const declaredFiles = extracted.manifest.integrity.files;
  if (declaredFiles) {
    for (const entry of declaredFiles) {
      const fileData = extracted.files.get(entry.path);
      if (!fileData) {
        fileHashErrors.push(entry.path);
        continue;
      }
      const actualHash = await sha256Hex(fileData);
      if (actualHash !== entry.sha256.toLowerCase()) {
        fileHashErrors.push(entry.path);
      }
    }
  }

  const valid = packageHashMatch && fileHashErrors.length === 0;

  return {
    valid,
    packageHashMatch,
    fileHashErrors,
  };
}
