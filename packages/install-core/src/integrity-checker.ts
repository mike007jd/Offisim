/**
 * Integrity checker — verify package and per-file hashes.
 *
 * Compares computed hashes from ExtractedPackage against:
 * 1. An optional expectedHash (e.g. from registry metadata)
 * 2. Per-file hashes declared in manifest.integrity.files
 */

import { manifestFileDigestAnchor, sha256Hex } from './hash.js';
import type { ExtractedPackage, IntegrityResult } from './types.js';

// The manifest itself is never listed in `integrity.files` (it would have to
// hash itself), so it is the one archive entry allowed to be undeclared.
const MANIFEST_FILENAME = 'manifest.json';

// Legacy placeholder some pre-existing packages still carry in
// `integrity.package_sha256`. Treated as "no real anchor declared" so the
// real-anchor check stays backward-compatible instead of false-flagging them.
const LEGACY_PLACEHOLDER_ANCHOR = '0'.repeat(64);

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
  let packageHashMatchBase = true;

  // 1. Verify package hash against external expectation
  // Compare case-insensitively: `extracted.packageHash` is lowercase hex, but a
  // registry-supplied `expectedHash` may be upper/mixed case — a case-sensitive
  // `!==` would false-flag a genuine match as tampering.
  if (expectedHash !== undefined) {
    if (extracted.packageHash !== expectedHash.toLowerCase()) {
      packageHashMatchBase = false;
    }
  }

  const declaredFiles = extracted.manifest.integrity.files;
  const declaredPaths = new Set((declaredFiles ?? []).map((entry) => entry.path));
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

  // Reject undeclared/extra files: every extracted entry (other than the
  // self-referential manifest) MUST be covered by an `integrity.files` hash.
  // Without this, a tampered archive could smuggle in extra payload files that
  // pass the declared-hash loop because nothing references them.
  for (const path of extracted.files.keys()) {
    if (path === MANIFEST_FILENAME) continue;
    if (!declaredPaths.has(path)) {
      fileHashErrors.push(path);
    }
  }

  // Verify `package_sha256` as a REAL anchor (it was previously inert — a
  // placeholder that merely had sha256 shape). The builder writes the digest of
  // the declared file-hash set; recompute it and require a match. A tampered
  // manifest that swaps file hashes or the anchor itself is caught here.
  let packageHashMatch = packageHashMatchBase;
  const declaredAnchor = extracted.manifest.integrity.package_sha256.toLowerCase();
  if (declaredAnchor === LEGACY_PLACEHOLDER_ANCHOR) {
    // The all-zeros placeholder declares NO real anchor. Accept it ONLY when an
    // external hash (`expectedHash` — the registry's transit gate) verifies the
    // bytes; with no external gate (e.g. local import) it is unverifiable. Else a
    // crafted package could set all-zeros to skip the anchor check and self-attest
    // tampered per-file hashes (M2 bypass).
    if (expectedHash === undefined) {
      packageHashMatch = false;
    }
  } else {
    const expectedAnchor = await manifestFileDigestAnchor(declaredFiles ?? []);
    if (declaredAnchor !== expectedAnchor) {
      packageHashMatch = false;
    }
  }

  const valid = packageHashMatch && fileHashErrors.length === 0;

  return {
    valid,
    packageHashMatch,
    fileHashErrors,
  };
}
