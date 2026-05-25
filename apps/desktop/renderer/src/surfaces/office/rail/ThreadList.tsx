import { useUiState } from '@/app/ui-state.js';
import { useThreads } from '@/data/queries.js';
import { IconButton } from '@/design-system/grammar/IconButton.js';
import { RunStatePill } from '@/design-system/grammar/RunStatePill.js';
import { SearchInput } from '@/design-system/grammar/SearchInput.js';
import { cn } from '@/lib/utils.js';
import { EmptyState, SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { MessagesSquare, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

export function ThreadList() {
  const projectId = useUiState((s) => s.projectId);
  const selectedThreadId = useUiState((s) => s.selectedThreadId);
  const openThread = useUiState((s) => s.openThread);
  const threads = useThreads(projectId);
  const [query, setQuery] = useState('');

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
        <SearchInput value={query} onChange={setQuery} placeholder="Search threads" />
        <IconButton icon={Plus} label="New thread" variant="subtle" size="icon" />
      </div>

      {threads.isLoading ? (
        <SkeletonRows rows={5} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title={query ? 'No matching threads' : 'No threads yet'}
          description={
            query
              ? 'Try a different search term.'
              : 'Start a conversation with the team or a single employee.'
          }
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
