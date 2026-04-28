import type { LlmMessage } from '../../llm/gateway.js';

export interface MicroCompactOptions {
  readonly maxToolResultBytes?: number;
  readonly snippetBytes?: number;
  readonly preserveLastN?: number;
}

export interface MicroCompactResult {
  readonly messages: readonly LlmMessage[];
  readonly compacted: number;
  readonly bytesSaved: number;
}

const DEFAULT_MAX_TOOL_RESULT_BYTES = 8000;
const DEFAULT_SNIPPET_BYTES = 400;
const DEFAULT_PRESERVE_LAST_N = 1;
const textEncoder = new TextEncoder();

function byteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

function buildCompactedContent(content: string, origBytes: number, snippetBytes: number): string {
  const head = content.slice(0, snippetBytes);
  const tail = content.slice(Math.max(0, content.length - snippetBytes));
  return `${head}\n\n[microcompacted ${origBytes} bytes]\n\n${tail}`;
}

export function microCompactMessages(
  messages: readonly LlmMessage[],
  opts: MicroCompactOptions = {},
): MicroCompactResult {
  const maxToolResultBytes = opts.maxToolResultBytes ?? DEFAULT_MAX_TOOL_RESULT_BYTES;
  const snippetBytes = opts.snippetBytes ?? DEFAULT_SNIPPET_BYTES;
  const preserveLastN = Math.max(0, opts.preserveLastN ?? DEFAULT_PRESERVE_LAST_N);
  const toolIndices = messages.flatMap((message, index) =>
    message.role === 'tool' ? [index] : [],
  );
  const compactBefore = Math.max(0, toolIndices.length - preserveLastN);
  let compactedMessages: LlmMessage[] | null = null;
  let compacted = 0;
  let bytesSaved = 0;

  for (let i = 0; i < compactBefore; i++) {
    const messageIndex = toolIndices[i];
    if (messageIndex == null) continue;

    const message = messages[messageIndex];
    if (!message) continue;

    const origBytes = byteLength(message.content);
    if (origBytes <= maxToolResultBytes) continue;

    const nextContent = buildCompactedContent(message.content, origBytes, snippetBytes);
    compactedMessages ??= [...messages];
    compactedMessages[messageIndex] = {
      ...message,
      content: nextContent,
    };
    compacted += 1;
    bytesSaved += Math.max(0, origBytes - byteLength(nextContent));
  }

  return {
    messages: compactedMessages ?? messages,
    compacted,
    bytesSaved,
  };
}
