import type { ParsedAttachment } from '@offisim/shared-types';
import { assertArchiveInflationBudget } from './safe-archive.js';

export async function parseDocx(bytes: Uint8Array): Promise<ParsedAttachment> {
  // mammoth inflates the whole docx (a ZIP) internally with no size hook, so
  // prove the inflated size is bounded BEFORE handing it the bytes — a bomb
  // throws here and never reaches mammoth.
  assertArchiveInflationBudget(bytes);
  const mammoth = await import('mammoth');
  // mammoth wires options differently per env: browser wants `arrayBuffer`,
  // Node wants `buffer` (real Node Buffer). We pass whichever the runtime
  // supports and avoid a SharedArrayBuffer escape via slice().
  const sliced = bytes.slice();
  const input: Record<string, unknown> = {};
  if (typeof Buffer !== 'undefined') {
    input.buffer = Buffer.from(sliced);
  } else {
    input.arrayBuffer = sliced.buffer as ArrayBuffer;
  }
  type ExtractInput = Parameters<typeof mammoth.extractRawText>[0];
  type ConvertInput = Parameters<typeof mammoth.convertToHtml>[0];
  const textResult = await mammoth.extractRawText(input as unknown as ExtractInput);
  const htmlResult = await mammoth.convertToHtml(input as unknown as ConvertInput);
  if (textResult.messages.length > 0) {
    // Surfaced as debug-only — non-fatal warnings (style maps, unsupported
    // features) shouldn't block the parse.
    if (typeof console !== 'undefined') {
      console.debug('[doc-engine] mammoth warnings:', textResult.messages);
    }
  }
  return {
    kind: 'docx',
    text: textResult.value ?? '',
    html: htmlResult.value ?? '',
  };
}
