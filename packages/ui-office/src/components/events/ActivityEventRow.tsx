import { type RuntimeEvent, TASK_ASSIGNMENT_REROUTED } from '@offisim/shared-types';
import { Button } from '@offisim/ui-core';
import { Activity } from 'lucide-react';
import { formatTimestamp } from '../../lib/format-time';
import { domainIcon, formatTaskAssignmentReroutedLabel, getDisplayLabel } from './EventItem';
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
  const iconTone = domain?.tone ?? 'neutral';
  const label =
    event.type === TASK_ASSIGNMENT_REROUTED
      ? formatTaskAssignmentReroutedLabel(event, getEmployeeName)
      : getDisplayLabel(event);

  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className="activity-event-row"
      data-level={level.toLowerCase()}
      data-selected={selected || undefined}
    >
      <Icon className="activity-event-row-icon" data-tone={iconTone} />
      <span className="activity-event-row-label">{label}</span>
      {collapsedCount && collapsedCount > 1 && (
        <span className="activity-event-row-count">×{collapsedCount}</span>
      )}
      <span className="activity-event-row-time">{formatTimestamp(event.timestamp)}</span>
      <span className="activity-event-row-level" />
    </Button>
  );
}
