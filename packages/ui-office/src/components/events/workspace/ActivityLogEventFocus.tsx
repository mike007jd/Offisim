import type { RuntimeEvent } from '@offisim/shared-types';
import { Button } from '@offisim/ui-core';
import { ArrowLeft } from 'lucide-react';
import { formatFullTimestamp, formatTimestamp } from '../../../lib/format-time';
import { getDisplayLabel } from '../EventItem';
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
  const entityLabel = getDisplayLabel(event);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
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

      <div className="flex flex-col gap-4 p-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Event type</p>
          <p className="text-sm font-mono text-slate-200">{event.type.replaceAll('.', ' / ')}</p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Level</p>
          <span
            className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${LEVEL_BADGE[level]}`}
          >
            {level}
          </span>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Timestamp</p>
          <p className="text-xs text-slate-300">{formatFullTimestamp(event.timestamp)}</p>
          <p className="text-[11px] text-slate-500">{formatTimestamp(event.timestamp)}</p>
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Entity</p>
          <p className="text-xs text-slate-300">{entityLabel}</p>
          {event.entityId && (
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">ID: {event.entityId}</p>
          )}
          <p className="text-[11px] text-slate-500 mt-0.5">Type: {event.entityType}</p>
        </div>

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
