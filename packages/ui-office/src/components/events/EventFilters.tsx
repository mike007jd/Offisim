import { useCallback, useState } from 'react';

export interface EventFilterState {
  types: string[];
  levels: string[];
  search: string;
}

export const ALL_EVENT_TYPES = ['All', 'Node', 'Plan', 'Task', 'Deliverable', 'Employee', 'Install'] as const;
export type EventFilterType = (typeof ALL_EVENT_TYPES)[number];

export const ALL_LEVELS = ['Info', 'Warning', 'Error'] as const;
export type EventLevel = (typeof ALL_LEVELS)[number];

interface EventFiltersProps {
  onFilterChange: (filters: EventFilterState) => void;
}

export function EventFilters({ onFilterChange }: EventFiltersProps) {
  const [selectedType, setSelectedType] = useState<EventFilterType>('All');
  const [activeLevels, setActiveLevels] = useState<Set<EventLevel>>(
    new Set(['Info', 'Warning', 'Error']),
  );
  const [search, setSearch] = useState('');

  const handleTypeChange = useCallback(
    (type: EventFilterType) => {
      setSelectedType(type);
      onFilterChange({
        types: [type],
        levels: [...activeLevels],
        search,
      });
    },
    [activeLevels, search, onFilterChange],
  );

  const toggleLevel = useCallback(
    (level: EventLevel) => {
      setActiveLevels((prev) => {
        const next = new Set(prev);
        if (next.has(level)) {
          // keep at least one level active
          if (next.size > 1) next.delete(level);
        } else {
          next.add(level);
        }
        onFilterChange({
          types: [selectedType],
          levels: [...next],
          search,
        });
        return next;
      });
    },
    [selectedType, search, onFilterChange],
  );

  const handleSearch = useCallback(
    (value: string) => {
      setSearch(value);
      onFilterChange({
        types: [selectedType],
        levels: [...activeLevels],
        search: value,
      });
    },
    [selectedType, activeLevels, onFilterChange],
  );

  const levelPillClass = (level: EventLevel, active: boolean) => {
    const base = 'px-1.5 py-0.5 rounded text-[10px] font-medium cursor-pointer select-none transition-colors';
    if (!active) return `${base} bg-transparent text-shell border border-shell/30 opacity-40`;
    if (level === 'Error') return `${base} bg-lobster-red/20 text-lobster-red border border-lobster-red/40`;
    if (level === 'Warning') return `${base} bg-amber-400/20 text-amber-400 border border-amber-400/40`;
    return `${base} bg-sea-blue/20 text-sea-blue border border-sea-blue/40`;
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-shell/10 flex-wrap">
      {/* Type dropdown */}
      <select
        value={selectedType}
        onChange={(e) => handleTypeChange(e.target.value as EventFilterType)}
        className="text-[10px] bg-abyss text-shell border border-shell/20 rounded px-1.5 py-0.5 cursor-pointer focus:outline-none focus:border-sea-blue/50"
      >
        {ALL_EVENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      {/* Level pills */}
      <div className="flex items-center gap-1">
        {ALL_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            className={levelPillClass(level, activeLevels.has(level))}
            onClick={() => toggleLevel(level)}
          >
            {level}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        value={search}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search…"
        className="flex-1 min-w-0 text-[10px] bg-abyss text-sand border border-shell/20 rounded px-1.5 py-0.5 placeholder:text-shell/40 focus:outline-none focus:border-sea-blue/50"
      />
    </div>
  );
}
