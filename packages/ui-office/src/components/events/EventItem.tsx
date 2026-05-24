import {
  type RuntimeEvent,
  SKILL_INSTALL_OUTCOME,
  type SkillInstallOutcomeKind,
  TASK_ASSIGNMENT_REROUTED,
  skillInstallOutcomeLabel,
} from '@offisim/shared-types';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  ArrowRightLeft,
  BookOpen,
  CheckCircle,
  Lightbulb,
  Play,
  Plug,
  Puzzle,
  UserCheck,
  Users,
} from 'lucide-react';
import { formatTimestamp } from '../../lib/format-time.js';
import { formatTaskAssignmentReroutedLabel } from '../../runtime/runtime-activity-formatters.js';

export { formatTaskAssignmentReroutedLabel };

type EventCategory = 'entered' | 'error' | 'completed' | 'other';
type EventTone = 'error' | 'info' | 'success' | 'warning' | 'accent';

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
  if (event.type === TASK_ASSIGNMENT_REROUTED) {
    return formatTaskAssignmentReroutedLabel(event);
  }
  if (event.type === SKILL_INSTALL_OUTCOME) {
    return skillInstallOutcomeLabel(event.payload as SkillInstallOutcomeKind);
  }
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
  if (event.entityId.length > 12) return `${event.entityId.slice(0, 8)}...`;
  return event.entityId;
}

function formatEventType(type: string): string {
  return type.replaceAll('.', ' / ');
}

interface EventItemProps {
  event: RuntimeEvent;
}

/** Pick a domain-specific icon + color for known event prefixes. */
const EVENT_TONE_CLASS: Record<EventTone, string> = {
  error: 'text-danger',
  info: 'text-accent',
  success: 'text-ok',
  warning: 'text-warn',
  accent: 'text-accent',
};

export function getEventToneClass(tone: EventTone): string {
  return EVENT_TONE_CLASS[tone];
}

export function domainIcon(type: string): { Icon: LucideIcon; tone: EventTone } | null {
  if (type.startsWith('hr.')) return { Icon: UserCheck, tone: 'error' };
  if (type.startsWith('mcp.')) return { Icon: Plug, tone: 'info' };
  if (type.startsWith('knowledge.')) return { Icon: BookOpen, tone: 'success' };
  if (type.startsWith('memory.')) return { Icon: Lightbulb, tone: 'warning' };
  if (type.startsWith('skill.')) return { Icon: Puzzle, tone: 'success' };
  if (type.startsWith('handoff.')) return { Icon: ArrowRightLeft, tone: 'accent' };
  if (type.startsWith('meeting.') || type.startsWith('direct.chat.'))
    return { Icon: Users, tone: 'accent' };
  return null;
}

export function EventItem({ event }: EventItemProps) {
  const { category, action } = categorize(event);
  const domain = domainIcon(event.type);
  const Icon =
    domain?.Icon ??
    (category === 'error' ? AlertCircle : category === 'entered' ? Play : CheckCircle);
  const iconTone: EventTone =
    domain?.tone ?? (category === 'error' ? 'error' : category === 'entered' ? 'info' : 'success');
  const label = getDisplayLabel(event);
  const topicLabel = formatEventType(event.type);

  return (
    <div className="flex items-start gap-sp-2 px-sp-3 py-sp-2 text-fs-meta">
      <Icon className={`activity-event-icon shrink-0 ${EVENT_TONE_CLASS[iconTone]}`} />
      <div className="min-w-0 flex-1 flex flex-col gap-sp-1">
        <div className="break-words leading-relaxed text-ink-1">
          <span className="font-medium">{label}</span>
          {action && <span className="activity-event-action-gap text-ink-3">{action}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-sp-2 gap-y-sp-1 text-fs-meta text-ink-4">
          <span className="font-mono">{topicLabel}</span>
          {event.entityId ? <span className="font-mono">ID {event.entityId}</span> : null}
        </div>
      </div>
      <span className="activity-event-time-offset shrink-0 text-ink-4">
        {formatTimestamp(event.timestamp)}
      </span>
    </div>
  );
}
