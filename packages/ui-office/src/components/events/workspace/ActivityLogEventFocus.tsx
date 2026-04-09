import type { RuntimeEvent } from '@offisim/shared-types';
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
  const typeParts = event.type.split('.');

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/[0.06] shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
          aria-label="Back to timeline"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          {typeParts.map((part, i) => (
            <span key={part} className="flex items-center gap-2">
              {i > 0 && <span className="text-slate-600">/</span>}
              <span
                className={
                  i === typeParts.length - 1
                    ? 'text-sm font-semibold text-white'
                    : 'text-sm text-slate-400'
                }
              >
                {part}
              </span>
            </span>
          ))}
        </div>
        <span
          className={`ml-2 shrink-0 inline-block px-2 py-0.5 rounded text-[11px] font-medium border ${LEVEL_BADGE[level]}`}
        >
          {level}
        </span>
      </div>

      {/* Content -- two column grid */}
      <div className="flex-1 p-5">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4 h-full">
          {/* Left -- event metadata */}
          <div className="flex flex-col gap-3">
            {/* Entity card */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Entity</p>
              <p className="text-sm font-medium text-white">{entityLabel}</p>
              <p className="text-[12px] text-slate-400 mt-1">{event.entityType}</p>
              {event.entityId && (
                <p className="text-[11px] text-slate-500 font-mono mt-1 truncate">
                  {event.entityId}
                </p>
              )}
            </div>

            {/* Timestamp card */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Timestamp</p>
              <p className="text-sm text-white">{formatFullTimestamp(event.timestamp)}</p>
              <p className="text-[12px] text-slate-400 mt-1">{formatTimestamp(event.timestamp)}</p>
            </div>

            {/* Extra payload fields shown as key-value pairs */}
            {Object.keys(payload).length > 0 && Object.keys(payload).length <= 8 && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Details</p>
                <dl className="space-y-1.5">
                  {Object.entries(payload).map(([key, value]) => (
                    <div key={key} className="flex items-baseline gap-2">
                      <dt className="text-[12px] text-slate-500 shrink-0">{key}</dt>
                      <dd className="text-[12px] text-slate-200 truncate">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>

          {/* Right -- raw payload */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex flex-col min-h-0">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Raw Payload</p>
            <pre className="flex-1 text-[12px] text-slate-300 bg-black/20 border border-white/[0.04] rounded-lg p-3 overflow-auto whitespace-pre-wrap break-words font-mono">
              {JSON.stringify(payload, null, 2)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
