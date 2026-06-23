import { useUiState } from '@/app/ui-state.js';
import { useCompanies, useEmployees, useRunCost } from '@/data/queries.js';
import { Icon } from '@/design-system/icons/Icon.js';
import { cn } from '@/lib/utils.js';
import {
  formatRelativeTimestamp,
  getDisplaySummary,
  useActivityRecords,
} from '@/surfaces/activity/activity-data.js';
import { SkeletonRows } from '@/surfaces/shared/SurfaceStates.js';
import { ArrowRight, SquareKanban } from 'lucide-react';
import { useActiveProject, useWsMeetings } from '../workspace-data.js';

/** Workplace is the apps launcher (the Feishu-style 工作台): a day-stats banner,
 *  the grid of workspace apps, and the live activity feed. The apps grid is the
 *  only way into per-app surfaces like Kanban that are intentionally NOT rail
 *  tabs — it grows as more apps land, while the rail stays a fixed surface set. */
export function WorkplaceApp() {
  const companyId = useUiState((s) => s.companyId);
  const setSurface = useUiState((s) => s.setSurface);
  const setApp = useUiState((s) => s.setWorkspaceApp);
  const companies = useCompanies();
  const employees = useEmployees();
  const meetings = useWsMeetings();
  const runCost = useRunCost();
  const activity = useActivityRecords(companyId);

  const company = companies.data?.find((c) => c.id === companyId) ?? null;
  // Shared selector so the Kanban tile and the board it opens name one project.
  const project = useActiveProject(companyId);
  const headcount = employees.data?.length ?? 0;
  const activeRuns = meetings.data?.filter((m) => m.status === 'live').length ?? 0;
  const spend = runCost.data?.costLabel ?? '$0.00';
  // useActivityRecords is cursor-paginated; the first page already holds far
  // more than the 6 rows this "Recent activity" tile shows.
  const recent = (activity.data?.pages.flatMap((page) => page.records) ?? []).slice(0, 6);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const stats = [
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

        <div className="off-ws-wp-sec-h">Apps</div>
        <div className="off-ws-wp-apps">
          <button
            type="button"
            className="off-ws-wp-app off-focusable"
            onClick={() => setApp('kanban')}
          >
            <span className="off-ws-wp-app-ic">
              <Icon icon={SquareKanban} size="md" />
            </span>
            <span className="off-ws-wp-app-tx">
              <span className="off-ws-wp-app-nm">Kanban</span>
              <span className="off-ws-wp-app-sub">
                {project?.name ? `${project.name} board` : 'Project board'}
              </span>
            </span>
          </button>
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
            {recent.map((record) => {
              const summary = getDisplaySummary(record);
              return (
                <div key={record.id} className="off-ws-act-entry">
                  <span>
                    {summary.actor ? `${summary.actor} · ${summary.label}` : summary.label}
                  </span>
                  <span className="off-ws-act-x">{formatRelativeTimestamp(record.at)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="off-ws-wp-recent-empty">No activity yet.</div>
        )}
      </div>
    </div>
  );
}
