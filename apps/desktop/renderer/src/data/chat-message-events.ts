import { appendThreadMessageEvent, loadThreadMessageEvents } from './thread-message-events.js';
import type { ChatMessage } from './types.js';

const DIRECT_CHAT_MESSAGE_EVENT = 'direct_chat.message';

export async function persistChatMessage({
  message,
  companyId,
  projectId,
}: {
  message: ChatMessage;
  companyId: string | null;
  projectId: string | null;
}): Promise<void> {
  await appendThreadMessageEvent({
    eventType: DIRECT_CHAT_MESSAGE_EVENT,
    threadId: message.threadId,
    companyId,
    projectId,
    agentName: message.author === 'boss' ? 'boss' : 'desktop-provider',
    payload: { message },
    createdAt: new Date(message.at),
  });
}

export async function loadPersistedChatMessages(threadId: string): Promise<ChatMessage[]> {
  const messages = await loadThreadMessageEvents<ChatMessage>(
    threadId,
    DIRECT_CHAT_MESSAGE_EVENT,
    (payload) => {
      const message = (payload as { message?: ChatMessage }).message;
      return message?.threadId === threadId ? message : null;
    },
  );
  return messages.sort((a, b) => a.at - b.at);
}
