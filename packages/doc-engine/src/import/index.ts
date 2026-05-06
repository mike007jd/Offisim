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
 */
export async function parseAttachment(
  bytes: Uint8Array,
  mimeType: string,
  filename: string,
): Promise<ParsedAttachment> {
  void filename; // reserved for future heuristics (extension-based fallbacks)
  const kind = kindFromMime(mimeType);
  try {
    if (kind === 'pdf') return await parsePdf(bytes);
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
