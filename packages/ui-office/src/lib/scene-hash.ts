/**
 * Deterministic hash utilities for scene-side seeding.
 * djb2-style string-to-uint32: stable, fast, no allocation.
 */

export function hashStringToInt(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
