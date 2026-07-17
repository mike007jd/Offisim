import type { LlmMessage } from '../../llm/gateway.js';

export interface MicroCompactOptions {
  readonly maxToolResultBytes?: number;
  readonly snippetBytes?: number;
  readonly preserveLastN?: number;
  /** Messages at and after this index are part of the protected current turn. */
  readonly protectFromIndex?: number;
}

export interface MicroCompactResult {
  readonly messages: readonly LlmMessage[];
  readonly compacted: number;
  readonly bytesSaved: number;
  readonly compactedToolCallIds: readonly string[];
}

const DEFAULT_MAX_TOOL_RESULT_BYTES = 8000;
const DEFAULT_SNIPPET_BYTES = 400;
const DEFAULT_PRESERVE_LAST_N = 1;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function byteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

// UTF-8 continuation bytes match 0b10xxxxxx; a code point starts on any other byte.
function isContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

// Take the first `maxBytes` UTF-8 bytes, snapping the end back to a code-point
// boundary so we never decode a split multibyte sequence into U+FFFD.
function headByteSlice(bytes: Uint8Array, maxBytes: number): Uint8Array {
  if (bytes.byteLength <= maxBytes) return bytes;
  let end = maxBytes;
  while (end > 0 && isContinuationByte(bytes[end] ?? 0)) end -= 1;
  return bytes.subarray(0, end);
}

// Take the last `maxBytes` UTF-8 bytes, snapping the start forward to a
// code-point boundary so the slice begins on a whole character.
function tailByteSlice(bytes: Uint8Array, maxBytes: number): Uint8Array {
  if (bytes.byteLength <= maxBytes) return bytes;
  let start = bytes.byteLength - maxBytes;
  while (start < bytes.byteLength && isContinuationByte(bytes[start] ?? 0)) start += 1;
  return bytes.subarray(start);
}

function buildCompactedContent(content: string, origBytes: number, snippetBytes: number): string {
  const bytes = textEncoder.encode(content);
  const head = textDecoder.decode(headByteSlice(bytes, snippetBytes));
  const tail = textDecoder.decode(tailByteSlice(bytes, snippetBytes));
  return `${head}\n\n[microcompacted ${origBytes} bytes]\n\n${tail}`;
}

export function microCompactMessages(
  messages: readonly LlmMessage[],
  opts: MicroCompactOptions = {},
): MicroCompactResult {
  const maxToolResultBytes = opts.maxToolResultBytes ?? DEFAULT_MAX_TOOL_RESULT_BYTES;
  const snippetBytes = opts.snippetBytes ?? DEFAULT_SNIPPET_BYTES;
  const preserveLastN = Math.max(0, opts.preserveLastN ?? DEFAULT_PRESERVE_LAST_N);
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  const protectFromIndex = Math.min(
    messages.length,
    Math.max(0, opts.protectFromIndex ?? (lastUserIndex >= 0 ? lastUserIndex : messages.length)),
  );
  const owningToolUses = new Map<string, number>();
  const eligibleToolResults: Array<{ index: number; toolCallId: string }> = [];

  for (let index = 0; index < protectFromIndex; index += 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === 'assistant') {
      for (const toolCall of message.toolCalls ?? []) owningToolUses.set(toolCall.id, index);
      continue;
    }
    if (
      message.role === 'tool' &&
      message.toolCallId &&
      (owningToolUses.get(message.toolCallId) ?? index) < index
    ) {
      eligibleToolResults.push({ index, toolCallId: message.toolCallId });
    }
  }

  const compactBefore = Math.max(0, eligibleToolResults.length - preserveLastN);
  let compactedMessages: LlmMessage[] | null = null;
  let compacted = 0;
  let bytesSaved = 0;
  const compactedToolCallIds: string[] = [];

  for (let i = 0; i < compactBefore; i++) {
    const candidate = eligibleToolResults[i];
    if (!candidate) continue;

    const message = messages[candidate.index];
    if (!message) continue;

    const origBytes = byteLength(message.content);
    if (origBytes <= maxToolResultBytes) continue;

    const nextContent = buildCompactedContent(message.content, origBytes, snippetBytes);
    compactedMessages ??= [...messages];
    compactedMessages[candidate.index] = {
      ...message,
      content: nextContent,
    };
    compacted += 1;
    bytesSaved += Math.max(0, origBytes - byteLength(nextContent));
    compactedToolCallIds.push(candidate.toolCallId);
  }

  return {
    messages: compactedMessages ?? messages,
    compacted,
    bytesSaved,
    compactedToolCallIds,
  };
}
