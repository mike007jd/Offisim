import {
  BottomSheetShell,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ToolbarIconButton,
} from '@offisim/ui-core';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { ALL_EVENT_TYPES } from './activity-event-options';
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

const ACTIVITY_FILTER_BAR_CLASS =
  'grid h-activity-filter-bar shrink-0 grid-activity-filter items-center gap-sp-3 border-b border-line bg-surface-1 px-sp-6';
const ACTIVITY_FILTER_NARROW_CLASS =
  'flex h-activity-filter-bar shrink-0 items-center gap-sp-2 border-b border-line bg-surface-1 px-sp-3';
const ACTIVITY_FILTER_CONTROL_CLASS =
  'h-activity-filter-control min-w-0 flex-1 border-line bg-surface-2 text-fs-sm';
const ACTIVITY_FILTER_SEARCH_CLASS =
  'h-activity-filter-control w-full border-line bg-surface-2 pl-activity-search text-fs-sm text-ink-1 placeholder:text-ink-4 focus:border-accent';
const ACTIVITY_FILTER_SEARCH_ICON_CLASS =
  'activity-search-icon activity-search-icon-position absolute text-ink-4';
const ACTIVITY_FILTER_ICON_CLASS = 'activity-filter-icon';
const ACTIVITY_FILTER_SHEET_CONTROLS_CLASS = 'grid gap-sp-3';

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
  const [sheetOpen, setSheetOpen] = useState(false);
  const narrowSheetOpen = variant === 'narrow' && sheetOpen;

  function handleTypeChange(selected: string) {
    onEventTypesChange(selected === 'all' ? [] : [selected]);
  }

  function handleActorChange(selected: string) {
    onActorFiltersChange(selected === 'all' ? [] : [selected]);
  }

  const eventTypeValue = eventTypes[0] ?? 'all';
  const actorValue = actorFilters[0] ?? 'all';
  const inNarrowSheet = variant === 'narrow';

  const controls = (
    <>
      <Select value={datePreset} onValueChange={(value) => onDatePresetChange(value as DatePreset)}>
        <SelectTrigger className={ACTIVITY_FILTER_CONTROL_CLASS}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent layer={inNarrowSheet ? 'top' : 'default'}>
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
        <SelectTrigger className={ACTIVITY_FILTER_CONTROL_CLASS} title="Event types">
          <SelectValue />
        </SelectTrigger>
        <SelectContent layer={inNarrowSheet ? 'top' : 'default'}>
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
        <SelectTrigger className={ACTIVITY_FILTER_CONTROL_CLASS} title="Actors">
          <SelectValue />
        </SelectTrigger>
        <SelectContent layer={inNarrowSheet ? 'top' : 'default'}>
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
      <div className={ACTIVITY_FILTER_NARROW_CLASS}>
        <ToolbarIconButton aria-label="Open activity filters" onClick={() => setSheetOpen(true)}>
          <SlidersHorizontal className={ACTIVITY_FILTER_ICON_CLASS} />
        </ToolbarIconButton>
        <div className="relative min-w-0 flex-1">
          <Search className={ACTIVITY_FILTER_SEARCH_ICON_CLASS} />
          <Input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search events..."
            className={ACTIVITY_FILTER_SEARCH_CLASS}
          />
        </div>
        <BottomSheetShell
          open={narrowSheetOpen}
          onOpenChange={setSheetOpen}
          stackId={sheetStackId}
          title="Filters"
          closeLabel="Close activity filters"
        >
          <div className={ACTIVITY_FILTER_SHEET_CONTROLS_CLASS}>{controls}</div>
        </BottomSheetShell>
      </div>
    );
  }

  return (
    <div className={ACTIVITY_FILTER_BAR_CLASS}>
      {controls}

      <div className="relative min-w-0">
        <Search className={ACTIVITY_FILTER_SEARCH_ICON_CLASS} />
        <Input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search events..."
          className={ACTIVITY_FILTER_SEARCH_CLASS}
        />
      </div>
    </div>
  );
}
