import type { RuntimeEvent } from '@offisim/shared-types';
import type { EventDisplayLevel } from './EventLog';

export type FilteredEvent = { event: RuntimeEvent; level: EventDisplayLevel };

export interface TimeGroup {
  label: string;
  events: FilteredEvent[];
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

  // Return non-empty groups in order
  return GROUP_ORDER.filter((key) => (buckets.get(key)?.length ?? 0) > 0).map((key) => ({
    label: key,
    events: buckets.get(key) ?? [],
  }));
}
