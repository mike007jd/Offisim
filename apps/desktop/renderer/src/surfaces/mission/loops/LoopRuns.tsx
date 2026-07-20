import { useUiState } from '@/app/ui-state.js';
import { useLoopRuns } from '@/data/loops.js';
import { relativeTimeAgo } from '@/lib/utils.js';
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
  return Number.isNaN(then) ? '' : relativeTimeAgo(then);
}

type RunStatusTone = 'is-ok' | 'is-accent' | 'is-warn' | 'is-danger';

function runStatusView(status: string | null): { label: string; tone: RunStatusTone } {
  switch (status) {
    case 'completed':
      return { label: 'Completed', tone: 'is-ok' };
    case 'failed':
      return { label: 'Failed', tone: 'is-danger' };
    case 'cancelled':
      return { label: 'Cancelled', tone: 'is-danger' };
    case 'blocked':
      return { label: 'Blocked', tone: 'is-danger' };
    case 'awaiting_user':
      return { label: 'Needs input', tone: 'is-warn' };
    case 'interrupted':
      return { label: 'Interrupted', tone: 'is-warn' };
    case 'paused':
      return { label: 'Paused', tone: 'is-warn' };
    case 'repairing':
      return { label: 'Repairing', tone: 'is-warn' };
    case 'verifying':
      return { label: 'Verifying', tone: 'is-accent' };
    case 'ready_to_resume':
      return { label: 'Ready to resume', tone: 'is-accent' };
    case 'draft':
    case 'ready':
      return { label: 'Starting', tone: 'is-accent' };
    case 'running':
      return { label: 'Running', tone: 'is-accent' };
    default:
      return { label: 'Starting', tone: 'is-accent' };
  }
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
          {runs.data?.map((run) => {
            const status = runStatusView(run.missionStatus);
            return (
              <li key={run.invocation_id} className="off-loops-run">
                <span className="off-loops-run-main">
                  <span className="off-loops-run-title">{run.loopTitle}</span>
                  <span className="off-loops-run-goal">
                    {run.mission_id ? 'Project run' : 'Office run'}
                  </span>
                </span>
                <span className="off-loops-run-side">
                  <span className={`off-loops-run-status ${status.tone}`}>{status.label}</span>
                  <span className="off-loops-run-time">{timeAgo(run.created_at)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
