import { ActivityTimeGroup } from './ActivityTimeGroup';
import type { TimeGroup } from './activity-log-grouping';

export interface ActivityTimelineProps {
  groups: TimeGroup[];
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
  className?: string;
  getEmployeeName?: (employeeId: string) => string | null;
}

export function ActivityTimeline({
  groups,
  selectedEventId,
  onSelectEvent,
  className = '',
  getEmployeeName,
}: ActivityTimelineProps) {
  return (
    <div className={`overflow-y-auto ${className}`}>
      {groups.map((group) => (
        <ActivityTimeGroup
          key={group.label}
          label={group.label}
          eventCount={group.events.length}
          events={group.events}
          selectedEventId={selectedEventId}
          onSelectEvent={onSelectEvent}
          getEmployeeName={getEmployeeName}
        />
      ))}
    </div>
  );
}
