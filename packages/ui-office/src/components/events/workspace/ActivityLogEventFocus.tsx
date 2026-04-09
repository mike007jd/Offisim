import type { RuntimeEvent } from '@offisim/shared-types';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRightLeft,
  BookOpen,
  CheckCircle,
  Clock,
  Lightbulb,
  Play,
  Plug,
  UserCheck,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
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
// Level styles
// ---------------------------------------------------------------------------

const LEVEL_BANNER: Record<EventDisplayLevel, { bg: string; border: string; text: string }> = {
  Info: {
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
    text: 'text-blue-400',
  },
  Warning: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    text: 'text-amber-400',
  },
  Error: {
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    text: 'text-red-400',
  },
};

const LEVEL_DOT: Record<EventDisplayLevel, string> = {
  Info: 'bg-blue-400',
  Warning: 'bg-amber-400',
  Error: 'bg-red-400',
};

// ---------------------------------------------------------------------------
// Domain icon (mirrors EventItem logic)
// ---------------------------------------------------------------------------

function domainIcon(type: string): { Icon: LucideIcon; color: string; bg: string } | null {
  if (type.startsWith('hr.'))
    return { Icon: UserCheck, color: 'text-rose-400', bg: 'bg-rose-500/20' };
  if (type.startsWith('mcp.')) return { Icon: Plug, color: 'text-blue-400', bg: 'bg-blue-500/20' };
  if (type.startsWith('knowledge.'))
    return { Icon: BookOpen, color: 'text-emerald-400', bg: 'bg-emerald-500/20' };
  if (type.startsWith('memory.'))
    return { Icon: Lightbulb, color: 'text-amber-400', bg: 'bg-amber-500/20' };
  if (type.startsWith('handoff.'))
    return { Icon: ArrowRightLeft, color: 'text-orange-400', bg: 'bg-orange-500/20' };
  if (type.startsWith('meeting.') || type.startsWith('direct.chat.'))
    return { Icon: Users, color: 'text-cyan-400', bg: 'bg-cyan-500/20' };
  return null;
}

function resolveIcon(type: string): { Icon: LucideIcon; color: string; bg: string } {
  const domain = domainIcon(type);
  if (domain) return domain;
  const t = type.toLowerCase();
  if (t.includes('failed') || t.includes('error'))
    return { Icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/20' };
  if (t.includes('entered') || t.includes('started'))
    return { Icon: Play, color: 'text-sky-400', bg: 'bg-sky-500/20' };
  return { Icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/20' };
}

// ---------------------------------------------------------------------------
// JSON syntax coloring
// ---------------------------------------------------------------------------

function renderJsonValue(value: unknown, depth: number): ReactNode {
  if (value === null) return <span className="text-slate-500">null</span>;
  if (typeof value === 'boolean') return <span className="text-purple-400">{String(value)}</span>;
  if (typeof value === 'number') return <span className="text-amber-400">{value}</span>;
  if (typeof value === 'string')
    return <span className="text-emerald-400">&quot;{value}&quot;</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-500">{'[]'}</span>;
    const indent = '  '.repeat(depth + 1);
    const closeIndent = '  '.repeat(depth);
    return (
      <span>
        {'[\n'}
        {value.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static JSON display, items never reorder
          <span key={`arr-${depth}-${i}`}>
            {indent}
            {renderJsonValue(item, depth + 1)}
            {i < value.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
        {closeIndent}
        {']'}
      </span>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-slate-500">{'{}'}</span>;
    const indent = '  '.repeat(depth + 1);
    const closeIndent = '  '.repeat(depth);
    return (
      <span>
        {'{\n'}
        {entries.map(([key, val], i) => (
          <span key={`obj-${depth}-${key}`}>
            {indent}
            <span className="text-cyan-400">&quot;{key}&quot;</span>
            <span className="text-slate-500">: </span>
            {renderJsonValue(val, depth + 1)}
            {i < entries.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
        {closeIndent}
        {'}'}
      </span>
    );
  }

  return <span className="text-slate-400">{String(value)}</span>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ActivityLogEventFocus({ event, onBack }: ActivityLogEventFocusProps) {
  const level = getEventLevel(event);
  const payload = event.payload as Record<string, unknown>;
  const entityLabel = getDisplayLabel(event);
  const typeParts = event.type.split('.');
  const bannerStyle = LEVEL_BANNER[level];
  const { Icon, color: iconColor, bg: iconBg } = resolveIcon(event.type);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Full-width banner header */}
      <div className={`${bannerStyle.bg} border-b ${bannerStyle.border} px-5 py-4 shrink-0`}>
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] hover:text-white transition-colors text-[12px] font-medium"
            aria-label="Back to timeline"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>

          <div className="flex-1" />

          {/* Level badge */}
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${LEVEL_DOT[level]}`} />
            <span className={`text-[12px] font-semibold ${bannerStyle.text}`}>{level}</span>
          </div>
        </div>

        {/* Type path breadcrumb */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {typeParts.map((part, i) => (
            <span key={part} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-slate-600 text-[10px]">/</span>}
              <span
                className={`text-[13px] ${
                  i === typeParts.length - 1 ? 'font-bold text-white' : 'font-medium text-slate-400'
                }`}
              >
                {part}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-5">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4 h-full">
          {/* Left column */}
          <div className="flex flex-col gap-3">
            {/* Entity card with icon */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">Entity</p>
              <div className="flex items-center gap-3">
                <div
                  className={`flex items-center justify-center w-10 h-10 rounded-full shrink-0 ${iconBg}`}
                >
                  <Icon className={`w-5 h-5 ${iconColor}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{entityLabel}</p>
                  <p className="text-[12px] text-slate-400 mt-0.5">{event.entityType}</p>
                  {event.entityId && (
                    <p className="text-[11px] text-slate-600 font-mono mt-0.5 truncate">
                      {event.entityId}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Timestamp card */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">Timestamp</p>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-full shrink-0 bg-slate-500/10">
                  <Clock className="w-5 h-5 text-slate-400" />
                </div>
                <div>
                  <p className="text-sm text-white font-medium">
                    {formatFullTimestamp(event.timestamp)}
                  </p>
                  <p className="text-[12px] text-slate-400 mt-0.5">
                    {formatTimestamp(event.timestamp)}
                  </p>
                </div>
              </div>
            </div>

            {/* Detail fields */}
            {Object.keys(payload).length > 0 && Object.keys(payload).length <= 8 && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">Details</p>
                <dl className="space-y-2">
                  {Object.entries(payload).map(([key, value]) => (
                    <div key={key} className="flex items-baseline gap-2">
                      <dt className="text-[12px] text-cyan-400/80 font-mono shrink-0">{key}</dt>
                      <dd className="text-[12px] text-slate-200 truncate">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>

          {/* Right column -- syntax-colored payload */}
          <div className="rounded-xl border border-white/[0.06] bg-black/30 p-4 flex flex-col min-h-0">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-3">Raw Payload</p>
            <pre className="flex-1 text-[12px] bg-black/20 border border-white/[0.04] rounded-lg p-4 overflow-auto whitespace-pre font-mono leading-relaxed">
              {renderJsonValue(payload, 0)}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
