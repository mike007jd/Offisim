import type { RuntimeEvent } from '@offisim/shared-types';
import { getDisplayLabel } from './EventItem';
import { getEventLevel } from './EventLog';
import type { EventDisplayLevel } from './EventLog';
import { TYPE_PREFIX_MAP, type EventFilterType } from './activity-event-options';
import {
  type DatePreset,
  getDateCutoff,
  matchesActorFilters,
} from './workspace/activity-log-utils';

export type FilteredEvent = { event: RuntimeEvent; level: EventDisplayLevel };

export interface FilterOptions {
  datePreset: DatePreset;
  eventTypes: string[];
  actorFilters: string[];
  search: string;
}

/**
 * Combined filter pipeline: date → type → actor → search.
 * Returns enriched events with their computed display level.
 */
export function filterEvents(events: RuntimeEvent[], filters: FilterOptions): FilteredEvent[] {
  const cutoff = getDateCutoff(filters.datePreset);
  const searchLower = filters.search.toLowerCase();

  // Collect prefixes from selected event types
  const prefixes: string[] = [];
  if (filters.eventTypes.length > 0) {
    for (const type of filters.eventTypes) {
      const p = TYPE_PREFIX_MAP[type as EventFilterType];
      if (p) prefixes.push(...p);
    }
  }

  const result: FilteredEvent[] = [];
  for (const event of events) {
    // Date filter
    if (event.timestamp < cutoff) continue;
    // Type filter
    if (prefixes.length > 0 && !prefixes.some((p) => event.type.startsWith(p))) continue;
    // Actor filter
    if (!matchesActorFilters(event, filters.actorFilters)) continue;
    // Search filter
    if (searchLower) {
      const haystack =
        `${event.type} ${getDisplayLabel(event)} ${event.entityType ?? ''}`.toLowerCase();
      if (!haystack.includes(searchLower)) continue;
    }
    result.push({ event, level: getEventLevel(event) });
  }
  return result;
}
