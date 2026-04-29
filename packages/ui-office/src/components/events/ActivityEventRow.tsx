import { type RuntimeEvent, TASK_ASSIGNMENT_REROUTED } from '@offisim/shared-types';
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

const LEVEL_LEFT_BORDER: Record<EventDisplayLevel, string> = {
  Error: 'border-l-[4px] border-red-500',
  Warning: 'border-l-[4px] border-amber-500',
  Info: '',
};

const LEVEL_BAR_COLOR: Record<EventDisplayLevel, string> = {
  Error: 'bg-red-500',
  Warning: 'bg-amber-500',
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
  const iconColor = domain?.color ?? 'text-slate-400';
  const label =
    event.type === TASK_ASSIGNMENT_REROUTED
      ? formatTaskAssignmentReroutedLabel(event, getEmployeeName)
      : getDisplayLabel(event);

  const selectedStyle = selected ? 'bg-white/[0.06]' : '';
  const levelBorder = LEVEL_LEFT_BORDER[level];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 h-12 text-left transition-colors hover:bg-white/[0.04] ${selectedStyle} ${levelBorder}`}
    >
      <Icon className={`h-5 w-5 shrink-0 ${iconColor}`} />
      <span className="flex-1 truncate text-sm text-slate-200">{label}</span>
      {collapsedCount && collapsedCount > 1 && (
        <span className="shrink-0 rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-medium text-slate-300">
          ×{collapsedCount}
        </span>
      )}
      <span className="shrink-0 text-xs text-slate-500 w-20 text-right">
        {formatTimestamp(event.timestamp)}
      </span>
      <span className={`shrink-0 w-1 h-6 rounded-full ${LEVEL_BAR_COLOR[level]}`} />
    </button>
  );
}
