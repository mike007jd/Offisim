import type { ChatThreadUpdatedPayload, RuntimeEvent } from '@offisim/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context';

/** Team group-chat conversation, one per product `chat_threads` row. */
export interface TeamConversation {
  readonly kind: 'team';
  readonly threadId: string;
  readonly projectId: string;
  readonly title: string;
  readonly summary: string | null;
  readonly updatedAt: string;
}

export interface MessengerConversations {
  readonly teams: readonly TeamConversation[];
  readonly loading: boolean;
  readonly refresh: () => void;
}

/**
 * Messenger team conversations for the active project, sourced from
 * `chat_threads` (the product thread table, SSOT) ordered by `updated_at DESC`.
 * Direct chats are derived from the employee roster at the component layer
 * (one direct conversationKey per employee against the active thread); the
 * System channel is the NotificationCenter feed re-surfaced read-only. No new
 * table: this reuses `chatThreads.listByProject`.
 *
 * Live refresh subscribes to `chat_thread.updated` (the cross-surface sync
 * channel) filtered to the active project.
 */
export function useMessengerConversations(projectId: string | null): MessengerConversations {
  const { repos, eventBus } = useOffisimRuntimeServices();
  const [teams, setTeams] = useState<readonly TeamConversation[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!repos?.chatThreads || !projectId) {
      setTeams([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const rows = await repos.chatThreads.listByProject(projectId);
        if (cancelled) return;
        setTeams(
          rows.map((row) => ({
            kind: 'team' as const,
            threadId: row.thread_id,
            projectId: row.project_id,
            title: row.title,
            summary: row.summary,
            updatedAt: row.updated_at,
          })),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repos, projectId]);

  useEffect(() => {
    const dispose = refresh();
    return () => {
      if (typeof dispose === 'function') dispose();
    };
  }, [refresh]);

  useEffect(() => {
    if (!projectId) return;
    const off = eventBus.on(
      'chat_thread.updated',
      (event: RuntimeEvent<ChatThreadUpdatedPayload>) => {
        if (event.payload.projectId !== projectId) return;
        refresh();
      },
    );
    return off;
  }, [eventBus, projectId, refresh]);

  return { teams, loading, refresh };
}
