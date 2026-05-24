import { KANBAN_STATES, type KanbanOrigin, type KanbanState } from '@offisim/shared-types';
import type { BadgeProps } from '@offisim/ui-core';
import { cn } from '@offisim/ui-core';

type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'accent';
export type AgentStatusTone = 'idle' | 'info' | 'success' | 'accent' | 'error' | 'warning';

interface TaskStatusDisplay {
  readonly label: string;
  readonly tone: StatusTone;
  readonly active?: boolean;
}

const TASK_STATUS_DISPLAY: Record<string, TaskStatusDisplay> = {
  pending: { label: 'Pending', tone: 'neutral' },
  planned: { label: 'Planned', tone: 'neutral' },
  queued: { label: 'Queued', tone: 'neutral' },
  active: { label: 'Running', tone: 'info', active: true },
  running: { label: 'Running', tone: 'info', active: true },
  completed: { label: 'Done', tone: 'success' },
  done: { label: 'Done', tone: 'success' },
  failed: { label: 'Failed', tone: 'error' },
  cancelled: { label: 'Cancelled', tone: 'error' },
  review_ready: { label: 'Review', tone: 'warning' },
  waiting_dependency: { label: 'Waiting', tone: 'warning' },
};

const TONE_BADGE_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-surface-2 text-ink-3',
  info: 'bg-accent-surface text-accent',
  success: 'bg-ok-surface text-ok',
  warning: 'bg-warn-surface text-warn',
  error: 'bg-danger-surface text-danger',
  accent: 'bg-accent-surface text-accent',
};

const TONE_TEXT_CLASS: Record<StatusTone, string> = {
  neutral: 'text-ink-4',
  info: 'text-accent',
  success: 'text-ok',
  warning: 'text-warn',
  error: 'text-danger',
  accent: 'text-accent',
};

const TONE_DOT_CLASS: Record<StatusTone, string> = {
  neutral: 'bg-ink-4',
  info: 'bg-accent',
  success: 'bg-ok',
  warning: 'bg-warn',
  error: 'bg-danger',
  accent: 'bg-accent',
};

const TONE_BADGE_VARIANT: Record<StatusTone, BadgeProps['variant']> = {
  neutral: 'secondary',
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
  accent: 'default',
};

function titleFromEnum(value: string): string {
  return value
    .split(/[_-]+/g)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function taskStatusDisplay(status: string): TaskStatusDisplay {
  return TASK_STATUS_DISPLAY[status] ?? { label: titleFromEnum(status), tone: 'neutral' };
}

export function taskStatusLabel(status: string): string {
  return taskStatusDisplay(status).label;
}

export function taskStatusBadgeClass(status: string): string {
  return TONE_BADGE_CLASS[taskStatusDisplay(status).tone];
}

export function taskStatusBadgeVariant(status: string): BadgeProps['variant'] {
  return TONE_BADGE_VARIANT[taskStatusDisplay(status).tone];
}

export function taskStatusTextClass(status: string): string {
  return TONE_TEXT_CLASS[taskStatusDisplay(status).tone];
}

export function taskStatusDotClass(status: string): string {
  return cn(
    TONE_DOT_CLASS[taskStatusDisplay(status).tone],
    taskStatusDisplay(status).active && 'animate-pulse',
  );
}

export function taskStatusSegmentClass(status: string, isHighlighted: boolean): string {
  return cn(taskStatusDotClass(status), !isHighlighted && 'opacity-50');
}

export function taskStatusCardClass(status: string): string {
  const display = taskStatusDisplay(status);
  if (display.tone === 'info') return 'border-accent shadow-glow-accent';
  if (display.tone === 'error') return 'border-danger';
  return '';
}

const AGENT_STATE_TONE: Record<string, AgentStatusTone> = {
  assigned: 'info',
  thinking: 'info',
  executing: 'success',
  meeting: 'accent',
  blocked: 'error',
  failed: 'error',
  waiting: 'warning',
};

export function agentStatusTone(state: string): AgentStatusTone {
  return AGENT_STATE_TONE[state] ?? 'idle';
}

const KANBAN_LABELS: Record<KanbanState, string> = {
  todo: 'Todo',
  doing: 'Doing',
  blocked: 'Blocked',
  review: 'Review',
  done: 'Done',
};

const KANBAN_STATE_BORDER_CLASS: Record<KanbanState, string> = {
  todo: 'border-t-accent',
  doing: 'border-t-warn',
  blocked: 'border-t-danger',
  review: 'border-t-accent',
  done: 'border-t-ok',
};

const KANBAN_STATE_DOT_CLASS: Record<KanbanState, string> = {
  todo: 'bg-accent',
  doing: 'bg-warn',
  blocked: 'bg-danger',
  review: 'bg-accent',
  done: 'bg-ok',
};

const KANBAN_ORIGIN_LABELS: Record<KanbanOrigin, string> = {
  'pm-planner': 'Planner',
  employee: 'Employee',
  manager: 'Manager',
  human: 'Human',
};

const KANBAN_ORIGIN_BADGE_CLASS: Record<KanbanOrigin, string> = {
  'pm-planner': 'border-accent bg-accent-surface text-accent',
  employee: 'border-ok bg-ok-surface text-ok',
  manager: 'border-warn bg-warn-surface text-warn',
  human: 'border-line-soft bg-surface-2 text-ink-3',
};

export { KANBAN_STATES };

export function kanbanStateLabel(state: KanbanState): string {
  return KANBAN_LABELS[state];
}

export function kanbanStateBorderClass(state: KanbanState): string {
  return KANBAN_STATE_BORDER_CLASS[state];
}

export function kanbanStateDotClass(state: KanbanState): string {
  return KANBAN_STATE_DOT_CLASS[state];
}

export function kanbanOriginLabel(origin: KanbanOrigin): string {
  return KANBAN_ORIGIN_LABELS[origin];
}

export function kanbanOriginBadgeClass(origin: KanbanOrigin): string {
  return KANBAN_ORIGIN_BADGE_CLASS[origin];
}

const DRAFT_STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  validated: 'Validated',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
};

const DRAFT_STATUS_VARIANTS: Record<string, BadgeProps['variant']> = {
  draft: 'secondary',
  validated: 'info',
  submitted: 'info',
  approved: 'success',
  rejected: 'error',
};

const DRAFT_VALIDATION_LABELS: Record<string, string> = {
  unknown: 'Not checked',
  valid: 'Valid',
  invalid: 'Invalid',
};

export function draftStatusLabel(status: string): string {
  return DRAFT_STATUS_LABELS[status] ?? titleFromEnum(status);
}

export function draftStatusVariant(status: string): BadgeProps['variant'] {
  return DRAFT_STATUS_VARIANTS[status] ?? 'secondary';
}

export function draftValidationLabel(state: string): string {
  return DRAFT_VALIDATION_LABELS[state] ?? titleFromEnum(state);
}
