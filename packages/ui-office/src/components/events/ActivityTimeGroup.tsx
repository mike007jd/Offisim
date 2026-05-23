import type { RuntimeEvent } from '@offisim/shared-types';
import { ActivityEventRow } from './ActivityEventRow';
import type { EventDisplayLevel } from './EventLog';
import { getEventId } from './workspace/activity-log-utils';

export interface ActivityTimeGroupProps {
  label: string;
  eventCount: number;
  events: Array<{ event: RuntimeEvent; level: EventDisplayLevel; collapsedCount?: number }>;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
  getEmployeeName?: (employeeId: string) => string | null;
}

export function ActivityTimeGroup({
  label,
  eventCount,
  events,
  selectedEventId,
  onSelectEvent,
  getEmployeeName,
}: ActivityTimeGroupProps) {
  return (
    <div>
      {/* Group header — sticky, surface-sunken band */}
      <div className="sticky top-0 z-sticky flex items-center gap-2 bg-surface-sunken px-4 py-2">
        <span className="text-fs-sm font-bold text-text-primary">{label}</span>
        <span className="rounded-full border border-line-soft bg-surface-1 px-1.5 py-0.5 text-caption text-text-muted">
          {eventCount}
        </span>
      </div>
      {/* Event rows */}
      {events.map(({ event, level, collapsedCount }) => {
        const id = getEventId(event);
        return (
          <ActivityEventRow
            key={id}
            event={event}
            level={level}
            collapsedCount={collapsedCount}
            getEmployeeName={getEmployeeName}
            selected={selectedEventId === id}
            onClick={() => onSelectEvent(id)}
          />
        );
      })}
    </div>
  );
}
