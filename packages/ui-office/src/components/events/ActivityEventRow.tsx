import { type RuntimeEvent, TASK_ASSIGNMENT_REROUTED } from '@offisim/shared-types';
import { Button } from '@offisim/ui-core';
import { Activity } from 'lucide-react';
import { formatTimestamp } from '../../lib/format-time';
import {
  domainIcon,
  formatTaskAssignmentReroutedLabel,
  getDisplayLabel,
  getEventToneClass,
} from './EventItem';
import type { EventDisplayLevel } from './EventLog';

export interface ActivityEventRowProps {
  event: RuntimeEvent;
  level: EventDisplayLevel;
  selected: boolean;
  onClick: () => void;
  /**
   * When > 1, a `×N` badge renders alongside the row to indicate this row
   * stands in for N consecutive duplicates collapsed by `collapseConsecutiveReroutes`.
   */
  collapsedCount?: number;
  /** Resolves an employee id to a display name; returns null when unknown. */
  getEmployeeName?: (employeeId: string) => string | null;
}

const LEVEL_LEFT_BORDER: Record<EventDisplayLevel, string> = {
  Error: 'border-l-4 border-error',
  Warning: 'border-l-4 border-warning',
  Info: 'border-l-4 border-transparent',
};

const LEVEL_BAR_COLOR: Record<EventDisplayLevel, string> = {
  Error: 'bg-error',
  Warning: 'bg-warning',
  Info: 'bg-transparent',
};

export function ActivityEventRow({
  event,
  level,
  selected,
  onClick,
  collapsedCount,
  getEmployeeName,
}: ActivityEventRowProps) {
  const domain = domainIcon(event.type);
  const Icon = domain?.Icon ?? Activity;
  const iconColor = domain ? getEventToneClass(domain.tone) : 'text-text-secondary';
  const label =
    event.type === TASK_ASSIGNMENT_REROUTED
      ? formatTaskAssignmentReroutedLabel(event, getEmployeeName)
      : getDisplayLabel(event);

  const selectedStyle = selected ? 'bg-accent-muted' : '';
  const levelBorder = LEVEL_LEFT_BORDER[level];

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={`h-12 w-full justify-start gap-3 rounded-none px-4 text-left hover:bg-surface-hover ${selectedStyle} ${levelBorder}`}
    >
      <Icon className={`size-5 shrink-0 ${iconColor}`} />
      <span className="flex-1 truncate text-sm text-text-primary">{label}</span>
      {collapsedCount && collapsedCount > 1 && (
        <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-caption font-medium text-text-secondary">
          ×{collapsedCount}
        </span>
      )}
      <span className="w-20 shrink-0 text-right text-xs text-text-muted">
        {formatTimestamp(event.timestamp)}
      </span>
      <span className={`h-6 w-1 shrink-0 rounded-full ${LEVEL_BAR_COLOR[level]}`} />
    </Button>
  );
}
