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

  function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = e.target.value;
    onEventTypesChange(selected === 'all' ? [] : [selected]);
  }

  function handleActorChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = e.target.value;
    onActorFiltersChange(selected === 'all' ? [] : [selected]);
  }

  const eventTypeValue = eventTypes[0] ?? 'all';
  const actorValue = actorFilters[0] ?? 'all';
  const controlClass =
    'h-9 min-w-0 flex-1 rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary focus:border-border-focus focus:outline-none';

  const controls = (
    <>
      <select
        value={datePreset}
        onChange={(e) => onDatePresetChange(e.target.value as DatePreset)}
        className={controlClass}
      >
        {DATE_PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      <select
        value={eventTypeValue}
        onChange={handleTypeChange}
        className={controlClass}
        title="Event types"
      >
        <option value="all">All events</option>
        {ALL_EVENT_TYPES.filter((t) => t !== 'All').map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>

      <select
        value={actorValue}
        onChange={handleActorChange}
        className={controlClass}
        title="Actors"
      >
        <option value="all">All actors</option>
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
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border-default bg-surface-elevated px-3">
        <button
          type="button"
          aria-label="Open activity filters"
          onClick={() => setSheetOpen(true)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-default bg-surface-muted text-text-secondary"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search events..."
            className="h-9 w-full rounded-lg border border-border-default bg-surface py-2 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
          />
        </div>
        {sheetOpen && (
          <div className="fixed inset-0 z-modal">
            <button
              type="button"
              aria-label="Close activity filters"
              className="absolute inset-0 bg-surface/70"
              onClick={() => setSheetOpen(false)}
            />
            <div
              ref={sheetRef}
              className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-border-default bg-surface-elevated p-4 shadow-modal"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">Filters</h2>
                <button
                  type="button"
                  aria-label="Close filters"
                  onClick={() => setSheetOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border-default bg-surface-muted text-text-secondary"
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
    <div className="grid h-14 shrink-0 grid-cols-[repeat(3,minmax(0,1fr))_minmax(160px,2fr)] items-center gap-3 border-b border-border-default bg-surface-elevated px-6">
      {controls}

      <div className="relative min-w-0">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search events..."
          className="h-9 w-full rounded-lg border border-border-default bg-surface py-1.5 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none"
        />
      </div>
    </div>
  );
}
