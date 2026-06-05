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
