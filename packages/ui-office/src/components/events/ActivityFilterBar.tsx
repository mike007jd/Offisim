import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useFocusTrap,
  useRegisterModal,
  useTopmostEscape,
} from '@offisim/ui-core';
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

  function handleTypeChange(selected: string) {
    onEventTypesChange(selected === 'all' ? [] : [selected]);
  }

  function handleActorChange(selected: string) {
    onActorFiltersChange(selected === 'all' ? [] : [selected]);
  }

  const eventTypeValue = eventTypes[0] ?? 'all';
  const actorValue = actorFilters[0] ?? 'all';
  const controlClass = 'h-9 min-w-0 flex-1';

  const controls = (
    <>
      <Select value={datePreset} onValueChange={(value) => onDatePresetChange(value as DatePreset)}>
        <SelectTrigger className={controlClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {DATE_PRESETS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Select value={eventTypeValue} onValueChange={handleTypeChange}>
        <SelectTrigger className={controlClass} title="Event types">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">All events</SelectItem>
            {ALL_EVENT_TYPES.filter((t) => t !== 'All').map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      <Select value={actorValue} onValueChange={handleActorChange}>
        <SelectTrigger className={controlClass} title="Actors">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="all">All actors</SelectItem>
            {actorOptions.map((actor) => (
              <SelectItem key={actor} value={actor}>
                {actor}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </>
  );

  if (variant === 'narrow') {
    return (
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border-default bg-surface-elevated px-3">
        <Button
          type="button"
          aria-label="Open activity filters"
          onClick={() => setSheetOpen(true)}
          variant="secondary"
          size="icon"
          className="size-9 shrink-0 text-text-secondary"
        >
          <SlidersHorizontal className="size-4" />
        </Button>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
          <Input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search events..."
            className="h-9 w-full border-border-default bg-surface pl-8 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus"
          />
        </div>
        {sheetOpen && (
          <div className="fixed inset-0 z-modal">
            <Button
              type="button"
              aria-label="Close activity filters"
              variant="ghost"
              className="absolute inset-0 h-auto rounded-none bg-surface/70"
              onClick={() => setSheetOpen(false)}
            />
            <div
              ref={sheetRef}
              className="absolute inset-x-0 bottom-0 rounded-t-2xl border border-border-default bg-surface-elevated p-4 shadow-modal"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-text-primary">Filters</h2>
                <Button
                  type="button"
                  aria-label="Close filters"
                  onClick={() => setSheetOpen(false)}
                  variant="secondary"
                  size="icon"
                  className="size-8 text-text-secondary"
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="mt-4 grid gap-3">{controls}</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid h-14 shrink-0 grid-activity-filter items-center gap-3 border-b border-border-default bg-surface-elevated px-6">
      {controls}

      <div className="relative min-w-0">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
        <Input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search events..."
          className="h-9 w-full border-border-default bg-surface pl-8 text-sm text-text-primary placeholder:text-text-muted focus:border-border-focus"
        />
      </div>
    </div>
  );
}
