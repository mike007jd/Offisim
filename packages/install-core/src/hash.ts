/**
 * Shared SHA-256 hex-digest helper for install-core (integrity check, manifest
 * load, package build all need the identical digest). Previously copy-pasted in
 * three files with drifting guards; this is the single source.
 */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('Package artifact hashing requires Web Crypto.');
  }
  const hashBuffer = await subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

/**
 * Deterministic content anchor over a package's declared per-file hashes.
 *
 * `manifest.integrity.package_sha256` is NOT the archive's own byte hash — the
 * archive embeds the manifest, which would have to contain its own hash. Instead
 * it anchors the *set* of declared file digests: sha256 over the sorted
 * `path\nsha256` lines of `integrity.files`. The builder writes this value and
 * the integrity checker recomputes it, so the field is a genuinely verified
 * anchor rather than a placeholder that merely looks like a sha256.
 */
export async function manifestFileDigestAnchor(
  files: readonly { readonly path: string; readonly sha256: string }[],
): Promise<string> {
  const canonical = [...files]
    .map((entry) => `${entry.path}\n${entry.sha256.toLowerCase()}`)
    .sort()
    .join('\n');
  return sha256Hex(new TextEncoder().encode(canonical));
}
