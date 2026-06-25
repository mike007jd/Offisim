import { useUiState } from '@/app/ui-state.js';
import { useMissions } from '@/data/missions.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { Button } from '@/design-system/primitives/button.js';
import { cn } from '@/lib/utils.js';
import { EmptyState, ErrorState, SkeletonRows, errorDetail } from '@/surfaces/shared/SurfaceStates.js';
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  Hourglass,
  Loader2,
  type LucideIcon,
  Pause,
  Plus,
  ShieldAlert,
  Target,
  XCircle,
} from 'lucide-react';
import { type StatusGlyph, missionStatusView } from './mission-domain.js';

/**
 * The mission LIST (PRD §24.3 — pick a mission → Control; "New Mission" →
 * Composer). Reads the company's missions newest-first; honest loading / empty /
 * error states per the SurfaceRouter convention.
 */

const STATUS_GLYPH_ICON: Record<StatusGlyph, LucideIcon> = {
  draft: CircleDashed,
  ready: CircleDot,
  running: Loader2,
  verifying: Loader2,
  paused: Pause,
  blocked: ShieldAlert,
  failed: XCircle,
  completed: CheckCircle2,
  cancelled: Ban,
  waiting: Hourglass,
};

function timeAgo(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface MissionListProps {
  onNewMission: () => void;
  onOpenMission: (missionId: string) => void;
}

export function MissionList({ onNewMission, onOpenMission }: MissionListProps) {
  const companyId = useUiState((s) => s.companyId);
  const missions = useMissions(companyId || null);

  return (
    <div className="off-mission-list">
      <header className="off-mission-list-head">
        <div className="off-mission-list-title">
          <Icon icon={Target} size="sm" />
          Missions
        </div>
        <Button size="sm" onClick={onNewMission} disabled={!companyId}>
          <Icon icon={Plus} size="sm" />
          New mission
        </Button>
      </header>

      <div className="off-mission-list-body">
        {missions.isError ? (
          <ErrorState
            title="Couldn't load missions"
            detail={errorDetail(missions.error, 'The mission list failed to load.')}
            onRetry={() => void missions.refetch()}
          />
        ) : missions.isLoading ? (
          <SkeletonRows rows={5} />
        ) : !missions.data || missions.data.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No missions yet"
            description="A mission is a verifiable unit of work with done-when criteria. Create one to define the goal and how it’s checked."
            action={companyId ? { label: 'New mission', onClick: onNewMission } : undefined}
          />
        ) : (
          <ul className="off-mission-rows">
            {missions.data.map((mission) => {
              const view = missionStatusView(mission.status);
              const GlyphIcon = STATUS_GLYPH_ICON[view.glyph];
              return (
                <li key={mission.mission_id}>
                  <button
                    type="button"
                    className="off-mission-row off-focusable"
                    onClick={() => onOpenMission(mission.mission_id)}
                  >
                    <span className={cn('off-mission-row-status', `is-${view.tone}`)}>
                      <Icon
                        icon={GlyphIcon}
                        size="sm"
                        className={view.active ? 'off-mission-spin' : undefined}
                      />
                    </span>
                    <span className="off-mission-row-main">
                      <span className="off-mission-row-title">{mission.title}</span>
                      <span className="off-mission-row-goal">{mission.goal}</span>
                    </span>
                    <span className="off-mission-row-side">
                      <span className={cn('off-mission-row-statuslabel', `is-${view.tone}`)}>
                        {view.label}
                      </span>
                      <span className="off-mission-row-time">{timeAgo(mission.updated_at)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
