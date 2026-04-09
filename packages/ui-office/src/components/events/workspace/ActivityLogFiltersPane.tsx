import { Search } from 'lucide-react';
import { ALL_EVENT_TYPES, ALL_LEVELS } from '../EventFilters';
import type { EventFilterType, EventLevel } from '../EventFilters';
import type { DatePreset } from './activity-log-utils';

export type { DatePreset };

// ---------------------------------------------------------------------------
// Date presets
// ---------------------------------------------------------------------------

const DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom' },
] as const satisfies readonly { value: DatePreset; label: string }[];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ActivityLogFiltersPaneProps {
  search: string;
  eventTypes: string[];
  actorOptions: string[];
  actorFilters: string[];
  datePreset: DatePreset;
  onSearchChange: (search: string) => void;
  onEventTypesChange: (types: string[]) => void;
  onActorFiltersChange: (actors: string[]) => void;
  onDatePresetChange: (preset: DatePreset) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityLogFiltersPane({
  search,
  eventTypes,
  actorOptions,
  actorFilters,
  datePreset,
  onSearchChange,
  onEventTypesChange,
  onActorFiltersChange,
  onDatePresetChange,
}: ActivityLogFiltersPaneProps) {
  function toggleEventType(type: string) {
    if (type === 'All') {
      onEventTypesChange([]);
      return;
    }
    const next = eventTypes.includes(type)
      ? eventTypes.filter((t) => t !== type)
      : [...eventTypes, type];
    onEventTypesChange(next);
  }

  const isTypeActive = (type: EventFilterType) => {
    if (type === 'All') return eventTypes.length === 0;
    return eventTypes.includes(type);
  };

  function toggleActor(actor: string) {
    const next = actorFilters.includes(actor)
      ? actorFilters.filter((currentActor) => currentActor !== actor)
      : [...actorFilters, actor];
    onActorFiltersChange(next);
  }

  return (
    <div className="flex flex-col gap-5 p-5 h-full overflow-y-auto">
      {/* Search */}
      <div>
        <label
          htmlFor="activity-log-search"
          className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-2 block"
        >
          Search
        </label>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            id="activity-log-search"
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search events…"
            className="w-full text-[13px] bg-surface-light text-slate-100 border border-border rounded-lg pl-8 pr-3 py-2 placeholder:text-slate-500 focus:outline-none focus:border-accent/50"
          />
        </div>
      </div>

      {/* Date preset */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-2">
          Time range
        </p>
        <div className="flex flex-wrap gap-1.5">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => onDatePresetChange(p.value)}
              className={`px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
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
        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-2">
          Event types
        </p>
        <div className="flex flex-wrap gap-1.5">
          {ALL_EVENT_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleEventType(type)}
              className={`px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
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
        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-2">
          Levels
        </p>
        <div className="flex flex-wrap gap-1.5">
          {ALL_LEVELS.map((level) => {
            const active = eventTypes.length === 0 || eventTypes.includes(level);
            return <LevelPill key={level} level={level} active={active} />;
          })}
        </div>
      </div>

      {/* Actor filters */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400 font-semibold mb-2">
          Actors
        </p>
        {actorOptions.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No actor-specific events yet.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => onActorFiltersChange([])}
              className={`px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                actorFilters.length === 0
                  ? 'bg-accent/20 text-accent border border-accent/40'
                  : 'bg-transparent text-slate-400 border border-slate-400/20 hover:border-slate-400/40'
              }`}
            >
              All actors
            </button>
            {actorOptions.map((actor) => (
              <button
                key={actor}
                type="button"
                onClick={() => toggleActor(actor)}
                className={`px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors truncate max-w-full ${
                  actorFilters.includes(actor)
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/40'
                    : 'bg-transparent text-slate-400 border border-slate-400/20 hover:border-slate-400/40'
                }`}
              >
                {actor}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Level pill (display-only for now — levels are derived from event topics)
// ---------------------------------------------------------------------------

const ACTIVE_LEVEL_COLORS: Record<EventLevel, string> = {
  Info: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
  Warning: 'bg-amber-400/20 text-amber-400 border-amber-400/40',
  Error: 'bg-red-500/20 text-red-400 border-red-500/40',
};

function LevelPill({ level, active }: { level: EventLevel; active: boolean }) {
  return (
    <span
      className={`px-2.5 py-1.5 rounded-lg text-[13px] font-medium border ${
        active
          ? ACTIVE_LEVEL_COLORS[level]
          : 'bg-transparent text-slate-400 border-slate-400/20 opacity-40'
      }`}
    >
      {level}
    </span>
  );
}
