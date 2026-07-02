import { useUiState } from '@/app/ui-state.js';
import { useMissions } from '@/data/missions.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import { missionStatusView } from '@/surfaces/mission/mission-domain.js';
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
  const missions = useMissions(companyId);

  return (
    <div className="off-loops-runs">
      <div className="off-loops-runs-intro">
        <Icon icon={History} size="sm" />
        <span>Runs — persisted execution records for this company.</span>
      </div>
      {missions.isError ? (
        <ErrorState
          title="Couldn't load runs"
          detail={errorDetail(missions.error, 'The runs list failed to load.')}
          onRetry={() => void missions.refetch()}
        />
      ) : missions.isLoading ? (
        <SkeletonRows rows={4} />
      ) : (missions.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={History}
          title="No runs"
          description="This company has no persisted execution records yet."
        />
      ) : (
        <ul className="off-loops-runs-list">
          {missions.data!.map((mission) => {
            const view = missionStatusView(mission.status);
            return (
              <li key={mission.mission_id} className="off-loops-run">
                <span className="off-loops-run-main">
                  <span className="off-loops-run-title">{mission.title}</span>
                  <span className="off-loops-run-goal">{mission.goal}</span>
                </span>
                <span className="off-loops-run-side">
                  <span className={cn('off-loops-run-status', `is-${view.tone}`)}>
                    {view.label}
                  </span>
                  <span className="off-loops-run-time">{timeAgo(mission.updated_at)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
