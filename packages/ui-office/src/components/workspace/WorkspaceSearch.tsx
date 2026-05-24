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
      className="workspace-search"
      onBlur={() => {
        blurTimerRef.current = window.setTimeout(() => setOpen(false), 100);
      }}
      onFocus={() => {
        if (blurTimerRef.current !== null) window.clearTimeout(blurTimerRef.current);
        setOpen(true);
      }}
    >
      <div className="workspace-search-box">
        <Search data-icon="workspace-search" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search threads, people…"
          className="workspace-search-input"
        />
      </div>
      {showPanel ? (
        <div className="workspace-search-panel">
          {results.length === 0 ? <div className="workspace-search-empty">No matches.</div> : null}
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
              className="workspace-search-row"
            >
              <span className="workspace-search-kind">
                {r.kind === 'thread' ? 'thread' : 'person'}
              </span>
              <span className="workspace-search-title">
                {r.kind === 'thread' ? r.title : r.name}
              </span>
              {r.kind === 'employee' ? (
                <span className="workspace-search-meta">{r.role}</span>
              ) : null}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
