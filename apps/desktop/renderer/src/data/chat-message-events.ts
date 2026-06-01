import { reposOrNull } from './adapters.js';
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
  if (!companyId) return;
  const repos = await reposOrNull();
  if (!repos?.agentEvents) return;
  await repos.agentEvents.append({
    event_id: `evt-${crypto.randomUUID()}`,
    project_id: projectId,
    thread_id: message.threadId,
    company_id: companyId,
    agent_name: message.author === 'boss' ? 'boss' : 'desktop-provider',
    event_type: DIRECT_CHAT_MESSAGE_EVENT,
    payload_json: JSON.stringify({ message }),
    parent_event_id: null,
    created_at: new Date(message.at).toISOString(),
  });
}

export async function loadPersistedChatMessages(threadId: string): Promise<ChatMessage[]> {
  const repos = await reposOrNull();
  const rows =
    (await repos?.agentEvents?.findByThread(threadId, {
      eventType: DIRECT_CHAT_MESSAGE_EVENT,
      limit: 500,
    })) ?? [];
  return rows
    .map((row) => {
      try {
        const payload = JSON.parse(row.payload_json) as { message?: ChatMessage };
        return payload.message?.threadId === threadId ? payload.message : null;
      } catch {
        return null;
      }
    })
    .filter((message): message is ChatMessage => message !== null)
    .sort((a, b) => a.at - b.at);
}
