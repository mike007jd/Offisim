import { Activity, Search } from 'lucide-react';

export interface ActivityEmptyStateProps {
  variant: 'no-events' | 'no-results';
  onResetFilters?: () => void;
}

export function ActivityEmptyState({ variant, onResetFilters }: ActivityEmptyStateProps) {
  if (variant === 'no-events') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center px-6">
        <Activity className="h-10 w-10 text-slate-500" />
        <p className="text-sm text-slate-400">No activity recorded yet</p>
        <p className="text-xs text-slate-500">Events will appear here as your company operates.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center px-6">
      <Search className="h-10 w-10 text-slate-500" />
      <p className="text-sm text-slate-400">No events match your filters</p>
      {onResetFilters && (
        <button
          type="button"
          onClick={onResetFilters}
          className="text-xs text-accent hover:underline"
        >
          Reset filters
        </button>
      )}
    </div>
  );
}
