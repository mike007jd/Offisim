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
      'h-7 px-2 rounded text-caption font-medium cursor-pointer select-none transition-colors';
    if (!active)
      return `${base} bg-transparent text-text-muted border border-border-default opacity-60`;
    if (level === 'Error') return `${base} bg-error-muted text-error border border-error`;
    if (level === 'Warning') return `${base} bg-warning-muted text-warning border border-warning`;
    return `${base} bg-info-muted text-info border border-info`;
  };

  return (
    <div className="flex flex-col gap-1.5 border-b border-border-subtle px-3 py-1.5">
      {/* Top row: type dropdown + level pills */}
      <div className="flex items-center gap-1.5 overflow-hidden">
        <Select
          value={selectedType}
          onValueChange={(value) => handleTypeChange(value as EventFilterType)}
        >
          <SelectTrigger className="h-7 w-24 shrink-0 px-2 text-caption text-text-secondary">
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

        <div className="flex items-center gap-1">
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
        className="h-7 w-full rounded border-border-default bg-surface px-1.5 py-0.5 text-caption text-text-primary placeholder:text-text-muted focus:border-border-focus"
      />
    </div>
  );
}
