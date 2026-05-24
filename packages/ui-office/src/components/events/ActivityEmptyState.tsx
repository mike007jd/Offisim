import { EmptyState } from '@offisim/ui-core';
import { Activity, Search } from 'lucide-react';

export interface ActivityEmptyStateProps {
  variant: 'no-events' | 'no-results';
  onResetFilters?: () => void;
  onBackToOffice?: () => void;
}

const EVENT_FAMILIES = [
  'chat / task dispatch',
  'employee plans and tool calls',
  'deliverables, installs, errors',
];

export function ActivityEmptyState({
  variant,
  onResetFilters,
  onBackToOffice,
}: ActivityEmptyStateProps) {
  if (variant === 'no-events') {
    return (
      <div className="flex flex-1 items-center justify-center px-sp-6">
        <EmptyState
          icon={Activity}
          title="No activity yet"
          description={`Activity Log surfaces workspace and runtime events as your company operates — ${EVENT_FAMILIES.join(
            ', ',
          )}. Start a task in Office and events will appear here.`}
          primaryAction={
            onBackToOffice ? { label: 'Back to Office', onClick: onBackToOffice } : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-sp-6">
      <EmptyState
        icon={Search}
        title="No events match your filters"
        description="Try widening the time range, removing event types, or clearing actor filters."
        primaryAction={
          onResetFilters ? { label: 'Reset filters', onClick: onResetFilters } : undefined
        }
        secondaryActions={
          onBackToOffice ? [{ label: 'Back to Office', onClick: onBackToOffice }] : undefined
        }
      />
    </div>
  );
}
