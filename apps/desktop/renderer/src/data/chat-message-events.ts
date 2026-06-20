import { appendThreadMessageEvent, loadThreadMessageEvents } from './thread-message-events.js';
import type { ChatMessage } from './types.js';

const DIRECT_CHAT_MESSAGE_EVENT = 'direct_chat.message';

interface PersistedChatMessageEntry {
  message: ChatMessage;
  createdAtMs: number;
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
    eventType: DIRECT_CHAT_MESSAGE_EVENT,
    threadId: messageForStorage.threadId,
    companyId,
    projectId,
    agentName: messageForStorage.author === 'boss' ? 'boss' : 'desktop-provider',
    payload: { message: messageForStorage },
    createdAt: new Date(finiteTimestamp(messageForStorage.at, Date.now())),
  });
}

export async function loadPersistedChatMessages(threadId: string): Promise<ChatMessage[]> {
  const entries = await loadThreadMessageEvents<PersistedChatMessageEntry>(
    threadId,
    DIRECT_CHAT_MESSAGE_EVENT,
    (payload, row) => {
      const message = (payload as { message?: ChatMessage }).message;
      if (message?.threadId !== threadId || typeof message.id !== 'string') return null;
      const createdAtMs = Date.parse(row.created_at) || finiteTimestamp(message.at, 0);
      return {
        message: restoredMessage(message, createdAtMs || Date.now()),
        createdAtMs,
      };
    },
  );
  const latestById = new Map<string, PersistedChatMessageEntry>();
  for (const entry of entries) {
    const previous = latestById.get(entry.message.id);
    if (!previous || entry.createdAtMs >= previous.createdAtMs) {
      latestById.set(entry.message.id, entry);
    }
  }
  return Array.from(latestById.values())
    .map((entry) => entry.message)
    .sort((a, b) => finiteTimestamp(a.at, 0) - finiteTimestamp(b.at, 0));
}
