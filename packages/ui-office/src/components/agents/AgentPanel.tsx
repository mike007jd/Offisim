import { Plus, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AgentState } from '../../runtime/use-agent-states';
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

  const filteredEntries = useMemo(() => {
    const query = search.toLowerCase();
    return [...agents.entries()].filter(
      ([, agent]) =>
        agent.name.toLowerCase().includes(query) || agent.role.toLowerCase().includes(query),
    );
  }, [agents, search]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-white/5" style={{ padding: 'var(--sp-xxl)' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--sp-lg)' }}>
          <h2 className="text-xs font-black uppercase tracking-[0.4em] text-slate-400 flex items-center gap-2">
            <Users className="w-3 h-3" />
            <span>Team</span>
          </h2>
          <span className="text-[10px] font-mono text-blue-500/60">
            {filteredEntries.length} {search ? `/ ${agents.size}` : ''} members
          </span>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
          <input
            type="text"
            placeholder="Search employees..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-9 pr-4 text-[10px] font-mono focus:outline-none focus:border-blue-500/40 transition-all placeholder:text-slate-700 text-slate-300"
          />
        </div>
      </div>

      {/* Employee list */}
      <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ padding: 'var(--sp-lg)' }}>
        {filteredEntries.map(([id, agent], idx) => (
          <div key={id} className="animate-list-item" style={{ animationDelay: `${idx * 30}ms` }}>
            <AgentCard
              id={id}
              agent={agent}
              isSelected={selectedEmployeeId === id}
              onClick={() => onSelectEmployee?.(id)}
            />
          </div>
        ))}
      </div>

      {/* Bottom action — direct to employee creator */}
      <div className="border-t border-white/5 bg-black/40" style={{ padding: 'var(--sp-lg)' }}>
        <button
          type="button"
          className="cyber-button w-full flex items-center justify-center group"
          style={{ columnGap: 'var(--sp-sm)' }}
          onClick={onOpenCreator}
        >
          <Plus className="w-3 h-3 text-blue-400 group-hover:rotate-90 transition-transform" />
          <span>Add Employee</span>
        </button>
      </div>
    </div>
  );
}
