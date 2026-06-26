import type { ChatToolCall } from '@/data/types.js';
import type { ThreadMessageLike } from '@assistant-ui/react';

/** The fields a chat message needs to project into assistant-ui content parts.
 *  Shared by the Office rail (`ChatMessage`) and the Workspace messenger
 *  (`WsMessage`), which carry the same author/body/reasoning/toolCalls subset. */
export interface AssistantPartSource {
  author: string;
  /** May be empty (reasoning/tool-only turns) or, on optimistic/streamed drafts,
   *  momentarily absent — always coerce before string ops. */
  body?: string;
  reasoning?: string;
  toolCalls?: ChatToolCall[];
}

/** True while the assistant is still thinking — reasoning/tools have streamed
 *  but the answer has not started. The Pi host streams the entire reasoning
 *  block before any answer text, so an empty body deterministically marks the
 *  think-first phase; the reasoning part stays expanded as a live "Thinking…"
 *  stage until the answer begins. */
function isAssistantThinking(message: { author: string; body?: string }): boolean {
  return message.author !== 'boss' && !(message.body ?? '').trim();
}

/** True while the reasoning block itself is the live, in-progress part: the
 *  answer body has not started AND no tool call has begun yet. Pi streams the
 *  whole reasoning block up front, so this is the pure think-first window — it
 *  drives the reasoning panel's live "Thinking…" peek, and flips false (→ the
 *  collapsed "Thought for Xs" summary) the moment the model moves on to a tool
 *  or the answer. Mirrors assistant-ui's "reasoning is running only while it is
 *  still the last streaming part" semantics, but off our own reliable stream. */
export function isReasoningStreaming(message: {
  author: string;
  body?: string;
  toolCalls?: ChatToolCall[];
}): boolean {
  return isAssistantThinking(message) && !(message.toolCalls?.length ?? 0);
}

/** Build the assistant-ui content parts for a message: reasoning part → tool
 *  steps → answer text. The text part is omitted during the think-first phase
 *  so the reasoning part renders as the live "Thinking…" stage before the
 *  answer streams in. Keeps both chat surfaces on one part contract. */
export function assembleAssistantContent(
  message: AssistantPartSource,
): ThreadMessageLike['content'] {
  const reasoning = message.author !== 'boss' ? message.reasoning?.trim() : '';
  const toolParts = (message.toolCalls ?? []).map((tool) => ({
    type: 'tool-call' as const,
    toolCallId: tool.id,
    toolName: tool.name,
    args: {},
    // A `result` slot marks the part complete; omit it while still running.
    ...(tool.status === 'running'
      ? {}
      : { result: { ok: tool.status === 'completed', durationMs: tool.durationMs } }),
  }));
  // Strip Loop reference tokens from the DISPLAYED text (PR-10). The persisted body
  // keeps the `[[loop:<id>]]` token (it pins the executed revision in history and is
  // the Enhance-protected anchor), but the transcript shows the Loop as a chip
  // (rendered separately in MessageItem), not raw token text.
  const body = stripDisplayLoopTokens(message.body ?? '');
  const hasThinkingParts = !!reasoning || toolParts.length > 0;
  return [
    ...(reasoning ? [{ type: 'reasoning' as const, text: reasoning }] : []),
    ...toolParts,
    ...(body || !hasThinkingParts ? [{ type: 'text' as const, text: body }] : []),
  ];
}

const DISPLAY_LOOP_TOKEN_RE = /\[\[loop:[A-Za-z0-9._-]+\]\]/g;

/** Remove loop tokens from text for display (collapsing the surrounding space). */
function stripDisplayLoopTokens(text: string): string {
  if (!text.includes('[[loop:')) return text;
  return text.replace(DISPLAY_LOOP_TOKEN_RE, '').replace(/\s{2,}/g, ' ').trim();
}
