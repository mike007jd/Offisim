import { appendThreadMessageEvent, loadThreadMessageEvents } from '@/data/thread-message-events.js';
import { useQuery } from '@tanstack/react-query';
import type { WsMessage } from './workspace-data.js';

const WORKSPACE_CHAT_MESSAGE_EVENT = 'workspace_chat.message';

interface WorkspaceMessagePayload {
  message?: WsMessage;
  createdAtMs?: number;
}

export async function persistWorkspaceMessage({
  threadId,
  message,
  companyId,
  projectId,
}: {
  threadId: string;
  message: WsMessage;
  companyId: string | null;
  projectId: string | null;
}): Promise<void> {
  // WsMessage carries no numeric timestamp of its own, so stamp one for ordering.
  const createdAt = new Date();
  await appendThreadMessageEvent({
    eventType: WORKSPACE_CHAT_MESSAGE_EVENT,
    threadId,
    companyId,
    projectId,
    agentName: message.author === 'boss' ? 'boss' : 'workspace-runtime',
    payload: { message, createdAtMs: createdAt.getTime() } satisfies WorkspaceMessagePayload,
    createdAt,
  });
}

export async function loadPersistedWorkspaceMessages(threadId: string): Promise<WsMessage[]> {
  const entries = await loadThreadMessageEvents<{ message: WsMessage; createdAtMs: number }>(
    threadId,
    WORKSPACE_CHAT_MESSAGE_EVENT,
    (payload, row) => {
      const parsed = payload as WorkspaceMessagePayload;
      if (!parsed.message) return null;
      return {
        message: parsed.message,
        createdAtMs: parsed.createdAtMs ?? (Date.parse(row.created_at) || 0),
      };
    },
  );
  return entries.sort((a, b) => a.createdAtMs - b.createdAtMs).map((entry) => entry.message);
}

export function usePersistedWorkspaceMessages(threadId: string | null) {
  return useQuery({
    queryKey: ['ws', 'persisted-thread-messages', threadId],
    queryFn: () => loadPersistedWorkspaceMessages(threadId ?? ''),
    enabled: threadId !== null,
  });
}
