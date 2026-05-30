import { type ParsedAttachment, kindFromMime } from '@offisim/shared-types';
import { bytesToBase64 } from './base64.js';
import { parseDocx } from './docx.js';
import { parseImage } from './image.js';
import { parsePdf } from './pdf.js';
import { parsePptx } from './pptx.js';
import { parseText } from './text.js';
import { parseXlsx } from './xlsx.js';

export type { ParsedAttachment } from '@offisim/shared-types';
export { resolvePdfWorkerSrc } from './worker-resolver.js';
export { bytesToBase64 } from './base64.js';
export { parseText } from './text.js';

/**
 * Single entry for client-side attachment parsing. Routes by `kindFromMime`,
 * funnels parser exceptions into `{ kind: 'unsupported', reason }` so the
 * composer chip and `read_attachment` tool can both render a typed
 * fallback instead of throwing into the runtime.
 *
 * Bytes are not consumed — callers retain ownership; parsers copy when needed.
 *
 * An optional `signal` is threaded into the sequential PDF page extraction so
 * a cancelled run can bail between pages instead of churning through a
 * multi-hundred-page document; aborted parses funnel into
 * `{ kind: 'unsupported', reason: 'aborted' }`.
 */
export async function parseAttachment(
  bytes: Uint8Array,
  mimeType: string,
  filename: string,
  signal?: AbortSignal,
): Promise<ParsedAttachment> {
  void filename; // reserved for future heuristics (extension-based fallbacks)
  const kind = kindFromMime(mimeType);
  try {
    if (kind === 'pdf') return await parsePdf(bytes, signal);
    if (kind === 'docx') return await parseDocx(bytes);
    if (kind === 'xlsx') return await parseXlsx(bytes);
    if (kind === 'pptx') return await parsePptx(bytes);
    if (kind === 'image') return await parseImage(bytes, mimeType);
    if (kind === 'code' || kind === 'data' || kind === 'document') {
      return parseText(bytes);
    }
    return { kind: 'binary', base64: bytesToBase64(bytes) };
  } catch (err) {
    return {
      kind: 'unsupported',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
