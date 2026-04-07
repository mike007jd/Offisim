import type { RuntimeEvent } from '@offisim/shared-types';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@offisim/ui-core';
import { formatTimestamp } from '../../../lib/format-time';
import { getEventLevel } from '../EventLog';
import type { EventDisplayLevel } from '../EventLog';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ActivityLogEventFocusProps {
  event: RuntimeEvent;
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFullTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getEntityLabel(event: RuntimeEvent): string {
  const payload = event.payload as Record<string, unknown>;
  if (typeof payload.employeeName === 'string') return payload.employeeName;
  if (typeof payload.nodeName === 'string') return payload.nodeName;
  if (typeof payload.name === 'string') return payload.name;
  if (event.entityId) return event.entityId;
  return '(unknown entity)';
}

const LEVEL_BADGE: Record<EventDisplayLevel, string> = {
  Info: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
  Warning: 'bg-amber-400/20 text-amber-400 border-amber-400/40',
  Error: 'bg-red-500/20 text-red-400 border-red-500/40',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityLogEventFocus({ event, onBack }: ActivityLogEventFocusProps) {
  const level = getEventLevel(event);
  const payload = event.payload as Record<string, unknown>;
  const entityLabel = getEntityLabel(event);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Back to timeline"
          className="h-7 w-7"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h2 className="text-sm font-medium text-slate-200 truncate">Event Detail</h2>
      </div>

      {/* Content */}
      <div className="flex flex-col gap-4 p-4">
        {/* Event type */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Event type</p>
          <p className="text-sm font-mono text-slate-200">{event.type.replaceAll('.', ' / ')}</p>
        </div>

        {/* Level badge */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Level</p>
          <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${LEVEL_BADGE[level]}`}>
            {level}
          </span>
        </div>

        {/* Timestamp */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Timestamp</p>
          <p className="text-xs text-slate-300">{formatFullTimestamp(event.timestamp)}</p>
          <p className="text-[11px] text-slate-500">{formatTimestamp(event.timestamp)}</p>
        </div>

        {/* Entity */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Entity</p>
          <p className="text-xs text-slate-300">{entityLabel}</p>
          {event.entityId && (
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">ID: {event.entityId}</p>
          )}
          <p className="text-[11px] text-slate-500 mt-0.5">Type: {event.entityType}</p>
        </div>

        {/* Payload */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Payload</p>
          <pre className="text-[11px] text-slate-300 bg-surface-light border border-border rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-words font-mono">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
