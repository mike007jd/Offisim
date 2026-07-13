import { appendThreadMessageEvent, loadThreadMessageEvents } from './thread-message-events.js';
import type { ChatMessage } from './types.js';

const DIRECT_CHAT_MESSAGE_EVENT = 'direct_chat.message';
let lastProjectionWriteMs = 0;

function nextProjectionWriteDate(): Date {
  lastProjectionWriteMs = Math.max(Date.now(), lastProjectionWriteMs + 1);
  return new Date(lastProjectionWriteMs);
}

function directChatMessageEventId(threadId: string, messageId: string): string {
  return `direct-chat:${threadId}:${messageId}`;
}

function persistedMessage(message: ChatMessage): ChatMessage {
  const { toolCalls: _toolCalls, ...rest } = message;
  return rest;
}

function finiteTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function restoredMessage(message: ChatMessage, fallbackAt: number): ChatMessage {
  return {
    ...message,
    body: typeof message.body === 'string' ? message.body : '',
    at: finiteTimestamp(message.at, fallbackAt),
    status: message.status === 'streaming' ? 'interrupted' : message.status,
  };
}

export async function persistChatMessage({
  message,
  companyId,
  projectId,
}: {
  message: ChatMessage;
  companyId: string | null;
  projectId: string | null;
}): Promise<void> {
  const messageForStorage = persistedMessage(message);
  await appendThreadMessageEvent({
    eventId: directChatMessageEventId(messageForStorage.threadId, messageForStorage.id),
    eventType: DIRECT_CHAT_MESSAGE_EVENT,
    threadId: messageForStorage.threadId,
    companyId,
    projectId,
    agentName: messageForStorage.author === 'boss' ? 'boss' : 'desktop-provider',
    payload: { message: messageForStorage },
    // This is projection write order, not the visible message timestamp (which
    // remains in the payload). Monotonic time keeps an older in-flight checkpoint
    // from overwriting a later final write when DB invocations complete out of order.
    createdAt: nextProjectionWriteDate(),
  });
}

export async function loadPersistedChatMessages(threadId: string): Promise<ChatMessage[]> {
  const messages = await loadThreadMessageEvents<ChatMessage>(
    threadId,
    DIRECT_CHAT_MESSAGE_EVENT,
    (payload, row) => {
      const wrapper = payload as { message?: ChatMessage };
      const message = wrapper.message;
      if (message?.threadId !== threadId || typeof message.id !== 'string') return null;
      const createdAtMs = Date.parse(row.created_at) || finiteTimestamp(message.at, 0);
      return restoredMessage(message, createdAtMs || Date.now());
    },
  );
  return messages.sort((a, b) => finiteTimestamp(a.at, 0) - finiteTimestamp(b.at, 0));
}
