import type { ParsedAttachment } from '@offisim/shared-types';

const UTF8_DECODER_FATAL = new TextDecoder('utf-8', { fatal: true });
const UTF8_DECODER_LENIENT = new TextDecoder('utf-8', { fatal: false });

/**
 * Decode bytes as text. Try strict UTF-8 first; if invalid sequences are
 * detected, fall back to a lenient UTF-8 pass which substitutes U+FFFD for
 * malformed bytes — this keeps the parser deterministic instead of latching
 * a Latin-1 reinterpretation that would corrupt valid multi-byte sequences in
 * mixed-encoding files.
 */
export function parseText(bytes: Uint8Array): ParsedAttachment {
  let text: string;
  try {
    text = UTF8_DECODER_FATAL.decode(bytes);
  } catch {
    text = UTF8_DECODER_LENIENT.decode(bytes);
  }
  return { kind: 'text', text };
}
