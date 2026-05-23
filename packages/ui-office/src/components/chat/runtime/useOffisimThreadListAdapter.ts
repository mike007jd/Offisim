import type { ExternalStoreThreadListAdapter } from '@assistant-ui/react';
import { chatThreadUpdated, generateId } from '@offisim/core/browser';
import type { ChatThread, ChatThreadUpdatedPayload, RuntimeEvent } from '@offisim/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOffisimRuntimeServices } from '../../../runtime/offisim-runtime-context';

export interface UseOffisimThreadListAdapterOptions {
  projectId: string | null;
  selectedThreadId: string | null;
  /** SSOT writer — routes to `updateWorkspaceState('office', …selectedThreadId)`. */
  onSelectThread: (threadId: string) => void;
}

/**
 * Builds an assistant-ui `ExternalStoreThreadListAdapter` backed by the existing
 * `chat_threads` product table (via `repos.chatThreads`). Thread switching flows
 * through `onSelectThread` (the SSOT writer), and rename/archive/delete emit the
 * `chat_thread.updated` event so sibling surfaces (ThreadList / WorkspaceSearch)
 * stay in sync — preserving the auto-title pipeline.
 */
export function useOffisimThreadListAdapter({
  projectId,
  selectedThreadId,
  onSelectThread,
}: UseOffisimThreadListAdapterOptions): ExternalStoreThreadListAdapter {
  const { repos, eventBus } = useOffisimRuntimeServices();
  const [regular, setRegular] = useState<ChatThread[]>([]);
  const [archived, setArchived] = useState<ChatThread[]>([]);

  const refresh = useCallback(async () => {
    if (!repos?.chatThreads || !projectId) {
      setRegular([]);
      setArchived([]);
      return;
    }
    const [active, all] = await Promise.all([
      repos.chatThreads.listByProject(projectId),
      repos.chatThreads.listAllByProject(projectId),
    ]);
    setRegular(active);
    setArchived(all.filter((t) => t.archived_at !== null));
  }, [repos, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!projectId) return;
    return eventBus.on('chat_thread.updated', (event: RuntimeEvent<ChatThreadUpdatedPayload>) => {
      if (event.payload.projectId !== projectId) return;
      void refresh();
    });
  }, [eventBus, projectId, refresh]);

  const emitUpdated = useCallback(
    (threadId: string, reason: ChatThreadUpdatedPayload['reason']) => {
      if (!projectId) return;
      eventBus.emit(chatThreadUpdated('', { chatThreadId: threadId, projectId, reason }));
    },
    [eventBus, projectId],
  );

  return useMemo<ExternalStoreThreadListAdapter>(
    () => ({
      threadId: selectedThreadId ?? undefined,
      threads: regular.map((t) => ({
        status: 'regular' as const,
        id: t.thread_id,
        title: t.title,
      })),
      archivedThreads: archived.map((t) => ({
        status: 'archived' as const,
        id: t.thread_id,
        title: t.title,
      })),
      onSwitchToThread: (threadId) => {
        onSelectThread(threadId);
      },
      onSwitchToNewThread: async () => {
        if (!repos?.chatThreads || !projectId) return;
        const created = await repos.chatThreads.create({
          thread_id: generateId('thread'),
          project_id: projectId,
        });
        setRegular((prev) => [created, ...prev]);
        onSelectThread(created.thread_id);
        emitUpdated(created.thread_id, 'created');
      },
      onRename: async (threadId, newTitle) => {
        if (!repos?.chatThreads) return;
        const title = newTitle.trim();
        if (!title) return;
        await repos.chatThreads.updateTitle(threadId, title, { byUser: true });
        setRegular((prev) => prev.map((t) => (t.thread_id === threadId ? { ...t, title } : t)));
        emitUpdated(threadId, 'title');
      },
      onArchive: async (threadId) => {
        if (!repos?.chatThreads) return;
        await repos.chatThreads.archive(threadId);
        await refresh();
        emitUpdated(threadId, 'archived');
      },
      onUnarchive: async (threadId) => {
        if (!repos?.chatThreads) return;
        await repos.chatThreads.unarchive(threadId);
        await refresh();
        emitUpdated(threadId, 'unarchived');
      },
      onDelete: async (threadId) => {
        if (!repos?.chatThreads) return;
        await repos.chatThreads.delete(threadId);
        await refresh();
        emitUpdated(threadId, 'deleted');
      },
    }),
    [selectedThreadId, regular, archived, onSelectThread, repos, projectId, emitUpdated, refresh],
  );
}
