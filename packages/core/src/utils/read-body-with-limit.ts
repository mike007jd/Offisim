// One streaming byte-cap reader for the outbound HTTP tool/transport lanes
// (web-search, web-fetch, a2a). Each lane previously carried a byte-identical
// content-length-precheck + getReader-accumulate loop that drifted only in its
// error string and empty-body handling; this is the single source of truth.

export interface ReadBodyWithByteLimitOptions {
  /** Message thrown both on the content-length precheck and on streaming overflow. */
  readonly tooLargeMessage: string;
  /** Reason passed to reader.cancel(...) when the stream exceeds maxBytes. */
  readonly cancelReason: string;
  /**
   * How to handle a response with no readable body stream:
   *  - 'return-empty' (default): return '' (web-fetch / a2a).
   *  - 'read-text': fall back to response.text() and re-validate against the
   *    cap (web-search, whose provider may not stream).
   */
  readonly emptyBody?: 'return-empty' | 'read-text';
}

export async function readBodyWithByteLimit(
  response: Response,
  maxBytes: number,
  options: ReadBodyWithByteLimitOptions,
): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const bytes = Number(contentLength);
    if (Number.isFinite(bytes) && bytes > maxBytes) {
      throw new Error(options.tooLargeMessage);
    }
  }
  if (!response.body) {
    if (options.emptyBody === 'read-text') {
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > maxBytes) {
        throw new Error(options.tooLargeMessage);
      }
      return text;
    }
    return '';
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel(options.cancelReason);
        throw new Error(options.tooLargeMessage);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}
