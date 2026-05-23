import { type RuntimeEvent, TASK_ASSIGNMENT_REROUTED } from '@offisim/shared-types';
import { Button, cn } from '@offisim/ui-core';
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

const ACTIVITY_ROW_CLASS =
  'h-activity-row w-full justify-start gap-sp-3 rounded-none px-sp-4 text-left hover:bg-surface-hover';
const ACTIVITY_ROW_ICON_CLASS = 'activity-row-icon shrink-0';
const ACTIVITY_ROW_LABEL_CLASS = 'min-w-0 flex-1 truncate text-fs-sm text-text-primary';
const ACTIVITY_ROW_COUNT_CLASS =
  'activity-row-count shrink-0 bg-surface-sunken text-caption font-medium text-text-secondary';
const ACTIVITY_ROW_TIME_CLASS =
  'w-activity-row-time shrink-0 text-right text-caption text-text-muted';
const ACTIVITY_ROW_LEVEL_BAR_CLASS = 'activity-row-level-marker shrink-0 rounded-r-pill';

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
      className={cn(ACTIVITY_ROW_CLASS, selectedStyle, levelBorder)}
    >
      <Icon className={cn(ACTIVITY_ROW_ICON_CLASS, iconColor)} />
      <span className={ACTIVITY_ROW_LABEL_CLASS}>{label}</span>
      {collapsedCount && collapsedCount > 1 && (
        <span className={ACTIVITY_ROW_COUNT_CLASS}>×{collapsedCount}</span>
      )}
      <span className={ACTIVITY_ROW_TIME_CLASS}>{formatTimestamp(event.timestamp)}</span>
      <span className={cn(ACTIVITY_ROW_LEVEL_BAR_CLASS, LEVEL_BAR_COLOR[level])} />
    </Button>
  );
}
