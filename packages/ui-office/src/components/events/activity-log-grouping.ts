import { type RuntimeEvent, TASK_ASSIGNMENT_REROUTED } from '@offisim/shared-types';
import type { EventDisplayLevel } from './EventLog';

export type FilteredEvent = {
  event: RuntimeEvent;
  level: EventDisplayLevel;
  /**
   * When > 1, indicates this row represents a collapsed run of N consecutive
   * `task.assignment.rerouted` events sharing source + reason + taskRunId.
   * Renderer shows a `×N` badge next to the row.
   */
  collapsedCount?: number;
};

export interface TimeGroup {
  label: string;
  events: FilteredEvent[];
}

const COLLAPSE_THRESHOLD = 3;

function rerouteGroupKey(event: RuntimeEvent): string | null {
  if (event.type !== TASK_ASSIGNMENT_REROUTED) return null;
  const p = event.payload as Record<string, unknown>;
  const source = typeof p.source === 'string' ? p.source : '?';
  const reason = typeof p.reason === 'string' ? p.reason : '?';
  const taskRunId = typeof p.taskRunId === 'string' ? p.taskRunId : '?';
  return `${source}|${reason}|${taskRunId}`;
}

/**
 * Collapse runs of 3+ consecutive `task.assignment.rerouted` events that
 * share `source + reason + taskRunId` into a single row with a `×N` badge.
 *
 * The first event in the run is the representative row (carries the formatted
 * label); subsequent events are dropped from the timeline but the count is
 * preserved on the representative row's `collapsedCount`.
 *
 * Runs of <3 events are passed through untouched — keeps low-noise reruns
 * fully visible while compacting genuine spam.
 */
export function collapseConsecutiveReroutes(events: FilteredEvent[]): FilteredEvent[] {
  if (events.length === 0) return events;
  const result: FilteredEvent[] = [];
  let i = 0;
  while (i < events.length) {
    const current = events[i];
    if (!current) {
      i++;
      continue;
    }
    const key = rerouteGroupKey(current.event);
    if (!key) {
      result.push(current);
      i++;
      continue;
    }
    let runEnd = i + 1;
    while (runEnd < events.length) {
      const next = events[runEnd];
      if (!next || rerouteGroupKey(next.event) !== key) break;
      runEnd++;
    }
    const runLength = runEnd - i;
    if (runLength >= COLLAPSE_THRESHOLD) {
      result.push({ ...current, collapsedCount: runLength });
    } else {
      for (let j = i; j < runEnd; j++) {
        const item = events[j];
        if (item) result.push(item);
      }
    }
    i = runEnd;
  }
  return result;
}

export const GROUP_ORDER = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older'] as const;

/**
 * Group filtered events into time buckets (Today, Yesterday, This Week,
 * This Month, Older). Events within each group are sorted descending by
 * timestamp. Empty groups are filtered out.
 */
export function groupEventsByTime(events: FilteredEvent[]): TimeGroup[] {
  const now = new Date();

  // Today 00:00
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  // Yesterday 00:00
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;

  // This week Monday 00:00
  const dayOfWeek = now.getDay(); // 0=Sun … 6=Sat
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisWeekStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysSinceMonday,
  ).getTime();

  // This month 1st 00:00
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

  const buckets = new Map<string, FilteredEvent[]>(GROUP_ORDER.map((key) => [key, []]));

  for (const item of events) {
    const ts = item.event.timestamp;
    if (ts >= todayStart) {
      buckets.get('Today')?.push(item);
    } else if (ts >= yesterdayStart) {
      buckets.get('Yesterday')?.push(item);
    } else if (ts >= thisWeekStart) {
      buckets.get('This Week')?.push(item);
    } else if (ts >= thisMonthStart) {
      buckets.get('This Month')?.push(item);
    } else {
      buckets.get('Older')?.push(item);
    }
  }

  // Sort each bucket descending by timestamp
  for (const key of GROUP_ORDER) {
    buckets.get(key)?.sort((a, b) => b.event.timestamp - a.event.timestamp);
  }

  // Return non-empty groups, collapsing 3+ consecutive reroute events per group.
  return GROUP_ORDER.filter((key) => (buckets.get(key)?.length ?? 0) > 0).map((key) => ({
    label: key,
    events: collapseConsecutiveReroutes(buckets.get(key) ?? []),
  }));
}
