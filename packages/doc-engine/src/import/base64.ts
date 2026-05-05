/**
 * Cross-runtime base64 encoder for binary attachment payloads. Node uses
 * `Buffer.from(...).toString('base64')`; browser/webview falls back to
 * chunked `btoa` over a binary string. Centralized so the doc-engine importer,
 * the core attachment tool, and any future binary-passthrough call site share
 * one implementation.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const maybeBuffer = (
    globalThis as unknown as {
      Buffer?: { from(b: Uint8Array): { toString(enc: string): string } };
    }
  ).Buffer;
  if (maybeBuffer) return maybeBuffer.from(bytes).toString('base64');
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    for (let j = 0; j < chunk.length; j += 1) binary += String.fromCharCode(chunk[j] ?? 0);
  }
  return btoa(binary);
}
