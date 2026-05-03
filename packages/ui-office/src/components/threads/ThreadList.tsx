import { chatThreadUpdated, generateId } from '@offisim/core/browser';
import type { ChatThread, ChatThreadUpdatedPayload, RuntimeEvent } from '@offisim/shared-types';
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
  const { repos, eventBus } = useOffisimRuntime();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);

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

  useEffect(() => {
    if (!projectId) return;
    const off = eventBus.on(
      'chat_thread.updated',
      (event: RuntimeEvent<ChatThreadUpdatedPayload>) => {
        if (event.payload.projectId !== projectId) return;
        void refresh();
      },
    );
    return off;
  }, [eventBus, projectId, refresh]);

  const handleNewThread = useCallback(async () => {
    if (!repos?.chatThreads || !projectId) return;
    const created = await repos.chatThreads.create({
      thread_id: generateId('thread'),
      project_id: projectId,
    });
    setThreads((prev) => [created, ...prev]);
    onSelectThread(created.thread_id);
    eventBus.emit(
      chatThreadUpdated('', {
        chatThreadId: created.thread_id,
        projectId,
        reason: 'created',
      }),
    );
  }, [repos, projectId, onSelectThread, eventBus]);

  const handleRenameSubmit = useCallback(
    async (threadId: string, nextTitle: string) => {
      if (!repos?.chatThreads || !projectId) return;
      const title = nextTitle.trim();
      setRenamingId(null);
      if (!title) return;
      await repos.chatThreads.updateTitle(threadId, title, { byUser: true });
      setThreads((prev) =>
        prev.map((t) => (t.thread_id === threadId ? { ...t, title } : t)),
      );
      eventBus.emit(
        chatThreadUpdated('', { chatThreadId: threadId, projectId, reason: 'title' }),
      );
    },
    [repos, projectId, eventBus],
  );

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
            const isRenaming = renamingId === t.thread_id;
            return (
              <div key={t.thread_id} className="flex items-center gap-1">
                {isRenaming ? (
                  <RenameInput
                    initial={t.title}
                    onSubmit={(next) => void handleRenameSubmit(t.thread_id, next)}
                    onCancel={() => setRenamingId(null)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectThread(t.thread_id)}
                    onDoubleClick={() => setRenamingId(t.thread_id)}
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

interface RenameInputProps {
  initial: string;
  onSubmit: (nextTitle: string) => void;
  onCancel: () => void;
}

function RenameInput({ initial, onSubmit, onCancel }: RenameInputProps) {
  const [draft, setDraft] = useState(initial);
  return (
    <div className="flex flex-1 items-center gap-1">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit(draft);
          if (e.key === 'Escape') onCancel();
        }}
        className="flex-1 rounded border border-border-default bg-surface-default px-2 py-1 text-[12px] text-text-primary outline-none focus:border-border-focus"
      />
      <button
        type="button"
        onClick={() => onSubmit(draft)}
        className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
        aria-label="Save"
      >
        <Check className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
        aria-label="Cancel"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
