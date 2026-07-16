import type { RuntimeRepositories } from '@offisim/core/browser';
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

type ChatMessageEventRepositories = Pick<RuntimeRepositories, 'agentEvents'>;

function messageFromDirectEvent(
  row: Awaited<ReturnType<RuntimeRepositories['agentEvents']['findById']>>,
  threadId: string,
): ChatMessage | null {
  if (!row || row.event_type !== DIRECT_CHAT_MESSAGE_EVENT || row.thread_id !== threadId) {
    return null;
  }
  try {
    const message = (JSON.parse(row.payload_json) as { message?: ChatMessage }).message;
    if (message?.threadId !== threadId || typeof message.id !== 'string') return null;
    return message;
  } catch {
    return null;
  }
}

export async function loadPersistedChatMessageWithRepositories({
  repos,
  threadId,
  messageId,
}: {
  repos: ChatMessageEventRepositories;
  threadId: string;
  messageId: string;
}): Promise<ChatMessage | null> {
  return messageFromDirectEvent(
    await repos.agentEvents.findById(directChatMessageEventId(threadId, messageId)),
    threadId,
  );
}

export async function loadPersistedChatMessagesByIdsWithRepositories({
  repos,
  threadId,
  messageIds,
}: {
  repos: ChatMessageEventRepositories;
  threadId: string;
  messageIds: readonly string[];
}): Promise<ChatMessage[]> {
  const messages = await Promise.all(
    messageIds.map((messageId) =>
      loadPersistedChatMessageWithRepositories({ repos, threadId, messageId }),
    ),
  );
  return messages.filter((message): message is ChatMessage => message !== null);
}

export async function assertPersistedChatMessageWithRepositories({
  repos,
  expected,
  errorMessage,
}: {
  repos: ChatMessageEventRepositories;
  expected: ChatMessage;
  errorMessage: string;
}): Promise<void> {
  const actual = await loadPersistedChatMessageWithRepositories({
    repos,
    threadId: expected.threadId,
    messageId: expected.id,
  });
  const expectedStored = JSON.parse(JSON.stringify(persistedMessage(expected))) as ChatMessage;
  if (!actual || JSON.stringify(actual) !== JSON.stringify(expectedStored)) {
    throw new Error(errorMessage);
  }
}

export async function persistConversationStreamCheckpointWithRepositories({
  runId,
  runtimeContextJson,
  message,
  companyId,
  projectId,
  repos,
}: {
  runId: string;
  runtimeContextJson: string;
  message: ChatMessage;
  companyId: string;
  projectId: string | null;
  repos: RuntimeRepositories;
}): Promise<void> {
  await repos.asyncTransact(async (transactionRepos) => {
    const tx = transactionRepos ?? repos;
    await Promise.all([
      tx.agentRuns.updateRuntimeContext(runId, runtimeContextJson),
      persistChatMessageWithRepositories({ message, companyId, projectId, repos: tx }),
    ]);
  });
}

export async function persistChatMessageWithRepositories({
  message,
  companyId,
  projectId,
  repos,
}: {
  message: ChatMessage;
  companyId: string;
  projectId: string | null;
  repos: ChatMessageEventRepositories;
}): Promise<void> {
  const messageForStorage = persistedMessage(message);
  await repos.agentEvents.append({
    event_id: directChatMessageEventId(messageForStorage.threadId, messageForStorage.id),
    event_type: DIRECT_CHAT_MESSAGE_EVENT,
    thread_id: messageForStorage.threadId,
    company_id: companyId,
    project_id: projectId,
    agent_name: messageForStorage.author === 'boss' ? 'boss' : 'desktop-provider',
    payload_json: JSON.stringify({ message: messageForStorage }),
    parent_event_id: null,
    created_at: nextProjectionWriteDate().toISOString(),
  });
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
