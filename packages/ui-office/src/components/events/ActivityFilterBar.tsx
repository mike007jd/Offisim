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
        <SelectTrigger className="activity-filter-control">
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
        <SelectTrigger className="activity-filter-control" title="Event types">
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
        <SelectTrigger className="activity-filter-control" title="Actors">
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
      <div className="activity-filterbar activity-filterbar-narrow">
        <ToolbarIconButton aria-label="Open activity filters" onClick={() => setSheetOpen(true)}>
          <SlidersHorizontal data-icon="filter" />
        </ToolbarIconButton>
        <div className="activity-filter-search-wrap">
          <Search data-icon="search" />
          <Input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search events..."
            className="activity-filter-search"
          />
        </div>
        <BottomSheetShell
          open={narrowSheetOpen}
          onOpenChange={setSheetOpen}
          stackId={sheetStackId}
          title="Filters"
          closeLabel="Close activity filters"
        >
          <div className="activity-filter-sheet-controls">{controls}</div>
        </BottomSheetShell>
      </div>
    );
  }

  return (
    <div className="activity-filterbar">
      {controls}

      <div className="activity-filter-search-wrap">
        <Search data-icon="search" />
        <Input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search events..."
          className="activity-filter-search"
        />
      </div>
    </div>
  );
}
