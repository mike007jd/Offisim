import { Search } from 'lucide-react';
import { useCallback } from 'react';
import { ALL_EVENT_TYPES, ALL_LEVELS } from '../EventFilters';
import type { EventFilterType, EventLevel } from '../EventFilters';

// ---------------------------------------------------------------------------
// Date presets
// ---------------------------------------------------------------------------

const DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom' },
] as const;

export type DatePreset = (typeof DATE_PRESETS)[number]['value'];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ActivityLogFiltersPaneProps {
  search: string;
  eventTypes: string[];
  datePreset: DatePreset;
  onSearchChange: (search: string) => void;
  onEventTypesChange: (types: string[]) => void;
  onDatePresetChange: (preset: DatePreset) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityLogFiltersPane({
  search,
  eventTypes,
  datePreset,
  onSearchChange,
  onEventTypesChange,
  onDatePresetChange,
}: ActivityLogFiltersPaneProps) {
  const toggleEventType = useCallback(
    (type: string) => {
      if (type === 'All') {
        onEventTypesChange([]);
        return;
      }
      const next = eventTypes.includes(type)
        ? eventTypes.filter((t) => t !== type)
        : [...eventTypes, type];
      onEventTypesChange(next);
    },
    [eventTypes, onEventTypesChange],
  );

  const isTypeActive = (type: EventFilterType) => {
    if (type === 'All') return eventTypes.length === 0;
    return eventTypes.includes(type);
  };

  return (
    <div className="flex flex-col gap-4 p-4 h-full overflow-y-auto">
      {/* Search */}
      <div>
        <label
          htmlFor="activity-log-search"
          className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5 block"
        >
          Search
        </label>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            id="activity-log-search"
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search events…"
            className="w-full text-xs bg-surface-light text-slate-100 border border-border rounded-md pl-7 pr-2 py-1.5 placeholder:text-slate-500 focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>

      {/* Date preset */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
          Time range
        </p>
        <div className="flex flex-wrap gap-1">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onDatePresetChange(p.value)}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                datePreset === p.value
                  ? 'bg-accent/20 text-accent border border-accent/40'
                  : 'bg-transparent text-slate-400 border border-slate-400/20 hover:border-slate-400/40'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Event type filters */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
          Event types
        </p>
        <div className="flex flex-wrap gap-1">
          {ALL_EVENT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleEventType(type)}
              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                isTypeActive(type)
                  ? 'bg-accent/20 text-accent border border-accent/40'
                  : 'bg-transparent text-slate-400 border border-slate-400/20 hover:border-slate-400/40'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Level filters (Info, Warning, Error) */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
          Levels
        </p>
        <div className="flex flex-wrap gap-1">
          {ALL_LEVELS.map((level) => {
            const active = eventTypes.length === 0 || eventTypes.includes(level);
            return <LevelPill key={level} level={level} active={active} />;
          })}
        </div>
      </div>

      {/* Actor filters — placeholder */}
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5">
          Actors
        </p>
        <p className="text-[11px] text-slate-500 italic">
          All actors shown. Actor filtering coming soon.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Level pill (display-only for now — levels are derived from event topics)
// ---------------------------------------------------------------------------

function LevelPill({ level, active }: { level: EventLevel; active: boolean }) {
  const colorMap: Record<EventLevel, string> = {
    Info: active ? 'bg-blue-500/20 text-blue-400 border-blue-500/40' : '',
    Warning: active ? 'bg-amber-400/20 text-amber-400 border-amber-400/40' : '',
    Error: active ? 'bg-red-500/20 text-red-400 border-red-500/40' : '',
  };

  return (
    <span
      className={`px-2 py-1 rounded text-[11px] font-medium border ${
        active ? colorMap[level] : 'bg-transparent text-slate-400 border-slate-400/20 opacity-40'
      }`}
    >
      {level}
    </span>
  );
}
