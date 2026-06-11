import { useUiState } from '@/app/ui-state.js';
import { reposOrNull } from '@/data/adapters.js';
import { useThreads } from '@/data/queries.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { RunStatePill } from '@/design-system/grammar/RunStatePill.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { cn } from '@/lib/utils.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import { generateId } from '@offisim/core/browser';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MessagesSquare, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

export function ThreadList() {
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openThread = useUiState((s) => s.openThread);
  const threads = useThreads(projectId);
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const createThread = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error('Select a project before creating a conversation.');
      const repos = await reposOrNull();
      if (!repos) throw new Error('Creating a conversation requires the desktop runtime.');
      return repos.chatThreads.create({
        thread_id: generateId('thread'),
        project_id: projectId,
        title: 'New thread', // DB default — displayThreadTitle() shows it as 'New conversation'
      });
    },
    onSuccess: async (thread) => {
      await queryClient.invalidateQueries({ queryKey: ['threads', projectId] });
      openThread(thread.thread_id);
      toast.success('Conversation created');
    },
    onError: (error) => {
      toast.error('Could not create the conversation', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    },
  });

  const filtered = useMemo(() => {
    const list = threads.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (t) => t.title.toLowerCase().includes(q) || t.subtitle.toLowerCase().includes(q),
    );
  }, [threads.data, query]);

  return (
    <>
      <div className="off-conv-list-head">
        <SearchInput value={query} onChange={setQuery} placeholder="Search conversations" />
        <IconButton
          icon={Plus}
          label="New conversation"
          variant="subtle"
          size="icon"
          disabled={createThread.isPending || !projectId}
          onClick={() => createThread.mutate()}
        />
      </div>

      {threads.isError ? (
        <ErrorState
          title="Couldn't load conversations"
          detail={errorDetail(threads.error, 'Conversations failed to load.')}
          onRetry={() => void threads.refetch()}
        />
      ) : threads.isLoading ? (
        <SkeletonRows rows={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title={query ? 'No matching conversations' : 'No conversations yet'}
          description={query ? 'Try a different search term.' : 'Message the team or one employee.'}
        />
      ) : (
        <div className="off-conv-list">
          {filtered.map((thread) => (
            <button
              type="button"
              key={thread.id}
              className={cn(
                'off-thread-row off-focusable',
                thread.id === selectedThreadId && 'is-active',
              )}
              onClick={() => openThread(thread.id)}
            >
              <span className="off-thread-info">
                <span className="off-thread-name">{thread.title}</span>
                <span className="off-thread-sub">{thread.subtitle}</span>
              </span>
              <RunStatePill state={thread.runState} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
