import type { RuntimeEvent } from '@offisim/shared-types';
import { ActivityEventRow } from './ActivityEventRow';
import type { EventDisplayLevel } from './EventLog';
import { getEventId } from './workspace/activity-log-utils';

export interface ActivityTimeGroupProps {
  label: string;
  eventCount: number;
  events: Array<{ event: RuntimeEvent; level: EventDisplayLevel }>;
  selectedEventId: string | null;
  onSelectEvent: (eventId: string) => void;
}

export function ActivityTimeGroup({
  label,
  eventCount,
  events,
  selectedEventId,
  onSelectEvent,
}: ActivityTimeGroupProps) {
  return (
    <div>
      {/* Group header */}
      <div className="flex items-center gap-2 px-4 py-2 bg-white/[0.03]">
        <span className="text-xs font-bold text-slate-300">{label}</span>
        <span className="text-[10px] text-slate-500 bg-white/[0.06] px-1.5 py-0.5 rounded-full">
          {eventCount}
        </span>
      </div>
      {/* Event rows */}
      {events.map(({ event, level }) => {
        const id = getEventId(event);
        return (
          <ActivityEventRow
            key={id}
            event={event}
            level={level}
            selected={selectedEventId === id}
            onClick={() => onSelectEvent(id)}
          />
        );
      })}
    </div>
  );
}
