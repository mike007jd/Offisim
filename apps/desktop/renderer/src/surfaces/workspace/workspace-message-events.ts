import { reposOrNull } from '@/data/adapters.js';
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
  if (!companyId) return;
  const createdAt = new Date();
  const repos = await reposOrNull();
  if (!repos?.agentEvents) return;
  await repos.agentEvents.append({
    event_id: `evt-${crypto.randomUUID()}`,
    project_id: projectId,
    thread_id: threadId,
    company_id: companyId,
    agent_name: message.author === 'boss' ? 'boss' : 'workspace-runtime',
    event_type: WORKSPACE_CHAT_MESSAGE_EVENT,
    payload_json: JSON.stringify({ message, createdAtMs: createdAt.getTime() }),
    parent_event_id: null,
    created_at: createdAt.toISOString(),
  });
}

export async function loadPersistedWorkspaceMessages(threadId: string): Promise<WsMessage[]> {
  const repos = await reposOrNull();
  const rows =
    (await repos?.agentEvents?.findByThread(threadId, {
      eventType: WORKSPACE_CHAT_MESSAGE_EVENT,
      limit: 500,
    })) ?? [];
  return rows
    .map((row) => {
      try {
        const payload = JSON.parse(row.payload_json) as WorkspaceMessagePayload;
        if (!payload.message) return null;
        return {
          message: payload.message,
          createdAtMs: payload.createdAtMs ?? (Date.parse(row.created_at) || 0),
        };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { message: WsMessage; createdAtMs: number } => entry !== null)
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .map((entry) => entry.message);
}

export function usePersistedWorkspaceMessages(threadId: string) {
  return useQuery({
    queryKey: ['ws', 'persisted-thread-messages', threadId],
    queryFn: () => loadPersistedWorkspaceMessages(threadId),
  });
}
