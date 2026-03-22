import type { RuntimeEvent } from '@aics/shared-types';
import { AlertCircle, CheckCircle, Play } from 'lucide-react';
import { formatTimestamp } from '../../lib/format-time.js';

type EventCategory = 'entered' | 'error' | 'completed' | 'other';

/** Categorize event + derive action text in a single pass (avoids duplicate includes chains). */
function categorize(event: RuntimeEvent): { category: EventCategory; action: string } {
  const t = event.type;
  if (t.includes('entered') || t.includes('started')) return { category: 'entered', action: 'started' };
  if (t.includes('failed') || t.includes('error')) return { category: 'error', action: 'failed' };
  if (t.includes('exited') || t.includes('completed') || t.includes('ended')) return { category: 'completed', action: 'completed' };
  if (t.includes('created')) return { category: 'other', action: 'created' };
  if (t.includes('assigned')) return { category: 'other', action: 'assigned' };
  if (t.includes('blocked')) return { category: 'other', action: 'blocked' };
  return { category: 'other', action: '' };
}

/** Extract a human-readable label from event payload, falling back to a topic-derived label. */
function getDisplayLabel(event: RuntimeEvent): string {
  const p = event.payload as Record<string, unknown>;
  if (typeof p.nodeName === 'string') return p.nodeName;
  if (typeof p.employeeName === 'string') return p.employeeName;
  if (typeof p.name === 'string') return p.name;

  const parts = event.type.split('.');
  if (parts.length >= 2) {
    const verb = parts[parts.length - 1]!;
    const subject = parts.slice(0, -1).join(' ');
    if (typeof p.next === 'string') {
      const prevStr = typeof p.prev === 'string' ? `${p.prev} → ` : '';
      return `${subject}: ${prevStr}${p.next}`;
    }
    if (verb !== 'changed' && verb !== 'updated') return subject;
    return subject;
  }
  if (event.entityId.length > 12) return event.entityId.slice(0, 8) + '…';
  return event.entityId;
}

interface EventItemProps {
  event: RuntimeEvent;
}

export function EventItem({ event }: EventItemProps) {
  const { category, action } = categorize(event);
  const Icon = category === 'error' ? AlertCircle : category === 'entered' ? Play : CheckCircle;
  const iconColor = category === 'error' ? 'text-lobster-red' : category === 'entered' ? 'text-sea-blue' : 'text-kelp-green';
  const label = getDisplayLabel(event);

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 text-xs">
      <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${iconColor}`} />
      <div className="flex-1 min-w-0 truncate">
        <span className="font-medium text-sand">{label}</span>
        {action && <span className="text-shell ml-1">{action}</span>}
      </div>
      <span className="text-shell shrink-0">{formatTimestamp(event.timestamp)}</span>
    </div>
  );
}
