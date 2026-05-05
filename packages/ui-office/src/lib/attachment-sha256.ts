/**
 * SHA-256 helper used by the composer to dedupe staged files and to seal
 * `AttachmentMeta.sha256`. Backed by `crypto.subtle.digest` which already runs
 * off-thread in modern engines — wrapping in a Web Worker would add boilerplate
 * without measurable benefit at the 8 MB attachment ceiling.
 */
export async function computeSha256(bytes: Uint8Array): Promise<string> {
  // crypto.subtle accepts BufferSource. We slice to detach from any
  // SharedArrayBuffer-backed view that wouldn't satisfy the strict typing.
  const buf = bytes.slice().buffer as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const arr = new Uint8Array(digest);
  let out = '';
  for (let i = 0; i < arr.length; i += 1) {
    out += (arr[i] ?? 0).toString(16).padStart(2, '0');
  }
  return out;
}
