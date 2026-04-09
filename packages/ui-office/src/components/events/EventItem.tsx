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

interface EventItemProps {
  event: RuntimeEvent;
}

/** Pick a domain-specific icon + color for known event prefixes. */
function domainIcon(type: string): { Icon: LucideIcon; color: string } | null {
  if (type.startsWith('hr.')) return { Icon: UserCheck, color: 'text-rose-400' };
  if (type.startsWith('mcp.')) return { Icon: Plug, color: 'text-blue-400' };
  if (type.startsWith('knowledge.')) return { Icon: BookOpen, color: 'text-emerald-400' };
  if (type.startsWith('memory.')) return { Icon: Lightbulb, color: 'text-amber-400' };
  if (type.startsWith('handoff.')) return { Icon: ArrowRightLeft, color: 'text-orange-400' };
  if (type.startsWith('meeting.') || type.startsWith('direct.chat.'))
    return { Icon: Users, color: 'text-cyan-400' };
  return null;
}

export function EventItem({ event }: EventItemProps) {
  const { category, action } = categorize(event);
  const domain = domainIcon(event.type);
  const Icon =
    domain?.Icon ??
    (category === 'error' ? AlertCircle : category === 'entered' ? Play : CheckCircle);
  const iconColor =
    domain?.color ??
    (category === 'error'
      ? 'text-lobster-red'
      : category === 'entered'
        ? 'text-sea-blue'
        : 'text-kelp-green');
  const label = getDisplayLabel(event);
  const topicLabel = formatEventType(event.type);

  return (
    <div className="flex items-start gap-3 px-5 py-3 text-sm">
      <Icon className={`h-4.5 w-4.5 mt-0.5 shrink-0 ${iconColor}`} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="break-words leading-relaxed text-sand">
          <span className="font-medium">{label}</span>
          {action && <span className="text-shell ml-1.5">{action}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-shell/80">
          <span className="font-mono">{topicLabel}</span>
          {event.entityId ? <span className="font-mono">ID {event.entityId}</span> : null}
        </div>
      </div>
      <span className="text-[13px] text-shell shrink-0 pt-0.5">
        {formatTimestamp(event.timestamp)}
      </span>
    </div>
  );
}
