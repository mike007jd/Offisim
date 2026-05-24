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
    <div className="activity-time-group">
      {/* Group header — sticky, surface-sunken band */}
      <div className="activity-time-header">
        <span className="activity-time-label">{label}</span>
        <span className="activity-time-count">{eventCount}</span>
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
