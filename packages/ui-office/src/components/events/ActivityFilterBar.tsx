import { Search } from 'lucide-react';
import { ALL_EVENT_TYPES } from './EventFilters';
import type { DatePreset } from './workspace/activity-log-utils';

export interface ActivityFilterBarProps {
  datePreset: DatePreset;
  eventTypes: string[];
  actorFilters: string[];
  actorOptions: string[];
  search: string;
  onDatePresetChange: (preset: DatePreset) => void;
  onEventTypesChange: (types: string[]) => void;
  onActorFiltersChange: (actors: string[]) => void;
  onSearchChange: (search: string) => void;
}

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'All time' },
];

export function ActivityFilterBar({
  datePreset,
  eventTypes,
  actorFilters,
  actorOptions,
  search,
  onDatePresetChange,
  onEventTypesChange,
  onActorFiltersChange,
  onSearchChange,
}: ActivityFilterBarProps) {
  function handleTypeToggle(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = Array.from(e.target.selectedOptions, (opt) => opt.value);
    onEventTypesChange(selected);
  }

  function handleActorToggle(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = Array.from(e.target.selectedOptions, (opt) => opt.value);
    onActorFiltersChange(selected);
  }

  return (
    <div className="flex h-16 items-center gap-3 px-6 border-b border-white/10 shrink-0">
      {/* Date preset */}
      <select
        value={datePreset}
        onChange={(e) => onDatePresetChange(e.target.value as DatePreset)}
        className="text-xs bg-white/[0.06] text-slate-300 border border-white/10 rounded-md px-2 py-1.5 focus:outline-none focus:border-accent/50"
      >
        {DATE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      {/* Event type multi-select */}
      <select
        multiple
        value={eventTypes}
        onChange={handleTypeToggle}
        className="text-xs bg-white/[0.06] text-slate-300 border border-white/10 rounded-md px-2 py-1.5 focus:outline-none focus:border-accent/50 max-h-8 overflow-hidden"
        title="Event types"
      >
        {ALL_EVENT_TYPES.filter((t) => t !== 'All').map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>

      {/* Actor multi-select */}
      <select
        multiple
        value={actorFilters}
        onChange={handleActorToggle}
        className="text-xs bg-white/[0.06] text-slate-300 border border-white/10 rounded-md px-2 py-1.5 focus:outline-none focus:border-accent/50 max-h-8 overflow-hidden"
        title="Actors"
      >
        {actorOptions.map((actor) => (
          <option key={actor} value={actor}>
            {actor}
          </option>
        ))}
      </select>

      {/* Search */}
      <div className="relative flex-1">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search events..."
          className="w-full text-xs bg-white/[0.06] text-slate-200 border border-white/10 rounded-md pl-8 pr-3 py-1.5 placeholder:text-slate-500 focus:outline-none focus:border-accent/50"
        />
      </div>
    </div>
  );
}
