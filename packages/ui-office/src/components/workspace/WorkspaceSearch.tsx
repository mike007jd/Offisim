import type { ChatThread } from '@offisim/shared-types';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOffisimRuntime } from '../../runtime/offisim-runtime-context';
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
  const { repos } = useOffisimRuntime();
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

  useEffect(() => {
    if (!projectId || !repos?.chatThreads) {
      setThreads([]);
      return;
    }
    let cancelled = false;
    void repos.chatThreads.listByProject(projectId).then((rows) => {
      if (!cancelled) setThreads(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId, repos]);

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
    const matchedEmployees = rankByQuery(
      employeeRows,
      debounced,
      (e) => `${e.name} ${e.role}`,
    )
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
      <div className="flex items-center gap-1 rounded-md border border-border-subtle bg-surface-muted px-2 py-1">
        <Search className="h-3 w-3 text-text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search threads, people…"
          className="w-full bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted"
        />
      </div>
      {showPanel ? (
        <div className="absolute left-0 right-0 top-full z-overlay mt-1 max-h-72 overflow-y-auto rounded-md border border-border-default bg-surface-elevated p-1 shadow-overlay">
          {results.length === 0 ? (
            <div className="px-2 py-2 text-[11px] text-text-muted">No matches.</div>
          ) : null}
          {results.map((r) => (
            <button
              key={`${r.kind}:${r.kind === 'thread' ? r.threadId : r.employeeId}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                if (r.kind === 'thread') onSelectThread(r.threadId);
                else onSelectEmployee(r.employeeId);
                setQuery('');
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-text-primary hover:bg-surface-hover"
            >
              <span className="rounded-full border border-border-subtle bg-surface-muted px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-text-muted">
                {r.kind === 'thread' ? 'thread' : 'person'}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {r.kind === 'thread' ? r.title : r.name}
              </span>
              {r.kind === 'employee' ? (
                <span className="truncate text-[10px] text-text-muted">{r.role}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
