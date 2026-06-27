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
 * Legacy Runs (PR-08) — the existing Verified Missions rows, READ-ONLY. Old
 * missions are not auto-converted to Loops (their manual criteria are not
 * necessarily a reusable design); they remain viewable here as history. There are
 * NO Start/Pause/Resume/Cancel controls — the live run wiring is not part of this
 * surface, so we never show misleading buttons. The detail view (PR-11) decides
 * whether a legacy mission opens; for now this lists title / goal / status /
 * updated so the history stays auditable.
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
        <span>Legacy Runs — earlier Missions, kept for history. New work uses Loops.</span>
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
          title="No legacy runs"
          description="There are no earlier Missions for this company."
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
