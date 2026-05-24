import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@offisim/ui-core';
import { useCallback, useState } from 'react';

export interface EventFilterState {
  types: string[];
  levels: string[];
  search: string;
}

export const ALL_EVENT_TYPES = [
  'All',
  'Node',
  'Plan',
  'Task',
  'Deliverable',
  'Employee',
  'Install',
  'Skill',
  'LLM',
  'Interaction',
  'Error',
  'MCP',
  'Knowledge',
  'Meeting',
  'HR',
  'Memory',
  'Infrastructure',
  'Git',
  'Attachment',
] as const;
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
    const base =
      'activity-filter-pill rounded-r-xs px-sp-2 text-fs-meta font-medium cursor-pointer select-none transition-colors';
    if (!active) return `${base} bg-transparent text-ink-4 border border-line`;
    if (level === 'Error') return `${base} bg-danger-surface text-danger border border-danger`;
    if (level === 'Warning') return `${base} bg-warn-surface text-warn border border-warn`;
    return `${base} bg-accent-surface text-accent border border-accent`;
  };

  return (
    <div className="flex flex-col gap-sp-2 border-b border-line-soft bg-surface-1 px-sp-3 py-sp-2">
      {/* Top row: type dropdown + level pills */}
      <div className="flex items-center gap-sp-2 overflow-hidden">
        <Select
          value={selectedType}
          onValueChange={(value) => handleTypeChange(value as EventFilterType)}
        >
          <SelectTrigger className="activity-filter-type-trigger shrink-0 px-sp-2 text-fs-meta text-ink-3">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {ALL_EVENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <div className="flex items-center gap-sp-1">
          {ALL_LEVELS.map((level) => (
            <Button
              key={level}
              type="button"
              variant="ghost"
              className={cn(levelPillClass(level, activeLevels.has(level)))}
              onClick={() => toggleLevel(level)}
            >
              {level}
            </Button>
          ))}
        </div>
      </div>

      {/* Search — own row to prevent overflow */}
      <Input
        type="text"
        value={search}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder="Search events..."
        className="activity-legacy-search w-full rounded-r-xs border-line bg-surface-2 px-sp-2 text-fs-meta text-ink-1 placeholder:text-ink-4 focus:border-accent"
      />
    </div>
  );
}
