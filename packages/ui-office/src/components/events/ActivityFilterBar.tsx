import { useFocusTrap, useRegisterModal, useTopmostEscape } from '@offisim/ui-core';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { ALL_EVENT_TYPES } from './EventFilters';
import type { DatePreset } from './workspace/activity-log-utils';

export interface ActivityFilterBarProps {
  datePreset: DatePreset;
  eventTypes: string[];
  actorFilters: string[];
  actorOptions: string[];
  search: string;
  variant?: 'default' | 'narrow';
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
  variant = 'default',
  onDatePresetChange,
  onEventTypesChange,
  onActorFiltersChange,
  onSearchChange,
}: ActivityFilterBarProps) {
  const sheetStackId = 'activity-filter-sheet';
  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const narrowSheetOpen = variant === 'narrow' && sheetOpen;

  useRegisterModal(narrowSheetOpen ? sheetStackId : null, 'overlay');
  useTopmostEscape(narrowSheetOpen ? sheetStackId : null, () => setSheetOpen(false), {
    enabled: narrowSheetOpen,
  });
  useFocusTrap(sheetRef, narrowSheetOpen);

  function handleTypeToggle(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = Array.from(e.target.selectedOptions, (opt) => opt.value);
    onEventTypesChange(selected);
  }

  function handleActorToggle(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = Array.from(e.target.selectedOptions, (opt) => opt.value);
    onActorFiltersChange(selected);
  }

  const controls = (
    <>
      <select
        value={datePreset}
        onChange={(e) => onDatePresetChange(e.target.value as DatePreset)}
        className="rounded-md border border-white/10 bg-white/[0.06] px-2 py-1.5 text-xs text-slate-300 focus:border-accent/50 focus:outline-none"
      >
        {DATE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      <select
        multiple
        value={eventTypes}
        onChange={handleTypeToggle}
        className="max-h-8 overflow-hidden rounded-md border border-white/10 bg-white/[0.06] px-2 py-1.5 text-xs text-slate-300 focus:border-accent/50 focus:outline-none"
        title="Event types"
      >
        {ALL_EVENT_TYPES.filter((t) => t !== 'All').map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>

      <select
        multiple
        value={actorFilters}
        onChange={handleActorToggle}
        className="max-h-8 overflow-hidden rounded-md border border-white/10 bg-white/[0.06] px-2 py-1.5 text-xs text-slate-300 focus:border-accent/50 focus:outline-none"
        title="Actors"
      >
        {actorOptions.map((actor) => (
          <option key={actor} value={actor}>
            {actor}
          </option>
        ))}
      </select>
    </>
  );

  if (variant === 'narrow') {
    return (
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 px-3">
        <button
          type="button"
          aria-label="Open activity filters"
          onClick={() => setSheetOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.06] text-slate-300"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search events..."
            className="w-full rounded-md border border-white/10 bg-white/[0.06] py-2 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-500 focus:border-accent/50 focus:outline-none"
          />
        </div>
        {sheetOpen && (
          <div className="fixed inset-0 z-modal">
            <button
              type="button"
              aria-label="Close activity filters"
              className="absolute inset-0 bg-black/60"
              onClick={() => setSheetOpen(false)}
            />
            <div
              ref={sheetRef}
              className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-white/10 bg-slate-950 p-4 shadow-modal"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-100">Filters</h2>
                <button
                  type="button"
                  aria-label="Close filters"
                  onClick={() => setSheetOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 grid gap-3">{controls}</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-6">
      {controls}

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
