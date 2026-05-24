import type { AppendMessage, ThreadMessageLike } from '@assistant-ui/react';
import type { ChatAttachmentRef } from '@offisim/shared-types';
import { useMemo } from 'react';
import { useStreamingContentForConversation } from '../../../runtime/use-streaming-content';
import type { ChatMessage, ChatToolCall } from '../chat-session-store';
import { useChatSessionStore } from '../chat-session-store';

/** Stable id for the synthetic in-flight streaming segment. */
export const STREAMING_MESSAGE_ID = '__offisim_streaming__';

const EMPTY_MESSAGES: readonly ChatMessage[] = [];

/**
 * Adapter-side message: the committed `ChatMessage` plus an `isRunning` marker
 * for the synthetic streaming segment so `convertMessage` can flag it
 * `{ type: 'running' }` to assistant-ui.
 */
export interface OffisimAdapterMessage extends ChatMessage {
  isRunning?: boolean;
}

/** Offisim-specific per-message metadata carried through assistant-ui. */
export interface OffisimMessageCustom {
  nodeName: string | null;
  runId: string | null;
  attachments: readonly ChatAttachmentRef[] | null;
  status: ChatMessage['status'] | null;
}

type OffisimContentPart =
  | { readonly type: 'reasoning'; readonly text: string }
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool-call';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly args: ToolCallJson;
      readonly argsText: string;
      readonly result?: ToolCallJson;
      readonly isError?: boolean;
    };

type ToolCallJson = Record<string, string | number | boolean | null>;

function attachmentType(ref: ChatAttachmentRef): 'image' | 'document' | 'file' {
  if (ref.kind === 'image' || ref.mimeType.startsWith('image/')) return 'image';
  if (
    ref.kind === 'document' ||
    ref.mimeType === 'application/pdf' ||
    ref.mimeType.includes('word') ||
    ref.mimeType.includes('spreadsheet') ||
    ref.mimeType.includes('presentation')
  ) {
    return 'document';
  }
  return 'file';
}

function toAssistantAttachment(ref: ChatAttachmentRef) {
  return {
    id: ref.attachmentId,
    type: attachmentType(ref),
    name: ref.filename,
    contentType: ref.mimeType,
    status: { type: 'complete' as const },
    content: [],
  };
}

/** Maps Offisim message state onto an assistant-ui `MessageStatus`. */
function resolveMessageStatus(message: OffisimAdapterMessage): ThreadMessageLike['status'] {
  if (message.isRunning) return { type: 'running' };
  switch (message.status) {
    case 'failed':
      return { type: 'incomplete', reason: 'error', error: 'Run failed.' };
    case 'interrupted':
      return { type: 'incomplete', reason: 'cancelled' };
    default:
      return { type: 'complete', reason: 'stop' };
  }
}

function toolCallArgs(call: ChatToolCall): ToolCallJson {
  return {
    toolType: call.toolType,
    evidenceClass: call.evidenceClass,
    ...(call.serverName ? { serverName: call.serverName } : {}),
  };
}

function toolCallResult(call: ChatToolCall): ToolCallJson | undefined {
  if (call.status === 'started') return undefined;
  return {
    status: call.status,
    ...(call.durationMs !== undefined ? { durationMs: call.durationMs } : {}),
    ...(call.errorType ? { errorType: call.errorType } : {}),
  };
}

function toAssistantToolCallPart(call: ChatToolCall): OffisimContentPart {
  const args = toolCallArgs(call);
  const result = toolCallResult(call);
  return {
    type: 'tool-call',
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    args,
    argsText: JSON.stringify(args),
    ...(result ? { result } : {}),
    ...(call.status === 'error' || call.status === 'denied' ? { isError: true } : {}),
  };
}

/**
 * `ChatMessage` → `ThreadMessageLike`. Keeps reasoning as a native reasoning
 * part, the body as a text part, maps Offisim terminal status onto assistant-ui
 * `MessageStatus`, and stashes Offisim domain fields (`nodeName` / `runId` /
 * `attachments`) in `metadata.custom` for the custom Message component (speaker
 * badge + attachment chips). Multi-speaker fidelity is preserved upstream by
 * keeping each finalized speaker segment as its own `ChatMessage`.
 */
export function convertOffisimMessage(message: OffisimAdapterMessage): ThreadMessageLike {
  const content: OffisimContentPart[] = [];
  if (message.role === 'assistant' && message.reasoning && message.reasoning.trim().length > 0) {
    content.push({ type: 'reasoning', text: message.reasoning });
  }
  if (message.content.trim().length > 0) {
    content.push({ type: 'text', text: message.content });
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    content.push(...message.toolCalls.map(toAssistantToolCallPart));
  }

  const status = message.role === 'assistant' ? resolveMessageStatus(message) : undefined;

  const custom: OffisimMessageCustom = {
    nodeName: message.nodeName ?? null,
    runId: message.runId ?? null,
    attachments: message.attachments ?? null,
    status: message.status ?? null,
  };

  return {
    role: message.role,
    content,
    id: message.id,
    ...(message.attachments && message.attachments.length > 0
      ? { attachments: message.attachments.map(toAssistantAttachment) }
      : {}),
    ...(typeof message.createdAt === 'number' ? { createdAt: new Date(message.createdAt) } : {}),
    ...(status ? { status } : {}),
    metadata: { custom: custom as unknown as Record<string, unknown> },
  };
}

/**
 * Selects the message list for a `conversationKey` and appends the in-flight
 * streaming segment as a synthetic running assistant-ui message so the SSOT
 * (zustand store + event-driven streaming reducer) stays unchanged.
 */
export function useOffisimAdapterMessages(
  conversationKey: string,
): readonly OffisimAdapterMessage[] {
  const messages = useChatSessionStore(
    (state) => state.conversations[conversationKey]?.messages ?? EMPTY_MESSAGES,
  );
  const { content, reasoning, toolCalls, isStreaming, nodeName } =
    useStreamingContentForConversation(conversationKey);

  return useMemo(() => {
    if (!isStreaming) return messages;
    const streamingSegment: OffisimAdapterMessage = {
      id: STREAMING_MESSAGE_ID,
      role: 'assistant',
      content,
      isRunning: true,
      nodeName,
      ...(reasoning ? { reasoning } : {}),
      ...(toolCalls.length > 0 ? { toolCalls: [...toolCalls] } : {}),
    };
    return [...messages, streamingSegment];
  }, [messages, isStreaming, content, reasoning, toolCalls, nodeName]);
}

/** Joins the text parts of an assistant-ui `AppendMessage` into a plain string. */
export function appendMessageToText(message: AppendMessage): string {
  return message.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();
}
