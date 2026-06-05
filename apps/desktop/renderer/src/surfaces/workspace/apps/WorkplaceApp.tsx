import { useUiState } from '@/app/ui-state.js';
import { useCompanies, useEmployees, useProjects, useRunCost } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import {
  formatRelativeTimestamp,
  getDisplayLabel,
  useActivityRecords,
} from '@/surfaces/activity/activity-data.js';
import { SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { ArrowRight } from 'lucide-react';
import { useWsApprovals, useWsMeetings } from '../workspace-data.js';

/** Workplace is an overview home — not a launcher. The "Suite apps" and
 *  "Workspaces" tile grids duplicated the rail and the top nav, and the Recent
 *  list was hardcoded fixtures; both are gone. It now shows the day's real stats
 *  and the live activity feed. */
export function WorkplaceApp() {
  const companyId = useUiState((s) => s.companyId);
  const projectId = useUiState((s) => s.projectId);
  const setSurface = useUiState((s) => s.setSurface);
  const companies = useCompanies();
  const projects = useProjects(companyId);
  const employees = useEmployees();
  const approvals = useWsApprovals(companyId);
  const meetings = useWsMeetings();
  const runCost = useRunCost();
  const activity = useActivityRecords(companyId);

  const company = companies.data?.find((c) => c.id === companyId) ?? null;
  const project = projects.data?.find((p) => p.id === projectId) ?? projects.data?.[0] ?? null;
  const headcount = employees.data?.length ?? 0;
  const toApprove = approvals.data?.filter((a) => a.status === 'pending').length ?? 0;
  const activeRuns = meetings.data?.filter((m) => m.status === 'live').length ?? 0;
  const spend = runCost.data?.costLabel ?? '$0.00';
  const recent = (activity.data ?? []).slice(0, 6);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const stats = [
    { label: 'To approve', value: String(toApprove), alert: toApprove > 0 },
    { label: 'Active runs', value: String(activeRuns), alert: false },
    { label: 'Spend today', value: spend, alert: false },
  ];

  return (
    <div className="off-ws-detail off-ws-detail-full">
      <div className="off-ws-wp">
        <div className="off-ws-wp-hero">
          <div className="off-ws-wp-hi">
            {greeting}
            <span className="off-ws-wp-hi-sub">
              {company?.name ?? 'Company'} · {project?.name ?? 'Project'} · {headcount} employees
            </span>
          </div>
          <div className="off-ws-wp-stats">
            {stats.map((s) => (
              <div key={s.label} className={cn('off-ws-wp-stat', s.alert && 'is-alert')}>
                <div className="off-ws-wp-stat-v">{s.value}</div>
                <div className="off-ws-wp-stat-k">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="off-ws-wp-sec-h">
          Recent activity
          <button
            type="button"
            className="off-ws-wp-seeall off-focusable"
            onClick={() => setSurface('activity')}
          >
            View all
            <Icon icon={ArrowRight} size="sm" />
          </button>
        </div>
        {activity.isError ? (
          <div className="off-ws-wp-recent-empty is-error">Couldn’t load recent activity.</div>
        ) : activity.isLoading ? (
          <SkeletonRows rows={3} className="off-ws-wp-recent" />
        ) : recent.length > 0 ? (
          <div className="off-ws-act-entries off-ws-wp-recent">
            {recent.map((record) => (
              <div key={record.id} className="off-ws-act-entry">
                <span>{getDisplayLabel(record)}</span>
                <span className="off-ws-act-x">{formatRelativeTimestamp(record.at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="off-ws-wp-recent-empty">No activity yet.</div>
        )}
      </div>
    </div>
  );
}
