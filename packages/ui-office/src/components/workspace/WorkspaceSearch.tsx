import type { ChatThread, ChatThreadUpdatedPayload, RuntimeEvent } from '@offisim/shared-types';
import { Button, Input } from '@offisim/ui-core';
import { Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOffisimRuntimeServices } from '../../runtime/offisim-runtime-context';
import { useAgentStates } from '../../runtime/use-agent-states';

const DEBOUNCE_MS = 300;
const PER_FAMILY_CAP = 5;

type SearchResult =
  | { kind: 'thread'; threadId: string; title: string; updatedAt: string }
  | { kind: 'employee'; employeeId: string; name: string; role: string };

interface WorkspaceSearchProps {
  projectId: string | null;
  onSelectThread: (threadId: string) => void;
  onSelectEmployee: (employeeId: string) => void;
}

function rankByQuery<T>(items: T[], query: string, getKey: (item: T) => string): T[] {
  const q = query.toLowerCase();
  const exactPrefix: T[] = [];
  const substring: T[] = [];
  for (const item of items) {
    const key = getKey(item).toLowerCase();
    if (key.startsWith(q)) exactPrefix.push(item);
    else if (key.includes(q)) substring.push(item);
  }
  return [...exactPrefix, ...substring];
}

export function WorkspaceSearch({
  projectId,
  onSelectThread,
  onSelectEmployee,
}: WorkspaceSearchProps) {
  const { repos, eventBus } = useOffisimRuntimeServices();
  const agents = useAgentStates();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const blurTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const refreshThreads = useCallback(async () => {
    if (!projectId || !repos?.chatThreads) {
      setThreads([]);
      return;
    }
    const rows = await repos.chatThreads.listByProject(projectId);
    setThreads(rows);
  }, [projectId, repos]);

  useEffect(() => {
    void refreshThreads();
  }, [refreshThreads]);

  useEffect(() => {
    if (!projectId) return;
    const off = eventBus.on(
      'chat_thread.updated',
      (event: RuntimeEvent<ChatThreadUpdatedPayload>) => {
        if (event.payload.projectId !== projectId) return;
        void refreshThreads();
      },
    );
    return off;
  }, [eventBus, projectId, refreshThreads]);

  const results = useMemo<SearchResult[]>(() => {
    if (!debounced) return [];
    const matchedThreads = rankByQuery(threads, debounced, (t) => t.title)
      .slice(0, PER_FAMILY_CAP)
      .map<SearchResult>((t) => ({
        kind: 'thread',
        threadId: t.thread_id,
        title: t.title,
        updatedAt: t.updated_at,
      }));
    const employeeRows = [...agents.entries()].map(([id, state]) => ({
      id,
      name: state.name,
      role: state.role,
    }));
    const matchedEmployees = rankByQuery(employeeRows, debounced, (e) => `${e.name} ${e.role}`)
      .slice(0, PER_FAMILY_CAP)
      .map<SearchResult>((e) => ({
        kind: 'employee',
        employeeId: e.id,
        name: e.name,
        role: e.role,
      }));
    return [...matchedThreads, ...matchedEmployees];
  }, [debounced, threads, agents]);

  const showPanel = open && debounced.length > 0;

  return (
    <div
      className="relative"
      onBlur={() => {
        blurTimerRef.current = window.setTimeout(() => setOpen(false), 100);
      }}
      onFocus={() => {
        if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
        setOpen(true);
      }}
    >
      <div className="flex items-center gap-1 rounded-md border border-line-soft bg-surface-2 px-2 py-1">
        <Search className="size-3 text-ink-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search threads, people…"
          className="h-6 w-full border-0 bg-transparent p-0 text-fs-micro text-ink-1 shadow-none placeholder:text-ink-3 focus-visible:ring-0"
        />
      </div>
      {showPanel ? (
        <div className="absolute left-0 right-0 top-full z-overlay mt-1 max-h-72 overflow-y-auto rounded-md border border-line bg-surface-1 p-1 shadow-overlay">
          {results.length === 0 ? (
            <div className="px-2 py-2 text-fs-micro text-ink-3">No matches.</div>
          ) : null}
          {results.map((r) => (
            <Button
              key={`${r.kind}:${r.kind === 'thread' ? r.threadId : r.employeeId}`}
              type="button"
              variant="ghost"
              onMouseDown={(e) => {
                e.preventDefault();
                if (r.kind === 'thread') onSelectThread(r.threadId);
                else onSelectEmployee(r.employeeId);
                setQuery('');
                setOpen(false);
              }}
              className="flex h-auto w-full items-center justify-start gap-2 rounded px-2 py-1.5 text-left text-fs-micro text-ink-1 hover:bg-surface-sunken"
            >
              <span className="rounded-full border border-line-soft bg-surface-2 px-1.5 py-0.5 text-fs-micro uppercase tracking-wider text-ink-3">
                {r.kind === 'thread' ? 'thread' : 'person'}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {r.kind === 'thread' ? r.title : r.name}
              </span>
              {r.kind === 'employee' ? (
                <span className="truncate text-fs-micro text-ink-3">{r.role}</span>
              ) : null}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
