import type { RuntimeEvent } from '@offisim/shared-types';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  ArrowRightLeft,
  BookOpen,
  CheckCircle,
  Lightbulb,
  Play,
  Plug,
  UserCheck,
  Users,
} from 'lucide-react';
import { formatTimestamp } from '../../lib/format-time.js';
import type { EventDisplayLevel } from './EventLog';

type EventCategory = 'entered' | 'error' | 'completed' | 'other';

/** Categorize event + derive action text in a single pass (avoids duplicate includes chains). */
function categorize(event: RuntimeEvent): { category: EventCategory; action: string } {
  const t = event.type;
  if (t.includes('entered') || t.includes('started'))
    return { category: 'entered', action: 'started' };
  if (t.includes('failed') || t.includes('error')) return { category: 'error', action: 'failed' };
  if (t.includes('exited') || t.includes('completed') || t.includes('ended'))
    return { category: 'completed', action: 'completed' };
  if (t.includes('created')) return { category: 'other', action: 'created' };
  if (t.includes('assigned')) return { category: 'other', action: 'assigned' };
  if (t.includes('blocked')) return { category: 'other', action: 'blocked' };
  return { category: 'other', action: '' };
}

/** Extract a human-readable label from event payload, falling back to a topic-derived label. */
export function getDisplayLabel(event: RuntimeEvent): string {
  const p = event.payload as Record<string, unknown>;
  if (typeof p.message === 'string') return p.message;
  if (typeof p.nodeName === 'string') return p.nodeName;
  if (typeof p.employeeName === 'string') return p.employeeName;
  if (typeof p.name === 'string') return p.name;

  const parts = event.type.split('.');
  if (parts.length >= 2) {
    const verb = parts.at(-1);
    if (typeof verb !== 'string') return event.entityId;
    const subject = parts.slice(0, -1).join(' ');
    if (typeof p.next === 'string') {
      const prevStr = typeof p.prev === 'string' ? `${p.prev} → ` : '';
      return `${subject}: ${prevStr}${p.next}`;
    }
    if (verb !== 'changed' && verb !== 'updated') return subject;
    return subject;
  }
  if (event.entityId.length > 12) return `${event.entityId.slice(0, 8)}…`;
  return event.entityId;
}

function formatEventType(type: string): string {
  return type.replaceAll('.', ' / ');
}

// ---------------------------------------------------------------------------
// Domain icon resolution
// ---------------------------------------------------------------------------

/** Pick a domain-specific icon + color for known event prefixes. */
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

// ---------------------------------------------------------------------------
// Level tint backgrounds
// ---------------------------------------------------------------------------

const LEVEL_TINT: Record<EventDisplayLevel, string> = {
  Info: '',
  Warning: 'bg-amber-500/[0.04]',
  Error: 'bg-red-500/[0.06]',
};

const LEVEL_DOT: Record<EventDisplayLevel, string> = {
  Info: 'bg-blue-400',
  Warning: 'bg-amber-400',
  Error: 'bg-red-400',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface EventItemProps {
  event: RuntimeEvent;
  level?: EventDisplayLevel;
}

export function EventItem({ event, level = 'Info' }: EventItemProps) {
  const { category, action } = categorize(event);
  const domain = domainIcon(event.type);

  const Icon =
    domain?.Icon ??
    (category === 'error' ? AlertCircle : category === 'entered' ? Play : CheckCircle);
  const iconColor =
    domain?.color ??
    (category === 'error'
      ? 'text-red-400'
      : category === 'entered'
        ? 'text-sky-400'
        : 'text-emerald-400');
  const iconBg =
    domain?.bg ??
    (category === 'error'
      ? 'bg-red-500/20'
      : category === 'entered'
        ? 'bg-sky-500/20'
        : 'bg-emerald-500/20');

  const label = getDisplayLabel(event);
  const topicLabel = formatEventType(event.type);

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 ${LEVEL_TINT[level]} transition-colors`}>
      {/* Icon circle */}
      <div className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${iconBg}`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>

      {/* Center: primary + secondary */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 leading-snug">
          <span className="font-semibold text-[13px] text-slate-100 truncate">{label}</span>
          {action && (
            <span className="text-[11px] font-medium text-slate-500 shrink-0">{action}</span>
          )}
        </div>
        <div className="text-[11px] text-slate-500 truncate mt-0.5">{topicLabel}</div>
      </div>

      {/* Right: timestamp + level dot */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[11px] text-slate-500">{formatTimestamp(event.timestamp)}</span>
        <span className={`w-2 h-2 rounded-full ${LEVEL_DOT[level]}`} />
      </div>
    </div>
  );
}
