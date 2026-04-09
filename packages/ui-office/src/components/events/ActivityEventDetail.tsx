import type { RuntimeEvent } from '@offisim/shared-types';
import { X } from 'lucide-react';
import { formatFullTimestamp } from '../../lib/format-time';
import { ActivityPayloadView } from './ActivityPayloadView';
import { getDisplayLabel } from './EventItem';
import { getEventLevel } from './EventLog';
import type { EventDisplayLevel } from './EventLog';

export interface ActivityEventDetailProps {
  event: RuntimeEvent;
  onClose: () => void;
}

const LEVEL_BADGE: Record<EventDisplayLevel, string> = {
  Info: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
  Warning: 'bg-amber-400/20 text-amber-400 border-amber-400/40',
  Error: 'bg-red-500/20 text-red-400 border-red-500/40',
};

export function ActivityEventDetail({ event, onClose }: ActivityEventDetailProps) {
  const level = getEventLevel(event);
  const payload = event.payload as Record<string, unknown>;
  const entityLabel = getDisplayLabel(event);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <h2 className="text-sm font-medium text-slate-200">Event Detail</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close detail panel"
          className="p-1 rounded hover:bg-white/10 transition-colors"
        >
          <X className="h-4 w-4 text-slate-400" />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {/* Event Type */}
        <Section label="Event Type">
          <p className="text-sm font-mono text-slate-200">{event.type.replaceAll('.', ' / ')}</p>
        </Section>

        {/* Level */}
        <Section label="Level">
          <span
            className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${LEVEL_BADGE[level]}`}
          >
            {level}
          </span>
        </Section>

        {/* Timestamp */}
        <Section label="Timestamp">
          <p className="text-xs text-slate-300">{formatFullTimestamp(event.timestamp)}</p>
        </Section>

        {/* Entity */}
        <Section label="Entity">
          <p className="text-xs text-slate-300">{entityLabel}</p>
          {event.entityType && (
            <p className="text-[11px] text-slate-500 mt-0.5">Type: {event.entityType}</p>
          )}
          {event.entityId && (
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">ID: {event.entityId}</p>
          )}
        </Section>

        {/* Payload */}
        <Section label="Payload">
          <ActivityPayloadView payload={payload} />
        </Section>
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{label}</p>
      {children}
    </div>
  );
}
