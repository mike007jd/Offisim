import { useUiState } from '@/app/ui-state.js';
import { useLoopRuns } from '@/data/loops.js';
import {
  EmptyState,
  ErrorState,
  SkeletonRows,
  errorDetail,
} from '@/surfaces/shared/SurfaceStates.js';
import { History } from 'lucide-react';

/**
 * Read-only run history for persisted execution rows. There are no
 * Start/Pause/Resume/Cancel controls here; live run control belongs to Office,
 * while this view only lists title / goal / status / updated time.
 */

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function LoopRuns() {
  const companyId = useUiState((s) => s.companyId) || null;
  const runs = useLoopRuns(companyId);

  return (
    <div className="off-loops-runs">
      {runs.isError ? (
        <ErrorState
          title="Couldn't load runs"
          detail={errorDetail(runs.error, 'The loop runs list failed to load.')}
          onRetry={() => void runs.refetch()}
        />
      ) : runs.isLoading ? (
        <SkeletonRows rows={4} />
      ) : (runs.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={History}
          title="No runs"
          description="Run a saved loop and its execution will appear here."
        />
      ) : (
        <ul className="off-loops-runs-list">
          {runs.data?.map((run) => (
            <li key={run.invocation_id} className="off-loops-run">
              <span className="off-loops-run-main">
                <span className="off-loops-run-title">{run.loopTitle}</span>
                <span className="off-loops-run-goal">
                  {run.mission_id ? 'Project run' : 'Office run'}
                </span>
              </span>
              <span className="off-loops-run-side">
                <span className="off-loops-run-status is-neutral">{run.status}</span>
                <span className="off-loops-run-time">{timeAgo(run.created_at)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
