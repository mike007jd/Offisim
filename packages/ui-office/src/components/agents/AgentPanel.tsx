import { Plus, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AgentState } from '../../runtime/use-agent-states';
import { useEmployeeSkillHighlights } from '../../runtime/use-employee-skill-highlights';
import { AgentCard } from './AgentCard';

interface AgentPanelProps {
  agents: Map<string, AgentState>;
  onSelectEmployee?: (employeeId: string) => void;
  selectedEmployeeId?: string | null;
  /** Navigate to full-screen employee creator */
  onOpenCreator?: () => void;
}

export function AgentPanel({
  agents,
  onSelectEmployee,
  selectedEmployeeId,
  onOpenCreator,
}: AgentPanelProps) {
  const [search, setSearch] = useState('');
  const skillHighlights = useEmployeeSkillHighlights();

  const filteredEntries = useMemo(() => {
    const query = search.toLowerCase();
    return [...agents.entries()].filter(
      ([, agent]) =>
        agent.name.toLowerCase().includes(query) || agent.role.toLowerCase().includes(query),
    );
  }, [agents, search]);

  return (
    <div className="flex h-full flex-col bg-surface-elevated text-text-primary">
      {/* Header */}
      <div className="border-b border-border-default" style={{ padding: 'var(--sp-lg)' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--sp-md)' }}>
          <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-text-secondary">
            <Users className="w-3 h-3" />
            <span>Team</span>
          </h2>
          <span className="rounded-full border border-border-subtle bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-text-muted">
            {filteredEntries.length} {search ? `/ ${agents.size}` : ''} members
          </span>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            placeholder="Search employees..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-border-default bg-surface-muted py-2 pl-9 pr-3 text-sm text-text-primary transition-all placeholder:text-text-muted focus:border-border-focus focus:bg-surface focus:outline-none"
          />
        </div>
      </div>

      {/* Employee list */}
      <div
        className="custom-scrollbar flex-1 space-y-1.5 overflow-y-auto"
        style={{ padding: 'var(--sp-sm)' }}
      >
        {filteredEntries.map(([id, agent], idx) => (
          <div key={id} className="animate-list-item" style={{ animationDelay: `${idx * 30}ms` }}>
            <AgentCard
              id={id}
              agent={agent}
              isSelected={selectedEmployeeId === id}
              skillHighlight={skillHighlights.get(id)}
              onClick={() => onSelectEmployee?.(id)}
            />
          </div>
        ))}
        {filteredEntries.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-text-muted">
            {search ? 'No employees match this search.' : 'No employees yet.'}
          </div>
        )}
      </div>

      {/* Bottom action — direct to employee creator */}
      <div
        className="border-t border-border-default bg-surface"
        style={{ padding: 'var(--sp-lg)' }}
      >
        <button
          type="button"
          className="group flex h-10 w-full items-center justify-center rounded-lg border border-border-default bg-surface-muted text-xs font-semibold uppercase tracking-[0.18em] text-text-secondary transition hover:border-border-focus hover:bg-accent-muted hover:text-accent-text"
          style={{ columnGap: 'var(--sp-sm)' }}
          onClick={onOpenCreator}
        >
          <Plus className="h-3.5 w-3.5 text-accent transition-transform group-hover:rotate-90" />
          <span>Add Employee</span>
        </button>
      </div>
    </div>
  );
}
