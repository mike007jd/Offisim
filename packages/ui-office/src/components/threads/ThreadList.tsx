import { generateId } from '@offisim/core/browser';
import type { ChatThread } from '@offisim/shared-types';
import { Button, cn } from '@offisim/ui-core';
import { Check, Plus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';

interface ThreadListProps {
  projectId: string | null;
  selectedThreadId: string | null;
  onSelectThread: (threadId: string) => void;
}

const ROW_BASE =
  'group flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[12px] transition-colors';
const ROW_ACTIVE = 'border-border-focus bg-accent-muted text-accent-text';
const ROW_IDLE = 'text-text-secondary hover:bg-surface-hover hover:text-text-primary';

export function ThreadList({ projectId, selectedThreadId, onSelectThread }: ThreadListProps) {
  const { repos } = useOffisimRuntime();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [renaming, setRenaming] = useState<{ threadId: string; draft: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!repos?.chatThreads || !projectId) {
      setThreads([]);
      return;
    }
    const rows = await repos.chatThreads.listByProject(projectId);
    setThreads(rows);
  }, [repos, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleNewThread = useCallback(async () => {
    if (!repos?.chatThreads || !projectId) return;
    const created = await repos.chatThreads.create({
      thread_id: generateId('thread'),
      project_id: projectId,
    });
    await refresh();
    onSelectThread(created.thread_id);
  }, [repos, projectId, refresh, onSelectThread]);

  const handleRenameSubmit = useCallback(async () => {
    if (!repos?.chatThreads || !renaming) return;
    const title = renaming.draft.trim();
    if (!title) {
      setRenaming(null);
      return;
    }
    await repos.chatThreads.updateTitle(renaming.threadId, title, { byUser: true });
    setRenaming(null);
    await refresh();
  }, [repos, renaming, refresh]);

  if (!projectId) return null;

  return (
    <div className="flex flex-col gap-1 px-2 py-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
          Threads
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => void handleNewThread()}
          title="New thread"
          aria-label="New thread"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex flex-col gap-0.5">
        {threads.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-text-muted">No threads yet.</div>
        ) : (
          threads.map((t) => {
            const isActive = t.thread_id === selectedThreadId;
            const isRenaming = renaming?.threadId === t.thread_id;
            return (
              <div key={t.thread_id} className="flex items-center gap-1">
                {isRenaming ? (
                  <div className="flex flex-1 items-center gap-1">
                    <input
                      autoFocus
                      value={renaming.draft}
                      onChange={(e) => setRenaming({ ...renaming, draft: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleRenameSubmit();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      className="flex-1 rounded border border-border-default bg-surface-default px-2 py-1 text-[12px] text-text-primary outline-none focus:border-border-focus"
                    />
                    <button
                      type="button"
                      onClick={() => void handleRenameSubmit()}
                      className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                      aria-label="Save"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenaming(null)}
                      className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                      aria-label="Cancel"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectThread(t.thread_id)}
                    onDoubleClick={() => setRenaming({ threadId: t.thread_id, draft: t.title })}
                    className={cn(ROW_BASE, isActive ? ROW_ACTIVE : ROW_IDLE)}
                  >
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
